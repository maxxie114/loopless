/**
 * Minimal eval harness: run task suite and output metrics for Weave Evaluations.
 * Extend with Weave dataset + scorers (success, steps, llm_calls, time).
 * Usage: pnpm run eval
 */
import "dotenv/config";
import { runTask } from "../apps/server/src/agent/runner.js";
import { getTask } from "../apps/server/src/tasks.js";
import { listTasks } from "../apps/server/src/tasks.js";
import { initWeave } from "../apps/server/src/weave.js";
import { getRedis } from "../apps/server/src/redis.js";

async function main() {
  if (process.env.WANDB_API_KEY) await initWeave();
  try {
    await getRedis();
  } catch {
    console.warn("Redis not available");
  }

  const tasks = listTasks();
  const results: { task_id: string; success: boolean; steps: number; llm_calls: number; wall_time_ms: number }[] = [];

  for (const task of tasks) {
    console.log("Eval task:", task.id);
    const result = await runTask(task.id, "cold", undefined);
    results.push({
      task_id: task.id,
      success: result.metrics.success,
      steps: result.metrics.num_steps,
      llm_calls: result.metrics.num_llm_calls,
      wall_time_ms: result.metrics.wall_time_ms,
    });
  }

  console.log("\n--- Eval results ---");
  console.table(results);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
