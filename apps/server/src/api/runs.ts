import express, { type Request, type Response } from "express";
import { CreateRunSchema } from "@loopless/shared";
import { getRun, getRunEvents, getRecentRunIds, setRun } from "../redis.js";
import { runTask } from "../agent/runner.js";
import { getTask } from "../tasks.js";
import { emit as emitLive } from "../run-emitter.js";
import { randomUUID } from "crypto";

const router = express.Router();

router.post("/", async (req: Request, res: Response) => {
  const parsed = CreateRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", details: parsed.error.flatten() });
    return;
  }
  const { task_id, mode, overrides } = parsed.data;
  const task = getTask(task_id);
  if (!task) {
    res.status(404).json({ error: `Unknown task: ${task_id}` });
    return;
  }
  if (mode === "twice") {
    const coldRunId = randomUUID();
    const warmRunId = randomUUID();
    await setRun(coldRunId, {
      run_id: coldRunId,
      task_id,
      mode: "cold",
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await setRun(warmRunId, {
      run_id: warmRunId,
      task_id,
      mode: "warm",
      status: "pending",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    res.status(201).json({ cold_run_id: coldRunId, warm_run_id: warmRunId });
    const runWithEmit = (runId: string, runMode: "cold" | "warm") => {
      const e = (ev: { type: string; payload: Record<string, unknown> }) => {
        emitLive(runId, { type: ev.type, payload: ev.payload });
      };
      return runTask(task_id, runMode, overrides, e, runId);
    };
    runWithEmit(coldRunId, "cold")
      .then(() => runWithEmit(warmRunId, "warm"))
      .catch(() => {});
    return;
  }
  const runId = randomUUID();
  await setRun(runId, {
    run_id: runId,
    task_id,
    mode,
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  res.status(201).json({ run_id: runId });
  const emitter = (ev: { type: string; payload: Record<string, unknown> }) => {
    emitLive(runId, { type: ev.type, payload: ev.payload });
  };
  runTask(task_id, mode, overrides, emitter, runId).catch(() => {});
});

router.get("/", async (_req: Request, res: Response) => {
  try {
    const ids = await getRecentRunIds(50);
    const runs = await Promise.all(ids.map((id) => getRun(id)));
    res.json(runs.filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: "Failed to list runs" });
  }
});

router.get("/:run_id", async (req: Request, res: Response) => {
  const run = await getRun(req.params.run_id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  res.json(run);
});

/**
 * PATCH /api/runs/:run_id
 * Update a run's status (e.g., to cancel/kill a stuck run)
 */
router.patch("/:run_id", async (req: Request, res: Response) => {
  const { run_id } = req.params;
  const { status, error: errorMsg } = req.body;
  
  const run = await getRun(run_id);
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  
  // Only allow marking as failed/cancelled
  if (status !== "failed" && status !== "cancelled") {
    res.status(400).json({ error: "Can only set status to 'failed' or 'cancelled'" });
    return;
  }
  
  // Update the run
  run.status = status;
  run.error = errorMsg || (status === "cancelled" ? "Manually cancelled by user" : "Manually marked as failed");
  run.updated_at = new Date().toISOString();
  
  await setRun(run_id, run);
  
  // Emit event
  emitLive(run_id, { 
    type: status === "cancelled" ? "run_cancelled" : "run_failed", 
    payload: { run_id, error: run.error } 
  });
  
  res.json({ success: true, run });
});

router.get("/:run_id/events", async (req: Request, res: Response) => {
  const { run_id } = req.params;
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const run = await getRun(run_id);
  if (!run) {
    res.write(`data: ${JSON.stringify({ type: "error", payload: { error: "Run not found" } })}\n\n`);
    res.end();
    return;
  }

  const send = (e: { type: string; payload: Record<string, unknown>; ts?: string }) => {
    res.write(`data: ${JSON.stringify(e)}\n\n`);
  };

  const events = await getRunEvents(run_id);
  for (const raw of events) {
    try {
      const e = JSON.parse(raw);
      send(e);
    } catch {
      //
    }
  }
  send({ type: "stream_caught_up", payload: {} });

  const { subscribe } = await import("../run-emitter.js");
  const unsub = subscribe(run_id, send);
  req.on("close", () => {
    unsub();
    res.end();
  });
});

export default router;
