/**
 * Auto-Improvement Runner
 * 
 * This module implements the automatic self-improvement loop:
 * 1. Run task (cold)
 * 2. Evaluate with Weave scorers
 * 3. If failed, learn from failure and retry (warm)
 * 4. Repeat until success or max attempts
 * 
 * The UI can stream progress in real-time via SSE.
 */

import { runTask } from "./agent/runner.js";
import { analyzeRun, clearFeedbackCache } from "./evaluation/self-improve.js";
import { evaluateWithLLMJudge } from "./evaluation/llm-judge.js";
import { getRun, getRunEvents, getRedis } from "./redis.js";
import { getTask } from "./tasks.js";
import { config } from "./config.js";
import { logSelfImprovementToWeave } from "./weave.js";
import type { StepEvent } from "@loopless/shared";

export interface AutoImproveConfig {
  taskId: string;
  maxAttempts: number;
  onProgress?: (event: AutoImproveEvent) => void;
}

export interface AutoImproveEvent {
  type: 
    | "started"
    | "attempt_started"
    | "attempt_completed"
    | "evaluation_complete"
    | "learning"
    | "improvement_applied"
    | "success"
    | "max_attempts_reached"
    | "error";
  attempt: number;
  maxAttempts: number;
  data: Record<string, unknown>;
  timestamp: string;
}

export interface AutoImproveResult {
  taskId: string;
  success: boolean;
  totalAttempts: number;
  attempts: AttemptResult[];
  improvement: {
    firstScore: number;
    lastScore: number;
    scoreDelta: number;
    stepsReduction: number;
    llmCallReduction: number;
  };
  recordings: string[];
  finalRunId?: string;
}

export interface AttemptResult {
  attempt: number;
  runId: string;
  mode: "cold" | "warm";
  success: boolean;
  score: number;
  metrics: {
    steps: number;
    llmCalls: number;
    cacheHits: number;
    wallTime: number;
  };
  issues: string[];
  recommendations: string[];
  recordingUrl?: string;
  llmJudgeVerdict?: string;
}

/**
 * Run the auto-improvement loop until success or max attempts
 */
