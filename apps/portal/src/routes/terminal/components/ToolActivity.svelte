<script lang="ts">
  import type { WorkstreamCard } from "$lib/agent/workstream";

  type ToolActivityItem = {
    id: string;
    toolName: string;
    card: WorkstreamCard;
    approvalPending: boolean;
  };

  let {
    items,
    onAnswer,
    showApprovalActions = true,
  }: {
    items: ToolActivityItem[];
    onAnswer: (id: string, approved: boolean) => void;
    showApprovalActions?: boolean;
  } = $props();

  const running = $derived(
    items.some((item) =>
      ["pending", "running"].includes(item.card.status),
    ),
  );
  const approvalPending = $derived(
    items.some((item) => item.approvalPending),
  );
  const reconciliationNeeded = $derived(
    items.some(
      (item) => item.card.kind === "receipt" && item.card.status === "waiting",
    ),
  );
  const waiting = $derived(approvalPending || reconciliationNeeded);
  const failed = $derived(
    items.some((item) => ["failed", "denied"].includes(item.card.status)),
  );
  const completed = $derived(
    items.filter((item) =>
      ["success", "failed", "denied"].includes(item.card.status),
    ).length,
  );
  const summaryLabel = $derived(
    items.length === 1
      ? items[0]?.card.title ?? "Tool activity"
      : running
        ? `Using ${items.length} tools`
        : `Used ${items.length} tools`,
  );
  const statusLabel = $derived(
    approvalPending
      ? "Approval needed"
      : reconciliationNeeded
        ? "Reconciliation needed"
      : running
        ? `${completed}/${items.length}`
        : failed
          ? "Finished with errors"
          : "Done",
  );
  const activityId = $derived(
    `tool-activity-${(items[0]?.id ?? "items").replace(/[^a-zA-Z0-9_-]/g, "-")}`,
  );
  let expanded = $state(false);

  $effect(() => {
    if (waiting) expanded = true;
  });
</script>

