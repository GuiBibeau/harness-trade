# Trader Ralph

[![CI](https://github.com/GuiBibeau/serious-trader-ralph/actions/workflows/ci.yml/badge.svg)](https://github.com/GuiBibeau/serious-trader-ralph/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white)](https://discord.gg/V4zuVbDVFf)

Open-source Solana trading terminal: Phoenix perps and Jupiter spot from one
USDC account. Email login, embedded wallet, no seed phrase. Every number on
screen comes from a live feed or the chain — nothing is ever faked.

Live at [traderralph.com](https://traderralph.com).

![Trader Ralph terminal](https://traderralph.com/og/terminal.png)

## Features

- Live Phoenix perps: candles, order book, tape, funding
- Trade from the chart: structure levels, click-to-trade, draggable TP/SL,
  rays + measure
- Jupiter spot swaps from the same account
- TP/SL orders, risk-based sizing, journal, alerts
- Funding wizard, daily [recap card](https://traderralph.com/og/recap.png),
  [verified-trader Discord](https://traderralph.com/discord)

What's coming: [the roadmap](https://github.com/GuiBibeau/serious-trader-ralph/issues/528).

## Quick Start

```bash
bun install
bun run dev
```

Open `http://localhost:3000/terminal`. Boots with zero env vars; set
`PUBLIC_PRIVY_APP_ID` and `PUBLIC_SOLANA_RPC_URL` to enable the wallet and
live trading. Keys never belong in the browser.

## Development

```bash
bun run typecheck && bun run lint && bun run test
cd apps/portal && bun test
bun run build
```

`apps/portal` is the SvelteKit app (`src/routes/terminal/` is the terminal);
`packages/ui` is the shared design system. Conventions live in
[AGENTS.md](AGENTS.md).

## Community

[Discord](https://discord.gg/V4zuVbDVFf) ·
[Issues](https://github.com/GuiBibeau/serious-trader-ralph/issues) ·
[Roadmap](https://github.com/GuiBibeau/serious-trader-ralph/issues/528)

Open beta. Not financial advice — perps carry real risk of loss.
Licensed under [Apache-2.0](LICENSE).
