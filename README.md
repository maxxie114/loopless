# LoopLess - Self-Improving Browser Agent

[![Demo Video](https://img.youtube.com/vi/KKCXkOnlggY/0.jpg)](https://youtu.be/KKCXkOnlggY?si=5NBKsZOc_Czk9Qby)

**🎥 Watch the Demo:** [YouTube - LoopLess Demo](https://youtu.be/KKCXkOnlggY?si=5NBKsZOc_Czk9Qby)

---

A **self-improving browser agent** that becomes faster and more reliable over time by learning loop-breaking, DOM-first "macro" behaviors with **Redis**, and proving improvements with **W&B Weave** evals and traces. Built with **Google Gemini 3 Flash Preview**, **BrowserBase**, and **Stagehand**.

**Tagline:** *Cold run learns. Warm run reuses cached macros and finishes with fewer LLM calls, fewer steps, and less time.*

## 🎯 What It Does

LoopLess is an autonomous browser automation agent that:
1. **Executes complex web tasks** (checkout, calendar events, email management)
2. **Learns from experience** - caches successful action sequences as "macros"
3. **Self-improves** - uses LLM-as-a-Judge to evaluate and refine its behavior
4. **Gets faster over time** - warm runs use cached knowledge to reduce LLM calls by 45%

## ✨ Key Features

- **🎥 Live Browser View** - Watch the agent execute tasks in real-time via BrowserBase live streaming
- **📹 Session Recordings** - Watch past executions permanently via BrowserBase recordings
- **🧠 Self-Improvement Loop** - Agent learns from failures and improves prompts automatically using Gemini
- **📊 Weave Evaluation Framework** - Proper integration with Weave's built-in Evaluation class and scorers
- **🤖 LLM-as-a-Judge** - Uses Gemini 3 Flash Preview to evaluate task completion and macro validity
- **💾 Sequence-Aware Macro Caching** - Contextual action sequences cached in Redis for intelligent reuse
- **🔄 Loop Detection** - Automatic detection and breaking of repetitive action loops
- **🎯 AGI Inc Benchmark Tasks** - GoCalendar, GoMail, MarriSuite, NetworkIn tasks

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        LoopLess Agent                           │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  Cold Run    │→│  LLM Judge   │→│  Warm Run    │         │
│  │  (Learning)  │  │  (Evaluate)  │  │  (Optimized) │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│         ↓                  ↓                  ↓                │
│  ┌──────────────────────────────────────────────────────┐     │
│  │         Gemini 3 Flash Preview (Agent Brain)         │     │
│  │  - Action Planning  - Macro Validation  - Judging    │     │
│  └──────────────────────────────────────────────────────┘     │
│         ↓                  ↓                  ↓                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │  BrowserBase │  │     Redis    │  │  W&B Weave   │         │
│  │  (Browser)   │  │   (Cache)    │  │ (Analytics)  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Quick Start

### 1. Clone and install

```bash
git clone https://github.com/yourusername/loopless.git
cd loopless
pnpm install
```

### 2. Environment Setup

Copy `.env.example` to `.env` and configure:

```bash
# Required: Google Gemini (Primary LLM)
GOOGLE_API_KEY=your_gemini_api_key
LLM_PROVIDER=google
LLM_MODEL=gemini-3-flash-preview

# Required: W&B Weave (Observability & Evaluation)
WANDB_API_KEY=your_wandb_api_key
WEAVE_PROJECT=your-entity/weavehacks/loopless

# Required: BrowserBase (Browser Automation)
BROWSERBASE_API_KEY=your_browserbase_key
BROWSERBASE_PROJECT_ID=your_project_id

# Required: Redis (Macro Cache)
REDIS_URL=redis://localhost:6379
# Or use Redis Cloud: rediss://default:pass@host:port
```

### 3. Run Redis (local)

```bash
docker run -d -p 6379:6379 redis:7-alpine
```

### 4. Build and Start

```bash
# Build shared package
pnpm --filter @loopless/shared build

# Start both server and web UI
pnpm dev
```

- **Server:** http://localhost:3001  
- **Web UI:** http://localhost:3000

### 5. Run Demo (Cold vs Warm)

```bash
# This will run SauceDemo checkout twice:
# - Cold: No prior knowledge (baseline)
# - Warm: With learned macros (optimized)
pnpm run demo:twice
```

**Expected Results:**
| Metric | Cold Run | Warm Run | Improvement |
|--------|----------|----------|-------------|
| Time | ~180s | ~140s | **-22%** |
| LLM Calls | 11 | ~6 | **-45%** |
| Cache Hits | 0 | 4-5 | New! |

## 📊 Weave Integration

This project uses W&B Weave for comprehensive observability and evaluation:

### Tracing
All agent operations are automatically traced:
- `runTaskOp` - Full task execution
- `planStepOp` - LLM planning calls
- `executeActionOp` - Browser actions
- `validateProgressOp` - Progress validation
- `learnMacroOp` - Macro learning

### Scorers
| Scorer | Description | Metrics |
|--------|-------------|---------|
| `taskSuccessScorer` | Did the task complete? | passed, score |
| `efficiencyScorer` | Was the agent efficient? | steps, LLM calls |
| `loopDetectionScorer` | Did it avoid loops? | loopsDetected |
| `cacheUtilizationScorer` | Macro cache usage | cacheHitRate |
| `llmJudgeScorer` | Gemini-as-a-judge | verdict, reason |

## 🧪 Benchmark Tasks

LoopLess includes 16 benchmark tasks across 4 AGI Inc domains:

| Domain | Tasks |
|--------|-------|
| **GoCalendar** | Create event, Edit event, Recurring event, Weekday event |
| **GoMail** | Count unread, Compose email, Delete email, Archive email |
| **MarriSuite** | Book room, Search hotels, Filter results, View reservation |
| **NetworkIn** | View profile, Send message, Search jobs, Update profile |

## 💻 Tech Stack

- **LLM:** Google Gemini 3 Flash Preview (via Google AI SDK)
- **Backend:** Node.js 20+, Express, TypeScript
- **Observability:** W&B Weave (Tracing & Evaluations)
- **Browser:** Stagehand + BrowserBase (sessions + recordings)
- **Frontend:** Next.js 14, Tailwind CSS
- **Cache:** Redis (macros, run metadata)
- **Package Manager:** pnpm workspaces

## 📁 Project Structure

```
loopless/
├── apps/
│   ├── server/          # Express API + Agent Runner
│   │   ├── src/
│   │   │   ├── agent/          # Agent logic & runner
│   │   │   ├── macro-sequence.ts  # NEW: Sequence-aware caching
│   │   │   ├── evaluation/     # LLM-as-a-Judge
│   │   │   └── api/            # REST API routes
│   │   └── Dockerfile
│   └── web/             # Next.js UI
├── packages/
│   └── shared/          # Zod schemas, types
├── scripts/
│   └── test-all-tasks.ts  # Benchmark runner
├── README.md
└── IMPROVEMENTS.md      # Technical deep-dive
```

## 🌐 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /api/runs` | Start a run (cold/warm/twice) |
| `GET /api/runs` | List recent runs |
| `GET /api/runs/:id` | Run metadata and metrics |
| `GET /api/runs/:id/events` | SSE stream of step events |
| `GET /api/tasks` | List available tasks |

## 📈 Success Metrics

A successful warm run shows:
- **≥30% fewer LLM calls** vs cold run
- **≥20% faster wall time** vs cold run
- **Higher cache hit rate** on repeated workflows
- **Same or better success rate**

## 🚢 Deployment

### Frontend (Vercel)
1. Connect GitHub repo to Vercel
2. Set root directory to `apps/web`
3. Add env: `NEXT_PUBLIC_API_URL=<server-url>`
4. Deploy

### Backend (Railway/Render)
1. Use `apps/server/Dockerfile`
2. Set env vars (see Quick Start)
3. Deploy and update Vercel with server URL

## 📚 Documentation

- [W&B Weave Documentation](https://docs.wandb.ai/weave/quickstart)
- [Gemini API Documentation](https://ai.google.dev/docs)
- [BrowserBase Documentation](https://docs.browserbase.com/)
- [Stagehand Documentation](https://docs.stagehand.dev/)

## 📜 License

See [LICENSE](LICENSE).

---

**Built with ❤️ for the Gemini 3 Hackathon**

*Powered by Google Gemini 3 Flash Preview, W&B Weave, and BrowserBase*
