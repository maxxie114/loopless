/**
 * Sequence-Aware Macro Caching System
 * 
 * This system caches action sequences (not just individual actions) keyed by:
 * 1. Domain + Intent (what task we're doing)
 * 2. Current URL path (where we are)
 * 3. Action history hash (what we've done so far)
 * 
 * This prevents the "wrong macro for same page" bug by considering context.
 */

import { createHash } from "crypto";
import { getRedis } from "./redis.js";
import { config } from "./config.js";

const P = config.REDIS_PREFIX;
const MACRO_TTL = 30 * 24 * 60 * 60; // 30 days

export interface SequenceMacro {
  /** The action to take */
  action: string;
  /** Expected outcome/description */
  expectedResult: string;
  /** How many times this macro succeeded */
  successCount: number;
  /** How many times this macro failed */
  failCount: number;
  /** Last successful use timestamp */
  lastSuccessAt: number;
  /** URL pattern this macro applies to */
  urlPattern: string;
}

export interface SequenceContext {
  domain: string;
  intent: string;
  currentUrl: string;
  actionHistory: string[];
  pageTitle: string;
}

/**
 * Compute a context-aware key for macro lookup
 * Includes: domain, intent, URL path, and recent action history
 */
export function computeSequenceKey(ctx: SequenceContext): string {
  const url = new URL(ctx.currentUrl);
  const path = url.pathname.replace(/\/$/, '') || '/';
  
  // Hash the last 3 actions to create context
  const historyHash = ctx.actionHistory.length > 0
    ? createHash("sha256")
        .update(ctx.actionHistory.slice(-3).join("|"))
        .digest("hex")
        .slice(0, 16)
    : "start";
  
  // Create a human-readable key prefix for debugging
  const key = `${P}:seq:${ctx.domain}:${ctx.intent}:${path}:${historyHash}`;
  return key;
}

/**
 * Get a simplified URL pattern for matching similar URLs
 */
function getUrlPattern(url: string): string {
  try {
    const u = new URL(url);
    // Remove specific IDs but keep structure
    return u.pathname
      .replace(/\/[0-9a-f]{8,}\b/gi, '/:id')  // UUIDs
      .replace(/\/\d+/g, '/:num');            // Numbers
  } catch {
    return url;
  }
}

/**
 * Get macro for current sequence context
 */
export async function getSequenceMacro(ctx: SequenceContext): Promise<SequenceMacro | null> {
  const redis = await getRedis();
  if (!redis) return null;
  
  const key = computeSequenceKey(ctx);
  
  try {
    const data = await redis.get(key);
    if (!data) return null;
    
    const macro = JSON.parse(data) as SequenceMacro;
    
    // Validate: only use if success rate is good (>70%)
    const totalUses = macro.successCount + macro.failCount;
    if (totalUses > 0 && macro.successCount / totalUses < 0.7) {
      console.log(`[MacroSeq] Skipping low-success macro: ${macro.successCount}/${totalUses} successes`);
      return null;
    }
    
    // Validate: URL pattern should match
    const currentPattern = getUrlPattern(ctx.currentUrl);
    if (!currentPattern.includes(macro.urlPattern) && !macro.urlPattern.includes(currentPattern)) {
      console.log(`[MacroSeq] URL pattern mismatch: ${currentPattern} vs ${macro.urlPattern}`);
      return null;
    }
    
    console.log(`[MacroSeq] ✅ Found macro: "${macro.action.slice(0, 50)}..." (${macro.successCount} successes)`);
    return macro;
  } catch (err) {
    console.warn("[MacroSeq] Error getting macro:", err);
    return null;
  }
}

/**
 * Save a successful action as a macro
 */
export async function saveSequenceMacro(
  ctx: SequenceContext,
  action: string,
  expectedResult: string
): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  
  const key = computeSequenceKey(ctx);
  const urlPattern = getUrlPattern(ctx.currentUrl);
  
  // Try to get existing macro
  let macro: SequenceMacro;
  try {
    const existing = await redis.get(key);
    if (existing) {
      macro = JSON.parse(existing);
      macro.successCount++;
      macro.lastSuccessAt = Date.now();
      // Update expected result if action changed
      if (macro.action !== action) {
        console.log(`[MacroSeq] Action changed for key, updating: ${action.slice(0, 50)}`);
        macro.action = action;
      }
    } else {
      // Create new macro
      macro = {
        action,
        expectedResult,
        successCount: 1,
        failCount: 0,
        lastSuccessAt: Date.now(),
        urlPattern,
      };
    }
  } catch {
    macro = {
      action,
      expectedResult,
      successCount: 1,
      failCount: 0,
      lastSuccessAt: Date.now(),
      urlPattern,
    };
  }
  
  await redis.setEx(key, MACRO_TTL, JSON.stringify(macro));
  console.log(`[MacroSeq] 💾 Saved macro (${macro.successCount} successes): ${action.slice(0, 50)}`);
}

/**
 * Mark a macro as failed (for this context)
 */
export async function markMacroFailed(ctx: SequenceContext): Promise<void> {
  const redis = await getRedis();
  if (!redis) return;
  
  const key = computeSequenceKey(ctx);
  
  try {
    const data = await redis.get(key);
    if (data) {
      const macro = JSON.parse(data) as SequenceMacro;
      macro.failCount++;
      await redis.setEx(key, MACRO_TTL, JSON.stringify(macro));
      console.log(`[MacroSeq] ❌ Marked macro as failed: ${macro.successCount}/${macro.successCount + macro.failCount} successes`);
    }
  } catch (err) {
    console.warn("[MacroSeq] Error marking macro failed:", err);
  }
}

/**
 * Get statistics about macro usage
 */
export async function getMacroStats(): Promise<{
  totalMacros: number;
  totalSuccesses: number;
  totalFailures: number;
}> {
  const redis = await getRedis();
  if (!redis) return { totalMacros: 0, totalSuccesses: 0, totalFailures: 0 };
  
  try {
    const keys = await redis.keys(`${P}:seq:*`);
    let totalSuccesses = 0;
    let totalFailures = 0;
    
    for (const key of keys.slice(0, 100)) {
      const data = await redis.get(key);
      if (data) {
        const macro = JSON.parse(data) as SequenceMacro;
        totalSuccesses += macro.successCount;
        totalFailures += macro.failCount;
      }
    }
    
    return {
      totalMacros: keys.length,
      totalSuccesses,
      totalFailures,
    };
  } catch {
    return { totalMacros: 0, totalSuccesses: 0, totalFailures: 0 };
  }
}
