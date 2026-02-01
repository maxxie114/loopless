/**
 * Weave Evaluation Script for LoopLess Browser Agent
 * 
 * This script runs a proper Weave evaluation against your browser agent.
 * It creates a dataset of test tasks, runs the agent, and scores the results.
 * 
 * Usage:
 *   cd apps/server
 *   npx tsx ../../scripts/run-evaluation.ts
 */

import * as weave from "weave";
import dotenv from "dotenv";
import path from "path";

// Load environment variables from root .env
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const WEAVE_PROJECT = process.env.WEAVE_PROJECT || "maxxie114-san-francisco-state-university/weavehacks";

// =============================================================================
// TEST DATASET - Define test cases for your browser agent
// =============================================================================

interface TestCase {
  task_id: string;
  task_name: string;
  start_url: string;
  goal: string;
  expected_final_url?: string;
  expected_elements?: string[];
  optimal_steps: number;
}

const testCases: TestCase[] = [
  {
    task_id: "saucedemo_login",
    task_name: "SauceDemo Login",
    start_url: "https://www.saucedemo.com",
    goal: "Log in with standard_user / secret_sauce",
    expected_final_url: "https://www.saucedemo.com/inventory.html",
    optimal_steps: 4, // type username, type password, click login, verify
  },
  {
    task_id: "saucedemo_checkout",
    task_name: "SauceDemo Checkout",
    start_url: "https://www.saucedemo.com",
    goal: "Log in, add item to cart, and complete checkout",
    expected_final_url: "https://www.saucedemo.com/checkout-complete.html",
    optimal_steps: 12,
  },
  {
    task_id: "google_search",
    task_name: "Google Search",
    start_url: "https://www.google.com",
    goal: "Search for 'Weights and Biases Weave'",
    expected_elements: ["weave", "wandb"],
    optimal_steps: 3,
  },
];

// =============================================================================
// SCORERS - Evaluate agent performance
// =============================================================================

/**
 * Score whether the task was completed successfully
 */
const scoreTaskSuccess = weave.op(
  function taskSuccessScorer({ 
    modelOutput, 
    datasetRow 
  }: { 
    modelOutput: AgentResult; 
    datasetRow: TestCase;
  }): { task_success: boolean; reached_goal_url: boolean } {
    const success = modelOutput.success === true;
    const reachedUrl = datasetRow.expected_final_url 
      ? modelOutput.final_url?.includes(datasetRow.expected_final_url) ?? false
      : true;
    
    return {
      task_success: success,
      reached_goal_url: reachedUrl,
    };
  }
);

/**
 * Score whether the agent avoided loops
 */
const scoreNoLoops = weave.op(
  function noLoopsScorer({ 
    modelOutput 
  }: { 
    modelOutput: AgentResult;
  }): { no_loops: boolean; max_repeats: number } {
    const actions = modelOutput.actions || [];
    
    // Count consecutive repeats
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
    
    return {
      no_loops: maxRepeats < 3,
      max_repeats: maxRepeats,
    };
  }
);

/**
 * Score efficiency (steps taken vs optimal)
 */
const scoreEfficiency = weave.op(
  function efficiencyScorer({ 
    modelOutput, 
    datasetRow 
  }: { 
    modelOutput: AgentResult; 
    datasetRow: TestCase;
  }): { efficiency: number; steps_taken: number; optimal_steps: number } {
    const stepsTaken = modelOutput.steps || 0;
    const optimal = datasetRow.optimal_steps;
    
    const efficiency = stepsTaken <= optimal 
      ? 1.0 
      : Math.max(0, optimal / stepsTaken);
    
    return {
      efficiency: Math.round(efficiency * 100) / 100,
      steps_taken: stepsTaken,
      optimal_steps: optimal,
    };
  }
);

/**
 * Overall pass/fail score
 */
const scoreOverall = weave.op(
  function overallScorer({ 
    modelOutput, 
    datasetRow 
  }: { 
    modelOutput: AgentResult; 
    datasetRow: TestCase;
  }): { passed: boolean; score: number } {
    const success = modelOutput.success === true;
    const noLoops = (modelOutput.max_repeats || 1) < 3;
    const efficient = (modelOutput.steps || 0) <= datasetRow.optimal_steps * 2;
    
    const passed = success && noLoops;
    const score = (success ? 0.5 : 0) + (noLoops ? 0.3 : 0) + (efficient ? 0.2 : 0);
    
    return {
      passed,
      score: Math.round(score * 100) / 100,
    };
  }
);

