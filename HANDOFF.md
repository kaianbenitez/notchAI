# Handoff — building this with another AI tool

`PLAN.md` is self-contained. It's the expensive part (the thinking) already done, so any capable
coding agent can execute from it. Nothing below depends on Claude Code.

## Status

**The ledger core is built and tested — do not regenerate it.** See `README.md`.
`db/schema.sql`, `src/ledger/*`, `tests/ledger.test.ts`, 18 passing tests. Build on it.

Remaining in M1: accounts/categories CRUD, capture UI (snap/voice/manual), budgets,
month view, CSV import of old history, and the password-protected statement importer.

## Kickoff prompt

Paste `PLAN.md` and `README.md`, then:

> You are implementing the personal budgeting app specified in the attached PLAN.md. Read it
> completely before writing code.
>
> Stack: Next.js 16 App Router, TypeScript, Drizzle ORM, Supabase Postgres, Tailwind. Installable
> PWA — no native app.
>
> The ledger core already exists and its tests pass: `db/schema.sql`, `src/ledger/`,
> `tests/ledger.test.ts`. **Read them first. Do not rewrite or "simplify" them.** Run `npm test`
> and confirm 18 passing before you change anything.
>
> Build the rest of **M1 only** (see §7). Do not start M2–M6.
>
> Non-negotiable constraints:
> - Every ledger write goes through `postTransaction`. Nothing else inserts into `entries`.
> - All money as integer centavos. Never floating point.
> - Categories are rows in `accounts` with role expense/income, not a separate table.
> - `db/schema.sql` is authoritative DDL. If you add tables, add them there and keep the balance
>   trigger intact.
>
> Start with accounts/categories CRUD and the capture UI. Keep `npm test` green throughout.

Then work milestone by milestone. Make it show you tests for the dedupe engine (§6) before you
trust any number in the app.

## Which tool for which job

| Task | Best tool | Why |
|---|---|---|
| Building the repo | **Gemini CLI** (free tier) or any agentic CLI | Needs filesystem, migrations, test runs. Not a chat window. |
| Receipt/snap prompt tuning | **Google AI Studio** | Upload real BPI receipt photos, iterate the prompt, lock the JSON schema, paste the result into the app. This is what AI Studio is actually good at. |
| Statement PDF extraction | AI Studio first, then code | Same loop — get one real statement parsing correctly by hand before automating. |
| Schema / ledger design changes | Careful review, any strong model | The one area where a wrong call is expensive to undo. |

## Order of operations (don't skip)

Recon is **done**. Confirmed constraints, all reflected in PLAN.md:

- BPI cannot email CC alerts. SMS only, ≥₱1,000 only.
- BPI unbilled view = category + amount, **no merchant until posting**.
- Statement = password-protected PDF, no CSV export.
- Current app exports history fine.

Remaining: export that history before you stop using the old app, then start M1.

## Watch for these

Things a coding agent will plausibly get wrong or quietly skip:

- **Collapsing the double-entry model.** The most likely "helpful simplification" and the most
  expensive. Reject it.
- **Floating-point money.** Check every amount column is an integer.
- **Dedupe as an afterthought.** §6 must have real tests. Wrong dedupe = every number inflated.
- **Credit-card date windows.** ±7 days, not ±3 — posting date lags transaction date (§6).
- **Offline capture.** The IndexedDB write-ahead queue is not optional; §6.1 makes manual capture
  load-bearing for your main account.
- **Losing raw ingest payloads.** `ingest_events.raw_payload` is kept forever, always.
- **Letting the LLM calculate.** Insights are SQL (§4.6). The model only writes prose over
  precomputed aggregates. If an agent proposes "send the transactions to the model and ask for
  analysis," reject it — that's how you get hallucinated financial figures.

## Privacy

This app handles your full financial position. Before routing receipts or statements through any
free-tier AI service, check whether that tier permits training on your data or human review — free
tiers commonly do, paid tiers commonly don't (PLAN.md §9, risk 6).
