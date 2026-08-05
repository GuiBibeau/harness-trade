/**
 * Pure projection from the EVE tool seam into the terminal workstream.
 *
 * The server may return a `presentation` envelope, but Svelte only learns this
 * stable vocabulary. In particular, context/navigation operations can never
 * be projected as financial execution.
 */

export type WorkstreamKind =
  | "plan"
  | "observation"
  | "execution"
  | "receipt"
  | "memory"
  | "routine"
  | "alert"
  | "context"
  | "activity";

export type WorkstreamStatus =
  | "pending"
  | "running"
  | "waiting"
  | "success"
  | "failed"
  | "denied"
  | "paused";

export type WorkstreamTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type WorkstreamFact = {
  label: string;
  value: string;
};

export type WorkstreamStep = {
  label: string;
  status: WorkstreamStatus;
};

export type WorkstreamReceipt = {
  label: string;
  status: string;
  href?: string;
  reference?: string;
};

export type WorkstreamLink = {
  label: string;
  href: string;
};

export type WorkstreamCard = {
  kind: WorkstreamKind;
  eyebrow: string;
  title: string;
  summary: string;
  status: WorkstreamStatus;
  statusLabel: string;
  tone: WorkstreamTone;
  facts: WorkstreamFact[];
  steps: WorkstreamStep[];
  receipts: WorkstreamReceipt[];
  links: WorkstreamLink[];
  details: string[];
};

/**
 * Stable server output contract. Every field is optional so older tools can
 * ship the envelope incrementally; the projector has a generic fallback.
 */
export type HarnessPresentationEnvelope = {
  schema?: "harness.presentation.v1" | string;
  kind?: WorkstreamKind | string;
  title?: string;
  summary?: string;
  status?: string;
  severity?: string;
  facts?: WorkstreamFact[] | Record<string, unknown>;
  steps?: unknown[];
  stages?: unknown[];
  receipts?: unknown[];
  links?: unknown[];
  details?: unknown[];
  scope?: string;
  confidence?: number;
  expiresAt?: string;
  cadence?: string;
  nextRunAt?: string;
};

export function settleIdleActivity(
  card: WorkstreamCard,
  sessionIdle: boolean,
): WorkstreamCard {
  if (
    !sessionIdle ||
    card.kind !== "activity" ||
    !["pending", "running"].includes(card.status)
  ) {
    return card;
  }
  return {
    ...card,
    status: "success",
    statusLabel: "done",
    tone: "neutral",
  };
}

export type HarnessToolProjectionInput = {
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approvalPending?: boolean;
};

const CONTEXT_OPERATIONS = new Set([
  "switch_market",
  "set_timeframe",
  "set_ticket",
  "watchlist_add",
  "watchlist_remove",
  "add_to_watchlist",
  "remove_from_watchlist",
  "open_panel",
  "market.select",
  "timeframe.select",
  "ticket.prefill",
  "watchlist.add",
  "watchlist.remove",
  "panel.open",
]);

const OBSERVATION_TOOLS = new Set([
  "get_portfolio",
  "read_file",
  "grep",
  "glob",
  "web_fetch",
  "web_search",
]);

export function projectHarnessTool(
  source: HarnessToolProjectionInput,
): WorkstreamCard {
  const input = asRecord(source.input);
  const output = asRecord(source.output);
  const presentation = asRecord(output?.presentation);
  const operation =
    text(input?.operation) ??
    text(input?.kind) ??
    text(presentation?.operation);
  const toolName = source.toolName ?? "server_activity";
  const isContext = isContextMutation(toolName, operation, presentation);
  const kind = isContext
    ? "context"
    : (normalizeKind(presentation?.kind) ?? inferKind(toolName, output));
  const presentationStatus = text(presentation?.status);
  const outputStatus = text(output?.status);
  // A completed tool that already shipped a presentation envelope is done
  // unless an explicit status says otherwise. Bare Eve lifecycle tokens
  // (output-available) alone are never success — see normalizeStatus.
  const statusFallback =
    presentation &&
    !presentationStatus &&
    !outputStatus &&
    source.state === "output-available"
      ? "success"
      : source.state;
  const status = normalizeStatus(
    presentationStatus ?? outputStatus ?? statusFallback,
    source.approvalPending === true,
  );
  const severity = text(presentation?.severity);
  const title =
    text(presentation?.title) ??
    inferredTitle(kind, toolName, operation, status);
  const summary =
    text(presentation?.summary) ??
    text(output?.summary) ??
    source.errorText ??
    inferSummary(input);
  const facts = [
    ...parseFacts(presentation?.facts),
    ...kindFacts(kind, presentation),
  ];
  const steps =
    kind === "context"
      ? []
      : parseSteps(presentation?.stages ?? presentation?.steps, status);
  const receipts =
    kind === "context"
      ? []
      : parseReceipts(presentation?.receipts, output?.explorerUrls);
  const links = parseLinks(presentation?.links);
  const details = [
    ...stringArray(presentation?.details),
    ...(source.errorText && source.errorText !== summary
      ? [source.errorText]
      : []),
  ];

  return {
    kind,
    eyebrow: eyebrowFor(kind),
    title,
    summary,
    status,
    statusLabel: statusLabelFor(kind, status),
    tone: toneFor(kind, status, severity),
    facts: dedupeFacts(facts),
    steps,
    receipts,
    links,
    details,
  };
}

