<script lang="ts">
  import type { DepthLevel } from "$lib/phoenix-market-data";
  import {
    bookLevelNotional,
    bookLevelTotalNotional,
    depthWidth,
    formatBookPrice,
  } from "$lib/terminal/book";
  import { formatNumber } from "$lib/utils";

  // Hot leaf: props are the page's already-derived ladder slices (new arrays
  // per rAF book flush) — no recomputation here beyond per-row formatting.
  let {
    asks,
    bids,
    spread,
    spreadPercent,
    maxNotional,
    onpick,
  }: {
    asks: DepthLevel[];
    bids: DepthLevel[];
    spread: number;
    spreadPercent: number;
    maxNotional: number;
    onpick: (price: number, side: "ask" | "bid") => void;
  } = $props();
</script>

<div class="book book-ladder">
  <div class="book-header">
    <span>Price USDC</span>
    <span>Size USDC</span>
    <span>Total USDC</span>
  </div>

  {#each asks as ask}
    <button type="button" class="book-row ask" onclick={() => onpick(ask.price, "ask")}>
      <span class="depth-bar" style={`width: ${depthWidth(ask, maxNotional)}%;`}></span>
      <span class="book-price">{formatBookPrice(ask.price)}</span>
      <span>{formatNumber(bookLevelNotional(ask), 0)}</span>
      <span>{formatNumber(bookLevelTotalNotional(ask), 0)}</span>
    </button>
  {/each}

  <div class="spread-row">
    <span>{formatBookPrice(spread)}</span>
    <strong>Spread</strong>
    <span>{formatNumber(spreadPercent, 3)}%</span>
  </div>

  {#each bids as bid}
    <button type="button" class="book-row bid" onclick={() => onpick(bid.price, "bid")}>
      <span class="depth-bar" style={`width: ${depthWidth(bid, maxNotional)}%;`}></span>
      <span class="book-price">{formatBookPrice(bid.price)}</span>
      <span>{formatNumber(bookLevelNotional(bid), 0)}</span>
      <span>{formatNumber(bookLevelTotalNotional(bid), 0)}</span>
    </button>
  {:else}
    <div class="empty">No live order book levels loaded.</div>
  {/each}
</div>

<style>
  /* Rule order mirrors the page cascade the ladder was cut from: the base
     button rules (shared with the chart-toolbar buttons over there) come
     first, then the grid shape, then the ladder-density overrides. */
  .book-row {
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--ink);
    min-height: 2rem;
    padding: 0.35rem 0.65rem;
    transition:
      border-color 160ms ease,
      background 160ms ease,
      transform 160ms ease;
  }

  .book-row:hover {
    transform: translateY(-1px);
    border-color: rgba(255, 77, 151, 0.55);
  }

  .book {
    display: grid;
    gap: 0.15rem;
    padding: 0.65rem;
  }

  .book-row {
    display: grid;
    grid-template-columns: 3rem minmax(0, 1fr) 4.25rem 4rem;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    min-height: 1.8rem;
    font-size: 0.75rem;
    text-align: left;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  /* Was `.orderbook-panel .book` / `.orderbook-panel .book-ladder` in the
     page — the ladder only ever renders inside the orderbook panel, so the
     qualifier collapses at the component boundary. */
  .book {
    min-height: 0;
    overflow: auto;
  }

  .book-ladder {
    flex: 1;
    align-content: start;
    gap: 0.06rem;
    padding: 0.28rem 0.46rem 0.42rem;
  }

  .book-header,
  .book-ladder .book-row,
  .spread-row {
    display: grid;
    grid-template-columns: minmax(4.1rem, 1fr) minmax(4.1rem, 1fr) minmax(4.1rem, 1fr);
    align-items: center;
    gap: 0.32rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .book-header {
    min-height: 1.18rem;
    color: #9ca9bd;
    font-family: Inter, ui-sans-serif, system-ui, sans-serif;
    font-size: 0.64rem;
    line-height: 1;
  }

  .book-header span:nth-child(2),
  .book-header span:nth-child(3),
  .book-ladder .book-row span:nth-child(3),
  .book-ladder .book-row span:nth-child(4),
  .spread-row span:last-child {
    text-align: right;
  }

  .book-ladder .book-row {
    position: relative;
    min-height: 1.08rem;
    overflow: hidden;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    padding: 0 0.3rem;
    font-size: 0.64rem;
    line-height: 1;
  }

  .book-ladder .book-row:hover {
    border-color: transparent;
    background: rgba(255, 255, 255, 0.035);
    transform: none;
  }

  .book-ladder .book-row span:not(.depth-bar) {
    position: relative;
    z-index: 1;
  }

  .book-ladder .book-price {
    font-weight: 800;
  }

  .book-ladder .book-row.ask .book-price {
    color: var(--down);
  }

  .book-ladder .book-row.bid .book-price {
    color: var(--up);
  }

  .depth-bar {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 0;
    z-index: 0;
    border-radius: 0;
    pointer-events: none;
  }

  .book-ladder .book-row.ask .depth-bar {
    background: rgba(255, 90, 106, 0.24);
  }

  .book-ladder .book-row.bid .depth-bar {
    background: rgba(44, 233, 127, 0.22);
  }

  .spread-row {
    min-height: 1.28rem;
    margin: 0.1rem 0;
    background: rgba(255, 255, 255, 0.05);
    color: var(--ink);
    padding: 0 0.3rem;
    font-size: 0.64rem;
    line-height: 1;
  }

  .spread-row strong {
    text-align: center;
  }

  @media (max-width: 720px) {
    .book-row {
      grid-template-columns: minmax(0, 1fr) auto;
    }
  }
</style>
