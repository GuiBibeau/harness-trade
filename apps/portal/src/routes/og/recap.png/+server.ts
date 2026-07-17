// Daily market recap OG card (/og/recap.png): the day's tape in one frame —
// SOL as the hero with its 24h move, beside the five biggest absolute 24h
// movers across every hub. Attached to the daily post, so composition is
// marketing-grade. Every number is live tokens.xyz data; catalog failure or
// a missing SOL print is a 503, never a placeholder.

import { error } from "@sveltejs/kit";
import {
  brandRow,
  C,
  el,
  fmtPct,
  fmtPrice,
  frame,
  renderOgPng,
  text,
  utcStamp,
} from "$lib/server/og";
import { type CatalogAsset, getCatalog } from "$lib/server/tokensxyz";
import type { RequestHandler } from "./$types";

/** "JUL 17 2026" — sliced from toUTCString ("Fri, 17 Jul 2026 …"). */
function utcDateStamp(): string {
  const stamp = new Date().toUTCString();
  return `${stamp.slice(8, 11).toUpperCase()} ${stamp.slice(5, 7)} ${stamp.slice(12, 16)}`;
}

/** Truncate at a word boundary — "Billions Netwo" is below the bar. */
function shortName(name: string): string {
  if (name.length <= 16) return name;
  const cut = name.slice(0, 16);
  const space = cut.lastIndexOf(" ");
  return space > 3 ? cut.slice(0, space) : cut;
}

function moverRow(asset: CatalogAsset, last: boolean): Record<string, unknown> {
  const up = (asset.change24hPct ?? 0) >= 0;
  return el(
    "div",
    {
      justifyContent: "space-between",
      alignItems: "center",
      padding: "11px 26px",
      borderBottom: last ? "none" : `1px solid ${C.line}`,
      width: "100%",
    },
    [
      el("div", { gap: "16px", alignItems: "baseline", width: "230px" }, [
        text(asset.symbol, { fontSize: "27px", fontWeight: 700 }),
        text(shortName(asset.name), { fontSize: "18px", color: C.faint }),
      ]),
      text(fmtPrice(asset.price), {
        fontSize: "27px",
        fontWeight: 700,
        color: C.muted,
      }),
      text(fmtPct(asset.change24hPct), {
        fontSize: "27px",
        fontWeight: 700,
        color: up ? C.up : C.down,
        width: "150px",
        justifyContent: "flex-end",
      }),
    ],
  );
}

export const GET: RequestHandler = async ({ setHeaders }) => {
  const assets = await getCatalog().catch(() => {
    error(503, "Catalog unavailable");
  });

  const sol = assets.find(
    (asset) => asset.symbol.toUpperCase() === "SOL" && asset.price !== null,
  );
  if (!sol) error(503, "SOL market data unavailable");

  // Top 5 absolute 24h movers, any hub, priced with a real 24h print.
  // SOL is already the hero, so it never repeats in the table.
  const movers = assets
    .filter(
      (asset) =>
        asset.assetId !== sol.assetId &&
        asset.price !== null &&
        asset.change24hPct !== null,
    )
    .sort(
      (a, b) => Math.abs(b.change24hPct ?? 0) - Math.abs(a.change24hPct ?? 0),
    )
    .slice(0, 5);
  if (movers.length === 0) error(503, "Market data unavailable");

  const solUp = (sol.change24hPct ?? 0) >= 0;
  const solTrend = solUp ? C.up : C.down;

  const tree = frame([
    brandRow(`LIVE ${utcStamp()}`),

    // Title band: what this card is, and which day it covers.
    el("div", { alignItems: "baseline", gap: "22px", marginTop: "30px" }, [
      text("MARKET RECAP", {
        fontSize: "44px",
        fontWeight: 700,
        letterSpacing: "4px",
      }),
      text(utcDateStamp(), {
        fontSize: "21px",
        fontWeight: 700,
        color: C.accent,
        letterSpacing: "3px",
      }),
    ]),

    // Main band: SOL hero left, movers panel right.
    el(
      "div",
      { marginTop: "26px", gap: "36px", width: "100%", alignItems: "stretch" },
      [
        el(
          "div",
          {
            flexDirection: "column",
            justifyContent: "center",
            width: "380px",
            gap: "14px",
          },
          [
            text("SOL / USDC", {
              fontSize: "20px",
              fontWeight: 700,
              letterSpacing: "3px",
              color: C.muted,
            }),
            text(fmtPrice(sol.price), {
              fontSize: "76px",
              fontWeight: 700,
              letterSpacing: "-2px",
            }),
            el("div", { alignItems: "center", gap: "16px" }, [
              el(
                "div",
                {
                  backgroundColor: solUp
                    ? "rgba(44,233,127,0.12)"
                    : "rgba(255,90,106,0.12)",
                  border: `2px solid ${solTrend}`,
                  borderRadius: "0",
                  padding: "8px 18px",
                },
                [
                  text(fmtPct(sol.change24hPct), {
                    fontSize: "30px",
                    fontWeight: 700,
                    color: solTrend,
                  }),
                ],
              ),
              text("24 HOURS", {
                fontSize: "16px",
                letterSpacing: "2px",
                color: C.muted,
              }),
            ]),
          ],
        ),

        // Movers panel: bordered surface with a header strip, terminal-style.
        el(
          "div",
          {
            flexDirection: "column",
            flexGrow: 1,
            flexBasis: 0,
            border: `1px solid ${C.line}`,
            borderRadius: "0",
            backgroundColor: C.surface,
          },
          [
            el(
              "div",
              {
                padding: "12px 26px",
                borderBottom: `1px solid ${C.line}`,
                width: "100%",
              },
              [
                text("TOP MOVERS · 24H", {
                  fontSize: "17px",
                  fontWeight: 700,
                  letterSpacing: "3px",
                  color: C.muted,
                }),
              ],
            ),
            ...movers.map((asset, index) =>
              moverRow(asset, index === movers.length - 1),
            ),
          ],
        ),
      ],
    ),

    text("traderralph.com · live Solana markets — spot & perps", {
      marginTop: "auto",
      fontSize: "22px",
      color: C.muted,
    }),
  ]);

  setHeaders({
    "content-type": "image/png",
    "cache-control": "public, s-maxage=900, stale-while-revalidate=3600",
  });
  return new Response(await renderOgPng(tree));
};
