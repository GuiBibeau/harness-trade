<script lang="ts">
  import { onMount } from "svelte";
  import AgentModelsPanel from "./AgentModelsPanel.svelte";
  import AgentSkillsPanel from "./AgentSkillsPanel.svelte";

  let {
    initialSection = "models",
    onRequestAuth,
    onclose,
  }: {
    initialSection?: "models" | "skills";
    onRequestAuth: () => void;
    onclose: () => void;
  } = $props();

  let section = $state<"models" | "skills">("models");
  let panel: HTMLDivElement | null = $state(null);

  onMount(() => {
    section = initialSection;
    panel?.focus();
  });

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
    class="settings-modal"
    role="dialog"
    aria-modal="true"
    aria-label="Agent settings"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={onPanelKeydown}
  >
    <header class="modal-head">
      <div>
        <span>AGENT</span>
        <h2>Settings</h2>
      </div>
      <button type="button" aria-label="Close agent settings" onclick={onclose}>
        ×
      </button>
    </header>

    <div class="settings-layout">
      <nav aria-label="Agent settings sections">
        <button
          class:active={section === "models"}
          type="button"
          onclick={() => (section = "models")}
        >
          <span>Models</span>
          <small>Providers and encrypted keys</small>
        </button>
        <button
          class:active={section === "skills"}
          type="button"
          onclick={() => (section = "skills")}
        >
          <span>Skills</span>
          <small>Install and manage</small>
        </button>
      </nav>

      <div class="settings-content">
        {#if section === "models"}
          <AgentModelsPanel {onRequestAuth} />
        {:else}
          <AgentSkillsPanel {onRequestAuth} />
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: grid;
    place-items: center;
    padding: 1rem;
    background: color-mix(in srgb, var(--paper) 78%, transparent);
  }

  .settings-modal {
    width: min(52rem, 100%);
    max-height: min(44rem, calc(100dvh - 2rem));
    overflow: hidden;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    display: flex;
    flex-direction: column;
  }

  .settings-modal:focus {
    outline: none;
  }

  .modal-head {
    min-height: 3.5rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-head div {
    display: grid;
    gap: 0.1rem;
  }

  .modal-head span {
    color: var(--accent);
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.11em;
  }

  .modal-head h2 {
    margin: 0;
    font-size: 1rem;
  }

  .modal-head button {
    width: 2rem;
    height: 2rem;
    border: 1px solid var(--line-soft);
    background: transparent;
    color: var(--muted);
    font: inherit;
    font-size: 1.1rem;
    cursor: pointer;
  }

  .settings-layout {
    min-height: 0;
    display: grid;
    grid-template-columns: 12rem minmax(0, 1fr);
    flex: 1;
  }

  nav {
    padding: 0.6rem;
    border-right: 1px solid var(--line-soft);
    background: var(--surface-2);
  }

  nav button {
    width: 100%;
    padding: 0.65rem;
    border: 0;
    border-left: 2px solid transparent;
    background: transparent;
    color: var(--muted);
    text-align: left;
    cursor: pointer;
    display: grid;
    gap: 0.15rem;
  }

  nav button.active {
    border-left-color: var(--accent);
    background: var(--surface);
    color: var(--ink);
  }

  nav span {
    font-size: 0.76rem;
    font-weight: 700;
  }

  nav small {
    color: var(--faint);
    font-size: 0.63rem;
  }

  .settings-content {
    min-width: 0;
    overflow: auto;
    padding: 1rem 1.1rem 1.5rem;
  }

  @media (max-width: 42rem) {
    .settings-layout {
      grid-template-columns: 1fr;
      grid-template-rows: auto minmax(0, 1fr);
    }

    nav {
      display: flex;
      border-right: 0;
      border-bottom: 1px solid var(--line-soft);
    }

    nav button {
      border-left: 0;
      border-bottom: 2px solid transparent;
    }

    nav button.active {
      border-bottom-color: var(--accent);
    }

    nav small {
      display: none;
    }
  }
</style>
