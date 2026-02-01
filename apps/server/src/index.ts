import "dotenv/config";
import express from "express";
import cors from "cors";
import runsRouter from "./api/runs.js";
import tasksRouter from "./api/tasks.js";
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
app.use(cors({ origin: config.WEB_BASE_URL }));
app.use(express.json());

app.use("/api/runs", runsRouter);
app.use("/api/tasks", tasksRouter);

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
  try {
    await getRedis();
    logger.info("Redis connected");
  } catch (e) {
    logger.warn("Redis not available: %s", e);
  }

  app.listen(config.SERVER_PORT, () => {
    logger.info("LoopLess server on http://localhost:%s", config.SERVER_PORT);
  });
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