function isContextMutation(
  toolName: string,
  operation: string | undefined,
  presentation: Record<string, unknown> | null,
): boolean {
  if (normalizeKind(presentation?.kind) === "context") return true;
  const className = text(presentation?.class)?.toLowerCase();
  if (className === "context-mutation" || className === "navigation") {
    return true;
  }
  return (
    CONTEXT_OPERATIONS.has(toolName.toLowerCase()) ||
    (operation ? CONTEXT_OPERATIONS.has(operation.toLowerCase()) : false)
  );
}

function inferKind(
  toolName: string,
  output: Record<string, unknown> | null,
): WorkstreamKind {
  const name = toolName.toLowerCase();
  if (name === "execute_trade" || name.includes("transaction")) {
    return "execution";
  }
  if (Array.isArray(output?.explorerUrls)) return "receipt";
  if (OBSERVATION_TOOLS.has(name) || name.startsWith("get_")) {
    return "observation";
  }
  if (name.includes("memory") || name.includes("remember")) return "memory";
  if (name.includes("routine") || name.includes("schedule")) return "routine";
  if (name.includes("alert") || name.includes("warning")) return "alert";
  if (name.includes("plan")) return "plan";
  return "activity";
}

function normalizeKind(value: unknown): WorkstreamKind | null {
  const kind = text(value)?.toLowerCase();
  switch (kind) {
    case "plan":
    case "observation":
    case "execution":
    case "receipt":
    case "memory":
    case "routine":
    case "alert":
    case "context":
    case "activity":
      return kind;
    case "context-mutation":
    case "navigation":
      return "context";
    case "transaction":
      return "execution";
    default:
      return null;
  }
}

function normalizeStatus(
  raw: string | undefined,
  approvalPending: boolean,
): WorkstreamStatus {
  if (approvalPending) return "waiting";
  const status = (raw ?? "").toLowerCase().trim();
  if (
    status.includes("error") ||
    status.includes("fail") ||
    status === "rejected"
  ) {
    return "failed";
  }
  if (status.includes("denied") || status === "deny") return "denied";
  if (status.includes("pause") || status.includes("suspend")) return "paused";
  // Tool lifecycle tokens are not outcomes — never promote them to success.
  if (
    status === "output-available" ||
    status === "input-available" ||
    status === "input-streaming" ||
    status === "pending-client" ||
    status.includes("running") ||
    status.includes("stream") ||
    status.includes("signing") ||
    status.includes("submitting")
  ) {
    return "running";
  }
  if (
    status.includes("success") ||
    status.includes("complete") ||
    status.includes("confirm") ||
    status === "ready" ||
    status === "active"
  ) {
    return "success";
  }
  if (status.includes("approval") || status.includes("waiting")) {
    return "waiting";
  }
  if (status.includes("input")) {
    return "running";
  }
  return "pending";
}

function inferredTitle(
  kind: WorkstreamKind,
  toolName: string,
  operation: string | undefined,
  status: WorkstreamStatus,
): string {
  if (kind === "context") {
    return status === "success" ? "Context updated" : "Update context";
  }
  const source = operation ?? toolName;
  const label = humanize(source);
  if (kind === "receipt" && label === "Server activity") {
    return "Transaction receipt";
  }
  return label;
}

function inferSummary(input: Record<string, unknown> | null): string {
  if (!input) return "";
  const symbol = text(input.symbol);
  const side = text(input.side);
  const operation = text(input.operation);
  const sizeUsd = finiteNumber(input.sizeUsd);
  const amountUsd = finiteNumber(input.amountUsd);
  const leverage = finiteNumber(input.leverage);
  return [
    operation ? humanize(operation) : null,
    symbol,
    side,
    sizeUsd !== null
      ? formatUsd(sizeUsd)
      : amountUsd !== null
        ? formatUsd(amountUsd)
        : null,
    leverage !== null ? `${leverage}×` : null,
  ]
    .filter((item): item is string => Boolean(item))
    .join(" · ");
}

function parseFacts(value: unknown): WorkstreamFact[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const row = asRecord(item);
      const label = text(row?.label) ?? text(row?.name);
      const factValue = displayValue(row?.value);
      return label && factValue ? [{ label, value: factValue }] : [];
    });
  }
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([label, factValue]) => {
    const rendered = displayValue(factValue);
    return rendered ? [{ label: humanize(label), value: rendered }] : [];
  });
}

