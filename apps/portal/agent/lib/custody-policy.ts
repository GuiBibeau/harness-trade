/**
 * Pure custody policy helpers — keep money-path clamps testable without RPC.
 */

export function assertAgentWalletAck(
  ack: unknown,
  expectedAddress: string,
): { ok: true } | { ok: false; error: string } {
  if (typeof ack !== "string" || !ack.trim()) {
    return { ok: false, error: "agent-wallet-ack-required" };
  }
  if (ack.trim() !== expectedAddress) {
    return { ok: false, error: "agent-wallet-ack-mismatch" };
  }
  return { ok: true };
}

/** Withdrawals may only land on the Privy-linked owner wallet — never tool input. */
export function resolveOwnerWithdrawDestination(input: {
  ownerSolanaWallet: string | null | undefined;
  agentWalletAddress: string;
}): { ok: true; destination: string } | { ok: false; error: string } {
  const destination = String(input.ownerSolanaWallet ?? "").trim();
  if (!destination) {
    return { ok: false, error: "owner-solana-wallet-missing" };
  }
  if (destination === input.agentWalletAddress) {
    return { ok: false, error: "owner-wallet-matches-agent" };
  }
  return { ok: true, destination };
}

/** Leave rent so the agent wallet account stays usable after evacuate. */
export const AGENT_WALLET_RENT_RESERVE_LAMPORTS = 1_000_000;

export function clampWithdrawLamports(input: {
  balanceLamports: number;
  requestedLamports: number | "max";
  rentReserveLamports?: number;
}): { ok: true; lamports: number } | { ok: false; error: string } {
  const reserve =
    input.rentReserveLamports ?? AGENT_WALLET_RENT_RESERVE_LAMPORTS;
  const spendable = Math.max(0, input.balanceLamports - reserve);
  if (spendable <= 0) {
    return { ok: false, error: "agent-wallet-below-rent-reserve" };
  }
  const requested =
    input.requestedLamports === "max"
      ? spendable
      : Math.floor(input.requestedLamports);
  if (!Number.isFinite(requested) || requested <= 0) {
    return { ok: false, error: "withdraw-lamports-invalid" };
  }
  if (requested > spendable) {
    return { ok: false, error: "withdraw-exceeds-spendable" };
  }
  return { ok: true, lamports: requested };
}
