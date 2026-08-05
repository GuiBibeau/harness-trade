import {
  Client,
  type HandleMessageStreamEvent,
  isCurrentTurnBoundaryEvent,
  type SendTurnPayload,
  type SessionState,
} from "eve/client";
import {
  type EveDynamicToolPart,
  type EveMessagePart,
  useEveAgent,
} from "eve/svelte";
import { onDestroy, onMount } from "svelte";
import { AGENT_ACTION_META, type AgentActionName } from "./actions";
import {
  activateAgentConversation,
  activeAgentConversation,
  addAgentConversation,
  archiveAgentConversation as archiveHistoryConversation,
  createAgentConversationRecord,
  initializeAgentConversationHistory,
  restoreAgentConversation as restoreHistoryConversation,
  saveAgentConversationHistory,
  summarizeAgentConversations,
  titleFromMessage,
  updateAgentConversation,
} from "./conversation-history";
import type { AgentActionExecutor } from "./host";
import {
  type AgentPaperActionReceipt,
  type AgentThreadSnapshot,
  type AgentThreadStorage,
  prepareAgentThreadForResume,
} from "./thread-cache";
import {
  createTurnCancellation,
  type TurnCancellationSnapshot,
} from "./turn-cancellation";

export type AgentConversationOptions = {
  buildClientContext: () => AgentClientContext;
  executePaperAction: AgentActionExecutor;
  headers: () => Promise<Record<string, string>>;
  isPaper: () => boolean;
  storage?: AgentThreadStorage;
};

export type AgentClientContext = NonNullable<SendTurnPayload["clientContext"]>;

export type AgentConversationPart =
  | {
      type: "text";
      text: string;
    }
  | AgentConversationToolPart;

export type AgentConversationToolPart = {
  type: "tool";
  toolCallId: string;
  toolName: string;
  state: string;
  input: unknown;
  output: unknown;
  errorText?: string;
  approvalPending: boolean;
};

export type AgentConversationMessage = {
  role: string;
  parts: AgentConversationPart[];
};

/**
 * Owns the browser side of one durable agent Conversation.
 *
 * Views render its projection and issue commands. EVE transport, cursor
 * recovery, persistence, approval replies, and replay-safe paper Receipts stay
 * behind this interface.
 */
