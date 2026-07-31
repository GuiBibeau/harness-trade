import { json } from "@sveltejs/kit";
import { isLlmProviderId, type LlmProviderId } from "$agent/lib/llm-catalog";
import { assertProviderModelAvailable } from "$agent/lib/llm-model-discovery";
import {
  isLlmProfileStoreConfigured,
  llmProfileStore,
} from "$agent/lib/llm-profile-store";
import { readJsonRecord, requireAgentUser } from "$lib/server/agent-api";
import type { RequestHandler } from "./$types";

export const PATCH: RequestHandler = async ({
  request,
  params,
  setHeaders,
}) => {
  setHeaders({ "cache-control": "no-store" });
  const user = await requireAgentUser(request);
  if (user instanceof Response) return user;
  if (!isLlmProfileStoreConfigured()) {
    return json({ error: "llm-store-unconfigured" }, { status: 503 });
  }

  const id = params.id?.trim() ?? "";
  const record = await readJsonRecord(request);
  if (record instanceof Response) return record;
  const patch: {
    name?: string;
    provider?: LlmProviderId;
    model?: string;
    apiKey?: string;
    active?: boolean;
  } = {};
  if (typeof record.name === "string") patch.name = record.name;
  if (typeof record.provider === "string" && isLlmProviderId(record.provider)) {
    patch.provider = record.provider;
  }
  if (typeof record.model === "string") patch.model = record.model;
  if (typeof record.apiKey === "string" && record.apiKey.trim()) {
    patch.apiKey = record.apiKey;
  }
  if (typeof record.active === "boolean") patch.active = record.active;

  try {
    if (
      patch.provider !== undefined ||
      patch.model !== undefined ||
      patch.apiKey !== undefined
    ) {
      const current =
        patch.apiKey !== undefined
          ? await llmProfileStore.getPublic(user, id)
          : await llmProfileStore.get(user, id);
      if (!current) {
        return json({ error: "llm-profile-not-found" }, { status: 404 });
      }
      const provider = patch.provider ?? current.provider;
      const model = patch.model ?? current.model;
      const apiKey =
        patch.apiKey ?? ("apiKey" in current ? current.apiKey : "");
      await assertProviderModelAvailable({ provider, apiKey, model });
    }
    const profile = await llmProfileStore.update(user, id, patch);
    return json({ profile });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "llm-store-error";
    if (message === "agent-state-object-not-found") {
      return json({ error: "llm-profile-not-found" }, { status: 404 });
    }
    const status = message.startsWith("llm-") ? 400 : 503;
    return json({ error: message }, { status });
  }
};

export const DELETE: RequestHandler = async ({
  request,
  params,
  setHeaders,
}) => {
  setHeaders({ "cache-control": "no-store" });
  const user = await requireAgentUser(request);
  if (user instanceof Response) return user;
  if (!isLlmProfileStoreConfigured()) {
    return json({ error: "llm-store-unconfigured" }, { status: 503 });
  }

  const id = params.id?.trim() ?? "";
  try {
    const removed = await llmProfileStore.remove(user, id);
    if (!removed)
      return json({ error: "llm-profile-not-found" }, { status: 404 });
    return json({ ok: true, id });
  } catch {
    return json({ error: "llm-store-unavailable" }, { status: 503 });
  }
};
