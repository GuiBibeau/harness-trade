// Terminal preference/layout persistence — storage keys, the pref
// serializer, and the pure parse/merge cores. The page keeps thin
// loadPrefs/loadLayout appliers that assign whatever parsePrefs returns;
// everything here is testable without a DOM.

import {
  PHOENIX_TIMEFRAMES,
  type PhoenixTimeframe,
} from "$lib/phoenix-market-data";
import {
  type DisplayCurrencyCode,
  isDisplayCurrencyCode,
} from "$lib/terminal/display-currency";
import {
  type DisplayTimezoneId,
  isValidIanaTimezone,
} from "$lib/terminal/display-timezone";

// Legacy "trader-ralph-terminal" key names kept across the Harness rebrand —
// renaming them would silently wipe every user's saved prefs and layout.
export const PREFS_STORAGE_KEY = "trader-ralph-terminal/prefs/v1";
export const ALERTS_STORAGE_KEY = "trader-ralph-terminal/alerts/v1";
export const LAYOUT_STORAGE_KEY = "trader-ralph-terminal/layout/v1";
export const CACHE_PANELS = "trader-ralph-terminal/cache/panels/v1";
export const CACHE_NEWS = "trader-ralph-terminal/cache/news/v1";
export const CACHE_MARKETS = "trader-ralph-terminal/cache/markets/v1";
export const CACHE_READS = "trader-ralph-terminal/cache/reads/v1";
export const CACHE_MAX_AGE = 30 * 60_000;
export const MARKETS_MAX_AGE = 24 * 60 * 60_000;
export const ALERT_LOG_KEY = "trader-ralph-alert-log";
export const ONBOARD_KEY = "trader-ralph-terminal/phx-referral/v2";

// Draggable dashboard: chart + book stay anchored; positions/journal live in
// the bottom dock. Markets / spot / screener / events / watch panels are
// retired from the grid (watchlist is a topbar drawer). Macro research
// still folds into the macro drawer. mergeLayout drops retired ids from
// old saves automatically. migrateLayout still remaps legacy duplicate
// "markets" → "monitor" before the merge filter drops it.
export const DEFAULT_PANEL_ORDER: string[] = [];

export const SECTION_LINKS: { id: string; label: string }[] = [
  { id: "section-chart", label: "Chart" },
  { id: "section-book", label: "Book" },
  { id: "section-perp", label: "Perp" },
];

export type TerminalPrefs = {
  symbol: string;
  timeframe: PhoenixTimeframe;
  priceMode: "last" | "mark";
  chartScale: "price" | "percent";
  chartAxisMode: "linear" | "log";
  visibleCandleCount: number;
  tradeMode: "spot";
  spotAssetId: string;
  watchlist: string[];
  screenSort: "movers" | "volume" | "cap";
  screenHub: "all" | "crypto" | "equities" | "pre-ipo";
  sizingMode: "usd" | "risk";
  tradeAmount: string;
  tradeRiskUsd: string;
  tradeLeverage: number;
  dockTab: "positions" | "journal" | "alerts" | "watch";
  macroOpen: boolean;
  /** Structure-level chart lines (PDH/PDL + swing pivots) — default ON. */
  showLevels: boolean;
  /** User-drawn horizontal rays per symbol (array order = placement order). */
  rays: Record<string, number[]>;
  /** Simulated paper trading — local ledger, live market data. */
  paperMode: boolean;
  /** Fiat used for money labels (trading still USD). */
  displayCurrency: DisplayCurrencyCode;
  /** IANA timezone for clocks and journal/tape stamps. */
  displayTimezone: DisplayTimezoneId;
  /** Named order templates (max 6) — size/leverage/TP%/SL%. */
  orderTemplates: OrderTemplate[];
  /** Quiet fill/TP-SL beeps — default ON unless reduced-motion. */
  fillSounds: boolean;
  /**
   * Hotkey trading mode — opt-in ARMED state (default OFF). When armed,
   * the amber chip shows on the ticket side row; Escape disarms. B/S/M/L
   * behavior is unchanged either way.
   */
  hotkeysArmed: boolean;
};

export const ORDER_TEMPLATES_CAP = 6;
export const TICKET_LEVERAGES = [1, 2, 5, 10, 20] as const;
export type TicketLeverage = (typeof TICKET_LEVERAGES)[number];

export type OrderTemplate = {
  id: string;
  name: string;
  sizeUsd: number;
  leverage: TicketLeverage;
  tpPct: number | null;
  slPct: number | null;
};

