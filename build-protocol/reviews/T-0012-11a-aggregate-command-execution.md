# Review Log: T-0012.11a Aggregate Command Execution

Status: round-2 review-fix worker complete; verification passed with escalated coverage
Task log: `build-protocol/tasks/T-0012-11a-aggregate-command-execution/TASK.md`
Branch: `task/T-0012-11a-aggregate-command-execution`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11a-aggregate-command-execution`
Baseline commit: `8804e93`

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must verify:

- command handling remains asynchronous from `CommandBus.post()` even when
  stored-event delivery later fails;
- already-stored event delivery runs dispatcher accept hooks before dispatch and
  isolates accept failures to the delivery job;
- repository execution stays on the write side, preserves caller tenant context
  for aggregate storage, and does not read through `Stand` or other read
  models;
- aggregate command handlers emit event(s), while appliers own state mutation;
- aggregate history and snapshot persistence use existing `AggregateStorage` and
  `EventStore` seams rather than a parallel store abstraction;
- repository-executed aggregate version metadata stays `bigint`, and produced
  event versions fail cleanly when they exceed the protobuf int32 range;
- executable aggregate repositories reject non-`bigint` aggregate version
  metadata at the public type boundary;
- async aggregate assignees are awaited before produced events are normalized;
- async aggregate event appliers are awaited before aggregate append/snapshot
  ordering proceeds, and async applier rejection is observed by command
  completion;
- events already appended to aggregate storage are handed to stored-event
  dispatch even when snapshot writing fails, while command completion still
  rejects with the snapshot failure;
- failed reentrant repository registration cannot clear the executable runtime
  of the already registered repository;
- produced events preserve readable producer IDs and primitive producer-ID
  routing stays contract-safe; and
- tests prove behavior through built bounded contexts and storage seams rather
  than private helpers.

## Current State

The branch/worktree contains the original review-fix pass for findings A-G, the
primitive-ID coverage-fix test, and the follow-up worker changes for stale docs,
executable aggregate `bigint` typing, helper simplification, async assignees,
snapshot-failure dispatch, and reentrant registration cleanup. Round-2 fixes
now await aggregate event appliers before append/snapshot ordering, observe
async applier rejection through command completion, replace the internal
`PrimitiveIds` helper test with aggregate-storage behavior coverage, and update
the deferred-work documentation. Small public-surface coverage tests in
command/event readiness and signal intake keep the global branch gate green
without reintroducing helper-shape coupling. Final verification passed:
focused tests with 5 files and 62 tests, `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, `pnpm docs:check`, `git diff --check`, and escalated
`pnpm test:coverage` with 45 files, 564 tests, and branch coverage at 90.03%.
Sandboxed coverage remains blocked only by local IPC/HTTP2 endpoint
permissions.
