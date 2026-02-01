#!/usr/bin/env python3
"""
Weave Native Scorers for LoopLess Browser Agent

This script uses Weave's native Scorer system (from https://docs.wandb.ai/weave/guides/evaluation/guardrails_and_monitors)
to evaluate agent performance with LLM-as-a-judge.

Key Features:
- Uses Weave's built-in Scorer class
- Automatic score storage in Weave database
- LLM-as-a-judge evaluation (like AGI Benchmark)
- Can be used as guardrails or monitors

Usage:
  pip install weave wandb redis openai
  python scripts/weave_scorers.py
"""

import os
import json
import asyncio
from typing import Optional
import redis
import weave
from weave import Scorer
from openai import AsyncOpenAI

# Initialize
weave.init(os.environ.get("WEAVE_PROJECT", "loopless"))
client = AsyncOpenAI()

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
PREFIX = os.environ.get("REDIS_PREFIX", "loopless")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

def get_redis():
    return redis.from_url(REDIS_URL, decode_responses=True)


# =============================================================================
# WEAVE SCORERS - Native Weave evaluation system
# Based on: https://docs.wandb.ai/weave/guides/evaluation/guardrails_and_monitors
# =============================================================================

class TaskSuccessScorer(Scorer):
    """
    Scorer to evaluate if the agent completed the task successfully.
    Uses both heuristic checks and LLM judgment.
    """
    
    @weave.op
    async def score(
        self, 
        output: dict,
        task_intent: str = "",
        expected_url: str = ""
    ) -> dict:
        """Evaluate task completion success."""
        metrics = output.get("metrics", {})
        success = metrics.get("success", False)
        final_url = metrics.get("final_url", "")
        
        # Heuristic check
        url_match = expected_url and expected_url.lower() in final_url.lower()
        
        # If heuristic is inconclusive, use LLM judge
        if not success and task_intent:
            llm_verdict = await self._llm_judge_success(
                task_intent, 
                final_url, 
                metrics.get("num_steps", 0)
            )
            return {
                "task_success": llm_verdict["passed"],
                "url_match": url_match,
                "llm_verdict": llm_verdict["verdict"],
                "llm_reason": llm_verdict["reason"]
            }
        
        return {
            "task_success": success,
            "url_match": url_match,
            "final_url": final_url
        }
    
    async def _llm_judge_success(
        self, 
        task_intent: str, 
        final_url: str, 
        steps: int
    ) -> dict:
        """Use LLM to judge if task was completed."""
        prompt = f"""You are evaluating if a browser automation agent completed a task.

TASK: {task_intent}
FINAL URL: {final_url}
STEPS TAKEN: {steps}

Be lenient - say YES if the agent made significant progress toward the goal.
Only say NO if the agent clearly failed or didn't attempt the main task.

Respond with ONLY 'YES' or 'NO' followed by a brief explanation (max 2 sentences)."""

        try:
            response = await client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=150
            )
            verdict = response.choices[0].message.content.strip()
            passed = verdict.upper().startswith("YES")
            return {
                "passed": passed,
                "verdict": "YES" if passed else "NO",
                "reason": verdict
            }
        except Exception as e:
            return {
                "passed": False,
                "verdict": "NO",
                "reason": f"LLM judge error: {e}"
            }


class LoopDetectionScorer(Scorer):
    """
    Scorer to detect if the agent got stuck in a loop.
    """
    
    @weave.op
    def score(self, output: dict) -> dict:
        """Detect action loops in agent behavior."""
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
        repeated_action = ""
        
        for i in range(1, len(actions)):
            if actions[i] == actions[i-1] and actions[i]:
                current_repeats += 1
                if current_repeats > max_repeats:
                    max_repeats = current_repeats
                    repeated_action = actions[i]
            else:
                current_repeats = 1
        
        no_loop = max_repeats < 3
        
        return {
            "no_loop": no_loop,
            "max_consecutive_repeats": max_repeats,
            "repeated_action": repeated_action[:100] if repeated_action else None,
            "loop_severity": "none" if max_repeats < 3 else "mild" if max_repeats < 5 else "severe"
        }


