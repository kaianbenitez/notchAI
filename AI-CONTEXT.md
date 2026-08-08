# Notch — compact project context

## Product and stack

Notch is a single-user Philippine personal-finance PWA, built with Next.js 16, TypeScript, Drizzle, Supabase Postgres, Tailwind, and PGlite tests. It handles highly sensitive financial data; use only synthetic/redacted fixtures in code and AI context.

## Load order

Read `AGENTS.md`, this file, and `AI-NOW.md` first. Read the relevant section of `PLAN.md` before changing its feature area; the plan is canonical but does not need to be loaded in full for an unrelated, bounded task. Use `HANDOFF.md` and git history only for historical detail.

## Non-negotiables

- Every ledger write goes through `postTransaction`; entries are double-entry and sum to zero.
- Monetary values are integer centavos, never floats.
- Categories are `accounts` rows with income/expense roles; `db/schema.sql` is authoritative DDL.
- Raw ingest payloads are retained. Insight models receive precomputed aggregates, then write prose around those figures; they never calculate or invent financial numbers.
- Do not commit real statements, receipts, exports, account/card numbers, or secrets.

## Collaboration and verification

Claude plans/audits and Codex implements a concise contract. Run `npm test`, `npm run build`, and `npm run lint` before handoff unless the task explicitly makes one inapplicable. Use the minimum task-relevant source context rather than pasting the 400-line plan into every request.