<div class="tool-activity">
  <button
    class="summary"
    type="button"
    aria-expanded={expanded}
    aria-controls={activityId}
    aria-label={`Tool activity: ${summaryLabel}. ${statusLabel}`}
    onclick={() => (expanded = !expanded)}
  >
    <span
      class="activity-mark"
      class:running
      class:waiting
      class:failed
      aria-hidden="true"
    ></span>
    <span class="summary-label">{summaryLabel}</span>
    <span class="summary-status">{statusLabel}</span>
    <span class="chevron" aria-hidden="true">›</span>
  </button>

  {#if expanded}
    <div class="tool-list" id={activityId}>
      {#each items as item (item.id)}
        <section class="tool-item">
          <div class="tool-item-head">
            <span
              class="item-mark"
              class:item-running={["pending", "running"].includes(item.card.status)}
              class:item-waiting={item.approvalPending ||
                item.card.status === "waiting"}
              class:item-failed={["failed", "denied"].includes(item.card.status)}
              aria-hidden="true"
            ></span>
            <strong title={item.toolName}>{item.card.title}</strong>
            <span>{item.card.statusLabel}</span>
          </div>

          {#if item.card.summary}
            <p>{item.card.summary}</p>
          {/if}

          {#if item.card.facts.length > 0}
            <dl>
              {#each item.card.facts as fact}
                <div>
                  <dt>{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              {/each}
            </dl>
          {/if}

          {#if item.card.steps.length > 0}
            <ol class="steps">
              {#each item.card.steps as step}
                <li>
                  <span
                    class:step-ok={step.status === "success"}
                    class:step-bad={["failed", "denied"].includes(step.status)}
                  ></span>
                  {step.label}
                </li>
              {/each}
            </ol>
          {/if}

          {#each item.card.receipts as receipt}
            <div class="receipt">
              {#if receipt.href}
                <a href={receipt.href} target="_blank" rel="noreferrer">
                  {receipt.label} ↗
                </a>
              {:else}
                <span>{receipt.label}</span>
              {/if}
              {#if receipt.reference}<code>{receipt.reference}</code>{/if}
              <span>{receipt.status}</span>
            </div>
          {/each}

          {#each item.card.links as link}
            <a
              class="tool-link"
              href={link.href}
              target="_blank"
              rel="noreferrer"
            >
              {link.label} ↗
            </a>
          {/each}

          {#if item.card.details.length > 0}
            <div class="details">
              {#each item.card.details as detail}<p>{detail}</p>{/each}
            </div>
          {/if}

          {#if item.approvalPending && showApprovalActions}
            <div class="actions">
              <button type="button" onclick={() => onAnswer(item.id, true)}>
                {item.card.kind === "context" ? "Apply" : "Approve"}
              </button>
              <button
                class="secondary"
                type="button"
                onclick={() => onAnswer(item.id, false)}
              >
                {item.card.kind === "context" ? "Dismiss" : "Deny"}
              </button>
            </div>
          {/if}
        </section>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tool-activity {
    max-width: 100%;
    color: var(--muted);
    white-space: normal;
  }

  .summary {
    display: grid;
    grid-template-columns: 0.75rem minmax(0, 1fr) auto 0.75rem;
    align-items: center;
    gap: 0.38rem;
    min-height: 1.65rem;
    width: fit-content;
    max-width: 100%;
    padding: 0.1rem 0;
    cursor: pointer;
    border: 0;
    color: inherit;
    background: transparent;
    font: inherit;
    font-size: 0.69rem;
    line-height: 1.25;
    text-align: left;
    user-select: none;
  }

  .summary:hover .summary-label {
    color: var(--ink);
  }

  .summary-label {
    overflow: hidden;
    color: var(--muted);
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .summary-status {
    color: var(--faint);
    font-size: 0.6rem;
    letter-spacing: 0.03em;
  }

  .activity-mark,
  .item-mark {
    box-sizing: border-box;
    display: block;
    width: 0.45rem;
    height: 0.45rem;
    border: 1px solid var(--faint);
    border-radius: 50%;
  }

  .activity-mark.running,
  .item-mark.item-running {
    width: 0.65rem;
    height: 0.65rem;
    border: 1px solid var(--line-soft);
    border-top-color: var(--accent);
    animation: spin 0.75s linear infinite;
  }

  .activity-mark.waiting,
  .item-mark.item-waiting {
    border-color: var(--amber);
    background: var(--amber);
    animation: none;
  }

  .activity-mark.failed,
  .item-mark.item-failed {
    border-color: var(--red);
    background: var(--red);
    animation: none;
  }

  .chevron {
    color: var(--faint);
    font-size: 0.9rem;
    line-height: 1;
    transform: rotate(0deg);
    transition: transform 120ms ease;
  }

  .summary[aria-expanded="true"] .chevron {
    transform: rotate(90deg);
  }

  .tool-list {
    display: grid;
    gap: 0.28rem;
    margin: 0.15rem 0 0.3rem 0.35rem;
    padding-left: 0.72rem;
    border-left: 1px solid var(--line-soft);
  }

  .tool-item {
    display: grid;
    gap: 0.28rem;
    padding: 0.32rem 0 0.38rem;
    font-size: 0.66rem;
  }

  .tool-item + .tool-item {
    border-top: 1px solid var(--line-soft);
  }

  .tool-item-head {
    display: grid;
    grid-template-columns: 0.6rem minmax(0, 1fr) auto;
    align-items: center;
    gap: 0.35rem;
  }

  .tool-item-head strong {
    overflow: hidden;
    color: var(--ink);
    font-size: 0.69rem;
    font-weight: 650;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tool-item-head > span:last-child {
    color: var(--faint);
    font-size: 0.58rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .tool-item p,
  .details p {
    margin: 0;
    color: var(--muted);
    line-height: 1.4;
  }

  dl {
    display: flex;
    flex-wrap: wrap;
    gap: 0.28rem;
    margin: 0;
  }

  dl div {
    display: inline-flex;
    gap: 0.2rem;
  }

  dt {
    color: var(--faint);
    text-transform: uppercase;
  }

  dd {
    margin: 0;
    color: var(--ink);
  }

  .steps {
    display: grid;
    gap: 0.18rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .steps li {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .steps li > span {
    width: 0.35rem;
    height: 0.35rem;
    border: 1px solid var(--faint);
    border-radius: 50%;
  }

  .steps li > span.step-ok {
    border-color: var(--up);
    background: var(--up);
  }

  .steps li > span.step-bad {
    border-color: var(--red);
    background: var(--red);
  }

  .receipt {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.38rem;
  }

  .receipt > span:last-child {
    margin-left: auto;
    color: var(--faint);
    text-transform: uppercase;
  }

  a {
    color: var(--accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  code {
    color: var(--ink);
    font: inherit;
    font-family: var(--font-mono);
  }

  .details {
    display: grid;
    gap: 0.2rem;
  }

  .actions {
    display: flex;
    gap: 0.38rem;
    padding-top: 0.12rem;
  }

  .actions button {
    padding: 0.28rem 0.5rem;
    border: 1px solid var(--accent);
    color: var(--surface);
    background: var(--accent);
    font: inherit;
    font-size: 0.64rem;
    cursor: pointer;
  }

  .actions button.secondary {
    border-color: var(--line-soft);
    color: var(--muted);
    background: transparent;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .activity-mark.running,
    .item-mark.item-running {
      animation: none;
    }

    .chevron {
      transition: none;
    }
  }
</style>
