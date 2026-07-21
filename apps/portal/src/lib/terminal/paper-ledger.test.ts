import { describe, expect, test } from "bun:test";
import {
  addPaperMargin,
  cancelPaperOrder,
  closePaperPosition,
  createEmptyLedger,
  ledgerToTraderState,
  placePaperOrder,
  resetPaperLedger,
  setPaperTpSl,
  tickPaperLedger,
  topUpPaperCash,
  PAPER_STARTING_BALANCE,
} from "./paper-ledger";

describe("paper-ledger", () => {
  test("starts with the default paper balance", () => {
    const ledger = createEmptyLedger();
    expect(ledger.cashUsd).toBe(PAPER_STARTING_BALANCE);
    expect(ledgerToTraderState(ledger).collateralUsd).toBe(
      PAPER_STARTING_BALANCE,
    );
    expect(ledgerToTraderState(ledger).chainVerified).toBe(true);
  });

  test("market long opens a position and locks margin", () => {
    const { ledger, events } = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: 110,
      stopLossPrice: 95,
      reduceOnly: false,
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("open");
    expect(ledger.cashUsd).toBe(PAPER_STARTING_BALANCE - 100);
    expect(ledger.positions).toHaveLength(1);
    expect(ledger.positions[0]?.size).toBeCloseTo(5);
    expect(ledger.positions[0]?.entryPrice).toBe(100);
    expect(ledger.positions[0]?.marginUsd).toBe(100);
    expect(ledger.positions[0]?.takeProfitPrice).toBe(110);
  });

  test("rejects orders larger than free cash", () => {
    expect(() =>
      placePaperOrder(createEmptyLedger(50), {
        symbol: "SOL",
        side: "bid",
        orderType: "market",
        notionalUsd: 500,
        leverage: 5,
        price: 100,
        takeProfitPrice: null,
        stopLossPrice: null,
        reduceOnly: false,
      }),
    ).toThrow(/Insufficient paper balance/);
  });

  test("close returns margin plus realized pnl", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    }).ledger;
    const { ledger, event } = closePaperPosition(
      opened,
      "SOL",
      opened.positions[0]!.subaccountIndex,
      1,
      110,
    );
    expect(ledger.positions).toHaveLength(0);
    // margin 100 + pnl (10 * 5) = 150 returned → cash 10000 - 100 + 150
    expect(ledger.cashUsd).toBe(PAPER_STARTING_BALANCE + 50);
    expect(event?.realizedPnlUsd).toBeCloseTo(50);
  });

  test("limit rests then fills when mid crosses", () => {
    const placed = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "limit",
      notionalUsd: 200,
      leverage: 2,
      price: 90,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    });
    expect(placed.ledger.orders).toHaveLength(1);
    expect(placed.ledger.cashUsd).toBe(PAPER_STARTING_BALANCE - 100);

    const still = tickPaperLedger(placed.ledger, { SOL: 95 });
    expect(still.ledger.orders).toHaveLength(1);
    expect(still.ledger.positions).toHaveLength(0);

    const filled = tickPaperLedger(placed.ledger, { SOL: 89 });
    expect(filled.ledger.orders).toHaveLength(0);
    expect(filled.ledger.positions).toHaveLength(1);
    expect(filled.events.some((event) => event.kind === "limit_fill")).toBe(
      true,
    );
  });

  test("cancel limit refunds reserved margin", () => {
    const placed = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "ask",
      orderType: "limit",
      notionalUsd: 200,
      leverage: 2,
      price: 120,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    });
    const orderId = placed.ledger.orders[0]!.orderSequenceNumber;
    const cancelled = cancelPaperOrder(placed.ledger, orderId);
    expect(cancelled.orders).toHaveLength(0);
    expect(cancelled.cashUsd).toBe(PAPER_STARTING_BALANCE);
  });

  test("take profit fires on tick", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: 108,
      stopLossPrice: null,
      reduceOnly: false,
    }).ledger;
    const ticked = tickPaperLedger(opened, { SOL: 108 });
    expect(ticked.ledger.positions).toHaveLength(0);
    expect(ticked.events[0]?.kind).toBe("tp");
  });

  test("stop loss fires on tick", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: null,
      stopLossPrice: 96,
      reduceOnly: false,
    }).ledger;
    const ticked = tickPaperLedger(opened, { SOL: 96 });
    expect(ticked.ledger.positions).toHaveLength(0);
    expect(ticked.events[0]?.kind).toBe("sl");
  });

  test("setPaperTpSl updates triggers", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    }).ledger;
    const idx = opened.positions[0]!.subaccountIndex;
    const next = setPaperTpSl(opened, "SOL", idx, {
      takeProfitPrice: 115,
      stopLossPrice: 92,
    });
    expect(next.positions[0]?.takeProfitPrice).toBe(115);
    expect(next.positions[0]?.stopLossPrice).toBe(92);
  });

  test("addPaperMargin moves cash into the position", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 500,
      leverage: 5,
      price: 100,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    }).ledger;
    const idx = opened.positions[0]!.subaccountIndex;
    const next = addPaperMargin(opened, "SOL", idx, 50);
    expect(next.cashUsd).toBe(PAPER_STARTING_BALANCE - 150);
    expect(next.positions[0]?.marginUsd).toBe(150);
  });

  test("topUp and reset", () => {
    const topped = topUpPaperCash(createEmptyLedger(100), 50);
    expect(topped.cashUsd).toBe(150);
    expect(resetPaperLedger().cashUsd).toBe(PAPER_STARTING_BALANCE);
  });

  test("liquidation forfeits margin at high leverage", () => {
    const opened = placePaperOrder(createEmptyLedger(), {
      symbol: "SOL",
      side: "bid",
      orderType: "market",
      notionalUsd: 1000,
      leverage: 10,
      price: 100,
      takeProfitPrice: null,
      stopLossPrice: null,
      reduceOnly: false,
    }).ledger;
    // 10x long liq ≈ entry * (1 - 0.1) = 90
    const ticked = tickPaperLedger(opened, { SOL: 89 });
    expect(ticked.ledger.positions).toHaveLength(0);
    expect(ticked.events[0]?.kind).toBe("liq");
    // margin forfeited — cash stays at 10000 - 100
    expect(ticked.ledger.cashUsd).toBe(PAPER_STARTING_BALANCE - 100);
  });
});
