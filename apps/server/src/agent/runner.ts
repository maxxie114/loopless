import { Stagehand } from "@browserbasehq/stagehand";
import OpenAI from "openai";
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

const openai = new OpenAI({
  apiKey: config.OPENAI_API_KEY ?? config.WANDB_INFERENCE_API_KEY,
  baseURL:
    config.LLM_PROVIDER === "wandb_inference"
      ? config.WANDB_INFERENCE_BASE_URL
      : undefined,
});

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

    stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: config.BROWSERBASE_API_KEY,
      projectId: config.BROWSERBASE_PROJECT_ID ?? "",
      model: config.LLM_MODEL.startsWith("gpt")
        ? `openai/${config.LLM_MODEL}`
        : config.LLM_MODEL,
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
      const macro = useMacros
        ? await getMacro(task.domain, task.intent, pageSig)
        : null;
      if (macro && macro.actions.length > 0) {
        action = {
          action: macro.actions[0],
          cache_hit: true,
          source: "macro",
        };
        metrics.cache_hits++;
      } else {
        metrics.cache_misses++;
        const llmStart = Date.now();
        const planned = await planStepWithLLM(task, state, step);
        metrics.num_llm_calls++;
        action = {
          action: planned,
          cache_hit: false,
          source: "llm",
        };
        latencies.push(Date.now() - llmStart);
      }

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

      const repeated = signatureHistory.filter((s) => s === pageSig).length;
      if (repeated >= 3 && !progress) {
        metrics.num_loop_detected++;
        metrics.num_loop_broken++;
        emit({
          type: "loop_detected",
          payload: { step, page_sig: pageSig },
        });
        await page.goBack().catch(() => {});
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

async function planStepWithLLM(
  task: Task,
  state: PageState,
  step: number
): Promise<string> {
  const sys = `You are a browser automation agent. Current task: ${task.name}. ${task.description}.
Success means: ${JSON.stringify(task.success_condition)}.
Respond with exactly ONE natural language action for Stagehand. Examples: "click 'Login'", "type 'standard_user' in the username field", "click the 'Add to cart' button".
Only output the single action, no explanation.`;
  const user = `Step ${step}. Page: ${state.title}. URL: ${state.url}.
Actionable elements: ${state.actionable_labels.join(", ") || "unknown"}.
What is the next action?`;
  const res = await openai.chat.completions.create({
    model: config.LLM_MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
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
