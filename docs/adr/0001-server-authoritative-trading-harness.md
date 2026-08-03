# ADR 0001: Server-authoritative trading harness

- Status: Accepted
- Date: 2026-07-29

## Context

Harness is moving from a browser-owned agent proposal queue to a persistent EVE
agent that can continue work on the server. The existing client architecture
mixes conversation, approval policy, navigation, paper simulation, and live
wallet execution. That makes durable resume difficult and allows two competing
sources of truth for what the agent intended and what was executed.

The target experience is a Codex-like Plan → Run → Verify loop:

- The trader states an outcome.
- The agent presents the exact Plan and risk.
- Server policy allows, asks, or denies the exact Execution.
- The server signs and broadcasts through a delegated Privy signer.
- The agent verifies the resulting venue state and returns a Receipt-backed
  Artifact.
- The Task can resume after a deploy, disconnect, or delayed approval.

The product also needs cross-session Memory and dynamic Routines such as
periodic reviews, margin alerts, and bounded position management.

## Decision

We will implement one server-authoritative trading harness inside
`apps/portal/agent`. EVE owns durable Task turns, approval parking, replay, and
event streaming. Application domain code owns trading invariants, policy,
idempotency, Memory, Routine, Mandate, and venue adapters.

The browser is a command and projection client. It may submit Tasks, answer a
Policy Decision, cancel a Task, and apply safe Context Mutations. It does not
build, sign, broadcast, or declare the success of an Execution.

### Domain lifecycle

The harness uses the ubiquitous language in `/CONTEXT.md`:

1. Create a user-owned Task.
2. Gather current Observations.
3. Commit an immutable Plan revision.
4. Run ready Steps in dependency order.
5. Resolve an execution Step into a canonical server-owned Execution.
6. Evaluate and record a Policy Decision for the exact Execution digest.
7. Recheck preconditions, simulate, sign, and broadcast idempotently.
8. Record a confirmed, rejected, or unknown Receipt.
9. Verify with an independent venue read and fresh Observation.
10. Publish a Receipt-backed Artifact.

Navigation and ticket drafting are Context Mutations. Navigation is never
Execution, even when navigation and trading appear in the same user request.

### Server ownership and signing

- Request authentication binds every Task to one Privy principal.
- The server resolves the user's wallet and signer capability from that
  principal. Wallet identifiers are never accepted from model tool input or
  browser context.
- Current implementation: live agent wallets are **server-custody** keys
  derived from `AGENT_WALLET_MASTER_SECRET` + Privy principal (see
  `agent/lib/server-wallet.ts`). Privy authenticates the user and provides
  the browser embedded wallet for manual terminal signing; it is not the
  live agent signer today. Target evolution may move to Privy delegated
  signing — until then, document and rotate the master secret as a
  production secret.
- Private keys and seed phrases are never exposed to the model, browser,
  EVE durable state, or logs.
- Live agent execution additionally requires an explicit server-side live
  access enablement record (`agent/lib/live-access-store.ts`). Client
  `x-harness-account-mode: live` alone is not sufficient; without the
  record the session is clamped to paper.
- Signing capability is not a Mandate; both signer capability and policy
  authority must be valid.
- The server constructs transactions from canonical domain operations and
  allowlisted venue adapters. The model cannot supply transaction bytes, fee
  payers, program IDs, arbitrary mints, or signer material.
- Every Execution has a stable idempotency key. A replay uses the same key. An
  unknown broadcast result enters reconciliation and is never replaced by a
  newly keyed transaction.

### Policy and unattended authority

- Observe denies all Executions.
- Ask parks every Execution for explicit user approval.
- Auto may allow **paper** Executions without a prompt. **Live** Executions
  always require explicit user approval — Auto never silently signs against
  the server-custody wallet (`decideTransactionApproval` in
  `agent/lib/auth.ts`).
- PAUSE denies every Execution, including Routine-created Tasks.
- Approvals are bound to the exact Plan and Execution digests and expire.
- A changed amount, side, asset, leverage, price, trigger, protection, venue,
  or order type requires a new Plan revision and Policy Decision.

A Routine determines when a Task starts. Only a valid Mandate can authorize an
unattended Execution. A Mandate is explicit, revocable, expiring, and bounded
by operation, asset, notional, cumulative budget, leverage, slippage, execution
count, and stop conditions. Budget consumption must be atomic.

A scheduled Task without a valid Mandate may observe and publish an Artifact.
If it reaches an execution Step, it records that approval or authority is
required; it does not reinterpret the Routine as permission.

