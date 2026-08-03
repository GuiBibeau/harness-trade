import { describe, expect, test } from "bun:test";
import {
  type AgentPrincipal,
  decideTransactionApproval,
  parseAccountMode,
} from "../../../agent/lib/auth";
import {
  liveAccessOwnerHash,
  liveAccessPathForOwner,
} from "../../../agent/lib/live-access-store";

describe("live-access paths", () => {
  test("partitions by owner hash", () => {
    const a = liveAccessOwnerHash("did:privy:alice");
    const b = liveAccessOwnerHash("did:privy:bob");
    expect(a).not.toBe(b);
    expect(liveAccessPathForOwner("did:privy:alice")).toContain(a);
    expect(liveAccessPathForOwner("did:privy:alice")).toContain(
      "agent-state/v1/live-access/",
    );
  });
});

describe("account mode clamp", () => {
  test("live without liveAccess flag becomes paper", () => {
    expect(parseAccountMode("live", "false")).toBe("paper");
    expect(parseAccountMode("live", false)).toBe("paper");
    expect(parseAccountMode("live", undefined)).toBe("paper");
  });

  test("live with liveAccess flag stays live", () => {
    expect(parseAccountMode("live", "true")).toBe("live");
    expect(parseAccountMode("live", true)).toBe("live");
  });

  test("paper stays paper", () => {
    expect(parseAccountMode("paper", "true")).toBe("paper");
  });
});

function principal(patch: Partial<AgentPrincipal> = {}): AgentPrincipal {
  return {
    userId: "did:privy:test",
    agentMode: "auto",
    accountMode: "paper",
    paused: false,
    ...patch,
  };
}

describe("live auto never silent-approves", () => {
  test("auto + paper stays approved", () => {
    expect(decideTransactionApproval(principal())).toEqual({
      type: "approved",
      reason: "Auto mode permits paper execution.",
    });
  });

  test("auto + live always asks the user", () => {
    expect(decideTransactionApproval(principal({ accountMode: "live" }))).toBe(
      "user-approval",
    );
  });

  test("ask mode always asks", () => {
    expect(decideTransactionApproval(principal({ agentMode: "ask" }))).toBe(
      "user-approval",
    );
  });

  test("observe and pause deny", () => {
    expect(
      decideTransactionApproval(principal({ agentMode: "observe" })),
    ).toEqual({ type: "denied", reason: "Observe mode is read-only." });
    expect(decideTransactionApproval(principal({ paused: true }))).toEqual({
      type: "denied",
      reason: "Money-PAUSE is engaged.",
    });
  });
});
