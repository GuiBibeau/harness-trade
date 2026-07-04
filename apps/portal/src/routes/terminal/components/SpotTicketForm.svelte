<script lang="ts">
  import {
    triggerOrderView,
    type SpotAsset,
    type TriggerOrder,
  } from "$lib/spot";
  import type { SpotTicket } from "$lib/terminal/spot-ticket";
  import { stepInput } from "$lib/terminal/step-input";
  import { formatNumber, formatPrice } from "$lib/utils";

  // Spot ticket form: side/amount/type/limit + the Jupiter quote lifecycle
  // live in the shared spot-ticket store; both render sites (right rail +
  // stacked book slot) read the same instance. Money logic — the swap and
  // limit-order submit paths, the deviation arm/confirm state, size chips
  // against wallet balances — stays in +page.svelte as callbacks.
  let {
    ticket,
    spotAsset,
    spotAssets,
    spotChipBalance,
    usdcBalanceText,
    spotHolding,
    phoenixAuthority,
    spotBusy,
    spotSignature,
    canSubmit,
    limitArmed,
    limitBlocked,
    limitDeviationPct,
    triggerOrders,
    triggerBusy,
    onswap,
    onlimitsubmit,
    onopenauth,
    onchip,
    oncancelorder,
  }: {
    ticket: SpotTicket;
    spotAsset: SpotAsset | null;
    spotAssets: SpotAsset[];
    spotChipBalance: number;
    usdcBalanceText: string;
    spotHolding: number;
    phoenixAuthority: string;
    spotBusy: boolean;
    spotSignature: string;
    canSubmit: boolean;
    limitArmed: boolean;
    limitBlocked: boolean;
    limitDeviationPct: number | null;
    triggerOrders: TriggerOrder[];
    triggerBusy: boolean;
    onswap: () => void | Promise<void>;
    onlimitsubmit: () => void;
    onopenauth: () => void;
    onchip: (pct: number | "max") => void;
    oncancelorder: (orderKey: string) => void | Promise<void>;
  } = $props();

  // The store bundle is created once by the page and never replaced —
  // destructuring keeps every `$` subscription identical to the page's.
  // svelte-ignore state_referenced_locally
  const {
    spotSide,
    spotAmount,
    spotOrderType,
    spotLimitPrice,
    spotQuote,
    spotQuoteStatus,
    spotQuoteError,
    scheduleQuote,
    flipSide,
  } = ticket;

  // ── Spot size chips ────────────────────────────────────────────────
  // % of wallet USDC on buy, % of the token holding on sell — the same
  // balances that power the ticket preview (the chip math stays in the
  // page; these are just the offered percentages).
  const SPOT_CHIP_PCTS = [25, 50];
</script>

