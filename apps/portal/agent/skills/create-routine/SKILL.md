---
name: create-routine
description: >-
  Create or change a recurring market review, alert, or bounded
  position-management Routine and its optional Mandate. Use when the user asks
  the agent to remember work on a cadence, monitor a condition, send an alert,
  or manage a position until a condition is met.
---

# Create a Routine

Use this procedure when the user asks the agent to remember work on a cadence,
monitor a condition, send an alert, or manage a position until a condition is
met.

## 1. Separate schedule from authority

A Routine defines when to create a Task and what that Task should accomplish.
It never authorizes an Execution.

A Mandate is separate, explicit authority for unattended Execution. Observation
and alert Routines do not need a Mandate. Any Routine that may place, change,
cancel, or close an order or position does.

Never infer a Mandate from Auto mode, Memory, signer availability, an existing
position, or phrases such as “keep an eye on it.”

## 2. Resolve the Routine

Confirm or derive only from explicit context:

- Objective.
- Cadence or trigger.
- Timezone.
- Asset, venue, account mode, or position scope.
- Alert or Artifact destination when configurable.
- Stop condition.
- Expiry or end condition.
- Overlap behavior.

Use `skip` for ordinary reviews and alerts. Use `coalesce` for position
management so concurrent ticks cannot manage the same position in parallel.

Every tick creates a new Task with fresh Observations. Do not reuse a prior
quote, portfolio snapshot, Policy Decision, or Receipt.

## 3. Bound any Mandate

For unattended Execution, require the user to approve a Mandate that states:

- Exact allowed operations.
- Allowed assets and position or subaccount when applicable.
- Maximum notional per Execution.
- Maximum cumulative notional.
- Maximum leverage and slippage.
- Maximum execution count.
- Whether adding size or margin is allowed.
- Required protection.
- Invalidation and stop conditions.
- Expiry.

Default to no added exposure. A Routine cannot broaden, renew, or replace its
Mandate. PAUSE and signer revocation override it. Budget and execution count
must be checked and consumed atomically by the server.

If no valid Mandate exists, a scheduled Task may observe and publish an
Artifact. It must not execute or wait indefinitely for interactive approval.
Instead, publish that authority or approval is required.

## 4. Plan the Context Mutation

Creating, updating, pausing, or deleting a Routine is a recorded Context
Mutation. Granting, changing, revoking, or expiring a Mandate is a distinct
Context Mutation. Present both explicitly before persistence.

Examples:

- “Review SOL every 15 minutes” creates a `market_review` Observation Routine
  that writes a private alert with an observe-only draft plan (bias, range,
  invalidation). It never executes.
- “Alert below 25% margin health” creates an edge-triggered alert Routine that
  avoids repeating the same alert until the condition clears and crosses again.
- “Manage SOL until invalidated” requires a Routine plus a bounded Mandate and
  an explicit invalidation rule.

If persistence tools are unavailable, explain what would be created and what
information is still missing. Never claim the Routine or Mandate exists.

## 5. Report

After persistence, publish an Artifact containing:

- Routine name, cadence, timezone, and next run.
- Scope and stop condition.
- Whether it is observation-only or Mandate-backed.
- Mandate limits, remaining budget, and expiry when applicable.
- How to pause, revoke, or delete it.