export function parseOrderTemplates(value: unknown): OrderTemplate[] {
  if (!Array.isArray(value)) return [];
  const out: OrderTemplate[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const candidate = row as Record<string, unknown>;
    const name =
      typeof candidate.name === "string"
        ? candidate.name.trim().slice(0, 24)
        : "";
    const sizeUsd = Number(candidate.sizeUsd);
    const leverage = Number(candidate.leverage);
    const id =
      typeof candidate.id === "string" && candidate.id
        ? candidate.id
        : `t-${out.length}`;
    if (!name || !(sizeUsd > 0) || !Number.isFinite(sizeUsd)) continue;
    if (!(TICKET_LEVERAGES as readonly number[]).includes(leverage)) continue;
    const tpRaw = candidate.tpPct;
    const slRaw = candidate.slPct;
    const tpPct =
      tpRaw === null || tpRaw === undefined
        ? null
        : typeof tpRaw === "number" && Number.isFinite(tpRaw) && tpRaw > 0
          ? tpRaw
          : null;
    const slPct =
      slRaw === null || slRaw === undefined
        ? null
        : typeof slRaw === "number" && Number.isFinite(slRaw) && slRaw > 0
          ? slRaw
          : null;
    // Invalid non-null pcts reject the whole template.
    if (tpRaw !== null && tpRaw !== undefined && tpPct === null) continue;
    if (slRaw !== null && slRaw !== undefined && slPct === null) continue;
    out.push({
      id,
      name,
      sizeUsd,
      leverage: leverage as TicketLeverage,
      tpPct,
      slPct,
    });
    if (out.length >= ORDER_TEMPLATES_CAP) break;
  }
  return out;
}

/** Rays per symbol — placing a 13th evicts the oldest (FIFO). */
export const RAYS_PER_SYMBOL_CAP = 12;

/**
 * Validate a persisted rays payload: prices must be finite positive numbers,
 * capped at RAYS_PER_SYMBOL_CAP per symbol (keeping the newest tail — the
 * same end FIFO eviction preserves), symbols left with no valid price are
 * dropped, any non-object garbage collapses to {}.
 */
export function parseRays(value: unknown): Record<string, number[]> {
  const rays: Record<string, number[]> = {};
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return rays;
  }
  for (const [symbol, prices] of Object.entries(value)) {
    if (!Array.isArray(prices)) continue;
    const valid = prices.filter(
      (price): price is number =>
        typeof price === "number" && Number.isFinite(price) && price > 0,
    );
    if (valid.length === 0) continue;
    rays[symbol] = valid.slice(-RAYS_PER_SYMBOL_CAP);
  }
  return rays;
}

/**
 * Validate a raw localStorage prefs payload into the subset of fields that
 * pass the same whitelists loadPrefs applied inline — every branch below is
 * the original condition, field for field. Unknown/invalid fields are simply
 * absent from the result.
 */
