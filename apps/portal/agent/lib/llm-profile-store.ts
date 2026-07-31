import { createHash, randomBytes } from "node:crypto";
import {
  deletePrivateObject,
  listPrivateObjects,
  ownerPartition,
  readPrivateJson,
  updatePrivateJson,
  writePrivateJson,
} from "./blob-json";
import {
  apiKeyLast4,
  isLlmProviderId,
  isSafeLlmModelId,
  type LlmProviderId,
} from "./llm-catalog";
import {
  decryptLlmSecret,
  type EncryptedLlmSecret,
  encryptLlmSecret,
  isLlmSecretEncryptionConfigured,
  type LlmSecretKeyring,
  llmSecretKeyringFromEnv,
} from "./llm-secret";

const ROOT = "agent-state/v1/llm-profiles";
const MAX_PROFILES = 8;
const NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,47}$/;

export type LlmProfileRecord = {
  id: string;
  ownerId: string;
  name: string;
  provider: LlmProviderId;
  model: string;
  /** Server-only. Never returned to the browser or the model. */
  apiKey: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type LlmProfilePublic = {
  id: string;
  name: string;
  provider: LlmProviderId;
  model: string;
  active: boolean;
  hasApiKey: boolean;
  apiKeyLast4: string;
  updatedAt: string;
};

export type StoredLlmProfileRecord = Omit<LlmProfileRecord, "apiKey"> & {
  encryptedApiKey: EncryptedLlmSecret;
  apiKeyLast4: string;
};

type LegacyEncryptedLlmProfileRecord = Omit<LlmProfileRecord, "apiKey"> & {
  encryptedApiKey: EncryptedLlmSecret;
};

type PersistedLlmProfileRecord =
  | StoredLlmProfileRecord
  | LegacyEncryptedLlmProfileRecord
  | LlmProfileRecord;

function prefix(ownerId: string): string {
  return `${ROOT}/${ownerPartition(ownerId)}/`;
}

function pathname(ownerId: string, id: string): string {
  if (!/^[0-9a-f]{32}$/i.test(id)) throw new Error("llm-profile-id-invalid");
  return `${prefix(ownerId)}${id}.json`;
}

function newId(): string {
  return createHash("sha256")
    .update(randomBytes(32))
    .digest("hex")
    .slice(0, 32);
}

export function sealLlmProfileRecord(
  profile: LlmProfileRecord,
  keyring: LlmSecretKeyring,
): StoredLlmProfileRecord {
  const { apiKey, ...metadata } = profile;
  return {
    ...metadata,
    apiKeyLast4: apiKeyLast4(apiKey),
    encryptedApiKey: encryptLlmSecret(
      apiKey,
      { ownerId: profile.ownerId, profileId: profile.id },
      keyring,
    ),
  };
}

export function openLlmProfileRecord(
  stored: PersistedLlmProfileRecord,
  keyring: LlmSecretKeyring,
): { record: LlmProfileRecord; needsWrite: boolean } {
  if ("encryptedApiKey" in stored && stored.encryptedApiKey) {
    const {
      encryptedApiKey,
      apiKeyLast4: _storedApiKeyLast4,
      ...metadata
    } = stored as typeof stored & { apiKeyLast4?: string };
    const decrypted = decryptLlmSecret(
      encryptedApiKey,
      { ownerId: stored.ownerId, profileId: stored.id },
      keyring,
    );
    const { apiKey: _legacyApiKey, ...cleanMetadata } =
      metadata as typeof metadata & {
        apiKey?: string;
      };
    return {
      record: {
        ...cleanMetadata,
        apiKey: decrypted.value,
      },
      needsWrite: decrypted.needsRotation || _legacyApiKey !== undefined,
    };
  }
  if ("apiKey" in stored && typeof stored.apiKey === "string") {
    return { record: stored, needsWrite: true };
  }
  throw new Error("llm-profile-secret-missing");
}

async function readProfile(
  ownerId: string,
  profilePathname: string,
  keyring: LlmSecretKeyring,
): Promise<LlmProfileRecord | null> {
  const stored =
    await readPrivateJson<PersistedLlmProfileRecord>(profilePathname);
  if (!stored || stored.value.ownerId !== ownerId) return null;
  const opened = openLlmProfileRecord(stored.value, keyring);
  if (opened.needsWrite) {
    await updatePrivateJson<PersistedLlmProfileRecord>(
      profilePathname,
      (current) => {
        if (current.ownerId !== ownerId) {
          throw new Error("llm-profile-owner-mismatch");
        }
        return sealLlmProfileRecord(
          openLlmProfileRecord(current, keyring).record,
          keyring,
        );
      },
    );
  }
  return opened.record;
}

function isCurrentStoredProfile(
  stored: PersistedLlmProfileRecord,
): stored is StoredLlmProfileRecord {
  return (
    "encryptedApiKey" in stored &&
    Boolean(stored.encryptedApiKey) &&
    "apiKeyLast4" in stored &&
    typeof stored.apiKeyLast4 === "string"
  );
}

function publicFromStored(profile: StoredLlmProfileRecord): LlmProfilePublic {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    model: profile.model,
    active: profile.active,
    hasApiKey: true,
    apiKeyLast4: profile.apiKeyLast4,
    updatedAt: profile.updatedAt,
  };
}

