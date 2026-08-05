import { describe, expect, test } from "bun:test";
import {
  type AgentThreadStorage,
  clearAgentThread,
  loadAgentThread,
  prepareAgentThreadForResume,
  saveAgentThread,
} from "./thread-cache";

function memoryStorage(): AgentThreadStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("agent thread cache", () => {
  test("restores the exact EVE thread saved before changing views", () => {
    const storage = memoryStorage();
    const thread = {
      session: { sessionId: "eve-session-42", cursor: "event-7" },
      events: [
        { type: "user-message", id: "event-6", text: "Long SOL in paper mode" },
        { type: "assistant-message", id: "event-7", text: "Plan ready" },
      ],
      answeredToolCallIds: ["approval-1"],
    };

    saveAgentThread(storage, thread);

    expect(loadAgentThread(storage)).toEqual(thread);
  });

  test("migrates completed legacy paper actions without replaying them", () => {
    const storage = memoryStorage();
    const thread = {
      session: { sessionId: "eve-session-paper" },
      events: [{ type: "tool-result", toolCallId: "call-1" }],
      paperActionRuns: ["call-1"],
      paperActionReceipts: {
        "call-1": { ok: true, message: "paper long SOL $10 @ 1x" },
        "call-2": { ok: false, message: "paper order rejected" },
        "call-3": {
          ok: false,
          message:
            "Paper action outcome unknown after interruption. Check the paper portfolio before retrying.",
        },
      },
    };

    storage.setItem(
      "harness.eve.thread.v2",
      JSON.stringify({ version: 2, ...thread }),
    );

    expect(loadAgentThread(storage)).toEqual({
      ...thread,
      paperActionReceipts: {
        "call-1": {
          outcome: "confirmed",
          message: "paper long SOL $10 @ 1x",
        },
        "call-2": {
          outcome: "rejected",
          message: "paper order rejected",
        },
        "call-3": {
          outcome: "unknown",
          message:
            "Paper action outcome unknown after interruption. Check the paper portfolio before retrying.",
        },
      },
    });
  });

  test("restores conversations saved by the previous two-key cache", () => {
    const storage = memoryStorage();
    const session = { sessionId: "existing-session", cursor: "event-2" };
    const events = [{ type: "assistant-message", id: "event-2" }];
    storage.setItem("harness.eve.session.v1", JSON.stringify(session));
    storage.setItem("harness.eve.events.v1", JSON.stringify(events));

    expect(loadAgentThread(storage)).toEqual({ session, events });
  });

  test("new thread clears both current and legacy conversations", () => {
    const storage = memoryStorage();
    saveAgentThread(storage, { session: { sessionId: "new" }, events: [] });
    storage.setItem(
      "harness.eve.session.v1",
      JSON.stringify({ sessionId: "old" }),
    );
    storage.setItem("harness.eve.events.v1", "[]");

    clearAgentThread(storage);

    expect(loadAgentThread(storage)).toBeNull();
  });

  test("repairs a cursor that trails its persisted durable events", () => {
    const started = { type: "session.started", data: { runtime: "agent" } };
    const received = {
      type: "message.received",
      data: { turnId: "turn-1", message: "what about funding rates" },
    };
    const waiting = {
      type: "session.waiting",
      data: { continuationToken: "next-1" },
    };

    const prepared = prepareAgentThreadForResume({
      session: {
        sessionId: "session-1",
        continuationToken: "next-1",
        streamIndex: 1,
      },
      events: [started, received, waiting],
    });

    expect(prepared.session).toEqual({
      sessionId: "session-1",
      continuationToken: "next-1",
      streamIndex: 3,
    });
    expect(prepared.events).toEqual([started, received, waiting]);
    expect(prepared.repaired).toBe(true);
  });

  test("deduplicates replayed events before repairing the cursor", () => {
    const firstSession = [
      { type: "session.started", data: { runtime: "agent" } },
      {
        type: "message.received",
        data: { turnId: "turn-1", message: "what is the price of apple" },
      },
      {
        type: "session.waiting",
        data: { continuationToken: "next-1" },
      },
    ];

    const prepared = prepareAgentThreadForResume({
      session: {
        sessionId: "session-1",
        continuationToken: "next-1",
        streamIndex: 0,
      },
      events: [...firstSession, ...structuredClone(firstSession)],
    });

    expect(prepared.events).toEqual(firstSession);
    expect(prepared.session).toMatchObject({ streamIndex: 3 });
    expect(prepared.repaired).toBe(true);
  });

  test("counts only the current session when aligning a cursor", () => {
    const events = [
      { type: "session.started", data: { runtime: "old" } },
      { type: "session.completed", data: {} },
      { type: "session.started", data: { runtime: "current" } },
      {
        type: "message.received",
        data: { turnId: "turn-2", message: "what is my pnl" },
      },
    ];

    const prepared = prepareAgentThreadForResume({
      session: { sessionId: "session-2", streamIndex: 1 },
      events,
    });

    expect(prepared.session).toMatchObject({ streamIndex: 2 });
    expect(prepared.repaired).toBe(true);
  });

  test("interrupted paper actions recover as unknown Receipts", () => {
    const prepared = prepareAgentThreadForResume({
      session: { sessionId: "session-1", streamIndex: 0 },
      events: [],
      paperActionRuns: ["call-complete", "call-interrupted"],
      paperActionReceipts: {
        "call-complete": {
          outcome: "confirmed",
          message: "paper long confirmed",
        },
      },
    });

    expect(prepared.paperActionReceipts).toEqual({
      "call-complete": {
        outcome: "confirmed",
        message: "paper long confirmed",
      },
      "call-interrupted": {
        outcome: "unknown",
        message:
          "Paper action outcome unknown after interruption. Check the paper portfolio before retrying.",
      },
    });
    expect(prepared.repaired).toBe(true);
  });
});
