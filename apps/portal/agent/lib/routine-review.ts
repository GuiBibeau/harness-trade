// Pure helpers for market_review routine ticks. Sweeper fetches candles;
// this module turns them into an observe-only draft plan (never an Execution).

export type CandleClose = {
  high: number;
  low: number;
  close: number;
};

export type MarketReviewBias = "bullish" | "bearish" | "neutral";

export type MarketReviewPlan = {
  bias: MarketReviewBias;
  changePct: number;
  rangeHigh: number;
  rangeLow: number;
  lastClose: number;
  invalidationHint: string;
  draftPlan: string;
};

const BIAS_THRESHOLD_PCT = 0.5;

export function buildMarketReviewPlan(input: {
  symbol: string;
  timeframe: string;
  candles: CandleClose[];
}): MarketReviewPlan {
  const candles = input.candles.filter(
    (row) =>
      Number.isFinite(row.high) &&
      Number.isFinite(row.low) &&
      Number.isFinite(row.close) &&
      row.high > 0 &&
      row.low > 0 &&
      row.close > 0,
  );
  if (candles.length === 0) {
    throw new Error("routine-review-candles-empty");
  }
  const first = candles[0];
  const last = candles[candles.length - 1];
  if (!first || !last) {
    throw new Error("routine-review-candles-empty");
  }
  const changePct = ((last.close - first.close) / first.close) * 100;
  const bias: MarketReviewBias =
    changePct >= BIAS_THRESHOLD_PCT
      ? "bullish"
      : changePct <= -BIAS_THRESHOLD_PCT
        ? "bearish"
        : "neutral";
  const rangeHigh = Math.max(...candles.map((row) => row.high));
  const rangeLow = Math.min(...candles.map((row) => row.low));
  const invalidationHint =
    bias === "bullish"
      ? `A sustained break below $${formatUsd(rangeLow)} would invalidate the short-term bullish read.`
      : bias === "bearish"
        ? `A sustained break above $${formatUsd(rangeHigh)} would invalidate the short-term bearish read.`
        : `A break outside $${formatUsd(rangeLow)}–$${formatUsd(rangeHigh)} would end the range thesis.`;

  const draftPlan = [
    `Proposed plan (observe-only — not an order):`,
    `1. Bias: ${bias} on ${input.symbol} over the last ${input.timeframe} window (${formatSignedPct(changePct)}).`,
    `2. Watch the ${input.timeframe} range $${formatUsd(rangeLow)}–$${formatUsd(rangeHigh)}; last $${formatUsd(last.close)}.`,
    `3. Invalidation: ${invalidationHint}`,
    `4. If you want a ticket, ask Eve to draft one after you confirm direction and risk — this routine will not execute.`,
  ].join("\n");

  return {
    bias,
    changePct,
    rangeHigh,
    rangeLow,
    lastClose: last.close,
    invalidationHint,
    draftPlan,
  };
}

export function formatMarketReviewAlertBody(plan: MarketReviewPlan): string {
  return [
    `${plan.bias.toUpperCase()} · ${formatSignedPct(plan.changePct)} · last $${formatUsd(plan.lastClose)}`,
    plan.draftPlan,
  ].join("\n\n");
}

function formatUsd(value: number): string {
  return value.toLocaleString("en-US", {
    maximumFractionDigits: value >= 100 ? 2 : 4,
  });
}

function formatSignedPct(value: number): string {
  const abs = Math.abs(value).toFixed(2);
  return `${value >= 0 ? "+" : "-"}${abs}%`;
}