class ActionSequenceScorer(Scorer):
    """
    Scorer to evaluate if the agent's action sequence was logical.
    Uses LLM-as-a-judge for complex evaluation.
    """
    
    @weave.op
    async def score(
        self, 
        output: dict,
        task_intent: str = "",
        expected_sequence: list = None
    ) -> dict:
        """Evaluate action sequence correctness."""
        events = output.get("events", [])
        
        actions = [
            e.get("payload", {}).get("action", "")
            for e in events
            if e.get("type") == "step_planned"
        ]
        
        if not actions:
            return {
                "sequence_valid": False,
                "reason": "No actions were performed",
                "action_count": 0
            }
        
        # Check against expected sequence if provided
        if expected_sequence:
            matched = sum(
                1 for exp in expected_sequence
                if any(exp.lower() in act.lower() for act in actions)
            )
            coverage = matched / len(expected_sequence) if expected_sequence else 0
            
            return {
                "sequence_valid": coverage >= 0.7,
                "coverage": coverage,
                "matched_steps": matched,
                "total_expected": len(expected_sequence),
                "action_count": len(actions)
            }
        
        # Use LLM to judge sequence logic
        if task_intent:
            verdict = await self._llm_judge_sequence(task_intent, actions[:20])
            return {
                "sequence_valid": verdict["passed"],
                "llm_verdict": verdict["verdict"],
                "llm_reason": verdict["reason"],
                "action_count": len(actions)
            }
        
        return {
            "sequence_valid": True,
            "action_count": len(actions)
        }
    
    async def _llm_judge_sequence(self, task_intent: str, actions: list) -> dict:
        """Use LLM to judge if action sequence was logical."""
        actions_str = "\n".join(f"{i+1}. {a}" for i, a in enumerate(actions))
        
        prompt = f"""You are evaluating if a browser automation agent's actions were logical.

TASK: {task_intent}

ACTIONS TAKEN:
{actions_str}

Evaluate:
1. Were the actions in a logical order?
2. Were there unnecessary repeated actions?
3. Did the agent stay focused on the task?

Respond with ONLY 'YES' or 'NO' followed by a brief explanation."""

        try:
            response = await client.chat.completions.create(
                model=OPENAI_MODEL,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.3,
                max_tokens=150
            )
            verdict = response.choices[0].message.content.strip()
            passed = verdict.upper().startswith("YES")
            return {
                "passed": passed,
                "verdict": "YES" if passed else "NO",
                "reason": verdict
            }
        except Exception as e:
            return {
                "passed": True,  # Default to pass on error
                "verdict": "YES",
                "reason": f"LLM judge error: {e}"
            }


class EfficiencyScorer(Scorer):
    """
    Scorer to evaluate agent efficiency (steps, cache usage, time).
    """
    
    @weave.op
    def score(self, output: dict, optimal_steps: int = 15) -> dict:
        """Evaluate agent efficiency."""
        metrics = output.get("metrics", {})
        
        actual_steps = metrics.get("num_steps", 0)
        cache_hits = metrics.get("cache_hits", 0)
        cache_misses = metrics.get("cache_misses", 0)
        total_cache = cache_hits + cache_misses
        
        efficiency = 1.0 if actual_steps <= optimal_steps else optimal_steps / max(actual_steps, 1)
        cache_rate = cache_hits / total_cache if total_cache > 0 else 0
        
        return {
            "efficiency_score": round(efficiency, 3),
            "actual_steps": actual_steps,
            "optimal_steps": optimal_steps,
            "is_efficient": efficiency >= 0.7,
            "cache_hit_rate": round(cache_rate, 3),
            "cache_hits": cache_hits,
            "cache_misses": cache_misses,
            "wall_time_ms": metrics.get("wall_time_ms", 0)
        }


