/**
 * Self-Improvement Loop with Weave Integration
 * 
 * This module implements the learning cycle:
 * 1. Run agent → 2. Evaluate with LLM Judge → 3. Pull feedback from Weave → 4. Improve prompts
 * 
 * KEY FEATURES:
 * - Queries Weave API directly to get past evaluations
 * - Uses LLM-as-a-judge for intelligent evaluation
 * - Feeds feedback back to the LLM to improve future runs
 * 
 * Uses Weave for tracking and evaluation, Redis for macro storage.
 */

import { config } from "../config.js";
import { getRunEvents, getRun, setMacro, getRedis } from "../redis.js";
import { scoreOverall } from "./scorers.js";
import { logEvaluationToWeave, logSelfImprovementToWeave } from "../weave.js";
import { getWeaveClient, type FailureAnalysis } from "./weave-client.js";
import { evaluateWithLLMJudge, type LLMJudgeResult } from "./llm-judge.js";
import type { RunMeta, StepEvent } from "@loopless/shared";

/**
 * Helper: Parse raw event strings into StepEvent objects
 */
function parseEvents(rawEvents: string[]): StepEvent[] {
  return rawEvents
    .map(e => {
      try {
        return JSON.parse(e) as StepEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is StepEvent => e !== null);
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
  | "checkout_not_clicked" // Specifically for checkout issues
  | "form_not_filled"      // Form fields not completed
  | "element_not_found";   // Stagehand couldn't find elements

export interface LearningResult {
  runId: string;
  success: boolean;
  overallScore: number;
  issues: IssueType[];
  recommendations: string[];
  macrosLearned: number;
  llmJudgeResult?: LLMJudgeResult;
}

// ===============================================================
// WEAVE FEEDBACK - Pull directly from Weave API
// ===============================================================

// Cache for Weave feedback to avoid excessive API calls
const feedbackCache = new Map<string, FailureAnalysis>();
let lastFeedbackFetch = 0;
const FEEDBACK_CACHE_TTL = 60000; // 60 seconds (increased since we're hitting API)

/**
 * Fetch feedback DIRECTLY from Weave API
 * This is the key function that enables true self-improvement
 */
export async function fetchWeaveFeedback(taskId?: string): Promise<FailureAnalysis | null> {
  // Check cache
  const cacheKey = taskId || "all";
  if (Date.now() - lastFeedbackFetch < FEEDBACK_CACHE_TTL) {
    const cached = feedbackCache.get(cacheKey);
    if (cached) return cached;
  }

  try {
    const weaveClient = getWeaveClient();
    const analysis = await weaveClient.getFailureAnalysis(taskId);
    
    // Cache the result
    feedbackCache.set(cacheKey, analysis);
    lastFeedbackFetch = Date.now();
    
    console.log(`[Weave] Fetched failure analysis for ${taskId || "all tasks"}:`, {
      totalRuns: analysis.totalRuns,
      failedRuns: analysis.failedRuns,
      successRate: `${(analysis.successRate * 100).toFixed(1)}%`,
      commonIssues: analysis.commonIssues.length,
      llmFeedback: analysis.llmJudgeFeedback.length,
    });
    
    return analysis;
  } catch (err) {
    console.warn("[Weave] Failed to fetch feedback:", err);
    
    // Fall back to Redis if Weave API fails
    return fallbackToRedisFeedback(taskId);
  }
}

/**
 * Fallback: Get feedback from Redis if Weave API is unavailable
 */
async function fallbackToRedisFeedback(taskId?: string): Promise<FailureAnalysis | null> {
  const redis = await getRedis();
  if (!redis) return null;

  try {
    const failures = await redis.lRange(
      `${config.REDIS_PREFIX}:eval:failure`,
      0,
      49
    );

    const issues = new Map<string, { count: number; examples: string[] }>();
    const recommendations: string[] = [];
    let failureCount = 0;

    for (const f of failures) {
      try {
        const data = JSON.parse(f) as {
          task_id: string;
          issues: string[];
          recommendations: string[];
        };

        if (taskId && data.task_id !== taskId) continue;
        
        failureCount++;
        
        for (const issue of data.issues) {
          const existing = issues.get(issue) || { count: 0, examples: [] };
          existing.count++;
          issues.set(issue, existing);
        }
        
        for (const rec of data.recommendations.slice(0, 2)) {
          if (!recommendations.includes(rec)) {
            recommendations.push(rec);
          }
        }
      } catch {
        // Skip invalid entries
      }
    }

    return {
      taskId: taskId || "all",
      totalRuns: failureCount, // Approximate
      failedRuns: failureCount,
      successRate: 0, // Unknown without success count
      commonIssues: Array.from(issues.entries())
        .map(([issue, data]) => ({ issue, ...data }))
        .sort((a, b) => b.count - a.count),
      recommendations: recommendations.slice(0, 5),
      llmJudgeFeedback: [],
    };
  } catch (err) {
    console.warn("[Redis] Failed to fetch feedback:", err);
    return null;
  }
}

/**
 * Generate improved system prompt by incorporating Weave feedback
 * This is THE KEY function for self-improvement
 */
export async function generateImprovedPromptFromWeave(
  basePrompt: string,
  taskId: string
): Promise<string> {
  const feedback = await fetchWeaveFeedback(taskId);

  if (!feedback || feedback.failedRuns === 0) {
    return basePrompt;
  }

  // Build improvement rules from Weave feedback
  const rules: string[] = [
    "",
    "═══════════════════════════════════════════",
    "🧠 LEARNED FROM PAST RUNS (via Weave)",
    "═══════════════════════════════════════════",
  ];

  // Add stats
  rules.push(`📊 Past Performance: ${feedback.failedRuns} failures out of ${feedback.totalRuns} runs (${(feedback.successRate * 100).toFixed(0)}% success rate)`);
  rules.push("");

  // Add specific rules based on common issues detected by Weave
  if (feedback.commonIssues.length > 0) {
    rules.push("⚠️ CRITICAL ISSUES TO AVOID:");
    
    for (const { issue, count } of feedback.commonIssues.slice(0, 5)) {
      switch (issue) {
        case "task_failed":
          rules.push(`  • Task Incomplete (${count}x): Make sure to complete ALL steps including final confirmation`);
          break;
        case "loop_detected":
          rules.push(`  • Loop Detected (${count}x): If an action fails, try a DIFFERENT approach immediately`);
          break;
        case "wrong_sequence":
          rules.push(`  • Wrong Order (${count}x): Follow steps in the correct sequence`);
          break;
        case "timeout":
          rules.push(`  • Timeout (${count}x): Be efficient - take the shortest path`);
          break;
        case "checkout_not_clicked":
          rules.push(`  • Checkout Skipped (${count}x): After adding items, MUST click cart → checkout → fill form → finish`);
          break;
        case "form_not_filled":
          rules.push(`  • Form Incomplete (${count}x): Fill ALL required form fields before submitting`);
          break;
        case "element_not_found":
          rules.push(`  • Element Missing (${count}x): Wait for page load, scroll if needed, use alternative selectors`);
          break;
        default:
          rules.push(`  • ${issue} (${count}x)`);
      }
    }
    rules.push("");
  }

  // Add LLM Judge feedback (the most valuable insights!)
  if (feedback.llmJudgeFeedback.length > 0) {
    rules.push("🤖 LLM JUDGE FEEDBACK:");
    
    // Get the most recent failures with reasons
    const recentFailures = feedback.llmJudgeFeedback
      .filter(f => !f.passed)
      .slice(0, 3);
    
    for (const f of recentFailures) {
      if (f.reason) {
        // Clean up and truncate the reason
        const cleanReason = f.reason
          .replace(/^(NO|YES)\s*[-:]\s*/i, "")
          .slice(0, 150);
        rules.push(`  → ${cleanReason}`);
      }
    }
    rules.push("");
  }

  // Add specific recommendations
  if (feedback.recommendations.length > 0) {
    rules.push("📋 SPECIFIC RECOMMENDATIONS:");
    for (const rec of feedback.recommendations.slice(0, 4)) {
      // Extract actionable advice and truncate
      const cleanRec = rec.slice(0, 120);
      rules.push(`  → ${cleanRec}`);
    }
    rules.push("");
  }

  rules.push("═══════════════════════════════════════════");
  rules.push("");

  // Log that we're using improved prompt
  console.log(`[Self-Improve] ✅ Injecting ${rules.length} learned rules for task ${taskId}`);
  
  await logSelfImprovementToWeave({
    type: "prompt_improved",
    details: {
      task_id: taskId,
      failure_count: feedback.failedRuns,
      success_rate: feedback.successRate,
      rules_added: rules.length,
      common_issues: feedback.commonIssues.map(i => i.issue),
      llm_feedback_count: feedback.llmJudgeFeedback.length,
    },
  });

  return basePrompt + rules.join("\n");
}

/**
 * Get failure patterns from past evaluations (uses Weave API)
 */
export async function getFailurePatterns(): Promise<{
  issue: IssueType;
  count: number;
  examples: string[];
}[]> {
  const feedback = await fetchWeaveFeedback();
  
  if (!feedback) return [];
  
  return feedback.commonIssues.map(({ issue, count, examples }) => ({
    issue: issue as IssueType,
    count,
    examples,
  }));
}

/**
 * Generate an improved system prompt based on failure patterns (legacy)
 */
export async function generateImprovedPrompt(
  currentPrompt: string,
  failurePatterns: Awaited<ReturnType<typeof getFailurePatterns>>
): Promise<string> {
  if (failurePatterns.length === 0) return currentPrompt;
  
  const additionalRules: string[] = [];
  
  for (const pattern of failurePatterns) {
    switch (pattern.issue) {
      case "loop_detected":
        additionalRules.push(
          "- If an action fails, try a DIFFERENT approach instead of repeating"
        );
        break;
      case "wrong_sequence":
        additionalRules.push(
          "- Follow the logical order: read page → fill forms → click submit"
        );
        break;
      case "element_not_found":
        additionalRules.push(
          "- If element not found, wait or look for alternative selectors"
        );
        break;
      case "task_failed":
        additionalRules.push(
          "- Make sure to complete ALL steps including checkout and finish"
        );
        break;
    }
  }
  
  if (additionalRules.length > 0) {
    await logSelfImprovementToWeave({
      type: "prompt_improved",
      details: {
        failure_patterns: failurePatterns.map(p => ({
          issue: p.issue,
          count: p.count,
        })),
        patterns_used: failurePatterns.length,
      },
    });
    
    return currentPrompt + "\n\nLEARNED FROM PAST FAILURES:\n" + additionalRules.join('\n');
  }
  
  return currentPrompt;
}

/**
 * Analyze a completed run and extract learnings
 * NOW INCLUDES LLM-as-a-judge evaluation!
 */
export async function analyzeRun(
  runId: string,
  taskConfig: {
    domain: string;
    intent: string;
    expectedUrl?: string;
    optimalSteps?: number;
    expectedSequence?: string[];
    successCriteria?: string;
  }
): Promise<LearningResult> {
  const run = await getRun(runId);
  const rawEvents = await getRunEvents(runId);
  const events = parseEvents(rawEvents);
  
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
  
  // ===== NEW: Run LLM-as-a-judge evaluation =====
  let llmJudgeResult: LLMJudgeResult | undefined;
  try {
    llmJudgeResult = await evaluateWithLLMJudge(run, events, {
      intent: taskConfig.intent,
      expectedUrl: taskConfig.expectedUrl,
      expectedSequence: taskConfig.expectedSequence,
      successCriteria: taskConfig.successCriteria,
    });
    
    console.log(`[LLM Judge] Result for run ${runId.slice(0, 8)}:`, {
      verdict: llmJudgeResult.verdict,
      score: llmJudgeResult.score.toFixed(2),
      reason: llmJudgeResult.reason.slice(0, 100),
    });
  } catch (err) {
    console.warn("[LLM Judge] Evaluation failed:", err);
  }
  
  // Score the run with traditional scorers
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
    
    // Check for specific checkout issues
    const hasCartItems = events.some(e => 
      String(e.payload?.action || '').toLowerCase().includes('add to cart')
    );
    const hasCheckout = events.some(e => 
      String(e.payload?.action || '').toLowerCase().includes('checkout')
    );
    
    if (hasCartItems && !hasCheckout) {
      issues.push("checkout_not_clicked");
      recommendations.push(
        "Agent added items to cart but never clicked checkout. " +
        "After adding items, must: 1) Click cart icon 2) Click Checkout 3) Fill form 4) Click Finish"
      );
    } else {
      recommendations.push(
        `Task did not complete. Final URL: ${run.metrics?.final_url}. ` +
        `Expected URL to contain: ${taskConfig.expectedUrl}`
      );
    }
  }
  
  if (!evaluation.scores.loop_detection.passed) {
    issues.push("loop_detected");
    const details = evaluation.scores.loop_detection.details;
    recommendations.push(
      `Agent repeated action ${details.max_consecutive_repeats} times. ` +
      `Action: "${details.repeated_action}". ` +
      `SOLUTION: If action fails, immediately try different element or approach.`
    );
  }
  
  if (evaluation.scores.sequence_correctness && !evaluation.scores.sequence_correctness.passed) {
    issues.push("wrong_sequence");
    const details = evaluation.scores.sequence_correctness.details;
    recommendations.push(
      `Only completed ${details.completed_steps}/${details.total_expected} expected steps. ` +
      `Missing steps may indicate wrong action order or incomplete workflow.`
    );
  }
  
  if (!evaluation.scores.step_efficiency.passed) {
    issues.push("timeout");
    recommendations.push(
      `Used ${evaluation.scores.step_efficiency.details.actual_steps} steps, ` +
      `optimal is ${taskConfig.optimalSteps}. Be more direct in completing the task.`
    );
  }
  
  // Add LLM judge recommendations
  if (llmJudgeResult && !llmJudgeResult.passed && llmJudgeResult.reason) {
    recommendations.push(`LLM Judge: ${llmJudgeResult.reason}`);
  }
  
  // Learn macros from successful sequences
  let macrosLearned = 0;
  const isSuccess = evaluation.passed && (llmJudgeResult?.passed ?? true);
  
  if (isSuccess && run.metrics?.success) {
    macrosLearned = await learnMacrosFromRun(run, events, taskConfig);
  }
  
  // Send feedback to Weave and Redis
  await sendWeaveEvaluation(
    runId,
    run.task_id,
    run.mode,
    evaluation,
    issues,
    recommendations,
    llmJudgeResult
  );
  
  // Combine scores
  const finalScore = llmJudgeResult
    ? (evaluation.overall * 0.6 + llmJudgeResult.score * 0.4)
    : evaluation.overall;
  
  return {
    runId,
    success: isSuccess,
    overallScore: finalScore,
    issues,
    recommendations,
    macrosLearned,
    llmJudgeResult,
  };
}

/**
 * Extract successful action patterns and store as macros
 */
async function learnMacrosFromRun(
  _run: RunMeta,
  events: StepEvent[],
  taskConfig: { domain: string; intent: string }
): Promise<number> {
  const stepEvents = events.filter(e => e.type === "step_planned");
  
  const actionsByPage = new Map<string, string[]>();
  
  for (const event of stepEvents) {
    const payload = event.payload as { page_sig?: string; action?: string };
    if (payload.page_sig && payload.action) {
      const existing = actionsByPage.get(payload.page_sig) || [];
      existing.push(payload.action);
      actionsByPage.set(payload.page_sig, existing);
    }
  }
  
  let learned = 0;
  for (const [pageSig, actions] of actionsByPage) {
    if (actions.length > 0) {
      const macro = {
        actions,
        success_count: 1,
        fail_count: 0,
        last_success_ts: Date.now(),
      };
      
      await setMacro(taskConfig.domain, taskConfig.intent, pageSig, macro);
      learned++;
    }
  }
  
  return learned;
}

/**
 * Send evaluation results to Weave and Redis for the feedback loop
 */
async function sendWeaveEvaluation(
  runId: string,
  taskId: string,
  mode: string,
  evaluation: ReturnType<typeof scoreOverall>,
  issues: IssueType[],
  recommendations: string[],
  llmJudgeResult?: LLMJudgeResult
): Promise<void> {
  const scores = Object.fromEntries(
    Object.entries(evaluation.scores).map(([k, v]) => [k, v.score])
  );
  
  // Add LLM judge score
  if (llmJudgeResult) {
    scores["llm_judge"] = llmJudgeResult.score;
    scores["llm_judge_task"] = llmJudgeResult.details.taskCompletion.score;
    scores["llm_judge_actions"] = llmJudgeResult.details.actionCorrectness.score;
    scores["llm_judge_state"] = llmJudgeResult.details.stateValidation.score;
  }
  
  const passed = evaluation.passed && (llmJudgeResult?.passed ?? true);
  
  // Log to Weave
  await logEvaluationToWeave({
    runId,
    taskId,
    mode,
    scores,
    passed,
    issues,
    recommendations,
  });
  
  // Store in Redis for the feedback loop
  const redis = await getRedis();
  if (!redis) return;
  
  try {
    const evalData = {
      run_id: runId,
      task_id: taskId,
      mode,
      overall_score: llmJudgeResult 
        ? (evaluation.overall * 0.6 + llmJudgeResult.score * 0.4)
        : evaluation.overall,
      passed,
      issues,
      recommendations,
      scores,
      llm_judge_verdict: llmJudgeResult?.verdict,
      llm_judge_reason: llmJudgeResult?.reason,
      timestamp: new Date().toISOString(),
    };
    
    console.log(`[Eval] Logged for run ${runId}:`, {
      score: evalData.overall_score.toFixed(2),
      passed: evalData.passed,
      issues,
      llmVerdict: llmJudgeResult?.verdict,
    });
    
    // Store in evaluations list
    await redis.lPush(
      `${config.REDIS_PREFIX}:evaluations`,
      JSON.stringify(evalData)
    );
    
    // Store by outcome for easy querying
    const outcomeKey = passed 
      ? `${config.REDIS_PREFIX}:eval:success`
      : `${config.REDIS_PREFIX}:eval:failure`;
    await redis.lPush(outcomeKey, JSON.stringify(evalData));
    
    // Keep only recent evaluations
    await redis.lTrim(`${config.REDIS_PREFIX}:evaluations`, 0, 99);
    await redis.lTrim(outcomeKey, 0, 49);
    
    // Clear feedback cache to force refresh from Weave
    feedbackCache.clear();
    lastFeedbackFetch = 0;
    
  } catch (err) {
    console.warn("Failed to store evaluation in Redis:", err);
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
  
  const [rawColdEvents, rawWarmEvents] = await Promise.all([
    getRunEvents(coldRunId),
    getRunEvents(warmRunId),
  ]);
  
  const coldEvents = parseEvents(rawColdEvents);
  const warmEvents = parseEvents(rawWarmEvents);
  
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
  
  // Add LLM Judge result
  if (result.llmJudgeResult) {
    lines.push(``);
    lines.push(`🤖 LLM Judge Verdict: ${result.llmJudgeResult.verdict}`);
    lines.push(`   Score: ${(result.llmJudgeResult.score * 100).toFixed(0)}%`);
    if (result.llmJudgeResult.reason) {
      lines.push(`   Reason: ${result.llmJudgeResult.reason.slice(0, 100)}`);
    }
  }
  
  if (result.issues.length > 0) {
    lines.push(``, `Issues Detected:`);
    for (const issue of result.issues) {
      lines.push(`  • ${formatIssueType(issue)}`);
    }
  }
  
  if (result.recommendations.length > 0) {
    lines.push(``, `Recommendations:`);
    for (const rec of result.recommendations) {
      lines.push(`  → ${rec.slice(0, 100)}`);
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
    checkout_not_clicked: "🛒 Checkout Not Clicked - Added to cart but didn't checkout",
    form_not_filled: "📝 Form Not Filled - Required fields missing",
    element_not_found: "🔍 Element Not Found - Could not locate target",
  };
  return labels[issue] || issue;
}

/**
 * Clear feedback cache to force fresh fetch from Weave
 */
export function clearFeedbackCache(): void {
  feedbackCache.clear();
  lastFeedbackFetch = 0;
  console.log("[Self-Improve] Feedback cache cleared");
}