// =============================================================================
// AGENT MODEL - Wrapper for your browser agent
// =============================================================================

interface AgentResult {
  success: boolean;
  final_url?: string;
  steps: number;
  actions: string[];
  max_repeats?: number;
  error?: string;
}

/**
 * This would call your actual browser agent
 * For now, it simulates results based on stored run data
 */
const browserAgentModel = weave.op(
  async function browserAgent({ 
    datasetRow 
  }: { 
    datasetRow: TestCase;
  }): Promise<AgentResult> {
    console.log(`\n🚀 Running task: ${datasetRow.task_name}`);
    console.log(`   URL: ${datasetRow.start_url}`);
    console.log(`   Goal: ${datasetRow.goal}`);
    
    // In a real implementation, this would:
    // 1. Call your runAgent function from runner.ts
    // 2. Wait for completion
    // 3. Return the actual results
    
    // For now, we'll call the API endpoint
    try {
      const response = await fetch("http://localhost:3001/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: datasetRow.task_id,
          mode: "cold", // or "warm" to test with macros
        }),
      });
      
      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }
      
      const run = await response.json();
      
      // Poll for completion (simplified)
      let attempts = 0;
      while (attempts < 60) {
        await new Promise(r => setTimeout(r, 5000)); // Wait 5 seconds
        
        const statusRes = await fetch(`http://localhost:3001/api/runs/${run.run_id}`);
        const status = await statusRes.json();
        
        if (status.status === "completed" || status.status === "failed") {
          return {
            success: status.metrics?.success ?? false,
            final_url: status.metrics?.final_url,
            steps: status.metrics?.num_steps ?? 0,
            actions: status.metrics?.actions ?? [],
            max_repeats: status.metrics?.max_repeats ?? 1,
          };
        }
        
        attempts++;
      }
      
      return {
        success: false,
        steps: 0,
        actions: [],
        error: "Timeout waiting for agent",
      };
      
    } catch (error) {
      console.error(`   ❌ Error: ${error}`);
      return {
        success: false,
        steps: 0,
        actions: [],
        error: String(error),
      };
    }
  }
);

// =============================================================================
// MAIN - Run the evaluation
// =============================================================================

async function main() {
  console.log("🔬 LoopLess Browser Agent Evaluation");
  console.log("=====================================\n");
  
  // Check for API key
  if (!process.env.WANDB_API_KEY) {
    console.error("❌ WANDB_API_KEY is not set");
    console.log("   Set it in your .env file or export it:");
    console.log("   export WANDB_API_KEY=your-key-here");
    process.exit(1);
  }
  
  // Initialize Weave
  console.log(`📊 Initializing Weave project: ${WEAVE_PROJECT}`);
  await weave.init(WEAVE_PROJECT);
  
  // Create dataset
  console.log(`📋 Creating dataset with ${testCases.length} test cases\n`);
  const dataset = new weave.Dataset({
    name: "browser-agent-tasks",
    rows: testCases,
  });
  
  // Create evaluation
  const evaluation = new weave.Evaluation({
    name: "browser-agent-eval",
    dataset: dataset,
    scorers: [
      scoreTaskSuccess,
      scoreNoLoops,
      scoreEfficiency,
      scoreOverall,
    ],
  });
  
  // Run evaluation
  console.log("🏃 Starting evaluation...\n");
  console.log("   This will run each test case through your browser agent.");
  console.log("   Make sure the server is running on http://localhost:3001\n");
  
  const results = await evaluation.evaluate({ model: browserAgentModel });
  
  // Print results
  console.log("\n=====================================");
  console.log("📊 EVALUATION RESULTS");
  console.log("=====================================\n");
  console.log(JSON.stringify(results, null, 2));
  
  console.log("\n✅ Evaluation complete!");
  console.log("   View detailed results at: https://wandb.ai/" + WEAVE_PROJECT);
}

main().catch(console.error);
