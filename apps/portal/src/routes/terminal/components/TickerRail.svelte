<script lang="ts">
  import type { NewsItem } from "$lib/intel";
  import type { PhoenixMarketStats } from "$lib/phoenix-market-data";
  import type { SpotAsset } from "$lib/spot";
  import { SECTION_LINKS } from "$lib/terminal/prefs";
  import { formatNumber, formatPercent, formatPrice } from "$lib/utils";
  import NewsMarquee from "./NewsMarquee.svelte";
  import TickerStat from "./TickerStat.svelte";

  // Hot leaf: the grouped perp/spot models are rebuilt by the page per tick
  // (accepted — same bindings re-evaluated before the split); every field is
  // an already-derived page value, nothing is recomputed here.
  let {
    perp,
    spot,
    streamHealth,
    marketFresh,
    tradeMode,
    selectedSymbol,
    watchlist,
    news,
    activeSection,
    topbarHeight,
    railHeight = $bindable(0),
    ontogglewatch,
    onopenpalette,
    onsectionselect,
  }: {
    perp: {
      price: number | null;
      change: number | null;
      stats: PhoenixMarketStats | null;
      spreadBps: number;
      fundingPercent: number | null;
      basisBps: number | null;
      loading: { price: boolean; stats: boolean; book: boolean; updated: boolean };
    };
    spot: { asset: SpotAsset | null; basisBps: number | null };
    streamHealth: "connecting" | "live" | "stale" | "offline";
    marketFresh: string;
    tradeMode: "perps" | "spot";
    selectedSymbol: string;
    watchlist: string[];
    news: NewsItem[];
    activeSection: string;
    topbarHeight: number;
    railHeight?: number;
    ontogglewatch: (symbol: string) => void;
    onopenpalette: () => void;
    onsectionselect: (id: string) => void;
  } = $props();

  // Aliases keep the moved markup verbatim against the page's names.
  const spotAsset = $derived(spot.asset);
  const spotBasisBps = $derived(spot.basisBps);
  const chartPrice = $derived(perp.price);
  const change24h = $derived(perp.change);
  const marketStats = $derived(perp.stats);
  const spreadBps = $derived(perp.spreadBps);
  const fundingPercent = $derived(perp.fundingPercent);
  const perpBasisBps = $derived(perp.basisBps);
  const priceLoading = $derived(perp.loading.price);
  const statsLoading = $derived(perp.loading.stats);
  const bookLoading = $derived(perp.loading.book);
  const updatedLoading = $derived(perp.loading.updated);
</script>

<div
  class="market-rail"
  bind:clientHeight={railHeight}
  style={`--rail-top: ${topbarHeight}px;`}
