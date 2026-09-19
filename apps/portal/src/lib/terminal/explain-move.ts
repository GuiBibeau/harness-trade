// Deterministic session-move facts for the chart "explain" chip.
// The model only narrates these numbers — never invents them.

import type { MarketPoint } from "$lib/phoenix-market-data";

export type SessionMoveFacts = {
  symbol: string;
  venue: "perp" | "spot";
  timeframe: string;
  bars: number;
  open: number;
  close: number;
  high: number;
  low: number;
  /** Percent move from first bar open → last close. */
  sessionChangePct: number;
  /** Percent range (high-low) vs first open. */
  rangePct: number;
  /** Tape 24h change when known; null = honest absence. */
  change24hPct: number | null;
  volumeQuote: number | null;
};

/** Build facts from the loaded candle window. Null when history is too thin. */
export function sessionMoveFacts(
  points: MarketPoint[],
  input: {
    symbol: string;
    venue: "perp" | "spot";
    timeframe: string;
    change24hPct: number | null;
  },
): SessionMoveFacts | null {
  if (points.length < 2) return null;
  const first = points[0];
  const last = points[points.length - 1];
  if (!(first.open > 0) || !(last.close > 0)) return null;

  let high = first.high;
  let low = first.low;
  let volumeQuote = 0;
  let hasVolume = false;
  for (const point of points) {
    if (point.high > high) high = point.high;
    if (point.low < low) low = point.low;
    if (
      typeof point.volumeQuote === "number" &&
      Number.isFinite(point.volumeQuote)
    ) {
      volumeQuote += point.volumeQuote;
      hasVolume = true;
    }
  }

  const sessionChangePct = ((last.close - first.open) / first.open) * 100;
  const rangePct = ((high - low) / first.open) * 100;
  if (!Number.isFinite(sessionChangePct) || !Number.isFinite(rangePct)) {
    return null;
  }

  return {
    symbol: input.symbol,
    venue: input.venue,
    timeframe: input.timeframe,
    bars: points.length,
    open: first.open,
    close: last.close,
    high,
    low,
    sessionChangePct,
    rangePct,
    change24hPct: input.change24hPct,
    volumeQuote: hasVolume ? volumeQuote : null,
  };
}
