# WP6 — Guided welcome flow (unintrusive, dismissable, state-derived)

You are implementing one scoped work package in the `serious-trader-ralph`
repo (ticket #499, PRD #493). Follow this order exactly. Read `AGENTS.md`
and `.factory/PITFALLS.md` before touching anything — every rule is binding.

## Goal

A slim three-step welcome strip for authenticated wallets that haven't
finished onboarding: ① your wallet → ② fund it → ③ first trade. Steps
auto-complete from REAL state (never stored progress), the strip is
dismissable per wallet, and fully-onboarded wallets never see it. NOT a
modal, NOT a tour overlay — one quiet row above the ticker rail, same
visual weight as the existing OpenBetaBanner.

## Non-goals

- No stored step progress (state-derived only; dismissal is the only
  persisted bit).
- No changes to FundsModal, AckModal, tickets, or the beta banner.
- No animations beyond what CSS transitions the terminal already uses.

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/welcome.ts
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/lib/terminal/welcome.test.ts
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/components/WelcomeStrip.svelte

Modify:
- /Users/guillaume/Github/serious-trader-ralph/apps/portal/src/routes/terminal/+page.svelte
  — ONLY the edits in payload 4 (legacy `$:` file — match its style).

Delete: none

## Load-bearing payloads

1. `src/lib/terminal/welcome.ts` — mirror the structure of the adjacent
`ack.ts` exactly (same StorageLike injection and guards), with:
`const WELCOME_KEY = "trader-ralph-terminal/welcome-dismissed/v1";`,
exports `hasDismissedWelcome(wallet, storage?)` and
`recordWelcomeDismissed(wallet, storage?)`. Run
`bunx biome check --write` on the file before validating.

2. `src/lib/terminal/welcome.test.ts` — same matrix as `ack.test.ts`
(Map-backed fake storage): null wallet, unknown wallet, record→has, two
wallets independent, corrupted JSON no-throw, non-array JSON.

3. `WelcomeStrip.svelte` — Svelte 5 runes. Props:

```ts
let {
  address,
  funded,
  traded,
  onfund,
  ondismiss,
}: {
  /** shortened wallet address, e.g. "3Qw1…9xKe" */
  address: string;
  funded: boolean;
  traded: boolean;
  onfund: () => void;
  ondismiss: () => void;
} = $props();
```

Markup: a single row `<div class="welcome-strip" role="status">` with
three inline steps and a dismiss ×:

- Step 1 (always complete): `✓ Wallet ready` + the address in a muted
  mono span + the text `self-custodial via Privy`.
- Step 2: when `funded` → `✓ Funded`; else `2. Fund it` as a BUTTON
  (class `step-action`) calling `onfund`, followed by muted text
  `USDC to trade · keep ~0.04 SOL for rent + fees`.
- Step 3: when `traded` → `✓ First trade placed`; else muted text
  `3. Place your first trade — start small`.
- Dismiss: `<button class="strip-dismiss" aria-label="Dismiss welcome"
  onclick={ondismiss}>×</button>`.

Scoped CSS (token-only — pitfall 16): container
`display: flex; align-items: center; gap: 1rem; padding: 0.4rem 0.9rem;
border: 1px solid var(--line); background: var(--surface-2);
color: var(--muted); font-size: 0.74rem;` — completed steps use
`color: var(--up)` for the ✓ span; the `step-action` button styled like a
compact inline button (border 1px var(--line), background transparent,
color var(--ink), padding 0.15rem 0.5rem, cursor pointer, hover border
var(--accent)); `.strip-dismiss` mirrors the page's existing dismiss
buttons (transparent, var(--faint), hover var(--ink)). At narrow widths
(`@media (max-width: 720px)`) the row wraps (`flex-wrap: wrap; gap:
0.5rem`).

4. `+page.svelte` — four edits, exact anchors:

a. Import next to the other terminal component imports:
```ts
import WelcomeStrip from "./components/WelcomeStrip.svelte";
```
and next to the `hasAcked, recordAck` import:
```ts
import {
  hasDismissedWelcome,
  recordWelcomeDismissed,
} from "$lib/terminal/welcome";
```

b. Near `let showOpenBetaBanner = false;` (~line 576), add:
```ts
// Welcome strip (PRD #493 / #499): three steps derived from real state,
// shown once per wallet until dismissed or complete. welcomeTick bumps
// after a dismissal so the $: re-reads localStorage.
let welcomeTick = 0;
$: welcomeFunded =
  (usdcBalanceValue ?? 0) > 0 ||
  (solBalanceValue ?? 0) > 0 ||
  phoenixTotalCollateral > 0;
$: welcomeTraded =
  enrichedPositions.length > 0 || hasAcked($privyAuth.walletAddress);
$: showWelcomeStrip =
  welcomeTick >= 0 &&
  $privyAuth.authenticated &&
  Boolean($privyAuth.walletAddress) &&
  !(welcomeFunded && welcomeTraded) &&
  !hasDismissedWelcome($privyAuth.walletAddress);

function dismissWelcome(): void {
  recordWelcomeDismissed($privyAuth.walletAddress);
  welcomeTick += 1;
}
```

c. Mount directly AFTER the `{#if showOpenBetaBanner}...{/if}` block
(~line 4093, before `<TickerRail`):
```svelte
  {#if showWelcomeStrip}
    <div class="terminal-notice">
      <WelcomeStrip
        address={`${($privyAuth.walletAddress ?? "").slice(0, 4)}…${($privyAuth.walletAddress ?? "").slice(-4)}`}
        funded={welcomeFunded}
        traded={welcomeTraded}
        onfund={openFunds}
        ondismiss={dismissWelcome}
      />
    </div>
  {/if}
```
(Verify `openFunds` is the existing funds-modal opener in this file and
reuse whatever it is actually named — do not invent a new function.)

## Acceptance criteria

- Signed-out: no strip. Fresh authed wallet (no funds): strip shows,
  step 1 ✓, steps 2–3 pending; Fund it opens the funds modal.
- Funding the wallet flips step 2 without any interaction; first trade
  (ack or an open position) flips step 3; when 2 AND 3 are complete the
  strip disappears on its own.
- Dismiss hides it immediately and persists per wallet across reloads.
- Fully-onboarded wallets (funded + traded) never see it at all.
- Zero layout shift for users who dismissed it (block renders nothing).
- welcome.test.ts matrix passes; token-only CSS; zero new
  `unused css selector` warnings.

## Validation (run all, paste FULL output)

```bash
bun run typecheck
bun run lint
bun run test
cd apps/portal && bun test
bun run build
```

Also grep the build output for `unused css selector` — must be 0 occurrences.

## Report format

1. Summary of what changed, per file.
2. Full validation output (verbatim, no truncation).
3. Anything you could not do, skipped, or are unsure about — say so plainly.
4. NO claims of success without validation output to back them.

## Rules (non-negotiable)

- Git is READ-ONLY for you: `status` / `diff` / `log` only. Never commit,
  push, stash, restore, reset, or clean.
- Stay inside the file lists above; in +page.svelte touch only the anchors.
- Kill any dev server you start.
- All pitfalls in `.factory/PITFALLS.md` apply.
