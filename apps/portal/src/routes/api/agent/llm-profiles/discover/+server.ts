import { json } from "@sveltejs/kit";
import { isLlmProviderId } from "$agent/lib/llm-catalog";
import { discoverProviderModels } from "$agent/lib/llm-model-discovery";
import {
  isLlmProfileStoreConfigured,
  llmProfileStore,
} from "$agent/lib/llm-profile-store";
import { readJsonRecord, requireAgentUser } from "$lib/server/agent-api";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  const user = await requireAgentUser(request);
  if (user instanceof Response) return user;

  const record = await readJsonRecord(request);
  if (record instanceof Response) return record;
  const profileId =
    typeof record.profileId === "string" ? record.profileId.trim() : "";
  let provider =
    typeof record.provider === "string" && isLlmProviderId(record.provider)
      ? record.provider
      : null;
  let apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";

  try {
    if (profileId) {
      if (!isLlmProfileStoreConfigured()) {
        return json({ error: "llm-store-unconfigured" }, { status: 503 });
      }
      const profile = await llmProfileStore.get(user, profileId);
      if (!profile) {
        return json({ error: "llm-profile-not-found" }, { status: 404 });
      }
      provider = profile.provider;
      apiKey = profile.apiKey;
    }
    if (!provider) {
      return json({ error: "llm-provider-invalid" }, { status: 400 });
    }
    const models = await discoverProviderModels({ provider, apiKey });
    return json({ provider, models });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "llm-discovery-failed";
    const status = message.startsWith("llm-api-key") ? 400 : 422;
    return json({ error: message }, { status });
  }
};
