/**
 * Demo: Run SauceDemo checkout cold then warm; print metrics and links.
 * Usage: pnpm run demo:twice
 */
import "dotenv/config";
import { runTask } from "./agent/runner.js";
import { getRun } from "./redis.js";
import { initWeave } from "./weave.js";
import { getRedis } from "./redis.js";

const TASK_ID = "saucedemo-checkout";

async function main() {
  if (process.env.WANDB_API_KEY) await initWeave();
  try {
    await getRedis();
  } catch {
    console.warn("Redis not available; macros will not be stored.");
  }

  console.log("Running COLD (no cached macros)...");
  const cold = await runTask(TASK_ID, "cold", undefined, (e) => {
    console.log("  ", e.type, e.payload?.step ?? "");
  });
  console.log("Cold run_id:", cold.runId);
  console.log("Cold metrics:", JSON.stringify(cold.metrics, null, 2));

  console.log("\nRunning WARM (with cached macros)...");
  const warm = await runTask(TASK_ID, "warm", undefined, (e) => {
    console.log("  ", e.type, e.payload?.step ?? "");
  });
  console.log("Warm run_id:", warm.runId);
  console.log("Warm metrics:", JSON.stringify(warm.metrics, null, 2));

  const coldMeta = await getRun(cold.runId);
  const warmMeta = await getRun(warm.runId);
  console.log("\n--- Comparison ---");
  console.log("Cold: success=%s, steps=%s, llm_calls=%s, wall_time_ms=%s, cache_hits=%s",
    cold.metrics.success, cold.metrics.num_steps, cold.metrics.num_llm_calls,
    cold.metrics.wall_time_ms, cold.metrics.cache_hits);
  console.log("Warm: success=%s, steps=%s, llm_calls=%s, wall_time_ms=%s, cache_hits=%s",
    warm.metrics.success, warm.metrics.num_steps, warm.metrics.num_llm_calls,
    warm.metrics.wall_time_ms, warm.metrics.cache_hits);
  if (coldMeta?.metrics?.recording_url) console.log("Cold recording:", coldMeta.metrics.recording_url);
  if (warmMeta?.metrics?.recording_url) console.log("Warm recording:", warmMeta.metrics.recording_url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
