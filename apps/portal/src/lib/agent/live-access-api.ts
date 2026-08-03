import { fetchWithPrivyAuth } from "$lib/privy-fetch";

export async function fetchLiveAgentAccess(): Promise<{
  enabled: boolean;
  storeConfigured: boolean;
}> {
  const response = await fetchWithPrivyAuth("/api/agent/live-access", {
    headers: { "content-type": "application/json" },
  });
  if (!response.ok) throw new Error(`live-access-${response.status}`);
  return (await response.json()) as {
    enabled: boolean;
    storeConfigured: boolean;
  };
}

/** Explicit ack before the agent may run live executions for this user. */
export async function setLiveAgentAccess(enabled: boolean): Promise<void> {
  const response = await fetchWithPrivyAuth("/api/agent/live-access", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `live-access-${response.status}`);
  }
}
