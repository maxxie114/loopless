#!/usr/bin/env tsx
/**
 * Comprehensive test script for all benchmark tasks
 * Runs cold then warm for each task and compares performance
 */

import { runTask } from "../apps/server/src/agent/index.js";
import { listTasks } from "../apps/server/src/tasks.js";
import { config } from "../apps/server/src/config.js";

interface TaskResult {
  taskId: string;
  taskName: string;
  cold: {
    runId: string;
    success: boolean;
    wallTimeMs: number;
    steps: number;
    llmCalls: number;
    cacheHits: number;
  } | null;
  warm: {
    runId: string;
    success: boolean;
    wallTimeMs: number;
    steps: number;
    llmCalls: number;
    cacheHits: number;
  } | null;
}

async function runAllTests() {
  console.log("\n" + "=".repeat(80));
  console.log("  COMPREHENSIVE BENCHMARK TEST");
  console.log("=".repeat(80) + "\n");
  
  const tasks = listTasks();
  console.log(`Found ${tasks.length} tasks to test\n`);
  
  const results: TaskResult[] = [];
  
  for (const task of tasks) {
    console.log(`\n${"─".repeat(80)}`);
    console.log(`Testing: ${task.name} (${task.id})`);
    console.log(`${"─".repeat(80)}`);
    
    const result: TaskResult = {
      taskId: task.id,
      taskName: task.name,
      cold: null,
      warm: null,
    };
    
    // Cold run
    console.log("\n🧊 COLD RUN...");
    try {
      const coldResult = await runTask(task.id, "cold", undefined, (event) => {
        if (event.type === "step_planned") {
          process.stdout.write(".");
        }
      });
      
      const coldMeta = await getRunMeta(coldResult.runId);
      result.cold = {
        runId: coldResult.runId,
        success: coldMeta?.metrics?.success ?? false,
        wallTimeMs: coldMeta?.metrics?.wall_time_ms ?? 0,
        steps: coldMeta?.metrics?.num_steps ?? 0,
        llmCalls: coldMeta?.metrics?.num_llm_calls ?? 0,
        cacheHits: coldMeta?.metrics?.cache_hits ?? 0,
      };
      
      console.log("\n   ✅ Cold run complete");
      console.log(`   Time: ${(result.cold.wallTimeMs / 1000).toFixed(1)}s | Steps: ${result.cold.steps} | LLM: ${result.cold.llmCalls} | Success: ${result.cold.success ? '✅' : '❌'}`);
    } catch (err) {
      console.log("\n   ❌ Cold run failed:", err);
    }
    
    // Small delay between runs
    await new Promise(r => setTimeout(r, 2000));
    
    // Warm run
    console.log("\n🔥 WARM RUN...");
    try {
      const warmResult = await runTask(task.id, "warm", undefined, (event) => {
        if (event.type === "step_planned") {
          process.stdout.write(".");
        }
      });
      
      const warmMeta = await getRunMeta(warmResult.runId);
      result.warm = {
        runId: warmResult.runId,
        success: warmMeta?.metrics?.success ?? false,
        wallTimeMs: warmMeta?.metrics?.wall_time_ms ?? 0,
        steps: warmMeta?.metrics?.num_steps ?? 0,
        llmCalls: warmMeta?.metrics?.num_llm_calls ?? 0,
        cacheHits: warmMeta?.metrics?.cache_hits ?? 0,
      };
      
      console.log("\n   ✅ Warm run complete");
      console.log(`   Time: ${(result.warm.wallTimeMs / 1000).toFixed(1)}s | Steps: ${result.warm.steps} | LLM: ${result.warm.llmCalls} | Cache: ${result.warm.cacheHits} | Success: ${result.warm.success ? '✅' : '❌'}`);
    } catch (err) {
      console.log("\n   ❌ Warm run failed:", err);
    }
    
    results.push(result);
    
    // Delay between tasks
    await new Promise(r => setTimeout(r, 3000));
  }
  
  // Print summary
  printSummary(results);
}

async function getRunMeta(runId: string) {
  try {
    const { getRun } = await import("../apps/server/src/redis.js");
    return await getRun(runId);
  } catch {
    return null;
  }
}

function printSummary(results: TaskResult[]) {
  console.log("\n\n" + "=".repeat(80));
  console.log("  TEST SUMMARY");
  console.log("=".repeat(80) + "\n");
  
  let coldSuccesses = 0;
  let warmSuccesses = 0;
  let warmBetterCount = 0;
  let totalColdTime = 0;
  let totalWarmTime = 0;
  
  for (const r of results) {
    const coldSuccess = r.cold?.success ?? false;
    const warmSuccess = r.warm?.success ?? false;
    
    if (coldSuccess) coldSuccesses++;
    if (warmSuccess) warmSuccesses++;
    
    const coldTime = r.cold?.wallTimeMs ?? 0;
    const warmTime = r.warm?.wallTimeMs ?? 0;
    totalColdTime += coldTime;
    totalWarmTime += warmTime;
    
    const warmBetter = warmSuccess && (!coldSuccess || warmTime < coldTime);
    if (warmBetter) warmBetterCount++;
    
    const coldLLM = r.cold?.llmCalls ?? 0;
    const warmLLM = r.warm?.llmCalls ?? 0;
    const llmReduction = coldLLM > 0 ? ((coldLLM - warmLLM) / coldLLM * 100).toFixed(0) : "0";
    
    console.log(`${r.taskName.slice(0, 30).padEnd(32)} | Cold: ${coldSuccess ? '✅' : '❌'} ${(coldTime/1000).toFixed(1).padStart(5)}s | Warm: ${warmSuccess ? '✅' : '❌'} ${(warmTime/1000).toFixed(1).padStart(5)}s | LLM↓: ${llmReduction}% | Cache: ${r.warm?.cacheHits ?? 0}`);
  }
  
  console.log("\n" + "─".repeat(80));
  console.log(`Total Tasks: ${results.length}`);
  console.log(`Cold Success: ${coldSuccesses}/${results.length} (${(coldSuccesses/results.length*100).toFixed(0)}%)`);
  console.log(`Warm Success: ${warmSuccesses}/${results.length} (${(warmSuccesses/results.length*100).toFixed(0)}%)`);
  console.log(`Warm Better: ${warmBetterCount}/${results.length} (${(warmBetterCount/results.length*100).toFixed(0)}%)`);
  console.log(`Total Cold Time: ${(totalColdTime/1000).toFixed(1)}s`);
  console.log(`Total Warm Time: ${(totalWarmTime/1000).toFixed(1)}s`);
  console.log(`Time Saved: ${(totalColdTime - totalWarmTime)/1000 > 0 ? '+' : ''}${((totalColdTime - totalWarmTime)/1000).toFixed(1)}s`);
  console.log("=".repeat(80) + "\n");
}

// Run tests
runAllTests().catch(err => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
