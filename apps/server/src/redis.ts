import { createClient, type RedisClientType } from "redis";
import { config } from "./config.js";
import type { Macro, RunMeta } from "@loopless/shared";
import { RunMetaSchema } from "@loopless/shared";

const P = config.REDIS_PREFIX;
const MACRO_TTL = 30 * 24 * 60 * 60; // 30 days
const RUN_TTL = 7 * 24 * 60 * 60; // 7 days
const EVENTS_TTL = 24 * 60 * 60; // 1 day

let client: RedisClientType | null = null;
let redisAvailable = false;
let connectionAttempted = false;

export async function getRedis(): Promise<RedisClientType | null> {
  if (connectionAttempted && !redisAvailable) return null;
  if (client && redisAvailable) return client;
  
  connectionAttempted = true;
  try {
    const isCloudRedis = config.REDIS_URL.startsWith("rediss://");
    console.log("Connecting to Redis:", config.REDIS_URL.replace(/:[^:@]+@/, ":***@"));
    
    // For Redis Cloud, the rediss:// URL handles TLS automatically
    client = createClient({ 
      url: config.REDIS_URL,
      socket: {
        connectTimeout: 10000,
        reconnectStrategy: false, // Don't auto-reconnect on initial failure
      }
    });
    
    client.on("error", (err) => {
      console.error("Redis error:", err.message);
    });
    
    await client.connect();
    
    // Test the connection
    await client.ping();
    
    redisAvailable = true;
    console.log("Redis connected successfully" + (isCloudRedis ? " (Cloud)" : " (Local)"));
    return client;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("Redis connection failed:", msg);
    console.warn("Running in memory-only mode");
    redisAvailable = false;
    client = null;
    return null;
  }
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

// In-memory fallback storage
const memoryStore = new Map<string, { value: string; expires?: number }>();

export async function getMacro(
  domain: string,
  intent: string,
  pageSig: string
): Promise<Macro | null> {
  const r = await getRedis();
  const key = keyMacro(domain, intent, pageSig);
  if (r) {
    const raw = await r.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Macro;
    } catch {
      return null;
    }
  }
  // Memory fallback
  const entry = memoryStore.get(key);
  if (!entry || (entry.expires && Date.now() > entry.expires)) return null;
  try {
    return JSON.parse(entry.value) as Macro;
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
  const key = keyMacro(domain, intent, pageSig);
  const value = JSON.stringify(macro);
  if (r) {
    await r.setEx(key, MACRO_TTL, value);
  } else {
    memoryStore.set(key, { value, expires: Date.now() + MACRO_TTL * 1000 });
  }
}

export async function getRun(runId: string): Promise<RunMeta | null> {
  const r = await getRedis();
  const key = keyRun(runId);
  if (r) {
    const raw = await r.get(key);
    if (!raw) return null;
    try {
      return RunMetaSchema.parse(JSON.parse(raw));
    } catch {
      return JSON.parse(raw) as RunMeta;
    }
  }
  // Memory fallback
  const entry = memoryStore.get(key);
  if (!entry || (entry.expires && Date.now() > entry.expires)) return null;
  try {
    return RunMetaSchema.parse(JSON.parse(entry.value));
  } catch {
    return JSON.parse(entry.value) as RunMeta;
  }
}

export async function setRun(runId: string, meta: RunMeta): Promise<void> {
  const r = await getRedis();
  const key = keyRun(runId);
  const value = JSON.stringify(meta);
  if (r) {
    await r.setEx(key, RUN_TTL, value);
  } else {
    memoryStore.set(key, { value, expires: Date.now() + RUN_TTL * 1000 });
  }
}

export async function appendRunEvent(
  runId: string,
  event: { type: string; payload: Record<string, unknown> }
): Promise<void> {
  const r = await getRedis();
  const k = keyRunEvents(runId);
  const eventStr = JSON.stringify({ ...event, ts: new Date().toISOString() });
  if (r) {
    await r.rPush(k, eventStr);
    await r.expire(k, EVENTS_TTL);
  } else {
    const entry = memoryStore.get(k);
    const list = entry ? JSON.parse(entry.value) as string[] : [];
    list.push(eventStr);
    memoryStore.set(k, { value: JSON.stringify(list), expires: Date.now() + EVENTS_TTL * 1000 });
  }
}

export async function getRunEvents(runId: string): Promise<string[]> {
  const r = await getRedis();
  const k = keyRunEvents(runId);
  if (r) {
    return r.lRange(k, 0, -1);
  }
  const entry = memoryStore.get(k);
  if (!entry) return [];
  try {
    return JSON.parse(entry.value) as string[];
  } catch {
    return [];
  }
}

export async function getRecentRunIds(limit: number = 50): Promise<string[]> {
  const r = await getRedis();
  if (r) {
    const keys = await r.keys(`${P}:run:*`);
    const ids = keys.map((k) => k.replace(`${P}:run:`, ""));
    return ids.slice(0, limit);
  }
  // Memory fallback
  const ids: string[] = [];
  for (const key of memoryStore.keys()) {
    if (key.startsWith(`${P}:run:`)) {
      ids.push(key.replace(`${P}:run:`, ""));
    }
  }
  return ids.slice(0, limit);
}

export async function healthCheck(): Promise<boolean> {
  try {
    const r = await getRedis();
    if (r) {
      await r.ping();
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
