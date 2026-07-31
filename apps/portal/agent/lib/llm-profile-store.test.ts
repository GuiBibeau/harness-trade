import { describe, expect, test } from "bun:test";
import {
  type LlmProfileRecord,
  openLlmProfileRecord,
  sealLlmProfileRecord,
} from "./llm-profile-store";
import { createLlmSecretKeyring } from "./llm-secret";

const record: LlmProfileRecord = {
  id: "0123456789abcdef0123456789abcdef",
  ownerId: "did:privy:user-42",
  name: "My Grok",
  provider: "xai",
  model: "grok-4",
  apiKey: "xai-secret-key-value",
  active: true,
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T00:00:00.000Z",
  version: 1,
};

const keyring = createLlmSecretKeyring({
  current: Buffer.alloc(32, 7).toString("base64"),
});

describe("LLM profile persistence boundary", () => {
  test("serializes new profiles without plaintext API keys", () => {
    const stored = sealLlmProfileRecord(record, keyring);

    expect(stored).not.toHaveProperty("apiKey");
    expect(stored.apiKeyLast4).toBe("alue");
    expect(JSON.stringify(stored)).not.toContain(record.apiKey);
    expect(openLlmProfileRecord(stored, keyring)).toEqual({
      record,
      needsWrite: false,
    });
  });

  test("opens legacy plaintext profiles only as a migration that must be rewritten", () => {
    const legacy = { ...record };

    expect(openLlmProfileRecord(legacy, keyring)).toEqual({
      record,
      needsWrite: true,
    });
    expect(JSON.stringify(sealLlmProfileRecord(record, keyring))).not.toContain(
      record.apiKey,
    );
  });
});
