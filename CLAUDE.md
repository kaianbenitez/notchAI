# Notch — Claude entrypoint

Read `AGENTS.md`, `AI-CONTEXT.md`, and `AI-NOW.md` before work. Read `PLAN.md` as required by `AGENTS.md`, then load only task-relevant source files; do not load the entire historical handoff by default.

## Changelog

At the end of any session that ships a feature or fix (i.e. anything that would show up as a
commit), append an entry to `CHANGELOG.md` under today's date (new heading if today doesn't
have one yet) — one line per shipped item, in plain language. This is separate from
`AI-NOW.md`: `AI-NOW.md` stays a point-in-time snapshot (replace, don't append), `CHANGELOG.md`
is the running history (append, never rewrite past entries). Do this proactively; don't wait
to be asked.

## Model split

Claude Code owns discovery, scope, architecture decisions, execution contracts, and independent diff review. Codex owns bounded implementation and verification. For non-trivial work, give Codex one contract containing the goal, in-scope files/areas, acceptance criteria, constraints, and commands to run. Claude then verifies the actual diff and reruns the required checks.

## Contract template

```md
Goal:
In scope:
Out of scope:
Acceptance criteria:
Constraints:
Verify:
```

Never delegate a broad milestone as one task. Split it into independently verifiable slices and give one agent ownership of a file at a time. Preserve the ledger invariants in `AGENTS.md`.

## Reference map

- `PLAN.md`: canonical feature/design specification; read relevant sections before changes.
- `AI-NOW.md`: current deployment, active work, and compact handoff.
- `CHANGELOG.md`: running log of shipped features/fixes, one entry per session; append here at end of session.
- `HANDOFF.md` / `git log`: historical evidence, loaded only by search.
- `db/schema.sql` and `src/ledger/`: protected ledger foundation; inspect before adjacent work.
