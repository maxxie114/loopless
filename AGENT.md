# AGENT.md — WeaveHacks Project Spec (Cursor-ready)
Project name (new): **LoopLess**
Repo folder name can stay `self_improved_browser`, but the product name in UI/README should be LoopLess.

Tagline: A self-improving browser agent that becomes faster and more reliable over time by learning loop-breaking, DOM-first “macro” behaviors with Redis and proving improvements with Weave evals and traces.

Core demo: Run the same multi-step workflow twice (e.g., SauceDemo checkout). Cold run learns. Warm run reuses cached macros + semantic decisions and finishes with fewer LLM calls, fewer steps, and less time. Show side-by-side metrics + rrweb replay.

======================================================================
0) TL;DR — What Cursor should build
======================================================================
Build a full-stack app (frontend + backend) that:
1) Runs browser automation in Browserbase using Stagehand (DOM-first; vision fallback).
2) Logs everything to W&B Weave (traces per step, latency, tool calls, and eval scores).
3) Stores learned “action macros” + run artifacts in Redis to improve future runs.
4) Includes a demo UI:
   - start runs (cold / warm / run-twice)
   - stream live step-by-step progress
   - show metrics (steps, time, LLM calls, retries, loop events, cache hits)
   - embed Browserbase rrweb replay (or at minimum link to session recording)
   - compare cold vs warm
5) Includes a minimal eval harness (Weave Evaluations) for a small task suite.

======================================================================
1) Why this is compelling (positioning vs Claude CUA / other agents)
======================================================================
You’re not trying to beat frontier operators overall in 48 hours. You’re building an improvement loop:
- Learns site/task-specific reusable macros from successful runs
- Detects and breaks loops explicitly
- Caches expensive reasoning for repeated states
- Measures and proves improvement with Weave evals and leaderboards

“Better” means: on a defined task suite, your warm runs are measurably faster and less error-prone than cold runs, with traceable evidence.

======================================================================
2) Key success metrics (must show in UI)
======================================================================
Track per run:
- success (boolean)
- wall_time_ms
- num_steps
- num_llm_calls
- num_observe_calls (Stagehand observe)
- num_retries
- num_loop_detected
- num_loop_broken
- cache_hits / cache_misses (macros + semantic cache)
- avg_action_latency_ms
- final_url and whether it matches success condition

Demo win condition:
- warm run reduces num_llm_calls and wall_time_ms vs cold on same task
- warm run reduces loops and retries
- success rate is at least as good as cold (preferably better)

======================================================================
3) Tech stack (recommended)
======================================================================
Backend (Node/TypeScript)
- Node.js 18+
- Express or Fastify (long-running tasks + SSE)
- Weave TS SDK
- OpenAI SDK (OpenAI-compatible; can point to W&B Inference)
- Redis (node-redis)
- Zod for schemas
- Pino for logs

Browser automation
- Stagehand
- Browserbase SDK (sessions + recordings)

Frontend (Next.js)
- Next.js 14+ (App Router)
- Tailwind + shadcn/ui (optional)
- SSE client for streaming run updates
- rrweb-player for embedded replay

Storage / Memory
- Redis Cloud (credits)

Deployment
- Local demo is fine; optionally deploy frontend to Vercel.
- Avoid serverless for the backend during hackathon (long tasks).

======================================================================
4) Official docs quicklinks (put in README too)
======================================================================
W&B Weave (TypeScript)
- Quickstart: https://docs.wandb.ai/weave/quickstart
- JS integrations: https://docs.wandb.ai/weave/guides/integrations/js
- Weave Evaluations tutorial: https://docs.wandb.ai/weave/tutorial-eval
- Weave env vars: https://docs.wandb.ai/weave/guides/core-types/env-vars

W&B Inference (OpenAI-compatible)
- Overview: https://docs.wandb.ai/inference
- API reference: https://docs.wandb.ai/inference/api-reference

Browserbase
- Getting started: https://docs.browserbase.com/introduction/getting-started
- Create a session: https://docs.browserbase.com/reference/api/create-a-session
- Node.js SDK: https://docs.browserbase.com/reference/sdk/nodejs
- Using a browser session: https://docs.browserbase.com/fundamentals/using-browser-session
- Session recording: https://docs.browserbase.com/features/session-recording

