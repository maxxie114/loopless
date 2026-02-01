/**
 * Weave Scorers for Browser Agent Evaluation
 * 
 * These scorers evaluate agent performance and feed into the self-improvement loop.
 */

import type { RunMeta, StepEvent } from "@loopless/shared";

export interface EvalResult {
  score: number;
  passed: boolean;
  details: Record<string, unknown>;
}

/**
 * Score: Task Success
 * Did the agent complete the intended task?
 */
export function scoreTaskSuccess(
  run: RunMeta,
  expectedUrl?: string
): EvalResult {
  const success = run.metrics?.success === true;
  const urlMatch = expectedUrl 
    ? run.metrics?.final_url?.includes(expectedUrl) 
    : true;
  
  return {
    score: success && urlMatch ? 1.0 : 0.0,
    passed: success && urlMatch,
    details: {
      success,
      final_url: run.metrics?.final_url,
      expected_url: expectedUrl,
    }
  };
}

/**
 * Score: Loop Detection
 * Did the agent get stuck repeating the same action?
 * Lower is better (0 = no loops, 1 = many loops)
 */
export function scoreLoopDetection(events: StepEvent[]): EvalResult {
  const actions = events
    .filter(e => e.type === "step_planned")
    .map(e => (e.payload as { action?: string }).action);
  
  // Count consecutive repeated actions
  let maxRepeats = 1;
  let currentRepeats = 1;
  
  for (let i = 1; i < actions.length; i++) {
    if (actions[i] === actions[i - 1]) {
      currentRepeats++;
      maxRepeats = Math.max(maxRepeats, currentRepeats);
    } else {
      currentRepeats = 1;
    }
  }
  
  // Score: 1.0 if no repeats, 0.0 if 5+ consecutive repeats
  const score = Math.max(0, 1 - (maxRepeats - 1) / 4);
  
  return {
    score,
    passed: maxRepeats < 3, // Fail if 3+ consecutive repeats
    details: {
      max_consecutive_repeats: maxRepeats,
      total_actions: actions.length,
      repeated_action: maxRepeats >= 3 ? actions[actions.length - 1] : null,
    }
  };
}

/**
 * Score: Step Efficiency
 * Did the agent complete the task in a reasonable number of steps?
 */
export function scoreStepEfficiency(
  run: RunMeta,
  optimalSteps: number
): EvalResult {
  const actualSteps = run.metrics?.num_steps ?? 0;
  
  // Score based on how close to optimal
  // 1.0 = at or below optimal, decreases as steps increase
  const ratio = actualSteps / optimalSteps;
  const score = ratio <= 1 ? 1.0 : Math.max(0, 1 - (ratio - 1) / 2);
  
  return {
    score,
    passed: ratio <= 2, // Pass if within 2x optimal
    details: {
      actual_steps: actualSteps,
      optimal_steps: optimalSteps,
      efficiency_ratio: ratio,
    }
  };
}

/**
 * Score: Cache Utilization
 * Is the agent learning from previous runs?
 */
export function scoreCacheUtilization(run: RunMeta): EvalResult {
  const hits = run.metrics?.cache_hits ?? 0;
  const misses = run.metrics?.cache_misses ?? 0;
  const total = hits + misses;
  
  if (total === 0) {
    return { score: 0, passed: true, details: { cache_hit_rate: 0 } };
  }
  
  const hitRate = hits / total;
  
  return {
    score: hitRate,
    passed: true, // Cache utilization is informational
    details: {
      cache_hits: hits,
      cache_misses: misses,
      cache_hit_rate: hitRate,
    }
  };
}

/**
 * Score: Action Sequence Correctness
 * Did the agent perform actions in the right order?
 */
export function scoreSequenceCorrectness(
  events: StepEvent[],
  expectedSequence: string[]
): EvalResult {
  const actions = events
    .filter(e => e.type === "step_planned")
    .map(e => (e.payload as { action?: string }).action?.toLowerCase() ?? "");
  
  // Check if expected sequence appears in order (not necessarily consecutive)
  let seqIndex = 0;
  for (const action of actions) {
    if (seqIndex < expectedSequence.length) {
      const expected = expectedSequence[seqIndex].toLowerCase();
      if (action.includes(expected) || expected.includes(action.split(" ")[0])) {
        seqIndex++;
      }
    }
  }
  
  const completionRate = seqIndex / expectedSequence.length;
  
  return {
    score: completionRate,
    passed: completionRate >= 0.8, // 80% of sequence completed
    details: {
      expected_sequence: expectedSequence,
      completed_steps: seqIndex,
      total_expected: expectedSequence.length,
      completion_rate: completionRate,
    }
  };
}

/**
 * Composite Scorer: Overall Run Quality
 */
export function scoreOverall(
  run: RunMeta,
  events: StepEvent[],
  config: {
    expectedUrl?: string;
    optimalSteps?: number;
    expectedSequence?: string[];
  }
): {
  overall: number;
  passed: boolean;
  scores: Record<string, EvalResult>;
} {
  const scores: Record<string, EvalResult> = {
    task_success: scoreTaskSuccess(run, config.expectedUrl),
    loop_detection: scoreLoopDetection(events),
    step_efficiency: scoreStepEfficiency(run, config.optimalSteps ?? 20),
    cache_utilization: scoreCacheUtilization(run),
  };
  
  if (config.expectedSequence) {
    scores.sequence_correctness = scoreSequenceCorrectness(events, config.expectedSequence);
  }
  
  // Weighted average
  const weights: Record<string, number> = {
    task_success: 0.4,
    loop_detection: 0.25,
    step_efficiency: 0.15,
    cache_utilization: 0.1,
    sequence_correctness: 0.1,
  };
  
  let totalWeight = 0;
  let weightedSum = 0;
  
  for (const [key, result] of Object.entries(scores)) {
    const weight = weights[key] ?? 0.1;
    weightedSum += result.score * weight;
    totalWeight += weight;
  }
  
  const overall = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const passed = Object.values(scores).every(s => s.passed);
  
  return { overall, passed, scores };
}