export async function runAutoImprove(cfg: AutoImproveConfig): Promise<AutoImproveResult> {
  const { taskId, maxAttempts, onProgress } = cfg;
  
  const task = getTask(taskId);
  if (!task) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const emit = (event: Omit<AutoImproveEvent, "timestamp">) => {
    const fullEvent: AutoImproveEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    onProgress?.(fullEvent);
    console.log(`[AutoImprove] ${event.type}:`, JSON.stringify(event.data).slice(0, 200));
  };

  const attempts: AttemptResult[] = [];
  const recordings: string[] = [];
  let success = false;
  let finalRunId: string | undefined;

  emit({
    type: "started",
    attempt: 0,
    maxAttempts,
    data: { taskId, taskName: task.name },
  });

  // Clear feedback cache to start fresh
  clearFeedbackCache();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // First attempt is cold (no macros), subsequent are warm (with learned macros)
    const mode = attempt === 1 ? "cold" : "warm";

    emit({
      type: "attempt_started",
      attempt,
      maxAttempts,
      data: { mode, taskId },
    });

    try {
      // Run the task
      const result = await runTask(taskId, mode, undefined, (event) => {
        // Forward agent events to progress callback
        onProgress?.({
          type: "attempt_started",
          attempt,
          maxAttempts,
          data: { agentEvent: event },
          timestamp: new Date().toISOString(),
        });
      });

      // Get full run data
      const run = await getRun(result.runId);
      const rawEvents = await getRunEvents(result.runId);
      const events = rawEvents.map(e => {
        try { return JSON.parse(e) as StepEvent; }
        catch { return null; }
      }).filter(Boolean) as StepEvent[];

      // Capture recording URL
      if (result.metrics.recording_url) {
        recordings.push(result.metrics.recording_url);
      }

      emit({
        type: "attempt_completed",
        attempt,
        maxAttempts,
        data: {
          runId: result.runId,
          success: result.metrics.success,
          steps: result.metrics.num_steps,
          recordingUrl: result.metrics.recording_url,
        },
      });

      // Evaluate with LLM Judge
      emit({
        type: "evaluation_complete",
        attempt,
        maxAttempts,
        data: { evaluating: true },
      });

      const llmJudge = await evaluateWithLLMJudge(run!, events, {
        intent: task.intent || task.description,
        expectedUrl: task.success_condition.url_contains,
        successCriteria: `Complete the task: ${task.description}`,
      });

      // Analyze run for self-improvement
      const analysis = await analyzeRun(result.runId, {
        domain: task.domain,
        intent: task.intent || task.description,
        expectedUrl: task.success_condition.url_contains,
        optimalSteps: 15,
        expectedSequence: getExpectedSequence(taskId),
        successCriteria: task.description,
      });

      // Calculate combined score
      const score = analysis.llmJudgeResult
        ? (analysis.overallScore * 0.6 + analysis.llmJudgeResult.score * 0.4)
        : analysis.overallScore;

      const attemptResult: AttemptResult = {
        attempt,
        runId: result.runId,
        mode,
        success: result.metrics.success && (llmJudge?.passed ?? true),
        score,
        metrics: {
          steps: result.metrics.num_steps,
          llmCalls: result.metrics.num_llm_calls,
          cacheHits: result.metrics.cache_hits,
          wallTime: result.metrics.wall_time_ms,
        },
        issues: analysis.issues,
        recommendations: analysis.recommendations,
        recordingUrl: result.metrics.recording_url,
        llmJudgeVerdict: llmJudge?.verdict,
      };

      attempts.push(attemptResult);

      emit({
        type: "evaluation_complete",
        attempt,
        maxAttempts,
        data: {
          score: score.toFixed(2),
          passed: attemptResult.success,
          llmVerdict: llmJudge?.verdict,
          issues: analysis.issues,
        },
      });

      // Check if we succeeded
      if (attemptResult.success) {
        success = true;
        finalRunId = result.runId;

        emit({
          type: "success",
          attempt,
          maxAttempts,
          data: {
            runId: result.runId,
            totalAttempts: attempt,
            finalScore: score,
          },
        });

        // Log success to Weave
        await logSelfImprovementToWeave({
          type: "prompt_improved",
          details: {
            event: "auto_improve_success",
            task_id: taskId,
            attempts: attempt,
            final_score: score,
          },
        });

        break;
      }

      // Learn from failure
      emit({
        type: "learning",
        attempt,
        maxAttempts,
        data: {
          issues: analysis.issues,
          recommendations: analysis.recommendations.slice(0, 2),
        },
      });

      // Clear feedback cache to force re-fetch with new failure data
      clearFeedbackCache();

      emit({
        type: "improvement_applied",
        attempt,
        maxAttempts,
        data: {
          macrosLearned: analysis.macrosLearned,
          rulesAdded: analysis.recommendations.length,
        },
      });

      // Small delay before next attempt
      await new Promise(r => setTimeout(r, 2000));

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      
      emit({
        type: "error",
        attempt,
        maxAttempts,
        data: { error },
      });

      attempts.push({
        attempt,
        runId: "",
        mode,
        success: false,
        score: 0,
        metrics: { steps: 0, llmCalls: 0, cacheHits: 0, wallTime: 0 },
        issues: ["error"],
        recommendations: [error],
      });
    }
  }

  if (!success) {
    emit({
      type: "max_attempts_reached",
      attempt: maxAttempts,
      maxAttempts,
      data: {
        totalAttempts: attempts.length,
        bestScore: Math.max(...attempts.map(a => a.score)),
      },
    });
  }

  // Calculate improvement metrics
  const firstAttempt = attempts[0];
  const lastAttempt = attempts[attempts.length - 1];
  
  const improvement = {
    firstScore: firstAttempt?.score ?? 0,
    lastScore: lastAttempt?.score ?? 0,
    scoreDelta: (lastAttempt?.score ?? 0) - (firstAttempt?.score ?? 0),
    stepsReduction: firstAttempt && lastAttempt
      ? (firstAttempt.metrics.steps - lastAttempt.metrics.steps) / Math.max(firstAttempt.metrics.steps, 1)
      : 0,
    llmCallReduction: firstAttempt && lastAttempt
      ? (firstAttempt.metrics.llmCalls - lastAttempt.metrics.llmCalls) / Math.max(firstAttempt.metrics.llmCalls, 1)
      : 0,
  };

  // Store auto-improve session in Redis
  const sessionId = `auto-${taskId}-${Date.now()}`;
  const redis = await getRedis();
  if (redis) {
    await redis.set(
      `${config.REDIS_PREFIX}:auto-improve:${sessionId}`,
      JSON.stringify({
        taskId,
        success,
        attempts,
        improvement,
        recordings,
        finalRunId,
        completedAt: new Date().toISOString(),
      }),
      { EX: 86400 * 7 } // 7 days
    );
    
    // Add to recent auto-improve sessions list
    await redis.lPush(`${config.REDIS_PREFIX}:auto-improve:recent`, sessionId);
    await redis.lTrim(`${config.REDIS_PREFIX}:auto-improve:recent`, 0, 49);
  }

  return {
    taskId,
    success,
    totalAttempts: attempts.length,
    attempts,
    improvement,
    recordings,
    finalRunId,
  };
}

/**
 * Get expected action sequence for known tasks
 */
function getExpectedSequence(taskId: string): string[] | undefined {
  const sequences: Record<string, string[]> = {
    "saucedemo-checkout": [
      "username",
      "password",
      "login",
      "add to cart",
      "cart",
      "checkout",
      "first name",
      "last name",
      "zip",
      "continue",
      "finish",
    ],
    "saucedemo-login": ["username", "password", "login"],
  };
  return sequences[taskId];
}

/**
 * Get recent auto-improve sessions from Redis
 */
export async function getRecentAutoImproveSessions(limit: number = 10): Promise<AutoImproveResult[]> {
  const redis = await getRedis();
  if (!redis) return [];

  try {
    const sessionIds = await redis.lRange(`${config.REDIS_PREFIX}:auto-improve:recent`, 0, limit - 1);
    const sessions: AutoImproveResult[] = [];

    for (const id of sessionIds) {
      const data = await redis.get(`${config.REDIS_PREFIX}:auto-improve:${id}`);
      if (data) {
        sessions.push(JSON.parse(data));
      }
    }

    return sessions;
  } catch {
    return [];
  }
}
