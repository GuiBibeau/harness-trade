import { describe, expect, test } from "bun:test";
import {
  createLlmSecretKeyring,
  decryptLlmSecret,
  encryptLlmSecret,
} from "./llm-secret";

const OWNER = "did:privy:user-42";
const PROFILE = "0123456789abcdef0123456789abcdef";
const API_KEY = "sk-user-secret-that-must-not-reach-blob-json";

function encodedKey(byte: number): string {
  return Buffer.alloc(32, byte).toString("base64");
}

describe("LLM profile secret encryption", () => {
  test("encrypts a key without preserving plaintext and decrypts it for the same owner profile", () => {
    const keyring = createLlmSecretKeyring({
      current: encodedKey(1),
    });

    const encrypted = encryptLlmSecret(
      API_KEY,
      { ownerId: OWNER, profileId: PROFILE },
      keyring,
    );

    expect(JSON.stringify(encrypted)).not.toContain(API_KEY);
    expect(
      decryptLlmSecret(
        encrypted,
        { ownerId: OWNER, profileId: PROFILE },
        keyring,
      ),
    ).toEqual({ value: API_KEY, needsRotation: false });
  });

  test("binds ciphertext to its authenticated owner and profile", () => {
    const keyring = createLlmSecretKeyring({
      current: encodedKey(2),
    });
    const encrypted = encryptLlmSecret(
      API_KEY,
      { ownerId: OWNER, profileId: PROFILE },
      keyring,
    );

    expect(() =>
      decryptLlmSecret(
        encrypted,
        { ownerId: "did:privy:attacker", profileId: PROFILE },
        keyring,
      ),
    ).toThrow();
  });

  test("decrypts a previous key version and marks it for lazy rotation", () => {
    const previous = createLlmSecretKeyring({
      current: encodedKey(3),
    });
    const encrypted = encryptLlmSecret(
      API_KEY,
      { ownerId: OWNER, profileId: PROFILE },
      previous,
    );
    const current = createLlmSecretKeyring({
      current: encodedKey(4),
      previous: encodedKey(3),
    });

    expect(
      decryptLlmSecret(
        encrypted,
        { ownerId: OWNER, profileId: PROFILE },
        current,
      ),
    ).toEqual({ value: API_KEY, needsRotation: true });
  });
});
