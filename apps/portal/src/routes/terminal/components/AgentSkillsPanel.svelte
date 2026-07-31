<script lang="ts">
  import {
    deleteAgentSkill,
    fetchAgentSkills,
    installAgentSkill,
    setAgentSkillEnabled,
    type SkillListItem,
  } from "$lib/agent/skills-api";
  import { privyAuth } from "$lib/privy-auth";

  let {
    onRequestAuth,
  }: {
    onRequestAuth: () => void;
  } = $props();

  let loading = $state(false);
  let error = $state<string | null>(null);
  let builtins = $state<SkillListItem[]>([]);
  let userSkills = $state<SkillListItem[]>([]);
  let storeConfigured = $state(true);
  let draft = $state("");
  let busyName = $state<string | null>(null);
  let loadedForAuthenticatedUser = false;

  async function refresh(): Promise<void> {
    if (!$privyAuth.authenticated) return;
    loading = true;
    error = null;
    try {
      const data = await fetchAgentSkills();
      builtins = data.builtins;
      userSkills = data.userSkills;
      storeConfigured = data.storeConfigured;
    } catch (err) {
      error = err instanceof Error ? err.message : "skills-load-failed";
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if ($privyAuth.authenticated && !loadedForAuthenticatedUser) {
      loadedForAuthenticatedUser = true;
      void refresh();
    } else if (!$privyAuth.authenticated) {
      loadedForAuthenticatedUser = false;
    }
  });

  async function onInstall(): Promise<void> {
    if (!$privyAuth.authenticated) {
      onRequestAuth();
      return;
    }
    busyName = "__install__";
    error = null;
    try {
      await installAgentSkill({ skillMd: draft });
      draft = "";
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : "skills-install-failed";
    } finally {
      busyName = null;
    }
  }

  async function onToggle(skill: SkillListItem): Promise<void> {
    busyName = skill.name;
    error = null;
    try {
      await setAgentSkillEnabled(skill.name, !skill.enabled);
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : "skills-toggle-failed";
    } finally {
      busyName = null;
    }
  }

  async function onDelete(skill: SkillListItem): Promise<void> {
    busyName = skill.name;
    error = null;
    try {
      await deleteAgentSkill(skill.name);
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : "skills-delete-failed";
    } finally {
      busyName = null;
    }
  }
</script>

<section class="settings-panel" aria-label="Agent skills">
      <header>
        <h3>Skills</h3>
        <p>
          Type <code>@</code> in chat to invoke any enabled skill. Use
          <code>@skill-installer</code> to create one conversationally, or
          paste an existing <code>SKILL.md</code> below.
        </p>
      </header>

      {#if !$privyAuth.authenticated}
        <div class="state">
          <p>Sign in to manage skills.</p>
          <button class="primary" type="button" onclick={onRequestAuth}>
            Sign in
          </button>
        </div>
      {:else if loading}
        <p class="state">Loading skills…</p>
      {:else if error}
        <p class="state error">{error}</p>
      {/if}

      {#if !storeConfigured}
        <p class="state">
          User skill storage is not configured on this environment
          (<code>BLOB_READ_WRITE_TOKEN</code>). Built-ins still work.
        </p>
      {/if}

      <div class="group">
        <h4>Built-in</h4>
        <ul>
          {#each builtins as skill (skill.name)}
            <li>
              <div>
                <strong>{skill.name}</strong>
                <span class="meta">load_skill · {skill.loadSkillId}</span>
                <p>{skill.description}</p>
              </div>
            </li>
          {/each}
        </ul>
      </div>

      <div class="group">
        <h4>Your skills</h4>
        {#if userSkills.length === 0}
          <p class="state">No installed skills yet.</p>
        {:else}
          <ul>
            {#each userSkills as skill (skill.name)}
              <li>
                <div>
                  <strong>{skill.name}</strong>
                  <span class="meta">
                    {skill.enabled ? "enabled" : "disabled"} · {skill.loadSkillId}
                    {#if skill.hasOpenaiYaml}
                      · openai.yaml
                    {/if}
                  </span>
                  <p>{skill.description}</p>
                </div>
                <div class="actions">
                  <button
                    class="ghost"
                    type="button"
                    disabled={busyName === skill.name}
                    onclick={() => void onToggle(skill)}
                  >
                    {skill.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    class="ghost danger"
                    type="button"
                    disabled={busyName === skill.name}
                    onclick={() => void onDelete(skill)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            {/each}
          </ul>
        {/if}
      </div>

      <div class="install">
        <h4>Install manually</h4>
        <p class="hint">
          Paste a Claude or Codex skill file. Optional
          <code>agents/openai.yaml</code> and <code>references/*</code> can be
          added later via API; scripts are rejected.
        </p>
        <textarea
          bind:value={draft}
          rows="10"
          spellcheck="false"
          aria-label="Skill markdown"
          placeholder={"---\nname: my-skill\ndescription: When to use it.\n---\n\n# Instructions"}
        ></textarea>
        <button
          class="primary"
          type="button"
          disabled={busyName === "__install__" ||
            !storeConfigured ||
            !draft.trim()}
          onclick={() => void onInstall()}
        >
          Install skill
        </button>
      </div>
    </section>

<style>
  button.ghost {
    background: transparent;
    border: 1px solid var(--line);
    color: var(--ink);
    font: inherit;
    font-size: 12px;
    padding: 4px 8px;
    cursor: pointer;
  }

  button.primary {
    background: var(--accent);
    border: 0;
    color: var(--bg);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    padding: 8px 12px;
    cursor: pointer;
  }

  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .settings-panel {
    display: grid;
    gap: 16px;
  }

  header h3,
  .group h4,
  .install h4 {
    margin: 0 0 4px;
    font-size: 13px;
  }

  header p,
  .hint,
  li p,
  .state {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
  }

  .state.error {
    color: var(--red);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }

  li {
    display: grid;
    gap: 8px;
    border: 1px solid var(--line);
    padding: 8px;
  }

  .meta {
    display: block;
    color: var(--faint);
    font-size: 11px;
    margin-top: 2px;
  }

  .actions {
    display: flex;
    gap: 6px;
  }

  button.danger {
    color: var(--red);
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--line);
    font: inherit;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.4;
    padding: 8px;
    resize: vertical;
    margin: 8px 0;
  }

  code {
    font-size: 11px;
  }
</style>
