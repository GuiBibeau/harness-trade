<script lang="ts">
  // One labelled stat in the ticker rail — value swaps to a skeleton while
  // its feed loads. Pure display; every string arrives pre-formatted.
  let {
    label,
    value,
    width,
    loading,
    valueClass = "",
  }: {
    label: string;
    value: string;
    width: string;
    loading: boolean;
    valueClass?: string;
  } = $props();
</script>

<div class="tk-stat" style={`min-width:${width}`}>
  <span>{label}</span>
  {#if loading}
    <span class="skeleton skel-val" aria-hidden="true"></span>
  {:else}
    <b class={valueClass}>{value}</b>
  {/if}
</div>

<style>
  /* These were `.ticker-stats div/span/b` in the page — rewritten against
     .tk-stat because the parent/child compound stops matching once the
     stat lives in its own component. */
  .tk-stat {
    display: inline-flex;
    flex-direction: column;
    gap: 0.05rem;
    line-height: 1.1;
  }

  .tk-stat span {
    font-size: 0.58rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--faint);
  }

  .tk-stat b {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-variant-numeric: tabular-nums;
    font-size: 0.78rem;
    font-weight: 600;
    color: var(--ink);
  }

  .skel-val {
    width: 2.6rem;
    height: 0.78rem;
    margin-top: 0.18rem;
  }
</style>
