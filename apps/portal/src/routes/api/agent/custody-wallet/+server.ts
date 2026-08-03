import { json } from "@sveltejs/kit";
import {
  readCustodyWalletSnapshot,
  withdrawAgentSolToOwner,
} from "$agent/lib/custody-wallet";
import { requireAgentUser } from "$lib/server/agent-api";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  const user = await requireAgentUser(request);
  if (user instanceof Response) return user;

  try {
    const snapshot = await readCustodyWalletSnapshot(user);
    return json(snapshot);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "custody-wallet-unavailable";
    if (message.includes("master-secret")) {
      return json(
        { error: "agent-wallet-master-secret-missing" },
        { status: 503 },
      );
    }
    return json({ error: message }, { status: 503 });
  }
};

export const POST: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  const user = await requireAgentUser(request);
  if (user instanceof Response) return user;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid-body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return json({ error: "invalid-body" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  // Destination is NEVER accepted from the client — server resolves Privy owner.
  if ("destination" in record || "to" in record || "ownerWallet" in record) {
    return json(
      { error: "withdraw-destination-not-accepted" },
      { status: 400 },
    );
  }

  let lamports: number | "max";
  if (record.lamports === "max") {
    lamports = "max";
  } else if (
    typeof record.lamports === "number" &&
    Number.isFinite(record.lamports)
  ) {
    lamports = Math.floor(record.lamports);
  } else {
    return json({ error: "withdraw-lamports-invalid" }, { status: 400 });
  }

  try {
    const result = await withdrawAgentSolToOwner({ userId: user, lamports });
    return json({
      ok: true,
      ...result,
      explorerUrl: `https://solscan.io/tx/${result.signature}`,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "custody-withdraw-failed";
    const status =
      message.startsWith("owner-") ||
      message.startsWith("withdraw-") ||
      message.startsWith("agent-wallet-below")
        ? 400
        : 503;
    return json({ error: message }, { status });
  }
};