Stagehand
- Quickstart: https://docs.stagehand.dev/v3/first-steps/quickstart
- observe(): https://docs.stagehand.dev/v3/basics/observe

Browserbase MCP (already added in Cursor)
- MCP setup: https://docs.browserbase.com/integrations/mcp/setup
- MCP intro: https://docs.browserbase.com/integrations/mcp/introduction

Redis
- Redis APIs overview: https://redis.io/docs/latest/apis/
- node-redis guide: https://redis.io/docs/latest/develop/clients/nodejs/
- node-redis package: https://www.npmjs.com/package/redis

======================================================================
5) Repo layout (monorepo)
======================================================================
loopless/
  apps/
    web/                # Next.js UI
    server/             # Express/Fastify backend + agent runner
  packages/
    shared/             # shared types, zod schemas
  scripts/
    seed_tasks.ts
    run_eval.ts
  AGENT.md
  README.md
  .env.example
  package.json
  pnpm-workspace.yaml

Note: repo root folder can remain self_improved_browser; “LoopLess” is branding.

======================================================================
6) Environment variables (.env.example)
======================================================================
Weave / W&B
- WANDB_API_KEY=...
- WEAVE_PROJECT=your-entity/loopless (or use weave.init() string)

LLM Provider
Option A: W&B Inference (recommended)
- LLM_PROVIDER=wandb_inference
- WANDB_INFERENCE_BASE_URL=https://api.inference.wandb.ai/v1
- WANDB_INFERENCE_API_KEY=$WANDB_API_KEY
- LLM_MODEL=... (choose an available model in your account)

Option B: OpenAI
- LLM_PROVIDER=openai
- OPENAI_API_KEY=...
- LLM_MODEL=gpt-4o-mini (or available)

Browserbase
- BROWSERBASE_API_KEY=...
- BROWSERBASE_PROJECT_ID=...

Redis
- REDIS_URL=redis://... (or rediss://...)
- REDIS_PREFIX=loopless
- REDIS_TTL_SECONDS=604800

App
- APP_ENV=development|production
- SERVER_PORT=3001
- WEB_BASE_URL=http://localhost:3000

======================================================================
7) MVP DESIGN (build this first; demo-able in 6–10 hours)
======================================================================
Goal: Ship a working LoopLess demo that clearly shows “warm run is better than cold run”.

MVP Feature Set (MUST HAVE)
A) One supported “workflow task” (SauceDemo checkout recommended)
B) Agent runner that:
   - uses Browserbase session + Stagehand for actions
   - logs to Weave
   - stores minimal learning in Redis
C) A minimal UI or CLI output that shows:
   - run id
   - success/failure
   - steps, time, LLM calls
   - link to Weave trace
   - link to Browserbase session recording (or rrweb)

MVP Architecture
- Backend owns everything: start run, execute, log, store results.
- Frontend is optional in MVP. If no frontend:
  - Provide a terminal command `pnpm run demo:twice` that runs cold then warm and prints results + links.
- If frontend exists in MVP:
  - Home page with task dropdown and buttons: Run Cold, Run Warm, Run Twice.
  - A run page showing streaming step events via SSE.

MVP Task Definition
- Task: SauceDemo checkout
- Success check: page contains “THANK YOU” OR url includes “checkout-complete”
- Cap steps: 40
- “Cold run” must NOT use cached macros
- “Warm run” must use cached macros

MVP Learning (Redis)
- Only implement one thing: action macros keyed by page signature.
- On each successful step:
  - store (pageSig -> nextAction) macro
- On warm run:
  - if macro exists for pageSig, execute macro (skip planner LLM)
- This produces immediate reduction in LLM calls.

MVP Weave Logging
- Wrap: runTask, planStep, executeAction, validate
- Log per-step metadata (step#, url_before/after, action, cache_hit, latency)
- Log final metrics.

MVP Proof
- Run Twice shows: warm run has higher cache_hits, fewer llm_calls, lower time.

MVP Acceptance Criteria
- SauceDemo checkout succeeds at least once in cold mode.
- Warm mode achieves:
  - >= 30% fewer LLM calls, OR
  - >= 20% faster wall time
- Weave shows both traces and metrics.
- Browserbase recording link works.

======================================================================
8) FEATURES ON TOP (build in this order; each one strengthens “self-improving-ness”)
======================================================================

