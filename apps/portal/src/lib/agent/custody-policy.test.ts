import { describe, expect, test } from "bun:test";
import {
  AGENT_WALLET_RENT_RESERVE_LAMPORTS,
  assertAgentWalletAck,
  clampWithdrawLamports,
  resolveOwnerWithdrawDestination,
} from "../../../agent/lib/custody-policy";

describe("assertAgentWalletAck", () => {
  test("requires exact address match", () => {
    expect(assertAgentWalletAck("Abc111", "Abc111")).toEqual({ ok: true });
    expect(assertAgentWalletAck(" Abc111 ", "Abc111")).toEqual({ ok: true });
    expect(assertAgentWalletAck("", "Abc111")).toEqual({
      ok: false,
      error: "agent-wallet-ack-required",
    });
    expect(assertAgentWalletAck("other", "Abc111")).toEqual({
      ok: false,
      error: "agent-wallet-ack-mismatch",
    });
  });
});

describe("resolveOwnerWithdrawDestination", () => {
  test("rejects missing or self destination", () => {
    expect(
      resolveOwnerWithdrawDestination({
        ownerSolanaWallet: null,
        agentWalletAddress: "agent",
      }),
    ).toEqual({ ok: false, error: "owner-solana-wallet-missing" });
    expect(
      resolveOwnerWithdrawDestination({
        ownerSolanaWallet: "agent",
        agentWalletAddress: "agent",
      }),
    ).toEqual({ ok: false, error: "owner-wallet-matches-agent" });
    expect(
      resolveOwnerWithdrawDestination({
        ownerSolanaWallet: "owner",
        agentWalletAddress: "agent",
      }),
    ).toEqual({ ok: true, destination: "owner" });
  });
});

describe("clampWithdrawLamports", () => {
  test("keeps rent reserve and supports max", () => {
    const balance = AGENT_WALLET_RENT_RESERVE_LAMPORTS + 5_000_000;
    expect(
      clampWithdrawLamports({
        balanceLamports: balance,
        requestedLamports: "max",
      }),
    ).toEqual({ ok: true, lamports: 5_000_000 });
    expect(
      clampWithdrawLamports({
        balanceLamports: balance,
        requestedLamports: 1_000_000,
      }),
    ).toEqual({ ok: true, lamports: 1_000_000 });
    expect(
      clampWithdrawLamports({
        balanceLamports: AGENT_WALLET_RENT_RESERVE_LAMPORTS,
        requestedLamports: "max",
      }),
    ).toEqual({ ok: false, error: "agent-wallet-below-rent-reserve" });
    expect(
      clampWithdrawLamports({
        balanceLamports: balance,
        requestedLamports: 9_000_000,
      }),
    ).toEqual({ ok: false, error: "withdraw-exceeds-spendable" });
  });
});
