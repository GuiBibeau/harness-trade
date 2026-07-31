import { isSafeLlmModelId, type LlmProviderId } from "./llm-catalog";

export type DiscoveredLlmModel = {
  id: string;
  label: string;
};

type Fetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

const DISCOVERY_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_CHARACTERS = 512_000;
const MAX_DISCOVERY_PAGES = 3;
const CURRENT_DEEPSEEK_MODELS = new Set([
  "deepseek-v4-pro",
  "deepseek-v4-flash",
]);

function isOpenAiLanguageModel(id: string): boolean {
  const languageFamily =
    id.startsWith("gpt-") ||
    /^o[0-9]/.test(id) ||
    id.startsWith("chatgpt-") ||
    id.startsWith("ft:gpt-") ||
    /^ft:o[0-9]/.test(id);
  return (
    languageFamily &&
    !/(audio|embedding|image|moderation|realtime|search|transcri|tts)/i.test(id)
  );
}

type ProviderDiscovery = {
  endpoint: string;
  responseProperty: "data" | "models";
  acceptsModel: (id: string, row: Record<string, unknown>) => boolean;
  headers: (apiKey: string) => Headers;
  nextEndpoint?: (payload: unknown) => string | null;
};

function bearerHeaders(apiKey: string): Headers {
  return new Headers({ authorization: `Bearer ${apiKey}` });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PROVIDER_DISCOVERY: Record<LlmProviderId, ProviderDiscovery> = {
  openai: {
    endpoint: "https://api.openai.com/v1/models",
    responseProperty: "data",
    acceptsModel: isOpenAiLanguageModel,
    headers: bearerHeaders,
  },
  anthropic: {
    endpoint: "https://api.anthropic.com/v1/models?limit=1000",
    responseProperty: "data",
    acceptsModel: (id, row) =>
      id.startsWith("claude-") &&
      row.type === "model" &&
      isRecord(row.capabilities),
    headers: (apiKey) =>
      new Headers({
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      }),
    nextEndpoint: (payload) => {
      if (!isRecord(payload)) return null;
      const page = payload as Record<string, unknown>;
      if (page.has_more !== true || typeof page.last_id !== "string") {
        return null;
      }
      return isSafeLlmModelId(page.last_id)
        ? `https://api.anthropic.com/v1/models?limit=1000&after_id=${encodeURIComponent(page.last_id)}`
        : null;
    },
  },
  deepseek: {
    endpoint: "https://api.deepseek.com/models",
    responseProperty: "data",
    acceptsModel: (id) => CURRENT_DEEPSEEK_MODELS.has(id),
    headers: bearerHeaders,
  },
  xai: {
    endpoint: "https://api.x.ai/v1/language-models",
    responseProperty: "models",
    acceptsModel: (_id, row) =>
      Array.isArray(row.input_modalities) &&
      row.input_modalities.includes("text") &&
      Array.isArray(row.output_modalities) &&
      row.output_modalities.includes("text"),
    headers: bearerHeaders,
  },
};

function modelRows(
  value: unknown,
  property: "data" | "models",
): Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  const rows = value[property];
  return Array.isArray(rows)
    ? rows.filter(
        (row): row is Record<string, unknown> =>
          typeof row === "object" && row !== null,
      )
    : [];
}

async function fetchDiscoveryPage(
  endpoint: string,
  apiKey: string,
  provider: ProviderDiscovery,
  fetcher: Fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      headers: provider.headers(apiKey),
      redirect: "error",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch {
    throw new Error("llm-discovery-provider-unavailable");
  }
  if (!response.ok) {
    throw new Error(`llm-discovery-provider-${response.status}`);
  }
  try {
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_RESPONSE_CHARACTERS) {
      throw new Error("llm-discovery-response-too-large");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("llm-discovery-response-invalid");
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_CHARACTERS) {
        await reader.cancel();
        throw new Error("llm-discovery-response-too-large");
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
    return JSON.parse(body) as unknown;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message === "llm-discovery-response-too-large" ||
        error.message === "llm-discovery-response-invalid")
    ) {
      throw error;
    }
    throw new Error("llm-discovery-response-invalid");
  }
}

export async function discoverProviderModels(
  input: { provider: LlmProviderId; apiKey: string },
  dependencies: { fetch?: Fetch } = {},
): Promise<DiscoveredLlmModel[]> {
  const apiKey = input.apiKey.trim();
  if (apiKey.length < 8 || apiKey.length > 256) {
    throw new Error("llm-api-key-invalid");
  }
  const provider = PROVIDER_DISCOVERY[input.provider];
  if (!provider) throw new Error("llm-discovery-provider-unsupported");
  const fetcher = dependencies.fetch ?? fetch;
  const rows: Record<string, unknown>[] = [];
  let endpoint: string | null = provider.endpoint;
  for (let page = 0; endpoint && page < MAX_DISCOVERY_PAGES; page += 1) {
    const payload = await fetchDiscoveryPage(
      endpoint,
      apiKey,
      provider,
      fetcher,
    );
    rows.push(...modelRows(payload, provider.responseProperty));
    endpoint = provider.nextEndpoint?.(payload) ?? null;
  }
  const seen = new Set<string>();
  return rows
    .flatMap((row) => {
      const id = row.id;
      if (
        typeof id !== "string" ||
        !isSafeLlmModelId(id) ||
        seen.has(id) ||
        !provider.acceptsModel(id, row)
      ) {
        return [];
      }
      seen.add(id);
      return [
        {
          id,
          label:
            typeof row.display_name === "string" &&
            row.display_name.trim().length > 0 &&
            row.display_name.trim().length <= 128
              ? row.display_name.trim()
              : id,
        },
      ];
    })
    .slice(0, 200);
}

export async function assertProviderModelAvailable(input: {
  provider: LlmProviderId;
  apiKey: string;
  model: string;
}): Promise<void> {
  const models = await discoverProviderModels(input);
  if (!models.some((entry) => entry.id === input.model)) {
    throw new Error("llm-model-not-available");
  }
}