function kindFacts(
  kind: WorkstreamKind,
  presentation: Record<string, unknown> | null,
): WorkstreamFact[] {
  if (!presentation) return [];
  if (kind === "memory") {
    return compactFacts([
      ["Scope", presentation.scope],
      [
        "Confidence",
        typeof presentation.confidence === "number"
          ? `${Math.round(presentation.confidence * 100)}%`
          : undefined,
      ],
      ["Expires", presentation.expiresAt],
    ]);
  }
  if (kind === "routine") {
    return compactFacts([
      ["Cadence", presentation.cadence],
      ["Next run", presentation.nextRunAt],
    ]);
  }
  return [];
}

function parseSteps(
  value: unknown,
  fallbackStatus: WorkstreamStatus,
): WorkstreamStep[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") {
      return [
        {
          label: item,
          status:
            fallbackStatus === "success"
              ? ("success" as const)
              : ("pending" as const),
        },
      ];
    }
    const row = asRecord(item);
    const label = text(row?.label) ?? text(row?.title) ?? text(row?.summary);
    if (!label) return [];
    return [
      {
        label,
        status: text(row?.status)
          ? normalizeStatus(text(row?.status), false)
          : fallbackStatus,
      },
    ];
  });
}

function parseReceipts(
  value: unknown,
  legacyUrls: unknown,
): WorkstreamReceipt[] {
  const receipts = Array.isArray(value)
    ? value.flatMap((item, index) => {
        const row = asRecord(item);
        if (!row) return [];
        const href =
          safeHref(row.explorerUrl) ?? safeHref(row.href) ?? safeHref(row.url);
        const reference =
          text(row.signature) ?? text(row.reference) ?? text(row.externalId);
        return [
          {
            label:
              text(row.label) ??
              text(row.summary) ??
              `Transaction ${index + 1}`,
            status: text(row.status) ?? "submitted",
            ...(href ? { href } : {}),
            ...(reference ? { reference: abbreviate(reference) } : {}),
          },
        ];
      })
    : [];

  if (receipts.length > 0 || !Array.isArray(legacyUrls)) return receipts;
  const urls = legacyUrls.flatMap((url) => {
    const href = safeHref(url);
    return href ? [href] : [];
  });
  return urls.map((href, index) => ({
    label: urls.length > 1 ? `Transaction ${index + 1}` : "Transaction",
    status: "submitted",
    href,
  }));
}

function parseLinks(value: unknown): WorkstreamLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asRecord(item);
    const href = safeHref(row?.href) ?? safeHref(row?.url);
    if (!href) return [];
    return [{ label: text(row?.label) ?? "Open", href }];
  });
}

function toneFor(
  kind: WorkstreamKind,
  status: WorkstreamStatus,
  severity: string | undefined,
): WorkstreamTone {
  const normalizedSeverity = severity?.toLowerCase();
  if (
    status === "failed" ||
    normalizedSeverity === "critical" ||
    normalizedSeverity === "error"
  ) {
    return "danger";
  }
  if (
    status === "waiting" ||
    status === "denied" ||
    status === "paused" ||
    normalizedSeverity === "warning"
  ) {
    return "warning";
  }
  if (status === "success" && (kind === "execution" || kind === "receipt")) {
    return "success";
  }
  if (status === "running" || kind === "plan" || kind === "observation") {
    return "info";
  }
  return "neutral";
}

function statusLabelFor(
  kind: WorkstreamKind,
  status: WorkstreamStatus,
): string {
  if (kind === "receipt" && status === "waiting") {
    return "reconciliation needed";
  }
  if (kind === "context") {
    if (status === "success") return "updated";
    if (status === "running") return "updating";
  }
  const labels: Record<WorkstreamStatus, string> = {
    pending: "queued",
    running: "working",
    waiting: "approval",
    success: "done",
    failed: "failed",
    denied: "denied",
    paused: "paused",
  };
  return labels[status];
}

function eyebrowFor(kind: WorkstreamKind): string {
  const labels: Record<WorkstreamKind, string> = {
    plan: "Plan",
    observation: "Observed",
    execution: "Execution",
    receipt: "Receipt",
    memory: "Memory",
    routine: "Routine",
    alert: "Alert",
    context: "Context",
    activity: "Work",
  };
  return labels[kind];
}

function humanize(value: string): string {
  const normalized = value
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .trim();
  if (!normalized) return "Server activity";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function displayValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return null;
}

function compactFacts(entries: [string, unknown][]): WorkstreamFact[] {
  return entries.flatMap(([label, value]) => {
    const rendered = displayValue(value);
    return rendered ? [{ label, value: rendered }] : [];
  });
}

function dedupeFacts(facts: WorkstreamFact[]): WorkstreamFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.label.toLowerCase()}:${fact.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  })}`;
}

function abbreviate(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function safeHref(value: unknown): string | undefined {
  const href = text(value);
  if (!href) return undefined;
  try {
    const parsed = new URL(href);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
