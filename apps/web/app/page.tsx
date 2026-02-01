"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const API = "/api";

type Task = { id: string; name: string; description: string };
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
    cache_hits: number;
    cache_misses: number;
    recording_url?: string;
  };
};

export default function Home() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<string>("saucedemo-checkout");
  const [runs, setRuns] = useState<RunMeta[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${API}/tasks`)
      .then((r) => r.json())
      .then(setTasks)
      .catch(() => setTasks([{ id: "saucedemo-checkout", name: "SauceDemo Checkout", description: "Login, add 2 items, checkout" }]));
  }, []);

  useEffect(() => {
    fetch(`${API}/runs`)
      .then((r) => r.json())
      .then((list) => Array.isArray(list) ? setRuns(list) : setRuns([]))
      .catch(() => setRuns([]));
  }, [loading]);

  async function startRun(mode: "cold" | "warm" | "twice") {
    setError(null);
    setLoading(mode);
    try {
      const res = await fetch(`${API}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task_id: selectedTask, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start run");
      if (data.cold_run_id) {
        setRuns((prev) => [...prev, { run_id: data.cold_run_id, task_id: selectedTask, mode: "cold", status: "running" }, { run_id: data.warm_run_id, task_id: selectedTask, mode: "warm", status: "pending" }]);
      } else {
        setRuns((prev) => [{ run_id: data.run_id, task_id: selectedTask, mode, status: "running" }, ...prev]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(null);
    }
  }

  return (
    <main className="max-w-4xl mx-auto p-6 space-y-8">
      <header className="border-b border-[var(--border)] pb-6">
        <h1 className="text-2xl font-bold text-white">LoopLess</h1>
        <p className="text-[var(--muted)] mt-1">
          Self-improving browser agent — cold run learns, warm run reuses macros.
        </p>
      </header>

      <section className="card p-6 space-y-4">
        <h2 className="font-semibold text-white">Task</h2>
        <select
          className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
          value={selectedTask}
          onChange={(e) => setSelectedTask(e.target.value)}
        >
          {tasks.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
        <div className="flex gap-3 flex-wrap">
          <button
            className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white font-medium disabled:opacity-50"
            onClick={() => startRun("cold")}
            disabled={!!loading}
          >
            {loading === "cold" ? "Starting…" : "Run Cold"}
          </button>
          <button
            className="px-4 py-2 rounded-lg bg-[var(--accent)]/80 text-white font-medium disabled:opacity-50"
            onClick={() => startRun("warm")}
            disabled={!!loading}
          >
            {loading === "warm" ? "Starting…" : "Run Warm"}
          </button>
          <button
            className="px-4 py-2 rounded-lg bg-violet-600 text-white font-medium disabled:opacity-50"
            onClick={() => startRun("twice")}
            disabled={!!loading}
          >
            {loading === "twice" ? "Starting…" : "Run Twice (Cold → Warm)"}
          </button>
        </div>
        {error && <p className="text-[var(--error)] text-sm">{error}</p>}
      </section>

      <section className="card p-6">
        <h2 className="font-semibold text-white mb-4">Recent runs</h2>
        <ul className="space-y-2">
          {runs.length === 0 && <li className="text-[var(--muted)] text-sm">No runs yet.</li>}
          {runs.slice(0, 15).map((run) => (
            <li key={run.run_id} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-[var(--muted)]">{run.run_id.slice(0, 8)}</span>
                <span className="capitalize">{run.mode}</span>
                <span className={`text-sm ${run.status === "finished" ? "text-[var(--success)]" : run.status === "failed" ? "text-[var(--error)]" : "text-[var(--muted)]"}`}>
                  {run.status}
                </span>
              </div>
              <div className="flex items-center gap-4">
                {run.metrics && (
                  <span className="text-xs text-[var(--muted)]">
                    {run.metrics.num_steps} steps · {run.metrics.num_llm_calls} LLM · {run.metrics.cache_hits ?? 0} cache
                  </span>
                )}
                <Link
                  href={`/runs/${run.run_id}`}
                  className="text-sm text-[var(--accent)] hover:underline"
                >
                  View
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
