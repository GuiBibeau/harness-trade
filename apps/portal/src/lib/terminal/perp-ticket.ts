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
import type { JournalEntry } from "$lib/journal";
import type { DepthLevel, MarketPoint } from "$lib/phoenix-market-data";
import {
  GHOST_DEFAULTS,
  type GhostSizing,
  type GhostValue,
  ghostSizing,
  ghostStop,
  ghostTakeProfit,
} from "./autocomplete";
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
  // Chart structure for TP/SL ghosts (page-injected; never fetched here).
  candles: MarketPoint[];
  prevDayHigh: number | null;
  prevDayLow: number | null;
  symbol: string;
  /** Local journal — size/leverage ghosts; page-injected, never loadJournal here. */
  journalEntries: JournalEntry[];
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
type StructureInputs = Pick<
  PerpTicketInputs,
  "candles" | "prevDayHigh" | "prevDayLow" | "symbol" | "journalEntries"
>;

const TICKET_LEVERAGES = [1, 2, 5, 10, 20] as const;

/** Snap journal modal leverage onto the ticket <select> options. */
export function snapTicketLeverage(value: number): number {
  let best: (typeof TICKET_LEVERAGES)[number] = TICKET_LEVERAGES[0];
  for (const option of TICKET_LEVERAGES) {
    if (Math.abs(option - value) < Math.abs(best - value)) best = option;
  }
  return best;
}

export function formatGhostSizeLabel(ghost: GhostSizing): string {
  const notional =
    ghost.notionalUsd >= 10
      ? Math.round(ghost.notionalUsd)
      : Math.round(ghost.notionalUsd * 100) / 100;
  return `$${notional} @ ${snapTicketLeverage(ghost.leverage)}x`;
}

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
  const structure = writable<StructureInputs>({
    candles: [],
    prevDayHigh: null,
    prevDayLow: null,
    symbol: "",
    journalEntries: [],
  });
  const now = writable(0);
  const ghostTpDismissed = writable(false);
  const ghostSlDismissed = writable(false);
  const ghostSizeDismissed = writable(false);

  function clearGhostDismissed(): void {
    ghostTpDismissed.set(false);
    ghostSlDismissed.set(false);
    ghostSizeDismissed.set(false);
  }

  // Side flips via bind ($tradeSide = …) bypass setSide — subscribe so
  // dismissed flags always reset when the ticket side changes.
  let lastSide = get(tradeSide);
  tradeSide.subscribe((side) => {
    if (side === lastSide) return;
    lastSide = side;
    clearGhostDismissed();
  });

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
    if (
      !prev ||
      prev.candles !== next.candles ||
      prev.prevDayHigh !== next.prevDayHigh ||
      prev.prevDayLow !== next.prevDayLow ||
      prev.symbol !== next.symbol ||
      prev.journalEntries !== next.journalEntries
    ) {
      if (prev && prev.symbol !== next.symbol) {
        clearGhostDismissed();
      }
      structure.set({
        candles: next.candles,
        prevDayHigh: next.prevDayHigh,
        prevDayLow: next.prevDayLow,
        symbol: next.symbol,
        journalEntries: next.journalEntries,
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

  // Ghost TP/SL: only when the field is empty and not dismissed. Honest
  // structure only — null candles / missing levels yield no ghost.
  const ghostSl = derived(
    [tradeStopLoss, ghostSlDismissed, tradeSide, triggerRefPrice, structure],
    ([$sl, $dismissed, $side, $ref, $structure]): GhostValue | null => {
      if ($dismissed || $sl.trim() !== "" || $ref === null || $ref <= 0) {
        return null;
      }
      return ghostStop($structure.candles, $side, $ref, {
        window: GHOST_DEFAULTS.swingWindow,
        bufferPct: GHOST_DEFAULTS.stopBufferPct,
        prevDayHigh: $structure.prevDayHigh,
        prevDayLow: $structure.prevDayLow,
      });
    },
  );
  const ghostTp = derived(
    [
      tradeTakeProfit,
      ghostTpDismissed,
      tradeSide,
      triggerRefPrice,
      structure,
      tradeStopLoss,
    ],
    ([$tp, $dismissed, $side, $ref, $structure, $sl]): GhostValue | null => {
      if ($dismissed || $tp.trim() !== "" || $ref === null || $ref <= 0) {
        return null;
      }
      const stop = Number($sl);
      return ghostTakeProfit(
        $structure.candles,
        $side,
        $ref,
        Number.isFinite(stop) && stop > 0 ? stop : null,
        {
          window: GHOST_DEFAULTS.swingWindow,
          rMultiple: GHOST_DEFAULTS.tpRMultiple,
        },
      );
    },
  );
  const ghostSymbol = derived(structure, ($structure) => $structure.symbol);

  // Ghost size/leverage from journal — USD sizing only, empty field, ≥5 samples.
  const ghostSize = derived(
    [sizingMode, tradeAmount, ghostSizeDismissed, structure],
    ([$mode, $amount, $dismissed, $structure]): GhostSizing | null => {
      if ($dismissed || $mode !== "usd" || $amount.trim() !== "") return null;
      return ghostSizing(
        $structure.journalEntries,
        $structure.symbol,
        GHOST_DEFAULTS.sizingMinSample,
      );
    },
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

  function acceptGhostTp(): boolean {
    const ghost = get(ghostTp);
    if (!ghost) return false;
    tradeTakeProfit.set(fmtTriggerPrice(ghost.value));
    return true;
  }

  function acceptGhostSl(): boolean {
    const ghost = get(ghostSl);
    if (!ghost) return false;
    tradeStopLoss.set(fmtTriggerPrice(ghost.value));
    return true;
  }

  function acceptGhostSize(): boolean {
    const ghost = get(ghostSize);
    if (!ghost) return false;
    const notional =
      ghost.notionalUsd >= 10
        ? Math.round(ghost.notionalUsd)
        : Math.round(ghost.notionalUsd * 100) / 100;
    tradeAmount.set(String(notional));
    tradeLeverage.set(snapTicketLeverage(ghost.leverage));
    return true;
  }

  function dismissGhostTp(): void {
    ghostTpDismissed.set(true);
  }

  function dismissGhostSl(): void {
    ghostSlDismissed.set(true);
  }

  function dismissGhostSize(): void {
    ghostSizeDismissed.set(true);
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
    ghostTp,
    ghostSl,
    ghostSize,
    ghostSymbol,
    // api
    setInputs,
    setNow,
    prefill,
    setSide,
    setTakeProfitPct,
    setStopLossPct,
    acceptGhostTp,
    acceptGhostSl,
    acceptGhostSize,
    dismissGhostTp,
    dismissGhostSl,
    dismissGhostSize,
  };
}

export type PerpTicket = ReturnType<typeof createPerpTicket>;
