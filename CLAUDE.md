# Notch

Personal budgeting app, Philippines/PHP, single user. Installable PWA, no native app.

The constraints below are binding for every agent that touches this repo — Claude Code,
Codex, or anything else. They live in one file so they cannot drift apart between tools.

@AGENTS.md

## Workflow: Claude Code plans and audits, Codex implements

This is standing, not a per-task choice. For every non-trivial change in this repo:

1. **Claude Code plans.** Read the relevant code first, then write a structured execution
   contract for Codex: goal, exact files/areas in scope, explicit acceptance criteria,
   constraints (conventions below, non-negotiables in `AGENTS.md`), and the verification
   commands to run.
2. **Codex implements.** Hand the contract to the `codex` MCP server. Never have Claude Code
   write the actual diff for a feature or fix — that is Codex's job.
3. **Claude Code audits.** Read Codex's real diff (not just its self-reported summary),
   independently rerun `npm test` / `npm run build` / `npm run lint`, and check the change
   against the contract before calling anything done. An agent's summary of what it did is not
   proof of what it did.

Exploratory design, architecture calls, unclear-root-cause debugging, and the final diff review
stay with Claude Code. Mechanical implementation does not.

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
CRUD (`/accounts`, `/categories`), manual capture with an offline queue and voice/photo/text
AI-assisted prefill (`/log`), a read-only month view with budget tracking (`/month`, `/budgets`),
a password-protected statement PDF importer (`/import`), a changelog (`/changelog`), split bills
with friends (`/friends`, `/split`), and a one-off script that imported the user's full
transaction history from their old app's CSV export (`scripts/import-csv-history.ts`).

All screens have been exercised against real Postgres and driven in a browser, not just covered
by tests. Manual capture survives a dead connection: submissions queue in IndexedDB and flush on
reconnect, made replay-safe by a client-minted id stored in `transactions.source_ref` under a
partial unique index. A queued capture the server permanently rejects is removed from the queue
and shown with its rejection reason, instead of silently blocking everything queued behind it.

`/month` shows actuals only — income, expenses, net, a category breakdown, and the transaction
list for one calendar month, with prev/next navigation. It also compares each budgeted category's
monthly budget, actual spend, and remaining amount.

Budgets are flat monthly expense-category amounts, with optional rollover that carries both
unspent funds and overspending into the next month. `/budgets` provides their CRUD UI.

Split bills (`PLAN.md` §4.2–§4.3, M2): `/friends` adds a friend (each gets an auto-created
receivable account), shows a running balance, and settles up. `/split` logs a shared expense
either way — you paid and split it (evenly or by exact amounts) or someone else paid and you owe
your share. Settling and splitting both refuse to let a friend's own receivable account be picked
as the real cash/funding account, in either the UI or the underlying posting functions. Not yet
built: group UI (the tables exist, nothing creates or picks a group from a screen), percentage/
share-weighted splits (the module exists but its weighting semantics need a design decision before
they're exposed in a form — see `src/transactions/split-capture.ts`), and a recent-splits history
feed.

`db/schema.sql` defines `accounts`, `people`, `groups`, `group_members`, `splits`, `ingest_events`,
`transactions`, `entries`, `budgets`, and two views. `PLAN.md` §3 describes six more tables that
do not exist yet: `recurring_rules`, `reminders`, `holdings`, `price_snapshots`, `net_worth_daily`,
`attachments`.

**Production database is behind local.** The `groups`/`group_members`/`splits` tables and the
`transactions.group_id` column exist in `db/schema.sql` and in the local dev container, but have
not been applied to the live Supabase database — `/friends` and `/split` will error on the
deployed site until that DDL is run there by hand. This is a deliberate manual step, not
automated by any agent, because it touches production data.

### Deployment and databases

The app is live on Vercel at https://notch-ai.vercel.app, auto-deploying from `origin/main` with
no repo-side config (no `vercel.json`, no `.vercel/`, no workflow file — Vercel's GitHub
integration needs none of that). It's a separate Supabase Postgres project
(`NEXT_PUBLIC_SUPABASE_URL`, anon key, and service role key are already in `.env`).

**Local dev does not talk to Supabase.** `.env`'s `DATABASE_URL` points at a throwaway local
container instead, so day-to-day work never touches production data. This means local and
production databases can silently diverge — e.g. the CSV history import
(`scripts/import-csv-history.ts`) has only ever been run against the local container; production
was still empty as of 2026-08-05. Before assuming prod has something local has (or vice versa),
check both — don't assume they're in sync.

### Local database

`.env` points the local database at a throwaway container:

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
npm test     # 112 passing, PGlite, no database setup needed
npm run build
npm run lint
```

Run all three before reporting work finished.
