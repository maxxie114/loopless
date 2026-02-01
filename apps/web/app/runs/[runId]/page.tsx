"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";

const API = "/api";

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
    final_url?: string;
    recording_url?: string;
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
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`${API}/runs/${runId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setRun)
      .catch(() => setRun(null));
  }, [runId]);

  useEffect(() => {
    const es = new EventSource(`${API}/runs/${runId}/events`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as StreamEvent;
        if (data.type === "error") return;
        setEvents((prev) => [...prev, data]);
        if (data.type === "run_finished" || data.type === "run_failed") {
          setLive(false);
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

  if (!run && events.length === 0) {
    return (
      <main className="max-w-4xl mx-auto p-6">
        <p className="text-[var(--muted)]">Loading run…</p>
      </main>
    );
  }

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <button
          onClick={() => router.push("/")}
          className="text-sm text-[var(--accent)] hover:underline"
        >
          ← Back
        </button>
        <span className="text-xs font-mono text-[var(--muted)]">{runId}</span>
      </div>

      {run && (
        <section className="card p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-[var(--muted)]">Status</p>
            <p className={run.status === "finished" ? "text-[var(--success)]" : run.status === "failed" ? "text-[var(--error)]" : ""}>
              {run.status}
            </p>
          </div>
          {run.metrics && (
            <>
              <div>
                <p className="text-xs text-[var(--muted)]">Steps</p>
                <p>{run.metrics.num_steps}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">LLM calls</p>
                <p>{run.metrics.num_llm_calls}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Cache hits</p>
                <p>{run.metrics.cache_hits}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)]">Time</p>
                <p>{(run.metrics.wall_time_ms / 1000).toFixed(1)}s</p>
              </div>
              {run.metrics.recording_url && (
                <div className="col-span-2">
                  <a
                    href={run.metrics.recording_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--accent)] hover:underline"
                  >
                    Browserbase recording →
                  </a>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <section className="card p-6">
        <h2 className="font-semibold text-white mb-2">
          Event stream {live && <span className="text-xs text-[var(--success)]">(live)</span>}
        </h2>
        <div className="bg-[var(--bg)] rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-sm space-y-1">
          {events.map((e, i) => (
            <div key={i} className="text-[var(--muted)]">
              <span className="text-[var(--accent)]">{e.type}</span>{" "}
              {e.payload?.step !== undefined && `step=${e.payload.step}`}
              {e.payload?.action && ` ${String(e.payload.action).slice(0, 40)}`}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </section>
    </main>
  );
}
