# Monaco Protocol Readiness

- Reviewed on: `2026-03-14`
- Issue: `#377`
- Venue: `monaco`
- Instrument class: `prediction`
- Verdict: `candidate`
- Highest justified state: `candidate`
- Stop before: `integrated`

## Official Sources Reviewed

- [Monaco Protocol main repo](https://github.com/MonacoProtocol/protocol)
- [Monaco Protocol SDK repo](https://github.com/MonacoProtocol/sdk)
- [Monaco client order docs](https://github.com/MonacoProtocol/protocol/blob/develop/npm-client/docs/types/order.md)
- [Monaco client trade docs](https://github.com/MonacoProtocol/protocol/blob/develop/npm-client/docs/types/trade.md)
- [Monaco client market-position docs](https://github.com/MonacoProtocol/protocol/blob/develop/npm-client/docs/types/market_position.md)

## What The Official Material Supports

The official Monaco materials are strong enough to model a real prediction-market
adapter contract in Trader Ralph.

- The active `protocol` repo publishes stable mainnet releases through `0.15.5`
  and explicitly ships JavaScript clients alongside the on-chain program.
- The client docs expose order creation and cancellation, trade accounts,
  market-position queries, matching pools, market outcomes, and settlement
  instructions.
- The order type docs show venue-native fields that matter for Ralph:
  `marketOutcomeIndex`, `forOutcome`, `stake`, `expectedPrice`,
  `stakeUnmatched`, `payout`, and `orderStatus`.
- The market-position docs show Monaco is not a swap-like venue. Positions carry
  `outcomePositions`, `unmatchedExposures`, and `matchedRisk`, so Ralph must
  treat position lifecycle and unmatched risk as first-class state.
- The SDK README still documents partial matching, cancellation of unmatched
  amounts, in-play betting delay, and settlement to the winning wallet.

## Repo-Owned Contract Decision

Monaco should be treated as a dedicated `prediction_order` venue with:

- market discovery over markets, outcomes, matching pools, and price ladders
- stateful order lifecycle for create, query, cancel, and unmatched-risk updates
- stateful position lifecycle for market positions and settlement or void flows
- a separate admin or operator path for market creation, status changes, and
  settlement authority that remains outside the public Worker boundary

That contract is strong enough for a `candidate` venue capability in Ralph.

## Why It Stops At Candidate

The official materials still leave integration decisions unresolved for a safe
implementation PR.

- The previously prominent `sdk` repo is archived and marked as `v1`, while the
  maintained client surface now lives inside the active `protocol` repo.
- The venue depends on operator-managed market lifecycle, resolution, and
  product-commission behavior. Ralph needs an explicit boundary for those
  privileged flows before claiming `integrated`.
- The repo does not yet have Monaco-specific fixtures for market discovery,
  order lifecycle, market positions, unmatched risk, settlement, and voids.

## Next Implementation Slice

The follow-on implementation issue should stay to one PR and do only this:

1. Add a Monaco worker client targeting the maintained `protocol` npm-client
   surface.
2. Support read discovery for markets, outcomes, and matching pools.
3. Add bounded `prediction_order` paper or shadow execution scaffolding for
   create and cancel.
4. Add reconciliation fixtures for market positions, unmatched exposure, and
   settlement or void outcomes.
