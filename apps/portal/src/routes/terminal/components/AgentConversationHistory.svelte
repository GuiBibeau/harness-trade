<script lang="ts">
  import { onMount } from "svelte";
  import type { AgentConversationSummary } from "$lib/agent/conversation-history";

  let {
    conversations,
    activeId,
    busy,
    onnew,
    onresume,
    onarchive,
    onrestore,
    onclose,
  }: {
    conversations: AgentConversationSummary[];
    activeId: string;
    busy: boolean;
    onnew: () => void;
    onresume: (id: string) => void;
    onarchive: (id: string) => void;
    onrestore: (id: string) => void;
    onclose: () => void;
  } = $props();

  let panel: HTMLDivElement | null = $state(null);
  const active = $derived(
    conversations.filter((conversation) => !conversation.archivedAt),
  );
  const archived = $derived(
    conversations.filter((conversation) => conversation.archivedAt),
  );

  onMount(() => panel?.focus());

  function timeLabel(value: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function resume(id: string): void {
    onresume(id);
    onclose();
  }

  function restore(id: string): void {
    onrestore(id);
    onclose();
  }

  function create(): void {
    onnew();
    onclose();
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    onclose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="backdrop" role="presentation" onclick={onclose}>
  <div
    bind:this={panel}
    class="history-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Agent conversations"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={onPanelKeydown}
  >
    <header>
      <div>
        <span>AGENT</span>
        <h2>Conversations</h2>
      </div>
      <div class="head-actions">
        <button class="new" type="button" disabled={busy} onclick={create}>
          New conversation
        </button>
        <button class="close" type="button" aria-label="Close" onclick={onclose}>
          ×
        </button>
      </div>
    </header>

    <div class="history-body">
      <section aria-labelledby="recent-conversations">
        <h3 id="recent-conversations">Recent</h3>
        <div class="conversation-list">
          {#each active as conversation (conversation.id)}
            <div class:current={conversation.id === activeId} class="conversation">
              <button
                class="conversation-main"
                type="button"
                disabled={busy || conversation.id === activeId}
                onclick={() => resume(conversation.id)}
              >
                <strong>{conversation.title}</strong>
                <span>
                  {conversation.id === activeId ? "Current" : "Resume"} ·
                  {timeLabel(conversation.updatedAt)}
                </span>
              </button>
              <button
                class="archive"
                type="button"
                disabled={busy}
                aria-label={`Archive ${conversation.title}`}
                onclick={() => onarchive(conversation.id)}
              >
                Archive
              </button>
            </div>
          {:else}
            <p class="empty">No active conversations.</p>
          {/each}
        </div>
      </section>

      {#if archived.length > 0}
        <section aria-labelledby="archived-conversations">
          <h3 id="archived-conversations">Archived</h3>
          <div class="conversation-list archived-list">
            {#each archived as conversation (conversation.id)}
              <div class="conversation">
                <div class="conversation-main">
                  <strong>{conversation.title}</strong>
                  <span>Archived · {timeLabel(conversation.archivedAt ?? "")}</span>
                </div>
                <button
                  class="restore"
                  type="button"
                  disabled={busy}
                  onclick={() => restore(conversation.id)}
                >
                  Restore
                </button>
              </div>
            {/each}
          </div>
        </section>
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 79;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: color-mix(in srgb, var(--paper) 78%, transparent);
  }

  .history-modal {
    width: min(38rem, 100%);
    max-height: min(42rem, calc(100dvh - 2rem));
    overflow: hidden;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    display: flex;
    flex-direction: column;
  }

  .history-modal:focus {
    outline: none;
  }

  header {
    min-height: 3.5rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  header > div:first-child {
    display: grid;
    gap: 0.1rem;
  }

  header span {
    color: var(--accent);
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.11em;
  }

  h2,
  h3 {
    margin: 0;
  }

  h2 {
    font-size: 1rem;
  }

  h3 {
    color: var(--faint);
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .head-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  button {
    border: 1px solid var(--line-soft);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 0.7rem;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  button.new {
    padding: 0.4rem 0.6rem;
    border-color: var(--accent);
    color: var(--accent);
  }

  button.close {
    width: 2rem;
    height: 2rem;
    font-size: 1.1rem;
  }

  .history-body {
    overflow: auto;
    padding: 0.9rem;
    display: grid;
    gap: 1.2rem;
  }

  section {
    display: grid;
    gap: 0.45rem;
  }

  .conversation-list {
    border-top: 1px solid var(--line-soft);
  }

  .conversation {
    min-height: 3.4rem;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
    border-bottom: 1px solid var(--line-soft);
  }

  .conversation.current {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .conversation-main {
    min-width: 0;
    border: 0;
    padding: 0.65rem 0.75rem;
    text-align: left;
    display: grid;
    gap: 0.2rem;
    align-content: center;
  }

  button.conversation-main:hover {
    background: var(--surface-2);
    color: var(--ink);
  }

  .conversation-main strong {
    overflow: hidden;
    color: var(--ink);
    font-size: 0.76rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .conversation-main span {
    color: var(--faint);
    font-size: 0.63rem;
  }

  .archive,
  .restore {
    align-self: center;
    margin-right: 0.65rem;
    padding: 0.3rem 0.45rem;
  }

  .archive:hover {
    color: var(--amber);
  }

  .restore:hover {
    color: var(--accent);
  }

  .archived-list {
    opacity: 0.78;
  }

  .empty {
    margin: 0;
    padding: 1rem 0;
    color: var(--faint);
    font-size: 0.72rem;
  }
</style>
