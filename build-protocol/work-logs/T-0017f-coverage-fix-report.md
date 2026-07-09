# T-0017f Coverage Fix Report

Date: `2026-07-09`
Branch: `task/T-0017f-process-manager-runtime`
Worktree:
`.worktrees/T-0017f-process-manager-runtime`

## Goal

Raise branch coverage above the `90%` verify gate without changing production
code, using targeted regressions around the runtime branches added in T-0017f.

## Changes

- Added EventBus follow-up tests in
  `packages/server/test/bus/event-bus.test.ts` covering:
  - `eventBusAccess.postFollowUp()` appending and dispatching a newly accepted
    follow-up event.
  - rejection after the bus closes.
  - non-EventBus guard rejection.
- Added process-manager routing coverage in
  `packages/server/test/repository/repository-routing.test.ts` covering:
  - event-commanding handlers that route by the first event field even when the
    source event `producerId` identifies a different entity.
  - a command-only process-manager repository fixture so the routing test hits
    the command-reaction-only receiver path.

## Verification Plan

- Run the focused suites requested by the coordinator:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/bus/event-bus.test.ts packages/server/test/repository/repository-routing.test.ts`
- If time permits, rerun coverage or the full verify gate to confirm the branch
  coverage delta.

## Verification Results

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/bus/event-bus.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed with `2` files and `128` tests.
- `pnpm --config.verify-deps-before-run=false verify` did not reach the branch
  coverage gate in this sandbox. It failed in environment-sensitive suites with
  `listen EPERM: operation not permitted 127.0.0.1` for real gRPC listener
  tests and `Operation not permitted` for ZeroMQ local IPC smoke tests.
- `pnpm --config.verify-deps-before-run=false exec vitest run --coverage.enabled --coverage.reporter=text packages/server/test/bus/event-bus.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed both focused suites and reported per-file branch coverage of
  `94.33%` for `packages/server/src/bus/event-bus.ts` and `76.81%` for
  `packages/server/src/repository/repository.ts`. The command still exited
  non-zero because the repo's global `90%` coverage threshold applies across
  all source files when only two suites are run.
- `git diff --check` passed.

## Notes

- No production files were changed.
- Scope stayed inside the preferred bus/repository test files plus durable work
  logs.
