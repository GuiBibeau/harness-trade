import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import {
  type SpotAsset,
  type SpotQuote,
  tokenToAtoms,
  USDC_MINT,
  usdcToAtoms,
} from "$lib/spot";
import { createSpotTicket } from "./spot-ticket";
import { fmtTriggerPrice } from "./trade-math";

function asset(overrides: Partial<SpotAsset> = {}): SpotAsset {
  return {
    assetId: "sol",
    symbol: "SOL",
    hub: "crypto",
    name: "Solana",
    imageUrl: "",
    mint: "So11111111111111111111111111111111111111112",
    decimals: 9,
    trustTier: "high",
    price: 2,
    change24hPct: null,
    volume24hUsd: null,
    marketCap: null,
    liquidityUsd: null,
    ...overrides,
  };
}

function quote(overrides: Partial<SpotQuote> = {}): SpotQuote {
  return {
    raw: {},
    inAtoms: 25_000_000,
    outAtoms: 12_500_000_000,
    outUi: 12.5,
    priceImpactPct: 0.001,
    ...overrides,
  };
}

type QuoteCall = {
  inputMint: string;
  outputMint: string;
  atoms: number;
  decimals: number;
  resolve: (value: SpotQuote) => void;
  reject: (reason: unknown) => void;
};

function harness(currentAsset: SpotAsset | null = asset()) {
  const calls: QuoteCall[] = [];
  let invalidations = 0;
  const ticket = createSpotTicket({
    getAsset: () => currentAsset,
    onQuoteInvalidated: () => {
      invalidations += 1;
    },
    fetchQuote: (inputMint, outputMint, atoms, decimals) =>
      new Promise<SpotQuote>((resolve, reject) => {
        calls.push({ inputMint, outputMint, atoms, decimals, resolve, reject });
      }),
  });
  return { ticket, calls, invalidated: () => invalidations };
}

const debounce = () => new Promise((resolve) => setTimeout(resolve, 500));

describe("scheduleQuote", () => {
  test("debounces into a buy quote (USDC → token atoms)", async () => {
    const { ticket, calls, invalidated } = harness();
    ticket.scheduleQuote();
    expect(get(ticket.spotQuoteStatus)).toBe("quoting");
    expect(invalidated()).toBe(1);
    expect(calls.length).toBe(0); // still inside the 450ms debounce
    await debounce();
    expect(calls.length).toBe(1);
    expect(calls[0].inputMint).toBe(USDC_MINT);
    expect(calls[0].outputMint).toBe(asset().mint);
    expect(calls[0].atoms).toBe(usdcToAtoms(25));
    calls[0].resolve(quote());
    await Promise.resolve();
    expect(get(ticket.spotQuoteStatus)).toBe("quoted");
    expect(get(ticket.spotQuote)).toEqual(quote());
    ticket.dispose(); // clears the 20s auto-requote timer
  });

  test("sell quotes flow token → USDC with token atoms", async () => {
    const { ticket, calls } = harness();
    ticket.spotSide.set("sell");
    ticket.spotAmount.set("3");
    ticket.scheduleQuote();
    await debounce();
    expect(calls[0].inputMint).toBe(asset().mint);
    expect(calls[0].outputMint).toBe(USDC_MINT);
    expect(calls[0].atoms).toBe(tokenToAtoms(3, 9));
    expect(calls[0].decimals).toBe(6);
    ticket.dispose();
  });

  test("stale responses never own state (generation token)", async () => {
    const { ticket, calls } = harness();
    ticket.scheduleQuote();
    await debounce();
    ticket.spotAmount.set("50");
    ticket.scheduleQuote(); // invalidates the in-flight quote
    await debounce();
    expect(calls.length).toBe(2);
    calls[0].resolve(quote({ outUi: 1 })); // stale — must be dropped
    await Promise.resolve();
    expect(get(ticket.spotQuote)).toBeNull();
    expect(get(ticket.spotQuoteStatus)).toBe("quoting");
    calls[1].resolve(quote({ outUi: 2 }));
    await Promise.resolve();
    expect(get(ticket.spotQuote)?.outUi).toBe(2);
    ticket.dispose();
  });

  test("missing asset or non-positive amount clears to idle", () => {
    const { ticket, calls } = harness(null);
    ticket.scheduleQuote();
    expect(get(ticket.spotQuote)).toBeNull();
    expect(get(ticket.spotQuoteStatus)).toBe("idle");
    expect(calls.length).toBe(0);
    ticket.dispose();
  });

  test("quote failures surface the error message", async () => {
    const { ticket, calls } = harness();
    ticket.scheduleQuote();
    await debounce();
    calls[0].reject(new Error("route not found"));
    await Promise.resolve();
    await Promise.resolve();
    expect(get(ticket.spotQuoteStatus)).toBe("error");
    expect(get(ticket.spotQuoteError)).toBe("route not found");
    ticket.dispose();
  });
});

describe("flipSide", () => {
  test("converts the amount through the asset price so size stays economic", () => {
    const { ticket } = harness(asset({ price: 2 }));
    ticket.flipSide("sell"); // $25 buy → 12.5 tokens sold
    expect(get(ticket.spotSide)).toBe("sell");
    expect(get(ticket.spotAmount)).toBe(fmtTriggerPrice(25 / 2));
    ticket.flipSide("buy"); // and back to ~$25 spent
    expect(get(ticket.spotAmount)).toBe(fmtTriggerPrice(12.5 * 2));
    ticket.dispose();
  });

  test("same-side flip just re-quotes without converting", () => {
    const { ticket, invalidated } = harness();
    ticket.flipSide("buy");
    expect(get(ticket.spotAmount)).toBe("25");
    expect(invalidated()).toBe(1);
    ticket.dispose();
  });
});

describe("invalidateQuote", () => {
  test("clears the used quote and blocks late in-flight responses", async () => {
    const { ticket, calls } = harness();
    ticket.scheduleQuote();
    await debounce();
    ticket.invalidateQuote(); // post-swap success path
    expect(get(ticket.spotQuote)).toBeNull();
    expect(get(ticket.spotQuoteStatus)).toBe("idle");
    calls[0].resolve(quote()); // late response must not re-arm the button
    await Promise.resolve();
    expect(get(ticket.spotQuote)).toBeNull();
    expect(get(ticket.spotQuoteStatus)).toBe("idle");
    ticket.dispose();
  });
});
