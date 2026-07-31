import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export type EncryptedLlmSecret = {
  version: 1;
  algorithm: typeof ALGORITHM;
  keyId: string;
  iv: string;
  ciphertext: string;
  authTag: string;
};

type SecretContext = {
  ownerId: string;
  profileId: string;
};

type SecretKey = {
  id: string;
  value: Buffer;
};

export type LlmSecretKeyring = {
  current: SecretKey;
  byId: ReadonlyMap<string, SecretKey>;
};

function decodeKey(value: string): SecretKey {
  const encoded = value.trim();
  if (!/^[a-zA-Z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error("llm-secret-key-invalid");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== KEY_BYTES) {
    throw new Error("llm-secret-key-invalid");
  }
  return {
    id: createHash("sha256").update(key).digest("hex").slice(0, 16),
    value: key,
  };
}

export function createLlmSecretKeyring(input: {
  current: string;
  previous?: string | readonly string[];
}): LlmSecretKeyring {
  const current = decodeKey(input.current);
  const previous =
    typeof input.previous === "string"
      ? input.previous
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean)
      : (input.previous ?? []);
  const keys = [current, ...previous.map(decodeKey)];
  const byId = new Map(keys.map((key) => [key.id, key]));
  return { current, byId };
}

export function llmSecretKeyringFromEnv(
  env: Record<string, string | undefined> = process.env,
): LlmSecretKeyring {
  const current = env.LLM_PROFILE_ENCRYPTION_KEY?.trim();
  if (!current) throw new Error("llm-secret-key-unconfigured");
  return createLlmSecretKeyring({
    current,
    previous: env.LLM_PROFILE_ENCRYPTION_KEY_PREVIOUS,
  });
}

export function isLlmSecretEncryptionConfigured(
  env: Record<string, string | undefined> = process.env,
): boolean {
  try {
    llmSecretKeyringFromEnv(env);
    return true;
  } catch {
    return false;
  }
}

function additionalData(context: SecretContext): Buffer {
  return Buffer.from(
    `harness:llm-profile:v1:${context.ownerId}:${context.profileId}`,
    "utf8",
  );
}

export function encryptLlmSecret(
  value: string,
  context: SecretContext,
  keyring: LlmSecretKeyring,
): EncryptedLlmSecret {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, keyring.current.value, iv);
  cipher.setAAD(additionalData(context));
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    algorithm: ALGORITHM,
    keyId: keyring.current.id,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptLlmSecret(
  encrypted: EncryptedLlmSecret,
  context: SecretContext,
  keyring: LlmSecretKeyring,
): { value: string; needsRotation: boolean } {
  if (
    encrypted.version !== 1 ||
    encrypted.algorithm !== ALGORITHM ||
    typeof encrypted.keyId !== "string"
  ) {
    throw new Error("llm-secret-format-invalid");
  }
  const key = keyring.byId.get(encrypted.keyId);
  if (!key) throw new Error("llm-secret-key-unavailable");

  try {
    const iv = Buffer.from(encrypted.iv, "base64");
    const authTag = Buffer.from(encrypted.authTag, "base64");
    const ciphertext = Buffer.from(encrypted.ciphertext, "base64");
    if (iv.byteLength !== IV_BYTES || authTag.byteLength !== 16) {
      throw new Error("llm-secret-format-invalid");
    }
    const decipher = createDecipheriv(ALGORITHM, key.value, iv);
    decipher.setAAD(additionalData(context));
    decipher.setAuthTag(authTag);
    const value = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]).toString("utf8");
    return {
      value,
      needsRotation: key.id !== keyring.current.id,
    };
  } catch {
    throw new Error("llm-secret-decrypt-failed");
  }
}
