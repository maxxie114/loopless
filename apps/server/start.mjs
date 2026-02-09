import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({path: resolve(__dirname, "../../.env")});

console.log("[Start] WEAVE_PROJECT:", process.env.WEAVE_PROJECT);
console.log("[Start] Starting server...");

import("./src/index.ts").catch(err => {
  console.error("[Start] Error:", err);
  process.exit(1);
});
