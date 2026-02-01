/**
 * LLM-as-a-Judge Evaluator
 * 
 * Based on AGI Benchmark patterns, this module uses an LLM to evaluate:
 * 1. Task completion success
 * 2. Action sequence correctness
 * 3. State changes validation
 * 
 * The feedback is logged to Weave and used for self-improvement.
 */

import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";
import type { RunMeta, StepEvent } from "@loopless/shared";
import { logSelfImprovementToWeave } from "../weave.js";

// Initialize LLM clients
const openai = config.OPENAI_API_KEY ? new OpenAI({ apiKey: config.OPENAI_API_KEY }) : null;
const gemini = config.GOOGLE_API_KEY ? new GoogleGenerativeAI(config.GOOGLE_API_KEY) : null;

export interface LLMJudgeResult {
  passed: boolean;
  verdict: "YES" | "NO";
  reason: string;
  score: number;
  details: {
    taskCompletion: JudgeScore;
    actionCorrectness: JudgeScore;
    stateValidation: JudgeScore;
  };
}

interface JudgeScore {
  passed: boolean;
  score: number;
  feedback: string;
}

/**
 * Run LLM-as-a-judge evaluation on a completed run
 * Similar to AGI bench's eval_llm_yesno and eval_llm_response
 */
export async function evaluateWithLLMJudge(
  run: RunMeta,
  events: StepEvent[],
  taskConfig: {
    intent: string;
    expectedUrl?: string;
    expectedSequence?: string[];
    successCriteria?: string;
  }
): Promise<LLMJudgeResult> {
  // 1. Evaluate task completion
  const taskCompletion = await judgeTaskCompletion(run, taskConfig);
  
  // 2. Evaluate action sequence
  const actionCorrectness = await judgeActionSequence(events, taskConfig);
  
  // 3. Evaluate final state
  const stateValidation = await judgeStateValidation(run, taskConfig);
  
  // Calculate overall score
  const totalScore = (
    taskCompletion.score * 0.5 +
    actionCorrectness.score * 0.3 +
    stateValidation.score * 0.2
  );
  
  const passed = totalScore >= 0.6 && taskCompletion.passed;
  
  const result: LLMJudgeResult = {
    passed,
    verdict: passed ? "YES" : "NO",
    reason: generateOverallFeedback(taskCompletion, actionCorrectness, stateValidation),
    score: totalScore,
    details: {
      taskCompletion,
      actionCorrectness,
      stateValidation,
    },
  };
  
  // Log to Weave for tracking
  await logLLMJudgeResult(run.run_id, run.task_id, result);
  
  return result;
}

/**
 * Judge task completion using LLM
 * Based on AGI bench eval_llm_response pattern
 */
async function judgeTaskCompletion(
  run: RunMeta,
  taskConfig: { intent: string; expectedUrl?: string; successCriteria?: string }
): Promise<JudgeScore> {
  const prompt = `You are evaluating if a browser automation agent completed a task successfully.

TASK INTENT: ${taskConfig.intent}
${taskConfig.successCriteria ? `SUCCESS CRITERIA: ${taskConfig.successCriteria}` : ""}
${taskConfig.expectedUrl ? `EXPECTED FINAL URL: Should contain "${taskConfig.expectedUrl}"` : ""}

AGENT RESULT:
- Status: ${run.status}
- Final URL: ${run.metrics?.final_url || "unknown"}
- Success flag: ${run.metrics?.success}
- Steps taken: ${run.metrics?.num_steps}

Be lenient - say YES if the agent made significant progress toward the goal, even if not perfect.
Only say NO if the agent clearly failed or didn't attempt the main task.

Respond with ONLY 'YES' or 'NO' followed by a brief explanation (max 2 sentences).`;

  const verdict = await callLLMJudge(prompt);
  const passed = verdict.toUpperCase().startsWith("YES");
  
  return {
    passed,
    score: passed ? 1.0 : (verdict.toLowerCase().includes("partial") ? 0.5 : 0),
    feedback: verdict,
  };
}

/**
 * Judge action sequence correctness
 */
async function judgeActionSequence(
  events: StepEvent[],
  taskConfig: { expectedSequence?: string[]; intent: string }
): Promise<JudgeScore> {
  const actions = events
    .filter(e => e.type === "step_planned")
    .map(e => (e.payload as { action?: string })?.action || "")
    .filter(Boolean);
  
  if (actions.length === 0) {
    return {
      passed: false,
      score: 0,
      feedback: "No actions were performed",
    };
  }
  
  // Check for loops (same action repeated 3+ times)
  let maxRepeats = 1;
  let currentRepeats = 1;
  let repeatedAction = "";
  
  for (let i = 1; i < actions.length; i++) {
    if (actions[i] === actions[i - 1]) {
      currentRepeats++;
      if (currentRepeats > maxRepeats) {
        maxRepeats = currentRepeats;
        repeatedAction = actions[i];
      }
    } else {
      currentRepeats = 1;
    }
  }
  
  if (maxRepeats >= 3) {
    return {
      passed: false,
      score: 0.3,
      feedback: `Agent got stuck in a loop, repeating "${repeatedAction.slice(0, 50)}" ${maxRepeats} times`,
    };
  }
  
  // If expected sequence provided, check ordering
  if (taskConfig.expectedSequence && taskConfig.expectedSequence.length > 0) {
    const matchedSteps = taskConfig.expectedSequence.filter(expected =>
      actions.some(action => action.toLowerCase().includes(expected.toLowerCase()))
    );
    
    const coverage = matchedSteps.length / taskConfig.expectedSequence.length;
    
    return {
      passed: coverage >= 0.7,
      score: coverage,
      feedback: `Completed ${matchedSteps.length}/${taskConfig.expectedSequence.length} expected steps`,
    };
  }
  
  // Use LLM to judge sequence logic
  const prompt = `You are evaluating if a browser automation agent's actions were logical and efficient.

TASK: ${taskConfig.intent}

ACTIONS TAKEN (in order):
${actions.slice(0, 20).map((a, i) => `${i + 1}. ${a}`).join("\n")}
${actions.length > 20 ? `... and ${actions.length - 20} more actions` : ""}

Evaluate:
1. Were the actions in a logical order?
2. Were there unnecessary repeated actions?
3. Did the agent stay focused on the task?

Respond with ONLY 'YES' or 'NO' followed by a brief explanation.`;

  const verdict = await callLLMJudge(prompt);
  const passed = verdict.toUpperCase().startsWith("YES");
  
  return {
    passed,
    score: passed ? 0.9 : 0.4,
    feedback: verdict,
  };
}

