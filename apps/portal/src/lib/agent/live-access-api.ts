import { fetchWithPrivyAuth } from "$lib/privy-fetch";

export type LiveAgentAccess = {
  enabled: boolean;
  storeConfigured: boolean;
  custody: "eve-server";
  agentWalletAddress: string | null;
  ownerSolanaWallet: string | null;
  masterSecretConfigured: boolean;
  ackedAgentWallet?: string | null;
  updatedAt?: string;
};

export async function fetchLiveAgentAccess(): Promise<LiveAgentAccess> {
  const response = await fetchWithPrivyAuth("/api/agent/live-access", {
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(`live-access-${response.status}`);
  return (await response.json()) as LiveAgentAccess;
}

/** Explicit ack before the agent may run live executions for this user. */
export async function setLiveAgentAccess(
  enabled: boolean,
  options: { ackAgentWallet?: string } = {},
): Promise<LiveAgentAccess> {
  const response = await fetchWithPrivyAuth("/api/agent/live-access", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      enabled,
      ...(enabled && options.ackAgentWallet
        ? { ackAgentWallet: options.ackAgentWallet }
        : {}),
    }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      agentWalletAddress?: string;
    };
    throw new Error(body.error ?? `live-access-${response.status}`);
  }
  return (await response.json()) as LiveAgentAccess;
}

/**
 * Enable live agent access by acknowledging the server-derived agent wallet.
 * Fetches the address first so the client cannot invent one.
 */
export async function enableLiveAgentAccess(): Promise<LiveAgentAccess> {
  const current = await fetchLiveAgentAccess();
  if (!current.masterSecretConfigured || !current.agentWalletAddress) {
    throw new Error("agent-wallet-master-secret-missing");
  }
  return setLiveAgentAccess(true, {
    ackAgentWallet: current.agentWalletAddress,
  });
}
