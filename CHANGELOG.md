# Changelog

Running log of shipped features and fixes, most recent first. Updated at the end of every
session that ships something — see the instruction in `CLAUDE.md`.

This is a session-by-session ledger, not a snapshot: it's meant to be appended to, unlike
`AI-NOW.md` (current state only, gets overwritten). For anything before this file existed,
see `git log`.

## 2026-08-13

- Established this changelog. Backfilled the two weeks below from `git log` for continuity;
  everything from today onward is written at time of shipping.

## 2026-08-10

- Normalize USD account imports at fixed FX rate
- Add budget CSV migration tooling

## 2026-08-09

- Add editable account balances
- Add credit card statement profiles

## 2026-08-08

- Fix mobile more navigation menu
- Rename friends to contacts in the UI
- Improve mobile navigation and capture flow
- Add compact AI workspace context

## 2026-08-07

- Add manual net worth tracking

## 2026-08-06

- Add Gmail bank-alert ingestion for BPI Online and MariBank (backfill bounded to last 30
  days, capped to 20 most recent emails on first run; marked live after removing temporary
  diagnostic error exposure)
- Add bill suggestions and capture nudge
- Add recurring bill auto-reconciliation

## 2026-08-05

- Add Phase 1 Telegram bill reminders (revised from web push; split into phases)