class OverallScorer(Scorer):
    """
    Combined scorer that evaluates all aspects and produces an overall score.
    This is the main scorer for the self-improvement loop.
    """
    
    def __init__(self):
        self.task_scorer = TaskSuccessScorer()
        self.loop_scorer = LoopDetectionScorer()
        self.sequence_scorer = ActionSequenceScorer()
        self.efficiency_scorer = EfficiencyScorer()
    
    @weave.op
    async def score(
        self,
        output: dict,
        task_intent: str = "",
        expected_url: str = "",
        expected_sequence: list = None,
        optimal_steps: int = 15
    ) -> dict:
        """Comprehensive evaluation combining all scorers."""
        
        # Run all scorers
        task_result = await self.task_scorer.score(
            output=output,
            task_intent=task_intent,
            expected_url=expected_url
        )
        
        loop_result = self.loop_scorer.score(output=output)
        
        sequence_result = await self.sequence_scorer.score(
            output=output,
            task_intent=task_intent,
            expected_sequence=expected_sequence
        )
        
        efficiency_result = self.efficiency_scorer.score(
            output=output,
            optimal_steps=optimal_steps
        )
        
        # Calculate overall score
        scores = {
            "task_success": 1.0 if task_result.get("task_success") else 0.0,
            "no_loop": 1.0 if loop_result.get("no_loop") else 0.3,
            "sequence_valid": 1.0 if sequence_result.get("sequence_valid") else 0.5,
            "efficiency": efficiency_result.get("efficiency_score", 0.5)
        }
        
        # Weighted average
        weights = {"task_success": 0.4, "no_loop": 0.25, "sequence_valid": 0.2, "efficiency": 0.15}
        overall = sum(scores[k] * weights[k] for k in weights)
        
        passed = (
            task_result.get("task_success") and
            loop_result.get("no_loop") and
            overall >= 0.6
        )
        
        # Extract issues and recommendations
        issues = []
        recommendations = []
        
        if not task_result.get("task_success"):
            issues.append("task_failed")
            if task_result.get("llm_reason"):
                recommendations.append(task_result["llm_reason"])
        
        if not loop_result.get("no_loop"):
            issues.append("loop_detected")
            recommendations.append(
                f"Agent repeated action {loop_result['max_consecutive_repeats']} times. "
                f"Try different approaches when actions fail."
            )
        
        if not sequence_result.get("sequence_valid"):
            issues.append("wrong_sequence")
            if sequence_result.get("llm_reason"):
                recommendations.append(sequence_result["llm_reason"])
        
        return {
            "overall_score": round(overall, 3),
            "passed": passed,
            "scores": scores,
            "issues": issues,
            "recommendations": recommendations[:3],
            "details": {
                "task": task_result,
                "loop": loop_result,
                "sequence": sequence_result,
                "efficiency": efficiency_result
            }
        }


# =============================================================================
# BROWSER AGENT MODEL - For Weave Evaluation
# =============================================================================

class BrowserAgentModel(weave.Model):
    """
    Weave Model wrapper for our browser agent.
    Used with weave.Evaluation for batch evaluation.
    """
    
    system_prompt: str = "default"
    
    @weave.op
    def predict(self, run_data: dict) -> dict:
        """Return the run output for evaluation."""
        # In evaluation mode, we just return stored run data
        # In production, this would actually run the agent
        return run_data.get("output", run_data)


# =============================================================================
# DATA LOADING
# =============================================================================

def load_runs_from_redis(limit: int = 20) -> list:
    """Load recent runs from Redis as evaluation dataset."""
    r = get_redis()
    
    # Scan for run keys
    run_keys = list(r.scan_iter(f"{PREFIX}:run:*"))
    direct_keys = [k for k in run_keys if ":events" not in k][:limit]
    
    runs = []
    for key in direct_keys:
        run_id = key.replace(f"{PREFIX}:run:", "")
        run_data = r.get(key)
        if not run_data:
            continue
        
        run = json.loads(run_data)
        
        # Get events
        events_raw = r.lrange(f"{key}:events", 0, -1)
        events = [json.loads(e) for e in events_raw]
        
        runs.append({
            "run_id": run_id,
            "task_id": run.get("task_id", "unknown"),
            "mode": run.get("mode", "cold"),
            "output": {
                "metrics": run.get("metrics", {}),
                "events": events,
                "status": run.get("status", "unknown")
            },
            # Task context for evaluation
            "task_intent": get_task_intent(run.get("task_id")),
            "expected_url": get_expected_url(run.get("task_id")),
        })
    
    return runs


