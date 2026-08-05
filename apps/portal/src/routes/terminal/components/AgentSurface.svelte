<script lang="ts">
  import { browser } from "$app/environment";
  import type { AgentActionExecutor } from "$lib/agent/host";
  import { privyAuth } from "$lib/privy-auth";
  import AgentWorkspace from "./AgentWorkspace.svelte";

  let {
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
    buildContext: () => Record<string, unknown>;
    onRequestAuth: () => void;
    accountMode?: "live" | "paper";
    layout?: "dock" | "page";
    focusComposerRequest?: number;
    executePaperAction?: AgentActionExecutor;
    onExpand?: () => void;
    onCollapse?: () => void;
    onClose?: () => void;
  } = $props();
</script>

{#if browser && $privyAuth.authenticated && $privyAuth.userId}
  {#key $privyAuth.userId}
    <AgentWorkspace
      ownerId={$privyAuth.userId}
      {buildContext}
      {onRequestAuth}
      {accountMode}
      {layout}
      {focusComposerRequest}
      {executePaperAction}
      {onExpand}
      {onCollapse}
      {onClose}
    />
  {/key}
{:else}
  <section
    class="agent-gate"
    class:layout-dock={layout === "dock"}
    class:layout-page={layout === "page"}
    aria-label="Agent chat"
  >
    <header>
      <span class="eyebrow">Agent</span>
      <span class:paper={accountMode === "paper"} class="account">
        {accountMode}
      </span>
    </header>
    <div class="gate-body" aria-live="polite">
      {#if $privyAuth.status === "loading"}
        <span class="status-dot working" aria-hidden="true"></span>
        <h2>Restoring your workspace</h2>
        <p>Your conversations and agent session will appear here.</p>
      {:else}
        <span class="status-dot" aria-hidden="true"></span>
        <h2>Your trading workspace</h2>
        <p>Sign in to open your private, persistent agent conversations.</p>
        <button type="button" onclick={onRequestAuth}>Sign in</button>
      {/if}
    </div>
  </section>
{/if}

<style>
  .agent-gate {
    display: flex;
    min-height: 0;
    flex-direction: column;
    background: var(--surface);
    color: var(--ink);
  }

  .layout-dock {
    position: fixed;
    right: 0;
    top: var(--topbar-h, 3rem);
    bottom: var(--status-h, 1.9rem);
    width: var(--agent-dock-w, min(42vw, 28rem));
    border-left: 1px solid var(--line);
    z-index: 25;
  }

  .layout-page {
    width: 100%;
    height: 100%;
  }

  header {
    display: flex;
    min-height: 3rem;
    align-items: center;
    gap: 0.45rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .eyebrow,
  .account {
    font-size: 0.62rem;
    font-weight: 800;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .eyebrow {
    color: var(--accent);
  }

  .account {
    padding: 0.12rem 0.3rem;
    color: var(--muted);
    border: 1px solid var(--line-soft);
  }

  .account.paper {
    color: var(--amber);
  }

  .gate-body {
    display: grid;
    flex: 1;
    place-content: center;
    justify-items: center;
    padding: 2rem;
    text-align: center;
  }

  .gate-body h2 {
    margin: 0.8rem 0 0.35rem;
    font-size: 1rem;
  }

  .gate-body p {
    max-width: 24rem;
    margin: 0;
    color: var(--muted);
    font-size: 0.82rem;
    line-height: 1.5;
  }

  .gate-body button {
    margin-top: 1rem;
    padding: 0.45rem 0.75rem;
    color: var(--accent-contrast);
    font: inherit;
    font-size: 0.75rem;
    font-weight: 750;
    border: 1px solid var(--accent);
    background: var(--accent);
    cursor: pointer;
  }

  .status-dot {
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 50%;
    background: var(--muted);
  }

  .status-dot.working {
    background: var(--accent);
    animation: pulse 1s ease-in-out infinite alternate;
  }

  @keyframes pulse {
    to {
      opacity: 0.35;
    }
  }

  @media (max-width: 1100px) {
    .layout-dock {
      left: 0;
      width: auto;
      border-left: 0;
      z-index: 30;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .status-dot.working {
      animation: none;
    }
  }
</style>
