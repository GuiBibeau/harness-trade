# WP<N> — <one-line goal>

You are implementing one scoped work package in the `serious-trader-ralph`
repo. Follow this order exactly. Read `AGENTS.md` and `.factory/PITFALLS.md`
before touching anything — every rule in them is binding.

## Goal

<What "done" means, in 2–4 sentences. Include the user-visible outcome.>

## Non-goals

<Explicitly out of scope. Adjacent code that must NOT be touched or
"improved". Refactors not asked for.>

## Files

Create:
- /Users/guillaume/Github/serious-trader-ralph/<absolute path>

Modify:
- /Users/guillaume/Github/serious-trader-ralph/<absolute path> — <what changes>

Delete:
- <none | absolute paths>

Touch NOTHING outside these lists. If the task seems to require another file,
STOP and report why instead of editing it.

## Load-bearing payloads

<Verbatim content that must land exactly as written: export maps, token
tables, type signatures, CSS blocks, config snippets. The delegate copies
these, never re-derives them.>

## Acceptance criteria

- <observable, checkable statements — exact test names, exact behaviors>

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
4. NO claims of success without the validation output to back them.

## Rules (non-negotiable)

- Git is READ-ONLY for you: `git status` / `git diff` / `git log` only.
  Never commit, push, stash, restore, reset, or clean.
- Stay inside the file lists above.
- Kill any dev server you start.
- All pitfalls in `.factory/PITFALLS.md` apply.
