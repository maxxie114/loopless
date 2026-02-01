/**
 * Evaluate Historical Runs with Weave
 * 
 * This script loads completed runs from Redis and evaluates them with Weave.
 * Useful for batch-evaluating past runs without re-running the agent.
 * 
 * Usage:
 *   npx tsx scripts/evaluate-history.ts
 */

import * as weave from "weave";
import { createClient } from "redis";
import dotenv from "dotenv";
import path from "path";

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const WEAVE_PROJECT = process.env.WEAVE_PROJECT || "maxxie114-san-francisco-state-university/weavehacks";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const REDIS_PREFIX = process.env.REDIS_PREFIX || "loopless";

// =============================================================================
// DATA TYPES
// =============================================================================

interface RunData {
  run_id: string;
  task_id: string;
  mode: "cold" | "warm";
  status: string;
  metrics: {
    success?: boolean;
    num_steps?: number;
    cache_hits?: number;
    cache_misses?: number;
    final_url?: string;
  };
  events: StepEvent[];
}

interface StepEvent {
  type: string;
  payload?: {
    action?: string;
    success?: boolean;
    error?: string;
  };
  timestamp?: string;
}

// =============================================================================
// LOAD RUNS FROM REDIS
// =============================================================================

async function loadRunsFromRedis(limit: number = 20): Promise<RunData[]> {
  const redis = createClient({ url: REDIS_URL });
  await redis.connect();
  
  try {
    // Scan for run keys using KEYS (or SCAN for production)
    const runKeys = await redis.keys(`${REDIS_PREFIX}:run:*`);
    
    // Filter to only direct run keys (not :events suffix)
    const directRunKeys = runKeys
      .filter(k => !k.includes(":events"))
      .slice(0, limit);
    
    console.log(`   Found ${directRunKeys.length} run keys in Redis`);
    
    const runs: RunData[] = [];
    
    for (const key of directRunKeys) {
      // Extract run ID from key
      const runId = key.replace(`${REDIS_PREFIX}:run:`, "");
      
      // Get run metadata
      const runData = await redis.get(key);
      if (!runData) continue;
      
      const run = JSON.parse(runData);
      
      // Get run events
      const eventsRaw = await redis.lRange(`${key}:events`, 0, -1);
      const events = eventsRaw.map(e => {
        try { return JSON.parse(e); } 
        catch { return { type: "unknown", payload: e }; }
      });
      
      runs.push({
        run_id: runId,
        task_id: run.task_id || "unknown",
        mode: run.mode || "cold",
        status: run.status || "unknown",
        metrics: run.metrics || {},
        events,
      });
    }
    
    return runs;
  } finally {
    await redis.quit();
  }
}

// =============================================================================
// SCORERS
// =============================================================================

const scoreSuccess = weave.op(
  function successScorer({ modelOutput }: { modelOutput: RunData }): { 
    task_success: boolean;
    status: string;
  } {
    return {
      task_success: modelOutput.metrics?.success === true,
      status: modelOutput.status,
    };
  }
);

const scoreLoops = weave.op(
  function loopScorer({ modelOutput }: { modelOutput: RunData }): {
    no_loops: boolean;
    max_consecutive_repeats: number;
  } {
    // Extract actions from step_planned events
    const actions = modelOutput.events
      .filter(e => e.type === "step_planned")
      .map(e => e.payload?.action || "")
      .filter(a => a);
    
    // Count consecutive repeats
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
    
    return {
      no_loops: maxRepeats < 3,
      max_consecutive_repeats: maxRepeats,
    };
  }
);

const scoreEfficiency = weave.op(
  function efficiencyScorer({ modelOutput }: { modelOutput: RunData }): {
    steps: number;
    cache_hits: number;
    cache_utilization: number;
  } {
    const hits = modelOutput.metrics?.cache_hits || 0;
    const misses = modelOutput.metrics?.cache_misses || 0;
    const total = hits + misses;
    
    return {
      steps: modelOutput.metrics?.num_steps || 0,
      cache_hits: hits,
      cache_utilization: total > 0 ? Math.round((hits / total) * 100) / 100 : 0,
    };
  }
);

const scoreColdVsWarm = weave.op(
  function modeScorer({ modelOutput }: { modelOutput: RunData }): {
    mode: string;
    is_warm: boolean;
  } {
    return {
      mode: modelOutput.mode,
      is_warm: modelOutput.mode === "warm",
    };
  }
);

