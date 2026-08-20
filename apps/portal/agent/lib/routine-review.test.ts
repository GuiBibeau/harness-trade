import { describe, expect, test } from "bun:test";
import {
  buildMarketReviewPlan,
  formatMarketReviewAlertBody,
} from "./routine-review";

describe("buildMarketReviewPlan", () => {
  test("marks bullish bias and drafts an observe-only plan", () => {
    const plan = buildMarketReviewPlan({
      symbol: "SOL",
      timeframe: "15m",
      candles: [
        { high: 101, low: 99, close: 100 },
        { high: 103, low: 100.5, close: 102 },
        { high: 105, low: 101, close: 104 },
      ],
    });

    expect(plan.bias).toBe("bullish");
    expect(plan.changePct).toBeCloseTo(4, 5);
    expect(plan.rangeHigh).toBe(105);
    expect(plan.rangeLow).toBe(99);
    expect(plan.draftPlan).toContain("observe-only");
    expect(plan.draftPlan).toContain("will not execute");
    expect(formatMarketReviewAlertBody(plan)).toContain("BULLISH");
  });

  test("marks bearish bias from a drop past the threshold", () => {
    const plan = buildMarketReviewPlan({
      symbol: "BTC",
      timeframe: "1h",
      candles: [
        { high: 100_100, low: 99_900, close: 100_000 },
        { high: 99_500, low: 98_800, close: 99_000 },
      ],
    });
    expect(plan.bias).toBe("bearish");
    expect(plan.invalidationHint).toContain("above");
  });

  test("marks neutral inside the threshold band", () => {
    const plan = buildMarketReviewPlan({
      symbol: "ETH",
      timeframe: "15m",
      candles: [
        { high: 3501, low: 3499, close: 3500 },
        { high: 3505, low: 3498, close: 3502 },
      ],
    });
    expect(plan.bias).toBe("neutral");
    expect(plan.invalidationHint).toContain("outside");
  });
});
