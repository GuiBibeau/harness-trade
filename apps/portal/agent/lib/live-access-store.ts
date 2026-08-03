import { createHash } from "node:crypto";
import { ownerPartition, readPrivateJson, writePrivateJson } from "./blob-json";

const ROOT = "agent-state/v1/live-access";

export type LiveAccessRecord = {
  ownerId: string;
  enabled: boolean;
  updatedAt: string;
  version: number;
  /** Agent wallet address the user acknowledged when enabling live. */
  ackedAgentWallet?: string;
};

function pathname(ownerId: string): string {
  return `${ROOT}/${ownerPartition(ownerId)}.json`;
}

export function isLiveAccessStoreConfigured(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/**
 * Live agent execution is denied unless the owner has explicitly enabled it.
 * Unconfigured vault → not enabled (fail closed to paper).
 */
export async function isLiveAgentEnabled(ownerId: string): Promise<boolean> {
  if (!ownerId.trim() || !isLiveAccessStoreConfigured()) return false;
  try {
    const stored = await readPrivateJson<LiveAccessRecord>(pathname(ownerId));
    if (!stored || stored.value.ownerId !== ownerId) return false;
    return stored.value.enabled === true;
  } catch {
    return false;
  }
}

export async function setLiveAgentEnabled(
  ownerId: string,
  enabled: boolean,
  options: { ackedAgentWallet?: string } = {},
): Promise<LiveAccessRecord> {
  if (!ownerId.trim()) throw new Error("live-access-owner-invalid");
  if (!isLiveAccessStoreConfigured()) {
    throw new Error("live-access-store-unconfigured");
  }
  const existing = await readPrivateJson<LiveAccessRecord>(pathname(ownerId));
  const now = new Date().toISOString();
  const record: LiveAccessRecord = {
    ownerId,
    enabled,
    updatedAt: now,
    version: (existing?.value.version ?? 0) + 1,
    ...(enabled && options.ackedAgentWallet
      ? { ackedAgentWallet: options.ackedAgentWallet }
      : existing?.value.ackedAgentWallet
        ? { ackedAgentWallet: existing.value.ackedAgentWallet }
        : {}),
  };
  if (!enabled) {
    delete record.ackedAgentWallet;
  }
  await writePrivateJson(pathname(ownerId), record);
  return record;
}

/** Deterministic id for tests — not a secret. */
export function liveAccessPathForOwner(ownerId: string): string {
  return pathname(ownerId);
}

export function liveAccessOwnerHash(ownerId: string): string {
  return createHash("sha256").update(ownerId).digest("hex").slice(0, 32);
}
