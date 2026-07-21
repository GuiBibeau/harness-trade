// Paper trading ledger — local simulated Phoenix account on live mids.
// Frontend-only: no signing, no chain. Desk UI consumes the same
// PhoenixTraderState shape via ledgerToTraderState().

import { persisted } from "../persisted";
import type {
  PhoenixOpenOrder,
  PhoenixPosition,
  PhoenixSide,
  PhoenixTraderState,
} from "../phoenix-trade";

export const PAPER_AUTHORITY = "paper";
export const PAPER_STARTING_BALANCE = 10_000;
export const PAPER_STORAGE_KEY = "trader-ralph-terminal/paper-ledger/v1";

export type PaperRestingOrder = PhoenixOpenOrder & {
  marginUsd: number;
  leverage: number;
  notionalUsd: number;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
};

export type PaperLedger = {
  version: 1;
  cashUsd: number;
  positions: PhoenixPosition[];
  orders: PaperRestingOrder[];
  nextOrderId: number;
  nextSubaccount: number;
};

export type PaperPlaceOrderInput = {
  symbol: string;
  side: PhoenixSide;
  orderType: "market" | "limit";
  notionalUsd: number;
  leverage: number;
  /** Fill price for market; limit price for resting orders. */
  price: number;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  reduceOnly: boolean;
};

export type PaperEvent = {
  kind: "open" | "close" | "tp" | "sl" | "liq" | "limit_fill";
  symbol: string;
  side: PhoenixSide;
  notionalUsd: number;
  price: number;
  leverage: number | null;
  realizedPnlUsd: number;
  signature: string;
};

export function createEmptyLedger(
  cashUsd = PAPER_STARTING_BALANCE,
): PaperLedger {
  return {
    version: 1,
    cashUsd,
    positions: [],
    orders: [],
    nextOrderId: 1,
    nextSubaccount: 1,
  };
}

export function resetPaperLedger(): PaperLedger {
  return createEmptyLedger();
}

export function topUpPaperCash(ledger: PaperLedger, amount: number): PaperLedger {
  if (!Number.isFinite(amount) || amount <= 0) return ledger;
  return { ...ledger, cashUsd: ledger.cashUsd + amount };
}

export function ledgerToTraderState(ledger: PaperLedger): PhoenixTraderState {
  const marginInPositions = ledger.positions.reduce(
    (sum, position) => sum + (position.marginUsd ?? 0),
    0,
  );
  const marginInOrders = ledger.orders.reduce(
    (sum, order) => sum + order.marginUsd,
    0,
  );
  const total = ledger.cashUsd + marginInPositions + marginInOrders;
  return {
    registered: true,
    chainVerified: true,
    apiSlot: null,
    collateralUsd: ledger.cashUsd,
    totalCollateralUsd: total,
    effectiveCollateralUsd: total,
    unrealizedPnlUsd: null,
    riskTier: "paper",
    positions: ledger.positions.map((position) => ({ ...position })),
    orders: ledger.orders.map((order) => ({
      symbol: order.symbol,
      side: order.side,
      price: order.price,
      remaining: order.remaining,
      orderSequenceNumber: order.orderSequenceNumber,
      isStopLoss: order.isStopLoss,
      isStopLossDirection: order.isStopLossDirection,
      traderPdaIndex: order.traderPdaIndex,
      subaccountIndex: order.subaccountIndex,
    })),
  };
}

