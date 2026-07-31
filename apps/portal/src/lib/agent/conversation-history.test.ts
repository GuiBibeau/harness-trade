import { describe, expect, test } from "bun:test";
import {
  activateAgentConversation,
  activeAgentConversation,
  addAgentConversation,
  archiveAgentConversation,
  createAgentConversationRecord,
  initializeAgentConversationHistory,
  restoreAgentConversation,
  summarizeAgentConversations,
  titleFromMessage,
  updateAgentConversation,
} from "./conversation-history";
import type { AgentThreadStorage } from "./thread-cache";

function memoryStorage(): AgentThreadStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const ids = (...values: string[]) => {
  let index = 0;
  return () => values[index++] ?? `conversation-${index}`;
};

describe("agent conversation history", () => {
  test("migrates the existing single-thread cache into conversation history", () => {
    const storage = memoryStorage();
    storage.setItem(
      "harness.eve.thread.v2",
      JSON.stringify({
        version: 2,
        session: { sessionId: "existing" },
        events: [{ type: "message.received", data: { message: "hello" } }],
      }),
    );

    const history = initializeAgentConversationHistory(storage, {
      id: ids("migrated"),
      now: () => new Date("2026-07-31T00:00:00.000Z"),
    });

    expect(history.activeId).toBe("migrated");
    expect(activeAgentConversation(history)).toMatchObject({
      id: "migrated",
      title: "hello",
      thread: { session: { sessionId: "existing" } },
    });
  });

  test("keeps multiple resumable snapshots and one active conversation", () => {
    const first = createAgentConversationRecord(
      {
        id: ids("first"),
        now: () => new Date("2026-07-31T00:00:00.000Z"),
      },
      { title: "Check SOL" },
    );
    const second = createAgentConversationRecord(
      {
        id: ids("second"),
        now: () => new Date("2026-07-31T01:00:00.000Z"),
      },
      { title: "Review PnL" },
    );
    let history = {
      version: 1 as const,
      activeId: first.id,
      conversations: [first],
    };
    history = addAgentConversation(history, second);
    history = updateAgentConversation(history, "second", {
      thread: {
        session: { sessionId: "session-2" },
        events: [{ type: "assistant-message", text: "Ready" }],
      },
      updatedAt: "2026-07-31T02:00:00.000Z",
    });
    history = activateAgentConversation(history, "first");

    expect(history.activeId).toBe("first");
    expect(
      history.conversations.find((conversation) => conversation.id === "second")
        ?.thread,
    ).toMatchObject({ session: { sessionId: "session-2" } });
    expect(summarizeAgentConversations(history).map((row) => row.id)).toEqual([
      "second",
      "first",
    ]);
  });

  test("archives without deleting and restores the same conversation", () => {
    const record = createAgentConversationRecord(
      {
        id: ids("archive-me"),
        now: () => new Date("2026-07-31T00:00:00.000Z"),
      },
      { title: "Funding review" },
    );
    const initial = {
      version: 1 as const,
      activeId: record.id,
      conversations: [record],
    };

    const archived = archiveAgentConversation(
      initial,
      record.id,
      "2026-07-31T01:00:00.000Z",
    );
    expect(archived.conversations[0].archivedAt).toBe(
      "2026-07-31T01:00:00.000Z",
    );

    const restored = restoreAgentConversation(
      archived,
      record.id,
      "2026-07-31T02:00:00.000Z",
    );
    expect(restored.activeId).toBe(record.id);
    expect(restored.conversations[0]).toMatchObject({
      archivedAt: null,
      title: "Funding review",
    });
  });

  test("turns the first user message into a compact title", () => {
    expect(titleFromMessage("  Review   SOL funding and current PnL  ")).toBe(
      "Review SOL funding and current PnL",
    );
    expect(titleFromMessage("x".repeat(80))).toBe(`${"x".repeat(55)}…`);
  });
});