export function createAgentConversation(options: AgentConversationOptions) {
  let history = options.storage
    ? initializeAgentConversationHistory(options.storage)
    : null;
  const initialConversation = history ? activeAgentConversation(history) : null;
  const restoredThread = initialConversation
    ? prepareAgentThreadForResume(initialConversation.thread)
    : null;
  let activeConversationId = $state(initialConversation?.id ?? "");
  let conversationTitle = $state(
    initialConversation?.title ?? "New conversation",
  );
  let conversations = $state(
    history ? summarizeAgentConversations(history) : [],
  );
  let paperActionReceipts = $state<Record<string, AgentPaperActionReceipt>>({
    ...(restoredThread?.paperActionReceipts ?? {}),
  });
  let answeredToolCallIds = $state<Record<string, true>>(
    Object.fromEntries(
      (restoredThread?.answeredToolCallIds ?? []).map((callId) => [callId, true]),
    ),
  );
  const paperActionRuns = new Set<string>(
    restoredThread?.paperActionRuns ??
      Object.keys(restoredThread?.paperActionReceipts ?? {}),
  );
  let reconnecting = $state(isSessionState(restoredThread?.session));
  let recoveryError = $state("");
  let cancellation = $state<TurnCancellationSnapshot>({ state: "idle" });
  let turnCancellation!: ReturnType<typeof createTurnCancellation>;
  let eve = $state.raw(createAgent(restoredThread));
  let recoveryController: AbortController | null = null;
  let persistTimer: ReturnType<typeof setTimeout> | null = null;

  const working = $derived(
    eve.status === "submitted" || eve.status === "streaming",
  );
  const busy = $derived(reconnecting || recoveryError.length > 0 || working);
  const messages = $derived(
    eve.data.messages.map((message) =>
      projectConversationMessage(message, answeredToolCallIds),
    ),
  );
  const pendingRequestCount = $derived(
    messages.reduce(
      (count, message) =>
        count +
        message.parts.filter(
          (part) => part.type === "tool" && part.approvalPending,
        ).length,
      0,
    ),
  );

  $effect(() => {
    if (!options.storage) return;
    void eve.session;
    void eve.events.length;
    void paperActionReceipts;
    schedulePersist();
  });

  $effect(() => {
    if (!options.storage || !options.isPaper()) return;
    const parts = eve.data.messages.flatMap((message) =>
      message.parts.filter(isDynamicToolPart),
    );
    for (const part of parts) {
      const action = paperActionFromPart(part);
      if (!action || paperActionRuns.has(part.toolCallId)) continue;
      paperActionRuns.add(part.toolCallId);
      persistCurrent();
      void options
        .executePaperAction(action.name, action.args)
        .then((receipt) => {
          paperActionReceipts = {
            ...paperActionReceipts,
            [part.toolCallId]: receipt,
          };
          persistCurrent();
        });
    }
  });

  onMount(() => {
    if (!reconnecting || !restoredThread) return;
    beginRecovery(restoredThread);
    return () => recoveryController?.abort();
  });

  onDestroy(() => {
    recoveryController?.abort();
    persistCurrent();
    eve.stop();
  });

  function createAgent(thread: AgentThreadSnapshot | null) {
    const session = new Client({
      host: "",
      headers: options.headers,
      preserveCompletedSessions: true,
    }).session(isSessionState(thread?.session) ? thread.session : undefined);
    const cancellationControl = createTurnCancellation({
      cancel: (turnId) => session.cancel({ turnId }),
      onChange: (snapshot) => {
        cancellation = snapshot;
      },
    });
    turnCancellation = cancellationControl;
    return useEveAgent({
      session,
      initialEvents: thread?.events as never,
      onEvent(event) {
        cancellationControl.observe(event);
      },
      onFinish(snapshot) {
        cancellationControl.reset();
        cancelScheduledPersistence();
        persistSnapshot(snapshot.session, snapshot.events);
      },
    });
  }

  async function recover(
    thread: AgentThreadSnapshot,
    signal: AbortSignal,
  ): Promise<void> {
    if (!isSessionState(thread.session)) {
      reconnecting = false;
      return;
    }

    const session = new Client({ host: "", headers: options.headers }).session(
      thread.session,
    );
    const recoveredEvents: HandleMessageStreamEvent[] = [];

    try {
      for await (const event of session.stream({ follow: false, signal })) {
        recoveredEvents.push(event);
      }

      const lastKnownEvent =
        recoveredEvents.at(-1) ??
        (thread.events.at(-1) as HandleMessageStreamEvent | undefined);
      if (
        session.state.sessionId &&
        (!lastKnownEvent || !isCurrentTurnBoundaryEvent(lastKnownEvent))
      ) {
        for await (const event of session.stream({ signal })) {
          recoveredEvents.push(event);
          if (isCurrentTurnBoundaryEvent(event)) break;
        }
      }

      if (signal.aborted) return;
      const recoveredThread = prepareAgentThreadForResume({
        ...thread,
        session: session.state,
        events: [...thread.events, ...recoveredEvents],
      });
      persistSnapshot(recoveredThread.session, recoveredThread.events);
      eve.stop();
      eve = createAgent(recoveredThread);
      reconnecting = false;
    } catch (error) {
      if (signal.aborted) return;
      recoveryError =
        error instanceof Error ? error.message : "conversation-recovery-error";
      reconnecting = false;
    }
  }

  function persistSnapshot(session: unknown, events: readonly unknown[]): void {
    if (!options.storage || !history || !activeConversationId) return;
    try {
      history = updateAgentConversation(history, activeConversationId, {
        title: conversationTitle,
        thread: {
          session,
          events,
          answeredToolCallIds: Object.keys(answeredToolCallIds),
          paperActionRuns: [...paperActionRuns],
          paperActionReceipts,
        },
      });
      saveAgentConversationHistory(options.storage, history);
      refreshConversationSummaries();
    } catch {
      // A private browser or exhausted quota should not break the Conversation.
    }
  }

  function persistCurrent(): void {
    cancelScheduledPersistence();
    persistSnapshot(eve.session, eve.events);
  }

  function schedulePersist(): void {
    if (persistTimer !== null) return;
    persistTimer = setTimeout(() => {
      persistTimer = null;
      persistSnapshot(eve.session, eve.events);
    }, 150);
  }

  function cancelScheduledPersistence(): void {
    if (persistTimer === null) return;
    clearTimeout(persistTimer);
    persistTimer = null;
  }

  function send(message: string): Promise<void> {
    turnCancellation.reset();
    const hasUserMessage = eve.data.messages.some(
      (conversationMessage) => conversationMessage.role === "user",
    );
    if (!hasUserMessage) {
      conversationTitle = titleFromMessage(message);
      persistCurrent();
    }
    return eve.send({
      message,
      clientContext: options.buildClientContext(),
    });
  }

  function respond(requestId: string, approved: boolean): Promise<void> {
    // An input response resumes the parked durable turn. Keep its observed
    // turn id so Stop can still cancel the resumed execution.
    turnCancellation.resume();
    return eve.send({
      inputResponses: [{ requestId, optionId: approved ? "approve" : "deny" }],
    });
  }

  async function respondToTool(
    toolCallId: string,
    approved: boolean,
  ): Promise<void> {
    const requestId = eve.data.messages
      .flatMap((message) => message.parts.filter(isDynamicToolPart))
      .find((part) => part.toolCallId === toolCallId)?.toolMetadata?.eve
      ?.inputRequest?.requestId;
    if (!requestId || answeredToolCallIds[toolCallId]) return;
    answeredToolCallIds = { ...answeredToolCallIds, [toolCallId]: true };
    persistCurrent();
    try {
      await respond(requestId, approved);
    } catch (error) {
      const nextAnswered = { ...answeredToolCallIds };
      delete nextAnswered[toolCallId];
      answeredToolCallIds = nextAnswered;
      persistCurrent();
      throw error;
    }
  }

  function newConversation(): void {
    persistCurrent();
    recoveryController?.abort();
    eve.stop();
    const record = createAgentConversationRecord();
    if (history && options.storage) {
      history = addAgentConversation(history, record);
      saveAgentConversationHistory(options.storage, history);
    }
    mountConversation(record);
  }

  function resumeConversation(id: string): void {
    if (!history || id === activeConversationId) return;
    persistCurrent();
    const record = history.conversations.find(
      (conversation) => conversation.id === id && !conversation.archivedAt,
    );
    if (!record) return;
    history = activateAgentConversation(history, id);
    if (options.storage) saveAgentConversationHistory(options.storage, history);
    mountConversation(record);
  }

  function archiveConversation(id: string): void {
    if (!history || !options.storage) return;
    persistCurrent();
    history = archiveHistoryConversation(history, id);
    saveAgentConversationHistory(options.storage, history);
    if (id !== activeConversationId) {
      refreshConversationSummaries();
      return;
    }
    const next = [...history.conversations]
      .filter((conversation) => !conversation.archivedAt)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (next) {
      history = activateAgentConversation(history, next.id);
      saveAgentConversationHistory(options.storage, history);
      mountConversation(next);
      return;
    }
    newConversation();
  }

  function restoreConversation(id: string): void {
    if (!history || !options.storage) return;
    persistCurrent();
    history = restoreHistoryConversation(history, id);
    const record = history.conversations.find(
      (conversation) => conversation.id === id,
    );
    if (!record) return;
    saveAgentConversationHistory(options.storage, history);
    mountConversation(record);
  }

  function mountConversation(record: {
    id: string;
    title: string;
    thread: AgentThreadSnapshot;
  }): void {
    recoveryController?.abort();
    eve.stop();
    const prepared = prepareAgentThreadForResume(record.thread);
    activeConversationId = record.id;
    conversationTitle = record.title;
    paperActionReceipts = { ...(prepared.paperActionReceipts ?? {}) };
    answeredToolCallIds = Object.fromEntries(
      (prepared.answeredToolCallIds ?? []).map((callId) => [callId, true]),
    );
    paperActionRuns.clear();
    for (const callId of prepared.paperActionRuns ?? []) {
      paperActionRuns.add(callId);
    }
    recoveryError = "";
    reconnecting = isSessionState(prepared.session);
    eve = createAgent(prepared);
    refreshConversationSummaries();
    if (reconnecting) beginRecovery(prepared);
  }

  function beginRecovery(thread: AgentThreadSnapshot): void {
    recoveryController?.abort();
    recoveryController = new AbortController();
    void recover(thread, recoveryController.signal);
  }

  function refreshConversationSummaries(): void {
    conversations = history ? summarizeAgentConversations(history) : [];
  }

  return {
    get busy() {
      return busy;
    },
    get activeConversationId() {
      return activeConversationId;
    },
    get conversations() {
      return conversations;
    },
    get conversationTitle() {
      return conversationTitle;
    },
    get cancellationError() {
      return cancellation.error ?? "";
    },
    get cancellationState() {
      return cancellation.state;
    },
    get error() {
      return eve.error;
    },
    get messages() {
      return messages;
    },
    get pendingRequestCount() {
      return pendingRequestCount;
    },
    get reconnecting() {
      return reconnecting;
    },
    get recoveryError() {
      return recoveryError;
    },
    get status() {
      return eve.status;
    },
    get working() {
      return working;
    },
    paperReceipt(toolCallId: string) {
      return paperActionReceipts[toolCallId];
    },
    archiveConversation,
    cancel() {
      if (!working) return;
      turnCancellation.request();
    },
    newConversation,
    persist: persistCurrent,
    restoreConversation,
    resumeConversation,
    respondToTool,
    send,
  };
}

