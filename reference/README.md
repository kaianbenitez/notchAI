# reference/ — harvested from the old CC Tracker

Not part of the build. `tsconfig.json` includes only `src` and `tests`, and vitest only
runs `tests/*.test.ts`, so nothing here compiles, ships, or runs. It exists so M1 does not
re-derive logic that already works.

**Source:** `github.com/kaianbenitez/splitwise` @ `0542fd1` (2026-07-06, the only commit) —
`outputs/cc-tracker/app.js`. A single-file vanilla-JS app, `localStorage` only, floats for
money. It is the app PLAN.md is replacing.

## What's here

| File | Why it was kept |
|---|---|
| `statement-cycle.js` | Cycle-boundary and due-date math. PLAN.md §10 lists "calendar vs payday vs statement cycle" as open — this is the statement-cycle answer, already working. |
| `statement-parse.js` | Text/CSV → rows for the M1 statement importer (PLAN.md §6.1 Layer 1) and the unbilled screenshot (Layer 2). Includes the date normalizer, which is the fiddly part. |
| `cc-tracker-config.md` | The real card/installment/bill setup to seed M1 with, plus one schema gap it exposes. |

Functions were de-globalized — the originals read a module-level `state` and touched the
DOM. Behaviour is otherwise unchanged, including its bugs.

## How to use it

**Read it, port the behaviour, do not import it.**

- **All amounts here are floats.** `db/schema.sql` is integer centavos. Every number that
  crosses over gets converted at the boundary and never travels as a float.
- **The transaction shape is single-sided** (`{amount, partnerSharePct}`), not double-entry.
  That is exactly the "helpful simplification" HANDOFF.md says to reject. Port *when a charge
  belongs to which cycle*, not *how a charge is stored*.
- `parseStatementText` is a regex line-parser, adequate for pasted text. It is **not** the
  password-protected-PDF pipeline in PLAN.md §6.1 Layer 1 (`qpdf` → text → LLM → dual-pass
  verify). Use it as a cheap first pass and as a source of test fixtures, not as the design.
- There is **no dedupe** anywhere in the original. It appends on import and always has. Do
  not carry that forward — PLAN.md §6 dedupe must exist before you trust any figure.

## Migrating the real data

`exportCSV` in the old app writes **only the selected month**, with columns
`Date, Description, Category, Card, Amount, GF Share %, GF Share Amount`. That drops
installments, bills, friends, payments, group splits, and every `statementEnd` assignment.

Use the raw state instead — in the old app's browser console:

```js
copy(localStorage.getItem("cc-tracker-v1"))   // then paste into a .json file
```

That object is `{ settings, selectedMonth, transactions, payments, cards, installments,
friends, bills, statementStatus }` and is the complete record. Do this before you stop
using the old app (HANDOFF.md, "Order of operations").
