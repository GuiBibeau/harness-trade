import type { LlmProviderId } from "$agent/lib/llm-catalog";
import type { DiscoveredLlmModel } from "$agent/lib/llm-model-discovery";
import { getPrivyAccessToken } from "$lib/privy-auth";

export type { DiscoveredLlmModel };
export type { LlmProviderId };

export type LlmProfilePublic = {
  id: string;
  name: string;
  provider: LlmProviderId;
  model: string;
  active: boolean;
  hasApiKey: boolean;
  apiKeyLast4: string;
  updatedAt: string;
};

export type LlmCatalogProvider = {
  id: LlmProviderId;
  label: string;
  keyHint: string;
  models: { id: string; label: string }[];
};

export type LlmProfilesResponse = {
  catalog: LlmCatalogProvider[];
  profiles: LlmProfilePublic[];
  storeConfigured: boolean;
  platformDefault: {
    provider: string;
    model: string;
    label: string;
  };
};

async function authHeaders(): Promise<HeadersInit> {
  const token = await getPrivyAccessToken();
  if (!token) throw new Error("auth-required");
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

export async function fetchLlmProfiles(): Promise<LlmProfilesResponse> {
  const response = await fetch("/api/agent/llm-profiles", {
    headers: await authHeaders(),
  });
  if (!response.ok) throw new Error(`llm-profiles-${response.status}`);
  return (await response.json()) as LlmProfilesResponse;
}

export async function createLlmProfile(input: {
  name: string;
  provider: LlmProviderId;
  model: string;
  apiKey: string;
  active?: boolean;
}): Promise<LlmProfilePublic> {
  const response = await fetch("/api/agent/llm-profiles", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as {
    profile?: LlmProfilePublic;
    error?: string;
  };
  if (!response.ok || !body.profile) {
    throw new Error(body.error ?? `llm-create-${response.status}`);
  }
  return body.profile;
}

export async function discoverLlmModels(input: {
  provider: LlmProviderId;
  apiKey: string;
}): Promise<DiscoveredLlmModel[]> {
  const response = await fetch("/api/agent/llm-profiles/discover", {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify(input),
  });
  const body = (await response.json()) as {
    models?: DiscoveredLlmModel[];
    error?: string;
  };
  if (!response.ok || !Array.isArray(body.models)) {
    throw new Error(body.error ?? `llm-discovery-${response.status}`);
  }
  return body.models;
}

export async function updateLlmProfile(
  id: string,
  patch: {
    name?: string;
    provider?: LlmProviderId;
    model?: string;
    apiKey?: string;
    active?: boolean;
  },
): Promise<LlmProfilePublic> {
  const response = await fetch(
    `/api/agent/llm-profiles/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: await authHeaders(),
      body: JSON.stringify(patch),
    },
  );
  const body = (await response.json()) as {
    profile?: LlmProfilePublic;
    error?: string;
  };
  if (!response.ok || !body.profile) {
    throw new Error(body.error ?? `llm-update-${response.status}`);
  }
  return body.profile;
}

export async function deleteLlmProfile(id: string): Promise<void> {
  const response = await fetch(
    `/api/agent/llm-profiles/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
      headers: await authHeaders(),
    },
  );
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(body.error ?? `llm-delete-${response.status}`);
  }
}
