<script lang="ts">
  import type { AgentActionExecutor } from "$lib/agent/host";
  import {
    backgroundRunMode,
    idleAgentRunStatus,
    type AgentAccountMode,
    type AgentRunStatus,
  } from "$lib/agent/run-visibility";
  import { scopeAgentStorage } from "$lib/agent/scoped-storage";
  import AgentChat from "./AgentChat.svelte";

  let {
    ownerId,
    buildContext,
    onRequestAuth,
    accountMode = "paper",
    layout = "dock",
    focusComposerRequest = 0,
    executePaperAction,
    onExpand,
    onCollapse,
    onClose,
  }: {
    ownerId: string;
    buildContext: () => Record<string, unknown>;
    onRequestAuth: () => void;
    accountMode?: AgentAccountMode;
    layout?: "dock" | "page";
    focusComposerRequest?: number;
    executePaperAction?: AgentActionExecutor;
    onExpand?: () => void;
    onCollapse?: () => void;
    onClose?: () => void;
  } = $props();

  // AgentSurface keys this component by owner; each storage adapter is fixed
  // for the lifetime of that owner workspace.
  // svelte-ignore state_referenced_locally
  const paperStorage = scopeAgentStorage(localStorage, {
    ownerId,
    accountMode: "paper",
  });
  // svelte-ignore state_referenced_locally
  const liveStorage = scopeAgentStorage(localStorage, {
    ownerId,
    accountMode: "live",
  });
  // The active account is mounted immediately; the effect below retains every
  // workspace after its first visit.
  // svelte-ignore state_referenced_locally
  let paperMounted = $state(accountMode === "paper");
  // svelte-ignore state_referenced_locally
  let liveMounted = $state(accountMode === "live");
  let paperRun = $state.raw<AgentRunStatus>(idleAgentRunStatus());
  let liveRun = $state.raw<AgentRunStatus>(idleAgentRunStatus());

  $effect(() => {
    if (accountMode === "paper") paperMounted = true;
    if (accountMode === "live") liveMounted = true;
  });

  const backgroundMode = $derived(
    backgroundRunMode(accountMode, {
      live: liveRun.active,
      paper: paperRun.active,
    }),
  );
  const backgroundRun = $derived(
    backgroundMode === "live"
      ? liveRun
      : backgroundMode === "paper"
        ? paperRun
        : null,
  );

  function setRun(mode: AgentAccountMode, status: AgentRunStatus): void {
    if (mode === "paper") paperRun = status;
    else liveRun = status;
  }
</script>

<div class="agent-workspace">
  {#if paperMounted}
    <div
      class="workspace-view"
      class:active={accountMode === "paper"}
      aria-hidden={accountMode !== "paper"}
      inert={accountMode !== "paper"}
    >
      <AgentChat
        {buildContext}
        {onRequestAuth}
        accountMode="paper"
        {layout}
        focusComposerRequest={accountMode === "paper" ? focusComposerRequest : 0}
        {executePaperAction}
        {onExpand}
        {onCollapse}
        {onClose}
        storage={paperStorage}
        onRunStateChange={(status) => setRun("paper", status)}
      />
    </div>
  {/if}

  {#if liveMounted}
    <div
      class="workspace-view"
      class:active={accountMode === "live"}
      aria-hidden={accountMode !== "live"}
      inert={accountMode !== "live"}
    >
      <AgentChat
        {buildContext}
        {onRequestAuth}
        accountMode="live"
        {layout}
        focusComposerRequest={accountMode === "live" ? focusComposerRequest : 0}
        {executePaperAction}
        {onExpand}
        {onCollapse}
        {onClose}
        storage={liveStorage}
        onRunStateChange={(status) => setRun("live", status)}
      />
    </div>
  {/if}

  {#if backgroundMode && backgroundRun}
    <aside class="background-run" role="alert" aria-live="assertive">
      <i class:stopping={backgroundRun.stopping} aria-hidden="true"></i>
      <span>
        <strong>{backgroundMode} agent {backgroundRun.label.toLowerCase()}</strong>
        <small>Run remains visible after the account switch.</small>
      </span>
      <button
        type="button"
        disabled={!backgroundRun.canCancel}
        onclick={backgroundRun.cancel}
      >
        {backgroundRun.stopping ? "Stopping…" : "Stop"}
      </button>
    </aside>
  {/if}
</div>

<style>
  .agent-workspace,
  .workspace-view.active {
    display: contents;
  }

  .workspace-view:not(.active) {
    display: none;
  }

  .background-run {
    position: fixed;
    top: calc(var(--topbar-h, 3rem) + 0.55rem);
    right: 0.65rem;
    z-index: 45;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    width: min(23rem, calc(100vw - 1.3rem));
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0.65rem;
    color: var(--ink);
    border: 1px solid var(--amber);
    background: var(--surface-2);
  }

  .background-run i {
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--up);
    animation: pulse 0.75s ease-in-out infinite alternate;
  }

  .background-run i.stopping {
    background: var(--amber);
  }

  .background-run span {
    display: grid;
    min-width: 0;
    gap: 0.08rem;
  }

  .background-run strong {
    overflow: hidden;
    font-size: 0.69rem;
    letter-spacing: 0.035em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }

  .background-run small {
    overflow: hidden;
    color: var(--muted);
    font-size: 0.61rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .background-run button {
    min-height: 1.8rem;
    padding: 0 0.55rem;
    color: var(--ink);
    font: inherit;
    font-size: 0.65rem;
    font-weight: 750;
    border: 1px solid var(--line);
    background: var(--surface-2);
    cursor: pointer;
  }

  .background-run button:disabled {
    color: var(--faint);
    cursor: wait;
  }

  @keyframes pulse {
    to {
      opacity: 0.3;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .background-run i {
      animation: none;
    }
  }
</style>
