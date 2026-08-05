import { describe, expect, test } from "bun:test";
import {
  scopeAgentStorage,
  type AgentStorageScope,
} from "./scoped-storage";
import type { AgentThreadStorage } from "./thread-cache";

function memoryStorage(): AgentThreadStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

const paper: AgentStorageScope = {
  accountMode: "paper",
  ownerId: "did:privy:trader-1",
};

describe("scoped agent storage", () => {
  test("keeps PAPER and LIVE conversations isolated for the same owner", () => {
    const storage = memoryStorage();
    const paperStorage = scopeAgentStorage(storage, paper);
    const liveStorage = scopeAgentStorage(storage, {
      ...paper,
      accountMode: "live",
    });

    paperStorage.setItem("harness.eve.conversations.v1", "paper-history");
    liveStorage.setItem("harness.eve.conversations.v1", "live-history");

    expect(paperStorage.getItem("harness.eve.conversations.v1")).toBe(
      "paper-history",
    );
    expect(liveStorage.getItem("harness.eve.conversations.v1")).toBe(
      "live-history",
    );
  });

  test("claims an existing unscoped history once without copying it into LIVE", () => {
    const storage = memoryStorage();
    storage.setItem("harness.eve.conversations.v1", "existing-history");
    const paperStorage = scopeAgentStorage(storage, paper);
    const liveStorage = scopeAgentStorage(storage, {
      ...paper,
      accountMode: "live",
    });

    expect(liveStorage.getItem("harness.eve.conversations.v1")).toBeNull();
    expect(paperStorage.getItem("harness.eve.conversations.v1")).toBe(
      "existing-history",
    );
    expect(storage.getItem("harness.eve.conversations.v1")).toBeNull();
  });
});
