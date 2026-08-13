# Changelog

Running log of shipped features and fixes, most recent first. Updated at the end of every
session that ships something — see the instruction in `CLAUDE.md`.

This is a session-by-session ledger, not a snapshot: it's meant to be appended to, unlike
`AI-NOW.md` (current state only, gets overwritten). For anything before this file existed,
see `git log`.

## 2026-08-13

- Established this changelog. Backfilled the two weeks below from `git log` for continuity;
  everything from today onward is written at time of shipping.
- Disable Gmail email-scan cron (ingest code/data left in place for easy re-enable)
- Fold mobile More nav panel automatically on route change
- Added the ability to edit an already-logged transaction: date, payee, memo, category, and
  funding account are editable from `/log/edit/[id]` (linked from the month view and the log
  page's recent list). Amount is intentionally not editable yet — it would need to go through
  a proper reposting flow to stay ledger-balanced; delete and re-log for now if the amount was
  wrong. Only simple two-leg manual captures are supported (not splits or multi-leg statements).
- Added an install prompt: a dismissible banner offers a native "Install" button on Chrome/
  Android/desktop (via `beforeinstallprompt`) and shows the manual Share → Add to Home Screen
  steps on iOS Safari, where no such API exists. Hides itself once installed or dismissed
  (remembered in `localStorage`), and never shows if already running standalone.

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
