/**
 * Weave API Client - Query evaluations and feedback directly from Weave
 * 
 * This module provides direct access to Weave's API to:
 * 1. Query past run traces
 * 2. Get evaluation feedback and scores
 * 3. Retrieve LLM judge results
 * 
 * API Reference: https://docs.wandb.ai/weave/reference/service-api/calls/
 */

import { config } from "../config.js";

const WEAVE_API_BASE = "https://trace.wandb.ai";

interface WeaveCall {
  id: string;
  project_id: string;
  op_name: string;
  trace_id: string;
  parent_id: string | null;
  started_at: string;
  ended_at: string | null;
  inputs: Record<string, unknown>;
  output: unknown;
  summary?: Record<string, unknown>;
  feedback?: WeaveFeedback[];
}

interface WeaveFeedback {
  id: string;
  created_at: string;
  feedback_type: string;
  payload: Record<string, unknown>;
  note?: string;
  // For LLM judge results
  runnable_ref?: string;
  output?: {
    passed?: boolean;
    score?: number;
    reason?: string;
  };
}

interface CallsQueryRequest {
  project_id: string;
  filter?: {
    op_names?: string[];
    trace_ids?: string[];
    input_refs?: string[];
    call_ids?: string[];
  };
  limit?: number;
  offset?: number;
  sort_by?: Array<{ field: string; direction: "asc" | "desc" }>;
  include_feedback?: boolean;
  columns?: string[];
}

interface CallsQueryResponse {
  calls: WeaveCall[];
}

/**
 * WeaveAPIClient - Direct access to Weave's query API
 */
export class WeaveAPIClient {
  private apiKey: string;
  private projectId: string;

  constructor() {
    this.apiKey = config.WANDB_API_KEY || "";
    // Format: entity/project
    this.projectId = config.WEAVE_PROJECT || "loopless";
  }

