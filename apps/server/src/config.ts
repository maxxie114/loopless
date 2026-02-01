import { z } from "zod";

const envSchema = z.object({
  WANDB_API_KEY: z.string().optional(),
  WEAVE_PROJECT: z.string().default("loopless"),
  LLM_PROVIDER: z.enum(["openai", "wandb_inference"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  WANDB_INFERENCE_BASE_URL: z.string().optional(),
  WANDB_INFERENCE_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),
  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_PREFIX: z.string().default("loopless"),
  REDIS_TTL_SECONDS: z.coerce.number().default(604800),
  SERVER_PORT: z.coerce.number().default(3001),
  WEB_BASE_URL: z.string().default("http://localhost:3000"),
  APP_ENV: z.enum(["development", "production"]).default("development"),
});

export type Config = z.infer<typeof envSchema>;

function loadConfig(): Config {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid env:", parsed.error.flatten());
    return envSchema.parse({});
  }
  return parsed.data;
}

export const config = loadConfig();
