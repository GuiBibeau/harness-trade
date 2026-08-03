import { json } from "@sveltejs/kit";
import { assertAgentWalletAck } from "$agent/lib/custody-policy";
import {
  isLiveAccessStoreConfigured,
  isLiveAgentEnabled,
  setLiveAgentEnabled,
} from "$agent/lib/live-access-store";
import { getServerWallet } from "$agent/lib/server-wallet";
import { requireAgentUser } from "$lib/server/agent-api";
import { getUserById } from "$lib/server/privy";
import type { RequestHandler } from "./$types";

function custodyPayload(userId: string) {
  let agentWalletAddress: string | null = null;
  let masterSecretConfigured = false;
  try {
    agentWalletAddress = getServerWallet(userId).address;
    masterSecretConfigured = true;
  } catch {
    agentWalletAddress = null;
    masterSecretConfigured = false;
  }
  return { agentWalletAddress, masterSecretConfigured };
}

export const GET: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  const user = await requireAgentUser(request);
  if (user instanceof Response) return user;

  const custody = custodyPayload(user);
  const owner = await getUserById(user);

  if (!isLiveAccessStoreConfigured()) {
    return json({
      enabled: false,
      storeConfigured: false,
      custody: "eve-server" as const,
      agentWalletAddress: custody.agentWalletAddress,
      ownerSolanaWallet: owner?.solanaWallet ?? null,
      masterSecretConfigured: custody.masterSecretConfigured,
    });
  }

  try {
    const enabled = await isLiveAgentEnabled(user);
    return json({
      enabled,
      storeConfigured: true,
      custody: "eve-server" as const,
      agentWalletAddress: custody.agentWalletAddress,
      ownerSolanaWallet: owner?.solanaWallet ?? null,
      masterSecretConfigured: custody.masterSecretConfigured,
    });
  } catch {
    return json({ error: "live-access-unavailable" }, { status: 503 });
  }
};

export const PUT: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  const user = await requireAgentUser(request);
  if (user instanceof Response) return user;

  if (!isLiveAccessStoreConfigured()) {
    return json({ error: "live-access-store-unconfigured" }, { status: 503 });
  }

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
  const enabled = record.enabled;
  if (typeof enabled !== "boolean") {
    return json({ error: "live-access-enabled-invalid" }, { status: 400 });
  }

  let agentWalletAddress: string;
  try {
    agentWalletAddress = getServerWallet(user).address;
  } catch {
    return json(
      { error: "agent-wallet-master-secret-missing" },
      { status: 503 },
    );
  }

  if (enabled) {
    const ack = assertAgentWalletAck(record.ackAgentWallet, agentWalletAddress);
    if (!ack.ok) {
      return json(
        {
          error: ack.error,
          agentWalletAddress,
          custody: "eve-server",
        },
        { status: 400 },
      );
    }
  }

  try {
    const saved = await setLiveAgentEnabled(user, enabled, {
      ackedAgentWallet: enabled ? agentWalletAddress : undefined,
    });
    const owner = await getUserById(user);
    return json({
      enabled: saved.enabled,
      updatedAt: saved.updatedAt,
      storeConfigured: true,
      custody: "eve-server" as const,
      agentWalletAddress,
      ownerSolanaWallet: owner?.solanaWallet ?? null,
      ackedAgentWallet: saved.ackedAgentWallet ?? null,
      masterSecretConfigured: true,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "live-access-store-error";
    return json({ error: message }, { status: 503 });
  }
};
