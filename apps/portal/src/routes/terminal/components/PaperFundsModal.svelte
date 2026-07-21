<script lang="ts">
  import { formatNumber } from "$lib/utils";

  let {
    open,
    freeUsd,
    equityUsd,
    marginUsd,
    openPositions,
    onclose,
    ontopup,
    onreset,
  }: {
    open: boolean;
    freeUsd: number;
    equityUsd: number;
    marginUsd: number;
    openPositions: number;
    onclose: () => void;
    ontopup: (amount: number) => void;
    onreset: () => void;
  } = $props();

  function swallowKeysExceptEscape(event: KeyboardEvent): void {
    if (event.key !== "Escape") event.stopPropagation();
  }
</script>

{#if open}
  <div class="modal-backdrop" role="presentation" onclick={() => onclose()}>
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-label="Paper funds"
      tabindex="-1"
      onclick={(event) => event.stopPropagation()}
      onkeydown={swallowKeysExceptEscape}
    >
      <div class="panel-head">
        <div>
          <p>PAPER_FUNDS</p>
          <h2>${formatNumber(equityUsd, 2)}</h2>
        </div>
        <button class="modal-close" type="button" aria-label="Close" onclick={() => onclose()}>×</button>
      </div>
      <div class="modal-body">
        <p class="auth-lead">
          Simulated USDC on live market data — nothing here is real money.
        </p>
        <div class="ticket-preview">
          <div class="preview-row">
            <span>Equity</span>
            <b>${formatNumber(equityUsd, 2)}</b>
          </div>
          <div class="preview-row">
            <span>Free cash</span>
            <b>${formatNumber(freeUsd, 2)}</b>
          </div>
          <div class="preview-row">
            <span>In positions</span>
            <b>${formatNumber(marginUsd, 2)}</b>
          </div>
          <div class="preview-row">
            <span>Open positions</span>
            <b>{openPositions}</b>
          </div>
        </div>
        <div class="ticket-grid-2">
          <button class="primary" type="button" onclick={() => ontopup(1_000)}>
            Top up +$1,000
          </button>
          <button class="account-action" type="button" onclick={() => ontopup(5_000)}>
            Top up +$5,000
          </button>
        </div>
        <button class="account-action wide" type="button" onclick={onreset}>
          Reset to $10,000
        </button>
      </div>
    </div>
  </div>
{/if}