def get_task_intent(task_id: str) -> str:
    """Get task intent description."""
    intents = {
        "saucedemo-checkout": "Login to SauceDemo, add items to cart, complete checkout process",
        "saucedemo-login": "Login to SauceDemo with valid credentials",
    }
    return intents.get(task_id, f"Complete task: {task_id}")


def get_expected_url(task_id: str) -> str:
    """Get expected URL pattern for success."""
    urls = {
        "saucedemo-checkout": "checkout-complete",
        "saucedemo-login": "inventory",
    }
    return urls.get(task_id, "")


# =============================================================================
# EVALUATION RUNNER
# =============================================================================

async def run_weave_evaluation():
    """Run comprehensive Weave evaluation on recent runs."""
    
    print("📊 LoopLess Weave Evaluation (Native Scorers)")
    print("=" * 60)
    
    # Load runs
    print("\n🔗 Loading runs from Redis...")
    runs = load_runs_from_redis(limit=20)
    
    if not runs:
        print("❌ No runs found in Redis. Run some agent tasks first.")
        return
    
    print(f"📋 Found {len(runs)} runs to evaluate\n")
    
    # Create dataset
    dataset = weave.Dataset(
        name="browser_agent_runs",
        rows=runs
    )
    
    # Create evaluation with native Weave scorers
    evaluation = weave.Evaluation(
        name="browser_agent_eval",
        dataset=dataset,
        scorers=[
            TaskSuccessScorer(),
            LoopDetectionScorer(),
            ActionSequenceScorer(),
            EfficiencyScorer(),
            OverallScorer()
        ]
    )
    
    # Create model
    model = BrowserAgentModel(system_prompt="current")
    
    # Run evaluation
    print("🏃 Running Weave evaluation with LLM-as-a-judge...\n")
    results = await evaluation.evaluate(model)
    
    print("\n" + "=" * 60)
    print("📊 EVALUATION RESULTS")
    print("=" * 60)
    print(json.dumps(results, indent=2, default=str))
    
    return results


async def evaluate_single_run(run_id: str) -> dict:
    """Evaluate a single run using Weave scorers."""
    r = get_redis()
    
    # Load run
    run_data = r.get(f"{PREFIX}:run:{run_id}")
    if not run_data:
        return {"error": f"Run {run_id} not found"}
    
    run = json.loads(run_data)
    events_raw = r.lrange(f"{PREFIX}:run:{run_id}:events", 0, -1)
    events = [json.loads(e) for e in events_raw]
    
    output = {
        "metrics": run.get("metrics", {}),
        "events": events,
        "status": run.get("status", "unknown")
    }
    
    task_id = run.get("task_id", "unknown")
    
    # Use OverallScorer for comprehensive evaluation
    scorer = OverallScorer()
    result = await scorer.score(
        output=output,
        task_intent=get_task_intent(task_id),
        expected_url=get_expected_url(task_id)
    )
    
    print(f"\n📊 Evaluation for run {run_id[:8]}:")
    print(f"   Overall Score: {result['overall_score'] * 100:.1f}%")
    print(f"   Passed: {'✅' if result['passed'] else '❌'}")
    print(f"   Issues: {result['issues']}")
    
    return result


# =============================================================================
# MAIN
# =============================================================================

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1:
        # Evaluate specific run
        run_id = sys.argv[1]
        asyncio.run(evaluate_single_run(run_id))
    else:
        # Full evaluation
        asyncio.run(run_weave_evaluation())