Feature 1: Loop detection + loop breaker (high impact)
- Detect repeated page signatures with no progress.
- Breaker actions: re-observe with tighter query, back, refresh, dismiss modals, single-step vision fallback.
- Log loop events + penalties in metrics.
- Improves reliability massively; judges love this.

Feature 2: “Macro = multi-step chunk” (more than nextAction)
- Instead of pageSig -> nextAction, store pageSig -> short action list (2–6 steps).
- Validate each step; if macro fails, fall back to planner.

Feature 3: Failure memory (anti-pattern learning)
- Store last failures per (domain, intent, pageSig):
  - error, screenshot ref (optional), and successful recovery action
- Planner consults these to avoid repeating mistakes.

Feature 4: Semantic cache (reduce repeated planning)
- Cache planner outputs keyed by (task instruction + state summary hash).
- Redis stores: semantic_decision:{hash} -> nextAction
- Reduces LLM calls even when macros are missing.

Feature 5: Compare view + run registry (demo polish)
- Store run metadata in Redis (runId -> metrics, weave link, sessionId).
- UI shows list of runs and can compare two.
- This makes the demo “product-like”.

Feature 6: rrweb embed + step synchronization (wow factor)
- Add /api/runs/:runId/rrweb endpoint.
- Embed rrweb-player.
- When user clicks a step in the timeline, seek replay near that timestamp.
- Makes debugging and demo incredible.

Feature 7: Eval suite (Weave Evaluations) + leaderboard (judge-friendly)
- Create 5–10 tasks dataset.
- Run nightly or on demand.
- Show Weave leaderboard: success, steps, llm_calls, time.
- This is the “self-improving proof” artifact.

Feature 8: “Strategy router” (optional)
- Try 2 strategies (e.g., observe-heavy vs macro-heavy).
- Learn which performs best by domain and intent (store routing policy in Redis).

Feature 9: Safety critic (optional but differentiating)
- Block unsafe clicks (“delete”, “transfer”, “purchase”) without explicit user confirmation.
- Log “unsafe prevented” count.

======================================================================
9) Implementation order (Cursor must follow this)
======================================================================
Phase 1 — MVP skeleton
1) Create pnpm monorepo + TS configs
2) Backend service with:
   - POST /api/runs
   - GET /api/runs/:id
   - GET /api/runs/:id/events (SSE)
3) Redis connection + health check
4) Weave init + sample op
5) Browserbase session + Stagehand script that can navigate to a URL

Phase 2 — MVP runner
6) Implement SauceDemo task and success check
7) Implement per-step logging + metrics
8) Implement page_signature
9) Implement macro store:
   - on cold run: write macros
   - on warm run: read macros and skip planner LLM
10) Implement Run Twice flow (server or UI button)

Phase 3 — Feature layering
11) Loop detection + breaker
12) Multi-step macros
13) Semantic cache
14) rrweb embed + compare view
15) Weave eval harness

======================================================================
10) Agent design (core)
======================================================================
10.1 DOM-first, vision fallback
Prefer structured automation:
- Stagehand observe() to list actionable items
- Stagehand act() to click/type/select in natural language
Use vision only if stuck.

10.2 State representation (PageState)
At each step, capture:
- url, title
- headings
- top N actionable items (text labels)
- key form labels/fields
- last action and result
- progress marker (task-specific)

10.3 Page signature
Compute:
- sha256(hostname + url_path + h1 + form_labels + primary_button_texts)

Store:
- signature history (for loop detection)
- signature -> macro mapping (for learning)

10.4 Planner policy
Step order:
- try macro (warm mode)
- else observe candidates
- choose action with LLM
- execute
- validate progress
- store macro if success

10.5 Validation
Progress if:
- URL changes toward expected path
- success text appears
- task progress marker advances (e.g., checkout step changes)

10.6 Loop breaker policy
If signature repeats 3 times without progress:
- run “modal dismiss”
- run observe("find the most likely next button to advance checkout")
- consider back/refresh
- if still stuck, do one vision-guided step then return to DOM-first

======================================================================
11) Weave instrumentation (mandatory)
======================================================================
Docs: https://docs.wandb.ai/weave/quickstart

Weave ops to implement:
- runTask(task) root op
- buildState()
- planStep(state)
- executeAction(action)
- validateProgress()
- learnMacro()

Metadata per step:
- step index
- action text
- cache_hit (macro or semantic)
- url before/after
- page signature
- latency
- observe candidates count

