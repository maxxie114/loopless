import { config } from "./config.js";

type WeaveOp = (input: unknown) => Promise<unknown>;

let weave: { init: (project: string) => Promise<unknown>; op: (fn: (input: unknown) => Promise<unknown>) => WeaveOp } | null = null;
let initialized = false;

async function loadWeave() {
  if (weave) return weave;
  try {
    const w = await import("weave");
    weave = w.default ?? w;
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
      await w.init(config.WEAVE_PROJECT);
      initialized = true;
    }
  } catch (e) {
    console.warn("Weave init skipped:", e);
  }
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
    _runTaskWeave = w.op(runTaskOp);
    _buildStateWeave = w.op(buildStateOp);
    _planStepWeave = w.op(planStepOp);
    _executeActionWeave = w.op(executeActionOp);
    _validateProgressWeave = w.op(validateProgressOp);
    _learnMacroWeave = w.op(learnMacroOp);
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
