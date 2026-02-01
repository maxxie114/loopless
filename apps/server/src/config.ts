import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { z } from "zod";

// Load .env from monorepo root before parsing config
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../../.env") });

const envSchema = z.object({
  // W&B Weave
  WANDB_API_KEY: z.string().optional(),
  WEAVE_PROJECT: z.string().default("loopless"),
  
  // LLM Provider
  LLM_PROVIDER: z.enum(["openai", "google", "wandb_inference"]).default("openai"),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  WANDB_INFERENCE_BASE_URL: z.string().optional(),
  WANDB_INFERENCE_API_KEY: z.string().optional(),
  LLM_MODEL: z.string().default("gpt-4o-mini"),
  
  // Browserbase
  BROWSERBASE_API_KEY: z.string().optional(),
  BROWSERBASE_PROJECT_ID: z.string().optional(),
  
  // Redis Cloud (use rediss:// for TLS)
  REDIS_URL: z.string().default("redis://localhost:6379"),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_PREFIX: z.string().default("loopless"),
  REDIS_TTL_SECONDS: z.coerce.number().default(604800),
  
  // App
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
