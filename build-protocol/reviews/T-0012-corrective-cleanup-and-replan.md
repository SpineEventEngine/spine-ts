# Review Log: T-0012 Corrective Cleanup And Roadmap Reset

Task log:
`build-protocol/tasks/T-0012-corrective-cleanup-and-replan/TASK.md`
Branch: `task/T-0012-cleanup-replan`
Baseline commit: `a9769d4`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-cleanup-replan`
Status: Requirements split complete; first cleanup subtask selected.

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Current Notes

Reviewers must enforce the new human reset:

- simplicity beats speculative precision;
- JVM concept names are preferred;
- generated code is ignored and regenerated;
- tests are outside `src`;
- package structure is semantic rather than flat;
- the implementation order starts with storage/event store and reaches the
  to-do example only after real gRPC/query/subscription support exists.

## Review Setup Adjustment After Split

The splitter selected `T-0012.1 Cleanup Enforcement Baseline` as the first
non-blocked implementable subtask. Reviewers for that subtask should focus on
whether enforcement is real and narrow:

- generated Protobuf-ES output is no longer tracked under `src/generated`;
- tests are no longer co-located under package `src`;
- package source folders move toward semantic structure without unrelated
  behavioral redesign;
- automated checks cover generated-code location, co-located tests, name
  component limits, callback naming, line length, and committed generated
  output;
- path/import changes are the only implementation behavior changes unless a
  specific exception is logged.

For later cleanup subtasks, reviewers should flag:

- public snapshot/detail/error hierarchies that survive without JVM-backed
  justification;
- runtime routing, lifecycle, or transport delivery concepts that remain ahead
  of the corrected storage/bus/bounded-context/repository order;
- storage APIs that keep a broad adapter surface instead of the JVM-like
  `StorageFactory`/`RecordStorage` seam;
- gRPC service work before real buses and `Stand` exist.