{#if spotAsset}
  <div class="spot-asset-head">
    {#if spotAsset.imageUrl}
      <img class="spot-logo" src={spotAsset.imageUrl} alt="" loading="lazy" />
    {/if}
    <div class="spot-asset-name">
      <strong>{spotAsset.symbol}</strong>
      <small>{spotAsset.name}</small>
    </div>
    <b
      class:positive={(spotAsset.change24hPct ?? 0) >= 0}
      class:negative={(spotAsset.change24hPct ?? 0) < 0}
    >
      {formatPrice(spotAsset.price)}
    </b>
  </div>

  <div class="side-toggle" role="group" aria-label="Spot side">
    <button
      class:active={$spotSide === "buy"}
      type="button"
      onclick={() => flipSide("buy")}
    >
      Buy
    </button>
    <button
      class:active={$spotSide === "sell"}
      type="button"
      onclick={() => flipSide("sell")}
    >
      Sell
    </button>
  </div>

  <div class="side-toggle" role="group" aria-label="Spot order type">
    <button
      class:active={$spotOrderType === "market"}
      type="button"
      onclick={() => ($spotOrderType = "market")}
    >
      Market
    </button>
    <button
      class:active={$spotOrderType === "limit"}
      type="button"
      onclick={() => ($spotOrderType = "limit")}
    >
      Limit
    </button>
  </div>

  <div class="field">
    <label>
      {$spotSide === "buy" ? "Spend (USDC)" : `Sell (${spotAsset.symbol})`}
      <input
        bind:value={$spotAmount}
        oninput={scheduleQuote}
        inputmode="decimal"
        placeholder={$spotSide === "buy" ? "25" : "0.5"}
        use:stepInput={{ kind: $spotSide === "buy" ? "usd" : "price" }}
      />
    </label>
    <div class="chip-row" role="group" aria-label="Spot size presets">
      {#each SPOT_CHIP_PCTS as pct (pct)}
        <button
          class="pct-chip"
          type="button"
          disabled={spotChipBalance <= 0}
          onclick={() => onchip(pct)}
        >
          {pct}%
        </button>
      {/each}
      <button
        class="pct-chip"
        type="button"
        disabled={spotChipBalance <= 0}
        onclick={() => onchip("max")}
      >
        Max
      </button>
    </div>
  </div>

  {#if $spotOrderType === "limit"}
    <label>
      Limit price (USDC)
      <input
        bind:value={$spotLimitPrice}
        inputmode="decimal"
        placeholder={formatPrice(spotAsset.price)}
        use:stepInput={{ kind: "price" }}
      />
    </label>
  {/if}

  <div class="ticket-preview">
    <div class="preview-row">
      <span>You receive</span>
      <b>
        {#if $spotOrderType === "limit"}
          {#if Number($spotLimitPrice) > 0 && Number($spotAmount) > 0}
            {$spotSide === "buy"
              ? `${formatNumber(Number($spotAmount) / Number($spotLimitPrice), 4)} ${spotAsset.symbol}`
              : `${formatNumber(Number($spotAmount) * Number($spotLimitPrice), 2)} USDC`}
          {:else}—{/if}
        {:else if $spotQuoteStatus === "quoting"}…{:else if $spotQuote}
          {formatNumber($spotQuote.outUi, $spotSide === "buy" ? 4 : 2)}
          {$spotSide === "buy" ? spotAsset.symbol : "USDC"}
        {:else}—{/if}
      </b>
    </div>
    <div class="preview-row">
      <span>Price impact</span>
      <b class:negative={$spotQuote ? $spotQuote.priceImpactPct * 100 > 1 : false}>
        {$spotQuote ? `${($spotQuote.priceImpactPct * 100).toFixed(2)}%` : "--"}
      </b>
    </div>
    <div class="preview-row">
      <span>Wallet USDC</span>
      <b>{usdcBalanceText}</b>
    </div>
    <div class="preview-row">
      <span>You hold</span>
      <b>{formatNumber(spotHolding, 4)} {spotAsset.symbol}</b>
    </div>
  </div>

  <div class="ticket-actions">
    <p class="ticket-status" class:error={$spotQuoteStatus === "error"}>
      {#if $spotQuoteStatus === "error"}
        {$spotQuoteError}
      {:else if spotSignature}
        Swap submitted ·
        <a class="news-domain" href={`https://solscan.io/tx/${spotSignature}`} target="_blank" rel="noopener noreferrer">view tx</a>
      {:else}
        &nbsp;
      {/if}
    </p>

    {#if !phoenixAuthority}
      <button class="primary wide" type="button" onclick={onopenauth}>
        Connect account to trade
      </button>
    {:else if $spotOrderType === "limit"}
      <button
        class="primary wide"
        class:armed={limitArmed}
        type="button"
        disabled={!canSubmit || limitBlocked}
        onclick={onlimitsubmit}
      >
        {#if spotBusy}<span class="spinner" aria-hidden="true"></span>{/if}
        {spotBusy
          ? "Signing…"
          : limitBlocked
            ? `Price ${formatNumber(Math.abs(limitDeviationPct ?? 0), 1)}% from mark — check decimals`
            : limitArmed
              ? `Confirm limit ${formatNumber(Math.abs(limitDeviationPct ?? 0), 1)}% from mark`
              : `Limit ${$spotSide} ${spotAsset.symbol} @ ${$spotLimitPrice || "—"}`}
      </button>
    {:else}
      <button
        class="primary wide"
        type="button"
        disabled={!canSubmit}
        onclick={onswap}
      >
        {#if spotBusy}<span class="spinner" aria-hidden="true"></span>{/if}
        {spotBusy
          ? "Signing…"
          : `${$spotSide === "buy" ? "Buy" : "Sell"} ${spotAsset.symbol} · spot`}
      </button>
    {/if}
  </div>

  {#if triggerOrders.length > 0}
    <div class="venue-section">Open limit orders</div>
    {#each triggerOrders as order (order.orderKey)}
      {@const view = triggerOrderView(order, spotAssets)}
      {#if view}
        <div class="venue-row">
          <span class={view.side === "buy" ? "positive" : "negative"}>
            LIMIT {view.side.toUpperCase()} {view.symbol}
          </span>
          <b>
            {view.notionalUsd !== null ? `$${formatNumber(view.notionalUsd, 2)}` : "--"}
            @ {formatPrice(view.limitPrice)}
          </b>
          <button
            class="row-action"
            type="button"
            disabled={triggerBusy}
            onclick={() => oncancelorder(order.orderKey)}
          >
            Cancel
          </button>
        </div>
      {/if}
    {/each}
  {/if}
{:else}
  <div class="empty">Loading spot assets…</div>
{/if}

<style>
  .spot-asset-head {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.55rem;
    padding: 0.2rem 0.1rem;
  }

  /* .spot-logo lives in terminal.css — shared with the spot list rendered
     inside SpotMarketsPanel.svelte. */

  .spot-asset-name {
    display: grid;
    line-height: 1.15;
    min-width: 0;
  }

  .spot-asset-name strong {
    font-size: 0.88rem;
  }

  .spot-asset-name small {
    color: var(--muted);
    font-size: 0.66rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spot-asset-head > b {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
  }

  /* ── Trade ticket (scoped copy — TicketForm keeps the twin) ───────── */
  .field {
    display: grid;
    gap: 0.3rem;
    align-content: start;
  }

  .pct-chip {
    flex: 1;
    min-height: 1.4rem;
    padding: 0.05rem 0.2rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.66rem;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--line);
    cursor: pointer;
  }

  .pct-chip:hover:not(:disabled) {
    color: var(--ink);
    border-color: var(--muted);
  }

  .pct-chip:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* Reserved single-line status (error / tx link / blank). */
  .ticket-status {
    margin: 0;
    min-height: 1.2rem;
    font-size: 0.74rem;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ticket-status.error {
    color: var(--red);
  }

  /* The primary action never requires scrolling: status + submit stick to
     the bottom of the ticket scroller on an opaque footer. */
  .ticket-actions {
    position: sticky;
    bottom: 0;
    display: grid;
    gap: 0.45rem;
    margin: 0 -0.65rem;
    padding: 0.35rem 0.65rem 0.6rem;
    background: var(--surface);
    border-top: 1px solid var(--line-soft);
  }
</style>
