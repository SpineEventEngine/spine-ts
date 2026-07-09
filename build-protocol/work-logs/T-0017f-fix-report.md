# T-0017f First-Round Fix Report

Status: `DONE`
Date: `2026-07-09`
Worktree:
`.worktrees/T-0017f-process-manager-runtime`

## Findings Addressed

- Style/maintainability: replaced the dead
  `repository.entityFamily !== "projection"` branch in
  `dispatchRepositoryEvent()` with an explicit `switch` over repository entity
  family.
- Documentation: removed stale `docs/USER_GUIDE.md` wording that said
  process-manager reactions were deferred. Updated `packages/server/README.md`
  to document process-manager command assignees, event reactors,
  event-commanding handlers, first-field command/event routing, tenant-scoped
  Stand state storage with numeric versions, framework envelope wrapping after
  commit/state storage, EventStore append before fan-out, and the still-deferred
  durable inbox/scheduler/recovery boundary.
- TypeScript/API: fixed tests that passed `Any | undefined` to `unpackAny()` by
  guarding the produced message first. Constrained handler-bearing
  process-manager repositories to `number` version metadata, matching
  Stand-backed runtime storage. Updated Repository/RepositoryOptions JSDoc for
  process-manager runtime behavior and event schemas emitted by process-manager
  handlers.
- Security: required `command.id` at the start of
  `ProcessManagerCommandExecution.run()` before route/load/invoke/store. Reused
  the captured command ID for produced event IDs and past-message origins.
  Command-produced process-manager events now always carry a past-message origin
  with actor/grand-origin details included only when present.
- Reliability: added an EventBus follow-up posting path for newly produced
  events so process-manager-produced events are appended to `EventStore` before
  dispatch. Process-manager command-side event dispatch is post-commit and
  failures are recorded without rejecting the committed command. Event-side
  process-manager produced events are scheduled after state commit and before
  command flushing so they are persisted even if later command posting fails.

## Files Changed

- `build-protocol/work-logs/T-0017f.md`
- `build-protocol/work-logs/T-0017f-fix-report.md`
- `docs/USER_GUIDE.md`
- `packages/server/README.md`
- `packages/server/src/bus/event-bus.ts`
- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/repository/repository.ts`
- `packages/server/test/repository/repository-routing.test.ts`

Existing task files and first-round diffs remain present in this worktree.
`human-review-1-jul.md` was not touched.

## Verification

- `pnpm --config.verify-deps-before-run=false typecheck:generated` passed.
- `pnpm --config.verify-deps-before-run=false lint` passed.
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts`
  passed with 1 test file and 96 tests.
- `pnpm --config.verify-deps-before-run=false docs:check` passed with the
  existing TypeDoc warning about an invalid `origin` remote and broken source
  links.
- `pnpm --config.verify-deps-before-run=false format:check` passed.
- `git diff --check` passed.

## Concerns

- Durable inbox handoff, scheduler/retry loops, retained attempt history, and
  durable cross-process recovery remain deferred by the task boundary.
- The worktree still contains earlier T-0017f implementation/report/review task
  files and a carried-forward formatted `T-0017e` review-log diff that this
  fix worker did not revert.
