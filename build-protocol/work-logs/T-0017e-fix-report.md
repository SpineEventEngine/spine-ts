# T-0017e Review Fix Report

Status: `DONE`
Date: `2026-07-09`
Fix worker: `T-0017e-review-fix-sub-agent`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0017e-reactor-commanders`

## Scope

Addressed only the first-round reviewer findings listed for
style/maintainability, docs/logs, TypeScript/API, security, analyzer validation,
and reliability. `human-review-1-jul.md` was untouched. No commit was made.

## Fixes

- Refactored `AggregateEventExecution.run()` into smaller private execution
  steps and added shared aggregate execution support for load, instantiation,
  default state, replay, and produced-signal normalization.
- Renamed repository runtime command callback from `postCommand` to
  `onPostCommand` and updated bounded-context registration.
- Moved generated emitted schemas out of public handler metadata records into a
  framework-owned sidecar accessed through `handlerMetadataAccess`.
- Updated generated registry/readiness/repository paths to use the internal
  emitted-schema accessor, including sidecar copying for internal readiness
  clones.
- Rejected build-time generated `@React(): void` / empty emitted schemas.
- Added source-event origin to commands produced by event-side command
  reactions, including packed source `EventId`, source event type URL, source
  actor context, and source grand origin when present.
- Replaced timer-based produced-event dispatch with event-bus follow-up runtime
  work that is ordered before later external posts and drained before close.
- Made aggregate event execution reject unsnapshotted managed/no-applier
  history.
- Updated `packages/server/README.md`, review log, and work log for closure.

## Verification

- Red check:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/handler/generated-handler-registry.test.ts packages/server/test/handler/build-time-handler-analyzer.test.ts packages/server/test/repository/repository-routing.test.ts`
  failed as expected with five targeted failures before fixes.
- Focused green:
  `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/handler/generated-handler-registry.test.ts packages/server/test/handler/build-time-handler-analyzer.test.ts packages/server/test/repository/repository-routing.test.ts`
  passed; 3 files, 112 tests.
- `pnpm --config.verify-deps-before-run=false typecheck:build:generated`:
  passed after one helper type cleanup.
- `pnpm --config.verify-deps-before-run=false format`: passed and wrote local
  formatting updates.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `pnpm --config.verify-deps-before-run=false lint`: passed after test lint
  cleanup; includes proto generation, `tsc -b`, ESLint, and cleanup rules.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed with the
  existing TypeDoc invalid `origin` remote warning only.
- `pnpm --config.verify-deps-before-run=false proto:check-generated`: passed.
- `git diff --check`: passed.

## Concerns

- Full `pnpm verify` was not run. Verification used focused regression tests
  plus typecheck, lint, docs check, format check, proto generated-output check,
  and diff whitespace check.
