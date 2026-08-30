import { beforeEach, describe, expect, test } from "bun:test";
import {
  buildClosedTradeReview,
  clearPostMortems,
  formatRMultiple,
  loadPostMortems,
  recordPostMortem,
  riskUsd,
  rMultiple,
  winRecordUtc,
} from "./postmortem";

const STORAGE_KEY = "trader-ralph-terminal/postmortems/v1";
const storage = new Map<string, string>();

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem(key: string): string | null {
        return storage.get(key) ?? null;
      },
      setItem(key: string, value: string): void {
        storage.set(key, value);
      },
      removeItem(key: string): void {
        storage.delete(key);
      },
    },
  },
});

beforeEach(() => {
  storage.clear();
});

describe("rMultiple", () => {
  test("computes +2R when a long hits 2× the stop distance", () => {
    // Entry 100, stop 90 → $10 risk/unit. Notional $1000 → size 10 → risk $100.
    // PnL +$200 → +2R.
    expect(
      rMultiple({
        side: "long",
        entryPrice: 100,
        stopLossPrice: 90,
        notionalUsd: 1000,
        realizedPnlUsd: 200,
      }),
    ).toBeCloseTo(2, 5);
  });

  test("returns null when stop is missing or on the wrong side of entry", () => {
    expect(
      riskUsd({
        side: "long",
        entryPrice: 100,
        stopLossPrice: 110,
        notionalUsd: 1000,
      }),
    ).toBeNull();
    expect(
      rMultiple({
        side: "short",
        entryPrice: 100,
        stopLossPrice: null,
        notionalUsd: 1000,
        realizedPnlUsd: 50,
      }),
    ).toBeNull();
  });
});

describe("buildClosedTradeReview", () => {
  test("builds a summary with PnL, R, and exit reason", () => {
    const review = buildClosedTradeReview({
      ts: 1,
      mode: "paper",
      symbol: "SOL",
      side: "long",
      entryPrice: 100,
      exitPrice: 110,
      stopLossPrice: 95,
      notionalUsd: 500,
      realizedPnlUsd: 50,
      exitReason: "tp",
      signature: "paper-event-1",
    });
    expect(review.rMultiple).toBeCloseTo(2, 5);
    expect(review.summary).toContain("SOL long");
    expect(review.summary).toContain("+2.00R");
    expect(review.summary).toContain("take profit");
    expect(formatRMultiple(review.rMultiple)).toBe("+2.00R");
  });
});

describe("postmortem storage", () => {
  test("records and clears reviews", () => {
    const review = buildClosedTradeReview({
      ts: 2,
      mode: "live",
      symbol: "BTC",
      side: "short",
      entryPrice: 100_000,
      exitPrice: 99_000,
      stopLossPrice: 101_000,
      notionalUsd: 10_000,
      realizedPnlUsd: 100,
      exitReason: "manual",
      signature: "sig",
    });
    expect(recordPostMortem(review)).toHaveLength(1);
    expect(loadPostMortems()[0]?.symbol).toBe("BTC");
    clearPostMortems();
    expect(storage.has(STORAGE_KEY)).toBe(false);
    expect(loadPostMortems()).toEqual([]);
  });
});

describe("winRecordUtc", () => {
  test("counts wins from closed reviews with realized PnL on the UTC day", () => {
    const now = Date.UTC(2026, 6, 21, 15, 0, 0);
    const rows = [
      buildClosedTradeReview({
        ts: Date.UTC(2026, 6, 21, 1, 0, 0),
        mode: "paper",
        symbol: "SOL",
        side: "long",
        entryPrice: 100,
        exitPrice: 110,
        stopLossPrice: 95,
        notionalUsd: 500,
        realizedPnlUsd: 50,
        exitReason: "tp",
        signature: "w1",
      }),
      buildClosedTradeReview({
        ts: Date.UTC(2026, 6, 21, 2, 0, 0),
        mode: "paper",
        symbol: "SOL",
        side: "long",
        entryPrice: 100,
        exitPrice: 90,
        stopLossPrice: 95,
        notionalUsd: 500,
        realizedPnlUsd: -50,
        exitReason: "sl",
        signature: "l1",
      }),
      buildClosedTradeReview({
        ts: Date.UTC(2026, 6, 20, 23, 0, 0),
        mode: "paper",
        symbol: "SOL",
        side: "long",
        entryPrice: 100,
        exitPrice: 110,
        stopLossPrice: 95,
        notionalUsd: 500,
        realizedPnlUsd: 50,
        exitReason: "tp",
        signature: "old",
      }),
    ];
    expect(winRecordUtc(rows, now, "paper")).toEqual({ wins: 1, total: 2 });
    expect(winRecordUtc(rows, now, "live")).toBeNull();
  });
});
