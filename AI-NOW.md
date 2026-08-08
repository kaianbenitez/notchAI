# Notch — current working memory

Last refreshed: 2026-08-08

## Current state

- The app includes the ledger core, account/category CRUD, offline manual capture with AI-assisted prefill, month and budgets views, PDF statement import, split bills/friends/groups, Gmail-alert review/ingestion, and manual net-worth snapshots/goals.
- Production is on Vercel at `https://notch-ai.vercel.app`; it auto-deploys from `origin/main`.
- Local `.env` uses a throwaway local Postgres container. Do not assume it matches production. Production schema changes require explicit user confirmation of the exact SQL.
- Gmail cron is deployed and running; its first real run created review items. Treat unrecognized alert shapes as raw-only, never guessed ledger entries.

## Verification baseline

Run `npm test`, `npm run build`, and `npm run lint`. Tests use PGlite and need no live database. For a real-browser or production claim, state which environment was used; do not infer parity.

## Handoff template

Replace this section at the end of unfinished work (do not append a diary):

```md
## Active handoff
- Goal:
- Branch/worktree:
- Changed files:
- Verified:
- Blocker or risk:
- Next action:
```

## On-demand history

`PLAN.md` is the planned architecture; `HANDOFF.md` and `git log` explain older decisions and implementation history. Search them for the needed topic rather than loading them wholesale.
