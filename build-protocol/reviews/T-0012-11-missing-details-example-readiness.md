# Review Log: T-0012.11 Missing Details And Example Readiness

Status: review complete; ready for main integration
Task log:
`build-protocol/tasks/T-0012-11-missing-details-example-readiness/TASK.md`
Branch: `task/T-0012-11-missing-details-example-readiness`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11-missing-details-example-readiness`
Baseline commit: `3901ec4`

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must verify:

- every gap is tied to a concrete example-readiness or framework-workflow need;
- no speculative subsystem is added merely because Spine JVM has it;
- names and APIs stay small and JVM-familiar;
- real gRPC/query/subscription behavior from `T-0012.10` remains intact;
- read-side/write-side segregation is preserved; and
- coverage remains at or above 90% when implementation code changes.

## Round-1 Findings Summary

Round 1 found twelve doc issues in the split:

- durable logs were weakened to conditional updates in subtask write scopes;
- `T-0012.11b` had an overlong name;
- leaf and parent review statuses were stale;
- the first subtask branch/worktree wording implied the split already created
  it;
- the parent `T-0012.11` roadmap reopened broad rejected work;
- `T-0012.11c` did not require tenant-boundary `include_all` regression
  coverage;
- `T-0012.11d` was not bound tightly enough to `PROTOBUF_CONTRACT.md`;
- `T-0012.11a` implied too much synchronous `CommandService.Post` execution;
- `T-0012.11b` blurred read-side storage/update work with `Stand`;
- `pnpm test:coverage` was still conditional in some implementation subtasks;
- `T-0012.11e` did not require unconditional public testing-package docs and a
  typed fixture surface; and
- the review log itself did not yet record the findings/fix pass.

This docs-fix pass applies those corrections.

## Current State

Splitter output is reviewed. Round-1 and round-2 split review comments were
addressed in the task, report, parent docs, and work logs. `T-0012.11a` has
since completed implementation review, merged into this parent branch at
`1a7b6c8`, and passed parent verification.

`T-0012.11b Projection Event Updates` is merged into this parent branch at
`cb46983`. Final child review and parent verification passed. The slice keeps
post-storage command completion resolved, records later redispatch failures
through `BoundedContext.storedEventDispatchFailures()`, executes projection
subscribers through delivered events and `Stand`, and rejects aggregate command
execution without `command.id` before mutation/storage. Parent verification
passed after merge, including escalated coverage with 45 files and 580 tests;
sandboxed service/coverage runs remain blocked only by local endpoint
permissions.

`T-0012.11c Projection List Queries` is merged into this parent branch at
`413c5f7`. Final child review lanes reported no remaining comments, and parent
verification passed after merge.

`T-0012.11d Validation And Immediate Refusal Outcomes` is merged into this
parent branch at `9174df8`. Final child review and parent verification passed.

`T-0012.11e Minimal Black-Box Test Fixture` is merged into this parent branch
at `c9ed81d`. Final child review and parent verification passed.

Parent integration style review then found one important scope issue: the
include-all `QueryService.Read` path was attached to every state route instead
of projection routes only. The accepted fix is to carry `entityFamily` into
the service route and reject non-projection `include_all` targets with
`INVALID_QUERY` before tenant validation or `Stand.readAllVersioned()`. A
follow-up regression pass covers both multitenant non-projection reads without
tenant and single-tenant non-projection reads with tenant, so tenant errors
cannot preempt the projection-target query error.

## Round-2 Findings Summary

Round 2 only found two remaining doc gaps:

- `T-0012.11c` still treated public/API docs and docs verification as optional
  even though `QueryService.Read` changes public client behavior; and
- `T-0012.11d` still treated public/API docs and docs verification as optional
  even though immediate refusal and `Ack` rejection behavior is client-visible
  API behavior.

This final docs-fix pass applied the remaining status and public/API-doc
corrections.

Reviewers should confirm that the staged split stays narrow:

- `T-0012.11a` handles executable aggregate command flow before any broader
  runtime work;
- later slices add only projection updates, projection-list queries,
  validation/refusal wiring, and minimal black-box test support; and
- rejected candidates such as a broad `Server` facade, import bus, scheduler,
  catch-up, and observability remain out of scope until a concrete workflow
  proves otherwise.

## Final Parent Review

Parent integration review after the `T-0012.11e` merge found only stale child
ledger status text. Commit `6cdd760` updated the `T-0012.11e` task, report,
review log, and work log to record parent merge commit `c9ed81d` and parent
verification evidence. Final re-review of that fix passed cleanly in all
required lanes: code style/maintainability, documentation, TypeScript/API docs,
security, and performance/reliability.
