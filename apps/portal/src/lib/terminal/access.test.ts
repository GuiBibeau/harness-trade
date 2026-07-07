import { describe, expect, test } from "bun:test";
import { hasRequestedPerpAccess, recordPerpAccessRequest } from "./access";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

// Map-backed fake so tests never touch the real localStorage. The access
// module persists under its versioned key; seeding raw values there
// exercises the corrupt/non-array branches without leaking through to
// other tests.
const ACCESS_KEY = "trader-ralph-terminal/perp-access/v1";

function fakeStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
  };
}

describe("hasRequestedPerpAccess / recordPerpAccessRequest", () => {
  test("null wallet: not requested, record is a no-throw no-op", () => {
    const storage = fakeStorage();
    expect(hasRequestedPerpAccess(null, storage)).toBe(false);
    expect(() => recordPerpAccessRequest(null, storage)).not.toThrow();
    expect(storage.getItem(ACCESS_KEY)).toBeNull();
  });

  test("unknown wallet has not requested access", () => {
    const storage = fakeStorage();
    expect(hasRequestedPerpAccess("WALLET_A", storage)).toBe(false);
  });

  test("record then has is true", () => {
    const storage = fakeStorage();
    recordPerpAccessRequest("WALLET_A", storage);
    expect(hasRequestedPerpAccess("WALLET_A", storage)).toBe(true);
  });

  test("two wallets are independent", () => {
    const storage = fakeStorage();
    recordPerpAccessRequest("WALLET_A", storage);
    expect(hasRequestedPerpAccess("WALLET_A", storage)).toBe(true);
    expect(hasRequestedPerpAccess("WALLET_B", storage)).toBe(false);
    recordPerpAccessRequest("WALLET_B", storage);
    expect(hasRequestedPerpAccess("WALLET_B", storage)).toBe(true);
    expect(hasRequestedPerpAccess("WALLET_A", storage)).toBe(true);
  });
});

describe("corrupt storage", () => {
  test("corrupted JSON reads as not requested (no throw)", () => {
    const storage = fakeStorage();
    storage.setItem(ACCESS_KEY, "{not json");
    expect(() => hasRequestedPerpAccess("WALLET_A", storage)).not.toThrow();
    expect(hasRequestedPerpAccess("WALLET_A", storage)).toBe(false);
  });

  test("non-array JSON reads as not requested", () => {
    const storage = fakeStorage();
    storage.setItem(ACCESS_KEY, '"WALLET_A"');
    expect(hasRequestedPerpAccess("WALLET_A", storage)).toBe(false);
  });
});
