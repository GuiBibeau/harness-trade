import { describe, expect, test } from "bun:test";
import { createUserLanguageModel } from "./llm-model";

describe("user language model factory", () => {
  test("creates an xAI Responses model for a discovered Grok id", () => {
    const model = createUserLanguageModel({
      provider: "xai",
      model: "grok-4.5",
      apiKey: "xai-test-key",
    });

    expect(model.provider).toBe("xai.responses");
    expect(model.modelId).toBe("grok-4.5");
  });
});
