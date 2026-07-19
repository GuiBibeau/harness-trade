// Side-chat client: a thin Svelte store + fetch transport (PRD #563, WP2).
//
// The store holds only user/assistant turns plus a coarse phase; the pure
// desk-context serializer (chat-context.ts) builds the payload and this
// module POSTs it to the same-origin /api/chat endpoint. Auth uses the Privy
// access token — the app's sole credential, which the edge layer reuses too
// (edge-data.ts), so it doubles as the edge tool token when present. State
// machine: push user turn → "waiting" → on reply push assistant turn +
// "idle"; on a null reply push a literal fallback + "idle"; 401 → "auth";
// 429 → "limit"; any other non-ok status or a network failure → "error".
// Never auto-retries. No transport test by design (anti-flake); the pure
// serializer is the unit-tested surface.

import { get, type Writable, writable } from "svelte/store";
import type { ChatMessage } from "./chat-core";
import { getPrivyAccessToken } from "./privy-auth";

const CHAT_OPEN_KEY = "harness.chat.v1";
const CHAT_ENDPOINT = "/api/chat";
const UNGROUNDED_FALLBACK = "I can't ground that answer in the data I have.";

export type ChatState = {
  open: boolean;
  phase: "idle" | "waiting" | "error" | "limit" | "auth";
  messages: ChatMessage[]; // user/assistant turns only
  error: string | null;
};

export const chatState: Writable<ChatState> = writable<ChatState>({
  open: readPersistedOpen(),
  phase: "idle",
  messages: [],
  error: null,
});

// Persist ONLY the open/closed flag, lazily and SSR-safe. Best-effort: a
// blocked quota / private mode is non-fatal — the store keeps working.
if (typeof localStorage !== "undefined") {
  chatState.subscribe((state) => {
    try {
      localStorage.setItem(CHAT_OPEN_KEY, state.open ? "1" : "0");
    } catch {
      // localStorage unavailable — persistence is best-effort.
    }
  });
}

export function toggleChat(): void {
  chatState.update((state) => ({ ...state, open: !state.open }));
}

export function closeChat(): void {
  chatState.update((state) => ({ ...state, open: false }));
}

/** POST /api/chat. Attaches Authorization from getPrivyAccessToken() and the
 * edge token when one resolves. See module header for the state machine. */
export async function sendChatMessage(
  text: string,
  context: Record<string, unknown>,
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  pushMessage({ role: "user", content: trimmed });
  setPhase("waiting");

  let token: string | null = null;
  try {
    token = await getPrivyAccessToken();
  } catch {
    // No usable credential (Privy unconfigured/unavailable) — same lane as 401.
    setPhase("auth");
    return;
  }

  let response: Response;
  try {
    response = await fetch(CHAT_ENDPOINT, {
      method: "POST",
      headers: buildHeaders(token),
      body: JSON.stringify(buildBody(token, get(chatState).messages, context)),
    });
  } catch (error) {
    setError(networkErrorMessage(error));
    return;
  }

  if (response.status === 401) {
    setPhase("auth");
    return;
  }
  if (response.status === 429) {
    setPhase("limit");
    return;
  }
  if (!response.ok) {
    setError(`chat-http-${response.status}`);
    return;
  }

  let payload: { reply?: string | null } = {};
  try {
    payload = (await response.json()) as { reply?: string | null };
  } catch {
    setError("chat-bad-response");
    return;
  }

  const reply = typeof payload.reply === "string" ? payload.reply.trim() : "";
  pushMessage({
    role: "assistant",
    content: reply.length > 0 ? reply : UNGROUNDED_FALLBACK,
  });
  setPhase("idle");
}

function pushMessage(message: ChatMessage): void {
  chatState.update((state) => ({
    ...state,
    messages: [...state.messages, message],
  }));
}

function setPhase(phase: ChatState["phase"]): void {
  chatState.update((state) => ({ ...state, phase, error: null }));
}

function setError(message: string): void {
  chatState.update((state) => ({ ...state, phase: "error", error: message }));
}

function buildHeaders(token: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

function buildBody(
  token: string | null,
  history: ChatMessage[],
  context: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { history, context };
  if (token) {
    body.edgeToken = token;
  }
  return body;
}

function networkErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "chat-network-error";
}

function readPersistedOpen(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(CHAT_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
