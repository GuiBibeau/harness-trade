import type { AgentThreadStorage } from "./thread-cache";

export type AgentStorageScope = {
  ownerId: string;
  accountMode: "paper" | "live";
};

export function scopeAgentStorage(
  storage: AgentThreadStorage,
  scope: AgentStorageScope,
): AgentThreadStorage {
  const prefix = `harness.agent.${encodeURIComponent(scope.ownerId)}.${scope.accountMode}.`;
  return {
    getItem: (key) => {
      const scopedKey = `${prefix}${key}`;
      const scopedValue = storage.getItem(scopedKey);
      if (scopedValue !== null) return scopedValue;

      if (scope.accountMode !== "paper") return null;
      const legacyValue = storage.getItem(key);
      if (legacyValue === null) return null;
      storage.setItem(scopedKey, legacyValue);
      storage.removeItem(key);
      return legacyValue;
    },
    setItem: (key, value) => storage.setItem(`${prefix}${key}`, value),
    removeItem: (key) => storage.removeItem(`${prefix}${key}`),
  };
}
