<script lang="ts">
  import type { PhoenixMarketConfig } from "$lib/phoenix-market-data";
  import type { SpotAsset } from "$lib/spot";
  import { panelStyle, usePanelLayout } from "$lib/terminal/layout";
  import { buildWatchRows, type WatchRow } from "$lib/terminal/panels";
  import { formatNumber, formatPercent, formatPrice } from "$lib/utils";
  import DragHead from "./DragHead.svelte";

  let {
    watchlist,
    spotAssets,
    marketMids,
    markets,
    onopenrow,
  }: {
    watchlist: string[];
    spotAssets: SpotAsset[];
    marketMids: Record<string, number>;
    markets: PhoenixMarketConfig[];
    onopenrow: (row: WatchRow) => void;
  } = $props();

  const {
    panelOrder,
    draggedPanel,
    dragOverPanel,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  } = usePanelLayout();

  // Watchlist rows: price from spot, fall back to perp mid; basis when both.
  const watchRows = $derived(
    buildWatchRows(watchlist, spotAssets, marketMids, markets),
  );
</script>

<section
  class="panel watchlist-panel"
  role="group"
  data-panel="watch"
  style={panelStyle("watch", $panelOrder)}
  class:dragging={$draggedPanel === "watch"}
  class:drag-over={$dragOverPanel === "watch"}
  ondragover={(event) => onPanelDragOver(event, "watch")}
  ondragleave={() => onPanelDragLeave("watch")}
  ondrop={(event) => onPanelDrop(event, "watch")}
>
  <div class="panel-head">
    <DragHead panelId="watch" kicker="WATCHLIST" title={`${watchlist.length} starred`} />
  </div>
  <div class="markets-list">
    {#each watchRows as row (row.sym)}
      <button type="button" onclick={() => onopenrow(row)}>
        <span>
          {row.sym}
          {#if row.basisBps !== null}
            <small
              class="basis-tag"
              class:positive={row.basisBps >= 0}
              class:negative={row.basisBps < 0}
            >{row.basisBps >= 0 ? "+" : ""}{formatNumber(row.basisBps, 0)}bp</small>
          {/if}
        </span>
        <b>{formatPrice(row.price)}</b>
        <em
          class:positive={(row.change ?? 0) >= 0}
          class:negative={(row.change ?? 0) < 0}
        >{row.change !== null ? formatPercent(row.change) : row.hasPerp ? "perp" : ""}</em>
      </button>
    {:else}
      <div class="empty">Star a market (☆ in the ticker) to track it here.</div>
    {/each}
  </div>
</section>

<style>
  .basis-tag {
    font-size: 0.6rem;
    font-weight: 600;
    margin-left: 0.3rem;
    opacity: 0.9;
  }
</style>
