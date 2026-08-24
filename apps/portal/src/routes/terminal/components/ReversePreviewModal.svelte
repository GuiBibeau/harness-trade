<script lang="ts">
  import type { PhoenixPosition } from "$lib/phoenix-trade";
  import {
    formatDisplayMoney,
    type DisplayCurrencyCode,
  } from "$lib/terminal/display-currency";
  import { formatNumber, formatPrice } from "$lib/utils";
  import { onMount } from "svelte";

  let {
    position,
    mark,
    paperMode = false,
    displayCurrency = "USD",
    fxRate = 1,
    busy = false,
    onconfirm,
    onclose,
  }: {
    position: PhoenixPosition;
    mark: number | null;
    paperMode?: boolean;
    displayCurrency?: DisplayCurrencyCode;
    fxRate?: number;
    busy?: boolean;
    onconfirm: () => void;
    onclose: () => void;
  } = $props();

  let panel: HTMLElement | undefined = $state();

  const fromSide = $derived(position.size > 0 ? "LONG" : "SHORT");
  const toSide = $derived(position.size > 0 ? "SHORT" : "LONG");
  const qty = $derived(Math.abs(position.size));
  const notional = $derived(
    position.positionValue ??
      (mark !== null ? qty * mark : null),
  );

  onMount(() => {
    panel?.focus();
  });

  function onWinKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") onclose();
  }

  function onPanelKeydown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      onclose();
      return;
    }
    event.stopPropagation();
  }
</script>

<svelte:window onkeydown={onWinKeydown} />

<div class="modal-backdrop" role="presentation" onclick={() => onclose()}>
  <div
    bind:this={panel}
    class="modal close-preview"
    role="dialog"
    aria-modal="true"
    aria-label="Confirm reverse"
    tabindex="-1"
    onclick={(event) => event.stopPropagation()}
    onkeydown={onPanelKeydown}
  >
    <div class="panel-head">
      <div>
        <span class="kicker">{paperMode ? "PAPER" : "LIVE"}</span>
        <h2>Reverse {position.symbol}-PERP</h2>
      </div>
      <button class="row-action" type="button" onclick={onclose}>Cancel</button>
    </div>
    <div class="body mono">
      <p>
        Close <b>{fromSide}</b>
        {formatNumber(qty, 4)}
        {#if notional !== null}
          ({formatDisplayMoney(notional, displayCurrency, fxRate, 2)})
        {/if}
      </p>
      <p>
        → Open <b>{toSide}</b> same size
        {#if mark !== null}
          @ mark {formatPrice(mark)}
        {/if}
      </p>
      <p class="note">
        One signing ceremony — close + open in a single transaction.
      </p>
    </div>
    <div class="actions">
      <button
        class="primary"
        type="button"
        disabled={busy}
        onclick={onconfirm}
      >
        {#if busy}Reversing…{:else}Confirm reverse{/if}
      </button>
    </div>
  </div>
</div>

<style>
  .body {
    display: grid;
    gap: 0.45rem;
    padding: 0.75rem 0;
    font-size: 0.82rem;
    color: var(--muted);
  }
  .body b { color: var(--ink); font-weight: 700; }
  .note { color: var(--faint); font-size: 0.72rem; }
  .actions { display: flex; justify-content: flex-end; }
  .primary {
    border: 1px solid var(--ink);
    background: var(--ink);
    color: var(--bg);
    padding: 0.45rem 0.9rem;
    font-weight: 700;
    cursor: pointer;
  }
  .primary:disabled { opacity: 0.5; cursor: wait; }
</style>
