/**
 * Auto-Improve API Endpoint
 * 
 * Provides endpoints for:
 * - Starting an auto-improvement session (with SSE streaming)
 * - Getting auto-improvement session status
 * - Listing recent auto-improvement sessions
 */

import { Router } from "express";
import { runAutoImprove, getRecentAutoImproveSessions, type AutoImproveEvent } from "../auto-improve.js";
import { getTask, listTasks } from "../tasks.js";

const router = Router();

/**
 * POST /api/auto-improve
 * Start an auto-improvement session
 * 
 * Body: { taskId: string, maxAttempts?: number }
 * Response: SSE stream of AutoImproveEvents
 */
router.post("/", async (req, res) => {
  const { taskId, maxAttempts = 5 } = req.body;

  if (!taskId) {
    return res.status(400).json({ error: "taskId is required" });
  }

  const task = getTask(taskId);
  if (!task) {
    return res.status(404).json({ error: `Task not found: ${taskId}` });
  }

  // Set up SSE
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const sendEvent = (event: AutoImproveEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  try {
    const result = await runAutoImprove({
      taskId,
      maxAttempts,
      onProgress: sendEvent,
    });

    // Send final result
    res.write(`data: ${JSON.stringify({
      type: "complete",
      attempt: result.totalAttempts,
      maxAttempts,
      data: result,
      timestamp: new Date().toISOString(),
    })}\n\n`);

    res.end();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({
      type: "error",
      attempt: 0,
      maxAttempts,
      data: { error },
      timestamp: new Date().toISOString(),
    })}\n\n`);
    res.end();
  }
});

/**
 * GET /api/auto-improve/recent
 * Get recent auto-improvement sessions
 */
router.get("/recent", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 10;
  const sessions = await getRecentAutoImproveSessions(limit);
  res.json(sessions);
});

/**
 * GET /api/auto-improve/tasks
 * Get all available tasks for auto-improvement
 */
router.get("/tasks", async (_req, res) => {
  const tasks = listTasks();
  res.json(tasks.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    domain: t.domain,
    maxSteps: t.max_steps,
  })));
});

export default router;