function projectConversationMessage(
  message: {
    role: string;
    parts: readonly EveMessagePart[];
  },
  answeredToolCallIds: Readonly<Record<string, true>>,
): AgentConversationMessage {
  return {
    role: message.role,
    parts: message.parts.flatMap((part) =>
      projectConversationPart(part, answeredToolCallIds),
    ),
  };
}

function projectConversationPart(
  part: EveMessagePart,
  answeredToolCallIds: Readonly<Record<string, true>>,
): AgentConversationPart[] {
  if (part.type === "text") {
    return [{ type: "text", text: part.text }];
  }
  if (!isDynamicToolPart(part)) return [];
  return [
    {
      type: "tool",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      state: part.state,
      input: part.input,
      output: part.output,
      ...(part.errorText ? { errorText: part.errorText } : {}),
      approvalPending:
        Boolean(part.toolMetadata?.eve?.inputRequest) &&
        !answeredToolCallIds[part.toolCallId],
    },
  ];
}

function isDynamicToolPart(part: EveMessagePart): part is EveDynamicToolPart {
  return part.type === "dynamic-tool";
}

function paperActionFromPart(
  part: EveDynamicToolPart,
): { name: AgentActionName; args: Record<string, unknown> } | null {
  if (part.state !== "output-available") return null;
  const output = asRecord(part.output);
  const action = asRecord(output?.paperAction);
  const name = action?.name;
  const args = asRecord(action?.args);
  if (
    typeof name !== "string" ||
    !AGENT_ACTION_META.some((entry) => entry.name === name) ||
    !args
  ) {
    return null;
  }
  return { name: name as AgentActionName, args };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isSessionState(value: unknown): value is SessionState {
  return (
    typeof value === "object" &&
    value !== null &&
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    "streamIndex" in value &&
    typeof value.streamIndex === "number"
  );
}