async function readPublicProfile(
  ownerId: string,
  profilePathname: string,
): Promise<LlmProfilePublic | null> {
  const persisted =
    await readPrivateJson<PersistedLlmProfileRecord>(profilePathname);
  if (!persisted || persisted.value.ownerId !== ownerId) return null;
  if (isCurrentStoredProfile(persisted.value)) {
    return publicFromStored(persisted.value);
  }

  const keyring = llmSecretKeyringFromEnv();
  let migrated: StoredLlmProfileRecord | null = null;
  await updatePrivateJson<PersistedLlmProfileRecord>(
    profilePathname,
    (current) => {
      if (current.ownerId !== ownerId) {
        throw new Error("llm-profile-owner-mismatch");
      }
      migrated = isCurrentStoredProfile(current)
        ? current
        : sealLlmProfileRecord(
            openLlmProfileRecord(current, keyring).record,
            keyring,
          );
      return migrated;
    },
  );
  if (!migrated) throw new Error("llm-profile-migration-failed");
  return publicFromStored(migrated);
}

function assertName(name: string): string {
  const trimmed = name.trim();
  if (!NAME_RE.test(trimmed)) throw new Error("llm-profile-name-invalid");
  return trimmed;
}

function toPublic(profile: LlmProfileRecord): LlmProfilePublic {
  return {
    id: profile.id,
    name: profile.name,
    provider: profile.provider,
    model: profile.model,
    active: profile.active,
    hasApiKey: profile.apiKey.trim().length > 0,
    apiKeyLast4: apiKeyLast4(profile.apiKey),
    updatedAt: profile.updatedAt,
  };
}

