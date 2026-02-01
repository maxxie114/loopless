/**
 * Evaluation Module Exports
 * 
 * This module provides comprehensive evaluation capabilities:
 * - Weave built-in Evaluation framework with proper scorers
 * - Weave API client for querying past runs and feedback
 * - LLM-as-a-judge for intelligent evaluation
 * - Traditional scorers for metrics
 * - Self-improvement loop integration
 */

// ============================================================
// WEAVE BUILT-IN EVALUATION (NEW - Proper Integration)
// ============================================================
export {
  taskSuccessScorer,
  efficiencyScorer,
  loopDetectionScorer,
  cacheUtilizationScorer,
  llmJudgeScorer,
  createWeaveEvaluation,
  evaluateRun,
  runWeaveEvaluation,
  scoreRunWithWeave,
} from "./weave-evaluation.js";

// Weave API Client - Query past evaluations directly from Weave
export {
  WeaveAPIClient,
  getWeaveClient,
  type EvaluationResult,
  type FailureAnalysis,
  type LLMJudgeFeedback,
} from "./weave-client.js";

// LLM-as-a-Judge - Based on AGI Benchmark patterns
export {
  evaluateWithLLMJudge,
  quickLLMJudge,
  judgeAgentResponse,
  type LLMJudgeResult,
} from "./llm-judge.js";

// Traditional Scorers
export {
  scoreTaskSuccess,
  scoreLoopDetection,
  scoreStepEfficiency,
  scoreCacheUtilization,
  scoreSequenceCorrectness,
  scoreOverall,
} from "./scorers.js";

// Self-Improvement Loop
export {
  analyzeRun,
  fetchWeaveFeedback,
  generateImprovedPromptFromWeave,
  generateImprovedPrompt,
  getFailurePatterns,
  measureImprovement,
  formatLearningReport,
  clearFeedbackCache,
  type IssueType,
  type LearningResult,
} from "./self-improve.js";
