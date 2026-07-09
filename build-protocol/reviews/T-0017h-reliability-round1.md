# T-0017h Performance/Reliability Review Round 1

Reviewer: T-0017h performance/reliability
Worktree: `.worktrees/T-0017h-delivery-scheduler-retry`
Branch: `task/T-0017h-delivery-scheduler-retry`
Date: `2026-07-09`

## Canonical Skill Applicability Check

- Durable review log: this file is the reviewer log for this round, per the
  requested write target.
- Session inventory evidence: the session exposed advisory skills including
  `review`, `code-review-excellence`, `verification-before-completion`,
  `javascript-testing-patterns`, `nodejs-backend-patterns`,
  `typescript-advanced-types`, and `performance`.
- Task-provided skill names/paths: the prompt did not name a specific skill,
  but requested selected reliability/review skill files if relevant.
- Expected-skill manifest checked:
  `build-protocol/skills/EXPECTED_SKILLS.md`.
- User-installed entrypoints checked with:
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
  The full `/Users/armiol/.agents/skills` directory was enumerated.
- Installed lock checked:
  `/Users/armiol/.agents/.skill-lock.json`. `/Users/armiol/.codex/.skill-lock.json`
  was not present.
- Selected and fully read skills:
  `/Users/armiol/.agents/skills/review/SKILL.md`,
  `/Users/armiol/.agents/skills/code-review-excellence/SKILL.md`, and
  `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md`.
- Skipped relevant-looking skills:
  `performance` because its metadata is web-performance focused, not server
  runtime delivery reliability; `javascript-testing-patterns` because this
  round reviews existing tests rather than authoring new ones.
- Governing sources: `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`, the T-0017h task
  ledger, and JVM observations govern over advisory skill content.

## Ledger And Scope Check

Checked the Human-Imposed Requirements Ledger in
`build-protocol/tasks/T-0017h-delivery-scheduler-retry/TASK.md`. Review focused
on `DeliveryLoop`, existing `Delivery.drain()` interactions, process-manager
handoff regression, stop/close behavior, failure bounds, late-row/page repeat
behavior, catch-up/storage scope, and verification evidence.

Reviewer-side verification run:

```text
pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-loop.test.ts packages/server/test/delivery/delivery-worker.test.ts packages/server/test/context/process-manager-handoff.test.ts --passWithNoTests
```

Result: passed, 3 files and 30 tests.

Positive checks:

- Loop termination is covered for idle, skipped, stopped-before-run, and
  failure-bound cases.
- Stop during a current drain returns after that drain and does not start a new
  drain.
- Failed rows remain `TO_DELIVER` and are retried by later loop/drain runs.
- Page and late-row repeat behavior is covered by the focused loop test.
- The implementation does not introduce timers, IPC/listeners, fake durable
  catch-up storage, conveyor/station machinery, or broad storage catch-up code.
- Process-manager handoff remains on the existing `Delivery.drain()` path; the
  focused handoff regression tests passed.

## Findings

### P2 - Public API docs contradict the new scheduler loop

File/line: `docs/api/README.md:289` and `docs/api/README.md:298`

Rationale: The paragraph first documents that `DeliveryLoop` repeats
`Delivery.drain()` until idle/skipped/stopped/failure-bound, then says "This
slice does not run scheduler loops." That is now false or at least ambiguous
for the public contract. The task acceptance criteria require public docs/API
docs to describe the supported loop and deferred production pieces.

Concrete fix: Change the exclusion to the narrower deferred behavior, e.g.
"does not run transport-backed worker supervision, retry monitors, ... or
read-side catch-up loops."

### P2 - Verification evidence is incomplete and stale for the task gate

File/line:
`build-protocol/tasks/T-0017h-delivery-scheduler-retry/TASK.md:145`,
`build-protocol/tasks/T-0017h-delivery-scheduler-retry/TASK.md:149`,
`build-protocol/work-logs/T-0017h.md:138`,
`build-protocol/work-logs/T-0017h.md:173`,
`build-protocol/reviews/T-0017h-delivery-scheduler-retry.md:64`

Rationale: The verification plan requires `lint`, `docs:check`, full `verify`,
and coverage via the full verify path. The durable work log records focused
tests, `lint:generated`, `docs:check:generated`, `proto:check-generated`,
`git diff --check`, and a later passing `format:check`, but not a successful
full `pnpm --config.verify-deps-before-run=false verify`. The review snapshot
also still says full `format:check` is blocked even though the work log later
records it as passing. This leaves reviewers and integrators without a current
single source of truth for coverage/full-gate status.

Concrete fix: Run the full task gate, preferably the explicit
`pnpm --config.verify-deps-before-run=false verify` allowed by the ledger, and
update the work/review logs with the exact result, including coverage. Also
refresh the stale review snapshot so it no longer says `format:check` is
blocked if it has passed.

### P3 - `close()` rejection behavior lacks focused regression coverage

File/line: `packages/server/src/delivery/delivery-loop.ts:50` and
`packages/server/test/delivery/delivery-loop.test.ts:152`

Rationale: `close()` currently stops the loop and awaits `#running`, so a
current `Delivery.drain()` rejection will propagate to `close()`. That is a
reasonable behavior, but the focused shutdown tests only cover the successful
in-flight drain case. The review prompt explicitly called out close rejection
handling, and storage/shard failures are reliability-relevant.

Concrete fix: Add a focused test with a fake or fault-injected `Delivery` whose
`drain()` rejects after a barrier. Assert `close()` rejects with that error,
the running promise observes the same failure, and no later drain starts after
`stop()`.
