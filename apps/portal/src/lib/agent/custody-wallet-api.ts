import { fetchWithPrivyAuth } from "$lib/privy-fetch";

export type CustodyWalletSnapshot = {
  agentWalletAddress: string;
  ownerSolanaWallet: string | null;
  custody: "eve-server";
  solBalanceLamports: number;
  solBalance: number;
  spendableLamports: number;
  rentReserveLamports: number;
  masterSecretConfigured: boolean;
};

export async function fetchCustodyWallet(): Promise<CustodyWalletSnapshot> {
  const response = await fetchWithPrivyAuth("/api/agent/custody-wallet", {
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(`custody-wallet-${response.status}`);
  return (await response.json()) as CustodyWalletSnapshot;
}

/** Evacuate spendable SOL to the Privy-linked owner wallet (server-resolved). */
export async function withdrawCustodySol(
  lamports: number | "max" = "max",
): Promise<{
  signature: string;
  lamports: number;
  destination: string;
  agentWalletAddress: string;
  explorerUrl: string;
}> {
  const response = await fetchWithPrivyAuth("/api/agent/custody-wallet", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lamports }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    signature?: string;
    lamports?: number;
    destination?: string;
    agentWalletAddress?: string;
    explorerUrl?: string;
  };
  if (!response.ok || !body.signature) {
    throw new Error(body.error ?? `custody-withdraw-${response.status}`);
  }
  return {
    signature: body.signature,
    lamports: body.lamports ?? 0,
    destination: body.destination ?? "",
    agentWalletAddress: body.agentWalletAddress ?? "",
    explorerUrl: body.explorerUrl ?? `https://solscan.io/tx/${body.signature}`,
  };
}
