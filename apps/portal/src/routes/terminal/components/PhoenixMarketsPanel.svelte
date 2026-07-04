<script lang="ts">
  import type { AiRead } from "$lib/ai";
  import type { PhoenixMarketConfig } from "$lib/phoenix-market-data";
  import { panelStyle, usePanelLayout } from "$lib/terminal/layout";
  import { formatPrice } from "$lib/utils";
  import AiReadLine from "./AiReadLine.svelte";
  import DragHead from "./DragHead.svelte";

  let {
    markets,
    marketMids,
    scannerRead,
    selectedSymbol,
    onmarketchange,
  }: {
    markets: PhoenixMarketConfig[];
    marketMids: Record<string, number>;
    scannerRead: AiRead;
    selectedSymbol: string;
    onmarketchange: (symbol: string) => void;
  } = $props();

  const {
    panelOrder,
    draggedPanel,
    dragOverPanel,
    onPanelDragOver,
    onPanelDragLeave,
    onPanelDrop,
  } = usePanelLayout();
</script>

<section
  id="section-markets"
  class="panel watchlist-panel"
  role="group"
  data-panel="markets"
  style={panelStyle("markets", $panelOrder)}
  class:dragging={$draggedPanel === "markets"}
  class:drag-over={$dragOverPanel === "markets"}
  ondragover={(event) => onPanelDragOver(event, "markets")}
  ondragleave={() => onPanelDragLeave("markets")}
  ondrop={(event) => onPanelDrop(event, "markets")}
>
  <div class="panel-head">
    <DragHead panelId="markets" kicker="PHOENIX_MARKETS" title={`${markets.length} perp markets`} />
  </div>
  <AiReadLine read={scannerRead} />
  <div class="markets-list">
    {#each markets as market}
      <button
        class:selected-market={market.symbol === selectedSymbol}
        type="button"
        onclick={() => onmarketchange(market.symbol)}
      >
        <span>{market.symbol}</span>
        <b>{formatPrice(marketMids[market.symbol])}</b>
        <em>{market.marketStatus}</em>
      </button>
    {:else}
      <div class="empty">Loading Phoenix market list.</div>
    {/each}
  </div>
</section>
