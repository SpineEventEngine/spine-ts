# Implementation Report: T-0012.11 Missing Details And Example Readiness

Status: split complete; first implementation slice selected; splitter review
comments addressed
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

- current repository dispatch is still route-only;
- every later example workflow depends on real aggregate command execution; and
- it is the smallest slice that delivers executable value without introducing a
  speculative runtime shell.

The orchestrator has now created that branch/worktree from reviewed split
commit `8804e93`.

## Current State

Requirements splitting is complete. The task now has a staged roadmap with five
concrete implementation slices.

`T-0012.11a Aggregate Command Execution` is the selected first slice. Its
branch/worktree is open from `8804e93`, and the child worktree has completed
the aggregate command-execution review-fix and primitive-ID coverage follow-up:
focused write-side tests, typecheck/lint/format/docs/diff verification, durable
doc/log updates, and escalated `pnpm test:coverage` are recorded there. The
sandboxed coverage command still depends on local IPC and loopback listener
permissions, but the escalated coverage gate passed after the primitive-ID
tests. A follow-up worker then closed stale docs, executable aggregate version
typing, helper simplicity, async-assignee, snapshot-failure handoff, and
reentrant registration cleanup findings; fresh verification passed in the child
worktree, including escalated coverage with 45 files and 559 tests.
