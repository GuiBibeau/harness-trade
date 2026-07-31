import { describe, expect, test } from "bun:test";
import { discoverProviderModels } from "./llm-model-discovery";

describe("provider model discovery", () => {
  test("uses the authenticated OpenAI catalog and keeps agent-capable model ids", async () => {
    let request: { url: string; authorization: string | null } | null = null;
    const models = await discoverProviderModels(
      { provider: "openai", apiKey: "sk-openai-test" },
      {
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          request = {
            url: String(input),
            authorization: headers.get("authorization"),
          };
          return Response.json({
            object: "list",
            data: [
              { id: "gpt-5.4", object: "model", owned_by: "openai" },
              {
                id: "text-embedding-3-small",
                object: "model",
                owned_by: "openai",
              },
              { id: "gpt-image-1", object: "model", owned_by: "openai" },
              { id: "../unsafe", object: "model", owned_by: "attacker" },
            ],
          });
        },
      },
    );

    expect(request).toEqual({
      url: "https://api.openai.com/v1/models",
      authorization: "Bearer sk-openai-test",
    });
    expect(models).toEqual([{ id: "gpt-5.4", label: "gpt-5.4" }]);
  });

  test("discovers Grok language models available to an xAI API key", async () => {
    let request: { url: string; authorization: string | null } | null = null;
    const models = await discoverProviderModels(
      { provider: "xai", apiKey: "xai-key-test" },
      {
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          request = {
            url: String(input),
            authorization: headers.get("authorization"),
          };
          return Response.json({
            models: [
              {
                id: "grok-4.5",
                object: "model",
                owned_by: "xai",
                aliases: ["grok-latest"],
                input_modalities: ["text", "image"],
                output_modalities: ["text"],
              },
            ],
          });
        },
      },
    );

    expect(request).toEqual({
      url: "https://api.x.ai/v1/language-models",
      authorization: "Bearer xai-key-test",
    });
    expect(models).toEqual([{ id: "grok-4.5", label: "grok-4.5" }]);
  });

  test("uses Anthropic model metadata and required API headers", async () => {
    let request: {
      url: string;
      apiKey: string | null;
      version: string | null;
    } | null = null;
    const models = await discoverProviderModels(
      { provider: "anthropic", apiKey: "sk-ant-test" },
      {
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          request = {
            url: String(input),
            apiKey: headers.get("x-api-key"),
            version: headers.get("anthropic-version"),
          };
          return Response.json({
            data: [
              {
                id: "claude-opus-4-6",
                display_name: "Claude Opus 4.6",
                type: "model",
                capabilities: { structured_outputs: true },
              },
            ],
            has_more: false,
          });
        },
      },
    );

    expect(request).toEqual({
      url: "https://api.anthropic.com/v1/models?limit=1000",
      apiKey: "sk-ant-test",
      version: "2023-06-01",
    });
    expect(models).toEqual([
      { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    ]);
  });

  test("follows bounded Anthropic cursor pagination", async () => {
    const requests: string[] = [];
    const models = await discoverProviderModels(
      { provider: "anthropic", apiKey: "sk-ant-test" },
      {
        fetch: async (input) => {
          const url = String(input);
          requests.push(url);
          return url.includes("after_id")
            ? Response.json({
                data: [
                  {
                    id: "claude-haiku-4-5",
                    type: "model",
                    capabilities: { structured_outputs: true },
                  },
                ],
                has_more: false,
              })
            : Response.json({
                data: [
                  {
                    id: "claude-sonnet-4-6",
                    type: "model",
                    capabilities: { structured_outputs: true },
                  },
                ],
                has_more: true,
                last_id: "claude-sonnet-4-6",
              });
        },
      },
    );

    expect(requests).toEqual([
      "https://api.anthropic.com/v1/models?limit=1000",
      "https://api.anthropic.com/v1/models?limit=1000&after_id=claude-sonnet-4-6",
    ]);
    expect(models.map((model) => model.id)).toEqual([
      "claude-sonnet-4-6",
      "claude-haiku-4-5",
    ]);
  });

  test("discovers the current DeepSeek models instead of relying on stale names", async () => {
    let url = "";
    const models = await discoverProviderModels(
      { provider: "deepseek", apiKey: "sk-deepseek-test" },
      {
        fetch: async (input) => {
          url = String(input);
          return Response.json({
            object: "list",
            data: [
              {
                id: "deepseek-v4-pro",
                object: "model",
                owned_by: "deepseek",
              },
              {
                id: "deepseek-v4-flash",
                object: "model",
                owned_by: "deepseek",
              },
              {
                id: "deepseek-chat",
                object: "model",
                owned_by: "deepseek",
              },
            ],
          });
        },
      },
    );

    expect(url).toBe("https://api.deepseek.com/models");
    expect(models).toEqual([
      { id: "deepseek-v4-pro", label: "deepseek-v4-pro" },
      { id: "deepseek-v4-flash", label: "deepseek-v4-flash" },
    ]);
  });

  test("deduplicates provider rows and normalizes invalid metadata", async () => {
    const models = await discoverProviderModels(
      { provider: "xai", apiKey: "xai-key-test" },
      {
        fetch: async () =>
          Response.json({
            models: [
              {
                id: "grok-4.5",
                display_name: "Grok 4.5",
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
              {
                id: "grok-4.5",
                display_name: "Duplicate",
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
              {
                id: "grok-4.3",
                display_name: "x".repeat(129),
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
              {
                id: "grok-imagine-image",
                input_modalities: ["text"],
                output_modalities: ["image"],
              },
              { id: "grok-malformed-no-modalities" },
            ],
          }),
      },
    );

    expect(models).toEqual([
      { id: "grok-4.5", label: "Grok 4.5" },
      { id: "grok-4.3", label: "grok-4.3" },
    ]);
  });

  test("returns a sanitized error for provider network failures", async () => {
    expect(
      discoverProviderModels(
        { provider: "xai", apiKey: "xai-key-test" },
        {
          fetch: async () => {
            throw new Error("secret-bearing provider request");
          },
        },
      ),
    ).rejects.toThrow("llm-discovery-provider-unavailable");
  });
});
