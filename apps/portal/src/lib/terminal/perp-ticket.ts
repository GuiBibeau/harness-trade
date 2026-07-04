// Perp ticket STATE for the terminal page. The nine user-editable fields
// (side/size/risk/leverage/type/limit/TP/SL/sizing-mode) plus the
// reduce-only flag live here as writable stores, and every ticket-only
// derivation (preview, funding gate, TP/SL analysis, risk sizing) is a
// derived store. The page feeds hot inputs — book levels, mark price,
// funding, ticket visibility, account snapshot — through `setInputs` and
// the 1s clock through `setNow` from its legacy `$:` statements.
//
// The signing pipeline (submitPhoenixOrder, busy keys, tx stages) stays in
// +page.svelte on purpose: this module holds state and pure math only, and
// must never import web3.js or issue network calls.
import { derived, get, writable } from "svelte/store";
import type { DepthLevel } from "$lib/phoenix-market-data";
import {
  buildTradePreview,
  fmtTriggerPrice,
  riskNotional,
  triggerPriceForPct,
} from "./trade-math";

export type TradeSide = "buy" | "sell";
export type TradeOrderType = "market" | "limit";
export type SizingMode = "usd" | "risk";

export type PerpTicketInputs = {
  // Hot market inputs (WS tick cadence).
  asks: DepthLevel[];
  bids: DepthLevel[];
  latestPrice: number | null;
  fundingPercent: number | null;
  // Ticket visibility: modal open, venue, stacked rail, right-rail tab.
  tradeOpen: boolean;
  perpsMode: boolean;
  stackedBook: boolean;
  tradeTab: boolean;
  // Account snapshot (chain-first collateral facts).
  hasAuthority: boolean;
  stateKnown: boolean;
  chainVerified: boolean;
  collateralUsd: number;
};

type MarketInputs = Pick<
  PerpTicketInputs,
  "asks" | "bids" | "latestPrice" | "fundingPercent"
>;
type VisibilityInputs = Pick<
  PerpTicketInputs,
  "tradeOpen" | "perpsMode" | "stackedBook" | "tradeTab"
>;
type AccountInputs = Pick<
  PerpTicketInputs,
  "hasAuthority" | "stateKnown" | "chainVerified" | "collateralUsd"
>;

