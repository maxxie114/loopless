#!/usr/bin/env python3
"""
Weave Evaluation Script for LoopLess Browser Agent

This script runs proper Weave evaluations on your agent's performance.
Run this periodically to track improvement over time.

Usage:
  pip install weave wandb redis
  python scripts/weave_eval.py
"""

import os
import json
import asyncio
from typing import Any
import redis
import weave

# Initialize Weave
weave.init(os.environ.get("WEAVE_PROJECT", "loopless"))

# Connect to Redis
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
PREFIX = os.environ.get("REDIS_PREFIX", "loopless")

def get_redis():
    return redis.from_url(REDIS_URL, decode_responses=True)

# =============================================================================
# SCORERS - These evaluate agent performance
# =============================================================================

@weave.op()
def score_task_success(output: dict) -> dict:
    """Did the agent complete the task?"""
    success = output.get("metrics", {}).get("success", False)
    return {"task_success": success}

@weave.op()
def score_loop_detection(output: dict) -> dict:
    """Did the agent get stuck in a loop?"""
    events = output.get("events", [])
    
    # Extract actions from step_planned events
    actions = [
        e.get("payload", {}).get("action", "")
        for e in events
        if e.get("type") == "step_planned"
    ]
    
    # Count consecutive repeats
    max_repeats = 1
    current_repeats = 1
    
    for i in range(1, len(actions)):
        if actions[i] == actions[i-1] and actions[i]:
            current_repeats += 1
            max_repeats = max(max_repeats, current_repeats)
        else:
            current_repeats = 1
    
    no_loop = max_repeats < 3
    return {
        "no_loop": no_loop,
        "max_consecutive_repeats": max_repeats
    }

@weave.op()
def score_efficiency(output: dict, optimal_steps: int = 15) -> dict:
    """Was the agent efficient?"""
    actual_steps = output.get("metrics", {}).get("num_steps", 0)
    efficiency = 1.0 if actual_steps <= optimal_steps else optimal_steps / actual_steps
    return {
        "efficiency_score": efficiency,
        "actual_steps": actual_steps,
        "optimal_steps": optimal_steps
    }

@weave.op()
def score_cache_utilization(output: dict) -> dict:
    """Is the agent learning from macros?"""
    metrics = output.get("metrics", {})
    hits = metrics.get("cache_hits", 0)
    misses = metrics.get("cache_misses", 0)
    total = hits + misses
    
    hit_rate = hits / total if total > 0 else 0
    return {
        "cache_hit_rate": hit_rate,
        "cache_hits": hits,
        "cache_misses": misses
    }

# =============================================================================
# DATASET - Load runs from Redis
# =============================================================================

def load_runs_from_redis(limit: int = 20) -> list[dict]:
    """Load recent runs from Redis as evaluation dataset."""
    r = get_redis()
    
    # Get recent run IDs
    run_ids = r.lrange(f"{PREFIX}:runs:recent", 0, limit - 1)
    
    runs = []
    for run_id in run_ids:
        # Get run metadata
        run_data = r.get(f"{PREFIX}:run:{run_id}")
        if not run_data:
            continue
        
        run = json.loads(run_data)
        
        # Get run events
        events_raw = r.lrange(f"{PREFIX}:run:{run_id}:events", 0, -1)
        events = [json.loads(e) for e in events_raw]
        
        runs.append({
            "run_id": run_id,
            "task_id": run.get("task_id", "unknown"),
            "mode": run.get("mode", "cold"),
            "output": {
                "metrics": run.get("metrics", {}),
                "events": events,
                "status": run.get("status", "unknown")
            }
        })
    
    return runs

# =============================================================================
# EVALUATION - Compare agent performance
# =============================================================================

class BrowserAgentModel(weave.Model):
    """Wrapper for our browser agent for Weave evaluation."""
    
    system_prompt: str = "default"
    
    @weave.op()
    def predict(self, run_id: str, task_id: str, mode: str, output: dict) -> dict:
        """Return the output for evaluation."""
        # In a real scenario, this would run the agent
        # For evaluation, we just return the stored output
        return output

async def run_evaluation():
    """Run Weave evaluation on recent runs."""
    
    # Load dataset from Redis
    print("Loading runs from Redis...")
    runs = load_runs_from_redis(limit=20)
    
    if not runs:
        print("No runs found in Redis. Run some agent tasks first.")
        return
    
    print(f"Found {len(runs)} runs to evaluate")
    
    # Create Weave dataset
    dataset = weave.Dataset(
        name="browser_agent_runs",
        rows=runs
    )
    
    # Create evaluation
    evaluation = weave.Evaluation(
        name="browser_agent_eval",
        dataset=dataset,
        scorers=[
            score_task_success,
            score_loop_detection,
            score_efficiency,
            score_cache_utilization
        ]
    )
    
    # Create model instance
    model = BrowserAgentModel(system_prompt="current")
    
    # Run evaluation
    print("Running Weave evaluation...")
    results = await evaluation.evaluate(model)
    
    print("\n" + "="*60)
    print("EVALUATION RESULTS")
    print("="*60)
    print(json.dumps(results, indent=2, default=str))
    
    return results

# =============================================================================
# COMPARE PROMPTS - A/B testing different prompts
# =============================================================================

async def compare_prompts():
    """Compare different prompt versions using Weave."""
    
    runs = load_runs_from_redis(limit=50)
    
    # Group runs by mode (cold vs warm)
    cold_runs = [r for r in runs if r["mode"] == "cold"]
    warm_runs = [r for r in runs if r["mode"] == "warm"]
    
    print(f"\nCold runs: {len(cold_runs)}")
    print(f"Warm runs: {len(warm_runs)}")
    
    # Calculate metrics for each group
    def calc_metrics(runs_list):
        if not runs_list:
            return {"success_rate": 0, "avg_steps": 0, "avg_cache_hits": 0}
        
        successes = sum(1 for r in runs_list if r["output"]["metrics"].get("success"))
        total_steps = sum(r["output"]["metrics"].get("num_steps", 0) for r in runs_list)
        total_cache = sum(r["output"]["metrics"].get("cache_hits", 0) for r in runs_list)
        
        return {
            "success_rate": successes / len(runs_list),
            "avg_steps": total_steps / len(runs_list),
            "avg_cache_hits": total_cache / len(runs_list)
        }
    
    cold_metrics = calc_metrics(cold_runs)
    warm_metrics = calc_metrics(warm_runs)
    
    print("\n" + "="*60)
    print("COLD vs WARM COMPARISON")
    print("="*60)
    print(f"\nCold Runs (no macros):")
    print(f"  Success Rate: {cold_metrics['success_rate']:.1%}")
    print(f"  Avg Steps: {cold_metrics['avg_steps']:.1f}")
    print(f"  Avg Cache Hits: {cold_metrics['avg_cache_hits']:.1f}")
    
    print(f"\nWarm Runs (with macros):")
    print(f"  Success Rate: {warm_metrics['success_rate']:.1%}")
    print(f"  Avg Steps: {warm_metrics['avg_steps']:.1f}")
    print(f"  Avg Cache Hits: {warm_metrics['avg_cache_hits']:.1f}")
    
    if cold_metrics['avg_steps'] > 0:
        improvement = (cold_metrics['avg_steps'] - warm_metrics['avg_steps']) / cold_metrics['avg_steps']
        print(f"\nImprovement: {improvement:.1%} fewer steps")

if __name__ == "__main__":
    print("LoopLess Weave Evaluation")
    print("="*60)
    
    asyncio.run(run_evaluation())
    asyncio.run(compare_prompts())
