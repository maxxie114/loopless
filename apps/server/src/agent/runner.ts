import { Stagehand } from "@browserbasehq/stagehand";
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
import { analyzeRun, formatLearningReport, generateImprovedPromptFromWeave } from "../evaluation/self-improve.js";
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

// Lazy-init LLM clients
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

export async function runTask(
  taskId: string,
  mode: RunMode,
  overrides: Record<string, unknown> | undefined,
  emit: RunEmitter = defaultEmitter
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
  const runId = randomUUID();
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
  emit({ type: "run_started", payload: { run_id: runId, task_id: taskId, mode } });

  let stagehand: Stagehand | null = null;
  const signatureHistory: string[] = [];
  const latencies: number[] = [];

  try {
    await runTaskWeave({
      task_id: taskId,
      mode,
      run_id: runId,
    });

    // Determine model format for Stagehand
    let stagehandModel: string;
    if (config.LLM_PROVIDER === "google") {
      // Stagehand expects google/model-name format
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
    const browserContext = stagehand.context as unknown as { _browserbaseSessionId?: string };
    if (browserContext._browserbaseSessionId) {
      sessionId = String(browserContext._browserbaseSessionId);
    }
    metrics.browserbase_session_id = sessionId;
    metrics.recording_url = sessionId
      ? `https://www.browserbase.com/sessions/${sessionId}`
      : undefined;

    await page.goto(task.start_url, { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 1500));

    let step = 0;
    let lastUrl = "";
    let lastSig = "";
    const actionHistory: string[] = []; // Track actions for loop prevention

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

      await buildStateWeave({
        url: state.url,
        title: state.title,
        page_sig: pageSig,
        step,
      });

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
        emit({
          type: "run_finished",
          payload: { run_id: runId, metrics, final_url: url },
        });
        await appendRunEvent(runId, {
          type: "run_finished",
          payload: { metrics, final_url: url },
        });
        await validateProgressWeave({ progress: true, success: true, final_url: url });
        break;
      }

      let action: PlannedAction;
      
      // Check if we're in a loop state - if so, skip macros and use LLM
      const recentActions = actionHistory.slice(-3);
      const isRepeating = recentActions.length >= 3 && 
        recentActions.every(a => a === recentActions[0]);
      const loopCount = signatureHistory.filter((s) => s === pageSig).length;
      const inLoopState = isRepeating || loopCount >= 2;
      
      // Try to use macro, but validate it makes sense for current page
      const macro = (useMacros && !inLoopState)
        ? await getMacro(task.domain, task.intent, pageSig)
        : null;
      
      // Validate macro action is relevant to current page elements
      let macroValid = false;
      if (macro && macro.actions.length > 0) {
        const macroAction = macro.actions[0].toLowerCase();
        const pageElements = state.actionable_labels.map(l => l.toLowerCase()).join(" ");
        
        // Check if the macro action mentions elements that exist on the page
        // or is a generic action that should work
        const genericActions = ["click", "scroll", "wait", "navigate", "go"];
        const isGenericAction = genericActions.some(g => macroAction.startsWith(g));
        const mentionsPageElement = state.actionable_labels.some(label => 
          macroAction.includes(label.toLowerCase().slice(0, 10)) ||
          label.toLowerCase().includes(macroAction.split(" ").slice(-1)[0]?.slice(0, 8) || "")
        );
        
        // For form actions, check if the form fields exist
        const isFormAction = macroAction.includes("type") || macroAction.includes("fill") || macroAction.includes("enter");
        const formFieldMentioned = isFormAction && (
          macroAction.includes("username") && pageElements.includes("user") ||
          macroAction.includes("password") && pageElements.includes("pass") ||
          macroAction.includes("first") && pageElements.includes("first") ||
          macroAction.includes("last") && pageElements.includes("last") ||
          macroAction.includes("zip") && pageElements.includes("zip")
        );
        
        macroValid = isGenericAction || mentionsPageElement || formFieldMentioned || !isFormAction;
      }
      
      if (macro && macro.actions.length > 0 && macroValid) {
        action = {
          action: macro.actions[0],
          cache_hit: true,
          source: "macro",
        };
        metrics.cache_hits++;
      } else {
        if (macro && !macroValid) {
          // Macro exists but isn't valid for current page state
          console.log(`[Agent] Skipping invalid macro for page state: ${macro.actions[0]?.slice(0, 50)}`);
        }
        metrics.cache_misses++;
        const llmStart = Date.now();
        const planned = await planStepWithLLM(task, state, step, actionHistory);
        metrics.num_llm_calls++;
        action = {
          action: planned,
          cache_hit: false,
          source: "llm",
        };
        latencies.push(Date.now() - llmStart);
      }
      
      // Track action for loop prevention
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
        payload: {
          step,
          action: action.action,
          cache_hit: action.cache_hit,
          page_sig: pageSig,
        },
      });
      await appendRunEvent(runId, {
        type: "step_planned",
        payload: { step, action: action.action, cache_hit: action.cache_hit },
      });

      const execStart = Date.now();
      metrics.num_observe_calls++;
      const suggestions = await stagehand.observe(action.action);
      if (suggestions.length > 0) {
        await stagehand.act(suggestions[0]);
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
        payload: {
          step,
          action: action.action,
          url_before: url,
          url_after: urlAfter,
          latency_ms: execLatency,
        },
      });
      await appendRunEvent(runId, {
        type: "step_executed",
        payload: { step, action: action.action, url_after: urlAfter },
      });

      const progress = urlAfter !== url || pageSig !== lastSig;
      lastSig = pageSig;
      signatureHistory.push(pageSig);

      // Improved loop detection and breaking
      const repeated = signatureHistory.filter((s) => s === pageSig).length;
      const sameActionRepeated = actionHistory.slice(-3).every(a => a === action.action);
      
      if ((repeated >= 3 || sameActionRepeated) && !progress) {
        metrics.num_loop_detected++;
        emit({
          type: "loop_detected",
          payload: { step, page_sig: pageSig, action: action.action },
        });
        
        // Try multiple loop-breaking strategies
        if (repeated >= 5) {
          // Too many loops on same page - try refreshing
          console.log(`[Agent] Breaking loop: refreshing page after ${repeated} repeats`);
          await page.reload().catch(() => {});
          metrics.num_loop_broken++;
        } else if (sameActionRepeated) {
          // Same action keeps failing - clear action history to force LLM to try something new
          console.log(`[Agent] Breaking loop: clearing action history to try new approach`);
          actionHistory.length = 0; // Clear history
          metrics.num_loop_broken++;
        } else {
          // Default: try going back
          console.log(`[Agent] Breaking loop: going back`);
          await page.goBack().catch(() => {});
          metrics.num_loop_broken++;
        }
        
        await new Promise((r) => setTimeout(r, 1000));
      }

      await validateProgressWeave({
        progress,
        success: false,
        final_url: urlAfter,
      });

      emit({
        type: "step_validated",
        payload: { step, progress, url_after: urlAfter },
      });

      if (progress && action.action) {
        const macroToSave: Macro = {
          actions: [action.action],
          success_count: 1,
          fail_count: 0,
          last_success_ts: Date.now(),
          metadata: { observe_query: action.action },
        };
        await setMacro(task.domain, task.intent, pageSig, macroToSave);
        await learnMacroWeave({ page_sig: pageSig, action: action.action });
        emit({
          type: "macro_saved",
          payload: { page_sig: pageSig, action: action.action },
        });
        await appendRunEvent(runId, {
          type: "macro_saved",
          payload: { page_sig: pageSig, action: action.action },
        });
      }

      step++;
      metrics.num_steps = step;
      await new Promise((r) => setTimeout(r, 800));
    }

    if (!metrics.success) {
      metrics.wall_time_ms = Date.now() - startTime;
      metrics.avg_action_latency_ms =
        latencies.length > 0
          ? latencies.reduce((a, b) => a + b, 0) / latencies.length
          : 0;
      meta.status = "finished";
      meta.metrics = metrics;
      meta.updated_at = new Date().toISOString();
      await setRun(runId, meta);
      emit({ type: "run_finished", payload: { run_id: runId, metrics } });
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
  } finally {
    if (stagehand) await stagehand.close().catch(() => {});
  }

  // Self-improvement analysis
  try {
    const analysis = await analyzeRun(runId, {
      domain: task.domain,
      intent: task.intent,
      expectedUrl: task.success_condition.url_contains,
      optimalSteps: 15,
      expectedSequence: task.id === "saucedemo-checkout" 
        ? ["username", "password", "login", "add to cart", "checkout"]
        : undefined,
    });
    console.log(formatLearningReport(analysis));
  } catch (err) {
    console.warn("Self-improvement analysis failed:", err);
  }

  return {
    runId,
    status: (await getRun(runId))?.status ?? "failed",
    metrics,
  };
}

