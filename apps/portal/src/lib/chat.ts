// Side-chat client: a thin Svelte store + fetch transport (PRD #563, WP2).
// Agent mode (PRD #571/#539): ships agentMode + paused, receives action
// proposals, applies client-side policy, auto-runs when mode=auto.

import { get, type Writable, writable } from "svelte/store";
import { buildProposals } from "./agent/proposals";
import { runProposals } from "./agent/runtime";
import { getAgentPolicy, setProposals } from "./agent/state";
import type { ChatMessage } from "./chat-core";
import type { ChatModelChoice } from "./chat-models";
import { getPrivyAccessToken } from "./privy-auth";
import { fetchWithPrivyAuth } from "./privy-fetch";

const CHAT_OPEN_KEY = "harness.chat.v1";
const CHAT_ENDPOINT = "/api/chat";
const UNGROUNDED_FALLBACK = "I can't ground that answer in the data I have.";
const UNAVAILABLE_FALLBACK = "Desk model unavailable — try again in a moment.";
const PROVIDER_BALANCE_FALLBACK =
  "DeepSeek balance is empty (402). Top up at platform.deepseek.com, or set AI_GATEWAY_API_KEY on Vercel Preview as a fallback.";
const MISSING_KEY_FALLBACK =
  "Chat model key missing on this environment (DEEPSEEK_API_KEY / AI_GATEWAY_API_KEY).";
const NO_ACTION_FALLBACK =
  "No trade action was queued. Try: long SOL $50 @ 3x market.";

export type ChatUiMessage = ChatMessage & {
  model?: string;
  proLabel?: boolean;
};

export type ChatState = {
  open: boolean;
  phase: "idle" | "waiting" | "error" | "limit" | "auth";
  messages: ChatUiMessage[]; // user/assistant turns only
  error: string | null;
  modelChoice: ChatModelChoice;
  lastReplyModel: string | null;
  lastReplyProLabel: boolean;
};

type PersistedChatState = {
  open: boolean;
  modelChoice: ChatModelChoice;
};

const persisted = readPersistedChatState();

export const chatState: Writable<ChatState> = writable<ChatState>({
  open: persisted.open,
  phase: "idle",
  messages: [],
  error: null,
  modelChoice: persisted.modelChoice,
  lastReplyModel: null,
  lastReplyProLabel: false,
});

// Persist ONLY the open/closed flag and model choice, lazily and SSR-safe.
// Best-effort: a blocked quota / private mode is non-fatal — the store keeps
// working. Legacy "1"/"0" payloads remain readable.
if (typeof localStorage !== "undefined") {
  chatState.subscribe((state) => {
    try {
      localStorage.setItem(
        CHAT_OPEN_KEY,
        JSON.stringify({ open: state.open, modelChoice: state.modelChoice }),
      );
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

export function setModelChoice(modelChoice: ChatModelChoice): void {
  chatState.update((state) => ({ ...state, modelChoice }));
}

export type SendChatOptions = {
  /** live | paper — for ledger + auto-run path */
  accountMode?: "live" | "paper";
};

/** POST /api/chat. Attaches Authorization from Privy (refresh-once on 401).
 * Edge tool calls on the server use that same verified Bearer — no dual
 * body edgeToken credential. */
export async function sendChatMessage(
  text: string,
  context: Record<string, unknown>,
  options: SendChatOptions = {},
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;

  pushMessage({ role: "user", content: trimmed });
  setPhase("waiting");

  try {
    await getPrivyAccessToken();
  } catch {
    // No usable credential (Privy unconfigured/unavailable) — same lane as 401.
    setPhase("auth");
    return;
  }

  let response: Response;
  try {
    const state = get(chatState);
    const policy = getAgentPolicy();
    response = await fetchWithPrivyAuth(CHAT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        buildBody(
          state.messages,
          context,
          state.modelChoice,
          policy.mode,
          policy.paused,
        ),
      ),
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

  let payload: {
    reply?: string | null;
    reason?: unknown;
    model?: unknown;
    proLabel?: unknown;
    actions?: unknown;
  } = {};
  try {
    payload = (await response.json()) as {
      reply?: string | null;
      reason?: unknown;
      model?: unknown;
      proLabel?: unknown;
      actions?: unknown;
    };
  } catch {
    setError("chat-bad-response");
    return;
  }

  const reply = typeof payload.reply === "string" ? payload.reply.trim() : "";
  const reason = typeof payload.reason === "string" ? payload.reason : "";
  const model = typeof payload.model === "string" ? payload.model : null;
  const proLabel = payload.proLabel === true;
  const fallback =
    reason === "provider-balance"
      ? PROVIDER_BALANCE_FALLBACK
      : reason === "missing-key"
        ? MISSING_KEY_FALLBACK
        : reason === "unavailable"
          ? UNAVAILABLE_FALLBACK
          : reason === "no-action"
            ? NO_ACTION_FALLBACK
            : UNGROUNDED_FALLBACK;
  pushMessage({
    role: "assistant",
    content: reply.length > 0 ? reply : fallback,
    ...(model ? { model } : {}),
    proLabel,
  });
  recordReplyMetadata(model, proLabel);

  const rawActions = parseQueuedActions(payload.actions);
  if (rawActions.length > 0) {
    const policy = getAgentPolicy();
    const proposals = buildProposals(rawActions, policy);
    setProposals(proposals);
    const accountMode = options.accountMode ?? "paper";
    // Auto-run allow-verdict items (full auto-approve + free nav).
    void runProposals(proposals, { accountMode, autoOnly: true });
  }

  setPhase("idle");
}

function parseQueuedActions(
  value: unknown,
): { id: string; name: string; argumentsJson: string }[] {
  if (!Array.isArray(value)) return [];
  const out: { id: string; name: string; argumentsJson: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || typeof row.name !== "string") continue;
    const argumentsJson =
      typeof row.arguments === "string"
        ? row.arguments
        : JSON.stringify(row.arguments ?? {});
    out.push({ id: row.id, name: row.name, argumentsJson });
  }
  return out;
}

function pushMessage(message: ChatUiMessage): void {
  chatState.update((state) => ({
    ...state,
    messages: [...state.messages, message],
  }));
}

function recordReplyMetadata(model: string | null, proLabel: boolean): void {
  chatState.update((state) => ({
    ...state,
    lastReplyModel: model,
    lastReplyProLabel: proLabel,
  }));
}

function setPhase(phase: ChatState["phase"]): void {
  chatState.update((state) => ({ ...state, phase, error: null }));
}

function setError(message: string): void {
  chatState.update((state) => ({ ...state, phase: "error", error: message }));
}

function buildBody(
  history: ChatUiMessage[],
  context: Record<string, unknown>,
  modelChoice: ChatModelChoice,
  agentMode: string,
  paused: boolean,
): Record<string, unknown> {
  return {
    history: history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    context,
    modelChoice,
    agentMode,
    paused,
  };
}

function networkErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "chat-network-error";
}

function readPersistedChatState(): PersistedChatState {
  const fallback: PersistedChatState = { open: false, modelChoice: "auto" };
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(CHAT_OPEN_KEY);
    if (raw === "1") return { ...fallback, open: true };
    if (raw === "0" || raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) return fallback;
    return {
      open: typeof parsed.open === "boolean" ? parsed.open : fallback.open,
      modelChoice: isChatModelChoice(parsed.modelChoice)
        ? parsed.modelChoice
        : fallback.modelChoice,
    };
  } catch {
    return fallback;
  }
}

function isChatModelChoice(value: unknown): value is ChatModelChoice {
  return value === "auto" || value === "free" || value === "pro";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
