/**
 * Improved LLM-as-a-Judge System for Self-Improvement
 * 
 * This module provides:
 * 1. Real-time action evaluation
 * 2. Post-run analysis with feedback
 * 3. Prompt improvement suggestions
 * 4. Feedback injection into the agent's prompt
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import { config } from "../config.js";
import type { RunMeta, StepEvent } from "@loopless/shared";

// Lazy-init LLM clients
let _openai: OpenAI | null = null;
let _googleAI: GoogleGenerativeAI | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = config.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY required for LLM judge");
    _openai = new OpenAI({ apiKey });
  }
  return _openai;
}

function getGoogleAI(): GoogleGenerativeAI {
  if (!_googleAI) {
    const apiKey = config.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GOOGLE_API_KEY required for LLM judge");
    _googleAI = new GoogleGenerativeAI(apiKey);
  }
  return _googleAI;
}

export interface JudgeResult {
  passed: boolean;
  score: number; // 0-1
  reasoning: string;
  suggestions: string[];
  confidence: "high" | "medium" | "low";
}

export interface ActionEvaluation {
  action: string;
  wasCorrect: boolean;
  expectedAction: string;
  feedback: string;
}

/**
 * Evaluate a single action taken by the agent
 */
export async function evaluateAction(
  taskDescription: string,
  currentUrl: string,
  actionHistory: string[],
  proposedAction: string,
  availableElements: string[]
): Promise<JudgeResult> {
  const prompt = `You are an expert browser automation evaluator. Evaluate if the proposed action is correct.

TASK: ${taskDescription}
CURRENT URL: ${currentUrl}
ACTION HISTORY: ${actionHistory.slice(-5).join(" → ") || "None"}
AVAILABLE ELEMENTS: ${availableElements.slice(0, 10).join(", ")}

PROPOSED ACTION: "${proposedAction}"

Evaluate this action:
1. Is this the logical next step given the task and history?
2. Does the action target an available element?
3. Is there a better alternative action?

Respond in this exact format:
VERDICT: [PASS or FAIL]
SCORE: [0.0-1.0]
CONFIDENCE: [high/medium/low]
REASONING: [2-3 sentences explaining why]
SUGGESTIONS: [Better alternative action if FAIL, or "None" if PASS]`;

  try {
    const response = await callLLMJudge(prompt);
    return parseJudgeResponse(response);
  } catch (err) {
    console.warn("[LLMJudge] Action evaluation failed:", err);
    return { passed: true, score: 0.5, reasoning: "Evaluation failed", suggestions: [], confidence: "low" };
  }
}

/**
 * Evaluate a completed run and provide improvement suggestions
 */
export async function evaluateRun(
  taskDescription: string,
  expectedOutcome: string,
  events: StepEvent[],
  success: boolean
): Promise<JudgeResult & { actionEvaluations: ActionEvaluation[] }> {
  const actions = events
    .filter(e => e.type === "step_planned")
    .map(e => (e.payload as { action?: string }).action || "");
  
  const prompt = `You are an expert browser automation evaluator. Analyze this completed task.

TASK: ${taskDescription}
EXPECTED OUTCOME: ${expectedOutcome}
SUCCESS: ${success ? "Yes" : "No"}

ACTION SEQUENCE (${actions.length} steps):
${actions.map((a, i) => `${i + 1}. ${a}`).join("\n")}

Analyze:
1. Were the actions efficient and logical?
2. Were there any redundant or incorrect actions?
3. Could the task be completed in fewer steps?
4. What specific improvements would help future runs?

Respond in this exact format:
VERDICT: [PASS or FAIL]
SCORE: [0.0-1.0]
CONFIDENCE: [high/medium/low]
REASONING: [Detailed analysis]
SUGGESTIONS: [Specific actionable improvements, one per line]`;

  try {
    const response = await callLLMJudge(prompt);
    const result = parseJudgeResponse(response);
    
    // Also evaluate individual actions
    const actionEvaluations: ActionEvaluation[] = [];
    for (let i = 0; i < actions.length; i++) {
      const prevActions = actions.slice(0, i);
      const actionEval = await evaluateIndividualAction(
        taskDescription,
        prevActions,
        actions[i],
        actions[i + 1] // Next action as "expected"
      );
      actionEvaluations.push(actionEval);
    }
    
    return { ...result, actionEvaluations };
  } catch (err) {
    console.warn("[LLMJudge] Run evaluation failed:", err);
    return {
      passed: success,
      score: success ? 0.7 : 0.3,
      reasoning: "Evaluation failed",
      suggestions: [],
      confidence: "low",
      actionEvaluations: [],
    };
  }
}

/**
 * Generate improved system prompt based on past failures
 */
