# Review Log: T-0012.11 Missing Details And Example Readiness

Status: split complete; T-0012.11a merged and parent-verified; T-0012.11b round-3 fixes verified
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

`T-0012.11b Projection Event Updates` is active in its child worktree. Initial
implementation and review-fix rounds 1 through 3 passed child verification.
Round-2 fixes covered the stored-event redispatch reliability gap. Round-3
fixes covered tenant/security, bounded diagnostics, internal naming, and
public/API docs. Post-storage command completion remains resolved, later
redispatch failures are observable through
`BoundedContext.storedEventDispatchFailures()`, and no retry/catch-up/delivery
worker scope was added. Escalated coverage passed with 45 files and 579 tests;
sandboxed coverage remains blocked only by local endpoint permissions.

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
