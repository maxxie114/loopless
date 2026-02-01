/**
 * Evaluations API
 * 
 * Provides endpoints for:
 * - Running Weave evaluations on past runs
 * - Getting evaluation results
 * - Scoring individual runs
 */

import { Router } from "express";
import { 
  runWeaveEvaluation, 
  scoreRunWithWeave,
  createWeaveEvaluation 
} from "../evaluation/weave-evaluation.js";
import { isWeaveInitialized } from "../weave.js";

const router = Router();

/**
 * POST /api/evaluations
 * Run a Weave evaluation on past runs
 * 
 * Body: { taskId?: string, limit?: number }
 * Returns: { evaluationId, results, summary }
 */
router.post("/", async (req, res) => {
  if (!isWeaveInitialized()) {
    return res.status(503).json({ 
      error: "Weave is not initialized. Set WANDB_API_KEY to enable evaluations." 
    });
  }

  const { taskId, limit = 20 } = req.body;

  try {
    const result = await runWeaveEvaluation({ taskId, limit });
    
    // Calculate summary stats
    const scores = result.results.map(r => r.scores as Record<string, { score?: number; passed?: boolean }>);
    const summary = {
      totalRuns: scores.length,
      passRate: scores.filter(s => s.taskSuccess?.passed).length / scores.length,
      avgScore: scores.reduce((sum, s) => sum + (s.taskSuccess?.score || 0), 0) / scores.length,
      avgEfficiency: scores.reduce((sum, s) => sum + (s.efficiency?.score || 0), 0) / scores.length,
      loopFreeRate: scores.filter(s => s.loopDetection?.passed).length / scores.length,
    };

    res.json({
      evaluationId: result.evaluationId,
      summary,
      results: result.results.slice(0, 10), // Limit response size
      message: `Evaluated ${scores.length} runs. View full results in Weave dashboard.`,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[Evaluations] Error:", err);
    res.status(500).json({ error });
  }
});

/**
 * POST /api/evaluations/score/:runId
 * Score a specific run with all Weave scorers
 */
router.post("/score/:runId", async (req, res) => {
  const { runId } = req.params;

  try {
    const result = await scoreRunWithWeave(runId);
    res.json(result);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("[Evaluations] Score error:", err);
    res.status(500).json({ error });
  }
});

/**
 * GET /api/evaluations/scorers
 * List available Weave scorers
 */
router.get("/scorers", (_req, res) => {
  res.json({
    scorers: [
      {
        name: "taskSuccessScorer",
        description: "Evaluates if the task was completed successfully",
        metrics: ["passed", "score"],
      },
      {
        name: "efficiencyScorer",
        description: "Evaluates agent efficiency (steps, LLM calls)",
        metrics: ["passed", "score", "numSteps", "numLlmCalls", "stepEfficiency", "llmEfficiency"],
      },
      {
        name: "loopDetectionScorer",
        description: "Evaluates if the agent avoided loops",
        metrics: ["passed", "score", "loopsDetected", "loopsBroken"],
      },
      {
        name: "cacheUtilizationScorer",
        description: "Evaluates macro cache usage (for warm runs)",
        metrics: ["passed", "score", "cacheHitRate", "cacheHits", "cacheMisses"],
      },
      {
        name: "llmJudgeScorer",
        description: "LLM-as-a-judge evaluation of overall quality",
        metrics: ["passed", "score", "reason", "verdict"],
      },
    ],
    weaveEnabled: isWeaveInitialized(),
    message: "These scorers are registered with Weave and results appear in the Weave Evaluations UI.",
  });
});

/**
 * GET /api/evaluations/dataset
 * Get the current evaluation dataset (past runs)
 */
router.get("/dataset", async (req, res) => {
  const taskId = req.query.taskId as string | undefined;
  const limit = parseInt(req.query.limit as string) || 20;

  try {
    // Create evaluation (we don't use the result directly, just verify it works)
    await createWeaveEvaluation({ taskId, limit, includeOnlyCompleted: true });
    
    // Return info about what would be evaluated
    res.json({
      message: "Dataset created from past runs",
      taskFilter: taskId || "all",
      limit,
      ready: true,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error });
  }
});

export default router;
