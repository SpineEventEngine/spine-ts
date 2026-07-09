# T-0017g Implementation Report

Status: `DONE_WITH_CONCERNS`

## Scope Completed

Implemented the smallest durable inbox handoff slice for `T-0017g`:

- process-manager repository command delivery now writes a durable
  process-manager inbox row before local execution;
- the owning bounded context now drains that inbox row immediately through the
  existing local `Delivery.drain()` path; and
- the drain routes stored command envelopes back into the correct repository
  through a framework-owned replay path so the handoff does not recurse.

Aggregate command execution, repository event execution, and the remaining
direct/local runtime paths were intentionally left on their existing behavior in
this task.

## Files Changed

- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/repository/repository.ts`
- `packages/server/test/repository/repository-routing.test.ts`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `packages/server/README.md`
- `build-protocol/work-logs/T-0017g.md`

## TDD Record

Red:

- Added
  `writes process-manager commands to a durable inbox before local delivery`
  in `packages/server/test/repository/repository-routing.test.ts`.
- After restoring generated/built workspace prerequisites, the focused test
  failed because no `DELIVERED` inbox row existed for the process-manager
  command.

Green:

- Wired process-manager command dispatch through durable inbox receive plus
  immediate local shard drain.
- Reran the focused test and it passed.

## Verification

- `pnpm --config.verify-deps-before-run=false proto:generate` - passed
- `pnpm --config.verify-deps-before-run=false typecheck:build:generated` - passed
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts -t "writes process-manager commands to a durable inbox before local delivery"` - passed
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts` - passed (`101` tests)
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/context/bounded-context.test.ts` - passed (`39` tests)
- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/delivery/delivery-worker.test.ts` - passed (`16` tests)
- `pnpm --config.verify-deps-before-run=false docs:check` - passed with the existing invalid-`origin` TypeDoc warning
- `git diff --check` - passed
- `pnpm --config.verify-deps-before-run=false format:check` - passed

## Concerns

- This task only moves process-manager command assignees behind durable inbox
  handoff. Repository event paths, aggregate command paths, and broader
  scheduler/retry/catch-up delivery behavior remain deferred by design.