### Memory and Routine persistence

EVE session state is suitable for durable work inside one Task session but is
not a globally queryable store for due Routines or cross-session Memory.
Therefore an application-owned transactional store will hold:

- Versioned, user-scoped Memory.
- Routine definitions, next-run timestamps, leases, and overlap state.
- Mandates, remaining budgets, and revocation state.
- Queryable Task and Artifact projections needed by the UI.

One root EVE schedule runs each minute and atomically claims due Routines.
Each claim creates a new Task. Routine overlap defaults to `skip`; managed
position work uses `coalesce`. The scheduler accepts ownership only from the
trusted Routine store, never from a public request field.

### External adapters

The domain depends on interfaces rather than providers:

- IdentityAdapter: Privy access-token authentication.
- WalletAdapter: Privy delegated signer capability and transaction signing.
- MarketObservationAdapter: venue quotes and market state.
- PortfolioObservationAdapter: balances, collateral, positions, and orders.
- VenueExecutionAdapter: prepare, simulate, submit, and verify.
- PolicyAdapter: Policy Decision evaluation.
- MemoryStore, RoutineStore, and MandateStore: cross-session state.
- ArtifactSink: terminal thread, alerts, and future notification channels.

Phoenix, Jupiter, Solana RPC, Privy, and the chosen transactional store remain
replaceable behind these interfaces.

### UI projection

The client reduces typed harness events into the execution thread:

- Task creation becomes a Task heading.
- Observations become sourced, freshness-aware context rows.
- Plan revisions become exact Plan cards with ordered Steps.
- An `ask` Policy Decision becomes the pinned approval control.
- Execution progress updates the active Step.
- A Receipt becomes confirmed, rejected, or reconciliation-required UI.
- An Artifact becomes the final trade report, review, or alert.
- Memory, Routine, Mandate, and Context Mutation events receive distinct,
  non-transaction treatments.

Assistant prose and generic tool output never cause the UI to infer that an
Execution happened.

### Paper trading

Paper trading may use the same Task, Plan, Step, Policy Decision, Receipt, and
Artifact lifecycle through a PaperVenueAdapter. Its Receipts are simulation
records, never transaction signatures, and the UI must label them as PAPER.
Paper and live execution must not remain separate agent architectures.

## Failure semantics

Errors are typed by phase and recovery:

- Ambiguous intent asks for the missing transaction-defining field.
- Stale Observation replans or refreshes before policy evaluation.
- Owner mismatch, revoked signer, PAUSE, and policy denial stop execution.
- Changed preconditions invalidate approval and require a new Plan.
- Simulation failure does not broadcast.
- Unknown broadcast outcome reconciles under the same idempotency key.
- Verification mismatch produces a failure Artifact and does not claim success.
- Routine overlap skips or coalesces according to its stored policy.
- Mandate exhaustion pauses the Routine's execution capability.

Read-only dependencies may retry automatically. Non-idempotent work may retry
only under the original idempotency key.

## Migration

1. Introduce the harness domain and adapter interfaces under
   `apps/portal/agent`.
2. Wrap the existing portfolio reader as Observation adapters.
3. Wrap Phoenix, Jupiter, and paper behavior as VenueExecutionAdapters.
4. Replace the monolithic trading tool with structured Plan, Run, and Verify
   tools backed by the harness.
5. Add Memory, Routine, Mandate, and queryable projection storage.
6. Add the single EVE Routine dispatcher.
7. Project typed harness events in the agent UI.
8. Route navigation through Context Mutation events.
9. Remove browser execution registrations.
10. Remove the duplicate `/api/chat` and `src/lib/agent` action, host, runtime,
    proposal, permission, and local agent-ledger queue after preview parity.

The migration must never dual-execute or dual-write Receipts. Preview may
compare read projections, but only one path may own an Execution.

## Consequences

Positive:

- One authoritative execution path and audit vocabulary.
- Durable approvals and resume behavior.
- Safer signer and transaction boundaries.
- Routines can observe freely while unattended trading remains bounded.
- The UI becomes a pure, replayable projection.
- Venue, wallet, scheduler, and storage providers remain replaceable.

Costs:

- Memory and dynamic Routines require a transactional cross-session store.
- Policy, idempotency, and reconciliation become explicit domain modules.
- Routine-triggered Tasks need trusted ownership handoff from the scheduler.
- More state is modeled up front than in a simple chat-to-tool loop.
