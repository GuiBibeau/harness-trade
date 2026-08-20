// Local-first closed-trade post-mortems. Paired with the journal on full
// closes: facts only (entry/exit/stop/R), no fake fills or invented theses.

const STORAGE_KEY = "trader-ralph-terminal/postmortems/v1";
const MAX_REVIEWS = 200;

export type PostMortemMode = "live" | "paper";
export type PostMortemSide = "long" | "short";
export type PostMortemExitReason = "manual" | "tp" | "sl" | "liq";

export type ClosedTradeReview = {
  id: string;
  ts: number;
  mode: PostMortemMode;
  venue: "perp" | "spot";
  symbol: string;
  side: PostMortemSide;
  entryPrice: number | null;
  exitPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice: number | null;
  notionalUsd: number | null;
  realizedPnlUsd: number | null;
  /** Null when stop was missing or risk distance is zero. */
  rMultiple: number | null;
  exitReason: PostMortemExitReason;
  signature: string;
  summary: string;
};

export function riskUsd(input: {
  side: PostMortemSide;
  entryPrice: number;
  stopLossPrice: number;
  notionalUsd: number;
}): number | null {
  if (
    !(input.entryPrice > 0) ||
    !(input.stopLossPrice > 0) ||
    !(input.notionalUsd > 0)
  ) {
    return null;
  }
  const stopDistance =
    input.side === "long"
      ? input.entryPrice - input.stopLossPrice
      : input.stopLossPrice - input.entryPrice;
  if (!(stopDistance > 0)) return null;
  const size = input.notionalUsd / input.entryPrice;
  const risk = size * stopDistance;
  return Number.isFinite(risk) && risk > 0 ? risk : null;
}

export function rMultiple(input: {
  side: PostMortemSide;
  entryPrice: number | null;
  stopLossPrice: number | null;
  notionalUsd: number | null;
  realizedPnlUsd: number | null;
}): number | null {
  if (
    input.entryPrice === null ||
    input.stopLossPrice === null ||
    input.notionalUsd === null ||
    input.realizedPnlUsd === null
  ) {
    return null;
  }
  const risk = riskUsd({
    side: input.side,
    entryPrice: input.entryPrice,
    stopLossPrice: input.stopLossPrice,
    notionalUsd: input.notionalUsd,
  });
  if (risk === null) return null;
  const value = input.realizedPnlUsd / risk;
  return Number.isFinite(value) ? value : null;
}

export function summarizeReview(
  review: Omit<ClosedTradeReview, "id" | "summary"> & { summary?: string },
): string {
  const pnl =
    review.realizedPnlUsd === null
      ? "PnL unknown"
      : `${review.realizedPnlUsd >= 0 ? "+" : "-"}$${Math.abs(review.realizedPnlUsd).toFixed(2)}`;
  const r =
    review.rMultiple === null
      ? "R n/a"
      : `${review.rMultiple >= 0 ? "+" : ""}${review.rMultiple.toFixed(2)}R`;
  const reason =
    review.exitReason === "manual"
      ? "manual close"
      : review.exitReason === "tp"
        ? "take profit"
        : review.exitReason === "sl"
          ? "stop loss"
          : "liquidation";
  return `${review.symbol} ${review.side} · ${pnl} · ${r} · ${reason}`;
}

export function buildClosedTradeReview(input: {
  ts: number;
  mode: PostMortemMode;
  venue?: "perp" | "spot";
  symbol: string;
  side: PostMortemSide;
  entryPrice: number | null;
  exitPrice: number | null;
  stopLossPrice: number | null;
  takeProfitPrice?: number | null;
  notionalUsd: number | null;
  realizedPnlUsd: number | null;
  exitReason: PostMortemExitReason;
  signature: string;
}): ClosedTradeReview {
  const r = rMultiple({
    side: input.side,
    entryPrice: input.entryPrice,
    stopLossPrice: input.stopLossPrice,
    notionalUsd: input.notionalUsd,
    realizedPnlUsd: input.realizedPnlUsd,
  });
  const base = {
    ts: input.ts,
    mode: input.mode,
    venue: input.venue ?? "perp",
    symbol: input.symbol,
    side: input.side,
    entryPrice: input.entryPrice,
    exitPrice: input.exitPrice,
    stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice ?? null,
    notionalUsd: input.notionalUsd,
    realizedPnlUsd: input.realizedPnlUsd,
    rMultiple: r,
    exitReason: input.exitReason,
    signature: input.signature,
  };
  return {
    id: `${input.signature}:${input.ts}`,
    ...base,
    summary: summarizeReview(base),
  };
}

export function loadPostMortems(): ClosedTradeReview[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw) as unknown;
    if (!Array.isArray(data)) return [];
    return data.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const candidate = row as Partial<ClosedTradeReview>;
      if (
        typeof candidate.ts !== "number" ||
        typeof candidate.symbol !== "string" ||
        typeof candidate.summary !== "string" ||
        typeof candidate.signature !== "string"
      ) {
        return [];
      }
      if (candidate.mode !== "live" && candidate.mode !== "paper") return [];
      if (candidate.side !== "long" && candidate.side !== "short") return [];
      return [candidate as ClosedTradeReview];
    });
  } catch {
    return [];
  }
}

export function recordPostMortem(
  review: ClosedTradeReview,
): ClosedTradeReview[] {
  const entries = [...loadPostMortems(), review].slice(-MAX_REVIEWS);
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // storage unavailable — best-effort
  }
  return entries;
}

export function clearPostMortems(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function formatRMultiple(value: number | null): string {
  if (value === null) return "R n/a";
  const abs = Math.abs(value).toFixed(2);
  return `${value >= 0 ? "+" : "-"}${abs}R`;
}
