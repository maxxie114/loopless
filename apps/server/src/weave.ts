import { config } from "./config.js";

type WeaveOp = (input: unknown) => Promise<unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFunction = (...args: any[]) => any;

interface WeaveModule {
  init: (project: string) => Promise<unknown>;
  op: (fn: AnyFunction, options?: { name?: string }) => WeaveOp;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let weave: any = null;
let initialized = false;
let weaveClient: unknown = null;

async function loadWeave(): Promise<WeaveModule | null> {
  if (weave) return weave;
  try {
    const w = await import("weave");
    weave = (w.default ?? w) as WeaveModule;
    return weave;
  } catch {
    return null;
  }
}

export async function initWeave(): Promise<void> {
  if (initialized) return;
  if (!config.WANDB_API_KEY) return;
  try {
    const w = await loadWeave();
    if (w) {
      weaveClient = await w.init(config.WEAVE_PROJECT);
      initialized = true;
      console.log(`[Weave] Initialized project: ${config.WEAVE_PROJECT}`);
    }
  } catch (e) {
    console.warn("Weave init skipped:", e);
  }
}

export function isWeaveInitialized(): boolean {
  return initialized;
}

export function getWeaveClient(): unknown {
  return weaveClient;
}

function noop(_: unknown) {
  return Promise.resolve(_);
}

async function runTaskOp(input: unknown) {
  return input;
}
async function buildStateOp(input: unknown) {
  return input;
}
async function planStepOp(input: unknown) {
  return input;
}
async function executeActionOp(input: unknown) {
  return input;
}
async function validateProgressOp(input: unknown) {
  return input;
}
async function learnMacroOp(input: unknown) {
  return input;
}

let _runTaskWeave: WeaveOp = noop;
let _buildStateWeave: WeaveOp = noop;
let _planStepWeave: WeaveOp = noop;
let _executeActionWeave: WeaveOp = noop;
let _validateProgressWeave: WeaveOp = noop;
let _learnMacroWeave: WeaveOp = noop;

async function bindWeaveOps() {
  const w = await loadWeave();
  if (w?.op) {
    // Names must match what's selected in Weave monitors
    _runTaskWeave = w.op(runTaskOp, { name: "runTaskOp" });
    _buildStateWeave = w.op(buildStateOp, { name: "buildStateOp" });
    _planStepWeave = w.op(planStepOp, { name: "planStepOp" });
    _executeActionWeave = w.op(executeActionOp, { name: "executeActionOp" });
    _validateProgressWeave = w.op(validateProgressOp, { name: "validateProgressOp" });
    _learnMacroWeave = w.op(learnMacroOp, { name: "learnMacroOp" });
  }
}

/**
 * Log an evaluation result to Weave
 * This creates a tracked evaluation that shows up in the Weave dashboard
 */
export async function logEvaluationToWeave(evaluation: {
  runId: string;
  taskId: string;
  mode: string;
  scores: Record<string, number | boolean>;
  passed: boolean;
  issues: string[];
  recommendations: string[];
}): Promise<void> {
  if (!initialized) return;
  
  const w = await loadWeave();
  if (!w?.op) return;
  
  try {
    // Create an op that logs the evaluation
    const logEvalOp = w.op(async (input: typeof evaluation) => {
      return {
        ...input,
        timestamp: new Date().toISOString(),
        project: config.WEAVE_PROJECT,
      };
    }, { name: "browserAgentEvaluation" });
    
    // Call the op to log the evaluation
    await logEvalOp(evaluation);
    
    console.log(`[Weave] Logged evaluation for run ${evaluation.runId}`);
  } catch (err) {
    console.warn("[Weave] Failed to log evaluation:", err);
  }
}

/**
 * Log a self-improvement event to Weave
 * This tracks when the agent learns from failures
 */
export async function logSelfImprovementToWeave(event: {
  type: "failure_pattern_detected" | "prompt_improved" | "macro_learned";
  details: Record<string, unknown>;
}): Promise<void> {
  if (!initialized) return;
  
  const w = await loadWeave();
  if (!w?.op) return;
  
  try {
    const logImprovementOp = w.op(async (input: typeof event) => {
      return {
        ...input,
        timestamp: new Date().toISOString(),
      };
    }, { name: "selfImprovementEvent" });
    
    await logImprovementOp(event);
  } catch {
    // Silently ignore errors
  }
}

export const runTaskWeave = (input: unknown) => _runTaskWeave(input);
export const buildStateWeave = (input: unknown) => _buildStateWeave(input);
export const planStepWeave = (input: unknown) => _planStepWeave(input);
export const executeActionWeave = (input: unknown) => _executeActionWeave(input);
export const validateProgressWeave = (input: unknown) => _validateProgressWeave(input);
export const learnMacroWeave = (input: unknown) => _learnMacroWeave(input);

export async function ensureWeaveOps() {
  await bindWeaveOps();
}
