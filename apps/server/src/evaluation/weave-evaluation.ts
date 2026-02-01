/**
 * Proper Weave Evaluation Integration
 * 
 * This module implements Weave's built-in Evaluation framework:
 * - Uses weave.Evaluation for batch evaluation
 * - Defines proper scorers that work with Weave's UI
 * - Creates datasets from past runs for evaluation
 * - Results show up in Weave's Evaluation UI
 */

import * as weave from "weave";
import { config } from "../config.js";
import type { StepEvent } from "@loopless/shared";
import { getRun, getRunEvents, getRecentRunIds } from "../redis.js";
import { getTask } from "../tasks.js";

// ============================================================
// WEAVE SCORERS - These show up in Weave's Scorers UI
// ============================================================

/**
 * Task Success Scorer
 * Evaluates if the task was completed successfully
 */
export const taskSuccessScorer = weave.op(
  ({ modelOutput, datasetRow }: { modelOutput: RunResult; datasetRow: EvalDatasetRow }) => {
    const success = modelOutput.success === true;
    const expectedUrl = datasetRow.expectedUrl;
    
    let urlMatch = true;
    if (expectedUrl && modelOutput.finalUrl) {
      urlMatch = modelOutput.finalUrl.toLowerCase().includes(expectedUrl.toLowerCase());
    }
    
    return {
      passed: success && urlMatch,
      score: success ? (urlMatch ? 1.0 : 0.7) : 0,
    };
  },
  { name: "taskSuccessScorer" }
);

/**
 * Efficiency Scorer
 * Evaluates if the agent was efficient (low steps, few LLM calls)
 */
export const efficiencyScorer = weave.op(
  ({ modelOutput, datasetRow }: { modelOutput: RunResult; datasetRow: EvalDatasetRow }) => {
    const maxSteps = datasetRow.maxSteps || 20;
    const actualSteps = modelOutput.numSteps || 0;
    const llmCalls = modelOutput.numLlmCalls || 0;
    
    // Score based on efficiency
    const stepEfficiency = Math.max(0, 1 - (actualSteps / maxSteps));
    const llmEfficiency = Math.max(0, 1 - (llmCalls / 30)); // Assume 30 is max expected
    
    const score = (stepEfficiency + llmEfficiency) / 2;
    
    return {
      passed: actualSteps <= maxSteps,
      score,
      numSteps: actualSteps,
      numLlmCalls: llmCalls,
      stepEfficiency,
      llmEfficiency,
    };
  },
  { name: "efficiencyScorer" }
);

/**
 * Loop Detection Scorer
 * Evaluates if the agent avoided getting stuck in loops
 */
export const loopDetectionScorer = weave.op(
  ({ modelOutput }: { modelOutput: RunResult }) => {
    const loopsDetected = modelOutput.numLoopDetected || 0;
    const loopsBroken = modelOutput.numLoopBroken || 0;
    
    // Penalize for loops, but give credit for breaking them
    const loopPenalty = loopsDetected * 0.1;
    const breakCredit = loopsBroken * 0.05;
    const score = Math.max(0, 1 - loopPenalty + breakCredit);
    
    return {
      passed: loopsDetected === 0,
      score,
      loopsDetected,
      loopsBroken,
    };
  },
  { name: "loopDetectionScorer" }
);

/**
 * Cache Utilization Scorer (for warm runs)
 * Evaluates how well the agent used cached macros
 */
export const cacheUtilizationScorer = weave.op(
  ({ modelOutput }: { modelOutput: RunResult }) => {
    const cacheHits = modelOutput.cacheHits || 0;
    const cacheMisses = modelOutput.cacheMisses || 0;
    const total = cacheHits + cacheMisses;
    
    if (total === 0) {
      return { passed: true, score: 0.5, cacheHitRate: 0 };
    }
    
    const hitRate = cacheHits / total;
    
    return {
      passed: hitRate >= 0.5,
      score: hitRate,
      cacheHitRate: hitRate,
      cacheHits,
      cacheMisses,
    };
  },
  { name: "cacheUtilizationScorer" }
);

/**
 * LLM-as-a-Judge Scorer
 * Uses an LLM to evaluate the overall quality of the run
 */
