// Trading telemetry: every money event and key intent, queued in memory and
// batch-shipped off the hot path. The corpus goal is model training on
// (action, market context, outcome) triples, so events carry a market
// snapshot and positions carry realized PnL at close.
//
// Performance contract: track() is an array push (microseconds, no
// serialization). Batches flush every 5s via fetch keepalive and drain with
// sendBeacon on pagehide — a trade is never blocked, a closing tab still
// ships its tail. The queue is capped; overflow drops oldest and records
// how many were dropped instead of lying by omission.

type EventPayload = Record<string, unknown>;

export type TerminalEvent = EventPayload & {
  t: string;
  ts: number;
  seq: number;
  sessionId: string;
};

const FLUSH_INTERVAL_MS = 5_000;
const MAX_QUEUE = 500;
const MAX_BATCH = 100;
const ENDPOINT = "/api/events";

const sessionId =
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let queue: TerminalEvent[] = [];
let dropped = 0;
let seq = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let flushing = false;

export function track(t: string, data: EventPayload = {}): void {
  if (typeof window === "undefined") return;
  queue.push({ ...data, t, ts: Date.now(), seq: seq++, sessionId });
  if (queue.length > MAX_QUEUE) {
    queue = queue.slice(queue.length - MAX_QUEUE);
    dropped += 1;
  }
  if (timer === null) {
    timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
    window.addEventListener("pagehide", drainWithBeacon);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") drainWithBeacon();
    });
  }
}

function takeBatch(): TerminalEvent[] {
  if (queue.length === 0) return [];
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(batch.length);
  if (dropped > 0) {
    batch.push({
      t: "telemetry_dropped",
      count: dropped,
      ts: Date.now(),
      seq: seq++,
      sessionId,
    });
    dropped = 0;
  }
  return batch;
}

async function flush(): Promise<void> {
  if (flushing) return;
  const batch = takeBatch();
  if (batch.length === 0) return;
  flushing = true;
  try {
    await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(batch),
      keepalive: true,
    });
  } catch {
    // Sink unreachable: requeue at the front, capped — never throw into
    // the trading path, never grow unbounded.
    queue = [...batch, ...queue].slice(0, MAX_QUEUE);
  } finally {
    flushing = false;
  }
}

function drainWithBeacon(): void {
  const batch = takeBatch();
  if (batch.length === 0) return;
  try {
    navigator.sendBeacon(
      ENDPOINT,
      new Blob([JSON.stringify(batch)], { type: "application/json" }),
    );
  } catch {
    // beacon unavailable — the events die with the tab, by design
  }
}
