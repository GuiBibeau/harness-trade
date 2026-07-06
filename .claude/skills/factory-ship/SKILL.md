---
name: factory-ship
description: Ship the current branch to production — validate, open a PR with a proof bundle, gate to merge, verify main CI and the Vercel production deployment. Use when accepted work packages are committed and ready to release.
---

# factory-ship — validate → PR → gate → verify prod

Ships the current `codex/<slug>` branch through the full pipeline and
reports the outcome honestly. Never declare success before the deployment
status is verified.

## 1. Validate (all green before any push)

```bash
cd /Users/guillaume/Github/serious-trader-ralph
bun run typecheck && bun run lint && bun run test
(cd apps/portal && bun test)
bun run build 2>&1 | tee /tmp/ship-build.log
grep -ci "unused css selector" /tmp/ship-build.log   # must print 0
```

## 2. PR

Push the branch and open a PR against `main` with the WORKFLOW.md proof
bundle: change summary, validation commands + results, local URL used for
UI verification, browser artifacts (screenshots) for UI changes, risk
notes / deferred items.

## 3. Gate (run in background; fail-fast, never lie)

Materialize this as `/tmp/gate-<pr>.sh` with `PR` and `BRANCH` filled, run
with `run_in_background`:

```bash
#!/bin/zsh
PR=<pr-number>; BRANCH=<branch-name>
cd /Users/guillaume/Github/serious-trader-ralph
merged=0
for i in $(seq 1 60); do
  state=$(gh pr view $PR --json mergeStateStatus,state -q '.mergeStateStatus + " " + .state')
  checks=$(gh pr checks $PR 2>/dev/null | grep -c fail || true)
  if [[ "$checks" != "0" ]]; then echo "$PR CHECK FAILURE"; gh pr checks $PR; exit 1; fi
  if [[ "$state" == "CLEAN OPEN" ]]; then
    echo "$PR CLEAN — merging"
    gh pr merge $PR --merge || exit 1
    git push origin --delete $BRANCH || true
    merged=1
    break
  fi
  sleep 20
done
# Never lie on timeout: only verify if we actually merged.
if [[ "$merged" != "1" ]]; then echo "TIMEOUT: $PR never reached CLEAN (last: $state)"; exit 1; fi
sha=$(gh pr view $PR --json mergeCommit -q '.mergeCommit.oid')
echo "MERGED, merge commit $sha"
for i in $(seq 1 90); do
  run=$(gh run list --branch main --commit $sha --json conclusion,status -q '.[0] | .status + ":" + (.conclusion // "")' 2>/dev/null)
  [[ "$run" == "completed:success" ]] && { echo "main CI: success"; break; }
  [[ "$run" == completed:* ]] && { echo "main CI FAILED: $run"; exit 1; }
  sleep 20
done
for i in $(seq 1 90); do
  dep=$(gh api "repos/GuiBibeau/serious-trader-ralph/deployments?sha=$sha&per_page=1" -q '.[0].id' 2>/dev/null)
  if [[ -n "$dep" && "$dep" != "null" ]]; then
    st=$(gh api "repos/GuiBibeau/serious-trader-ralph/deployments/$dep/statuses" -q '.[0].state' 2>/dev/null)
    [[ "$st" == "success" ]] && { echo "production deployment: success"; exit 0; }
    [[ "$st" == "failure" || "$st" == "error" ]] && { echo "production deployment: $st"; exit 1; }
  fi
  sleep 20
done
echo "deployment: timed out"; exit 1
```

## Gate outcomes — how to react

- `CHECK FAILURE` → fix on the branch, push, rerun the gate.
- `BLOCKED` with green checks → branch behind main (merge `origin/main` in,
  push) OR unresolved review conversation (reply, then GraphQL
  `resolveReviewThread`); then rerun the gate. Treat bot review comments as
  possibly correct — verify before dismissing.
- Local branch delete may fail (worktrees hold `main`) — remote delete via
  `git push origin --delete` is what matters; confirm merge with
  `gh pr view $PR --json state,mergeCommit`.
- Timeout → report it as a timeout. NEVER infer success from
  `git ls-remote` or a green main; only `mergeCommit` counts.

## 4. Report

Merge commit sha · main CI result · production deployment result — exactly
as observed. If any step failed or was skipped, say so plainly.