export function createPerpTicket() {
  // ── User-editable fields (three external writers besides the inputs:
  //    book-row prefill, openTrade/B-S keys, TP/SL chips) ──
  const tradeSide = writable<TradeSide>("buy");
  const sizingMode = writable<SizingMode>("usd");
  const tradeAmount = writable("25");
  const tradeRiskUsd = writable("25");
  const tradeLeverage = writable(2);
  const tradeType = writable<TradeOrderType>("market");
  const tradeLimitPrice = writable("");
  const tradeTakeProfit = writable("");
  const tradeStopLoss = writable("");
  // Reduce-only: sell into an existing position instead of opening a second
  // isolated one with fresh margin. Only offered while a position exists.
  const tradeReduceOnly = writable(false);

  // ── Inputs fed from the page, grouped so an account or visibility
  //    change never re-runs the hot preview math (and vice versa) ──
  const market = writable<MarketInputs>({
    asks: [],
    bids: [],
    latestPrice: null,
    fundingPercent: null,
  });
  const visibility = writable<VisibilityInputs>({
    tradeOpen: false,
    perpsMode: true,
    stackedBook: false,
    tradeTab: true,
  });
  const account = writable<AccountInputs>({
    hasAuthority: false,
    stateKnown: false,
    chainVerified: false,
    collateralUsd: 0,
  });
  const now = writable(0);

  let lastInputs: PerpTicketInputs | null = null;
  function setInputs(next: PerpTicketInputs): void {
    const prev = lastInputs;
    lastInputs = next;
    if (
      !prev ||
      prev.asks !== next.asks ||
      prev.bids !== next.bids ||
      prev.latestPrice !== next.latestPrice ||
      prev.fundingPercent !== next.fundingPercent
    ) {
      market.set({
        asks: next.asks,
        bids: next.bids,
        latestPrice: next.latestPrice,
        fundingPercent: next.fundingPercent,
      });
    }
    if (
      !prev ||
      prev.tradeOpen !== next.tradeOpen ||
      prev.perpsMode !== next.perpsMode ||
      prev.stackedBook !== next.stackedBook ||
      prev.tradeTab !== next.tradeTab
    ) {
      visibility.set({
        tradeOpen: next.tradeOpen,
        perpsMode: next.perpsMode,
        stackedBook: next.stackedBook,
        tradeTab: next.tradeTab,
      });
    }
    if (
      !prev ||
      prev.hasAuthority !== next.hasAuthority ||
      prev.stateKnown !== next.stateKnown ||
      prev.chainVerified !== next.chainVerified ||
      prev.collateralUsd !== next.collateralUsd
    ) {
      account.set({
        hasAuthority: next.hasAuthority,
        stateKnown: next.stateKnown,
        chainVerified: next.chainVerified,
        collateralUsd: next.collateralUsd,
      });
    }
  }

  function setNow(nowMs: number): void {
    now.set(nowMs);
  }

  // Perp ticket preview/AI reads run only when a perp ticket is showing.
  // Desktop stacks the ticket permanently; narrow viewports gate on the tab.
  const ticketActive = derived(
    visibility,
    ($v) => $v.tradeOpen || ($v.perpsMode && ($v.stackedBook || $v.tradeTab)),
  );

  // ── Risk-based sizing: notional from stop distance ──
  const riskEntryPrice = derived(
    [tradeType, tradeLimitPrice, market],
    ([$type, $limit, $market]) =>
      $type === "limit" && Number($limit) > 0
        ? Number($limit)
        : ($market.latestPrice ?? 0),
  );
  const riskStopPrice = derived(tradeStopLoss, ($stop) => Number($stop));
  const riskNotionalUsd = derived(
    [sizingMode, tradeRiskUsd, riskEntryPrice, riskStopPrice],
    ([$mode, $riskUsd, $entry, $stop]) =>
      $mode === "risk" ? riskNotional(Number($riskUsd), $entry, $stop) : null,
  );
  const effectiveTradeAmount = derived(
    [sizingMode, riskNotionalUsd, tradeAmount],
    ([$mode, $riskNotional, $amount]) =>
      $mode === "risk"
        ? $riskNotional !== null
          ? String($riskNotional)
          : ""
        : $amount,
  );

  const tradePreview = derived(
    [
      ticketActive,
      tradeSide,
      effectiveTradeAmount,
      tradeLeverage,
      tradeType,
      tradeLimitPrice,
      market,
    ],
    ([$active, $side, $amount, $leverage, $type, $limit, $market]) =>
      $active
        ? buildTradePreview(
            $side,
            $amount,
            $leverage,
            $type,
            $limit,
            $market.asks,
            $market.bids,
            $market.latestPrice,
            $market.fundingPercent,
          )
        : null,
  );

  // Funding gate: isolated orders draw margin from the parent Phoenix
  // account, so it must hold enough collateral before placing a trade.
  // Reduce-only orders transfer no margin, so they never need funding.
  const requiredMarginUsd = derived(
    [tradePreview, tradeReduceOnly, tradeLeverage],
    ([$preview, $reduceOnly, $leverage]) =>
      $preview && !$reduceOnly ? $preview.notionalUsd / $leverage : 0,
  );

  // "Deposit first" is a strong claim: it may only come from a
  // this-session on-chain read of free collateral (never the lagging
  // indexer, never a device snapshot), and the shortfall must hold for a
  // beat — transitional refreshes while funds move between subaccounts
  // can never flash it.
  const fundingShortfallRaw = derived(
    [account, requiredMarginUsd],
    ([$account, $required]) =>
      $account.hasAuthority &&
      $account.stateKnown &&
      $account.chainVerified &&
      $required > 0 &&
      $account.collateralUsd + 0.01 < $required,
  );
  let fundingShortfallSince: number | null = null;
  const needsPhoenixFunding = derived(
    [fundingShortfallRaw, now],
    ([$raw, $now]) => {
      if (!$raw) {
        fundingShortfallSince = null;
      } else if (fundingShortfallSince === null) {
        fundingShortfallSince = Date.now();
      }
      return (
        $raw &&
        fundingShortfallSince !== null &&
        $now - fundingShortfallSince >= 1_200
      );
    },
  );

  // ── TP/SL selection ────────────────────────────────────────────────
  // Chips quick-set trigger prices relative to the same reference price the
  // submit validation uses; the inputs stay the source of truth so precise
  // hand-entry still works. Wrong-side values are flagged as you type
  // instead of failing at submit.
  const triggerRefPrice = derived(
    [tradeType, tradeLimitPrice, tradePreview, market],
    ([$type, $limit, $preview, $market]) =>
      $type === "limit" && Number($limit) > 0
        ? Number($limit)
        : ($preview?.entry ?? $market.latestPrice) || null,
  );
  const tpValue = derived(tradeTakeProfit, ($tp) => Number($tp));
  const slValue = derived(tradeStopLoss, ($sl) => Number($sl));
  const tpSet = derived(tpValue, ($tp) => Number.isFinite($tp) && $tp > 0);
  const slSet = derived(slValue, ($sl) => Number.isFinite($sl) && $sl > 0);
  const tpWrongSide = derived(
    [tpSet, tpValue, triggerRefPrice, tradeSide],
    ([$set, $tp, $ref, $side]) =>
      $set && $ref !== null
        ? $side === "buy"
          ? $tp <= $ref
          : $tp >= $ref
        : false,
  );
  const slWrongSide = derived(
    [slSet, slValue, triggerRefPrice, tradeSide],
    ([$set, $sl, $ref, $side]) =>
      $set && $ref !== null
        ? $side === "buy"
          ? $sl >= $ref
          : $sl <= $ref
        : false,
  );
  const tpPct = derived(
    [tpSet, tpValue, triggerRefPrice],
    ([$set, $tp, $ref]) => ($set && $ref ? (($tp - $ref) / $ref) * 100 : null),
  );
  const slPct = derived(
    [slSet, slValue, triggerRefPrice],
    ([$set, $sl, $ref]) => ($set && $ref ? (($sl - $ref) / $ref) * 100 : null),
  );
  const tpPnlUsd = derived(
    [tpPct, tradePreview, tradeSide],
    ([$pct, $preview, $side]) =>
      $pct !== null && $preview
        ? $preview.notionalUsd * ($pct / 100) * ($side === "buy" ? 1 : -1)
        : null,
  );
  const slPnlUsd = derived(
    [slPct, tradePreview, tradeSide],
    ([$pct, $preview, $side]) =>
      $pct !== null && $preview
        ? $preview.notionalUsd * ($pct / 100) * ($side === "buy" ? 1 : -1)
        : null,
  );

  // Clicking a book level: prefill a limit order at that price. Side/type/
  // price only — size/TP/SL stay put.
  function prefill(price: number, side: TradeSide): void {
    tradeSide.set(side);
    tradeType.set("limit");
    tradeLimitPrice.set(String(price));
  }

  // A live ticket flips in place: side only — size/TP/SL survive so both
  // directions can be compared without retyping (wrong-side validation
  // already flags stale triggers as you type). Size persists in prefs,
  // so a fresh open keeps it too; only triggers reset.
  function setSide(side: TradeSide): void {
    if (!get(ticketActive)) {
      tradeTakeProfit.set("");
      tradeStopLoss.set("");
    }
    tradeSide.set(side);
  }

  function setTakeProfitPct(pct: number): void {
    const ref = get(triggerRefPrice);
    if (!ref) return;
    tradeTakeProfit.set(
      fmtTriggerPrice(triggerPriceForPct(ref, get(tradeSide), pct, "tp")),
    );
  }

  function setStopLossPct(pct: number): void {
    const ref = get(triggerRefPrice);
    if (!ref) return;
    tradeStopLoss.set(
      fmtTriggerPrice(triggerPriceForPct(ref, get(tradeSide), pct, "sl")),
    );
  }

  return {
    // fields
    tradeSide,
    sizingMode,
    tradeAmount,
    tradeRiskUsd,
    tradeLeverage,
    tradeType,
    tradeLimitPrice,
    tradeTakeProfit,
    tradeStopLoss,
    tradeReduceOnly,
    // deriveds
    ticketActive,
    tradePreview,
    requiredMarginUsd,
    needsPhoenixFunding,
    triggerRefPrice,
    tpSet,
    slSet,
    tpWrongSide,
    slWrongSide,
    tpPct,
    slPct,
    tpPnlUsd,
    slPnlUsd,
    riskNotionalUsd,
    effectiveTradeAmount,
    // api
    setInputs,
    setNow,
    prefill,
    setSide,
    setTakeProfitPct,
    setStopLossPct,
  };
}

export type PerpTicket = ReturnType<typeof createPerpTicket>;
