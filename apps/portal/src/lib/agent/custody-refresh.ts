export type CustodyRefreshAction = "none" | "refresh" | "reset";

type AuthIdentity = {
  authenticated: boolean;
  userId: string | null;
};

export function nextCustodyRefresh(
  currentOwnerId: string | null,
  auth: AuthIdentity,
): { ownerId: string | null; action: CustodyRefreshAction } {
  const ownerId = auth.authenticated
    ? (auth.userId ?? "authenticated-user")
    : null;

  if (ownerId === currentOwnerId) return { ownerId, action: "none" };
  return { ownerId, action: ownerId ? "refresh" : "reset" };
}
