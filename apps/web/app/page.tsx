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
    num_loop_detected: number;
    recording_url?: string;
    browserbase_session_id?: string;
  };
  error?: string;
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

  // Poll for run updates every 5 seconds
  useEffect(() => {
    const fetchRuns = () => {
      fetch(`${API}/runs`)
        .then((r) => r.json())
        .then((list) => Array.isArray(list) ? setRuns(list) : setRuns([]))
        .catch(() => setRuns([]));
    };
    fetchRuns();
    const interval = setInterval(fetchRuns, 5000);
    return () => clearInterval(interval);
  }, []);

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

  // Helper to get task result badge
  function getResultBadge(run: RunMeta) {
    if (run.status === "running" || run.status === "pending") {
      return <span className="px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-400 animate-pulse">Running...</span>;
    }
    if (run.metrics?.success) {
      return <span className="px-2 py-0.5 rounded text-xs bg-green-500/20 text-green-400 font-semibold">✓ PASS</span>;
    }
    return <span className="px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-400 font-semibold">✗ FAIL</span>;
  }

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-8">
      <header className="border-b border-[var(--border)] pb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">LoopLess</h1>
            <p className="text-[var(--muted)] mt-2">
              Self-improving browser agent — cold run learns, warm run reuses macros.
            </p>
          </div>
          <Link 
            href="/auto-improve"
            className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-medium transition-all flex items-center gap-2"
          >
            🔄 Auto-Improve Mode
          </Link>
        </div>
      </header>

      <section className="card p-6 space-y-4">
        <h2 className="font-semibold text-white text-lg">Select Task</h2>
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
            className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium disabled:opacity-50 transition-colors"
            onClick={() => startRun("cold")}
            disabled={!!loading}
          >
            {loading === "cold" ? "Starting…" : "🧊 Run Cold"}
          </button>
          <button
            className="px-5 py-2.5 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-medium disabled:opacity-50 transition-colors"
            onClick={() => startRun("warm")}
            disabled={!!loading}
          >
            {loading === "warm" ? "Starting…" : "🔥 Run Warm"}
          </button>
          <button
            className="px-5 py-2.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white font-medium disabled:opacity-50 transition-colors"
            onClick={() => startRun("twice")}
            disabled={!!loading}
          >
            {loading === "twice" ? "Starting…" : "🔄 Run Twice (Cold → Warm)"}
          </button>
        </div>
        {error && <p className="text-[var(--error)] text-sm">{error}</p>}
      </section>

      <section className="card p-6">
        <h2 className="font-semibold text-white mb-4 text-lg">Recent Runs</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[var(--muted)] border-b border-[var(--border)]">
                <th className="pb-2 font-medium">Run ID</th>
                <th className="pb-2 font-medium">Mode</th>
                <th className="pb-2 font-medium">Result</th>
                <th className="pb-2 font-medium">Steps</th>
                <th className="pb-2 font-medium">LLM Calls</th>
                <th className="pb-2 font-medium">Cache</th>
                <th className="pb-2 font-medium">Loops</th>
                <th className="pb-2 font-medium">Recording</th>
                <th className="pb-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-[var(--muted)]">No runs yet. Start a run above!</td>
                </tr>
              )}
              {runs.slice(0, 20).map((run) => (
                <tr key={run.run_id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg)]/50">
                  <td className="py-3 font-mono text-xs text-[var(--muted)]">{run.run_id.slice(0, 8)}</td>
                  <td className="py-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${run.mode === "cold" ? "bg-blue-500/20 text-blue-400" : "bg-orange-500/20 text-orange-400"}`}>
                      {run.mode}
                    </span>
                  </td>
                  <td className="py-3">{getResultBadge(run)}</td>
                  <td className="py-3 text-[var(--muted)]">{run.metrics?.num_steps ?? "-"}</td>
                  <td className="py-3 text-[var(--muted)]">{run.metrics?.num_llm_calls ?? "-"}</td>
                  <td className="py-3">
                    {run.metrics && (
                      <span className={run.metrics.cache_hits > 0 ? "text-green-400" : "text-[var(--muted)]"}>
                        {run.metrics.cache_hits}/{(run.metrics.cache_hits || 0) + (run.metrics.cache_misses || 0)}
                      </span>
                    )}
                  </td>
                  <td className="py-3">
                    {run.metrics?.num_loop_detected !== undefined && run.metrics.num_loop_detected > 0 ? (
                      <span className="text-yellow-400">{run.metrics.num_loop_detected}</span>
                    ) : (
                      <span className="text-[var(--muted)]">0</span>
                    )}
                  </td>
                  <td className="py-3">
                    {run.metrics?.recording_url ? (
                      <a
                        href={run.metrics.recording_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent)] hover:underline"
                      >
                        🎬 Watch
                      </a>
                    ) : (
                      <span className="text-[var(--muted)]">-</span>
                    )}
                  </td>
                  <td className="py-3">
                    <Link
                      href={`/runs/${run.run_id}`}
                      className="text-[var(--accent)] hover:underline"
                    >
                      Details →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
