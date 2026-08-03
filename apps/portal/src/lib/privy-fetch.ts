import { getPrivyAccessToken, logoutPrivy, privyAuth } from "$lib/privy-auth";

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

function mergeAuthHeaders(
  init: FetchInit | undefined,
  token: string | null,
): HeadersInit {
  const headers = new Headers(init?.headers ?? undefined);
  if (token) headers.set("authorization", `Bearer ${token}`);
  else headers.delete("authorization");
  return headers;
}

/** Drop any mirrored access token so the next getPrivyAccessToken() is fresh. */
export function clearMirroredAccessToken(): void {
  privyAuth.update((state) =>
    state.accessToken === null ? state : { ...state, accessToken: null },
  );
}

/**
 * fetch() with Privy Bearer auth. On 401: clear mirrored token, refresh once,
 * retry. A second 401 forces logout so the UI must re-authenticate.
 */
export async function fetchWithPrivyAuth(
  input: FetchInput,
  init?: FetchInit,
): Promise<Response> {
  let token = await getPrivyAccessToken();
  let response = await fetch(input, {
    ...init,
    headers: mergeAuthHeaders(init, token),
  });
  if (response.status !== 401) return response;

  clearMirroredAccessToken();
  token = await getPrivyAccessToken();
  if (!token) {
    try {
      await logoutPrivy();
    } catch {
      // UI already sees unauthenticated.
    }
    return response;
  }

  response = await fetch(input, {
    ...init,
    headers: mergeAuthHeaders(init, token),
  });
  if (response.status === 401) {
    try {
      await logoutPrivy();
    } catch {
      // best-effort
    }
  }
  return response;
}