export function parsePrefs(raw: string | null): Partial<TerminalPrefs> {
  const prefs: Partial<TerminalPrefs> = {};
  if (!raw) return prefs;
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return prefs; // malformed persisted preferences — ignore
  }
  if (data === null || typeof data !== "object") return prefs;
  if (typeof data.symbol === "string") prefs.symbol = data.symbol;
  if (PHOENIX_TIMEFRAMES.includes(data.timeframe as PhoenixTimeframe)) {
    prefs.timeframe = data.timeframe as PhoenixTimeframe;
  }
  if (data.priceMode === "last" || data.priceMode === "mark") {
    prefs.priceMode = data.priceMode;
  }
  if (data.chartScale === "price" || data.chartScale === "percent") {
    prefs.chartScale = data.chartScale;
  }
  if (data.chartAxisMode === "linear" || data.chartAxisMode === "log") {
    prefs.chartAxisMode = data.chartAxisMode;
  }
  if (
    typeof data.visibleCandleCount === "number" &&
    Number.isFinite(data.visibleCandleCount)
  ) {
    prefs.visibleCandleCount = data.visibleCandleCount;
  }
  if (data.tradeMode === "spot") prefs.tradeMode = "spot";
  if (typeof data.spotAssetId === "string")
    prefs.spotAssetId = data.spotAssetId;
  if (Array.isArray(data.watchlist)) {
    prefs.watchlist = data.watchlist
      .filter((sym): sym is string => typeof sym === "string")
      .map((sym) => sym.toUpperCase())
      .slice(0, 24);
  }
  if (
    data.screenSort === "movers" ||
    data.screenSort === "volume" ||
    data.screenSort === "cap"
  ) {
    prefs.screenSort = data.screenSort;
  }
  if (
    data.screenHub === "all" ||
    data.screenHub === "crypto" ||
    data.screenHub === "equities" ||
    data.screenHub === "pre-ipo"
  ) {
    prefs.screenHub = data.screenHub;
  }
  if (data.sizingMode === "usd" || data.sizingMode === "risk") {
    prefs.sizingMode = data.sizingMode;
  }
  if (typeof data.tradeAmount === "string")
    prefs.tradeAmount = data.tradeAmount;
  if (typeof data.tradeRiskUsd === "string") {
    prefs.tradeRiskUsd = data.tradeRiskUsd;
  }
  if (
    typeof data.tradeLeverage === "number" &&
    [1, 2, 5, 10, 20].includes(data.tradeLeverage)
  ) {
    prefs.tradeLeverage = data.tradeLeverage;
  }
  if (
    data.dockTab === "positions" ||
    data.dockTab === "journal" ||
    data.dockTab === "alerts" ||
    data.dockTab === "watch" ||
    // Legacy label from before the Positions rename (topbar Desk = chat).
    data.dockTab === "desk"
  ) {
    prefs.dockTab = data.dockTab === "desk" ? "positions" : data.dockTab;
  }
  if (typeof data.macroOpen === "boolean") prefs.macroOpen = data.macroOpen;
  if (typeof data.showLevels === "boolean") prefs.showLevels = data.showLevels;
  if (data.rays !== undefined) prefs.rays = parseRays(data.rays);
  if (typeof data.paperMode === "boolean") prefs.paperMode = data.paperMode;
  if (isDisplayCurrencyCode(data.displayCurrency)) {
    prefs.displayCurrency = data.displayCurrency;
  }
  if (isValidIanaTimezone(data.displayTimezone)) {
    prefs.displayTimezone = data.displayTimezone;
  }
  if (data.orderTemplates !== undefined) {
    prefs.orderTemplates = parseOrderTemplates(data.orderTemplates);
  }
  if (typeof data.fillSounds === "boolean") prefs.fillSounds = data.fillSounds;
  if (typeof data.hotkeysArmed === "boolean") {
    prefs.hotkeysArmed = data.hotkeysArmed;
  }
  return prefs;
}

/**
 * Merge a saved panel order against the defaults: keep saved ids that still
 * exist, append any defaults the save predates, drop unknown ids. Guards
 * layout migration across releases.
 */
export function mergeLayout(saved: unknown, defaults: string[]): string[] {
  if (!Array.isArray(saved)) return [...defaults];
  const known = saved.filter(
    (id): id is string => typeof id === "string" && defaults.includes(id),
  );
  const missing = defaults.filter((id) => !known.includes(id));
  return [...known, ...missing];
}

export function persistPrefs(
  _symbol: string,
  _timeframe: PhoenixTimeframe,
  _priceMode: "last" | "mark",
  _scale: "price" | "percent",
  _axis: "linear" | "log",
  _visible: number,
  _tradeMode: "perps" | "spot",
  _spotAssetId: string | null,
  _watchlist: string[],
  _screenSort: string,
  _screenHub: string,
  _sizingMode: string,
  _tradeAmount: string,
  _tradeRiskUsd: string,
  _tradeLeverage: number,
  _dockTab: "positions" | "journal" | "alerts" | "watch",
  _macroOpen: boolean,
  _showLevels: boolean,
  _rays: Record<string, number[]>,
  _paperMode: boolean,
  _displayCurrency: DisplayCurrencyCode,
  _displayTimezone: DisplayTimezoneId,
  _orderTemplates: OrderTemplate[] = [],
  _fillSounds = true,
  _hotkeysArmed = false,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      PREFS_STORAGE_KEY,
      JSON.stringify({
        symbol: _symbol,
        timeframe: _timeframe,
        priceMode: _priceMode,
        chartScale: _scale,
        chartAxisMode: _axis,
        visibleCandleCount: _visible,
        tradeMode: _tradeMode,
        spotAssetId: _spotAssetId,
        watchlist: _watchlist,
        screenSort: _screenSort,
        screenHub: _screenHub,
        sizingMode: _sizingMode,
        tradeAmount: _tradeAmount,
        tradeRiskUsd: _tradeRiskUsd,
        tradeLeverage: _tradeLeverage,
        dockTab: _dockTab,
        macroOpen: _macroOpen,
        showLevels: _showLevels,
        rays: _rays,
        paperMode: _paperMode,
        displayCurrency: _displayCurrency,
        displayTimezone: _displayTimezone,
        orderTemplates: _orderTemplates.slice(0, ORDER_TEMPLATES_CAP),
        fillSounds: _fillSounds,
        hotkeysArmed: _hotkeysArmed,
      }),
    );
  } catch {
    // storage may be unavailable (private mode, quota) — non-fatal
  }
}