export const llmProfileStore = {
  async listPublic(ownerId: string): Promise<LlmProfilePublic[]> {
    const objects = await listPrivateObjects({
      prefix: prefix(ownerId),
      limit: MAX_PROFILES,
    });
    const rows = await Promise.all(
      objects.blobs.map((blob) => readPublicProfile(ownerId, blob.pathname)),
    );
    return rows
      .filter((row): row is LlmProfilePublic => row !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  async getActive(ownerId: string): Promise<LlmProfileRecord | null> {
    const profiles = await this.listPublic(ownerId);
    const active = profiles.find((profile) => profile.active);
    return active ? await this.get(ownerId, active.id) : null;
  },

  async get(ownerId: string, id: string): Promise<LlmProfileRecord | null> {
    return await readProfile(
      ownerId,
      pathname(ownerId, id),
      llmSecretKeyringFromEnv(),
    );
  },

  async getPublic(
    ownerId: string,
    id: string,
  ): Promise<LlmProfilePublic | null> {
    return await readPublicProfile(ownerId, pathname(ownerId, id));
  },

  async create(
    ownerId: string,
    input: {
      name: string;
      provider: LlmProviderId;
      model: string;
      apiKey: string;
      active?: boolean;
    },
  ): Promise<LlmProfileRecord> {
    if (!isLlmProviderId(input.provider)) {
      throw new Error("llm-provider-invalid");
    }
    if (!isSafeLlmModelId(input.model)) {
      throw new Error("llm-model-not-allowed");
    }
    const apiKey = input.apiKey.trim();
    if (apiKey.length < 8 || apiKey.length > 256) {
      throw new Error("llm-api-key-invalid");
    }
    const existing = await this.listPublic(ownerId);
    if (existing.length >= MAX_PROFILES) {
      throw new Error("llm-profile-limit-reached");
    }
    const now = new Date().toISOString();
    const makeActive = input.active !== false;
    if (makeActive) {
      await this.clearActive(ownerId, existing);
    }
    const id = newId();
    const record: LlmProfileRecord = {
      id,
      ownerId,
      name: assertName(input.name),
      provider: input.provider,
      model: input.model,
      apiKey,
      active: makeActive,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    await writePrivateJson(
      pathname(ownerId, record.id),
      sealLlmProfileRecord(record, llmSecretKeyringFromEnv()),
    );
    return record;
  },

  async update(
    ownerId: string,
    id: string,
    patch: {
      name?: string;
      provider?: LlmProviderId;
      model?: string;
      apiKey?: string;
      active?: boolean;
    },
  ): Promise<LlmProfilePublic> {
    const current = await readPublicProfile(ownerId, pathname(ownerId, id));
    if (!current) throw new Error("agent-state-object-not-found");

    const provider = patch.provider ?? current.provider;
    const model = patch.model ?? current.model;
    if (!isLlmProviderId(provider) || !isSafeLlmModelId(model)) {
      throw new Error("llm-model-not-allowed");
    }
    if (patch.apiKey !== undefined) {
      const apiKey = patch.apiKey.trim();
      if (apiKey.length < 8 || apiKey.length > 256) {
        throw new Error("llm-api-key-invalid");
      }
    }
    if (patch.active === true) {
      await this.clearActive(ownerId, await this.listPublic(ownerId), id);
    }

    let result: LlmProfilePublic | null = null;
    await updatePrivateJson<PersistedLlmProfileRecord>(
      pathname(ownerId, id),
      (stored) => {
        if (stored.ownerId !== ownerId) {
          throw new Error("llm-profile-owner-mismatch");
        }
        const keyring = llmSecretKeyringFromEnv();
        const row = isCurrentStoredProfile(stored)
          ? stored
          : sealLlmProfileRecord(
              openLlmProfileRecord(stored, keyring).record,
              keyring,
            );
        const metadata = {
          ...row,
          name: patch.name !== undefined ? assertName(patch.name) : row.name,
          provider,
          model,
          active: patch.active ?? row.active,
          updatedAt: new Date().toISOString(),
          version: row.version + 1,
        };
        const next =
          patch.apiKey === undefined
            ? metadata
            : sealLlmProfileRecord(
                {
                  id: metadata.id,
                  ownerId: metadata.ownerId,
                  name: metadata.name,
                  provider: metadata.provider,
                  model: metadata.model,
                  apiKey: patch.apiKey.trim(),
                  active: metadata.active,
                  createdAt: metadata.createdAt,
                  updatedAt: metadata.updatedAt,
                  version: metadata.version,
                },
                keyring,
              );
        result = publicFromStored(next);
        return next;
      },
    );
    if (!result) throw new Error("llm-profile-update-failed");
    return result;
  },

  async remove(ownerId: string, id: string): Promise<boolean> {
    const existing = await readPublicProfile(ownerId, pathname(ownerId, id));
    if (!existing) return false;
    await deletePrivateObject(pathname(ownerId, id));
    return true;
  },

  summarize(profiles: LlmProfileRecord[]): LlmProfilePublic[] {
    return profiles.map(toPublic);
  },

  async clearActive(
    ownerId: string,
    profiles: Pick<LlmProfilePublic, "active" | "id">[],
    exceptId?: string,
  ): Promise<void> {
    await Promise.all(
      profiles
        .filter((profile) => profile.active && profile.id !== exceptId)
        .map(async (profile) => {
          await updatePrivateJson<PersistedLlmProfileRecord>(
            pathname(ownerId, profile.id),
            (stored) => {
              if (stored.ownerId !== ownerId) {
                throw new Error("llm-profile-owner-mismatch");
              }
              let row: StoredLlmProfileRecord;
              if (isCurrentStoredProfile(stored)) {
                row = stored;
              } else {
                const keyring = llmSecretKeyringFromEnv();
                row = sealLlmProfileRecord(
                  openLlmProfileRecord(stored, keyring).record,
                  keyring,
                );
              }
              return {
                ...row,
                active: false,
                updatedAt: new Date().toISOString(),
                version: row.version + 1,
              };
            },
          );
        }),
    );
  },
};

export function isLlmProfileStoreConfigured(): boolean {
  return (
    Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()) &&
    isLlmSecretEncryptionConfigured()
  );
}
