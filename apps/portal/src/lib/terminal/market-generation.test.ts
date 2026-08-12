import { describe, expect, test } from "bun:test";
import { isCurrentMarketGeneration } from "./market-generation";

describe("isCurrentMarketGeneration", () => {
  test("accepts matching seq and symbol", () => {
    expect(
      isCurrentMarketGeneration({
        seq: 3,
        currentSeq: 3,
        expectedSymbol: "SOL",
        selectedSymbol: "SOL",
      }),
    ).toBe(true);
  });

  test("rejects stale generation after a later switch", () => {
    expect(
      isCurrentMarketGeneration({
        seq: 2,
        currentSeq: 3,
        expectedSymbol: "SOL",
        selectedSymbol: "SOL",
      }),
    ).toBe(false);
  });

  test("rejects when the selected symbol moved on", () => {
    expect(
      isCurrentMarketGeneration({
        seq: 3,
        currentSeq: 3,
        expectedSymbol: "SOL",
        selectedSymbol: "BTC",
      }),
    ).toBe(false);
  });
});
