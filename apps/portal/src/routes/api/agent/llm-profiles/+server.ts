import { json } from "@sveltejs/kit";
import { isLlmProviderId, LLM_PROVIDERS } from "$agent/lib/llm-catalog";
import { assertProviderModelAvailable } from "$agent/lib/llm-model-discovery";
import {
  isLlmProfileStoreConfigured,
  llmProfileStore,
} from "$agent/lib/llm-profile-store";
import { readJsonRecord, requireAgentUser } from "$lib/server/agent-api";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  const user = await requireAgentUser(request);
  if (user instanceof Response) return user;

  const catalog = LLM_PROVIDERS.map((provider) => ({
    id: provider.id,
    label: provider.label,
    keyHint: provider.keyHint,
    models: provider.models,
  }));

  if (!isLlmProfileStoreConfigured()) {
    return json({
      catalog,
      profiles: [],
      storeConfigured: false,
      platformDefault: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        label: "Harness default (DeepSeek V4 Pro)",
      },
    });
  }

  try {
    const profiles = await llmProfileStore.listPublic(user);
    return json({
      catalog,
      profiles,
      storeConfigured: true,
      platformDefault: {
        provider: "deepseek",
        model: "deepseek-v4-pro",
        label: "Harness default (DeepSeek V4 Pro)",
      },
    });
  } catch {
    return json({ error: "llm-store-unavailable" }, { status: 503 });
  }
};

export const POST: RequestHandler = async ({ request, setHeaders }) => {
  setHeaders({ "cache-control": "no-store" });
  const user = await requireAgentUser(request);
  if (user instanceof Response) return user;
  if (!isLlmProfileStoreConfigured()) {
    return json({ error: "llm-store-unconfigured" }, { status: 503 });
  }

  const record = await readJsonRecord(request);
  if (record instanceof Response) return record;
  const name = typeof record.name === "string" ? record.name : "";
  const provider =
    typeof record.provider === "string" && isLlmProviderId(record.provider)
      ? record.provider
      : null;
  const model = typeof record.model === "string" ? record.model : "";
  const apiKey = typeof record.apiKey === "string" ? record.apiKey : "";
  if (!provider)
    return json({ error: "llm-provider-invalid" }, { status: 400 });

  try {
    await assertProviderModelAvailable({ provider, apiKey, model });
    const profile = await llmProfileStore.create(user, {
      name,
      provider,
      model,
      apiKey,
      active: record.active !== false,
    });
    return json({ profile: llmProfileStore.summarize([profile])[0] });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "llm-store-error";
    const status =
      message === "llm-profile-limit-reached"
        ? 409
        : message.startsWith("llm-")
          ? 400
          : 503;
    return json({ error: message }, { status });
  }
};
