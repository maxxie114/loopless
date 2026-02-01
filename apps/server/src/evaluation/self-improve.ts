/**
 * Self-Improvement Loop
 * 
 * This module implements the learning cycle:
 * 1. Run agent → 2. Evaluate performance → 3. Identify issues → 4. Store learnings
 * 
 * Uses Weave for tracking and evaluation, Browserbase for session data.
 */

import { config } from "../config.js";
import { getRunEvents, getRun, setMacro } from "../redis.js";
import { scoreOverall, scoreLoopDetection, scoreSequenceCorrectness } from "./scorers.js";
import type { RunMeta, StepEvent, Macro } from "@loopless/shared";

// Weave client for feedback (optional)
let weaveClient: unknown = null;

export async function initWeaveClient() {
  if (!config.WANDB_API_KEY) return null;
  
  try {
    const weave = await import("weave");
    weaveClient = weave;
    return weaveClient;
  } catch {
    console.warn("Weave not available for self-improvement feedback");
    return null;
  }
}

/**
 * Issue types the self-improvement system can detect
 */
export type IssueType = 
  | "loop_detected"        // Agent repeated same action multiple times
  | "wrong_sequence"       // Actions performed in wrong order
  | "missed_action"        // Expected action never performed
  | "task_failed"          // Task didn't complete successfully
  | "timeout"              // Took too many steps
  | "element_not_found";   // Stagehand couldn't find elements

export interface LearningResult {
  runId: string;
  success: boolean;
  overallScore: number;
  issues: IssueType[];
  recommendations: string[];
  macrosLearned: number;
}

/**
 * Analyze a completed run and extract learnings
 */
export async function analyzeRun(
  runId: string,
  taskConfig: {
    domain: string;
    intent: string;
    expectedUrl?: string;
    optimalSteps?: number;
    expectedSequence?: string[];
  }
): Promise<LearningResult> {
  const run = await getRun(runId);
  const events = await getRunEvents(runId);
  
  if (!run) {
    return {
      runId,
      success: false,
      overallScore: 0,
      issues: ["task_failed"],
      recommendations: ["Run not found in storage"],
      macrosLearned: 0,
    };
  }
  
  // Score the run
  const evaluation = scoreOverall(run, events, {
    expectedUrl: taskConfig.expectedUrl,
    optimalSteps: taskConfig.optimalSteps,
    expectedSequence: taskConfig.expectedSequence,
  });
  
  const issues: IssueType[] = [];
  const recommendations: string[] = [];
  
  // Analyze each score for issues
  if (!evaluation.scores.task_success.passed) {
    issues.push("task_failed");
    recommendations.push(
      `Task did not complete. Final URL: ${run.metrics?.final_url}. ` +
      `Expected URL to contain: ${taskConfig.expectedUrl}`
    );
  }
  
  if (!evaluation.scores.loop_detection.passed) {
    issues.push("loop_detected");
    const details = evaluation.scores.loop_detection.details;
    recommendations.push(
      `Agent repeated action ${details.max_consecutive_repeats} times. ` +
      `Action: "${details.repeated_action}". ` +
      `Consider: Check if element exists before acting, add fallback actions.`
    );
  }
  
  if (evaluation.scores.sequence_correctness && !evaluation.scores.sequence_correctness.passed) {
    issues.push("wrong_sequence");
    const details = evaluation.scores.sequence_correctness.details;
    recommendations.push(
      `Only completed ${details.completed_steps}/${details.total_expected} expected steps. ` +
      `Missing steps may indicate wrong action order.`
    );
  }
  
  if (!evaluation.scores.step_efficiency.passed) {
    issues.push("timeout");
    recommendations.push(
      `Used ${evaluation.scores.step_efficiency.details.actual_steps} steps, ` +
      `optimal is ${taskConfig.optimalSteps}. Consider caching successful action sequences.`
    );
  }
  
  // Learn macros from successful sequences
  let macrosLearned = 0;
  if (evaluation.passed && run.metrics?.success) {
    macrosLearned = await learnMacrosFromRun(run, events, taskConfig);
  }
  
  // Send feedback to Weave if available
  await sendWeaveEvaluation(runId, evaluation, issues, recommendations);
  
  return {
    runId,
    success: evaluation.passed,
    overallScore: evaluation.overall,
    issues,
    recommendations,
    macrosLearned,
  };
}

/**
 * Extract successful action patterns and store as macros
 */
