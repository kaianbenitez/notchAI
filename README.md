# Notch — ledger core

The foundation for the app specified in [PLAN.md](./PLAN.md). This is M1's first
piece: the double-entry ledger, the invariant that protects it, and the split
arithmetic. Everything else builds on top.

```
npm install
npm test          # 53 tests, ~20s, no database setup required
```

Tests run against real Postgres via [PGlite](https://pglite.dev) (WASM, in-process),
so triggers and deferred constraints are exercised for real — not mocked.

## Layout

| Path | What it is |
|---|---|
| `db/schema.sql` | **Authoritative DDL.** Tables, the balance trigger, read views. |
| `src/ledger/post.ts` | The only write path into the ledger. |
| `src/ledger/split.ts` | Split arithmetic. Pure, no database. |
| `src/money.ts` | Text ↔ centavos. Parses digit-wise; no float is ever built. |
| `src/accounts/repo.ts` | Accounts and categories — one table, per PLAN §3. |
| `tests/ledger.test.ts` | Proves the invariants below. |

## The two rules

**1. Entries sum to zero, in PHP.** Enforced by a `DEFERRABLE INITIALLY DEFERRED`
constraint trigger, so entries can be written one at a time and the check runs at
`COMMIT`. If it ever fires, code tried to create money.

**2. All writes go through `postTransaction`.** Nothing else inserts into `entries`.
It validates and balances before touching the database, so you get a readable error
instead of a constraint violation. The trigger is the backstop, not the front door.

## Why one table for accounts and categories

A category is an account with `role = 'expense'`. A friend's debt is an account with
`kind = 'receivable'`. That is what makes splitting, friend balances, and budgets the
same problem instead of three subsystems that drift apart.

The ₱1,000 dinner split with Ana, on your BPI card:

| account | amount |
|---|---|
| BPI Credit Card | −100,000 |
| Dining | +50,000 |
| Receivable: Ana | +50,000 |

Your Dining budget sees ₱500. Ana's balance is a sum over her account. Settling up is
another transaction. No manual `/2`, no separate debt ledger to keep in sync.

## Details worth not undoing

- **Integer centavos everywhere.** Never float. `amount_minor` is the native amount;
  `base_amount_minor` is PHP and is the column that must balance. Both are stored, so
  historical rows never shift when FX rates change.
- **Splits never lose a centavo.** `splitEqual` distributes the remainder one centavo
  at a time; `splitByWeights` uses largest-remainder. Your share is derived as the
  leftover, so it absorbs rounding and the entries always balance.
- **Sign convention.** Liabilities carry negative ledger balances. `account_balances`
  exposes `display_balance_minor`, which flips the sign for liability/income/equity —
  a card you owe ₱1,000 on displays as +100,000. Use it in the UI.
- **FX residual is the caller's problem.** `postTransaction` refuses to silently
  absorb a rounding gap on multi-currency transactions; hiding it would mask real
  conversion bugs. Place it on the expense leg or an FX-rounding account.
- **Dedupe columns are already on `transactions`.** `dedupe_hash` for sources with a
  merchant, `reduced_key` for BPI's unbilled view which has none, plus
  `seen_unbilled_at` / `posted_at` so the two BPI sightings of one charge enrich a
  single row instead of double-counting. See PLAN.md §6.

## Next

Continue with M1 from [HANDOFF.md](./HANDOFF.md): categories/accounts CRUD, capture UI,
budgets, month view, and the statement importer. Keep `db/schema.sql` authoritative — if
you move to Drizzle migrations, generate from it and keep the trigger in a hand-written
migration, since drizzle-kit will not emit a constraint trigger.
