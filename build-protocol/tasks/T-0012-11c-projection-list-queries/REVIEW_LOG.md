# Review Log: T-0012.11c Projection List Queries

Task log:
`build-protocol/tasks/T-0012-11c-projection-list-queries/TASK.md`
Branch: `task/T-0012-11c-projection-list-queries`
Baseline commit: `8caec30`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11c-projection-list-queries`
Status: complete

## Required Lanes

- code style/maintainability: pending
- documentation: pending
- TypeScript/API docs: pending
- security: pending
- performance/reliability: pending

## Round 1

- code style/maintainability: `packVersionedState()` now keeps the schema/state
  generic relation by accepting `StandReadResult<Schema>`.
- documentation: updated `docs/USER_GUIDE.md`, `packages/server/README.md`,
  `docs/api/README.md`, and `docs/architecture/README.md` to cover direct list
  reads, `Target.include_all`, deterministic storage-order results, and
  tenant-option behavior.
- TypeScript/API docs: the public API summary now mentions
  `Stand.readAllVersioned()` and `QueryService.Read` include-all behavior.
- security: no new data surfaces; include-all reads continue to use existing
  tenant checks and sanitized `QUERY_READ_ERROR` handling.
- performance/reliability: focused stand tests now prove `readAllVersioned()`
  closes storage handles after success and rejection, and that returned
  state/version values are copy-safe across rereads.