>
  <div class="ticker" role="status" aria-live="polite">
    {#if tradeMode === "spot" && spotAsset}
      <div class="ticker-symbol">
        <button
          class="star-btn"
          class:starred={watchlist.includes(spotAsset.symbol.toUpperCase())}
          type="button"
          aria-label="Toggle watchlist"
          onclick={() => spotAsset && ontogglewatch(spotAsset.symbol)}
        >{watchlist.includes(spotAsset.symbol.toUpperCase()) ? "★" : "☆"}</button>
        <button class="ticker-market" type="button" onclick={onopenpalette} title="Change market — press /">
          <strong>{spotAsset.symbol}</strong>
          <span class="ticker-caret" aria-hidden="true">▾</span>
        </button>
        <span class="ticker-health">spot</span>
      </div>
      <div class="ticker-price">
        <b
          class:positive={(spotAsset.change24hPct ?? 0) >= 0}
          class:negative={(spotAsset.change24hPct ?? 0) < 0}
        >
          {formatPrice(spotAsset.price)}
        </b>
        <em
          class:positive={(spotAsset.change24hPct ?? 0) >= 0}
          class:negative={(spotAsset.change24hPct ?? 0) < 0}
        >
          {formatPercent(spotAsset.change24hPct)} 24h
        </em>
      </div>
      <div class="ticker-stats">
        <TickerStat label="Liquidity" value={`$${formatNumber(spotAsset.liquidityUsd, 0)}`} width="6rem" loading={false} />
        <TickerStat label="Mkt Cap" value={`$${formatNumber(spotAsset.marketCap, 0)}`} width="6rem" loading={false} />
        <TickerStat label="24h Vol" value={`$${formatNumber(spotAsset.volume24hUsd, 0)}`} width="6.5rem" loading={false} />
        <TickerStat label="Venue" value="Jupiter" width="4.5rem" loading={false} />
        <TickerStat label="Trust" value={spotAsset.trustTier || "—"} width="4rem" loading={false} />
        {#if spotBasisBps !== null}
          <TickerStat
            label="Perp basis"
            value={`${spotBasisBps >= 0 ? "+" : ""}${formatNumber(spotBasisBps, 0)} bps`}
            width="5.5rem"
            loading={false}
            valueClass={spotBasisBps >= 0 ? "positive" : "negative"}
          />
        {/if}
      </div>
    {:else}
      <div class="ticker-symbol">
        <button
          class="star-btn"
          class:starred={watchlist.includes(selectedSymbol)}
          type="button"
          aria-label="Toggle watchlist"
          onclick={() => ontogglewatch(selectedSymbol)}
        >{watchlist.includes(selectedSymbol) ? "★" : "☆"}</button>
        <button class="ticker-market" type="button" onclick={onopenpalette} title="Change market — press /">
          <strong>{selectedSymbol}-PERP</strong>
          <span class="ticker-caret" aria-hidden="true">▾</span>
        </button>
        <span class="ticker-health">{streamHealth}</span>
      </div>
      <div class="ticker-price">
        {#if priceLoading}
          <span class="skeleton skel-price" aria-hidden="true"></span>
        {:else}
          <b
            class:positive={(change24h ?? 0) >= 0}
            class:negative={(change24h ?? 0) < 0}
          >
            {formatPrice(chartPrice)}
          </b>
          <em
            class:positive={(change24h ?? 0) >= 0}
            class:negative={(change24h ?? 0) < 0}
          >
            {formatPercent(change24h)} 24h
          </em>
        {/if}
      </div>
      <div class="ticker-stats">
        <TickerStat label="Mark" value={formatPrice(marketStats?.markPx)} width="4.5rem" loading={statsLoading} />
        <TickerStat label="Oracle" value={formatPrice(marketStats?.oraclePx)} width="4.5rem" loading={statsLoading} />
        <TickerStat label="Spread" value={`${formatNumber(spreadBps, 1)} bps`} width="4.5rem" loading={bookLoading} />
        <TickerStat
          label="Funding"
          value={formatPercent(fundingPercent)}
          width="4rem"
          loading={statsLoading}
          valueClass={(fundingPercent ?? 0) >= 0 ? "positive" : "negative"}
        />
        {#if perpBasisBps !== null}
          <TickerStat
            label="Basis"
            value={`${perpBasisBps >= 0 ? "+" : ""}${formatNumber(perpBasisBps, 0)} bps`}
            width="4.5rem"
            loading={false}
            valueClass={perpBasisBps >= 0 ? "positive" : "negative"}
          />
        {/if}
        <TickerStat label="Open Int" value={formatNumber(marketStats?.openInterest, 0)} width="5rem" loading={statsLoading} />
        <TickerStat label="24h Vol" value={formatNumber(marketStats?.dayNtlVlm, 0)} width="6.5rem" loading={statsLoading} />
        <TickerStat label="Updated" value={marketFresh} width="4.5rem" loading={updatedLoading} />
      </div>
    {/if}
  </div>

  <nav class="section-nav" aria-label="Jump to terminal section">
    {#each SECTION_LINKS as link}
      <button
        type="button"
        class:active={activeSection === link.id}
        onclick={() => onsectionselect(link.id)}
      >
        {link.label}
      </button>
    {/each}
  </nav>

  <NewsMarquee {news} />
</div>

<style>
  .market-rail {
    /* Sticky on every width: prices/funding stay in view while scrolling.
       Desktop pins below the sticky topbar (measured height via the inline
       var); the sub-1100px override returns it to the viewport top where
       the topbar goes static. */
    position: sticky;
    top: var(--rail-top, 0px);
    z-index: 15;
    background: rgba(8, 10, 13, 0.92);
    backdrop-filter: blur(16px);
    border-bottom: 1px solid var(--line-soft);
  }

  .ticker {
    display: flex;
    align-items: center;
    gap: clamp(0.6rem, 2vw, 1.4rem);
    padding: 0.5rem clamp(0.75rem, 2vw, 1.25rem);
    overflow-x: auto;
    scrollbar-width: thin;
    white-space: nowrap;
  }

  .ticker-symbol {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    flex: 0 0 auto;
  }

  .ticker-symbol strong {
    font-size: 0.9rem;
    font-weight: 800;
    letter-spacing: 0.01em;
  }

  .ticker-health {
    display: inline-block;
    min-width: 4.7rem;
    font-size: 0.62rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }

  /* Ticker symbol doubles as a palette opener. */
  .ticker-market {
    display: inline-flex;
    align-items: baseline;
    gap: 0.3rem;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 0;
    cursor: pointer;
    font: inherit;
  }

  .ticker-caret {
    color: var(--faint);
    font-size: 0.7rem;
  }

  .ticker-market:hover .ticker-caret {
    color: var(--ink);
  }

  .ticker-price {
    display: inline-flex;
    align-items: baseline;
    gap: 0.5rem;
    flex: 0 0 auto;
    min-width: 11rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  .ticker-price b {
    font-size: 1.05rem;
    font-weight: 800;
  }

  .ticker-price em {
    font-size: 0.78rem;
    font-style: normal;
    font-weight: 600;
  }

  .ticker-stats {
    display: inline-flex;
    align-items: center;
    gap: clamp(0.6rem, 1.8vw, 1.35rem);
    flex: 1 1 auto;
    min-width: 0;
  }

  .skel-price {
    width: 8.5rem;
    height: 1rem;
    align-self: center;
  }

  .star-btn {
    background: transparent;
    border: 0;
    color: var(--faint);
    font-size: 0.85rem;
    line-height: 1;
    padding: 0 0.15rem;
    cursor: pointer;
  }
  .star-btn:hover { color: var(--ink); }
  .star-btn.starred { color: var(--accent); }

  .section-nav {
    display: none;
    gap: 0.35rem;
    padding: 0.4rem clamp(0.75rem, 2vw, 1.25rem);
    overflow-x: auto;
    scrollbar-width: none;
    border-top: 1px solid var(--line-soft);
  }

  .section-nav::-webkit-scrollbar {
    display: none;
  }

  .section-nav button {
    flex: 0 0 auto;
    border: 1px solid var(--line);
    border-radius: 0;
    background: var(--surface-2);
    color: var(--muted);
    font-size: 0.74rem;
    font-weight: 600;
    min-height: 2rem;
    padding: 0.3rem 0.85rem;
  }

  .section-nav button.active {
    color: #04130d;
    background: var(--accent);
    border-color: var(--accent);
  }

  @media (max-width: 1100px) {
    .market-rail {
      position: sticky;
      top: 0;
    }

    .section-nav {
      display: flex;
    }
  }

  @media (max-width: 720px) {
    .ticker-symbol strong {
      font-size: 0.82rem;
    }

    .ticker-price b {
      font-size: 0.95rem;
    }
  }
</style>
