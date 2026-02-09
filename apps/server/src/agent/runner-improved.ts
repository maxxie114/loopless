/**
 * Improved Agent Runner with:
 * 1. Sequence-aware macro caching
 * 2. LLM-as-a-judge feedback loop
 * 3. Better prompt engineering
 * 4. Self-improvement via feedback injection
 */

import { Stagehand } from "@browserbasehq/stagehand";
import Browserbase from "@browserbasehq/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { config } from "../config.js";
import {
  getMacro,
  setMacro,
  setRun,
  appendRunEvent,
  getRun,
} from "../redis.js";
import {
  runTaskWeave,
  buildStateWeave,
  planStepWeave,
  executeActionWeave,
  validateProgressWeave,
  learnMacroWeave,
} from "../weave.js";
import { getTask } from "../tasks.js";
import {
  computePageSignature,
  getHostname,
  getPathname,
} from "../page-signature.js";
import {
  getSequenceMacro,
  saveSequenceMacro,
  markMacroFailed,
  type SequenceContext,
} from "../macro-sequence.js";
import {
  evaluateAction,
  evaluateRun,
  evaluateStepProgress,
  generateImprovedPrompt,
  type JudgeResult,
} from "../evaluation/llm-judge-improved.js";
import type {
  RunMeta,
  RunMetrics,
  RunMode,
  Macro,
  Task,
  PageState,
  PlannedAction,
} from "@loopless/shared";
import { randomUUID } from "crypto";

// BrowserBase client
let _browserbase: Browserbase | null = null;
function getBrowserbase(): Browserbase {
  if (!_browserbase) {
    if (!config.BROWSERBASE_API_KEY) {
      throw new Error("BROWSERBASE_API_KEY is required");
    }
    _browserbase = new Browserbase({ apiKey: config.BROWSERBASE_API_KEY });
  }
  return _browserbase;
}

async function getLiveViewUrl(sessionId: string): Promise<string | undefined> {
  try {
    const bb = getBrowserbase();
    const debugUrls = await bb.sessions.debug(sessionId);
    return debugUrls.debuggerFullscreenUrl;
  } catch (err) {
    console.warn("[BrowserBase] Failed to get live view URL:", err);
    return undefined;
  }
}

// LLM clients
let _openai: OpenAI | null = null;
let _googleAI: GoogleGenerativeAI | null = null;

function getOpenAI(): OpenAI {
  if (!_openai) {
    const apiKey = config.OPENAI_API_KEY ?? config.WANDB_INFERENCE_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY or WANDB_INFERENCE_API_KEY is required");
    }
    _openai = new OpenAI({
      apiKey,
      baseURL:
        config.LLM_PROVIDER === "wandb_inference"
          ? config.WANDB_INFERENCE_BASE_URL
          : undefined,
    });
  }
  return _openai;
}

function getGoogleAI(): GoogleGenerativeAI {
  if (!_googleAI) {
    const apiKey = config.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error("GOOGLE_API_KEY is required for Gemini models");
    }
    _googleAI = new GoogleGenerativeAI(apiKey);
  }
  return _googleAI;
}

export type RunEmitter = (event: {
  type: string;
  payload: Record<string, unknown>;
}) => void;

export type RunResult = {
  runId: string;
  status: RunMeta["status"];
  metrics: RunMetrics;
  error?: string;
  coldRunId?: string;
  warmRunId?: string;
};

function defaultEmitter(): RunEmitter {
  return () => {};
}

// Store feedback across runs for self-improvement
const feedbackStore: Array<{
  taskId: string;
  wrongAction: string;
  correctAction: string;
  context: string;
}> = [];

