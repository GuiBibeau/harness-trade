# .factory/

Working area for the factory loop (see `CLAUDE.md` at the repo root).

- `ORDER_TEMPLATE.md` — the work-order format Claude fills per work package.
- `PITFALLS.md` — the shared pitfall list every order points delegates at.
- `orders/<slug>/wpN.md` — live work orders, one directory per feature.
- `PAUSE` — kill switch: if this file exists, nothing is dispatched to any
  delegate until it is removed. `touch .factory/PAUSE` to halt the factory.
