# Notch — Claude entrypoint

Read `AGENTS.md`, `AI-CONTEXT.md`, and `AI-NOW.md` before work. Read `PLAN.md` as required by `AGENTS.md`, then load only task-relevant source files; do not load the entire historical handoff by default.

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
- `HANDOFF.md` / `git log`: historical evidence, loaded only by search.
- `db/schema.sql` and `src/ledger/`: protected ledger foundation; inspect before adjacent work.
