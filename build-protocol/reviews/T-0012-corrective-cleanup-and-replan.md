# Review Log: T-0012 Corrective Cleanup And Roadmap Reset

Task log:
`build-protocol/tasks/T-0012-corrective-cleanup-and-replan/TASK.md`
Branch: `task/T-0012-cleanup-replan`
Baseline commit: `a9769d4`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-cleanup-replan`
Status: Governance/setup in progress.

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
