import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from monorepo root (3 levels up: src -> server -> apps -> root)
const envPath = resolve(__dirname, "../../../.env");
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn("Could not load .env from", envPath);
  // Try current working directory
  dotenv.config();
}