Weave Evaluations:
Docs: https://docs.wandb.ai/weave/tutorial-eval
Scorers:
- success
- steps (lower)
- llm_calls (lower)
- time (lower)
- loop_penalty (lower)

======================================================================
12) Browserbase + Stagehand integration (mandatory)
======================================================================
Browserbase: https://docs.browserbase.com/introduction/getting-started
Stagehand: https://docs.stagehand.dev/v3/first-steps/quickstart

Required runtime behavior:
- Create Browserbase session for each run and store sessionId in run metadata.
- Initialize Stagehand in Browserbase mode and connect to session.
- Ensure session recording is enabled (Browserbase supports recording; store link).
- Expose recording link in UI and run metadata.

rrweb replay:
Docs: https://docs.browserbase.com/features/session-recording
Backend endpoint:
- GET /api/runs/:id/rrweb -> returns rrweb events payload
Frontend:
- embed rrweb-player

======================================================================
13) Browserbase MCP (nice-to-have)
======================================================================
Use MCP inside Cursor for quick experiments; product runtime uses SDK.
Docs:
- https://docs.browserbase.com/integrations/mcp/setup
- https://docs.browserbase.com/integrations/mcp/introduction

======================================================================
14) Redis design (mandatory)
======================================================================
Docs:
- APIs: https://redis.io/docs/latest/apis/
- node-redis: https://redis.io/docs/latest/develop/clients/nodejs/

Key schema (prefix with REDIS_PREFIX)
- loopless:macro:{domain}:{intent}:{pageSig} -> JSON
- loopless:run:{runId} -> JSON
- loopless:run_events:{runId} -> LIST (optional)
- loopless:semantic:{hash} -> JSON (optional)
- loopless:lock:{domain}:{intent} -> SET NX EX

Macro JSON fields (minimum)
- actions: array of action strings (start with 1 action in MVP; expand later)
- success_count
- fail_count
- last_success_ts
- metadata: observe_query, notes

TTL
- macros: 30 days
- runs: 7 days
- run_events: 1 day

======================================================================
15) Backend API contract
======================================================================
- POST /api/runs
  body: { task_id, mode: "cold"|"warm"|"twice", overrides?: {...} }
  returns: { run_id or { cold_run_id, warm_run_id } }

- GET /api/runs/:run_id
  returns: run metadata (status, metrics, weave link, sessionId, recording link)

- GET /api/runs/:run_id/events (SSE)
  streams JSON events:
  - run_started
  - step_planned
  - step_executed
  - step_validated
  - loop_detected
  - loop_broken
  - macro_saved
  - run_finished
  - run_failed

- GET /api/tasks
  returns list of tasks

- GET /api/runs/:run_id/rrweb
  returns rrweb events for embedding replay

======================================================================
16) Frontend spec (demo-ready)
======================================================================
Pages
1) / Home
- Task picker
- Run Cold
- Run Warm
- Run Twice
- Recent runs list

2) /runs/[runId]
- Live timeline console
- Metrics cards
- Link to Browserbase recording
- rrweb replay embed

3) /compare?runA=...&runB=...
- Side-by-side metrics
- Improvement deltas
- Replay A and replay B

Components
- TaskPicker
- RunConsole (SSE)
- MetricsCard
- ReplayPlayer (rrweb-player)
- CompareTable

======================================================================
17) Demo tasks (at least 2)
======================================================================
Task A (primary): SauceDemo checkout
- https://www.saucedemo.com/
- login -> add 2 items -> cart -> checkout -> finish
- success: page contains "THANK YOU" or url includes "checkout-complete"

Task B: Hacker News extraction
- https://news.ycombinator.com
- extract top 5 titles as JSON

======================================================================
18) Definition of Done (hackathon)
======================================================================
You are done when:
- SauceDemo run-twice works and warm run is measurably better (fewer llm_calls/time).
- Weave trace links exist for both runs and show step-level metadata.
- Redis contains macros and warm run uses them (cache_hits visible).
- Browserbase recording links work; rrweb embed is a bonus.
- Repo is public, has README, and you can do a 2-minute demo video.

======================================================================
19) Naming options (if you want alternatives)
======================================================================
Primary recommendation: LoopLess
Other strong options:
- TracePilot
- MacroWeaver
- WebWeaver
- ClickSmith
- BrowserGym
- PathFinder