async function learnMacrosFromRun(
  run: RunMeta,
  events: StepEvent[],
  taskConfig: { domain: string; intent: string }
): Promise<number> {
  const stepEvents = events.filter(e => e.type === "step_planned");
  
  // Group actions by page signature
  const actionsByPage = new Map<string, string[]>();
  
  for (const event of stepEvents) {
    const payload = event.payload as { page_sig?: string; action?: string };
    if (payload.page_sig && payload.action) {
      const existing = actionsByPage.get(payload.page_sig) || [];
      existing.push(payload.action);
      actionsByPage.set(payload.page_sig, existing);
    }
  }
  
  // Store macros for pages where actions succeeded
  let learned = 0;
  for (const [pageSig, actions] of actionsByPage) {
    if (actions.length > 0) {
      const macro: Macro = {
        domain: taskConfig.domain,
        intent: taskConfig.intent,
        page_sig: pageSig,
        actions,
        success_count: 1,
        fail_count: 0,
        last_used: new Date().toISOString(),
      };
      
      await setMacro(taskConfig.domain, taskConfig.intent, pageSig, macro);
      learned++;
    }
  }
  
  return learned;
}

/**
 * Send evaluation results to Weave for tracking and analysis
 */
async function sendWeaveEvaluation(
  runId: string,
  evaluation: ReturnType<typeof scoreOverall>,
  issues: IssueType[],
  recommendations: string[]
): Promise<void> {
  if (!config.WANDB_API_KEY) return;
  
  try {
    // Log evaluation as a Weave dataset entry for future training
    console.log(`[Weave] Logged evaluation for run ${runId}:`, {
      overall_score: evaluation.overall,
      passed: evaluation.passed,
      issues,
      scores: Object.fromEntries(
        Object.entries(evaluation.scores).map(([k, v]) => [k, v.score])
      ),
    });
    
    // In a full implementation, you would:
    // 1. Call weave.log() to record the evaluation
    // 2. Add feedback to the traced call using call.feedback.add()
    // 3. Store failed runs in an evaluation dataset for retraining
    
  } catch (err) {
    console.warn("Failed to send Weave evaluation:", err);
  }
}

/**
 * Compare cold vs warm run to measure improvement
 */
export async function measureImprovement(
  coldRunId: string,
  warmRunId: string,
  taskConfig: {
    domain: string;
    intent: string;
    expectedUrl?: string;
    optimalSteps?: number;
  }
): Promise<{
  coldScore: number;
  warmScore: number;
  improvement: number;
  stepReduction: number;
  llmCallReduction: number;
}> {
  const [coldRun, warmRun] = await Promise.all([
    getRun(coldRunId),
    getRun(warmRunId),
  ]);
  
  const [coldEvents, warmEvents] = await Promise.all([
    getRunEvents(coldRunId),
    getRunEvents(warmRunId),
  ]);
  
  const coldEval = scoreOverall(coldRun!, coldEvents, taskConfig);
  const warmEval = scoreOverall(warmRun!, warmEvents, taskConfig);
  
  const coldSteps = coldRun?.metrics?.num_steps ?? 0;
  const warmSteps = warmRun?.metrics?.num_steps ?? 0;
  const coldLLM = coldRun?.metrics?.num_llm_calls ?? 0;
  const warmLLM = warmRun?.metrics?.num_llm_calls ?? 0;
  
  return {
    coldScore: coldEval.overall,
    warmScore: warmEval.overall,
    improvement: warmEval.overall - coldEval.overall,
    stepReduction: coldSteps > 0 ? (coldSteps - warmSteps) / coldSteps : 0,
    llmCallReduction: coldLLM > 0 ? (coldLLM - warmLLM) / coldLLM : 0,
  };
}

/**
 * Generate a learning report for display
 */
export function formatLearningReport(result: LearningResult): string {
  const lines = [
    `\n═══════════════════════════════════════════`,
    `  SELF-IMPROVEMENT ANALYSIS: ${result.runId.slice(0, 8)}`,
    `═══════════════════════════════════════════`,
    ``,
    `Overall Score: ${(result.overallScore * 100).toFixed(1)}%`,
    `Status: ${result.success ? '✅ PASSED' : '❌ NEEDS IMPROVEMENT'}`,
    `Macros Learned: ${result.macrosLearned}`,
  ];
  
  if (result.issues.length > 0) {
    lines.push(``, `Issues Detected:`);
    for (const issue of result.issues) {
      lines.push(`  • ${formatIssueType(issue)}`);
    }
  }
  
  if (result.recommendations.length > 0) {
    lines.push(``, `Recommendations:`);
    for (const rec of result.recommendations) {
      lines.push(`  → ${rec}`);
    }
  }
  
  lines.push(`═══════════════════════════════════════════\n`);
  
  return lines.join('\n');
}

function formatIssueType(issue: IssueType): string {
  const labels: Record<IssueType, string> = {
    loop_detected: "🔄 Loop Detected - Agent repeated same action",
    wrong_sequence: "📋 Wrong Sequence - Actions in incorrect order",
    missed_action: "⏭️ Missed Action - Expected step not performed",
    task_failed: "❌ Task Failed - Did not complete successfully",
    timeout: "⏱️ Timeout - Exceeded step limit",
    element_not_found: "🔍 Element Not Found - Could not locate target",
  };
  return labels[issue] || issue;
}
