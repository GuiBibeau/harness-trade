import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { createPerpTicket, type PerpTicketInputs } from "./perp-ticket";
import {
  buildTradePreview,
  fmtTriggerPrice,
  riskNotional,
  triggerPriceForPct,
} from "./trade-math";

const ASKS = [
  { price: 100.5, size: 10, cum: 10 },
  { price: 101, size: 10, cum: 20 },
];
const BIDS = [
  { price: 99.5, size: 10, cum: 10 },
  { price: 99, size: 10, cum: 20 },
];

function inputs(overrides: Partial<PerpTicketInputs> = {}): PerpTicketInputs {
  return {
    asks: ASKS,
    bids: BIDS,
    latestPrice: 100,
    fundingPercent: 0.01,
    tradeOpen: false,
    perpsMode: true,
    stackedBook: true,
    tradeTab: true,
    hasAuthority: true,
    stateKnown: true,
    chainVerified: true,
    collateralUsd: 1_000,
    candles: [],
    prevDayHigh: null,
    prevDayLow: null,
    symbol: "SOL",
    journalEntries: [],
    ...overrides,
  };
}

describe("ticketActive / tradePreview", () => {
  test("preview only computes while a perp ticket is showing", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(
      inputs({ perpsMode: false, stackedBook: false, tradeTab: false }),
    );
    expect(get(ticket.ticketActive)).toBe(false);
    expect(get(ticket.tradePreview)).toBeNull();

    // The trade modal alone activates the ticket, whatever the venue.
    ticket.setInputs(
      inputs({
        perpsMode: false,
        stackedBook: false,
        tradeTab: false,
        tradeOpen: true,
      }),
    );
    expect(get(ticket.ticketActive)).toBe(true);
    expect(get(ticket.tradePreview)).not.toBeNull();
  });

  test("preview matches buildTradePreview field-for-field", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs());
    expect(get(ticket.tradePreview)).toEqual(
      buildTradePreview("buy", "25", 2, "market", "", ASKS, BIDS, 100, 0.01),
    );
  });
});

describe("prefill / setSide", () => {
  test("prefill arms a limit ticket at the book price, side only", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs());
    ticket.tradeTakeProfit.set("111");
    ticket.prefill(101.25, "sell");
    expect(get(ticket.tradeSide)).toBe("sell");
    expect(get(ticket.tradeType)).toBe("limit");
    expect(get(ticket.tradeLimitPrice)).toBe("101.25");
    // Size/TP/SL stay put — the book you were reading stays comparable.
    expect(get(ticket.tradeTakeProfit)).toBe("111");
  });

  test("setSide flips a live ticket in place but resets triggers on a fresh open", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs());
    ticket.tradeTakeProfit.set("110");
    ticket.tradeStopLoss.set("95");
    ticket.setSide("sell");
    expect(get(ticket.tradeTakeProfit)).toBe("110");
    expect(get(ticket.tradeStopLoss)).toBe("95");

    // Ticket hidden (spot venue, no modal): next open is fresh.
    ticket.setInputs(
      inputs({ perpsMode: false, stackedBook: false, tradeTab: false }),
    );
    ticket.setSide("buy");
    expect(get(ticket.tradeSide)).toBe("buy");
    expect(get(ticket.tradeTakeProfit)).toBe("");
    expect(get(ticket.tradeStopLoss)).toBe("");
  });
});