export async function generateImprovedPrompt(
  basePrompt: string,
  failureCases: Array<{
    taskDescription: string;
    wrongAction: string;
    correctAction: string;
    context: string;
  }>
): Promise<string> {
  if (failureCases.length === 0) return basePrompt;
  
  const prompt = `You are a prompt engineering expert. Improve this browser agent prompt based on failure cases.

CURRENT PROMPT:
${basePrompt}

FAILURE CASES:
${failureCases.map((f, i) => `
${i + 1}. Task: ${f.taskDescription}
   Wrong: "${f.wrongAction}"
   Correct: "${f.correctAction}"
   Context: ${f.context}
`).join("\n")}

Generate an improved prompt that:
1. Addresses the specific failure patterns
2. Adds clear rules to avoid these mistakes
3. Keeps the existing structure and workflow
4. Is concise but comprehensive

Return ONLY the improved prompt, no explanations.`;

  try {
    const improved = await callLLMJudge(prompt);
    return improved || basePrompt;
  } catch (err) {
    console.warn("[LLMJudge] Prompt improvement failed:", err);
    return basePrompt;
  }
}

/**
 * Evaluate if a step made progress toward the goal
 */
export async function evaluateStepProgress(
  taskDescription: string,
  urlBefore: string,
  urlAfter: string,
  action: string
): Promise<{ madeProgress: boolean; feedback: string }> {
  const prompt = `Evaluate if this browser action made progress toward the goal.

TASK: ${taskDescription}
ACTION: "${action}"
URL BEFORE: ${urlBefore}
URL AFTER: ${urlAfter}

Did this action make meaningful progress? Consider:
- URL changes (navigation)
- Form filling progress
- Page state changes

Respond:
PROGRESS: [YES or NO]
FEEDBACK: [Brief explanation]`;

  try {
    const response = await callLLMJudge(prompt);
    const madeProgress = response.toUpperCase().includes("PROGRESS: YES");
    const feedbackMatch = response.match(/FEEDBACK: (.+)/i);
    const feedback = feedbackMatch ? feedbackMatch[1].trim() : "No feedback";
    return { madeProgress, feedback };
  } catch (err) {
    return { madeProgress: true, feedback: "Evaluation failed" };
  }
}

// Helper: Call LLM for judgment
async function callLLMJudge(prompt: string): Promise<string> {
  if (config.LLM_PROVIDER === "google" && config.GOOGLE_API_KEY) {
    const genAI = getGoogleAI();
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } else if (config.OPENAI_API_KEY) {
    const res = await getOpenAI().chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    });
    return res.choices[0]?.message?.content?.trim() || "";
  }
  throw new Error("No LLM provider configured for judge");
}

// Helper: Parse judge response
function parseJudgeResponse(response: string): JudgeResult {
  const verdictMatch = response.match(/VERDICT:\s*(PASS|FAIL)/i);
  const scoreMatch = response.match(/SCORE:\s*(0?\.\d+|1\.0)/i);
  const confidenceMatch = response.match(/CONFIDENCE:\s*(high|medium|low)/i);
  const reasoningMatch = response.match(/REASONING:\s*(.+?)(?:\n\n|SUGGESTIONS:)/is);
  const suggestionsMatch = response.match(/SUGGESTIONS:\s*(.+)/is);
  
  const suggestions: string[] = [];
  if (suggestionsMatch) {
    suggestions.push(...suggestionsMatch[1]
      .split("\n")
      .map(s => s.replace(/^[-*]\s*/, "").trim())
      .filter(s => s && s.toLowerCase() !== "none"));
  }
  
  return {
    passed: verdictMatch?.[1].toUpperCase() === "PASS",
    score: parseFloat(scoreMatch?.[1] || "0.5"),
    reasoning: reasoningMatch?.[1].trim() || "No reasoning provided",
    suggestions,
    confidence: (confidenceMatch?.[1].toLowerCase() as "high" | "medium" | "low") || "medium",
  };
}

// Helper: Evaluate individual action
async function evaluateIndividualAction(
  taskDescription: string,
  prevActions: string[],
  action: string,
  nextAction?: string
): Promise<ActionEvaluation> {
  const prompt = `Evaluate this single action in a browser automation sequence.

TASK: ${taskDescription}
PREVIOUS ACTIONS: ${prevActions.join(" → ") || "None"}
CURRENT ACTION: "${action}"
NEXT ACTION: "${nextAction || "Unknown"}"

Was this action correct and efficient?

Respond:
CORRECT: [YES or NO]
EXPECTED: [What the action should have been if wrong]
FEEDBACK: [Brief feedback]`;

  try {
    const response = await callLLMJudge(prompt);
    const correct = response.toUpperCase().includes("CORRECT: YES");
    const expectedMatch = response.match(/EXPECTED:\s*(.+)/i);
    const feedbackMatch = response.match(/FEEDBACK:\s*(.+)/i);
    
    return {
      action,
      wasCorrect: correct,
      expectedAction: correct ? action : (expectedMatch?.[1].trim() || action),
      feedback: feedbackMatch?.[1].trim() || "No feedback",
    };
  } catch {
    return { action, wasCorrect: true, expectedAction: action, feedback: "Evaluation failed" };
  }
}
