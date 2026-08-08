# budget-app — agent instructions

A personal budgeting app for a single user in the Philippines. Start with `AI-CONTEXT.md` and `AI-NOW.md`. **Read `PLAN.md` completely
before writing any code.** It is the specification and it is already decided — it is not a
starting point for discussion. `HANDOFF.md` has the build order and the kickoff prompt.

## Before you change anything

```
npm test          # must print 67 passed, ~20s, no database setup needed
```

If that is not green on a clean checkout, stop and say so. Do not "fix" it by changing tests.

## The ledger core is built. Do not regenerate it.

`db/schema.sql`, `src/ledger/post.ts`, `src/ledger/split.ts`, `tests/ledger.test.ts`.

Read them first. Do not rewrite, "simplify", or refactor them. If you believe one is wrong,
say so and wait — do not change it and continue.

## Non-negotiable constraints

1. **Every ledger write goes through `postTransaction`.** Nothing else inserts into `entries`.
2. **All money is integer centavos.** Never a float, never `Number()` on an amount string,
   never `.toFixed(2)` arithmetic. Amounts parse from text digit-wise into integers.
3. **Categories are rows in `accounts`** with `role = 'expense'` or `'income'`. There is no
   separate categories table and there will not be one.
4. **`db/schema.sql` is authoritative DDL.** New tables go there. Keep the balance trigger
   intact — it is `DEFERRABLE INITIALLY DEFERRED` and drizzle-kit cannot emit it, so if you
   move to Drizzle migrations, hand-write that one.
5. **Entries sum to zero in PHP.** If the trigger fires, code tried to create money.

## Scope

Build **M1 only** (`PLAN.md` §7). Do not start M2–M6, and do not add features from later
milestones because they seem easy.

M1 remaining: accounts/categories CRUD, capture UI (snap/voice/manual), budgets, month view,
CSV import of old history, and the password-protected statement importer.

Stack: Next.js 16 App Router, TypeScript, Drizzle ORM, Supabase Postgres, Tailwind.
Installable PWA — no native app, no App Store. Tests run on PGlite, so no live database is
needed to work.

## Things agents get wrong on this codebase

- **Collapsing double-entry into a single `amount` + `split_pct` column.** This is the most
  likely proposed "simplification" and the most expensive. Reject it. Splitting, friend
  balances, and budgets are one problem precisely because of the double entry.
- **Dedupe as an afterthought.** `PLAN.md` §6 must have real tests before any number in the
  UI is trusted. The old app had no dedupe and re-importing a statement silently doubled it.
- **Credit-card date windows of ±3 days.** It is ±7 — posting date lags transaction date,
  often across a weekend.
- **Skipping the offline queue.** The IndexedDB write-ahead queue is not optional; §6.1 makes
  manual capture load-bearing for the dominant account.
- **Dropping raw ingest payloads.** `ingest_events.raw_payload` is kept forever, always.
- **Letting the model compute a number.** Insights are SQL over precomputed aggregates
  (§4.6). The model writes prose around figures it is given. If you are about to send raw
  transactions to an LLM and ask for analysis, stop — that is how hallucinated financial
  figures get into a ledger.

## `reference/` is not source code

It holds logic harvested from the previous app (vanilla JS, localStorage, floats) for
reading only. It is excluded from `tsconfig.json` and from the test run. Port behaviour from
it; never import it, and never copy its float arithmetic or its single-sided transaction
shape. Its README lists four known bugs in that code — do not reproduce them.

Keep it excluded when you add build tooling: it must not enter `tsconfig.json`, the Next.js
build, or the lint/test globs.

## Data handling

This repo describes one person's complete financial position.

- **Never commit real financial data.** No statements, receipts, exports, account numbers, or
  card numbers. Test fixtures must be redacted or synthetic. `.gitignore` blocks the obvious
  paths but is not a substitute for checking.
- **Never paste real statement text or receipt images into a chat session** on a free API
  tier — free tiers commonly permit training and human review; paid tiers commonly do not
  (`PLAN.md` §9, risk 6).
- No secrets in the repo. Credentials go in `.env`, which is ignored.

## Working style

- Keep `npm test` green throughout. Run it before you report a task finished.
- Commit in small, reviewable steps with real messages.
- If a decision in `PLAN.md` looks wrong, raise it and continue with the rest of the work.
  Do not silently deviate.