describe("TP/SL analysis", () => {
  test("chips quick-set triggers from the same reference the submit gate uses", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs());
    ticket.tradeType.set("limit");
    ticket.tradeLimitPrice.set("100");
    ticket.setTakeProfitPct(5);
    ticket.setStopLossPct(2);
    expect(get(ticket.tradeTakeProfit)).toBe(
      fmtTriggerPrice(triggerPriceForPct(100, "buy", 5, "tp")),
    );
    expect(get(ticket.tradeStopLoss)).toBe(
      fmtTriggerPrice(triggerPriceForPct(100, "buy", 2, "sl")),
    );
    expect(get(ticket.tpWrongSide)).toBe(false);
    expect(get(ticket.slWrongSide)).toBe(false);
    expect(get(ticket.tpPct)).toBeCloseTo(5);
    expect(get(ticket.slPct)).toBeCloseTo(-2);
  });

  test("wrong-side triggers are flagged as you type", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs());
    ticket.tradeType.set("limit");
    ticket.tradeLimitPrice.set("100");
    ticket.tradeTakeProfit.set("90"); // TP below entry on a long
    ticket.tradeStopLoss.set("110"); // SL above entry on a long
    expect(get(ticket.tpWrongSide)).toBe(true);
    expect(get(ticket.slWrongSide)).toBe(true);
    ticket.setSide("sell");
    expect(get(ticket.tpWrongSide)).toBe(false);
    expect(get(ticket.slWrongSide)).toBe(false);
  });

  test("TP/SL P&L scales with the previewed notional and side", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs());
    ticket.tradeType.set("limit");
    ticket.tradeLimitPrice.set("100");
    ticket.tradeAmount.set("200");
    ticket.tradeTakeProfit.set("110");
    expect(get(ticket.tpPnlUsd)).toBeCloseTo(20); // +10% on $200 long
    ticket.setSide("sell");
    expect(get(ticket.tpWrongSide)).toBe(true); // stale trigger flagged…
    expect(get(ticket.tpPnlUsd)).toBeCloseTo(-20); // …and P&L flips sign
  });
});

describe("risk sizing", () => {
  test("risk mode derives the notional from stop distance", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs());
    ticket.sizingMode.set("risk");
    ticket.tradeRiskUsd.set("50");
    ticket.tradeStopLoss.set("95");
    const expected = riskNotional(50, 100, 95);
    expect(get(ticket.riskNotionalUsd)).toBe(expected);
    expect(get(ticket.effectiveTradeAmount)).toBe(String(expected));
    expect(get(ticket.tradePreview)?.notionalUsd).toBe(expected as number);
  });

  test("risk mode without a stop produces no preview", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs());
    ticket.sizingMode.set("risk");
    expect(get(ticket.riskNotionalUsd)).toBeNull();
    expect(get(ticket.effectiveTradeAmount)).toBe("");
    expect(get(ticket.tradePreview)).toBeNull();
  });
});

describe("funding gate", () => {
  test("requiredMarginUsd is notional/leverage and zero for reduce-only", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs());
    ticket.tradeAmount.set("100");
    ticket.tradeLeverage.set(4);
    expect(get(ticket.requiredMarginUsd)).toBeCloseTo(25);
    ticket.tradeReduceOnly.set(true);
    expect(get(ticket.requiredMarginUsd)).toBe(0);
  });

  test("the shortfall must hold ~1.2s before prompting a deposit", () => {
    const ticket = createPerpTicket();
    // $25 at 2x needs $12.50 margin; the account only holds $5.
    ticket.setInputs(inputs({ collateralUsd: 5 }));
    ticket.setNow(Date.now());
    expect(get(ticket.needsPhoenixFunding)).toBe(false); // debounce
    ticket.setNow(Date.now() + 2_000);
    expect(get(ticket.needsPhoenixFunding)).toBe(true);
    // Collateral arrives: the prompt clears immediately.
    ticket.setInputs(inputs({ collateralUsd: 500 }));
    expect(get(ticket.needsPhoenixFunding)).toBe(false);
  });

  test("never prompts off unverified state (chain-first truth)", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs({ collateralUsd: 5, chainVerified: false }));
    ticket.setNow(Date.now() + 10_000);
    expect(get(ticket.needsPhoenixFunding)).toBe(false);
  });
});

