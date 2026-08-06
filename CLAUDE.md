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
receivable account), shows a running balance, settles up, and lists a "Recent activity" feed of
every split/owed/settlement transaction touching any friend (`listRecentFriendActivity` in
`src/people/repo.ts`, one row per person per transaction, signed to match balance direction).
`/split` logs a shared expense either way — you paid and split it (evenly, by exact amounts, by
percentage, or by shares/ratio) or someone else paid and you owe your share. `/groups` creates and
manages named groups (e.g. a trip or household) with members; picking a group on `/split` prefills
participants from that group's membership, still editable afterward. Settling and splitting both
refuse to let a friend's own receivable account be picked as the real cash/funding account, in
either the UI or the underlying posting functions. Not yet built: percentage/share-weighted splits
have no in-UI hint that percentages should sum to ~100 (not required — `splitByWeights` normalizes
by the weights' own sum regardless).

The statement importer (`/import`) assigns each statement row its own distinct already-logged
transaction when matching — two identical same-day charges no longer fight over the same candidate
(`assignMatches` in `src/import/match.ts`), and rows that repeat within one statement are flagged
in the review UI so the user notices before importing both. Still out of scope, not addressed by
this hardening pass: statement formats other than BPI, and importing payments/credits (the parser
already separates `payment_or_credit` rows from `charge` rows, but only charges are ever committed
to the ledger — payments/credits are shown read-only and never posted).

Gmail bank-alert ingestion is built as a daily Vercel cron (`/api/cron/gmail-ingest`). Its first
run picks up at most the 20 most recent matching emails; older mail is out of scope for automatic
import and needs manual capture or a future dedicated backfill tool. It searches only BPI Online,
MariBank Alerts, and the currently unsupported BPI InstaPay sender. The supported
BPI InstaPay/bill-pay and MariBank incoming-transfer templates retain every raw email in
`ingest_events`; unfamiliar shapes remain unrecognized rather than guessed. `/review` is a
persistent inbox: resolving an alert saves the exact funding-account descriptor and payee/category
descriptor so future matching emails post through `postTransaction`; unresolved mail never affects
the ledger. BPI InstaPay's separate sender remains raw-only until a synthetic fixture/template is
available. Bootstrap Gmail once with `npm exec tsx scripts/gmail-auth.ts`; it needs
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` (default
`http://localhost:3000/oauth2callback`) and prints `GOOGLE_REFRESH_TOKEN` for `.env`/Vercel.
The four new `gmail_*` tables are in local `db/schema.sql` only and still need to be applied
to the live Supabase database before this cron can run against production.

`db/schema.sql` defines `accounts`, `people`, `groups`, `group_members`, `splits`, `ingest_events`,
`transactions`, `entries`, `budgets`, and two views. `PLAN.md` §3 describes six more tables that
do not exist yet: `recurring_rules`, `reminders`, `holdings`, `price_snapshots`, `net_worth_daily`,
`attachments`.

**Production database is caught up.** As of 2026-08-05 the `groups`/`group_members`/`splits`
tables and the `transactions.group_id` column have been applied to the live Supabase database.
`/friends` and `/split` work on the deployed site.

**Schema changes to production may now go through an agent via the Supabase MCP server**
(policy changed 2026-08-06 — previously this was manual-only via the Supabase SQL editor).
Still run `npm test` / `npm run build` first, still confirm the exact SQL with the user before
running it against production, and still update this file's state afterward — the guardrail
that changed is *who* runs the SQL, not the care taken beforehand.

The `dismissed_bill_suggestions` and `capture_nudges` tables have also been applied to the live
Supabase database (2026-08-06), so both are now caught up with `db/schema.sql`.

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

## What the user cares about most

Stated directly on 2026-08-05, after M1 close-out and split bills shipped — weigh these when
picking what to build next or how to build it, even where they push against what `PLAN.md`
currently says:

- **The app should feel good to use, not just work.** Nice-looking, "addictive" in the good sense,
  easy to navigate, and above all frictionless to log into from a phone away from home, not just
  from a desk. Visual/UX polish is a real priority here, not a nice-to-have deferred past
  functional completeness — factor it into planning, don't treat it as separate cleanup work.
- **Bill reminders should reach them somewhere they'll actually see them** — Telegram was named
  specifically, alongside other options. `PLAN.md` §4.5 currently specs VAPID web push only; when
  M3 (bill reminders) is actually planned, raise this rather than silently building push-only.
- **AI insights should feel like a financial advisor, not a dashboard widget.** The user has
  already informally prototyped this: a separate chat session, told about their full financial
  picture (assets, savings, investments), fed their transaction CSV, and asked for advice — that
  conversational, full-context experience is the bar. This does not relax the non-negotiable in
  `AGENTS.md` ("the model writes prose around figures it is given," never computes them) — the
  precomputed-aggregates constraint stays. What it does mean: when insights (M5, `PLAN.md` §4.6)
  get built, favor a conversational surface with real context about the user's full position over
  static insight cards, while keeping every number the model states sourced from a precomputed
  query underneath.
- **Splitting credit-card spend with a girlfriend and friends is a real, recurring need**, not a
  hypothetical — this is what the split-bills feature (`/friends`, `/split`) exists to solve,
  particularly for the BPI credit card (`PLAN.md` §6.1's dominant-spend account).

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
npm test     # 132 passing, PGlite, no database setup needed
npm run build
npm run lint
```

Run all three before reporting work finished.