export const llmJudgeScorer = weave.op(
  async ({ modelOutput, datasetRow }: { modelOutput: RunResult; datasetRow: EvalDatasetRow }) => {
    // Only run LLM judge if we have API keys
    if (!config.GOOGLE_API_KEY && !config.OPENAI_API_KEY) {
      return { passed: modelOutput.success, score: modelOutput.success ? 1 : 0, skipped: true };
    }
    
    try {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const gemini = new GoogleGenerativeAI(config.GOOGLE_API_KEY!);
      const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
      
      const prompt = `You are evaluating a browser automation agent's performance.

TASK: ${datasetRow.intent}
EXPECTED URL: ${datasetRow.expectedUrl || "Not specified"}

AGENT RESULT:
- Success: ${modelOutput.success}
- Final URL: ${modelOutput.finalUrl || "Unknown"}
- Steps taken: ${modelOutput.numSteps}
- LLM calls: ${modelOutput.numLlmCalls}
- Loops detected: ${modelOutput.numLoopDetected}
- Actions: ${modelOutput.actions?.slice(0, 5).join(", ") || "None recorded"}

Be lenient - say YES if the agent made significant progress toward the goal.
Respond with ONLY 'YES' or 'NO' followed by a score (0.0-1.0) and a brief reason.
Format: YES/NO | 0.X | reason`;

      const result = await model.generateContent(prompt);
      const response = result.response.text().trim();
      
      // Parse response
      const parts = response.split("|").map(s => s.trim());
      const passed = parts[0]?.toUpperCase().startsWith("YES") ?? false;
      const score = parseFloat(parts[1]) || (passed ? 0.8 : 0.2);
      const reason = parts[2] || response;
      
      return {
        passed,
        score,
        reason,
        verdict: passed ? "YES" : "NO",
      };
    } catch (err) {
      console.warn("[LLM Judge] Error:", err);
      return {
        passed: modelOutput.success,
        score: modelOutput.success ? 0.7 : 0.3,
        error: (err as Error).message,
      };
    }
  },
  { name: "llmJudgeScorer" }
);

// ============================================================
// TYPES
// ============================================================

interface RunResult {
  runId: string;
  taskId: string;
  mode: string;
  success: boolean;
  finalUrl?: string;
  numSteps: number;
  numLlmCalls: number;
  numLoopDetected: number;
  numLoopBroken: number;
  cacheHits: number;
  cacheMisses: number;
  wallTimeMs: number;
  actions?: string[];
}

interface EvalDatasetRow {
  id: string;
  taskId: string;
  intent: string;
  startUrl: string;
  expectedUrl?: string;
  maxSteps: number;
}

// ============================================================
// WEAVE EVALUATION RUNNER
// ============================================================

/**
 * Create a Weave Evaluation from past runs
 * This allows you to evaluate the agent on historical data
 */
export async function createWeaveEvaluation(options: {
  taskId?: string;
  limit?: number;
  includeOnlyCompleted?: boolean;
}): Promise<weave.Evaluation<EvalDatasetRow, EvalDatasetRow, RunResult>> {
  const { taskId, limit = 20, includeOnlyCompleted = true } = options;
  
  // Build dataset from past runs
  const runIds = await getRecentRunIds(limit * 2);
  const datasetRows: EvalDatasetRow[] = [];
  
  for (const runId of runIds) {
    if (datasetRows.length >= limit) break;
    
    const run = await getRun(runId);
    if (!run) continue;
    if (taskId && run.task_id !== taskId) continue;
    if (includeOnlyCompleted && run.status !== "finished" && run.status !== "failed") continue;
    
    const task = getTask(run.task_id);
    if (!task) continue;
    
    datasetRows.push({
      id: runId,
      taskId: run.task_id,
      intent: task.intent,
      startUrl: task.start_url,
      expectedUrl: task.success_condition.url_contains,
      maxSteps: task.max_steps,
    });
  }
  
  if (datasetRows.length === 0) {
    throw new Error("No completed runs found for evaluation");
  }
  
  // Create the dataset
  const dataset = new weave.Dataset({ rows: datasetRows });
  
  // Create the evaluation with all scorers
  const evaluation = new weave.Evaluation({
    dataset,
    scorers: [
      taskSuccessScorer,
      efficiencyScorer,
      loopDetectionScorer,
      cacheUtilizationScorer,
      llmJudgeScorer,
    ],
  });
  
  return evaluation;
}

/**
 * Run evaluation on a specific run
 */