async function buildPageState(
  stagehand: Stagehand,
  url: string,
  _lastAction: string
): Promise<PageState> {
  const page = stagehand.context.pages()[0];
  const title = await page.title();
    const observeResult = await stagehand.observe(
    "List visible buttons and links - return their text labels"
  );
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

// Cache for improved prompt (refreshed once per run)
let cachedImprovedPrompt: string | null = null;
let cachedTaskId: string | null = null;
let promptCacheTime = 0;
const PROMPT_CACHE_TTL = 30000; // 30 seconds - refresh more often for self-improvement

async function planStepWithLLM(
  task: Task,
  state: PageState,
  step: number,
  actionHistory: string[] = []
): Promise<string> {
  // Build history context to avoid loops
  const recentActions = actionHistory.slice(-5);
  const historyContext = recentActions.length > 0 
    ? `\nRecent actions (DO NOT repeat these): ${recentActions.join(" → ")}`
    : "";
  
  // Detect current page context
  const isLoginPage = state.url.includes('saucedemo.com') && !state.url.includes('inventory');
  const isInventoryPage = state.url.includes('inventory');
  const isCartPage = state.url.includes('cart');
  const isCheckoutPage = state.url.includes('checkout');
  
  // Build context-aware base prompt
  let basePrompt = `You are a browser automation agent. Current task: ${task.name}.
Task description: ${task.description}
Success means: ${JSON.stringify(task.success_condition)}.

CRITICAL WORKFLOW FOR SAUCEDEMO CHECKOUT:
1. LOGIN PAGE: Type 'standard_user' in username → Type 'secret_sauce' in password → Click 'Login'
2. INVENTORY PAGE: Click 'Add to cart' on items → Click the shopping cart icon (top right)
3. CART PAGE: Click 'Checkout' button
4. CHECKOUT FORM: Fill First Name, Last Name, Zip Code → Click 'Continue'
5. CHECKOUT OVERVIEW: Click 'Finish' button
6. COMPLETE: You should see 'THANK YOU' message

CURRENT PAGE CONTEXT:
${isLoginPage ? '📍 You are on the LOGIN PAGE - enter credentials and click Login' : ''}
${isInventoryPage ? '📍 You are on the INVENTORY PAGE - add items then click the CART ICON' : ''}
${isCartPage ? '📍 You are on the CART PAGE - click the CHECKOUT button to proceed' : ''}
${isCheckoutPage ? '📍 You are on CHECKOUT - fill the form OR click Finish' : ''}

RULES:
1. NEVER repeat the same action twice - if it didn't work, try a DIFFERENT element
2. Fill ALL form fields BEFORE clicking submit buttons
3. Look for the shopping cart ICON (not text) to go to cart
4. After adding to cart, you MUST click the cart icon to proceed
5. You MUST click Checkout, fill form, click Continue, then click Finish

Respond with exactly ONE action. Examples:
- "type 'standard_user' in the username field"
- "type 'secret_sauce' in the password field"  
- "click the Login button"
- "click 'Add to cart' on the first product"
- "click the shopping cart icon"
- "click 'Checkout'"
- "type 'Test' in the First Name field"
- "click 'Continue'"
- "click 'Finish'"

Only output the single action, no explanation.`;

  // ═══════════════════════════════════════════════════════════════
  // SELF-IMPROVEMENT: Load learned rules from Weave feedback
  // This is the feedback loop - we query Weave/Redis for past failures
  // and inject learned rules into the prompt
  // ═══════════════════════════════════════════════════════════════
  if (!cachedImprovedPrompt || cachedTaskId !== task.id || Date.now() - promptCacheTime > PROMPT_CACHE_TTL) {
    try {
      // Use the new Weave feedback integration
      cachedImprovedPrompt = await generateImprovedPromptFromWeave(basePrompt, task.id);
      cachedTaskId = task.id;
      promptCacheTime = Date.now();
      
      if (cachedImprovedPrompt !== basePrompt) {
        console.log(`[Self-Improve] ✅ Injected Weave feedback into prompt for task: ${task.id}`);
      }
    } catch (err) {
      console.warn("[Self-Improve] Failed to fetch Weave feedback:", err);
      cachedImprovedPrompt = basePrompt;
    }
  }
  
  const systemPrompt = cachedImprovedPrompt || basePrompt;
  
  const userPrompt = `Step ${step}. Page: ${state.title}. URL: ${state.url}.
Actionable elements: ${state.actionable_labels.join(", ") || "unknown"}.${historyContext}
What is the next action?`;

  // Use Gemini if provider is google
  if (config.LLM_PROVIDER === "google") {
    const genAI = getGoogleAI();
    const model = genAI.getGenerativeModel({ 
      model: config.LLM_MODEL,
      systemInstruction: systemPrompt,
    });
    const result = await model.generateContent(userPrompt);
    const content = result.response.text()?.trim() ?? "click the first button";
    return content;
  }
  
  // Default to OpenAI-compatible API
  const res = await getOpenAI().chat.completions.create({
    model: config.LLM_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    max_tokens: 150,
  });
  const content = res.choices[0]?.message?.content?.trim() ?? "click the first button";
  return content;
}

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
