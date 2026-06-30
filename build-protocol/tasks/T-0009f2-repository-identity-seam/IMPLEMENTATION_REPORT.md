# Implementation Report: T-0009f.2 Repository Identity And Entity Ownership Seam

Status: Setup In Progress
Task log: `build-protocol/tasks/T-0009f2-repository-identity-seam/TASK.md`
Work log: `build-protocol/work-logs/T-0009f2.md`
Review log: `build-protocol/reviews/T-0009f2-repository-identity-seam.md`

## Summary

Subtask setup began on `2026-06-30 07:34 WEST` from parent commit `2dcb581`.
The selected scope is a metadata-only repository identity seam. It must mirror
the JVM repository model only as far as entity ownership metadata, leaving
storage, routing, dispatch, inboxes, caches, lifecycle, stand, and context
registration execution to later subtasks.

## JVM Research Used

Initial orchestrator research inspected:

- `Repository.java`: model-class identity, `idClass()`, `entityClass()`,
  `entityStateType()`, one-context registration, and storage/open lifecycle.
- `RecordBasedRepository.java`: entity-record persistence is a subclass/runtime
  concern and must stay out of this subtask.
- `DefaultRepository.java`: family-based default repository selection is a
  convenience seam, not an invitation to build runtime repositories now.
- `AggregateRepository.java`, `ProjectionRepository.java`, and
  `ProcessManagerRepository.java`: routing, inbox, cache, dispatch, catch-up,
  import, command bus, event bus, and query behavior are concrete repository
  runtime behavior and out of scope for this subtask.
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` and
  `spine-jvm-docs/spine-entities-repositories-and-state.md`: bounded context
  registration and repository runtime wiring are future tasks.

## Implementation Notes

- Pending implementation sub-agent.

## Verification

- Pending.

## Review

- Pending.