function paperSignature(kind: string): string {
  return `paper-${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function signedSize(side: PhoenixSide, baseQty: number): number {
  return side === "bid" ? baseQty : -baseQty;
}

function validateTriggers(
  side: PhoenixSide,
  refPrice: number,
  takeProfitPrice: number | null,
  stopLossPrice: number | null,
): void {
  if (takeProfitPrice !== null) {
    const valid =
      side === "bid" ? takeProfitPrice > refPrice : takeProfitPrice < refPrice;
    if (!valid) {
      throw new Error(
        `Take profit must be ${side === "bid" ? "above" : "below"} entry`,
      );
    }
  }
  if (stopLossPrice !== null) {
    const valid =
      side === "bid" ? stopLossPrice < refPrice : stopLossPrice > refPrice;
    if (!valid) {
      throw new Error(
        `Stop loss must be ${side === "bid" ? "below" : "above"} entry`,
      );
    }
  }
}

function findPosition(
  ledger: PaperLedger,
  symbol: string,
  subaccountIndex?: number,
): PhoenixPosition | undefined {
  if (subaccountIndex !== undefined) {
    return ledger.positions.find(
      (position) =>
        position.symbol === symbol &&
        position.subaccountIndex === subaccountIndex,
    );
  }
  return ledger.positions.find((position) => position.symbol === symbol);
}

function replacePosition(
  ledger: PaperLedger,
  next: PhoenixPosition | null,
  symbol: string,
  subaccountIndex: number,
): PaperLedger {
  const positions = ledger.positions.filter(
    (position) =>
      !(
        position.symbol === symbol &&
        position.subaccountIndex === subaccountIndex
      ),
  );
  if (next && next.size !== 0) positions.push(next);
  return { ...ledger, positions };
}

function realizedPnl(
  entry: number,
  exit: number,
  closedSignedSize: number,
): number {
  return (exit - entry) * closedSignedSize;
}

/** Close fraction of a position at price; returns margin+pnl to cash. */
export function closePaperPosition(
  ledger: PaperLedger,
  symbol: string,
  subaccountIndex: number,
  fraction: number,
  price: number,
  kind: PaperEvent["kind"] = "close",
): { ledger: PaperLedger; event: PaperEvent | null } {
  const position = findPosition(ledger, symbol, subaccountIndex);
  if (!position || position.size === 0 || !position.entryPrice) {
    return { ledger, event: null };
  }
  const frac = Math.min(1, Math.max(0, fraction));
  if (frac <= 0 || !Number.isFinite(price) || price <= 0) {
    return { ledger, event: null };
  }

  const closedSize = position.size * frac;
  const marginRelease = (position.marginUsd ?? 0) * frac;
  const pnl = realizedPnl(position.entryPrice, price, closedSize);
  const side: PhoenixSide = position.size > 0 ? "ask" : "bid";
  const notionalUsd = Math.abs(closedSize) * price;

  let nextLedger: PaperLedger = {
    ...ledger,
    cashUsd: ledger.cashUsd + marginRelease + pnl,
  };

  if (frac >= 1 - 1e-12) {
    nextLedger = replacePosition(
      nextLedger,
      null,
      symbol,
      subaccountIndex,
    );
  } else {
    nextLedger = replacePosition(
      nextLedger,
      {
        ...position,
        size: position.size - closedSize,
        marginUsd: (position.marginUsd ?? 0) - marginRelease,
        positionValue: Math.abs(position.size - closedSize) * price,
        unrealizedPnl: null,
      },
      symbol,
      subaccountIndex,
    );
  }

  return {
    ledger: nextLedger,
    event: {
      kind,
      symbol,
      side,
      notionalUsd,
      price,
      leverage: null,
      realizedPnlUsd: pnl,
      signature: paperSignature(kind),
    },
  };
}

function openOrAddPosition(
  ledger: PaperLedger,
  input: PaperPlaceOrderInput,
  fillPrice: number,
): { ledger: PaperLedger; event: PaperEvent } {
  const leverage = Math.max(1, input.leverage);
  const marginUsd = input.notionalUsd / leverage;
  if (ledger.cashUsd + 1e-9 < marginUsd) {
    throw new Error(
      `Insufficient paper balance — need $${marginUsd.toFixed(2)}, have $${ledger.cashUsd.toFixed(2)}`,
    );
  }

  validateTriggers(
    input.side,
    fillPrice,
    input.takeProfitPrice,
    input.stopLossPrice,
  );

  const baseQty = input.notionalUsd / fillPrice;
  const addSize = signedSize(input.side, baseQty);
  const existing = findPosition(ledger, input.symbol);

  let nextLedger: PaperLedger = {
    ...ledger,
    cashUsd: ledger.cashUsd - marginUsd,
  };

  if (existing && Math.sign(existing.size) === Math.sign(addSize)) {
    const oldAbs = Math.abs(existing.size);
    const addAbs = Math.abs(addSize);
    const entry = existing.entryPrice ?? fillPrice;
    const newEntry = (entry * oldAbs + fillPrice * addAbs) / (oldAbs + addAbs);
    nextLedger = replacePosition(
      nextLedger,
      {
        ...existing,
        size: existing.size + addSize,
        entryPrice: newEntry,
        marginUsd: (existing.marginUsd ?? 0) + marginUsd,
        takeProfitPrice: input.takeProfitPrice ?? existing.takeProfitPrice,
        stopLossPrice: input.stopLossPrice ?? existing.stopLossPrice,
        positionValue: Math.abs(existing.size + addSize) * fillPrice,
        unrealizedPnl: null,
        liquidationPrice: null,
      },
      existing.symbol,
      existing.subaccountIndex,
    );
  } else if (existing && existing.size !== 0) {
    // Opposite side: close existing first, then open remainder if any.
    // Refund the pre-deducted open margin — close returns its own slice;
    // any leftover open re-charges margin via recursion.
    nextLedger = { ...nextLedger, cashUsd: nextLedger.cashUsd + marginUsd };
    const closeFrac = Math.min(1, baseQty / Math.abs(existing.size));
    const closed = closePaperPosition(
      nextLedger,
      existing.symbol,
      existing.subaccountIndex,
      closeFrac,
      fillPrice,
      "close",
    );
    nextLedger = closed.ledger;
    const remainingQty = baseQty - Math.abs(existing.size) * closeFrac;
    if (remainingQty > 1e-12) {
      return openOrAddPosition(
        nextLedger,
        {
          ...input,
          notionalUsd: remainingQty * fillPrice,
          reduceOnly: false,
        },
        fillPrice,
      );
    }
    return {
      ledger: nextLedger,
      event: closed.event ?? {
        kind: "close",
        symbol: input.symbol,
        side: input.side,
        notionalUsd: input.notionalUsd,
        price: fillPrice,
        leverage,
        realizedPnlUsd: 0,
        signature: paperSignature("close"),
      },
    };
  } else {
    const subaccountIndex = nextLedger.nextSubaccount;
    nextLedger = {
      ...replacePosition(
        nextLedger,
        {
          symbol: input.symbol,
          size: addSize,
          entryPrice: fillPrice,
          liquidationPrice: null,
          unrealizedPnl: null,
          positionValue: input.notionalUsd,
          takeProfitPrice: input.takeProfitPrice,
          stopLossPrice: input.stopLossPrice,
          traderPdaIndex: 0,
          subaccountIndex,
          marginUsd,
        },
        input.symbol,
        subaccountIndex,
      ),
      nextSubaccount: subaccountIndex + 1,
    };
  }

  return {
    ledger: nextLedger,
    event: {
      kind: "open",
      symbol: input.symbol,
      side: input.side,
      notionalUsd: input.notionalUsd,
      price: fillPrice,
      leverage,
      realizedPnlUsd: 0,
      signature: paperSignature("open"),
    },
  };
}

function reduceOnlyFill(
  ledger: PaperLedger,
  input: PaperPlaceOrderInput,
  fillPrice: number,
): { ledger: PaperLedger; event: PaperEvent | null } {
  const position = findPosition(ledger, input.symbol);
  if (!position || position.size === 0) {
    throw new Error("No position to reduce");
  }
  const closingLong = position.size > 0;
  const orderCloses =
    (closingLong && input.side === "ask") ||
    (!closingLong && input.side === "bid");
  if (!orderCloses) {
    throw new Error("Reduce-only order must close the open side");
  }
  const baseQty = input.notionalUsd / fillPrice;
  const fraction = Math.min(1, baseQty / Math.abs(position.size));
  return closePaperPosition(
    ledger,
    position.symbol,
    position.subaccountIndex,
    fraction,
    fillPrice,
    "close",
  );
}

export function placePaperOrder(
  ledger: PaperLedger,
  input: PaperPlaceOrderInput,
): { ledger: PaperLedger; events: PaperEvent[] } {
  if (
    !Number.isFinite(input.notionalUsd) ||
    input.notionalUsd <= 0 ||
    !Number.isFinite(input.price) ||
    input.price <= 0
  ) {
    throw new Error("Invalid paper order size or price");
  }

  if (input.orderType === "limit") {
    validateTriggers(
      input.side,
      input.price,
      input.takeProfitPrice,
      input.stopLossPrice,
    );
    const leverage = Math.max(1, input.leverage);
    const marginUsd = input.reduceOnly ? 0 : input.notionalUsd / leverage;
    if (!input.reduceOnly && ledger.cashUsd + 1e-9 < marginUsd) {
      throw new Error(
        `Insufficient paper balance — need $${marginUsd.toFixed(2)}, have $${ledger.cashUsd.toFixed(2)}`,
      );
    }
    const baseQty = input.notionalUsd / input.price;
    const orderId = `paper-${ledger.nextOrderId}`;
    const order: PaperRestingOrder = {
      symbol: input.symbol,
      side: input.side,
      price: input.price,
      remaining: baseQty,
      orderSequenceNumber: orderId,
      isStopLoss: false,
      isStopLossDirection: false,
      traderPdaIndex: 0,
      subaccountIndex: 0,
      marginUsd,
      leverage,
      notionalUsd: input.notionalUsd,
      takeProfitPrice: input.takeProfitPrice,
      stopLossPrice: input.stopLossPrice,
    };
    return {
      ledger: {
        ...ledger,
        cashUsd: ledger.cashUsd - marginUsd,
        orders: [...ledger.orders, order],
        nextOrderId: ledger.nextOrderId + 1,
      },
      events: [],
    };
  }

  if (input.reduceOnly) {
    const result = reduceOnlyFill(ledger, input, input.price);
    return {
      ledger: result.ledger,
      events: result.event ? [result.event] : [],
    };
  }

  const result = openOrAddPosition(ledger, input, input.price);
  return { ledger: result.ledger, events: [result.event] };
}

export function cancelPaperOrder(
  ledger: PaperLedger,
  orderSequenceNumber: string,
): PaperLedger {
  const order = ledger.orders.find(
    (row) => row.orderSequenceNumber === orderSequenceNumber,
  );
  if (!order) return ledger;
  return {
    ...ledger,
    cashUsd: ledger.cashUsd + order.marginUsd,
    orders: ledger.orders.filter(
      (row) => row.orderSequenceNumber !== orderSequenceNumber,
    ),
  };
}

export function cancelPaperOrdersOnSide(
  ledger: PaperLedger,
  symbol: string,
  side: PhoenixSide,
): PaperLedger {
  let next = ledger;
  for (const order of ledger.orders) {
    if (order.symbol === symbol && order.side === side) {
      next = cancelPaperOrder(next, order.orderSequenceNumber);
    }
  }
  return next;
}

export function setPaperTpSl(
  ledger: PaperLedger,
  symbol: string,
  subaccountIndex: number,
  patch: { takeProfitPrice?: number | null; stopLossPrice?: number | null },
): PaperLedger {
  const position = findPosition(ledger, symbol, subaccountIndex);
  if (!position || !position.entryPrice) return ledger;
  const side: PhoenixSide = position.size > 0 ? "bid" : "ask";
  const tp =
    patch.takeProfitPrice !== undefined
      ? patch.takeProfitPrice
      : position.takeProfitPrice;
  const sl =
    patch.stopLossPrice !== undefined
      ? patch.stopLossPrice
      : position.stopLossPrice;
  if (tp != null && tp > 0) validateTriggers(side, position.entryPrice, tp, null);
  if (sl != null && sl > 0) validateTriggers(side, position.entryPrice, null, sl);
  return replacePosition(
    ledger,
    {
      ...position,
      takeProfitPrice: tp && tp > 0 ? tp : null,
      stopLossPrice: sl && sl > 0 ? sl : null,
    },
    symbol,
    subaccountIndex,
  );
}

export function addPaperMargin(
  ledger: PaperLedger,
  symbol: string,
  subaccountIndex: number,
  amount: number,
): PaperLedger {
  if (!Number.isFinite(amount) || amount <= 0) return ledger;
  if (ledger.cashUsd + 1e-9 < amount) {
    throw new Error("Insufficient paper free collateral");
  }
  const position = findPosition(ledger, symbol, subaccountIndex);
  if (!position) throw new Error("Position not found");
  return {
    ...replacePosition(
      ledger,
      {
        ...position,
        marginUsd: (position.marginUsd ?? 0) + amount,
      },
      symbol,
      subaccountIndex,
    ),
    cashUsd: ledger.cashUsd - amount,
  };
}

/**
 * Advance the ledger against live mids: fill crossed limits, fire TP/SL,
 * and liquidate when mark breaches the crude ticket-style liq estimate.
 */
export function tickPaperLedger(
  ledger: PaperLedger,
  mids: Record<string, number>,
): { ledger: PaperLedger; events: PaperEvent[] } {
  let next = ledger;
  const events: PaperEvent[] = [];

  // Resting limits
  for (const order of [...next.orders]) {
    const mid = mids[order.symbol];
    if (!mid || !order.price || !order.remaining) continue;
    const crossed =
      order.side === "bid" ? mid <= order.price : mid >= order.price;
    if (!crossed) continue;

    // Release reserved margin back, then open as market at limit price.
    next = {
      ...next,
      cashUsd: next.cashUsd + order.marginUsd,
      orders: next.orders.filter(
        (row) => row.orderSequenceNumber !== order.orderSequenceNumber,
      ),
    };
    const notionalUsd = order.remaining * order.price;
    try {
      const filled = placePaperOrder(next, {
        symbol: order.symbol,
        side: order.side,
        orderType: "market",
        notionalUsd,
        leverage: order.leverage,
        price: order.price,
        takeProfitPrice: order.takeProfitPrice,
        stopLossPrice: order.stopLossPrice,
        reduceOnly: order.marginUsd <= 0,
      });
      next = filled.ledger;
      for (const event of filled.events) {
        events.push({ ...event, kind: "limit_fill" });
      }
    } catch {
      // Leave cancelled (margin returned) if fill can't open — e.g. flip edge cases.
    }
  }

  // TP / SL / crude liquidation
  for (const position of [...next.positions]) {
    const mid = mids[position.symbol];
    if (!mid || !position.entryPrice || position.size === 0) continue;
    const long = position.size > 0;

    const tp = position.takeProfitPrice;
    if (tp != null && tp > 0) {
      const hit = long ? mid >= tp : mid <= tp;
      if (hit) {
        const closed = closePaperPosition(
          next,
          position.symbol,
          position.subaccountIndex,
          1,
          tp,
          "tp",
        );
        next = closed.ledger;
        if (closed.event) events.push(closed.event);
        continue;
      }
    }

    const sl = position.stopLossPrice;
    if (sl != null && sl > 0) {
      const hit = long ? mid <= sl : mid >= sl;
      if (hit) {
        const closed = closePaperPosition(
          next,
          position.symbol,
          position.subaccountIndex,
          1,
          sl,
          "sl",
        );
        next = closed.ledger;
        if (closed.event) events.push(closed.event);
        continue;
      }
    }

    // Crude liq: margin wiped when adverse move ≈ 1/leverage from entry.
    const margin = position.marginUsd ?? 0;
    const notional =
      Math.abs(position.size) * (position.entryPrice ?? mid);
    const lev = notional > 0 && margin > 0 ? notional / margin : 0;
    if (lev >= 1) {
      const liq = long
        ? position.entryPrice * (1 - 1 / lev)
        : position.entryPrice * (1 + 1 / lev);
      const hit = long ? mid <= liq : mid >= liq;
      if (hit && liq > 0) {
        // Liquidation: forfeit remaining margin, zero position.
        next = {
          ...replacePosition(
            next,
            null,
            position.symbol,
            position.subaccountIndex,
          ),
        };
        events.push({
          kind: "liq",
          symbol: position.symbol,
          side: long ? "ask" : "bid",
          notionalUsd: Math.abs(position.size) * mid,
          price: mid,
          leverage: lev,
          realizedPnlUsd: -margin,
          signature: paperSignature("liq"),
        });
      }
    }
  }

  return { ledger: next, events };
}

function parseLedger(value: unknown): PaperLedger {
  if (!value || typeof value !== "object") return createEmptyLedger();
  const raw = value as Partial<PaperLedger>;
  if (
    typeof raw.cashUsd !== "number" ||
    !Number.isFinite(raw.cashUsd) ||
    !Array.isArray(raw.positions) ||
    !Array.isArray(raw.orders)
  ) {
    return createEmptyLedger();
  }
  return {
    version: 1,
    cashUsd: raw.cashUsd,
    positions: raw.positions as PhoenixPosition[],
    orders: raw.orders as PaperRestingOrder[],
    nextOrderId:
      typeof raw.nextOrderId === "number" && raw.nextOrderId > 0
        ? raw.nextOrderId
        : 1,
    nextSubaccount:
      typeof raw.nextSubaccount === "number" && raw.nextSubaccount > 0
        ? raw.nextSubaccount
        : 1,
  };
}

/** Persisted store — hydrate + sanitize once at module load. */
function createPaperStore() {
  const store = persisted<PaperLedger>(
    PAPER_STORAGE_KEY,
    createEmptyLedger(),
  );
  // Sanitize whatever localStorage hydrated.
  let current = createEmptyLedger();
  store.subscribe((value) => {
    current = value;
  })();
  const sanitized = parseLedger(current);
  if (
    sanitized.cashUsd !== current.cashUsd ||
    sanitized.positions.length !== current.positions.length
  ) {
    store.set(sanitized);
  }
  return store;
}

export const paperLedger = createPaperStore();
