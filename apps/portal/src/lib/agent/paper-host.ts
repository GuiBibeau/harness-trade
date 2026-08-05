// Paper-only agent host for the full-page chat (no terminal page mounted).
// Live signing stays on /terminal — this host mutates the shared paper ledger.

import { get } from "svelte/store";
import { buildStandaloneDeskContext } from "$lib/chat-context";
import {
  DEFAULT_PHOENIX_SYMBOL,
  fetchPhoenixCandles,
  type PhoenixTimeframe,
} from "$lib/phoenix-market-data";
import {
  addPaperMargin,
  cancelPaperOrder,
  cancelPaperOrdersOnSide,
  closePaperPosition,
  ledgerToTraderState,
  paperLedger,
  placePaperOrder,
  setPaperTpSl,
} from "$lib/terminal/paper-ledger";
import { PREFS_STORAGE_KEY, parsePrefs } from "$lib/terminal/prefs";
import type { AgentActionResult, AgentHostHandlers } from "./host";

function ok(message: string): AgentActionResult {
  return { outcome: "confirmed", message };
}
function fail(message: string): AgentActionResult {
  return { outcome: "rejected", message };
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readPrefsSymbol(): string {
  if (typeof localStorage === "undefined") return DEFAULT_PHOENIX_SYMBOL;
  const prefs = parsePrefs(localStorage.getItem(PREFS_STORAGE_KEY));
  return prefs.symbol ?? DEFAULT_PHOENIX_SYMBOL;
}

function readPrefsTimeframe(): string {
  if (typeof localStorage === "undefined") return "15m";
  const prefs = parsePrefs(localStorage.getItem(PREFS_STORAGE_KEY));
  return prefs.timeframe ?? "15m";
}

function readWatchlist(): string[] {
  if (typeof localStorage === "undefined") return [];
  return parsePrefs(localStorage.getItem(PREFS_STORAGE_KEY)).watchlist ?? [];
}

async function resolvePrice(
  symbol: string,
  limitPrice: number | null,
): Promise<number | null> {
  if (limitPrice !== null && limitPrice > 0) return limitPrice;
  try {
    const candles = await fetchPhoenixCandles(symbol, "15m");
    const last = candles.at(-1)?.close;
    if (typeof last === "number" && last > 0) return last;
  } catch {
    // fall through
  }
  return null;
}

export function buildAgentPageDeskContext(
  accountMode: "paper" | "live",
): Record<string, unknown> {
  const ledger = get(paperLedger);
  const trader = ledgerToTraderState(ledger);
  return buildStandaloneDeskContext({
    accountMode,
    symbol: readPrefsSymbol(),
    timeframe: readPrefsTimeframe(),
    paperPositions: trader.positions,
    paperOpenOrders: trader.orders,
    paperEquityUsd: trader.totalCollateralUsd,
    watchlist: readWatchlist(),
    nowMs: Date.now(),
  });
}

export function buildPaperDeskContext(): Record<string, unknown> {
  return buildAgentPageDeskContext("paper");
}

export function createPaperAgentHost(): AgentHostHandlers {
  const handlers: AgentHostHandlers = {
    switch_market: (args) => {
      const symbol =
        typeof args.symbol === "string" ? args.symbol.toUpperCase() : "";
      if (!symbol) return fail("symbol required");
      if (typeof localStorage !== "undefined") {
        try {
          const raw = localStorage.getItem(PREFS_STORAGE_KEY);
          const prefs = parsePrefs(raw);
          const next = { ...prefs, symbol, paperMode: true };
          localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
        } catch {
          // best-effort
        }
      }
      return ok(`market ${symbol}`);
    },
    set_timeframe: (args) => {
      const tf = args.timeframe;
      if (typeof tf !== "string") return fail("invalid timeframe");
      if (typeof localStorage !== "undefined") {
        try {
          const prefs = parsePrefs(localStorage.getItem(PREFS_STORAGE_KEY));
          localStorage.setItem(
            PREFS_STORAGE_KEY,
            JSON.stringify({ ...prefs, timeframe: tf as PhoenixTimeframe }),
          );
        } catch {
          // best-effort
        }
      }
      return ok(`timeframe ${tf}`);
    },
    set_ticket: () =>
      ok("ticket noted (paper full-page — use place_perp_order)"),
    place_perp_order: async (args) => {
      const symbol =
        typeof args.symbol === "string"
          ? args.symbol.toUpperCase()
          : readPrefsSymbol();
      const side = args.side === "sell" ? "ask" : "bid";
      const orderType = args.orderType === "limit" ? "limit" : "market";
      const sizeUsd = num(args.sizeUsd) ?? 25;
      const leverage = num(args.leverage) ?? 2;
      const limitPrice = num(args.limitPrice);
      const takeProfit = num(args.takeProfit);
      const stopLoss = num(args.stopLoss);
      const price = await resolvePrice(symbol, limitPrice);
      if (price === null || price <= 0) {
        return fail("could not resolve market price for paper fill");
      }
      try {
        const result = placePaperOrder(get(paperLedger), {
          symbol,
          side,
          orderType,
          notionalUsd: sizeUsd,
          leverage,
          price,
          takeProfitPrice: takeProfit,
          stopLossPrice: stopLoss,
          reduceOnly: args.reduceOnly === true,
        });
        paperLedger.set(result.ledger);
        return ok(
          `paper ${side === "bid" ? "long" : "short"} ${symbol} $${sizeUsd} @ ${leverage}x`,
        );
      } catch (error) {
        return fail(
          error instanceof Error ? error.message : "paper-order-failed",
        );
      }
    },
    place_spot_order: () =>
      fail("spot from full-page agent not wired — use /terminal"),
    cancel_order: (args) => {
      const orderId = typeof args.orderId === "string" ? args.orderId : "";
      if (!orderId) return fail("orderId required");
      paperLedger.set(cancelPaperOrder(get(paperLedger), orderId));
      return ok("cancelled");
    },
    cancel_symbol_orders: (args) => {
      const symbol =
        typeof args.symbol === "string"
          ? args.symbol.toUpperCase()
          : readPrefsSymbol();
      let next = get(paperLedger);
      const side = args.side;
      if (side === "buy") next = cancelPaperOrdersOnSide(next, symbol, "bid");
      else if (side === "sell")
        next = cancelPaperOrdersOnSide(next, symbol, "ask");
      else {
        next = cancelPaperOrdersOnSide(next, symbol, "bid");
        next = cancelPaperOrdersOnSide(next, symbol, "ask");
      }
      paperLedger.set(next);
      return ok("orders cancelled");
    },
    close_position: async (args) => {
      const symbol =
        typeof args.symbol === "string"
          ? args.symbol.toUpperCase()
          : readPrefsSymbol();
      const ledger = get(paperLedger);
      const trader = ledgerToTraderState(ledger);
      const position = trader.positions.find((row) => row.symbol === symbol);
      if (!position) return fail("position not found");
      const price = await resolvePrice(symbol, null);
      if (price === null) return fail("no mark for close");
      const closed = closePaperPosition(
        ledger,
        symbol,
        position.subaccountIndex,
        1,
        price,
        "close",
      );
      paperLedger.set(closed.ledger);
      return ok(`closed ${symbol}`);
    },
    close_position_fraction: async (args) => {
      const symbol =
        typeof args.symbol === "string"
          ? args.symbol.toUpperCase()
          : readPrefsSymbol();
      const fraction = num(args.fraction);
      if (fraction === null || fraction <= 0 || fraction > 1) {
        return fail("fraction must be in (0,1]");
      }
      const ledger = get(paperLedger);
      const trader = ledgerToTraderState(ledger);
      const position = trader.positions.find((row) => row.symbol === symbol);
      if (!position) return fail("position not found");
      const price = await resolvePrice(symbol, null);
      if (price === null) return fail("no mark for close");
      const closed = closePaperPosition(
        ledger,
        symbol,
        position.subaccountIndex,
        fraction,
        price,
        "close",
      );
      paperLedger.set(closed.ledger);
      return ok(`closed ${Math.round(fraction * 100)}% ${symbol}`);
    },
    close_all_positions: async () => {
      let ledger = get(paperLedger);
      const trader = ledgerToTraderState(ledger);
      for (const position of trader.positions) {
        const price = await resolvePrice(position.symbol, null);
        if (price === null) continue;
        const closed = closePaperPosition(
          ledger,
          position.symbol,
          position.subaccountIndex,
          1,
          price,
          "close",
        );
        ledger = closed.ledger;
      }
      paperLedger.set(ledger);
      return ok("all paper positions closed");
    },
    set_tp_sl: (args) => {
      const symbol =
        typeof args.symbol === "string"
          ? args.symbol.toUpperCase()
          : readPrefsSymbol();
      const trader = ledgerToTraderState(get(paperLedger));
      const position = trader.positions.find((row) => row.symbol === symbol);
      if (!position) return fail("position not found");
      const tp = args.takeProfit === null ? null : num(args.takeProfit);
      const sl = args.stopLoss === null ? null : num(args.stopLoss);
      paperLedger.set(
        setPaperTpSl(get(paperLedger), symbol, position.subaccountIndex, {
          ...(tp !== undefined ? { takeProfitPrice: tp } : {}),
          ...(sl !== undefined ? { stopLossPrice: sl } : {}),
        }),
      );
      return ok("tp/sl set");
    },
    set_break_even: (args) => {
      const symbol =
        typeof args.symbol === "string"
          ? args.symbol.toUpperCase()
          : readPrefsSymbol();
      const trader = ledgerToTraderState(get(paperLedger));
      const position = trader.positions.find((row) => row.symbol === symbol);
      if (!position?.entryPrice) return fail("no entry");
      paperLedger.set(
        setPaperTpSl(get(paperLedger), symbol, position.subaccountIndex, {
          stopLossPrice: position.entryPrice,
        }),
      );
      return ok("break-even stop");
    },
    reverse_position: async (args) => {
      const symbol =
        typeof args.symbol === "string"
          ? args.symbol.toUpperCase()
          : readPrefsSymbol();
      const ledger = get(paperLedger);
      const trader = ledgerToTraderState(ledger);
      const position = trader.positions.find((row) => row.symbol === symbol);
      if (!position) return fail("position not found");
      const price = await resolvePrice(symbol, null);
      if (price === null) return fail("no mark");
      const closed = closePaperPosition(
        ledger,
        symbol,
        position.subaccountIndex,
        1,
        price,
        "close",
      );
      const notional = Math.abs(position.size) * (position.entryPrice ?? price);
      const flipSide = position.size > 0 ? "ask" : "bid";
      try {
        const opened = placePaperOrder(closed.ledger, {
          symbol,
          side: flipSide,
          orderType: "market",
          notionalUsd: notional > 0 ? notional : 25,
          leverage: 2,
          price,
          takeProfitPrice: null,
          stopLossPrice: null,
          reduceOnly: false,
        });
        paperLedger.set(opened.ledger);
        return ok(`reversed ${symbol}`);
      } catch (error) {
        paperLedger.set(closed.ledger);
        return fail(error instanceof Error ? error.message : "reverse-failed");
      }
    },
    add_margin: (args) => {
      const symbol =
        typeof args.symbol === "string"
          ? args.symbol.toUpperCase()
          : readPrefsSymbol();
      const amount = num(args.amountUsd);
      if (amount === null || amount <= 0) return fail("amountUsd required");
      const trader = ledgerToTraderState(get(paperLedger));
      const position = trader.positions.find((row) => row.symbol === symbol);
      if (!position) return fail("position not found");
      try {
        paperLedger.set(
          addPaperMargin(
            get(paperLedger),
            symbol,
            position.subaccountIndex,
            amount,
          ),
        );
        return ok("margin added");
      } catch (error) {
        return fail(error instanceof Error ? error.message : "margin-failed");
      }
    },
    watchlist_add: (args) => {
      const symbol =
        typeof args.symbol === "string" ? args.symbol.toUpperCase() : "";
      if (!symbol) return fail("symbol required");
      if (typeof localStorage === "undefined") return ok(`watch +${symbol}`);
      try {
        const prefs = parsePrefs(localStorage.getItem(PREFS_STORAGE_KEY));
        const watchlist = [...(prefs.watchlist ?? [])];
        if (!watchlist.includes(symbol)) watchlist.push(symbol);
        localStorage.setItem(
          PREFS_STORAGE_KEY,
          JSON.stringify({ ...prefs, watchlist }),
        );
      } catch {
        // best-effort
      }
      return ok(`watch +${symbol}`);
    },
    watchlist_remove: (args) => {
      const symbol =
        typeof args.symbol === "string" ? args.symbol.toUpperCase() : "";
      if (!symbol) return fail("symbol required");
      if (typeof localStorage === "undefined") return ok(`watch -${symbol}`);
      try {
        const prefs = parsePrefs(localStorage.getItem(PREFS_STORAGE_KEY));
        const watchlist = (prefs.watchlist ?? []).filter((s) => s !== symbol);
        localStorage.setItem(
          PREFS_STORAGE_KEY,
          JSON.stringify({ ...prefs, watchlist }),
        );
      } catch {
        // best-effort
      }
      return ok(`watch -${symbol}`);
    },
    set_agent_pause: (args) => ok(args.paused === true ? "paused" : "resumed"),
  };

  return handlers;
}
