"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";

const API = "/api";
// For SSE, we need to call the server directly as Next.js proxy may buffer responses
const SSE_API = typeof window !== "undefined" 
  ? (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001") + "/api"
  : "/api";

type RunMeta = {
  run_id: string;
  task_id: string;
  mode: string;
  status: string;
  metrics?: {
    success: boolean;
    wall_time_ms: number;
    num_steps: number;
    num_llm_calls: number;
    num_observe_calls: number;
    cache_hits: number;
    cache_misses: number;
    num_loop_detected: number;
    num_loop_broken: number;
    final_url?: string;
    recording_url?: string;
    browserbase_session_id?: string;
    live_view_url?: string;
  };
  error?: string;
};

type StreamEvent = { type: string; payload: Record<string, unknown>; ts?: string };

export default function RunPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;
  const [run, setRun] = useState<RunMeta | null>(null);
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [live, setLive] = useState(true);
  const [liveViewUrl, setLiveViewUrl] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/runs/${runId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setRun)
      .catch(() => setRun(null));
  }, [runId]);

  useEffect(() => {
    const es = new EventSource(`${SSE_API}/runs/${runId}/events`);
    
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as StreamEvent;
        if (data.type === "error") return;
        setEvents((prev) => [...prev, data]);
        
        // Capture live view URL when ready
        if (data.type === "live_view_ready" && data.payload?.live_view_url) {
          setLiveViewUrl(data.payload.live_view_url as string);
        }
        
        if (data.type === "run_finished" || data.type === "run_failed") {
          setLive(false);
          setLiveViewUrl(null); // Clear live view when done
          es.close();
          fetch(`${API}/runs/${runId}`).then((r) => r.json()).then(setRun);
        }
      } catch (_) {}
    };
    es.onerror = () => {
      setLive(false);
      es.close();
    };
    return () => es.close();
  }, [runId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  // Poll for updates while running
  useEffect(() => {
    if (run?.status === "running" || run?.status === "pending") {
      const interval = setInterval(() => {
        fetch(`${API}/runs/${runId}`)
          .then((r) => (r.ok ? r.json() : null))
          .then(setRun);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [runId, run?.status]);

  if (!run && events.length === 0) {
    return (
      <main className="max-w-5xl mx-auto p-6">
        <p className="text-[var(--muted)]">Loading run…</p>
      </main>
    );
  }

  const isSuccess = run?.metrics?.success === true;
  const isRunning = run?.status === "running" || run?.status === "pending";

  // Calculate cache hit rate
  const cacheTotal = (run?.metrics?.cache_hits || 0) + (run?.metrics?.cache_misses || 0);
  const cacheRate = cacheTotal > 0 ? Math.round((run?.metrics?.cache_hits || 0) / cacheTotal * 100) : 0;

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push("/")}
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← Back to Dashboard
        </button>
        <span className="text-xs font-mono text-[var(--muted)]">{runId}</span>
      </div>

      {/* Result Banner */}
      {run && !isRunning && (
        <div className={`p-4 rounded-lg ${isSuccess ? "bg-green-500/10 border border-green-500/30" : "bg-red-500/10 border border-red-500/30"}`}>
          <div className="flex items-center gap-3">
            <span className="text-3xl">{isSuccess ? "✅" : "❌"}</span>
            <div>
              <h2 className={`text-xl font-bold ${isSuccess ? "text-green-400" : "text-red-400"}`}>
                {isSuccess ? "TASK PASSED" : "TASK FAILED"}
              </h2>
              <p className="text-sm text-[var(--muted)]">
                {run.mode === "cold" ? "Cold Run (Learning)" : "Warm Run (Using Macros)"}
                {run.metrics?.final_url && ` • Final: ${run.metrics.final_url}`}
              </p>
            </div>
          </div>
          {run.error && (
            <p className="mt-2 text-sm text-red-400">Error: {run.error}</p>
          )}
        </div>
      )}

      {/* Running Status */}
      {run && isRunning && (
        <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
          <div className="flex items-center gap-3">
            <span className="text-3xl animate-spin">⚡</span>
            <div>
              <h2 className="text-xl font-bold text-blue-400">RUNNING...</h2>
              <p className="text-sm text-[var(--muted)]">
                {run.mode === "cold" ? "Cold Run (Learning)" : "Warm Run (Using Macros)"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Live View Stream */}
      {liveViewUrl && isRunning && (
        <section className="card p-6">
          <h3 className="font-semibold text-white mb-4 text-lg flex items-center gap-2">
            <span className="text-red-500 animate-pulse">●</span>
            Live Browser View
          </h3>
          <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
            <iframe
              src={liveViewUrl}
              className="absolute top-0 left-0 w-full h-full rounded-lg border border-[var(--border)]"
              sandbox="allow-same-origin allow-scripts"
              allow="clipboard-read; clipboard-write"
            />
          </div>
          <p className="text-xs text-[var(--muted)] mt-2">
            Watching browser session in real-time. You can interact with the browser if needed.
          </p>
        </section>
      )}

      {/* Metrics Grid */}
      {run?.metrics && (
        <section className="card p-6">
          <h3 className="font-semibold text-white mb-4 text-lg">Performance Metrics</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-[var(--bg)] p-3 rounded-lg">
              <p className="text-xs text-[var(--muted)]">Steps</p>
              <p className="text-2xl font-bold">{run.metrics.num_steps}</p>
            </div>
            <div className="bg-[var(--bg)] p-3 rounded-lg">
              <p className="text-xs text-[var(--muted)]">LLM Calls</p>
              <p className="text-2xl font-bold">{run.metrics.num_llm_calls}</p>
            </div>
            <div className="bg-[var(--bg)] p-3 rounded-lg">
              <p className="text-xs text-[var(--muted)]">Cache Hits</p>
              <p className="text-2xl font-bold text-green-400">{run.metrics.cache_hits}</p>
              <p className="text-xs text-[var(--muted)]">{cacheRate}% hit rate</p>
            </div>
            <div className="bg-[var(--bg)] p-3 rounded-lg">
              <p className="text-xs text-[var(--muted)]">Cache Misses</p>
              <p className="text-2xl font-bold text-orange-400">{run.metrics.cache_misses}</p>
            </div>
            <div className="bg-[var(--bg)] p-3 rounded-lg">
              <p className="text-xs text-[var(--muted)]">Loops Detected</p>
              <p className={`text-2xl font-bold ${run.metrics.num_loop_detected > 0 ? "text-yellow-400" : ""}`}>
                {run.metrics.num_loop_detected || 0}
              </p>
            </div>
            <div className="bg-[var(--bg)] p-3 rounded-lg">
              <p className="text-xs text-[var(--muted)]">Wall Time</p>
              <p className="text-2xl font-bold">{(run.metrics.wall_time_ms / 1000).toFixed(1)}s</p>
            </div>
          </div>
        </section>
      )}

      {/* Recording Link */}
      {run?.metrics?.recording_url && (
        <section className="card p-6">
          <h3 className="font-semibold text-white mb-4 text-lg">🎬 Session Recording</h3>
          <div className="flex flex-col gap-3">
            <a
              href={run.metrics.recording_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-3 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors w-fit"
            >
              <span>▶️</span>
              <span>Watch Browserbase Recording</span>
              <span>→</span>
            </a>
            <p className="text-xs text-[var(--muted)]">
              Session ID: {run.metrics.browserbase_session_id || "N/A"}
            </p>
          </div>
        </section>
      )}

      {/* Self-Improvement Analysis */}
      {run?.metrics && !isRunning && (
        <section className="card p-6">
          <h3 className="font-semibold text-white mb-4 text-lg">🧠 Self-Improvement Analysis</h3>
          <div className="space-y-3">
            {run.mode === "warm" && run.metrics.cache_hits > 0 && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-green-400">✓</span>
                <span>Used {run.metrics.cache_hits} cached macros from previous runs</span>
              </div>
            )}
            {run.mode === "warm" && run.metrics.num_llm_calls === 0 && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-green-400">✓</span>
                <span>Zero LLM calls needed - 100% macro reuse!</span>
              </div>
            )}
            {run.metrics.num_loop_detected > 0 && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-yellow-400">⚠</span>
                <span>Detected {run.metrics.num_loop_detected} loops - agent got stuck repeating actions</span>
              </div>
            )}
            {!isSuccess && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-red-400">✗</span>
                <span>Task did not complete successfully. Check recording for details.</span>
              </div>
            )}
            {run.mode === "cold" && isSuccess && (
              <div className="flex items-start gap-2 text-sm">
                <span className="text-blue-400">ℹ</span>
                <span>Learned {run.metrics.num_steps} macros for future warm runs</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Event Stream */}
      <section className="card p-6">
        <h3 className="font-semibold text-white mb-2 text-lg">
          Event Stream {live && <span className="text-xs text-green-400 animate-pulse">(live)</span>}
        </h3>
        <div className="bg-[var(--bg)] rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm space-y-1">
          {events.length === 0 && (
            <p className="text-[var(--muted)]">Waiting for events...</p>
          )}
          {events.map((e, i) => (
            <div key={i} className="flex gap-2">
              <span className={`font-semibold ${
                e.type === "run_finished" ? "text-green-400" :
                e.type === "run_failed" ? "text-red-400" :
                e.type === "loop_detected" ? "text-yellow-400" :
                e.type === "macro_saved" ? "text-purple-400" :
                "text-[var(--accent)]"
              }`}>
                {e.type}
              </span>
              <span className="text-[var(--muted)]">
                {e.payload?.step !== undefined ? `step=${String(e.payload.step)}` : null}
                {e.payload?.action ? ` → ${String(e.payload.action).slice(0, 50)}${String(e.payload.action).length > 50 ? "..." : ""}` : null}
                {e.payload?.cache_hit !== undefined ? ` (cache: ${e.payload.cache_hit ? "HIT" : "MISS"})` : null}
              </span>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </section>
    </main>
  );
}
