// Supported LLM providers plus preview models shown before live discovery.
// Keys stay server-side after write and never return to the browser.

export type LlmProviderId = "deepseek" | "openai" | "anthropic" | "xai";

export type LlmModelOption = {
  id: string;
  label: string;
};

export type LlmProviderOption = {
  id: LlmProviderId;
  label: string;
  models: LlmModelOption[];
  keyHint: string;
};

export const LLM_PROVIDERS: readonly LlmProviderOption[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    keyHint: "DEEPSEEK_API_KEY from platform.deepseek.com",
    models: [
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    keyHint: "OPENAI_API_KEY from platform.openai.com",
    models: [
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "o4-mini", label: "o4-mini" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    keyHint: "ANTHROPIC_API_KEY from console.anthropic.com",
    models: [
      { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    ],
  },
  {
    id: "xai",
    label: "xAI",
    keyHint: "XAI_API_KEY from console.x.ai",
    models: [
      { id: "grok-4.5", label: "Grok 4.5" },
      { id: "grok-4.3", label: "Grok 4.3" },
      { id: "grok-4.20-0309-reasoning", label: "Grok 4.20 Reasoning" },
      {
        id: "grok-4.20-0309-non-reasoning",
        label: "Grok 4.20 Non-Reasoning",
      },
    ],
  },
] as const;

export function isLlmProviderId(value: string): value is LlmProviderId {
  return LLM_PROVIDERS.some((provider) => provider.id === value);
}

export function providerModels(provider: LlmProviderId): LlmModelOption[] {
  return (
    LLM_PROVIDERS.find((entry) => entry.id === provider)?.models.slice() ?? []
  );
}

export function isSafeLlmModelId(model: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model);
}

export function apiKeyLast4(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (trimmed.length < 4) return "****";
  return trimmed.slice(-4);
}