describe("ghost TP/SL", () => {
  test("ghosts appear from prev-day structure when fields are empty", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(
      inputs({
        prevDayLow: 95,
        prevDayHigh: 110,
      }),
    );
    ticket.tradeType.set("limit");
    ticket.tradeLimitPrice.set("100");
    expect(get(ticket.ghostSl)?.source).toBe("prev-day");
    expect(get(ticket.ghostSl)?.value).toBeCloseTo(95 * (1 - 0.3 / 100));
    // TP needs a stop distance for r-multiple when no opposing swings.
    ticket.tradeStopLoss.set("95");
    expect(get(ticket.ghostTp)?.source).toBe("r-multiple");
    expect(get(ticket.ghostSl)).toBeNull(); // field no longer empty
  });

  test("filled fields never show ghosts; dismiss hides until side/symbol reset", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs({ prevDayLow: 95 }));
    ticket.tradeType.set("limit");
    ticket.tradeLimitPrice.set("100");
    expect(get(ticket.ghostSl)).not.toBeNull();

    ticket.dismissGhostSl();
    expect(get(ticket.ghostSl)).toBeNull();

    ticket.tradeSide.set("sell");
    ticket.setInputs(inputs({ prevDayHigh: 110, symbol: "SOL" }));
    ticket.tradeType.set("limit");
    ticket.tradeLimitPrice.set("100");
    expect(get(ticket.ghostSl)).not.toBeNull();

    ticket.dismissGhostSl();
    ticket.setInputs(inputs({ prevDayHigh: 110, symbol: "BTC" }));
    expect(get(ticket.ghostSl)).not.toBeNull();
  });

  test("acceptGhostSl writes fmtTriggerPrice and drives risk sizing", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs({ prevDayLow: 95 }));
    ticket.tradeType.set("limit");
    ticket.tradeLimitPrice.set("100");
    ticket.sizingMode.set("risk");
    ticket.tradeRiskUsd.set("50");
    expect(ticket.acceptGhostSl()).toBe(true);
    const sl = get(ticket.tradeStopLoss);
    expect(sl).toBe(fmtTriggerPrice(95 * (1 - 0.3 / 100)));
    expect(get(ticket.riskNotionalUsd)).toBe(riskNotional(50, 100, Number(sl)));
    expect(get(ticket.ghostSl)).toBeNull();
  });

  test("no candles and no prev-day levels → no ghosts", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs());
    ticket.tradeType.set("limit");
    ticket.tradeLimitPrice.set("100");
    expect(get(ticket.ghostTp)).toBeNull();
    expect(get(ticket.ghostSl)).toBeNull();
  });
});

describe("ghost size/leverage", () => {
  function journalSeed(count: number, symbol = "SOL") {
    return Array.from({ length: count }, (_, index) => ({
      ts: 1_700_000_000_000 + index,
      venue: "perp" as const,
      symbol,
      action: "buy",
      notionalUsd: 20 + index * 2,
      price: 100,
      leverage: index % 2 === 0 ? 5 : 5,
      mode: "paper" as const,
      signature: `sig-${index}`,
    }));
  }

  test("≥5 journal entries → ghost; Tab accept sets amount + leverage", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs({ journalEntries: journalSeed(5) }));
    ticket.tradeAmount.set("");
    ticket.sizingMode.set("usd");
    const ghost = get(ticket.ghostSize);
    expect(ghost).not.toBeNull();
    if (!ghost) throw new Error("expected ghost size");
    expect(ghost.sampleSize).toBe(5);
    expect(ticket.acceptGhostSize()).toBe(true);
    expect(get(ticket.tradeAmount)).toBe(String(Math.round(ghost.notionalUsd)));
    expect(get(ticket.tradeLeverage)).toBe(5);
    expect(get(ticket.ghostSize)).toBeNull();
  });

  test("below floor or risk mode → no ghost", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs({ journalEntries: journalSeed(4) }));
    ticket.tradeAmount.set("");
    expect(get(ticket.ghostSize)).toBeNull();

    ticket.setInputs(inputs({ journalEntries: journalSeed(6) }));
    ticket.tradeAmount.set("");
    ticket.sizingMode.set("risk");
    expect(get(ticket.ghostSize)).toBeNull();
  });

  test("dismiss hides until symbol reset", () => {
    const ticket = createPerpTicket();
    ticket.setInputs(inputs({ journalEntries: journalSeed(5) }));
    ticket.tradeAmount.set("");
    expect(get(ticket.ghostSize)).not.toBeNull();
    ticket.dismissGhostSize();
    expect(get(ticket.ghostSize)).toBeNull();
    ticket.setInputs(
      inputs({
        symbol: "BTC",
        journalEntries: journalSeed(5, "BTC"),
      }),
    );
    ticket.tradeAmount.set("");
    expect(get(ticket.ghostSize)).not.toBeNull();
  });
});