export async function runTask(
  taskId: string,
  mode: RunMode,
  overrides: Record<string, unknown> | undefined,
  emit: RunEmitter = defaultEmitter,
  providedRunId?: string
): Promise<RunResult> {
  if (mode === "twice") {
    const cold = await runTask(taskId, "cold", overrides, emit);
    const warm = await runTask(taskId, "warm", overrides, emit);
    return {
      runId: cold.runId,
      status: cold.metrics.success && warm.metrics.success ? "finished" : "failed",
      metrics: cold.metrics,
      coldRunId: cold.runId,
      warmRunId: warm.runId,
    };
  }

  const task = getTask(taskId);
  if (!task) throw new Error(`Unknown task: ${taskId}`);
  const runId = providedRunId || randomUUID();
  const useMacros = mode === "warm";
  const startTime = Date.now();

  const metrics: RunMetrics = {
    success: false,
    wall_time_ms: 0,
    num_steps: 0,
    num_llm_calls: 0,
    num_observe_calls: 0,
    num_retries: 0,
    num_loop_detected: 0,
    num_loop_broken: 0,
    cache_hits: 0,
    cache_misses: 0,
    avg_action_latency_ms: 0,
  };

  const meta: RunMeta = {
    run_id: runId,
    task_id: taskId,
    mode,
    status: "running",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await setRun(runId, meta);

  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  STARTING RUN: ${runId.slice(0, 8)} | Mode: ${mode.toUpperCase()}`);
  console.log(`  Task: ${task.name}`);
  console.log(`═══════════════════════════════════════════\n`);

  const startEvent = { type: "run_started", payload: { run_id: runId, task_id: taskId, mode } };
  emit(startEvent);
  await appendRunEvent(runId, startEvent);

  let stagehand: Stagehand | null = null;
  const signatureHistory: string[] = [];
  const latencies: number[] = [];
  const actionHistory: string[] = [];
  let lastSuccessfulMacro: { ctx: SequenceContext; action: string } | null = null;

  // Build improved prompt with feedback
  const improvedPrompt = await buildImprovedPrompt(task, mode);

  try {
    await runTaskWeave({ task_id: taskId, mode, run_id: runId });

    let stagehandModel: string;
    if (config.LLM_PROVIDER === "google") {
      stagehandModel = config.LLM_MODEL.startsWith("google/") 
        ? config.LLM_MODEL 
        : `google/${config.LLM_MODEL}`;
    } else if (config.LLM_MODEL.startsWith("gpt")) {
      stagehandModel = `openai/${config.LLM_MODEL}`;
    } else {
      stagehandModel = config.LLM_MODEL;
    }

    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: config.BROWSERBASE_API_KEY,
      projectId: config.BROWSERBASE_PROJECT_ID ?? "",
      model: stagehandModel,
    });
    await stagehand.init();

    const page = stagehand.context.pages()[0];
    if (!page) throw new Error("No page");
    
    let sessionId: string | undefined;
    const browserContext = stagehand.context as unknown as { 
      _browserbaseSessionId?: string;
      browserbaseSessionId?: string;
      sessionId?: string;
    };
    sessionId = browserContext._browserbaseSessionId 
      || browserContext.browserbaseSessionId 
      || browserContext.sessionId;
    
    const stagehandAny = stagehand as unknown as { 
      browserbaseSessionId?: string;
      sessionId?: string;
      _sessionId?: string;
    };
    sessionId = sessionId || stagehandAny.browserbaseSessionId 
      || stagehandAny.sessionId 
      || stagehandAny._sessionId;
    
    metrics.browserbase_session_id = sessionId;
    metrics.recording_url = sessionId
      ? `https://www.browserbase.com/sessions/${sessionId}`
      : undefined;

    if (sessionId) {
      try {
        const liveViewUrl = await getLiveViewUrl(sessionId);
        if (liveViewUrl) {
          metrics.live_view_url = liveViewUrl;
          emit({
            type: "live_view_ready",
            payload: { run_id: runId, live_view_url: liveViewUrl, session_id: sessionId },
          });
          console.log(`[BrowserBase] Live view: ${liveViewUrl}`);
        }
      } catch (err) {
        console.warn(`[BrowserBase] Failed to get live view:`, err);
      }
    }

    await page.goto(task.start_url, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 1500));

    let step = 0;
    let lastUrl = "";
    let lastSig = "";
    let consecutiveErrors = 0;

    while (step < task.max_steps) {
      const url = page.url();
      if (url !== lastUrl) lastUrl = url;

      const state = await buildPageState(stagehand, url, "");
      const pageSig = computePageSignature(
        getHostname(url),
        getPathname(url),
        state.headings[0] ?? "",
        state.form_labels,
        state.primary_button_texts
      );

      await buildStateWeave({ url: state.url, title: state.title, page_sig: pageSig, step });

      const success = await checkSuccess(page, task, url);
      if (success) {
        metrics.success = true;
        metrics.final_url = url;
        metrics.num_steps = step;
        metrics.wall_time_ms = Date.now() - startTime;
        metrics.avg_action_latency_ms =
          latencies.length > 0
            ? latencies.reduce((a, b) => a + b, 0) / latencies.length
            : 0;
        meta.status = "finished";
        meta.metrics = metrics;
        meta.updated_at = new Date().toISOString();
        await setRun(runId, meta);
        
        emit({ type: "run_finished", payload: { run_id: runId, metrics, final_url: url } });
        await appendRunEvent(runId, { type: "run_finished", payload: { metrics, final_url: url } });
        await validateProgressWeave({ progress: true, success: true, final_url: url });
        
        console.log(`\n✅ RUN COMPLETED SUCCESSFULLY in ${(metrics.wall_time_ms / 1000).toFixed(1)}s`);
        console.log(`   Steps: ${metrics.num_steps} | LLM Calls: ${metrics.num_llm_calls} | Cache Hits: ${metrics.cache_hits}\n`);
        break;
      }

      let action: PlannedAction;
      
      // Check for loop state
      const recentActions = actionHistory.slice(-3);
      const isRepeating = recentActions.length >= 3 && 
        recentActions.every(a => a === recentActions[0]);
      const loopCount = signatureHistory.filter((s) => s === pageSig).length;
      const inLoopState = isRepeating || loopCount >= 3;
      
      if (inLoopState) {
        console.log(`[Agent] 🔄 Loop detected (step ${step}), breaking...`);
        metrics.num_loop_detected++;
        await page.reload().catch(() => {});
        metrics.num_loop_broken++;
        await new Promise((r) => setTimeout(r, 1000));
      }
      
      // Try sequence-aware macro
      const seqCtx: SequenceContext = {
        domain: task.domain,
        intent: task.intent,
        currentUrl: url,
        actionHistory: [...actionHistory],
        pageTitle: state.title,
      };
      
      const macro = useMacros && !inLoopState 
        ? await getSequenceMacro(seqCtx)
        : null;
      
      if (macro && useMacros) {
        // Validate with LLM judge before using
        const judgeResult = await evaluateAction(
          task.description,
          url,
          actionHistory,
          macro.action,
          state.actionable_labels
        );
        
        if (judgeResult.passed && judgeResult.score > 0.7) {
          action = {
            action: macro.action,
            cache_hit: true,
            source: "macro",
          };
          metrics.cache_hits++;
          console.log(`[Agent] ✅ Using macro (step ${step}): ${action.action.slice(0, 50)}... (score: ${judgeResult.score.toFixed(2)})`);
          lastSuccessfulMacro = { ctx: seqCtx, action: macro.action };
        } else {
          console.log(`[Agent] ⚠️ Macro rejected by judge: ${judgeResult.reasoning.slice(0, 80)}`);
          metrics.cache_misses++;
          const llmStart = Date.now();
          const planned = await planStepWithLLM(task, state, step, actionHistory, improvedPrompt);
          metrics.num_llm_calls++;
          action = { action: planned, cache_hit: false, source: "llm" };
          latencies.push(Date.now() - llmStart);
          
          // Store feedback for improvement
          if (lastSuccessfulMacro) {
            feedbackStore.push({
              taskId: task.id,
              wrongAction: macro.action,
              correctAction: planned,
              context: `URL: ${url}, Step: ${step}`,
            });
          }
        }
      } else {
        metrics.cache_misses++;
        const llmStart = Date.now();
        const planned = await planStepWithLLM(task, state, step, actionHistory, improvedPrompt);
        metrics.num_llm_calls++;
        action = { action: planned, cache_hit: false, source: "llm" };
        latencies.push(Date.now() - llmStart);
      }
      
      actionHistory.push(action.action);

      await planStepWeave({
        state: { url: state.url, page_sig: pageSig },
        candidates: state.actionable_labels,
        cache_hit: action.cache_hit,
        action: action.action,
        latency_ms: latencies[latencies.length - 1],
      });

      emit({
        type: "step_planned",
        payload: { step, action: action.action, cache_hit: action.cache_hit, page_sig: pageSig },
      });
      await appendRunEvent(runId, {
        type: "step_planned",
        payload: { step, action: action.action, cache_hit: action.cache_hit },
      });

      // Execute action
      const execStart = Date.now();
      metrics.num_observe_calls++;
      
      try {
        const suggestions = await stagehand.observe(action.action);
        if (suggestions.length > 0) {
          await stagehand.act(suggestions[0]);
        }
        consecutiveErrors = 0;
      } catch (err) {
        console.warn(`[Agent] ⚠️ Action failed: ${err}`);
        consecutiveErrors++;
        if (consecutiveErrors >= 3) {
          throw new Error("Too many consecutive action failures");
        }
        // Mark macro as failed if we were using one
        if (action.cache_hit && lastSuccessfulMacro) {
          await markMacroFailed(lastSuccessfulMacro.ctx);
        }
      }
      
      const execLatency = Date.now() - execStart;
      latencies.push(execLatency);

      const urlAfter = page.url();
      await executeActionWeave({
        action: action.action,
        url_before: url,
        url_after: urlAfter,
        latency_ms: execLatency,
      });

      emit({
        type: "step_executed",
        payload: { step, action: action.action, url_before: url, url_after: urlAfter, latency_ms: execLatency },
      });
      await appendRunEvent(runId, {
        type: "step_executed",
        payload: { step, action: action.action, url_after: urlAfter },
      });

      // Evaluate progress
      const progress = urlAfter !== url || pageSig !== lastSig;
      lastSig = pageSig;
      signatureHistory.push(pageSig);
      
      // Save macro if this was a successful LLM-planned action
      if (!action.cache_hit && progress && step > 0) {
        await saveSequenceMacro(seqCtx, action.action, `Step ${step} at ${url}`);
      }

      await validateProgressWeave({ progress, success: false, final_url: urlAfter });

      emit({ type: "step_validated", payload: { step, progress, url_after: urlAfter } });
      await appendRunEvent(runId, { type: "step_validated", payload: { step, progress, url_after: urlAfter } });

      step++;
      metrics.num_steps = step;
      await new Promise((r) => setTimeout(r, 800));
    }

    if (!metrics.success) {
      metrics.wall_time_ms = Date.now() - startTime;
      metrics.avg_action_latency_ms =
        latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
      meta.status = "finished";
      meta.metrics = metrics;
      meta.updated_at = new Date().toISOString();
      await setRun(runId, meta);
      emit({ type: "run_finished", payload: { run_id: runId, metrics } });
      await appendRunEvent(runId, { type: "run_finished", payload: { metrics } });
      
      console.log(`\n❌ RUN FAILED after ${(metrics.wall_time_ms / 1000).toFixed(1)}s`);
      console.log(`   Steps: ${metrics.num_steps} | Success: ${metrics.success}\n`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    metrics.wall_time_ms = Date.now() - startTime;
    meta.status = "failed";
    meta.error = message;
    meta.metrics = metrics;
    meta.updated_at = new Date().toISOString();
    await setRun(runId, meta);
    emit({ type: "run_failed", payload: { run_id: runId, error: message } });
    await appendRunEvent(runId, { type: "run_failed", payload: { error: message } });
    
    console.log(`\n💥 RUN CRASHED: ${message}\n`);
  } finally {
    if (stagehand) await stagehand.close().catch(() => {});
  }

  // Post-run evaluation with LLM judge
  try {
    const events = await getRunEvents(runId);
    const judgeResult = await evaluateRun(
      task.description,
      JSON.stringify(task.success_condition),
      events,
      metrics.success
    );
    
    console.log(`\n📊 LLM Judge Evaluation:`);
    console.log(`   Score: ${(judgeResult.score * 100).toFixed(0)}% | Passed: ${judgeResult.passed ? '✅' : '❌'}`);
    console.log(`   Reasoning: ${judgeResult.reasoning.slice(0, 100)}...`);
    if (judgeResult.suggestions.length > 0) {
      console.log(`   Suggestions:`);
      judgeResult.suggestions.forEach((s, i) => console.log(`     ${i + 1}. ${s.slice(0, 80)}`));
    }
    
    // Store feedback for future improvement
    for (const ae of judgeResult.actionEvaluations) {
      if (!ae.wasCorrect) {
        feedbackStore.push({
          taskId: task.id,
          wrongAction: ae.action,
          correctAction: ae.expectedAction,
          context: ae.feedback,
        });
      }
    }
  } catch (err) {
    console.warn("[LLMJudge] Post-run evaluation failed:", err);
  }

  return { runId, status: (await getRun(runId))?.status ?? "failed", metrics };
}

// Helper: Build improved prompt with feedback
async function buildImprovedPrompt(task: Task, mode: RunMode): Promise<string> {
  const basePrompt = await buildBasePrompt(task);
  
  if (mode !== "warm") return basePrompt;
  
  // Filter feedback for this task
  const taskFeedback = feedbackStore.filter(f => f.taskId === task.id);
  if (taskFeedback.length === 0) return basePrompt;
  
  // Generate improved prompt
  const improved = await generateImprovedPrompt(basePrompt, taskFeedback.slice(-5));
  
  if (improved !== basePrompt) {
    console.log(`[Self-Improve] ✅ Injected ${taskFeedback.length} feedback items into prompt`);
  }
  
  return improved;
}

// Helper: Build base prompt
async function buildBasePrompt(task: Task): Promise<string> {
  return `You are an expert browser automation agent. Be concise and efficient.

TASK: ${task.name}
DESCRIPTION: ${task.description}
SUCCESS CONDITION: ${JSON.stringify(task.success_condition)}

CRITICAL RULES:
1. NEVER repeat the same action twice - if it didn't work, try DIFFERENT elements
2. Fill ALL required form fields BEFORE clicking submit
3. Look for icons (cart, user) not just text
4. After adding items, click the CART ICON to proceed
5. Follow the workflow: Login → Add to Cart → Go to Cart → Checkout → Fill Form → Finish

WORKFLOW FOR SAUCEDEMO:
1. LOGIN: Type 'standard_user' → Type 'secret_sauce' → Click 'Login'
2. INVENTORY: Click 'Add to cart' on items → Click SHOPPING CART ICON
3. CART: Click 'Checkout' button
4. CHECKOUT: Fill First Name, Last Name, Zip Code → Click 'Continue'
5. OVERVIEW: Click 'Finish' button
6. COMPLETE: Should see 'THANK YOU FOR YOUR ORDER'

Respond with exactly ONE action. Examples:
- "type 'standard_user' in the Username field"
- "click 'Add to cart' for Sauce Labs Backpack"
- "click the shopping cart icon"
- "click 'Checkout'"

Only output the action, no explanation.`;
}

// Helper: Plan step with LLM
async function planStepWithLLM(
  task: Task,
  state: PageState,
  step: number,
  actionHistory: string[],
  systemPrompt: string
): Promise<string> {
  const historyContext = actionHistory.slice(-5).length > 0 
    ? `\nRecent actions: ${actionHistory.slice(-5).join(" → ")}`
    : "";
  
  const userPrompt = `Step ${step}. Page: "${state.title}". URL: ${state.url}
Actionable elements: ${state.actionable_labels.slice(0, 10).join(", ") || "unknown"}${historyContext}

What is the next action?`;

  if (config.LLM_PROVIDER === "google") {
    const genAI = getGoogleAI();
    const model = genAI.getGenerativeModel({ 
      model: config.LLM_MODEL,
      systemInstruction: systemPrompt,
    });
    const result = await model.generateContent(userPrompt);
    return result.response.text()?.trim() ?? "click the first button";
  }
  
  const res = await getOpenAI().chat.completions.create({
    model: config.LLM_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 100,
  });
  return res.choices[0]?.message?.content?.trim() ?? "click the first button";
}

// Helper: Build page state
async function buildPageState(
  stagehand: Stagehand,
  url: string,
  _lastAction: string
): Promise<PageState> {
  const page = stagehand.context.pages()[0];
  const title = await page.title();
  const observeResult = await stagehand.observe("List visible buttons and links - return their text labels");
  const labels: string[] = [];
  for (const item of observeResult) {
    if (typeof item === "string") labels.push(item);
    else if (item && typeof item === "object") {
      const o = item as { description?: string; text?: string; label?: string };
      labels.push(o.description ?? o.text ?? o.label ?? String(item));
    }
  }
  return {
    url,
    title,
    hostname: getHostname(url),
    pathname: getPathname(url),
    headings: [],
    actionable_labels: labels.slice(0, 15),
    form_labels: [],
    primary_button_texts: labels.slice(0, 5),
  };
}

// Helper: Check success
async function checkSuccess(
  page: { url: () => string; evaluate: (fn: () => string) => Promise<string> },
  task: Task,
  currentUrl: string
): Promise<boolean> {
  const url = currentUrl || page.url();
  if (task.success_condition.url_contains && url.includes(task.success_condition.url_contains))
    return true;
  if (task.success_condition.page_contains) {
    const bodyText = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    if (bodyText.toUpperCase().includes(task.success_condition.page_contains!.toUpperCase()))
      return true;
  }
  return false;
}

// Helper: Get run events
async function getRunEvents(runId: string): Promise<any[]> {
  // Import here to avoid circular dependency
  const { getRunEvents: getEvents } = await import("../redis.js");
  const rawEvents = await getEvents(runId);
  return rawEvents.map(e => {
    try { return JSON.parse(e); } catch { return null; }
  }).filter(Boolean);
}