const scoreOverall = weave.op(
  function overallScorer({ modelOutput }: { modelOutput: RunData }): {
    passed: boolean;
    score: number;
  } {
    const success = modelOutput.metrics?.success === true;
    const steps = modelOutput.metrics?.num_steps || 0;
    const efficient = steps <= 20;
    
    // Check for loops in events
    const actions = modelOutput.events
      .filter(e => e.type === "step_planned")
      .map(e => e.payload?.action || "");
    
    let maxRepeats = 1;
    let currentRepeats = 1;
    for (let i = 1; i < actions.length; i++) {
      if (actions[i] === actions[i - 1] && actions[i]) {
        currentRepeats++;
        maxRepeats = Math.max(maxRepeats, currentRepeats);
      } else {
        currentRepeats = 1;
      }
    }
    const noLoops = maxRepeats < 3;
    
    const passed = success && noLoops;
    const score = (success ? 0.5 : 0) + (noLoops ? 0.3 : 0) + (efficient ? 0.2 : 0);
    
    return {
      passed,
      score: Math.round(score * 100) / 100,
    };
  }
);

// =============================================================================
// MODEL - Returns the stored run data for evaluation
// =============================================================================

const historicalRunModel = weave.op(
  async function historicalRun({ datasetRow }: { datasetRow: RunData }): Promise<RunData> {
    // Just return the run data - it's already complete
    return datasetRow;
  }
);

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log("📊 LoopLess Historical Evaluation");
  console.log("==================================\n");
  
  if (!process.env.WANDB_API_KEY) {
    console.error("❌ WANDB_API_KEY not set");
    process.exit(1);
  }
  
  // Initialize Weave
  console.log(`🔗 Connecting to Weave: ${WEAVE_PROJECT}`);
  await weave.init(WEAVE_PROJECT);
  
  // Load runs from Redis
  console.log(`🔗 Loading runs from Redis: ${REDIS_URL}`);
  const runs = await loadRunsFromRedis(20);
  
  if (runs.length === 0) {
    console.log("❌ No runs found in Redis. Run some agent tasks first.");
    process.exit(0);
  }
  
  console.log(`📋 Found ${runs.length} runs to evaluate\n`);
  
  // Show summary of runs
  const coldRuns = runs.filter(r => r.mode === "cold");
  const warmRuns = runs.filter(r => r.mode === "warm");
  const successRuns = runs.filter(r => r.metrics?.success);
  
  console.log(`   Cold runs: ${coldRuns.length}`);
  console.log(`   Warm runs: ${warmRuns.length}`);
  console.log(`   Successful: ${successRuns.length}`);
  console.log();
  
  // Create dataset from runs
  const dataset = new weave.Dataset({
    name: "historical-runs",
    rows: runs,
  });
  
  // Create evaluation
  const evaluation = new weave.Evaluation({
    name: "historical-eval",
    dataset: dataset,
    scorers: [
      scoreSuccess,
      scoreLoops,
      scoreEfficiency,
      scoreColdVsWarm,
      scoreOverall,
    ],
  });
  
  // Run evaluation
  console.log("🏃 Running evaluation...\n");
  const results = await evaluation.evaluate({ model: historicalRunModel });
  
  // Print results
  console.log("\n==================================");
  console.log("📊 RESULTS");
  console.log("==================================\n");
  
  console.log(JSON.stringify(results, null, 2));
  
  // Calculate improvements
  if (coldRuns.length > 0 && warmRuns.length > 0) {
    const coldSuccess = coldRuns.filter(r => r.metrics?.success).length / coldRuns.length;
    const warmSuccess = warmRuns.filter(r => r.metrics?.success).length / warmRuns.length;
    
    const coldSteps = coldRuns.reduce((sum, r) => sum + (r.metrics?.num_steps || 0), 0) / coldRuns.length;
    const warmSteps = warmRuns.reduce((sum, r) => sum + (r.metrics?.num_steps || 0), 0) / warmRuns.length;
    
    console.log("\n📈 COLD vs WARM COMPARISON");
    console.log("==================================");
    console.log(`Cold Success Rate: ${(coldSuccess * 100).toFixed(1)}%`);
    console.log(`Warm Success Rate: ${(warmSuccess * 100).toFixed(1)}%`);
    console.log(`Cold Avg Steps: ${coldSteps.toFixed(1)}`);
    console.log(`Warm Avg Steps: ${warmSteps.toFixed(1)}`);
    
    if (warmSteps < coldSteps) {
      const improvement = ((coldSteps - warmSteps) / coldSteps * 100).toFixed(1);
      console.log(`\n🎉 Warm runs are ${improvement}% more efficient!`);
    }
  }
  
  console.log("\n✅ Evaluation complete!");
  console.log(`   View at: https://wandb.ai/${WEAVE_PROJECT}`);
}

main().catch(console.error);
