import { describe, expect, test } from "bun:test";
import { nextCustodyRefresh } from "./custody-refresh";

describe("custody refresh transitions", () => {
  test("refreshes once when repeated Privy store emissions keep the same user", () => {
    const first = nextCustodyRefresh(null, {
      authenticated: true,
      userId: "did:privy:alice",
    });
    expect(first).toEqual({ ownerId: "did:privy:alice", action: "refresh" });

    expect(
      nextCustodyRefresh(first.ownerId, {
        authenticated: true,
        userId: "did:privy:alice",
      }),
    ).toEqual({ ownerId: "did:privy:alice", action: "none" });
  });

  test("resets on logout and refreshes for a different user", () => {
    const loggedOut = nextCustodyRefresh("did:privy:alice", {
      authenticated: false,
      userId: null,
    });
    expect(loggedOut).toEqual({ ownerId: null, action: "reset" });

    expect(
      nextCustodyRefresh("did:privy:alice", {
        authenticated: true,
        userId: "did:privy:bob",
      }),
    ).toEqual({ ownerId: "did:privy:bob", action: "refresh" });
  });
});
