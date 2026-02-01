import { z } from "zod";

export const RunModeSchema = z.enum(["cold", "warm", "twice"]);
export type RunMode = z.infer<typeof RunModeSchema>;

export const CreateRunSchema = z.object({
  task_id: z.string(),
  mode: RunModeSchema,
  overrides: z.record(z.unknown()).optional(),
});
export type CreateRunInput = z.infer<typeof CreateRunSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  start_url: z.string().url(),
  success_condition: z.object({
    url_contains: z.string().optional(),
    page_contains: z.string().optional(),
  }),
  max_steps: z.number().default(40),
  domain: z.string(),
  intent: z.string(),
});
export type Task = z.infer<typeof TaskSchema>;

export const RunMetricsSchema = z.object({
  success: z.boolean(),
  wall_time_ms: z.number(),
  num_steps: z.number(),
  num_llm_calls: z.number(),
  num_observe_calls: z.number(),
  num_retries: z.number(),
  num_loop_detected: z.number(),
  num_loop_broken: z.number(),
  cache_hits: z.number(),
  cache_misses: z.number(),
  avg_action_latency_ms: z.number(),
  final_url: z.string().optional(),
  weave_trace_url: z.string().optional(),
  browserbase_session_id: z.string().optional(),
  recording_url: z.string().optional(),
});
export type RunMetrics = z.infer<typeof RunMetricsSchema>;

export const RunStatusSchema = z.enum([
  "pending",
  "running",
  "finished",
  "failed",
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunMetaSchema = z.object({
  run_id: z.string(),
  task_id: z.string(),
  mode: RunModeSchema,
  status: RunStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
  metrics: RunMetricsSchema.optional(),
  error: z.string().optional(),
});
export type RunMeta = z.infer<typeof RunMetaSchema>;

export const MacroSchema = z.object({
  actions: z.array(z.string()),
  success_count: z.number(),
  fail_count: z.number(),
  last_success_ts: z.number(),
  metadata: z
    .object({
      observe_query: z.string().optional(),
      notes: z.string().optional(),
    })
    .optional(),
});
export type Macro = z.infer<typeof MacroSchema>;

export const StepEventSchema = z.object({
  type: z.enum([
    "run_started",
    "step_planned",
    "step_executed",
    "step_validated",
    "loop_detected",
    "loop_broken",
    "macro_saved",
    "run_finished",
    "run_failed",
  ]),
  run_id: z.string(),
  payload: z.record(z.unknown()),
  ts: z.string(),
});
export type StepEvent = z.infer<typeof StepEventSchema>;
