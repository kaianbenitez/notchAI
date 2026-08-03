# Notch

Personal budgeting app, Philippines/PHP, single user. Installable PWA, no native app.

The constraints below are binding for every agent that touches this repo — Claude Code,
Codex, or anything else. They live in one file so they cannot drift apart between tools.

@AGENTS.md

## Where things are

| File | What it is |
|---|---|
| `PLAN.md` | The specification. Already decided — read it, don't relitigate it. |
| `HANDOFF.md` | Build order and the kickoff prompt for a fresh agent. |
| `AGENTS.md` | The binding constraints (imported above). |
| `db/schema.sql` | Authoritative DDL. Not generated from Drizzle — Drizzle mirrors it. |
| `src/ledger/` | The tested core. Do not regenerate. |
| `reference/` | Read-only logic harvested from the previous app. Never imported. |

## State

The app is called **Notch**. Built: the ledger core, the Next.js 16 shell, accounts/categories
CRUD (`/accounts`, `/categories`), manual capture with an offline queue (`/log`), and a read-only
month view (`/month`). Still unbuilt in M1: snap/voice capture, and the importers
(`PLAN.md` §7).

All four screens have been exercised against real Postgres and driven in a browser, not just
covered by tests. Manual capture survives a dead connection: submissions queue in IndexedDB and
flush on reconnect, made replay-safe by a client-minted id stored in `transactions.source_ref`
under a partial unique index.

`/month` shows actuals only — income, expenses, net, a category breakdown, and the transaction
list for one calendar month, with prev/next navigation. It also compares each budgeted category's
monthly budget, actual spend, and remaining amount.

Budgets are flat monthly expense-category amounts, with optional rollover that carries both
unspent funds and overspending into the next month. `/budgets` provides their CRUD UI.

**Known gap:** a queued capture the server permanently rejects blocks everything queued behind
it, silently. Nothing is lost, but nothing after it syncs either, and the user is not told.

`db/schema.sql` defines `accounts`, `people`, `transactions`, `entries` and two views. `PLAN.md`
§3 describes eleven more tables that do not exist yet. Budgets and the importers are blocked on
that DDL being written by hand, with the balance trigger preserved.

### Local database

There is no Supabase project. Development runs against a throwaway container, and `.env` points
at it:

```
docker run --name budget-app-dev-db --detach --publish 127.0.0.1:5433:5432 \
  --env POSTGRES_USER=budget_app --env POSTGRES_PASSWORD=budget_app_dev_local \
  --env POSTGRES_DB=budget_app postgres:17-alpine
```

Load `db/schema.sql` into it after creating it. It holds synthetic `Live *` rows from
verification runs — no real financial data, and none should ever be put there.

**Check `git log --oneline` for anything newer than this file.** The commit history is the
current state; this section is a starting orientation and will go stale.

## Conventions that bite

**Relative imports carry no `.js` extension.** Turbopack does not rewrite `.js` to `.ts`, so
`import { withDb } from "../db/client.js"` fails `npm run build` while passing `tsc` and
`vitest`. `src/ledger/` keeps its `.js` style and is fine: its only relative import is
`import type`, which erases before the bundler sees it. Don't "fix" it.

**Every ledger write needs one connection, not a pool.** `postTransaction` issues its own
`begin`/`commit`; on a pool those statements can land on different backends and the
transaction is silently lost. Go through `withDb` in `src/db/client.ts`, which checks out a
single client for the callback.

**A `"use server"` module may export only async functions.** Next silently turns other exports
into actions; put constants shared with client components in a separate plain module.

## Handing work to Codex

Codex's default sandbox does not work on this machine — `npm install` times out and file
writes fail outright, with no partial state left behind. Both failures are silent until it
reports back. Use `sandbox: danger-full-access` for any task that installs packages or writes
files, and be aware that this drops its confinement to the repo: verify afterward that
nothing outside the project was touched.

A Codex run started from a Claude Code session **dies when that session exits.** Do not
`/clear` or close the terminal while one is in flight.

## Verify

```
npm test     # 72 passing, PGlite, no database setup needed
npm run build
npm run lint
```

Run all three before reporting work finished.
