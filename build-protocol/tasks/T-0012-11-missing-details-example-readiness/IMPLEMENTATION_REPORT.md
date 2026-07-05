# Implementation Report: T-0012.11 Missing Details And Example Readiness

Status: split complete; T-0012.11a merged and parent-verified; T-0012.11b round-3 fixes verified
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

`T-0012.11b Projection Event Updates` is active in the child worktree. Its
initial implementation and review-fix rounds 1 through 3 passed focused and
full verification. The round-2 pass records asynchronous already-stored event
redispatch failures through `BoundedContext.storedEventDispatchFailures()`
without changing aggregate command completion after storage/snapshot handling
or adding retry/catch-up delivery behavior. The round-3 pass binds
aggregate-produced event origin to the command tenant, stores bounded frozen
diagnostic error snapshots, and fixes public/API docs. Escalated coverage
passed with 45 files and 579 tests; sandboxed coverage remains blocked only by
local endpoint permissions.
