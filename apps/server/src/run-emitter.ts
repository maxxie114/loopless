type EventPayload = { type: string; payload: Record<string, unknown>; ts?: string };

const subscribers = new Map<string, Set<(e: EventPayload) => void>>();

export function subscribe(runId: string, send: (e: EventPayload) => void): () => void {
  let set = subscribers.get(runId);
  if (!set) {
    set = new Set();
    subscribers.set(runId, set);
  }
  set.add(send);
  return () => {
    set?.delete(send);
    if (set?.size === 0) subscribers.delete(runId);
  };
}

export function emit(runId: string, event: EventPayload): void {
  const set = subscribers.get(runId);
  if (!set) return;
  const e = { ...event, ts: event.ts ?? new Date().toISOString() };
  for (const send of set) {
    try {
      send(e);
    } catch (_) {
      //
    }
  }
}
