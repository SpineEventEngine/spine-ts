# Work Log: T-0012.5

Task log: `build-protocol/tasks/T-0012-5-buses-handler-registration/TASK.md`
Branch: `task/T-0012-5-buses-handler-registration`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-5-buses-handler-registration`
Baseline commit: `746e862`
Authoring worker: `T-0012.5 review-fix worker`
Implementation commit: Pending branch commit
Final branch HEAD: Pending branch commit

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

## Current State

- Last completed step: Round 1 code, tests, docs, log fixes, and verification.
- Next step: Commit review-fix changes.
- Known risks: None for this fix; non-escalated verification still cannot bind
  ZeroMQ local IPC endpoints in the sandbox.
- Open questions: None.

## Open Risks And Follow-Up Routing

- Risk: ZeroMQ IPC may fail in sandboxed verification.
- Owner: T-0012.5 worker.
- Linked task: T-0012.5.
- Disposition: Accepted; retry with escalation if the known IPC failure appears.
- Next review point: Final verification.