  /**
   * Query calls from Weave with filters
   */
  async queryCalls(options: {
    opNames?: string[];
    limit?: number;
    includeFeedback?: boolean;
  }): Promise<WeaveCall[]> {
    if (!this.apiKey) {
      console.warn("[WeaveClient] No WANDB_API_KEY - returning empty results");
      return [];
    }

    try {
      const request: CallsQueryRequest = {
        project_id: this.projectId,
        filter: options.opNames ? { op_names: options.opNames } : undefined,
        limit: options.limit || 50,
        include_feedback: options.includeFeedback ?? true,
        sort_by: [{ field: "started_at", direction: "desc" }],
      };

      const response = await fetch(`${WEAVE_API_BASE}/calls/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${Buffer.from(`api:${this.apiKey}`).toString("base64")}`,
        },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        const error = await response.text();
        console.warn(`[WeaveClient] Query failed: ${response.status} - ${error}`);
        return [];
      }

      const data = (await response.json()) as CallsQueryResponse;
      return data.calls || [];
    } catch (err) {
      console.warn("[WeaveClient] Query error:", err);
      return [];
    }
  }

  /**
   * Get evaluation results from Weave
   * Looks for browserAgentEvaluation ops and their feedback
   */
  async getEvaluationResults(limit: number = 30): Promise<EvaluationResult[]> {
    const calls = await this.queryCalls({
      opNames: ["browserAgentEvaluation", "score_task_success", "overallScorer"],
      limit,
      includeFeedback: true,
    });

    return calls.map(call => this.parseEvaluationCall(call)).filter(Boolean) as EvaluationResult[];
  }

  /**
   * Get failure analysis from past runs
   * This is the key function for self-improvement
   */
  async getFailureAnalysis(taskId?: string): Promise<FailureAnalysis> {
    const evaluations = await this.getEvaluationResults(50);
    
    // Filter by task if specified
    const filtered = taskId 
      ? evaluations.filter(e => e.taskId === taskId)
      : evaluations;

    const failures = filtered.filter(e => !e.passed);
    
    // Aggregate issues
    const issueMap = new Map<string, { count: number; examples: string[] }>();
    const recommendations: string[] = [];

    for (const failure of failures) {
      for (const issue of failure.issues) {
        const existing = issueMap.get(issue) || { count: 0, examples: [] };
        existing.count++;
        if (existing.examples.length < 3 && failure.recommendations[0]) {
          existing.examples.push(failure.recommendations[0]);
        }
        issueMap.set(issue, existing);
      }
      
      // Collect unique recommendations
      for (const rec of failure.recommendations.slice(0, 2)) {
        if (!recommendations.includes(rec)) {
          recommendations.push(rec);
        }
      }
    }

    // Get LLM judge feedback if available
    const llmFeedback = await this.getLLMJudgeFeedback(taskId);

    return {
      taskId: taskId || "all",
      totalRuns: filtered.length,
      failedRuns: failures.length,
      successRate: filtered.length > 0 
        ? (filtered.length - failures.length) / filtered.length 
        : 0,
      commonIssues: Array.from(issueMap.entries())
        .map(([issue, data]) => ({ issue, ...data }))
        .sort((a, b) => b.count - a.count),
      recommendations: recommendations.slice(0, 5),
      llmJudgeFeedback: llmFeedback,
    };
  }

  /**
   * Get LLM-as-judge feedback from Weave evaluations
   */
  async getLLMJudgeFeedback(taskId?: string): Promise<LLMJudgeFeedback[]> {
    // Query for LLM judge evaluation calls
    const calls = await this.queryCalls({
      opNames: [
        "llm_judge_eval",
        "llmJudgeEvaluation", 
        "LLMJudgeScorer",
        "eval_llm_response",
      ],
      limit: 30,
      includeFeedback: true,
    });

    const feedback: LLMJudgeFeedback[] = [];

    for (const call of calls) {
      // Extract task ID from inputs
      const callTaskId = (call.inputs as { taskId?: string; task_id?: string })?.taskId 
        || (call.inputs as { taskId?: string; task_id?: string })?.task_id;
      
      if (taskId && callTaskId !== taskId) continue;

      // Parse LLM judge output
      const output = call.output as {
        passed?: boolean;
        verdict?: string;
        reason?: string;
        score?: number;
        feedback?: string;
      } | null;

      if (output) {
        feedback.push({
          callId: call.id,
          taskId: callTaskId || "unknown",
          timestamp: call.started_at,
          passed: output.passed ?? output.verdict?.toUpperCase().startsWith("YES") ?? false,
          verdict: output.verdict || (output.passed ? "YES" : "NO"),
          reason: output.reason || output.feedback || "",
          score: output.score,
        });
      }
    }

    return feedback;
  }

  /**
   * Parse a Weave call into an evaluation result
   */
  private parseEvaluationCall(call: WeaveCall): EvaluationResult | null {
    try {
      const inputs = call.inputs as {
        runId?: string;
        taskId?: string;
        scores?: Record<string, number>;
        passed?: boolean;
        issues?: string[];
        recommendations?: string[];
      };

      const output = call.output as typeof inputs | null;
      const data = output || inputs;

      if (!data) return null;

      return {
        callId: call.id,
        runId: data.runId || call.trace_id,
        taskId: data.taskId || "unknown",
        timestamp: call.started_at,
        passed: data.passed ?? false,
        scores: data.scores || {},
        issues: data.issues || [],
        recommendations: data.recommendations || [],
        feedback: call.feedback || [],
      };
    } catch {
      return null;
    }
  }
}

export interface EvaluationResult {
  callId: string;
  runId: string;
  taskId: string;
  timestamp: string;
  passed: boolean;
  scores: Record<string, number>;
  issues: string[];
  recommendations: string[];
  feedback: WeaveFeedback[];
}

export interface FailureAnalysis {
  taskId: string;
  totalRuns: number;
  failedRuns: number;
  successRate: number;
  commonIssues: Array<{
    issue: string;
    count: number;
    examples: string[];
  }>;
  recommendations: string[];
  llmJudgeFeedback: LLMJudgeFeedback[];
}

export interface LLMJudgeFeedback {
  callId: string;
  taskId: string;
  timestamp: string;
  passed: boolean;
  verdict: string;
  reason: string;
  score?: number;
}

// Singleton instance
let weaveClient: WeaveAPIClient | null = null;

export function getWeaveClient(): WeaveAPIClient {
  if (!weaveClient) {
    weaveClient = new WeaveAPIClient();
  }
  return weaveClient;
}
