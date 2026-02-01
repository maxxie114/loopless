import { createClient, type RedisClientType } from "redis";
import { config } from "./config.js";
import type { Macro, RunMeta } from "@loopless/shared";
import { RunMetaSchema } from "@loopless/shared";

const P = config.REDIS_PREFIX;
const MACRO_TTL = 30 * 24 * 60 * 60; // 30 days
const RUN_TTL = 7 * 24 * 60 * 60; // 7 days
const EVENTS_TTL = 24 * 60 * 60; // 1 day

let client: RedisClientType | null = null;

export async function getRedis(): Promise<RedisClientType> {
  if (!client) {
    client = createClient({ url: config.REDIS_URL });
    client.on("error", (err) => console.error("Redis error:", err));
    await client.connect();
  }
  return client;
}

export function keyMacro(domain: string, intent: string, pageSig: string): string {
  return `${P}:macro:${domain}:${intent}:${pageSig}`;
}

export function keyRun(runId: string): string {
  return `${P}:run:${runId}`;
}

export function keyRunEvents(runId: string): string {
  return `${P}:run_events:${runId}`;
}

export async function getMacro(
  domain: string,
  intent: string,
  pageSig: string
): Promise<Macro | null> {
  const r = await getRedis();
  const raw = await r.get(keyMacro(domain, intent, pageSig));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Macro;
  } catch {
    return null;
  }
}

export async function setMacro(
  domain: string,
  intent: string,
  pageSig: string,
  macro: Macro
): Promise<void> {
  const r = await getRedis();
  await r.setEx(
    keyMacro(domain, intent, pageSig),
    MACRO_TTL,
    JSON.stringify(macro)
  );
}

export async function getRun(runId: string): Promise<RunMeta | null> {
  const r = await getRedis();
  const raw = await r.get(keyRun(runId));
  if (!raw) return null;
  try {
    return RunMetaSchema.parse(JSON.parse(raw));
  } catch {
    return JSON.parse(raw) as RunMeta;
  }
}

export async function setRun(runId: string, meta: RunMeta): Promise<void> {
  const r = await getRedis();
  await r.setEx(keyRun(runId), RUN_TTL, JSON.stringify(meta));
}

export async function appendRunEvent(
  runId: string,
  event: { type: string; payload: Record<string, unknown> }
): Promise<void> {
  const r = await getRedis();
  const k = keyRunEvents(runId);
  await r.rPush(k, JSON.stringify({ ...event, ts: new Date().toISOString() }));
  await r.expire(k, EVENTS_TTL);
}

export async function getRunEvents(runId: string): Promise<string[]> {
  const r = await getRedis();
  return r.lRange(keyRunEvents(runId), 0, -1);
}

export async function getRecentRunIds(limit: number = 50): Promise<string[]> {
  const r = await getRedis();
  const keys = await r.keys(`${P}:run:*`);
  const ids = keys.map((k) => k.replace(`${P}:run:`, ""));
  return ids.slice(0, limit);
}

export async function healthCheck(): Promise<boolean> {
  try {
    const r = await getRedis();
    await r.ping();
    return true;
  } catch {
    return false;
  }
}
