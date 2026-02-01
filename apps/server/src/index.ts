// Load env vars first, before any other imports
import "./env.js";

import express from "express";
import cors from "cors";
import runsRouter from "./api/runs.js";
import tasksRouter from "./api/tasks.js";
import autoImproveRouter from "./api/auto-improve.js";
import { config } from "./config.js";
import { initWeave, ensureWeaveOps } from "./weave.js";
import { getRedis, healthCheck } from "./redis.js";
import pino from "pino";

const logger = pino(
  config.APP_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true } } }
    : {}
);

const app = express();
// Allow CORS from the web frontend for SSE and API calls
app.use(cors({ 
  origin: config.APP_ENV === "development" 
    ? true  // Allow all origins in development
    : config.WEB_BASE_URL,
  credentials: true 
}));
app.use(express.json());

app.use("/api/runs", runsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/auto-improve", autoImproveRouter);

app.get("/health", async (_req, res) => {
  const redisOk = await healthCheck();
  res.status(redisOk ? 200 : 503).json({
    ok: redisOk,
    redis: redisOk ? "connected" : "disconnected",
  });
});

async function main() {
  if (config.WANDB_API_KEY) {
    await initWeave();
    await ensureWeaveOps();
    logger.info("Weave initialized");
  }
  const redis = await getRedis();
  if (redis) {
    logger.info("Redis Cloud connected");
  } else {
    logger.warn("Redis not available - using in-memory storage");
  }

  app.listen(config.SERVER_PORT, () => {
    logger.info("LoopLess server on http://localhost:%s", config.SERVER_PORT);
  });
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
