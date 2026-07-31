import {
  type AgentThreadSnapshot,
  type AgentThreadStorage,
  loadAgentThread,
} from "./thread-cache";

export interface AgentConversationRecord {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  thread: AgentThreadSnapshot;
}

export interface AgentConversationHistory {
  version: 1;
  activeId: string;
  conversations: AgentConversationRecord[];
}

export type AgentConversationSummary = Omit<AgentConversationRecord, "thread">;

const HISTORY_KEY = "harness.eve.conversations.v1";
const DEFAULT_TITLE = "New conversation";

type HistoryOptions = {
  id?: () => string;
  now?: () => Date;
};

export function initializeAgentConversationHistory(
  storage: AgentThreadStorage,
  options: HistoryOptions = {},
): AgentConversationHistory {
  const stored = readHistory(storage);
  if (stored) return stored;

  const legacy = loadAgentThread(storage);
  const history = createInitialHistory(options, legacy);
  saveAgentConversationHistory(storage, history);
  return history;
}

export function createInitialHistory(
  options: HistoryOptions = {},
  legacy: AgentThreadSnapshot | null = null,
): AgentConversationHistory {
  const conversation = createAgentConversationRecord(options, {
    title: legacy ? titleFromThread(legacy) : DEFAULT_TITLE,
    thread: legacy ?? emptyThread(),
  });
  return {
    version: 1,
    activeId: conversation.id,
    conversations: [conversation],
  };
}

export function createAgentConversationRecord(
  options: HistoryOptions = {},
  input: {
    title?: string;
    thread?: AgentThreadSnapshot;
  } = {},
): AgentConversationRecord {
  const timestamp = (options.now?.() ?? new Date()).toISOString();
  return {
    id: options.id?.() ?? randomConversationId(),
    title: cleanTitle(input.title ?? DEFAULT_TITLE),
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    thread: input.thread ?? emptyThread(),
  };
}

export function addAgentConversation(
  history: AgentConversationHistory,
  record: AgentConversationRecord,
): AgentConversationHistory {
  return {
    ...history,
    activeId: record.id,
    conversations: [record, ...history.conversations],
  };
}

export function updateAgentConversation(
  history: AgentConversationHistory,
  id: string,
  input: {
    thread?: AgentThreadSnapshot;
    title?: string;
    updatedAt?: string;
  },
): AgentConversationHistory {
  return {
    ...history,
    conversations: history.conversations.map((conversation) =>
      conversation.id === id
        ? {
            ...conversation,
            ...(input.thread ? { thread: input.thread } : {}),
            ...(input.title ? { title: cleanTitle(input.title) } : {}),
            updatedAt: input.updatedAt ?? new Date().toISOString(),
          }
        : conversation,
    ),
  };
}

export function activateAgentConversation(
  history: AgentConversationHistory,
  id: string,
): AgentConversationHistory {
  if (!history.conversations.some((conversation) => conversation.id === id)) {
    return history;
  }
  return { ...history, activeId: id };
}

export function archiveAgentConversation(
  history: AgentConversationHistory,
  id: string,
  archivedAt = new Date().toISOString(),
): AgentConversationHistory {
  return {
    ...history,
    conversations: history.conversations.map((conversation) =>
      conversation.id === id
        ? { ...conversation, archivedAt, updatedAt: archivedAt }
        : conversation,
    ),
  };
}

export function restoreAgentConversation(
  history: AgentConversationHistory,
  id: string,
  updatedAt = new Date().toISOString(),
): AgentConversationHistory {
  if (!history.conversations.some((conversation) => conversation.id === id)) {
    return history;
  }
  return {
    ...history,
    activeId: id,
    conversations: history.conversations.map((conversation) =>
      conversation.id === id
        ? { ...conversation, archivedAt: null, updatedAt }
        : conversation,
    ),
  };
}

export function activeAgentConversation(
  history: AgentConversationHistory,
): AgentConversationRecord {
  return (
    history.conversations.find(
      (conversation) => conversation.id === history.activeId,
    ) ?? history.conversations[0]
  );
}

export function summarizeAgentConversations(
  history: AgentConversationHistory,
): AgentConversationSummary[] {
  return [...history.conversations]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(({ thread: _thread, ...summary }) => summary);
}

export function titleFromMessage(message: string): string {
  const title = message.trim().replace(/\s+/g, " ");
  if (!title) return DEFAULT_TITLE;
  return title.length > 56 ? `${title.slice(0, 55).trimEnd()}…` : title;
}

export function titleFromThread(thread: AgentThreadSnapshot): string {
  for (const event of thread.events) {
    if (typeof event !== "object" || event === null) continue;
    const row = event as Record<string, unknown>;
    if (row.type !== "message.received") continue;
    const data =
      typeof row.data === "object" && row.data !== null
        ? (row.data as Record<string, unknown>)
        : null;
    if (typeof data?.message === "string") {
      return titleFromMessage(data.message);
    }
  }
  return "Previous conversation";
}

export function saveAgentConversationHistory(
  storage: AgentThreadStorage,
  history: AgentConversationHistory,
): void {
  storage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function readHistory(
  storage: AgentThreadStorage,
): AgentConversationHistory | null {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isHistory(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isHistory(value: unknown): value is AgentConversationHistory {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("activeId" in value) ||
    typeof value.activeId !== "string" ||
    !("conversations" in value) ||
    !Array.isArray(value.conversations) ||
    value.conversations.length === 0
  ) {
    return false;
  }
  return value.conversations.every(isConversationRecord);
}

function isConversationRecord(
  value: unknown,
): value is AgentConversationRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const thread = record.thread;
  return (
    typeof record.id === "string" &&
    typeof record.title === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    (record.archivedAt === null || typeof record.archivedAt === "string") &&
    typeof thread === "object" &&
    thread !== null &&
    "session" in thread &&
    "events" in thread &&
    Array.isArray(thread.events)
  );
}

function cleanTitle(title: string): string {
  return titleFromMessage(title);
}

function emptyThread(): AgentThreadSnapshot {
  return { session: null, events: [] };
}

function randomConversationId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `conversation-${Date.now()}`;
}
