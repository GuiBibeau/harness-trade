import { deepseek } from "@ai-sdk/deepseek";
import { defineAgent, defineDynamic } from "eve";
import type { SessionContext } from "eve/context";
import { PLATFORM_DEFAULT_LLM } from "./lib/llm-catalog";
import { createUserLanguageModel } from "./lib/llm-model";
import { llmProfileStore } from "./lib/llm-profile-store";

function authenticatedOwner(ctx: SessionContext): string | null {
  const current = ctx.session.auth.current;
  const initiator = ctx.session.auth.initiator;
  if (
    current?.principalType !== "user" ||
    initiator?.principalType !== "user" ||
    current.principalId !== initiator.principalId
  ) {
    return null;
  }
  return current.principalId;
}

function requestedProfileId(ctx: SessionContext): string | null {
  const attrs = ctx.session.auth.current?.attributes;
  if (!attrs || typeof attrs !== "object") return null;
  const value = (attrs as Record<string, unknown>).llmProfileId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function resolveUserModel(ctx: SessionContext) {
  const ownerId = authenticatedOwner(ctx);
  if (!ownerId) return null;
  try {
    const profileId = requestedProfileId(ctx);
    if (profileId === "platform") return null;
    const profile = profileId
      ? await llmProfileStore.get(ownerId, profileId)
      : await llmProfileStore.getActive(ownerId);
    if (!profile?.apiKey?.trim() || profile.ownerId !== ownerId) return null;
    return createUserLanguageModel({
      provider: profile.provider,
      model: profile.model,
      apiKey: profile.apiKey,
    });
  } catch {
    // Degrade to platform fallback — never fail the turn on vault errors.
    return null;
  }
}

export default defineAgent({
  description:
    "A persistent, authenticated trading copilot for the Harness terminal.",
  model: defineDynamic({
    // Platform default when the user has no BYOK profile.
    fallback: deepseek(PLATFORM_DEFAULT_LLM.model),
    events: {
      // Live LanguageModel (with the caller's API key) is only valid on
      // step.started — session/turn scopes must be serializable model ids.
      "step.started": async (_event, ctx) => resolveUserModel(ctx),
    },
  }),
  reasoning: "provider-default",
  compaction: { thresholdPercent: 0.78 },
  build: {
    externalDependencies: ["@ellipsis-labs/rise", "@solana/web3.js", "buffer"],
  },
});
