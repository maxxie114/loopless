/**
 * Clean up all LoopLess data from Redis
 */
import { createClient } from "redis";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const PREFIX = process.env.REDIS_PREFIX || "loopless";

async function cleanup() {
  console.log("🧹 Redis Cleanup");
  console.log("================\n");
  
  const redis = createClient({ url: REDIS_URL });
  
  redis.on("error", (err) => console.error("Redis error:", err.message));
  
  await redis.connect();
  console.log("✅ Connected to Redis\n");
  
  // Find all keys with our prefix
  const keys = await redis.keys(`${PREFIX}:*`);
  console.log(`Found ${keys.length} keys to delete:\n`);
  
  if (keys.length > 0) {
    for (const key of keys) {
      await redis.del(key);
      console.log(`  ❌ ${key}`);
    }
  }
  
  console.log("\n✅ Cleanup complete!");
  await redis.quit();
  process.exit(0);
}

cleanup().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
