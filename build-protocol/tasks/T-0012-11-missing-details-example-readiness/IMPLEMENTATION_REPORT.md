# Implementation Report: T-0012.11 Missing Details And Example Readiness

Status: T-0012.11a through T-0012.11e merged and parent-verified
Branch: `task/T-0012-11-missing-details-example-readiness`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11-missing-details-example-readiness`
Baseline commit: `3901ec4`

## Summary

This task follows real gRPC service integration. The splitter kept only the
small missing framework details that are still required before `T-0012.12` can
build the to-do example as a real app.

## Initial Evidence

- `T-0012.10` integrated real `CommandService`, `QueryService`, and
  `SubscriptionService` adapters over the command bus and direct `Stand`.
- Parent verification after `T-0012.10` passed with 44 test files, 527 tests,
  and branch coverage 90.06%.
- The to-do example still needs a fully runnable server-side app with real gRPC,
  query, and subscription behavior.

## Splitting Rationale

The split applied the simplest-complete-slice rule rather than a horizontal
framework rebuild:

1. Start with the smallest vertical command path that turns route metadata into
   real aggregate behavior.
2. Add the matching read-side event path so projections and subscriptions become
   real.
3. Expand queries only enough to support a task-list view.
4. Wire validation and immediate refusal semantics only because the example
   spec explicitly requires them.
5. Finish with the smallest black-box testing utility because `packages/testing`
   is still a placeholder.

Rejected for now as unproven blockers:

- broad `Server` facade or process supervision;
- import bus support;
- scheduler support;
- tenant index work;
- catch-up/recovery loops;
- observability work; and
- client DSL work.

## Selected First Subtask

Selected: `T-0012.11a Aggregate Command Execution`

Branch: `task/T-0012-11a-aggregate-command-execution`

Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11a-aggregate-command-execution`

Why selected first:

- repository dispatch was still route-only at split time;
- every later example workflow depends on real aggregate command execution; and
- it is the smallest slice that delivers executable value without introducing a
  speculative runtime shell.

The orchestrator created that branch/worktree from reviewed split commit
`8804e93`; the slice is now merged into this parent branch at `1a7b6c8`.

## Current State

Requirements splitting is complete. The task now has a staged roadmap with five
concrete implementation slices.

`T-0012.11a Aggregate Command Execution` is merged into this parent branch at
`1a7b6c8`. The child worktree completed the aggregate command-execution
review-fix, coverage-fix, and round-2 async-applier fix passes. The final parent
verification passed after rebuilding workspace package entrypoints: focused
tests (5 files, 62 tests), `pnpm docs:check`, `pnpm typecheck`, `pnpm lint`,
`git diff --check HEAD^..HEAD`, and escalated `pnpm test:coverage` (45 files,
564 tests; statements 94.85%, branches 90.03%, functions 97.33%, lines
94.87%). Sandboxed coverage remains blocked only by local IPC/HTTP2 endpoint
permissions.

`T-0012.11b Projection Event Updates` is merged into this parent branch at
`cb46983`. It adds projection subscriber execution from delivered events,
read-side `Stand` updates, bounded stored-event redispatch diagnostics, and the
contract-safe aggregate `command.id` requirement before mutation/storage. Parent
verification passed after the merge: focused repository/service tests (2 files,
63 tests), `pnpm typecheck`, `pnpm lint`, `pnpm format:check`,
`pnpm docs:check`, `git diff --check`, and escalated `pnpm test:coverage` (45
files, 580 tests; branches 90.04%). Sandboxed service/coverage runs remain
blocked only by local endpoint permissions.

`T-0012.11c Projection List Queries` is merged into this parent branch at
`413c5f7`. It adds direct Stand list reads, `QueryService.Read`
projection-state `Target.include_all` support, tenant-boundary coverage, public
docs/API updates, and focused list-read reliability tests. Parent review found
include-all had been accepted for all state routes; follow-up commits `764b946`
and `a0c6dde` now reject non-projection include-all targets with
`INVALID_QUERY` before tenant validation or storage access. Parent verification
passed: focused stand/service tests, `pnpm typecheck`, `pnpm lint`,
`pnpm format:check`, `pnpm docs:check`, `git diff --check`, and escalated
`pnpm test:coverage` (45 files, 592 tests; branches 90.03%). Sandboxed coverage
remains blocked only by local endpoint permissions.

`T-0012.11d Validation And Immediate Refusal Outcomes` is merged into this
parent branch at `9174df8`. It adds command-bus payload validation before
dispatcher callbacks, stable immediate refusal and validation `Ack` mappings,
and runtime transition-validation enforcement that blocks invalid aggregate
events before durable writes. Parent verification passed affected
bus/repository/service tests outside the sandbox with 3 files and 99 tests;
`pnpm typecheck`, `pnpm lint`, `pnpm docs:check`, `pnpm format:check`,
`git diff --check`, and escalated `pnpm test:coverage` with 45 files, 610
tests, and branch coverage 90.09%. Sandboxed affected service tests and
coverage remain blocked only by local endpoint and IPC permissions.

`T-0012.11e Minimal Black-Box Test Fixture` is merged into this parent branch
at `c9ed81d`. It replaces the testing-package skeleton with a small
`BoundedContextFixture` over built bounded contexts, drives command/query/
subscription behavior through real in-process framework seams, and keeps the
fixture API narrow. Parent verification passed after the merge: focused fixture
tests (1 file, 10 tests), `pnpm typecheck`, `pnpm lint`, `pnpm docs:check`,
`pnpm format:check`, `git diff --check`, and escalated `pnpm test:coverage`
with 45 files, 619 tests, and branch coverage 90.22%. Sandboxed coverage
remains blocked only by local endpoint and IPC permissions.
