import { describe, expect, test } from "bun:test";
import { sessionMoveFacts } from "./explain-move";

describe("sessionMoveFacts", () => {
  test("null with fewer than two candles", () => {
    expect(
      sessionMoveFacts([], {
        symbol: "SOL",
        venue: "perp",
        timeframe: "15m",
        change24hPct: 1,
      }),
    ).toBeNull();
    expect(
      sessionMoveFacts(
        [
          {
            ts: 1,
            open: 100,
            high: 101,
            low: 99,
            close: 100.5,
            price: 100.5,
            volumeQuote: 10,
          },
        ],
        {
          symbol: "SOL",
          venue: "perp",
          timeframe: "15m",
          change24hPct: 1,
        },
      ),
    ).toBeNull();
  });

  test("computes session change, range, and volume from the window", () => {
    const facts = sessionMoveFacts(
      [
        {
          ts: 1,
          open: 100,
          high: 105,
          low: 98,
          close: 102,
          price: 102,
          volumeQuote: 10,
        },
        {
          ts: 2,
          open: 102,
          high: 110,
          low: 101,
          close: 108,
          price: 108,
          volumeQuote: 20,
        },
      ],
      {
        symbol: "SOL",
        venue: "perp",
        timeframe: "15m",
        change24hPct: 3.5,
      },
    );
    expect(facts).toEqual({
      symbol: "SOL",
      venue: "perp",
      timeframe: "15m",
      bars: 2,
      open: 100,
      close: 108,
      high: 110,
      low: 98,
      sessionChangePct: 8,
      rangePct: 12,
      change24hPct: 3.5,
      volumeQuote: 30,
    });
  });
});
