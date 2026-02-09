import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({path: resolve(__dirname, "../../.env")});

console.log("WEAVE_PROJECT:", process.env.WEAVE_PROJECT);
console.log("LLM_MODEL:", process.env.LLM_MODEL);