/**
 * Judge final state validation
 */
async function judgeStateValidation(
  run: RunMeta,
  taskConfig: { expectedUrl?: string }
): Promise<JudgeScore> {
  const finalUrl = run.metrics?.final_url || "";
  
  // Check URL match if expected
  if (taskConfig.expectedUrl) {
    const urlMatch = finalUrl.toLowerCase().includes(taskConfig.expectedUrl.toLowerCase());
    return {
      passed: urlMatch,
      score: urlMatch ? 1.0 : 0.2,
      feedback: urlMatch 
        ? `Final URL "${finalUrl}" matches expected pattern`
        : `Final URL "${finalUrl}" does not contain "${taskConfig.expectedUrl}"`,
    };
  }
  
  // Basic state validation
  const success = run.metrics?.success ?? false;
  return {
    passed: success,
    score: success ? 1.0 : 0,
    feedback: success ? "Run marked as successful" : "Run did not complete successfully",
  };
}

/**
 * Call LLM for judgment (supports OpenAI and Gemini)
 */
async function callLLMJudge(prompt: string): Promise<string> {
  try {
    // Try OpenAI first
    if (openai) {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
        max_tokens: 200,
      });
      return response.choices[0]?.message?.content?.trim() || "NO - Failed to get response";
    }
    
    // Fall back to Gemini
    if (gemini) {
      const model = gemini.getGenerativeModel({ model: "gemini-1.5-flash" });
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    }
    
    return "NO - No LLM provider available";
  } catch (err) {
    console.warn("[LLMJudge] Error calling LLM:", err);
    return `NO - LLM error: ${(err as Error).message}`;
  }
}

/**
 * Generate overall feedback from all judgments
 */
function generateOverallFeedback(
  taskCompletion: JudgeScore,
  actionCorrectness: JudgeScore,
  stateValidation: JudgeScore
): string {
  const parts: string[] = [];
  
  if (!taskCompletion.passed) {
    parts.push(`Task completion: ${taskCompletion.feedback}`);
  }
  if (!actionCorrectness.passed) {
    parts.push(`Action sequence: ${actionCorrectness.feedback}`);
  }
  if (!stateValidation.passed) {
    parts.push(`Final state: ${stateValidation.feedback}`);
  }
  
  if (parts.length === 0) {
    return "All evaluations passed. Agent performed well.";
  }
  
  return parts.join(". ");
}

/**
 * Log LLM judge result to Weave
 */
async function logLLMJudgeResult(
  runId: string,
  taskId: string,
  result: LLMJudgeResult
): Promise<void> {
  try {
    await logSelfImprovementToWeave({
      type: "failure_pattern_detected",
      details: {
        evaluation_type: "llm_judge",
        run_id: runId,
        task_id: taskId,
        passed: result.passed,
        verdict: result.verdict,
        score: result.score,
        reason: result.reason,
        task_completion: result.details.taskCompletion.score,
        action_correctness: result.details.actionCorrectness.score,
        state_validation: result.details.stateValidation.score,
      },
    });
  } catch (err) {
    console.warn("[LLMJudge] Failed to log to Weave:", err);
  }
}

/**
 * Quick LLM judge for simple yes/no evaluation
 * Similar to AGI bench eval_llm_yesno
 */
export async function quickLLMJudge(question: string, context: string): Promise<{
  passed: boolean;
  verdict: string;
}> {
  const prompt = `${question}

Context:
${context}

Be lenient - say YES if the answer approximately satisfies the criterion.
Only say NO if it clearly does not meet the criterion.

Respond with ONLY 'YES' or 'NO' followed by a brief explanation.`;

  const verdict = await callLLMJudge(prompt);
  return {
    passed: verdict.toUpperCase().startsWith("YES"),
    verdict,
  };
}

/**
 * Evaluate if agent response matches expected answer
 * Based on AGI bench eval_llm_response
 */
export async function judgeAgentResponse(
  agentResponse: string,
  expectedCriterion: string
): Promise<{ passed: boolean; verdict: string }> {
  if (!agentResponse) {
    return { passed: false, verdict: "NO - no agent response provided" };
  }

  const prompt = `Does the actual answer approximately satisfy the expected criterion?

Be extremely lenient, say NO only if the actual answer is clearly not related to the expected criterion.

Expected criterion: ${expectedCriterion}
Actual answer: ${agentResponse}

Respond with ONLY 'YES' or 'NO' followed by a brief explanation.`;

  const verdict = await callLLMJudge(prompt);
  return {
    passed: verdict.toUpperCase().startsWith("YES"),
    verdict,
  };
}
