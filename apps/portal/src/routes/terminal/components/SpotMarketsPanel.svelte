<script lang="ts">
  import type { SpotAsset } from "$lib/spot";
  import { panelStyle, usePanelLayout } from "$lib/terminal/layout";
  import { formatPercent, formatPrice } from "$lib/utils";
  import DragHead from "./DragHead.svelte";

  let {
    spotAssets,
    tokenBalances,
    tradeMode,
    spotAsset,
    onselect,
  }: {
    spotAssets: SpotAsset[];
    tokenBalances: Record<string, number>;
    tradeMode: "perps" | "spot";
    spotAsset: SpotAsset | null;
    onselect: (asset: SpotAsset) => void;
  } = $props();

  const {
    panelOrder,
    draggedPanel,
    dragOverPanel,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  } = usePanelLayout();

  // Not persisted — resets per session by design.
  let spotSearch = $state("");
  const spotFiltered = $derived(
    spotSearch.trim()
      ? spotAssets.filter((asset) => {
          const query = spotSearch.trim().toLowerCase();
          return (
            asset.symbol.toLowerCase().includes(query) ||
            asset.name.toLowerCase().includes(query)
          );
        })
      : spotAssets,
  );
</script>

<section
  class="panel watchlist-panel"
  role="group"
  data-panel="spot"
  style={panelStyle("spot", $panelOrder)}
  class:dragging={$draggedPanel === "spot"}
  class:drag-over={$dragOverPanel === "spot"}
  ondragover={(event) => onPanelDragOver(event, "spot")}
  ondragleave={() => onPanelDragLeave("spot")}
  ondrop={(event) => onPanelDrop(event, "spot")}
>
  <div class="panel-head">
    <DragHead panelId="spot" kicker="SPOT_MARKETS" title={`${spotAssets.length} tokens.xyz assets`} />
    <span class="verdict-badge flat">Jupiter</span>
  </div>
  <div class="spot-search">
    <input
      bind:value={spotSearch}
      placeholder="Search token…"
      aria-label="Search spot assets"
    />
  </div>
  <div class="markets-list spot-list">
    {#each spotFiltered.slice(0, 30) as asset (asset.assetId)}
      <button
        class:selected-market={tradeMode === "spot" && spotAsset?.assetId === asset.assetId}
        type="button"
        onclick={() => onselect(asset)}
      >
        {#if asset.imageUrl}
          <img class="spot-logo" src={asset.imageUrl} alt="" loading="lazy" />
        {:else}
          <span class="spot-logo spot-logo-blank"></span>
        {/if}
        <span class="spot-row-sym">{asset.symbol}</span>
        <b>{formatPrice(asset.price)}</b>
        <em
          class:positive={(asset.change24hPct ?? 0) >= 0}
          class:negative={(asset.change24hPct ?? 0) < 0}
        >{formatPercent(asset.change24hPct)}</em>
        {#if tokenBalances[asset.mint]}
          <small class="spot-held">●</small>
        {/if}
      </button>
    {:else}
      <div class="empty">
        {spotSearch ? "No assets match." : "Loading tokens.xyz assets…"}
      </div>
    {/each}
  </div>
</section>

<style>
  .verdict-badge {
    flex: 0 0 auto;
    border-radius: 0;
    padding: 0.2rem 0.55rem;
    font-size: 0.62rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    white-space: nowrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .verdict-badge.flat {
    color: var(--muted);
    background: var(--surface-2);
    border-color: var(--line);
  }

  .spot-search {
    padding: 0.5rem 0.65rem 0.1rem;
  }

  .spot-search input {
    min-height: 1.9rem;
    font-size: 0.76rem;
  }

  .spot-list .spot-logo {
    width: 1.1rem;
    height: 1.1rem;
  }

  .spot-row-sym {
    font-weight: 800;
  }

  .spot-held {
    color: var(--accent);
    font-size: 0.5rem;
  }
</style>
