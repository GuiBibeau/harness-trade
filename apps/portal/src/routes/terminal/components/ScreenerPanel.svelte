<script lang="ts">
  import type { SpotAsset } from "$lib/spot";
  import { panelStyle, usePanelLayout } from "$lib/terminal/layout";
  import {
    buildScreenRows,
    type ScreenHub,
    type ScreenSort,
  } from "$lib/terminal/panels";
  import { formatPercent, formatPrice } from "$lib/utils";
  import DragHead from "./DragHead.svelte";

  let {
    spotAssets,
    tradeMode,
    spotAsset,
    sort = $bindable(),
    hub = $bindable(),
    onselect,
  }: {
    spotAssets: SpotAsset[];
    tradeMode: "perps" | "spot";
    spotAsset: SpotAsset | null;
    // Persisted prefs — bindable so the page's persistPrefs keeps tracking them.
    sort: ScreenSort;
    hub: ScreenHub;
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

  // Screener rows over the catalog.
  const screenRows = $derived(buildScreenRows(spotAssets, hub, sort));
</script>

<section
  class="panel watchlist-panel"
  role="group"
  data-panel="screener"
  style={panelStyle("screener", $panelOrder)}
  class:dragging={$draggedPanel === "screener"}
  class:drag-over={$dragOverPanel === "screener"}
  ondragover={(event) => onPanelDragOver(event, "screener")}
  ondragleave={() => onPanelDragLeave("screener")}
  ondrop={(event) => onPanelDrop(event, "screener")}
>
  <div class="panel-head">
    <DragHead panelId="screener" kicker="SCREENER" title={`${screenRows.length} of ${spotAssets.length}`} />
  </div>
  <div class="screen-controls">
    {#each [["movers", "Movers"], ["volume", "Volume"], ["cap", "Mkt cap"]] as [key, label] (key)}
      <button
        class="screen-chip"
        class:active={sort === key}
        type="button"
        onclick={() => (sort = key as typeof sort)}
      >{label}</button>
    {/each}
    <span class="screen-sep" aria-hidden="true"></span>
    {#each [["all", "All"], ["crypto", "Crypto"], ["equities", "Stocks"], ["pre-ipo", "Pre-IPO"]] as [key, label] (key)}
      <button
        class="screen-chip"
        class:active={hub === key}
        type="button"
        onclick={() => (hub = key as typeof hub)}
      >{label}</button>
    {/each}
  </div>
  <div class="markets-list spot-list">
    {#each screenRows as asset (asset.assetId)}
      <button
        class:selected-market={tradeMode === "spot" && spotAsset?.assetId === asset.assetId}
        type="button"
        onclick={() => onselect(asset)}
      >
        <span>{asset.symbol}</span>
        <b>{formatPrice(asset.price)}</b>
        <em
          class:positive={(asset.change24hPct ?? 0) >= 0}
          class:negative={(asset.change24hPct ?? 0) < 0}
        >{formatPercent(asset.change24hPct)}</em>
      </button>
    {:else}
      <div class="empty">Loading the catalog…</div>
    {/each}
  </div>
</section>

<style>
  .screen-controls {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
    padding: 0 0 0.5rem;
  }
  .screen-chip {
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    color: var(--muted);
    font-size: 0.66rem;
    font-weight: 600;
    padding: 0.15rem 0.35rem;
    cursor: pointer;
  }
  .screen-chip:hover { color: var(--ink); }
  .screen-chip.active { color: var(--ink); border-bottom-color: var(--accent); }
  .screen-sep {
    width: 1px;
    height: 0.9rem;
    background: var(--line);
    margin: 0 0.25rem;
  }
</style>
