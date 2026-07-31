<script lang="ts">
  import type { SkillListItem } from "$lib/agent/skills-api";

  let {
    items,
    activeIndex,
    loading,
    error,
    onselect,
    onhover,
  }: {
    items: SkillListItem[];
    activeIndex: number;
    loading: boolean;
    error: string | null;
    onselect: (skill: SkillListItem) => void;
    onhover: (index: number) => void;
  } = $props();
</script>

<div class="skill-palette" role="listbox" aria-label="Agent skills">
  <header>
    <strong>Use a skill</strong>
    <span>Keep typing to filter</span>
  </header>
  <div class="skill-list">
    {#if loading}
      <p>Loading skills…</p>
    {:else if error}
      <p class="error">{error}</p>
    {:else}
      {#each items as skill, index (skill.loadSkillId)}
        <button
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          class:active={index === activeIndex}
          onmousedown={(event) => event.preventDefault()}
          onmousemove={() => onhover(index)}
          onclick={() => onselect(skill)}
        >
          <span class="mention">@{skill.name}</span>
          <span class="source">{skill.source === "builtin" ? "Built-in" : "Yours"}</span>
          <small>{skill.description}</small>
        </button>
      {:else}
        <p>No enabled skills match.</p>
      {/each}
    {/if}
  </div>
  <footer>
    <span><kbd>↑↓</kbd> navigate</span>
    <span><kbd>Enter</kbd> insert</span>
    <span><kbd>Esc</kbd> close</span>
  </footer>
</div>

<style>
  .skill-palette {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 0.4rem);
    z-index: 12;
    max-height: min(22rem, 48dvh);
    overflow: hidden;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    display: flex;
    flex-direction: column;
  }

  header,
  footer {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.45rem 0.6rem;
    border-bottom: 1px solid var(--line-soft);
  }

  header strong {
    font-size: 0.68rem;
  }

  header span,
  footer {
    color: var(--faint);
    font-size: 0.6rem;
  }

  .skill-list {
    overflow: auto;
  }

  button {
    width: 100%;
    padding: 0.55rem 0.65rem;
    border: 0;
    border-bottom: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink);
    font: inherit;
    text-align: left;
    cursor: pointer;
    display: grid;
    grid-template-columns: minmax(0, auto) 1fr;
    gap: 0.12rem 0.5rem;
  }

  button.active {
    background: var(--surface-2);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .mention {
    color: var(--accent);
    font-size: 0.72rem;
    font-weight: 700;
  }

  .source {
    color: var(--faint);
    font-size: 0.58rem;
    align-self: center;
  }

  small {
    grid-column: 1 / -1;
    overflow: hidden;
    color: var(--muted);
    font-size: 0.64rem;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  p {
    margin: 0;
    padding: 0.9rem 0.65rem;
    color: var(--faint);
    font-size: 0.68rem;
  }

  p.error {
    color: var(--red);
  }

  footer {
    justify-content: flex-start;
    border-top: 1px solid var(--line-soft);
    border-bottom: 0;
  }

  kbd {
    color: var(--muted);
    font: inherit;
  }
</style>
