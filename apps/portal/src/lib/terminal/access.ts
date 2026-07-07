// Perp soft gate access request log (PRD #493 / #498). One entry per
// wallet that has clicked "Request perp access", stored locally like the
// trade-ack key. storage is injectable so tests never touch the real
// localStorage.

const ACCESS_KEY = "trader-ralph-terminal/perp-access/v1";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function readRequested(storage: StorageLike): string[] {
  try {
    const raw = storage.getItem(ACCESS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

export function hasRequestedPerpAccess(
  wallet: string | null,
  storage?: StorageLike,
): boolean {
  if (!wallet) return false;
  const store =
    storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return false;
  return readRequested(store).includes(wallet);
}

export function recordPerpAccessRequest(
  wallet: string | null,
  storage?: StorageLike,
): void {
  if (!wallet) return;
  const store =
    storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!store) return;
  try {
    const requested = new Set(readRequested(store));
    requested.add(wallet);
    store.setItem(ACCESS_KEY, JSON.stringify([...requested]));
  } catch {
    /* storage unavailable: request lasts the session via caller state */
  }
}
