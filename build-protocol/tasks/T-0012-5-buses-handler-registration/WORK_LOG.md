# Work Log: T-0012.5

Task log: `build-protocol/tasks/T-0012-5-buses-handler-registration/TASK.md`
Branch: `task/T-0012-5-buses-handler-registration`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-5-buses-handler-registration`
Baseline commit: `746e862`
Authoring worker: `T-0012.5 review-fix worker`
Review-fix commit: `aab96c715e5b86d8b73204703331383ca6117f7b`
Docs-cleanup commit: `7a19e684fed14e77466e206e6182d436161a5119`
Focused re-review log commit: `d76b810a324bc58a7411e809752f81046d0b3410`
Stable milestone log commit: `f4c3497e2de7abc1a963347cdbce9957bb6dcfaa`

## Purpose

Record chronological branch activity for the round 1 review-fix pass.

## Entries

- `2026-07-01 22:27 WEST`: Inspected bus source, tests, docs, API checks, and
  task/review records before editing. Confirmed all round 1 findings against
  current code/docs.
- `2026-07-01 22:27 WEST`: Added failing review-fix tests for public bus
  surface, no-dispatch event storage, and append failure. Focused tests failed
  on public `dispatch()` exposure and no-dispatch event rejection.
- `2026-07-01 22:28 WEST`: Removed public bus `dispatch()` methods, switched
  dispatcher schema contracts to `MessageSchema`, made `EventStore` a
  type-only import, and changed no-dispatch events to resolve after append.
- `2026-07-01 22:28 WEST`: Corrected test-only compile assertions and the
  append-failure store fake. Focused tests and both typechecks passed.
- `2026-07-01 22:30 WEST`: Documented event dispatcher failure semantics and
  corrected stale deferred-bus wording in server, guide, API, architecture, and
  build-protocol docs.
- `2026-07-01 22:30 WEST`: Recorded round 1 findings and fixes in the task,
  review, implementation, and work logs.
- `2026-07-01 22:35 WEST`: Ran focused bus tests, typecheck, docs/API checks,
  lint, and full verification. Non-escalated full verify stopped only at the
  known ZeroMQ IPC sandbox permission failure; escalated full verify passed.
- `2026-07-01 22:40 WEST`: Started round 2 docs cleanup after docs reviewer
  found stale deferred-bus/storage wording and contradictory final verification
  evidence in task records.
- `2026-07-01 22:40 WEST`: Re-scoped deferred runtime wording in the user
  guide, server README, and API README to integrated service hosting,
  bounded-context runtime wiring, worker handler invocation, transport/service
  assembly, IPC endpoint naming, and process supervision.
- `2026-07-01 22:40 WEST`: Replaced stale final verification evidence with
  review-fix final evidence: 35 files, 302 tests, statements 95.61%, branches
  90.08%, functions 98.37%, lines 95.60%.
- `2026-07-01 22:41 WEST`: Ran `pnpm docs:check`; it passed with the existing
  invalid-`origin` TypeDoc warning only and reported 100 proto, 28 core, 126
  server, 14 storage, and 17 transport expected exports.
- `2026-07-01 22:43 WEST`: Committed docs cleanup as
  `7a19e684fed14e77466e206e6182d436161a5119`.
- `2026-07-01 22:45 WEST`: Focused docs re-review found the work-log HEAD
  field was self-invalidating after each log commit; replaced it with stable
  milestone commit fields and removed future-tense current-state wording.
- `2026-07-01 22:47 WEST`: Final focused docs re-review found no Critical,
  Important, or Minor findings.
- `2026-07-01 22:50 WEST`: Final sandboxed
  `env CI=true corepack pnpm verify` reached 34 passed files and 300 passed
  tests, then stopped only on the known ZeroMQ local IPC sandbox permission
  failure. Escalated `env CI=true corepack pnpm verify` passed with 35 test
  files and 302 tests; coverage statements 95.61%, branches 90.08%, functions
  98.37%, lines 95.60%.

## Current State

- Last completed step: Round 2 review closure, focused docs re-review, and
  final T-0012.5 verification.
- Next step: Integrate T-0012.5 into the parent corrective branch.
- Known risks: None for this fix; non-escalated verification still cannot bind
  ZeroMQ local IPC endpoints in the sandbox.
- Open questions: None.

## Reviewer Finding Disposition

- Stale user-guide runtime/transport wording: fixed by removing the implication
  that buses and storage are absent and naming later integrated service hosting,
  bounded-context runtime wiring, and transport/service assembly instead.
- Stale server runtime README wording: fixed by describing
  `SingleProcessServerRuntime` as the small local async intake/lifecycle kernel
  under buses and later runtime parts.
- Stale API routing wording: fixed by scoping deferred work to integrated
  runtime wiring, worker handler invocation, service hosting, IPC endpoint
  naming, and process supervision.
- Contradictory implementation report evidence: fixed by keeping the 35-file,
  302-test review-fix evidence and removing the stale 301-test coverage line.
- Pending commit placeholders: replaced with milestone commit fields instead of
  a self-invalidating `Final branch HEAD` field.
- Focused docs re-review minor: final branch HEAD and future-tense cleanup note
  were stale after `7a19e684fed14e77466e206e6182d436161a5119`; this work-log
  update corrects both by naming stable milestones and routing the next step to
  final verification.

## Open Risks And Follow-Up Routing

- Risk: ZeroMQ IPC may fail in sandboxed verification.
- Owner: T-0012.5 worker.
- Linked task: T-0012.5.
- Disposition: Accepted; retry with escalation if the known IPC failure appears.
- Next review point: Parent-branch verification after merge.