export async function evaluateRun(runId: string): Promise<RunResult> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  
  const events = await getRunEvents(runId);
  const parsedEvents = events.map(e => {
    try { return JSON.parse(e) as StepEvent; } catch { return null; }
  }).filter(Boolean) as StepEvent[];
  
  // Extract actions from events
  const actions = parsedEvents
    .filter(e => e.type === "step_planned")
    .map(e => (e.payload as { action?: string })?.action || "")
    .filter(Boolean);
  
  return {
    runId: run.run_id,
    taskId: run.task_id,
    mode: run.mode,
    success: run.metrics?.success ?? false,
    finalUrl: run.metrics?.final_url,
    numSteps: run.metrics?.num_steps ?? 0,
    numLlmCalls: run.metrics?.num_llm_calls ?? 0,
    numLoopDetected: run.metrics?.num_loop_detected ?? 0,
    numLoopBroken: run.metrics?.num_loop_broken ?? 0,
    cacheHits: run.metrics?.cache_hits ?? 0,
    cacheMisses: run.metrics?.cache_misses ?? 0,
    wallTimeMs: run.metrics?.wall_time_ms ?? 0,
    actions,
  };
}

/**
 * Run a full Weave evaluation with all scorers
 * Results will appear in the Weave Evaluations UI
 */
export async function runWeaveEvaluation(options: {
  taskId?: string;
  limit?: number;
}): Promise<{
  evaluationId: string;
  results: Array<{
    runId: string;
    scores: Record<string, unknown>;
  }>;
}> {
  const evaluation = await createWeaveEvaluation(options);
  
  // The model function that returns the run result
  const model = weave.op(
    async ({ datasetRow }: { datasetRow: EvalDatasetRow }) => {
      return evaluateRun(datasetRow.id);
    },
    { name: "browserAgentModel" }
  );
  
  // Run the evaluation
  const results = await evaluation.evaluate({ model });
  
  return {
    evaluationId: `eval-${Date.now()}`,
    results: results as Array<{ runId: string; scores: Record<string, unknown> }>,
  };
}

/**
 * Score a single run with all Weave scorers
 * This is useful for real-time evaluation after a run completes
 */
export async function scoreRunWithWeave(runId: string): Promise<{
  runId: string;
  scores: {
    taskSuccess: { passed: boolean; score: number };
    efficiency: { passed: boolean; score: number; numSteps: number; numLlmCalls: number };
    loopDetection: { passed: boolean; score: number; loopsDetected: number };
    cacheUtilization: { passed: boolean; score: number; cacheHitRate: number };
    llmJudge: { passed: boolean; score: number; reason?: string };
  };
  overallScore: number;
  passed: boolean;
}> {
  const runResult = await evaluateRun(runId);
  const run = await getRun(runId);
  const task = run ? getTask(run.task_id) : null;
  
  const datasetRow: EvalDatasetRow = {
    id: runId,
    taskId: run?.task_id || "",
    intent: task?.intent || "",
    startUrl: task?.start_url || "",
    expectedUrl: task?.success_condition.url_contains,
    maxSteps: task?.max_steps || 20,
  };
  
  // Run all scorers
  const [taskSuccess, efficiency, loopDetection, cacheUtilization, llmJudge] = await Promise.all([
    taskSuccessScorer({ modelOutput: runResult, datasetRow }),
    efficiencyScorer({ modelOutput: runResult, datasetRow }),
    loopDetectionScorer({ modelOutput: runResult }),
    cacheUtilizationScorer({ modelOutput: runResult }),
    llmJudgeScorer({ modelOutput: runResult, datasetRow }),
  ]);
  
  // Calculate overall score (weighted average)
  const overallScore = 
    (taskSuccess.score as number) * 0.4 +
    (efficiency.score as number) * 0.2 +
    (loopDetection.score as number) * 0.15 +
    (cacheUtilization.score as number) * 0.1 +
    (llmJudge.score as number) * 0.15;
  
  const passed = 
    taskSuccess.passed &&
    efficiency.passed &&
    loopDetection.passed &&
    (llmJudge.passed ?? true);
  
  return {
    runId,
    scores: {
      taskSuccess: taskSuccess as { passed: boolean; score: number },
      efficiency: efficiency as { passed: boolean; score: number; numSteps: number; numLlmCalls: number },
      loopDetection: loopDetection as { passed: boolean; score: number; loopsDetected: number },
      cacheUtilization: cacheUtilization as { passed: boolean; score: number; cacheHitRate: number },
      llmJudge: llmJudge as { passed: boolean; score: number; reason?: string },
    },
    overallScore,
    passed,
  };
}

export default {
  taskSuccessScorer,
  efficiencyScorer,
  loopDetectionScorer,
  cacheUtilizationScorer,
  llmJudgeScorer,
  createWeaveEvaluation,
  evaluateRun,
  runWeaveEvaluation,
  scoreRunWithWeave,
};
