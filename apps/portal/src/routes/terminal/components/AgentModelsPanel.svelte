<script lang="ts">
  import {
    createLlmProfile,
    deleteLlmProfile,
    discoverLlmModels,
    type DiscoveredLlmModel,
    fetchLlmProfiles,
    type LlmCatalogProvider,
    type LlmProfilePublic,
    type LlmProviderId,
    updateLlmProfile,
  } from "$lib/agent/llm-profiles-api";
  import {
    llmProfileSelection,
    PLATFORM_LLM_PROFILE,
    setLlmProfileId,
  } from "$lib/agent/llm-profile-selection";
  import { privyAuth } from "$lib/privy-auth";

  let {
    onRequestAuth,
  }: {
    onRequestAuth: () => void;
  } = $props();

  let loading = $state(false);
  let error = $state<string | null>(null);
  let catalog = $state<LlmCatalogProvider[]>([]);
  let profiles = $state<LlmProfilePublic[]>([]);
  let storeConfigured = $state(true);
  let platformLabel = $state("Harness default (DeepSeek V4 Pro)");
  let busyId = $state<string | null>(null);

  let name = $state("My model");
  let provider = $state<LlmProviderId>("openai");
  let model = $state("gpt-5.4-mini");
  let apiKey = $state("");
  let discoveredModels = $state<DiscoveredLlmModel[]>([]);
  let discoveryReady = $state(false);
  let discovering = $state(false);
  let loadedForAuthenticatedUser = false;

  const fallbackModelsForProvider = $derived(
    catalog.find((entry) => entry.id === provider)?.models ?? [],
  );
  const modelsForProvider = $derived(
    discoveryReady ? discoveredModels : fallbackModelsForProvider,
  );
  const hasServerActive = $derived(profiles.some((profile) => profile.active));
  const selection = $derived($llmProfileSelection.profileId);
  const platformSelected = $derived(
    selection === PLATFORM_LLM_PROFILE ||
      (selection === null && !hasServerActive),
  );

  async function refresh(): Promise<void> {
    if (!$privyAuth.authenticated) return;
    loading = true;
    error = null;
    try {
      const data = await fetchLlmProfiles();
      catalog = data.catalog;
      profiles = data.profiles;
      storeConfigured = data.storeConfigured;
      platformLabel = data.platformDefault.label;
      if (
        catalog.length > 0 &&
        !catalog.some((entry) => entry.id === provider)
      ) {
        provider = catalog[0].id;
      }
      const options = catalog.find((entry) => entry.id === provider)?.models;
      if (options && options.length > 0 && !options.some((m) => m.id === model)) {
        model = options[0].id;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "llm-load-failed";
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

  function resetDiscovery(): void {
    discoveryReady = false;
    discoveredModels = [];
  }

  function onProviderChange(event: Event): void {
    provider = (event.currentTarget as HTMLSelectElement)
      .value as LlmProviderId;
    error = null;
    resetDiscovery();
    const first = catalog.find((entry) => entry.id === provider)?.models[0];
    if (first) model = first.id;
  }

  function onApiKeyInput(event: Event): void {
    apiKey = (event.currentTarget as HTMLInputElement).value;
    error = null;
    resetDiscovery();
  }

  function discoveryErrorMessage(err: unknown): string {
    const code = err instanceof Error ? err.message : "";
    if (
      code === "llm-discovery-provider-400" ||
      code === "llm-discovery-provider-401"
    ) {
      return "That provider rejected this API key.";
    }
    if (code === "llm-discovery-provider-403") {
      return "This key cannot list models. Check its provider permissions.";
    }
    if (code === "llm-discovery-provider-429") {
      return "Model discovery is rate-limited. Try again shortly.";
    }
    if (code === "llm-discovery-provider-unavailable") {
      return "The provider is temporarily unavailable.";
    }
    return code || "llm-discovery-failed";
  }

  async function onDiscover(): Promise<void> {
    discovering = true;
    error = null;
    resetDiscovery();
    try {
      const models = await discoverLlmModels({ provider, apiKey });
      if (models.length === 0) throw new Error("llm-discovery-no-models");
      discoveredModels = models;
      discoveryReady = true;
      if (!models.some((entry) => entry.id === model)) {
        model = models[0].id;
      }
    } catch (err) {
      error = discoveryErrorMessage(err);
    } finally {
      discovering = false;
    }
  }

  async function onCreate(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    if (!discoveryReady) return;
    busyId = "__create__";
    error = null;
    try {
      const profile = await createLlmProfile({
        name,
        provider,
        model,
        apiKey,
        active: true,
      });
      setLlmProfileId(profile.id);
      apiKey = "";
      resetDiscovery();
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : "llm-create-failed";
    } finally {
      busyId = null;
    }
  }

  async function onActivate(profile: LlmProfilePublic): Promise<void> {
    busyId = profile.id;
    error = null;
    try {
      await updateLlmProfile(profile.id, { active: true });
      setLlmProfileId(profile.id);
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : "llm-activate-failed";
    } finally {
      busyId = null;
    }
  }

  async function onDelete(profile: LlmProfilePublic): Promise<void> {
    busyId = profile.id;
    error = null;
    try {
      await deleteLlmProfile(profile.id);
      if ($llmProfileSelection.profileId === profile.id) {
        setLlmProfileId(PLATFORM_LLM_PROFILE);
      }
      await refresh();
    } catch (err) {
      error = err instanceof Error ? err.message : "llm-delete-failed";
    } finally {
      busyId = null;
    }
  }

  function usePlatformDefault(): void {
    setLlmProfileId(PLATFORM_LLM_PROFILE);
  }
</script>

<section class="settings-panel" aria-label="Agent models">
      <header>
        <h3>Models</h3>
        <p>
          Bring your own provider API key for this agent. Keys are encrypted
          server-side and are never returned to the browser or shown to the
          model.
        </p>
      </header>

      {#if !$privyAuth.authenticated}
        <div class="state">
          <p>Sign in to manage model profiles.</p>
          <button class="primary" type="button" onclick={onRequestAuth}>
            Sign in
          </button>
        </div>
      {:else if loading}
        <p class="state">Loading models…</p>
      {:else if error}
        <p class="state error">{error}</p>
      {/if}

      {#if !storeConfigured}
        <p class="state">
          Model vault needs <code>BLOB_READ_WRITE_TOKEN</code>. Until then the
          platform default stays in use.
        </p>
      {/if}

      <div class="group">
        <h4>Active for this agent</h4>
        <button
          class="choice"
          class:selected={platformSelected}
          type="button"
          onclick={usePlatformDefault}
        >
          <strong>{platformLabel}</strong>
          <span class="meta">Platform key · no BYOK</span>
        </button>
        {#each profiles as profile (profile.id)}
          <div class="row">
            <button
              class="choice"
              class:selected={selection === profile.id ||
                (selection === null && profile.active)}
              type="button"
              disabled={busyId === profile.id}
              onclick={() => void onActivate(profile)}
            >
              <strong>{profile.name}</strong>
              <span class="meta">
                {profile.provider}/{profile.model} · …{profile.apiKeyLast4}
                {#if profile.active}
                  · server-active
                {/if}
              </span>
            </button>
            <button
              class="ghost danger"
              type="button"
              disabled={busyId === profile.id}
              onclick={() => void onDelete(profile)}
            >
              Delete
            </button>
          </div>
        {/each}
      </div>

      <form class="install" onsubmit={(event) => void onCreate(event)}>
        <h4>Add model profile</h4>
        <label>
          Name
          <input bind:value={name} maxlength="48" />
        </label>
        <label>
          Provider
          <select
            value={provider}
            onchange={onProviderChange}
          >
            {#each catalog as entry (entry.id)}
              <option value={entry.id}>{entry.label}</option>
            {/each}
          </select>
        </label>
        <label>
          API key
          <input
            value={apiKey}
            oninput={onApiKeyInput}
            type="password"
            autocomplete="off"
            spellcheck="false"
            placeholder={catalog.find((e) => e.id === provider)?.keyHint ??
              "Provider API key"}
          />
        </label>
        <button
          class="ghost discover"
          type="button"
          disabled={discovering || apiKey.trim().length < 8}
          onclick={() => void onDiscover()}
        >
          {discovering ? "Discovering…" : "Discover models"}
        </button>
        <label>
          Model
          <select bind:value={model} disabled={!discoveryReady}>
            {#each modelsForProvider as entry (entry.id)}
              <option value={entry.id}>{entry.label}</option>
            {/each}
          </select>
          <span class="hint">
            {#if discoveryReady}
              {discoveredModels.length} models available to this key
            {:else}
              Discover with your key to load the models you can use
            {/if}
          </span>
        </label>
        <button
          class="primary"
          type="submit"
          disabled={busyId === "__create__" ||
            !storeConfigured ||
            !discoveryReady ||
            !model}
        >
          Save & use
        </button>
      </form>
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
  .state,
  .meta {
    margin: 0;
    color: var(--muted);
    font-size: 12px;
    line-height: 1.4;
  }

  .state.error {
    color: var(--red);
  }

  .choice {
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid var(--line);
    color: var(--ink);
    padding: 8px;
    cursor: pointer;
    display: grid;
    gap: 2px;
  }

  .choice.selected {
    border-color: var(--accent);
  }

  .row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 6px;
    align-items: stretch;
  }

  button.danger {
    color: var(--red);
  }

  button.discover {
    width: fit-content;
  }

  .install {
    display: grid;
    gap: 8px;
  }

  label {
    display: grid;
    gap: 4px;
    font-size: 12px;
    color: var(--muted);
  }

  .hint {
    color: var(--muted);
    font-size: 11px;
  }

  input,
  select {
    background: var(--paper);
    color: var(--ink);
    border: 1px solid var(--line);
    font: inherit;
    font-size: 12px;
    padding: 8px;
  }

  code {
    font-size: 11px;
  }

  .group {
    display: grid;
    gap: 8px;
  }
</style>
