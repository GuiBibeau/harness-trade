import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createOpenAI } from "@ai-sdk/openai";
import { createXai } from "@ai-sdk/xai";
import type { LanguageModel } from "ai";
import {
  isLlmProviderId,
  isSafeLlmModelId,
  type LlmProviderId,
} from "./llm-catalog";

export function createUserLanguageModel(input: {
  provider: LlmProviderId;
  model: string;
  apiKey: string;
}): LanguageModel {
  const apiKey = input.apiKey.trim();
  if (!apiKey) throw new Error("llm-api-key-missing");
  if (!isSafeLlmModelId(input.model)) {
    throw new Error("llm-model-not-allowed");
  }

  switch (input.provider) {
    case "deepseek":
      return createDeepSeek({ apiKey })(input.model);
    case "openai":
      return createOpenAI({ apiKey })(input.model);
    case "anthropic":
      return createAnthropic({ apiKey })(input.model);
    case "xai":
      return createXai({ apiKey })(input.model);
    default: {
      const _exhaustive: never = input.provider;
      throw new Error(`llm-provider-unsupported:${_exhaustive}`);
    }
  }
}

export function parseProvider(value: unknown): LlmProviderId | null {
  return typeof value === "string" && isLlmProviderId(value) ? value : null;
}
