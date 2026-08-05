<script lang="ts">
  import { tick } from "svelte";
  import { closeChat } from "$lib/chat";
  import { parseAgentCommand } from "$lib/agent/commands";
  import {
    type AgentClientContext,
    type AgentConversationPart,
    type AgentConversationToolPart,
    createAgentConversation,
  } from "$lib/agent/conversation.svelte";
  import type { AgentThreadStorage } from "$lib/agent/thread-cache";
  import { AGENT_MODE_LABEL, type AgentMode } from "$lib/agent/modes";
  import {
    type AgentActionExecutor,
    executeAgentAction,
  } from "$lib/agent/host";
  import {
    agentState,
    getAgentPolicy,
    setAgentMode,
    setAgentPaused,
  } from "$lib/agent/state";
  import {
    projectHarnessTool,
    settleIdleActivity,
    type WorkstreamCard,
  } from "$lib/agent/workstream";
  import { getPrivyAccessToken, privyAuth } from "$lib/privy-auth";
  import { llmProfileHeaderValue } from "$lib/agent/llm-profile-selection";
  import { projectPriceQuote } from "$lib/agent/price-presentation";
  import type { AgentRunStatus } from "$lib/agent/run-visibility";
  import { isNearAgentTail } from "$lib/agent/scroll-policy";
  import {
    fetchAgentSkills,
    type SkillListItem,
  } from "$lib/agent/skills-api";
  import {
    filterMentionedSkills,
    findSkillMention,
    insertSkillMention,
  } from "$lib/agent/skill-mentions";
  import AgentSkillPalette from "./AgentSkillPalette.svelte";
  import MarkdownMessage from "./MarkdownMessage.svelte";
  import PriceQuoteCard from "./PriceQuoteCard.svelte";
  import ToolActivity from "./ToolActivity.svelte";

  let {
    buildContext,
    onRequestAuth,
    accountMode = "paper",
    layout = "dock",
    focusComposerRequest = 0,
    executePaperAction = executeAgentAction,
    onExpand = undefined,
    onCollapse = undefined,
    onClose = undefined,
    onRunStateChange = undefined,
    storage,
  }: {
    buildContext: () => Record<string, unknown>;
    onRequestAuth: () => void;
    accountMode?: "live" | "paper";
    layout?: "dock" | "page";
    focusComposerRequest?: number;
    executePaperAction?: AgentActionExecutor;
    onExpand?: () => void;
    onCollapse?: () => void;
    onClose?: () => void;
    onRunStateChange?: (status: AgentRunStatus) => void;
    storage: AgentThreadStorage;
  } = $props();

  let draft = $state("");
  let scrollEl: HTMLDivElement | null = $state(null);
  let inputEl: HTMLTextAreaElement | null = $state(null);
  let settingsOpen = $state(false);
  let SettingsModal = $state.raw<
    typeof import("./AgentSettingsModal.svelte").default | null
  >(null);
  let settingsSection = $state<"models" | "skills">("models");
  let historyOpen = $state(false);
  let ConversationHistory = $state.raw<
    typeof import("./AgentConversationHistory.svelte").default | null
  >(null);
  let availableSkills = $state<SkillListItem[]>([]);
  let skillsLoading = $state(false);
  let skillsLoadedAt = 0;
  let skillLoadError = $state<string | null>(null);
  let skillPaletteOpen = $state(false);
  let skillQuery = $state("");
  let skillMentionStart = $state(-1);
  let skillPaletteIndex = $state(0);
  let stickToTail = $state(true);
  let showJumpToLatest = $state(false);
  let handledFocusComposerRequest = 0;
  const agentModes: AgentMode[] = ["observe", "ask", "auto"];
  // AgentSurface remounts the workspace when its owner/account storage scope changes.
  // svelte-ignore state_referenced_locally
  const conversation = createAgentConversation({
    buildClientContext,
    executePaperAction: (name, args) => executePaperAction(name, args),
    headers: resolveConversationHeaders,
    isPaper: () => accountMode === "paper",
    storage,
  });

  async function resolveConversationHeaders(): Promise<Record<string, string>> {
    const token = await getPrivyAccessToken();
    const policy = getAgentPolicy();
    const llmProfile = llmProfileHeaderValue();
    return {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "x-harness-agent-mode": policy.mode,
      "x-harness-agent-paused": String(policy.paused),
      "x-harness-account-mode": accountMode,
      ...(llmProfile ? { "x-harness-llm-profile": llmProfile } : {}),
    };
  }

  function buildClientContext(): AgentClientContext {
    const policy = getAgentPolicy();
    return {
      ...buildContext(),
      agentPolicy: {
        mode: policy.mode,
        paused: policy.paused,
        accountMode,
      },
    } as AgentClientContext;
  }

  const agentWorking = $derived(conversation.working);
  const busy = $derived(conversation.busy);
  const hasActiveTool = $derived(
    conversation.messages
      .flatMap((message) => message.parts.filter(isToolPart))
      .some((part) =>
        ["pending", "running", "waiting"].includes(projectPart(part).status),
      ),
  );
  const runLabel = $derived(
    conversation.reconnecting
      ? "Reconnecting"
      : conversation.cancellationState === "requested" ||
          conversation.cancellationState === "cancelling"
        ? "Stopping"
        : conversation.working
          ? "Working"
          : conversation.status === "error"
            ? "Needs attention"
            : "Ready",
  );
  $effect(() => {
    const stopping =
      conversation.cancellationState === "requested" ||
      conversation.cancellationState === "cancelling";
    onRunStateChange?.({
      active: conversation.working || conversation.reconnecting || stopping,
      canCancel: conversation.working && !stopping,
      label: runLabel,
      stopping,
      cancel: () => conversation.cancel(),
    });
  });
  const pendingApprovalItems = $derived.by(() =>
    conversation.messages.flatMap((message) =>
      message.parts
        .filter(isToolPart)
        .filter((part) => part.approvalPending)
        .map((part) => ({
          id: part.toolCallId,
          toolName: part.toolName,
          card: projectPart(part),
          approvalPending: true,
        })),
    ),
  );
  const matchingSkills = $derived(
    filterMentionedSkills(availableSkills, skillQuery),
  );

  $effect(() => {
    if (!scrollEl) return;
    void conversation.messages.length;
    void conversation.status;
    if (stickToTail) void scrollToLatest();
    else showJumpToLatest = true;
  });

  $effect(() => {
    if (
      focusComposerRequest <= handledFocusComposerRequest ||
      !inputEl ||
      !$privyAuth.authenticated ||
      busy
    ) {
      return;
    }
    handledFocusComposerRequest = focusComposerRequest;
    inputEl.focus();
  });

  $effect(() => {
    if (skillPaletteIndex >= matchingSkills.length) {
      skillPaletteIndex = Math.max(0, matchingSkills.length - 1);
    }
  });

  async function loadSkills(): Promise<void> {
    if (
      skillsLoading ||
      !$privyAuth.authenticated ||
      (skillsLoadedAt > 0 && Date.now() - skillsLoadedAt < 5 * 60_000)
    ) {
      return;
    }
    skillsLoading = true;
    skillLoadError = null;
    try {
      const data = await fetchAgentSkills();
      availableSkills = [
        ...data.builtins,
        ...data.userSkills.filter((skill) => skill.enabled),
      ];
      skillsLoadedAt = Date.now();
    } catch {
      availableSkills = [];
      skillsLoadedAt = Date.now();
      skillLoadError = "Skills are unavailable. Open Agent settings to retry.";
    } finally {
      skillsLoading = false;
    }
  }

  function updateSkillMention(value: string, cursor: number): void {
    const mention = findSkillMention(value, cursor);
    if (!mention) {
      closeSkillPalette();
      return;
    }
    skillMentionStart = mention.start;
    skillQuery = mention.query;
    skillPaletteIndex = 0;
    skillPaletteOpen = true;
    void loadSkills();
  }

  function onComposerInput(event: Event): void {
    const textarea = event.currentTarget as HTMLTextAreaElement;
    updateSkillMention(textarea.value, textarea.selectionStart);
  }

  function closeSkillPalette(): void {
    skillPaletteOpen = false;
    skillQuery = "";
    skillMentionStart = -1;
    skillPaletteIndex = 0;
  }

  function selectSkill(skill: SkillListItem): void {
    if (!inputEl || skillMentionStart < 0) return;
    const cursor = inputEl.selectionStart;
    const insertion = insertSkillMention(
      draft,
      { start: skillMentionStart, query: skillQuery },
      cursor,
      skill.name,
    );
    draft = insertion.value;
    closeSkillPalette();
    requestAnimationFrame(() => {
      inputEl?.focus();
      inputEl?.setSelectionRange(insertion.cursor, insertion.cursor);
    });
  }

  async function openSettings(section: "models" | "skills"): Promise<void> {
    settingsSection = section;
    settingsOpen = true;
    SettingsModal ??= (await import("./AgentSettingsModal.svelte")).default;
  }

  async function openHistory(): Promise<void> {
    historyOpen = true;
    ConversationHistory ??= (
      await import("./AgentConversationHistory.svelte")
    ).default;
  }

  function sendMessage(value: string): void {
    const text = value.trim();
    if (!text || busy) return;
    const command = parseAgentCommand(text);
    if (command) {
      draft = "";
      if (command.name === "new") newConversation();
      else if (command.name === "threads") void openHistory();
      else if (command.name === "settings") void openSettings("models");
      else if (command.name === "mode") setAgentMode(command.mode);
      else if (command.name === "paused") setAgentPaused(command.paused);
      inputEl?.focus();
      return;
    }
    closeSkillPalette();
    draft = "";
    stickToTail = true;
    showJumpToLatest = false;
    void conversation.send(text);
    inputEl?.focus();
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    sendMessage(inputEl?.value ?? draft);
  }

  function onKeydown(event: KeyboardEvent): void {
    if (skillPaletteOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        skillPaletteIndex = Math.min(
          skillPaletteIndex + 1,
          Math.max(0, matchingSkills.length - 1),
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        skillPaletteIndex = Math.max(0, skillPaletteIndex - 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeSkillPalette();
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        const skill = matchingSkills[skillPaletteIndex];
        if (skill) {
          event.preventDefault();
          selectSkill(skill);
          return;
        }
      }
    }
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    (event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
  }

  function isToolPart(
    part: AgentConversationPart,
  ): part is AgentConversationToolPart {
    return part.type === "tool";
  }

  function partText(part: AgentConversationPart): string {
    if (part.type === "text") return part.text;
    return "";
  }

  function projectPart(part: AgentConversationToolPart): WorkstreamCard {
    const paperReceipt = conversation.paperReceipt(part.toolCallId);
    const receiptPresentation = paperReceipt
      ? paperReceipt.outcome === "unknown"
        ? {
            title: "Paper action outcome unknown",
            status: "waiting" as const,
          }
        : paperReceipt.outcome === "confirmed"
          ? {
              title: "Paper action confirmed",
              status: "success" as const,
            }
          : {
              title: "Paper action rejected",
              status: "failed" as const,
            }
      : null;
    const rawOutput =
      part.output && typeof part.output === "object"
        ? (part.output as Record<string, unknown>)
        : null;
    const pendingPaperAction =
      !paperReceipt &&
      rawOutput !== null &&
      rawOutput.paperAction !== undefined &&
      rawOutput.paperAction !== null;
    const card = projectHarnessTool({
      toolName: part.toolName,
      state: part.state,
      input: part.input,
      output: paperReceipt
        ? {
            presentation: {
              schema: "harness.presentation.v1",
              kind: "receipt",
              title: receiptPresentation?.title,
              summary: paperReceipt.message,
              status: receiptPresentation?.status,
            },
          }
        : pendingPaperAction
          ? {
              ...rawOutput,
              status: "pending-client",
              presentation: {
                schema: "harness.presentation.v1",
                kind: "execution",
                title: "Applying to paper ledger…",
                summary:
                  "Waiting for the local paper ledger Receipt before this action counts as done.",
                status: "running",
              },
            }
          : part.output,
      errorText: part.errorText,
      approvalPending: part.approvalPending,
    });
    return settleIdleActivity(
      card,
      conversation.status === "ready" && !part.approvalPending,
    );
  }

  function messageToolParts(
    parts: readonly AgentConversationPart[],
  ): AgentConversationToolPart[] {
    return parts.filter(isToolPart);
  }

  function isFirstToolPart(
    parts: readonly AgentConversationPart[],
    part: AgentConversationToolPart,
  ): boolean {
    return messageToolParts(parts)[0]?.toolCallId === part.toolCallId;
  }

  function toolActivityItems(parts: readonly AgentConversationPart[]) {
    return messageToolParts(parts).map((part) => ({
      id: part.toolCallId,
      toolName: part.toolName,
      card: projectPart(part),
      approvalPending: part.approvalPending,
    }));
  }

  function answerTool(toolCallId: string, approved: boolean): void {
    void conversation.respondToTool(toolCallId, approved);
  }

  function newConversation(): void {
    conversation.newConversation();
    stickToTail = true;
    showJumpToLatest = false;
  }

  function useStarter(prompt: string): void {
    draft = prompt;
    requestAnimationFrame(() => {
      inputEl?.focus();
      inputEl?.setSelectionRange(prompt.length, prompt.length);
    });
  }

  function handleThreadScroll(): void {
    if (!scrollEl) return;
    stickToTail = isNearAgentTail(scrollEl);
    if (stickToTail) showJumpToLatest = false;
  }

  async function scrollToLatest(force = false): Promise<void> {
    if (!scrollEl || (!force && !stickToTail)) return;
    await tick();
    if (!scrollEl) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
    stickToTail = true;
    showJumpToLatest = false;
  }

  function handleExpand(): void {
    conversation.persist();
    onExpand?.();
  }

  function handleClose(): void {
    conversation.persist();
    if (onClose) onClose();
    else closeChat();
  }
</script>

<div
  class="agent-chat"
  class:layout-dock={layout === "dock"}
  class:layout-page={layout === "page"}
  role="complementary"
  aria-label="Agent chat"
>
  <header class="agent-head">
    <div class="agent-head-left">
      <div class="agent-title-row">
        {#if layout === "page"}
          <span class="compact-page-id">
            <a href="/terminal">Harness</a>
            <span aria-hidden="true">/</span>
          </span>
        {/if}
        <span class="agent-title">Agent</span>
        <span class="conversation-title" title={conversation.conversationTitle}>
          {conversation.conversationTitle}
        </span>
        <span class="run-status" class:working={agentWorking}>
          <i aria-hidden="true"></i>{runLabel}
        </span>
        {#if $agentState.paused}
          <span class="tag pause" title="Money-PAUSE engaged">PAUSE</span>
        {/if}
        {#if accountMode === "paper"}
          <span class="tag paper">PAPER</span>
        {:else}
          <span class="tag live">LIVE</span>
        {/if}
      </div>
      <div class="picker" role="radiogroup" aria-label="Approval mode">
        {#each agentModes as mode (mode)}
          <button
            class:active={$agentState.mode === mode}
            class:auto={mode === "auto"}
            type="button"
            aria-pressed={$agentState.mode === mode}
            title={mode === "auto"
              ? "Full auto-approve"
              : mode === "observe"
                ? "Read-only"
                : "Ask before money actions"}
            onclick={() => setAgentMode(mode)}
          >
            {AGENT_MODE_LABEL[mode]}
          </button>
        {/each}
      </div>
    </div>
    <div class="agent-head-right">
      {#if layout === "page"}
        <a class="ghost compact-page-action" href="/terminal">Terminal</a>
        {#if !$privyAuth.authenticated && $privyAuth.status !== "loading"}
          <button
            class="ghost compact-page-action"
            type="button"
            onclick={onRequestAuth}
          >
            Sign in
          </button>
        {/if}
      {/if}
      <button
        class="ghost icon"
        class:active={historyOpen}
        type="button"
        aria-label="Conversation history"
        title="Conversations"
        onclick={() => void openHistory()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5M12 7v5l3 2" />
        </svg>
      </button>
      <button
        class="ghost icon"
        class:active={settingsOpen}
        type="button"
        aria-label="Agent settings"
        title="Agent settings"
        onclick={() => openSettings("models")}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path
            d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.16.38.37.73.65 1 .3.27.68.4 1.08.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"
          />
        </svg>
      </button>
      <button
        class="ghost"
        class:pause-on={$agentState.paused}
        type="button"
        title="Money-PAUSE"
        onclick={() => setAgentPaused(!$agentState.paused)}
      >
        {$agentState.paused ? "Resume" : "Pause"}
      </button>
      <button
        class="ghost"
        type="button"
        disabled={agentWorking || conversation.reconnecting}
        onclick={newConversation}
        title="New durable conversation"
      >
        New
      </button>
      {#if layout === "dock" && onExpand}
        <button class="ghost" type="button" onclick={handleExpand} title="Full page">
          Expand
        </button>
      {/if}
      {#if layout === "page" && onCollapse}
        <button class="ghost" type="button" onclick={onCollapse} title="Return to dock">
          Dock
        </button>
      {/if}
      {#if layout === "dock"}
        <button class="ghost" type="button" onclick={handleClose}>Close</button>
      {/if}
    </div>
  </header>

  <div class="agent-scroll" bind:this={scrollEl} onscroll={handleThreadScroll}>
    <div class="agent-thread">
      {#if conversation.messages.length === 0 && conversation.status === "ready"}
        <div class="agent-empty">
          <h2>Your persistent trading agent</h2>
          <p>
            {$agentState.mode === "auto"
              ? "Auto mode — server-approved trades continue durably."
              : $agentState.mode === "observe"
                ? "Observe — research only, no orders."
                : "Ask mode — every transaction waits for your approval."}
          </p>
          <div class="starter-grid">
            <button
              type="button"
              onclick={() =>
                useStarter("Review my account, current exposure, and biggest risk.")}
            >
              <strong>Review account</strong><span>Exposure, PnL, and risk</span>
            </button>
            <button
              type="button"
              onclick={() =>
                useStarter(
                  "Build a trade plan for SOL with entry, invalidation, sizing, take-profit, and stop-loss.",
                )}
            >
              <strong>Plan a SOL trade</strong><span>Entry, size, TP, and SL</span>
            </button>
            <button
              type="button"
              onclick={() =>
                useStarter(
                  "Inspect my open positions and recommend the safest risk adjustments. Do not execute yet.",
                )}
            >
              <strong>Manage risk</strong><span>Stops and open positions</span>
            </button>
            <button
              type="button"
              onclick={() =>
                useStarter(
                  "Create a recurring routine to review my portfolio and market risk every morning.",
                )}
            >
              <strong>Create a routine</strong><span>Persistent scheduled checks</span>
            </button>
          </div>
        </div>
      {/if}

      {#each conversation.messages as message, index (index)}
        <div class="msg {message.role}">
          {#each message.parts as part}
            {#if part.type === "text" && partText(part)}
              {#if message.role === "assistant"}
                <MarkdownMessage source={partText(part)} />
              {:else}
                <span>{partText(part)}</span>
              {/if}
            {:else if isToolPart(part)}
              {#if isFirstToolPart(message.parts, part)}
                <ToolActivity
                  items={toolActivityItems(message.parts)}
                  showApprovalActions={!message.parts.some(
                    (messagePart) =>
                      isToolPart(messagePart) && messagePart.approvalPending,
                  )}
                  onAnswer={(toolCallId, approved) =>
                    answerTool(toolCallId, approved)}
                />
              {/if}
              {@const quote = projectPriceQuote({
                toolName: part.toolName,
                state: part.state,
                output: part.output,
              })}
              {#if quote}
                <PriceQuoteCard {quote} {layout} />
              {/if}
            {/if}
          {/each}
        </div>
      {/each}

      {#if agentWorking && !hasActiveTool}
        <div class="thinking" aria-live="polite">
          <i aria-hidden="true"></i>
          <span>Thinking</span>
        </div>
      {/if}

      {#if conversation.reconnecting}
        <div class="state" aria-live="polite">
          <p>Reconnecting this conversation…</p>
        </div>
      {:else if conversation.recoveryError}
        <div class="state error">
          <p>Conversation recovery failed. Start a new session before sending.</p>
        </div>
      {:else if $privyAuth.status === "loading"}
        <div class="state">
          <p>Restoring your session…</p>
        </div>
      {:else if !$privyAuth.authenticated}
        <div class="state">
          <p>Sign in to talk to the agent.</p>
          <button class="primary" type="button" onclick={onRequestAuth}>
            Sign in
          </button>
        </div>
      {:else if conversation.status === "error"}
        <p class="state error">{conversation.error?.message ?? "agent-transport-error"}</p>
      {/if}
    </div>
    {#if showJumpToLatest}
      <button
        class="jump-latest"
        type="button"
        onclick={() => void scrollToLatest(true)}
      >
        Latest ↓
      </button>
    {/if}
  </div>

  <form class="composer" onsubmit={submit}>
    {#if pendingApprovalItems.length > 0}
      <aside class="approval-tray" aria-label="Pending agent approval">
        <div class="approval-heading">
          <strong>Approval required</strong>
          <span>{pendingApprovalItems.length} pending</span>
        </div>
        <ToolActivity
          items={pendingApprovalItems}
          onAnswer={(toolCallId, approved) => answerTool(toolCallId, approved)}
        />
      </aside>
    {/if}
    <div class="composer-shell">
      {#if skillPaletteOpen}
        <AgentSkillPalette
          items={matchingSkills}
          activeIndex={skillPaletteIndex}
          loading={skillsLoading}
          error={skillLoadError}
          onselect={selectSkill}
          onhover={(index) => (skillPaletteIndex = index)}
        />
      {/if}
      {#if $agentState.paused}
        <p class="money-paused">Money actions paused · research remains available</p>
      {/if}
      <label class="sr-only" for="agent-input">Message the agent</label>
      <textarea
        id="agent-input"
        class="composer-input"
        bind:this={inputEl}
        bind:value={draft}
        rows={layout === "page" ? 3 : 2}
        placeholder="Message the agent · @ skills · / commands"
        disabled={busy || !$privyAuth.authenticated}
        onkeydown={onKeydown}
        oninput={onComposerInput}
      ></textarea>
      <div class="composer-bar">
        <span class="composer-hint">
          Enter to send · @ skills · /new /threads /pause
        </span>
        {#if agentWorking}
          <button
            class="stop"
            type="button"
            disabled={conversation.cancellationState !== "idle"}
            onclick={() => conversation.cancel()}
          >
            {conversation.cancellationState === "idle" ? "Stop" : "Stopping…"}
          </button>
        {:else}
          <button
            class="secondary"
            type="submit"
            disabled={busy || !$privyAuth.authenticated || draft.trim().length === 0}
          >
            Send
          </button>
        {/if}
      </div>
      {#if conversation.cancellationError}
        <p class="cancel-error">{conversation.cancellationError}</p>
      {/if}
    </div>
  </form>
</div>

{#if settingsOpen && SettingsModal}
  <SettingsModal
    initialSection={settingsSection}
    {onRequestAuth}
    onclose={() => (settingsOpen = false)}
  />
{/if}

{#if historyOpen && ConversationHistory}
  <ConversationHistory
    conversations={conversation.conversations}
    activeId={conversation.activeConversationId}
    busy={agentWorking || conversation.reconnecting}
    onnew={() => conversation.newConversation()}
    onresume={(id) => conversation.resumeConversation(id)}
    onarchive={(id) => conversation.archiveConversation(id)}
    onrestore={(id) => conversation.restoreConversation(id)}
    onclose={() => (historyOpen = false)}
  />
{/if}

<style>
  .agent-chat {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--surface);
    color: var(--ink);
  }

  .layout-dock {
    /* Full height under the topbar and above the fixed status line so the
       composer is never clipped by the bottom nav. */
    position: fixed;
    right: 0;
    top: var(--topbar-h, 3rem);
    bottom: var(--status-h, 1.9rem);
    width: var(--agent-dock-w, min(42vw, 28rem));
    height: auto;
    border-left: 1px solid var(--line);
    z-index: 25;
  }

  .layout-page {
    flex: 1;
    width: 100%;
    height: auto;
    overflow: hidden;
    border: 0;
  }

  .agent-head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.65rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
    /* Avoid reflow when mode/model pills toggle active styles. */
    min-height: 2.75rem;
  }

  .layout-page .agent-head {
    padding: 0.85rem 1.25rem;
    min-height: 3.1rem;
  }

  .layout-dock .agent-head {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas:
      "title actions"
      "modes modes";
    align-items: center;
    gap: 0.45rem;
    padding: 0.55rem 0.7rem;
  }

  .layout-dock .agent-head-left {
    display: contents;
  }

  .layout-dock .agent-title-row {
    grid-area: title;
    min-width: 0;
  }

  .layout-dock .picker {
    grid-area: modes;
    width: 100%;
  }

  .layout-dock .picker button {
    flex: 1 1 0;
    min-width: 0;
  }

  .layout-dock .agent-head-right {
    grid-area: actions;
  }

  .layout-dock .agent-head-right .ghost {
    min-width: 0;
  }

  .agent-head-left,
  .agent-head-right {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 0.45rem;
    min-width: 0;
  }

  .agent-title-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .agent-title {
    flex: 0 0 auto;
    color: var(--accent);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .conversation-title {
    max-width: 12rem;
    overflow: hidden;
    color: var(--muted);
    font-size: 0.68rem;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .layout-dock .conversation-title {
    max-width: 7rem;
  }

  .run-status {
    display: inline-flex;
    flex: 0 0 auto;
    align-items: center;
    gap: 0.28rem;
    color: var(--faint);
    font-size: 0.6rem;
  }

  .run-status i {
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: var(--muted);
  }

  .run-status.working i {
    background: var(--up);
    animation: pulse-status 0.75s ease-in-out infinite alternate;
  }

  @keyframes pulse-status {
    to {
      opacity: 0.3;
    }
  }

  .compact-page-id,
  .compact-page-action {
    display: none;
  }

  .compact-page-id {
    align-items: center;
    gap: 0.4rem;
    color: var(--faint);
  }

  .compact-page-id a {
    color: var(--accent);
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-decoration: none;
    text-transform: uppercase;
  }

  .tag {
    font-size: 0.55rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 0.1rem 0.28rem;
    border: 1px solid var(--line-soft);
  }

  .tag.pause {
    color: var(--red);
    border-color: var(--red);
  }

  .tag.paper {
    color: var(--amber);
  }

  .tag.live {
    color: var(--up);
  }

  .picker {
    display: inline-flex;
    flex: 0 0 auto;
    border: 1px solid var(--line-soft);
    background: var(--surface-2);
  }

  .picker button {
    box-sizing: border-box;
    color: var(--muted);
    font: inherit;
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    /* Equal slots — OBSERVE is the longest label; prevents shift on mode change. */
    min-width: 4.75rem;
    padding: 0.22rem 0.35rem;
    border: 0;
    border-right: 1px solid var(--line-soft);
    background: transparent;
    cursor: pointer;
    text-align: center;
  }

  .picker button:last-child {
    border-right: 0;
  }

  .picker button.active {
    color: var(--accent);
    background: var(--surface);
  }

  .picker button.auto.active {
    color: var(--up);
  }

  .ghost {
    box-sizing: border-box;
    color: var(--muted);
    font: inherit;
    font-size: 0.7rem;
    font-weight: 600;
    /* Pause / Resume same width so toggling PAUSE doesn't nudge the row. */
    min-width: 4.25rem;
    padding: 0.28rem 0.45rem;
    border: 1px solid var(--line-soft);
    background: transparent;
    cursor: pointer;
    text-align: center;
  }

  .ghost:hover {
    color: var(--ink);
  }

  .ghost:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .ghost.icon {
    min-width: 2rem;
    width: 2rem;
    padding-inline: 0;
    font-size: 0.86rem;
  }

  .ghost.icon svg {
    width: 0.88rem;
    height: 0.88rem;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.7;
    stroke-linecap: square;
    stroke-linejoin: miter;
  }

  .ghost.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .ghost.pause-on {
    color: var(--red);
  }

  .agent-scroll {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }

  .agent-thread {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
    padding: 0.85rem;
    max-width: 100%;
  }

  .layout-page .agent-thread {
    max-width: 48rem;
    margin: 0 auto;
    padding: 1.25rem 1.5rem 2rem;
    width: 100%;
  }

  .agent-empty {
    margin: 2.5rem auto;
    text-align: center;
    color: var(--muted);
    max-width: 22rem;
  }

  .agent-empty h2 {
    margin: 0 0 0.5rem;
    color: var(--ink);
    font-size: 1.05rem;
    font-weight: 700;
  }

  .agent-empty p {
    margin: 0 0 1rem;
    font-size: 0.82rem;
    line-height: 1.45;
    /* Mode copy lengths differ — lock height so Observe→Ask doesn't jump. */
    min-height: 2.6em;
  }

  .starter-grid {
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.45rem;
    text-align: left;
  }

  .starter-grid button {
    display: grid;
    gap: 0.18rem;
    min-width: 0;
    padding: 0.6rem;
    color: var(--muted);
    font: inherit;
    font-size: 0.76rem;
    border: 1px solid var(--line-soft);
    background: var(--surface-2);
    cursor: pointer;
    text-align: left;
  }

  .starter-grid button:hover,
  .starter-grid button:focus-visible {
    color: var(--ink);
    border-color: var(--accent);
    outline: none;
  }

  .starter-grid strong {
    color: var(--ink);
    font-size: 0.72rem;
  }

  .starter-grid span {
    color: var(--faint);
    font-size: 0.65rem;
  }

  .jump-latest {
    position: sticky;
    bottom: 0.6rem;
    display: block;
    margin: 0 0.7rem 0 auto;
    padding: 0.28rem 0.5rem;
    color: var(--ink);
    font: inherit;
    font-size: 0.65rem;
    font-weight: 700;
    border: 1px solid var(--line);
    background: var(--surface-2);
    cursor: pointer;
  }

  .msg {
    font-size: 0.88rem;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .layout-page .msg {
    font-size: 0.95rem;
    line-height: 1.55;
  }

  .msg.user {
    align-self: flex-end;
    max-width: 85%;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--line-soft);
    background: var(--surface-2);
  }

  .msg.assistant {
    display: grid;
    gap: 0.48rem;
    border-left: 2px solid var(--accent);
    padding-left: 0.65rem;
  }

  .money-paused {
    margin: 0;
    padding: 0.35rem 0.65rem;
    border-bottom: 1px solid var(--line-soft);
    color: var(--red);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .thinking {
    display: flex;
    align-items: center;
    gap: 0.38rem;
    min-height: 1.65rem;
    color: var(--faint);
    font-size: 0.69rem;
  }

  .thinking i {
    display: block;
    box-sizing: border-box;
    width: 0.65rem;
    height: 0.65rem;
    border: 1px solid var(--line-soft);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .state {
    margin: 1rem auto;
    text-align: center;
    color: var(--muted);
    font-size: 0.82rem;
  }

  .state.error {
    color: var(--red);
  }

  .composer {
    flex: 0 0 auto;
    padding: 0.7rem 0.9rem 0.85rem;
    border-top: 1px solid var(--line-soft);
    background: var(--surface);
  }

  .composer-shell {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    width: 100%;
  }

  .approval-tray {
    max-width: 48rem;
    margin: 0 auto 0.55rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--amber);
    background: var(--surface-2);
  }

  .approval-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.25rem;
    color: var(--amber);
    font-size: 0.64rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .approval-heading span {
    color: var(--faint);
  }

  .layout-page .composer {
    position: sticky;
    z-index: 3;
    bottom: 0;
    width: 100%;
    padding: 0.75rem 1.5rem max(1rem, env(safe-area-inset-bottom));
    border-top: 1px solid var(--line-soft);
    background: var(--surface);
  }

  .layout-page .composer-shell {
    max-width: 48rem;
    margin: 0 auto;
  }

  .composer-input {
    resize: none;
    width: 100%;
    color: var(--ink);
    font: inherit;
    font-size: 0.88rem;
    line-height: 1.45;
    padding: 0.65rem 0.75rem;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }

  .layout-page .composer-input {
    font-size: 0.95rem;
    min-height: 5rem;
  }

  .composer-input:focus {
    border-color: var(--accent);
    outline: 1px solid var(--accent);
  }

  .composer-input::placeholder {
    color: var(--faint);
  }

  .composer-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .composer-hint {
    font-size: 0.65rem;
    color: var(--faint);
  }

  /* Local button skins — full page may not load terminal.css utilities. */
  .primary,
  .secondary,
  .stop {
    font: inherit;
    font-size: 0.72rem;
    font-weight: 700;
    padding: 0.32rem 0.55rem;
    cursor: pointer;
    border: 1px solid var(--line);
  }

  .primary {
    color: var(--accent-contrast);
    background: var(--accent);
    border-color: var(--accent);
  }

  .secondary {
    color: var(--ink);
    background: var(--surface-2);
  }

  .stop {
    min-width: 4.5rem;
    color: var(--red);
    border-color: var(--red);
    background: transparent;
  }

  .stop:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .cancel-error {
    margin: 0;
    color: var(--red);
    font-size: 0.66rem;
  }

  .secondary:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @media (max-width: 1100px) {
    .layout-page .agent-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        "title actions"
        "modes modes";
      align-items: center;
      gap: 0.45rem;
      padding: 0.55rem 0.7rem;
    }

    .layout-page .agent-head-left {
      display: contents;
    }

    .layout-page .agent-title-row {
      grid-area: title;
    }

    .layout-page .picker {
      grid-area: modes;
      width: 100%;
    }

    .layout-page .picker button {
      flex: 1 1 0;
      min-width: 0;
    }

    .layout-page .agent-head-right {
      grid-area: actions;
      justify-content: flex-end;
      overflow-x: auto;
    }

    .layout-page .compact-page-id,
    .layout-page .compact-page-action {
      display: inline-flex;
    }

    .layout-page .compact-page-action {
      align-items: center;
      justify-content: center;
      text-decoration: none;
    }

    .layout-page .conversation-title {
      max-width: 8rem;
    }

    .layout-dock {
      /* Narrow: full-width sheet under topbar, still above status line. */
      position: fixed;
      right: 0;
      left: 0;
      top: var(--topbar-h, 3rem);
      bottom: var(--status-h, 1.9rem);
      width: auto;
      height: auto;
      z-index: 30;
      border-left: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .thinking i,
    .run-status.working i {
      animation: none;
    }
  }

  @media (max-width: 560px) {
    .starter-grid {
      grid-template-columns: 1fr;
    }

    .conversation-title,
    .run-status {
      display: none;
    }
  }
</style>
