import { describe, expect, test } from "bun:test";
import {
  apiKeyLast4,
  isLlmProviderId,
  isSafeLlmModelId,
  LLM_PROVIDERS,
  providerModels,
} from "../../../agent/lib/llm-catalog";

describe("llm-catalog", () => {
  test("exposes DeepSeek, OpenAI, Anthropic, and xAI", () => {
    expect(LLM_PROVIDERS.map((p) => p.id)).toEqual([
      "deepseek",
      "openai",
      "anthropic",
      "xai",
    ]);
  });

  test("exposes supported providers and current preview models", () => {
    expect(isLlmProviderId("openai")).toBe(true);
    expect(isLlmProviderId("gemini")).toBe(false);
    expect(
      providerModels("openai").some((model) => model.id === "gpt-5.4-mini"),
    ).toBe(true);
    expect(providerModels("xai").some((model) => model.id === "grok-4.5")).toBe(
      true,
    );
  });

  test("accepts provider-discovered model ids but rejects path/control input", () => {
    expect(isSafeLlmModelId("grok-4.20-reasoning-beta")).toBe(true);
    expect(isSafeLlmModelId("ft:gpt-5.4:team:model")).toBe(true);
    expect(isSafeLlmModelId("../model")).toBe(false);
    expect(isSafeLlmModelId("model\ninjected")).toBe(false);
  });

  test("masks api keys to last 4", () => {
    expect(apiKeyLast4("sk-abcdefghij")).toBe("ghij");
    expect(apiKeyLast4("ab")).toBe("****");
  });
});
