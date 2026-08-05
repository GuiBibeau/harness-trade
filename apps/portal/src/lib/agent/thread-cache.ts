export interface AgentThreadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface AgentThreadSnapshot {
  session: unknown;
  events: readonly unknown[];
  answeredToolCallIds?: readonly string[];
  paperActionRuns?: readonly string[];
  paperActionReceipts?: Record<string, AgentPaperActionReceipt>;
}

export interface AgentPaperActionReceipt {
  outcome: "confirmed" | "rejected" | "unknown";
  message: string;
}

export interface PreparedAgentThread extends AgentThreadSnapshot {
  repaired: boolean;
}

const THREAD_KEY = "harness.eve.thread.v2";
const LEGACY_SESSION_KEY = "harness.eve.session.v1";
const LEGACY_EVENTS_KEY = "harness.eve.events.v1";
const UNKNOWN_PAPER_ACTION_MESSAGE =
  "Paper action outcome unknown after interruption. Check the paper portfolio before retrying.";

export function loadAgentThread(
  storage: AgentThreadStorage,
): AgentThreadSnapshot | null {
  const current = readJson(storage, THREAD_KEY);
  if (isThreadSnapshot(current)) {
    const paperActionReceipts = parseReceiptMap(current.paperActionReceipts);
    return {
      session: current.session,
      events: current.events,
      ...(isStringArray(current.answeredToolCallIds)
        ? { answeredToolCallIds: current.answeredToolCallIds }
        : {}),
      ...(Array.isArray(current.paperActionRuns)
        ? { paperActionRuns: current.paperActionRuns }
        : {}),
      ...(paperActionReceipts ? { paperActionReceipts } : {}),
    };
  }

  const session = readJson(storage, LEGACY_SESSION_KEY);
  const events = readJson(storage, LEGACY_EVENTS_KEY);
  return session !== null && Array.isArray(events) ? { session, events } : null;
}

function readJson(storage: AgentThreadStorage, key: string): unknown {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function saveAgentThread(
  storage: AgentThreadStorage,
  thread: AgentThreadSnapshot,
): void {
  storage.setItem(
    THREAD_KEY,
    JSON.stringify({
      version: 2,
      session: thread.session,
      events: thread.events,
      answeredToolCallIds: thread.answeredToolCallIds,
      paperActionRuns: thread.paperActionRuns,
      paperActionReceipts: thread.paperActionReceipts,
    }),
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

function parseReceiptMap(
  value: unknown,
): Record<string, AgentPaperActionReceipt> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const receipts: Record<string, AgentPaperActionReceipt> = {};
  for (const [callId, valueReceipt] of Object.entries(value)) {
    if (
      typeof valueReceipt !== "object" ||
      valueReceipt === null ||
      !("message" in valueReceipt) ||
      typeof valueReceipt.message !== "string"
    ) {
      return null;
    }
    if (
      "outcome" in valueReceipt &&
      (valueReceipt.outcome === "confirmed" ||
        valueReceipt.outcome === "rejected" ||
        valueReceipt.outcome === "unknown")
    ) {
      receipts[callId] = {
        outcome: valueReceipt.outcome,
        message: valueReceipt.message,
      };
      continue;
    }
    if ("ok" in valueReceipt && typeof valueReceipt.ok === "boolean") {
      receipts[callId] = {
        outcome: valueReceipt.ok
          ? "confirmed"
          : valueReceipt.message === UNKNOWN_PAPER_ACTION_MESSAGE
            ? "unknown"
            : "rejected",
        message: valueReceipt.message,
      };
      continue;
    }
    return null;
  }
  return receipts;
}

export function clearAgentThread(storage: AgentThreadStorage): void {
  storage.removeItem(THREAD_KEY);
  storage.removeItem(LEGACY_SESSION_KEY);
  storage.removeItem(LEGACY_EVENTS_KEY);
}

/**
 * A stream can be interrupted after events are persisted but before the EVE
 * client advances its session cursor. Replaying from that stale cursor makes
 * the next optimistic user message get replaced by an older durable turn.
 *
 * Keep one copy of each durable event and advance only a cursor that is
 * provably behind the persisted events for its current session.
 */
export function prepareAgentThreadForResume(
  thread: AgentThreadSnapshot,
): PreparedAgentThread {
  const events = uniqueEvents(thread.events);
  const session = sessionCursor(thread.session);
  const paperActionReceipts = { ...(thread.paperActionReceipts ?? {}) };
  let repaired = events.length !== thread.events.length;

  for (const callId of thread.paperActionRuns ?? []) {
    if (typeof callId !== "string" || paperActionReceipts[callId]) continue;
    paperActionReceipts[callId] = {
      outcome: "unknown",
      message: UNKNOWN_PAPER_ACTION_MESSAGE,
    };
    repaired = true;
  }

  if (session?.sessionId) {
    const persistedEventCount = currentSessionEventCount(events);
    if (session.streamIndex < persistedEventCount) {
      session.streamIndex = persistedEventCount;
      repaired = true;
    }
  }

  return {
    ...thread,
    session: session ?? thread.session,
    events,
    ...(Object.keys(paperActionReceipts).length > 0
      ? { paperActionReceipts }
      : {}),
    repaired,
  };
}

function isThreadSnapshot(value: unknown): value is AgentThreadSnapshot {
  return (
    typeof value === "object" &&
    value !== null &&
    "session" in value &&
    "events" in value &&
    Array.isArray(value.events)
  );
}

function uniqueEvents(events: readonly unknown[]): readonly unknown[] {
  const seen = new Set<string>();
  const unique: unknown[] = [];

  for (const event of events) {
    const key = eventKey(event);
    if (key !== null && seen.has(key)) continue;
    if (key !== null) seen.add(key);
    unique.push(event);
  }

  return unique;
}

function eventKey(event: unknown): string | null {
  try {
    return JSON.stringify(event) ?? null;
  } catch {
    return null;
  }
}

function currentSessionEventCount(events: readonly unknown[]): number {
  let sessionStart = -1;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (
      typeof event === "object" &&
      event !== null &&
      "type" in event &&
      event.type === "session.started"
    ) {
      sessionStart = index;
    }
  }
  return events.length - Math.max(sessionStart, 0);
}

function sessionCursor(value: unknown):
  | {
      continuationToken?: string;
      sessionId?: string;
      streamIndex: number;
    }
  | undefined {
  if (
    typeof value !== "object" ||
    value === null ||
    !("streamIndex" in value) ||
    typeof value.streamIndex !== "number" ||
    !Number.isSafeInteger(value.streamIndex) ||
    value.streamIndex < 0
  ) {
    return undefined;
  }

  const cursor: {
    continuationToken?: string;
    sessionId?: string;
    streamIndex: number;
  } = { streamIndex: value.streamIndex };
  if ("sessionId" in value && typeof value.sessionId === "string") {
    cursor.sessionId = value.sessionId;
  }
  if (
    "continuationToken" in value &&
    typeof value.continuationToken === "string"
  ) {
    cursor.continuationToken = value.continuationToken;
  }
  return cursor;
}
