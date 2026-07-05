# Review Log: T-0012.11c Projection List Queries

Task log:
`build-protocol/tasks/T-0012-11c-projection-list-queries/TASK.md`
Branch: `task/T-0012-11c-projection-list-queries`
Baseline commit: `8caec30`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-11c-projection-list-queries`
Status: complete

## Required Lanes

- code style/maintainability: no remaining comments
- documentation: no remaining comments
- TypeScript/API docs: no remaining comments
- security: no remaining comments
- performance/reliability: no remaining comments

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

## Round 2

- documentation: package, architecture, and user-guide wording now all state
  the same tenant rules for point reads, direct list reads, and
  `QueryService.Read` include-all projection reads.

## Final Outcome

- Round-2 code style/maintainability: clean.
- Round-2 TypeScript/API docs: clean.
- Round-2 security: clean.
- Round-2 performance/reliability: clean.
- Final documentation re-review after `4102284`: clean.
- All participating sub-agents were closed by the orchestrator after their
  reports were received.

## Parent Integration Review

- code style/maintainability: found that `QueryService.Read` accepted
  `include_all` for every registered state route, while this slice only
  promised projection-state list reads.
- fix: the parent branch now carries repository `entityFamily` on the service
  route and returns `INVALID_QUERY` for non-projection include-all targets
  before reading from `Stand`.
- follow-up TypeScript/API: found that tenant validation still ran before the
  non-projection include-all guard, so multitenant reads without tenant returned
  `TENANT_REQUIRED` and single-tenant reads with tenant returned
  `TENANT_INAPPLICABLE`.
- follow-up fix: `SpineServices.#read()` now computes include-all intent after
  route lookup and rejects non-projection include-all targets before
  `tenantMismatch()`, with focused regressions covering both tenant modes.
- follow-up documentation: API docs now say `QueryService.Read` supports
  projection-state ID-filter reads and projection-state
  `Target.include_all = true` reads. The generated API reference directory is
  ignored in this worktree, so there was no tracked generated reference to
  update.
