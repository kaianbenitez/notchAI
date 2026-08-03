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

Ledger core and the Next.js 16 shell are built. No features yet — accounts/categories CRUD,
capture UI, budgets, month view, and the importers are all still unbuilt (M1, `PLAN.md` §7).

`db/schema.sql` currently defines only `accounts`, `people`, `transactions`, `entries` and two
views. `PLAN.md` §3 describes eleven more tables that do not exist yet. Budgets and the
importers are blocked on that DDL being written by hand, with the balance trigger preserved.

**Check `git log --oneline` for anything newer than this file.** The commit history is the
current state; this section is a starting orientation and will go stale.

## Verify

```
npm test     # 18 passing, PGlite, no database setup needed
npm run build
npm run lint
```

Run all three before reporting work finished.
