"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";

const API = "/api";

type Task = { id: string; name: string; description: string; domain: string };

type AutoImproveEvent = {
  type: string;
  attempt: number;
  maxAttempts: number;
  data: Record<string, unknown>;
  timestamp: string;
};

type AttemptResult = {
  attempt: number;
  runId: string;
  mode: "cold" | "warm";
  success: boolean;
  score: number;
  metrics: {
    steps: number;
    llmCalls: number;
    cacheHits: number;
    wallTime: number;
  };
  issues: string[];
  recommendations: string[];
  recordingUrl?: string;
  llmJudgeVerdict?: string;
};

type AutoImproveResult = {
  taskId: string;
  success: boolean;
  totalAttempts: number;
  attempts: AttemptResult[];
  improvement: {
    firstScore: number;
    lastScore: number;
    scoreDelta: number;
    stepsReduction: number;
    llmCallReduction: number;
  };
  recordings: string[];
  finalRunId?: string;
};

export default function AutoImprovePage() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<string>("saucedemo-checkout");
  const [maxAttempts, setMaxAttempts] = useState<number>(5);
  const [running, setRunning] = useState(false);
  const [events, setEvents] = useState<AutoImproveEvent[]>([]);
  const [result, setResult] = useState<AutoImproveResult | null>(null);
  const [currentAttempt, setCurrentAttempt] = useState(0);
  const eventsEndRef = useRef<HTMLDivElement>(null);

  // Fetch tasks
  useEffect(() => {
    fetch(`${API}/tasks`)
      .then((r) => r.json())
      .then(setTasks)
      .catch(() => setTasks([]));
  }, []);

  // Auto-scroll events
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events]);

  async function startAutoImprove() {
    setRunning(true);
    setEvents([]);
    setResult(null);
    setCurrentAttempt(0);

    try {
      const response = await fetch(`${API}/auto-improve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: selectedTask, maxAttempts }),
      });

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const event = JSON.parse(line.slice(6)) as AutoImproveEvent;
              setEvents((prev) => [...prev, event]);
              
              if (event.attempt) {
                setCurrentAttempt(event.attempt);
              }

              if (event.type === "complete" && event.data) {
                setResult(event.data as unknown as AutoImproveResult);
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }
      }
    } catch (err) {
      console.error("Auto-improve error:", err);
      setEvents((prev) => [...prev, {
        type: "error",
        attempt: 0,
        maxAttempts,
        data: { error: err instanceof Error ? err.message : "Unknown error" },
        timestamp: new Date().toISOString(),
      }]);
    } finally {
      setRunning(false);
    }
  }

  function getEventIcon(type: string) {
    switch (type) {
      case "started": return "🚀";
      case "attempt_started": return "▶️";
      case "attempt_completed": return "✅";
      case "evaluation_complete": return "📊";
      case "learning": return "🧠";
      case "improvement_applied": return "⬆️";
      case "success": return "🎉";
      case "max_attempts_reached": return "⏱️";
      case "error": return "❌";
      case "complete": return "🏁";
      default: return "•";
    }
  }

  function getEventColor(type: string) {
    switch (type) {
      case "success": return "text-green-400";
      case "error": return "text-red-400";
      case "learning": return "text-purple-400";
      case "improvement_applied": return "text-blue-400";
      case "evaluation_complete": return "text-yellow-400";
      default: return "text-[var(--muted)]";
    }
  }

  return (
    <main className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <header className="border-b border-[var(--border)] pb-4">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-[var(--muted)] hover:text-white">
            ← Back
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              🔄 Auto-Improvement
            </h1>
            <p className="text-[var(--muted)] text-sm">
              Run task automatically until success, learning from each failure
            </p>
          </div>
        </div>
      </header>

      {/* Controls */}
      <section className="card p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-[var(--muted)] mb-1">Task</label>
            <select
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
              value={selectedTask}
              onChange={(e) => setSelectedTask(e.target.value)}
              disabled={running}
            >
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-[var(--muted)] mb-1">Max Attempts</label>
            <select
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm"
              value={maxAttempts}
              onChange={(e) => setMaxAttempts(Number(e.target.value))}
              disabled={running}
            >
              {[3, 5, 7, 10].map((n) => (
                <option key={n} value={n}>{n} attempts</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <button
              className="w-full px-5 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 text-white font-medium disabled:opacity-50 transition-all"
              onClick={startAutoImprove}
              disabled={running}
            >
              {running ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="animate-spin">⚡</span>
                  Running Attempt {currentAttempt}/{maxAttempts}...
                </span>
              ) : (
                "🚀 Start Auto-Improvement"
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Progress & Events */}
      {events.length > 0 && (
        <section className="card p-5">
          <h2 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            📋 Progress Log
            {running && <span className="text-xs text-[var(--muted)] animate-pulse">Live</span>}
          </h2>
          
          {/* Progress Bar */}
          {running && (
            <div className="mb-4">
              <div className="flex justify-between text-xs text-[var(--muted)] mb-1">
                <span>Attempt {currentAttempt} of {maxAttempts}</span>
                <span>{Math.round((currentAttempt / maxAttempts) * 100)}%</span>
              </div>
              <div className="h-2 bg-[var(--bg)] rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-violet-500 to-purple-500 transition-all duration-500"
                  style={{ width: `${(currentAttempt / maxAttempts) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Event Stream */}
          <div className="space-y-2 max-h-80 overflow-y-auto font-mono text-xs">
            {events.map((event, i) => (
              <div 
                key={i} 
                className={`flex gap-3 p-2 rounded ${
                  event.type === "success" ? "bg-green-500/10" :
                  event.type === "error" ? "bg-red-500/10" :
                  "bg-[var(--bg)]"
                }`}
              >
                <span className="w-6 text-center">{getEventIcon(event.type)}</span>
                <span className={`w-16 ${getEventColor(event.type)}`}>
                  {event.type.replace(/_/g, " ")}
                </span>
                <span className="text-[var(--muted)] flex-1">
                  {formatEventData(event)}
                </span>
                <span className="text-[var(--muted)] opacity-50">
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
            <div ref={eventsEndRef} />
          </div>
        </section>
      )}

      {/* Results */}
      {result && (
        <section className="space-y-6">
          {/* Summary Card */}
          <div className={`card p-6 ${result.success ? "border-green-500/50" : "border-red-500/50"}`}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                {result.success ? "🎉 Success!" : "⚠️ Max Attempts Reached"}
              </h2>
              <span className={`px-4 py-1 rounded-full text-sm font-medium ${
                result.success ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
              }`}>
                {result.totalAttempts} attempt{result.totalAttempts > 1 ? "s" : ""}
              </span>
            </div>

            {/* Improvement Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-white">
                  {(result.improvement.scoreDelta * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-[var(--muted)]">Score Improvement</div>
              </div>
              <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-white">
                  {(result.improvement.stepsReduction * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-[var(--muted)]">Steps Reduced</div>
              </div>
              <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-white">
                  {(result.improvement.llmCallReduction * 100).toFixed(0)}%
                </div>
                <div className="text-xs text-[var(--muted)]">LLM Calls Reduced</div>
              </div>
              <div className="bg-[var(--bg)] rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-white">
                  {result.recordings.length}
                </div>
                <div className="text-xs text-[var(--muted)]">Recordings</div>
              </div>
            </div>

            {/* Attempt Timeline */}
            <h3 className="text-sm font-medium text-[var(--muted)] mb-3">Attempt Timeline</h3>
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {result.attempts.map((attempt, i) => (
                <div
                  key={i}
                  className={`flex-shrink-0 w-20 p-2 rounded-lg text-center ${
                    attempt.success ? "bg-green-500/20" : "bg-red-500/20"
                  }`}
                >
                  <div className="text-lg font-bold text-white">#{attempt.attempt}</div>
                  <div className="text-xs text-[var(--muted)]">{attempt.mode}</div>
                  <div className={`text-sm font-medium ${attempt.success ? "text-green-400" : "text-red-400"}`}>
                    {(attempt.score * 100).toFixed(0)}%
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Attempt Details */}
          <div className="card p-6">
            <h2 className="text-lg font-semibold text-white mb-4">📹 Recordings & Details</h2>
            <div className="space-y-3">
              {result.attempts.map((attempt) => (
                <div 
                  key={attempt.attempt}
                  className={`p-4 rounded-lg border ${
                    attempt.success ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <span className={`text-2xl ${attempt.success ? "text-green-400" : "text-red-400"}`}>
                        {attempt.success ? "✓" : "✗"}
                      </span>
                      <div>
                        <span className="font-medium text-white">
                          Attempt #{attempt.attempt}
                        </span>
                        <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                          attempt.mode === "cold" ? "bg-blue-500/20 text-blue-400" : "bg-orange-500/20 text-orange-400"
                        }`}>
                          {attempt.mode}
                        </span>
                        {attempt.llmJudgeVerdict && (
                          <span className={`ml-2 px-2 py-0.5 rounded text-xs ${
                            attempt.llmJudgeVerdict === "YES" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                          }`}>
                            LLM: {attempt.llmJudgeVerdict}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {attempt.recordingUrl && (
                        <a
                          href={attempt.recordingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1 rounded bg-violet-600 hover:bg-violet-700 text-white text-sm transition-colors"
                        >
                          🎬 Watch Recording
                        </a>
                      )}
                      <Link
                        href={`/runs/${attempt.runId}`}
                        className="px-3 py-1 rounded bg-[var(--bg)] hover:bg-[var(--border)] text-white text-sm transition-colors"
                      >
                        Details →
                      </Link>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-4 text-sm">
                    <div>
                      <span className="text-[var(--muted)]">Score: </span>
                      <span className="text-white">{(attempt.score * 100).toFixed(0)}%</span>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Steps: </span>
                      <span className="text-white">{attempt.metrics.steps}</span>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">LLM Calls: </span>
                      <span className="text-white">{attempt.metrics.llmCalls}</span>
                    </div>
                    <div>
                      <span className="text-[var(--muted)]">Cache Hits: </span>
                      <span className="text-white">{attempt.metrics.cacheHits}</span>
                    </div>
                  </div>

                  {attempt.issues.length > 0 && (
                    <div className="mt-2 text-xs">
                      <span className="text-red-400">Issues: </span>
                      <span className="text-[var(--muted)]">{attempt.issues.join(", ")}</span>
                    </div>
                  )}
                  
                  {attempt.recommendations.length > 0 && (
                    <div className="mt-1 text-xs">
                      <span className="text-yellow-400">Learned: </span>
                      <span className="text-[var(--muted)]">{attempt.recommendations[0]?.slice(0, 100)}...</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Empty State */}
      {!running && events.length === 0 && (
        <div className="card p-12 text-center">
          <div className="text-6xl mb-4">🔄</div>
          <h3 className="text-xl font-semibold text-white mb-2">Ready to Auto-Improve</h3>
          <p className="text-[var(--muted)] max-w-md mx-auto">
            Select a task and click "Start Auto-Improvement" to automatically run the task 
            multiple times, learning from each failure until it succeeds.
          </p>
        </div>
      )}
    </main>
  );
}

function formatEventData(event: AutoImproveEvent): string {
  const { type, data } = event;
  
  switch (type) {
    case "started":
      return `Starting auto-improvement for ${data.taskName}`;
    case "attempt_started":
      return `Starting ${data.mode} run...`;
    case "attempt_completed":
      return data.success 
        ? `✓ Completed in ${data.steps} steps` 
        : `✗ Failed after ${data.steps} steps`;
    case "evaluation_complete":
      return data.evaluating 
        ? "Evaluating with LLM judge..." 
        : `Score: ${((data.score as number) * 100).toFixed(0)}% | LLM: ${data.llmVerdict}`;
    case "learning":
      return `Issues: ${(data.issues as string[])?.join(", ") || "none"}`;
    case "improvement_applied":
      return `Learned ${data.macrosLearned} macros, ${data.rulesAdded} rules`;
    case "success":
      return `🎉 Task completed in ${data.totalAttempts} attempts!`;
    case "max_attempts_reached":
      return `Max attempts reached. Best score: ${((data.bestScore as number) * 100).toFixed(0)}%`;
    case "error":
      return `Error: ${data.error}`;
    case "complete":
      return "Auto-improvement session complete";
    default:
      return JSON.stringify(data).slice(0, 100);
  }
}
