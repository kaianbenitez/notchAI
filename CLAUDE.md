# budget-app

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

Ledger core, the Next.js 16 shell, and accounts/categories CRUD are built. Still unbuilt in
M1: capture UI, budgets, month view, and the importers (`PLAN.md` §7).

The CRUD screens have never run against a live Postgres — there is no `.env` and no Supabase
project yet. They are covered by PGlite tests and they compile, which is not the same thing.

`db/schema.sql` currently defines only `accounts`, `people`, `transactions`, `entries` and two
views. `PLAN.md` §3 describes eleven more tables that do not exist yet. Budgets and the
importers are blocked on that DDL being written by hand, with the balance trigger preserved.

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
npm test     # 53 passing, PGlite, no database setup needed
npm run build
npm run lint
```

Run all three before reporting work finished.
