# LoopLess

A **self-improving browser agent** that becomes faster and more reliable over time by learning loop-breaking, DOM-first “macro” behaviors with **Redis**, and proving improvements with **W&B Weave** evals and traces. Built with **BrowserBase** and **Stagehand**.

**Tagline:** Cold run learns. Warm run reuses cached macros and finishes with fewer LLM calls, fewer steps, and less time.

## Features

- **🎥 Live Browser View** - Watch the agent execute tasks in real-time via BrowserBase live streaming
- **🧠 Self-Improvement Loop** - Agent learns from failures and improves prompts automatically
- **📊 Weave Integration** - Full observability with W&B Weave tracing and LLM-as-a-Judge scoring
- **💾 Macro Caching** - Successful action sequences cached in Redis for reuse
- **🔄 Loop Detection** - Automatic detection and breaking of repetitive action loops
- **📹 Session Recordings** - Watch past runs via BrowserBase recordings
- **🎯 AGI Inc Benchmark Tasks** - GoCalendar, GoMail, MarriSuite, NetworkIn tasks

## Tech stack

- **Backend:** Node.js 18+, Express, Weave TS SDK, OpenAI SDK, Redis (node-redis), Zod, Pino
- **Browser automation:** Stagehand, Browserbase (sessions + recordings)
- **Frontend:** Next.js 14 (App Router), Tailwind CSS
- **Storage:** Redis (macros, run metadata, events)

## Quick start

### 1. Clone and install

```bash
cd self_improved_browser
pnpm install
```

### 2. Environment

Copy `.env.example` to `.env` and set:

- **W&B Weave:** `WANDB_API_KEY`, `WEAVE_PROJECT` (e.g. `your-entity/loopless`)
- **LLM:** `OPENAI_API_KEY`, `LLM_MODEL` (e.g. `gpt-4o-mini`)
- **Browserbase:** `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`
- **Redis:** `REDIS_URL` (e.g. `redis://localhost:6379`)

### 3. Run Redis (local)

```bash
# Docker
docker run -d -p 6379:6379 redis:7-alpine
```

### 4. Build shared package and start server + web

```bash
pnpm --filter @loopless/shared build
pnpm dev
```

- **Server:** http://localhost:3001  
- **Web UI:** http://localhost:3000  

Or run separately:

```bash
pnpm dev:server   # backend only
pnpm dev:web      # frontend only (proxies /api to 3001)
```

### 5. Demo: Run Twice (CLI)

```bash
pnpm run demo:twice
```

Runs SauceDemo checkout **cold** (no macros), then **warm** (with cached macros). Compare metrics: warm should have more cache hits and fewer LLM calls / less time.

## Project layout

```
self_improved_browser/
  apps/
    server/          # Express API + agent runner (Stagehand, Weave, Redis)
    web/              # Next.js UI (task picker, runs, SSE events)
  packages/
    shared/           # Zod schemas, types
  scripts/
    seed_tasks.ts     # List/validate tasks
    run_eval.ts       # Eval harness (Weave Evaluations)
  AGENT.md            # Full spec
  .env.example
```

## API

- `POST /api/runs` — Start a run. Body: `{ task_id, mode: "cold"|"warm"|"twice" }`. Returns `{ run_id }` or `{ cold_run_id, warm_run_id }`.
- `GET /api/runs` — List recent runs.
- `GET /api/runs/:id` — Run metadata and metrics.
- `GET /api/runs/:id/events` — SSE stream of step events.
- `GET /api/tasks` — List tasks.

## Success metrics (per run)

- **success**, **wall_time_ms**, **num_steps**, **num_llm_calls**, **num_observe_calls**
- **cache_hits** / **cache_misses** (macros)
- **num_loop_detected**, **num_loop_broken**
- **recording_url** (Browserbase session)

Warm run should show **≥30% fewer LLM calls** or **≥20% faster wall time** vs cold on the same task.

## Deployment

### Deploy Frontend to Vercel

1. Connect your GitHub repo to Vercel
2. Set root directory to `apps/web`
3. Add environment variable: `NEXT_PUBLIC_API_URL=<your-server-url>`
4. Deploy

### Deploy Server to Railway/Render

1. Use the Dockerfile at `apps/server/Dockerfile`
2. Set required environment variables:
   - `WANDB_API_KEY` - W&B Weave API key
   - `GOOGLE_API_KEY` - Gemini API key
   - `BROWSERBASE_API_KEY` - BrowserBase API key
   - `BROWSERBASE_PROJECT_ID` - BrowserBase project ID
   - `REDIS_URL` - Redis Cloud connection string
   - `REDIS_PASSWORD` - Redis password
3. Deploy and note the server URL
4. Update Vercel's `NEXT_PUBLIC_API_URL` with the server URL

## Docs

- [W&B Weave (TS)](https://docs.wandb.ai/weave/quickstart) · [Weave Evaluations](https://docs.wandb.ai/weave/tutorial-eval)
- [Browserbase](https://docs.browserbase.com/introduction/getting-started) · [Stagehand](https://docs.stagehand.dev/v3/first-steps/quickstart)
- [BrowserBase Live View](https://docs.browserbase.com/features/session-live-view)
- [Redis node-redis](https://redis.io/docs/latest/develop/clients/nodejs/)

## License

See [LICENSE](LICENSE).
