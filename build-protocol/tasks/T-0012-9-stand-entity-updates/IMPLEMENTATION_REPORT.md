# Implementation Report: T-0012.9 Stand And Entity Updates

Status: selected; implementation pending
Branch: `task/T-0012-9-stand-entity-updates`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-9-stand-entity-updates`
Baseline commit: `796221d`

## Summary

This task starts the read-side `Stand` slice after storage, buses, bounded
context, repositories, aggregate storage/routing, and delivery/inbox are in
place.

The implementation must keep the first `Stand` API direct and small. It must
not introduce gRPC service adapters, client DSLs, worker-thread read-side
execution, or repository handler invocation.

## Initial Evidence

- Parent `main` verification passed after `T-0012.8b` with 42 test files, 489
  tests, and branch coverage 90.02%.
- Existing TS code has no `packages/server/src/stand` folder.
- Existing repository/context code already carries enough state-type metadata
  to register direct stand type support.
- The local JVM server stand source directory is empty, so the local JVM
  evidence for this task is the documentation and service-routing notes rather
  than Java source bodies.

## Skill Applicability

Implementation and reviewers must apply the already-installed skills where
needed:

- `subagent-driven-development` for worker/reviewer split.
- `test-driven-development` and `javascript-testing-patterns` for the new
  stand behavior.
- `cqrs-implementation` or equivalent CQRS guidance for strict read-side /
  write-side segregation.
- `api-design-principles` and `typescript-advanced-types` only where public API
  shape or generic state typing needs review.
- `verification-before-completion` before claiming task completion.

## Planned Shape

The expected first slice is:

- a `Stand` class in `packages/server/src/stand`;
- direct state-type registration from repository metadata;
- storage-backed state update/read behavior using `RecordStorage`;
- direct in-process subscribers with explicit unsubscribe;
- bounded-context exposure of its owned `Stand`;
- public exports and docs for the direct stand API.

If implementation discovers that a different but simpler shape better matches
the existing code, record the reason here before committing.

## Current State

No implementation commit has been made yet. No blocking human question is
known.
