# T-0017e Second Review Fix Report

Status: `DONE`
Date: `2026-07-09`
Fix worker: `T-0017e-second-review-fix-sub-agent`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0017e-reactor-commanders`

## Scope

Addressed only the four remaining re-review findings: runtime follow-up public
surface, generated registry public/API-doc surface, schema-bearing decorator
public overloads, and runtime/event-bus close drain reliability.
`human-review-1-jul.md` was untouched. No commit was made.

## Fixes

- Removed public `SingleProcessServerRuntime.enqueueFollowUp()` and introduced
  package-owned `runtimeAccess.enqueueFollowUp(runtime, work)` backed by a
  module-local `WeakMap`; `EventBus` is the production caller.
- Changed runtime close to reject external intake while draining but accept
  framework follow-up work from already-running runtime items, looping until the
  tail is quiescent.
- Changed `BoundedContext.close()` to drain `EventBus` before `CommandBus` so
  active event-bus work can post internal commands before the command bus closes.
- Stopped re-exporting generated registry record/registry contract types from
  the public server index and erased public ingestor/discovery generated
  registry signatures to `unknown`/`readonly unknown[]`.
- Added an internal package subpath,
  `@spine-ts/server/internal/generated-handler-registry`, for generated registry
  writer output and tooling-only type imports.
- Removed schema-bearing public overloads from `Assign`, `Command`,
  `Subscribe`, and `React`; added analyzer/public type regression coverage for
  bare-only app decorators.
- Updated `scripts/check-api-docs.mjs` so generated registry contract names and
  `SingleProcessServerRuntime.enqueueFollowUp` are forbidden in public TypeDoc.

## Regression Tests

- Runtime public/API and drain tests cover hidden follow-up scheduling and
  follow-ups appended during close.
- EventBus test covers stored follow-up dispatch scheduled by active event work
  while close is draining.
- BoundedContext/repository test covers event-side command reaction work posting
  internal commands during close.
- Public API tests cover hidden runtime follow-up method, internal generated
  registry imports, generated writer internal subpath output, and rejected
  schema-bearing decorator public calls.

## Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/runtime/runtime.test.ts packages/server/test/bus/event-bus.test.ts packages/server/test/handler/handler-decorators.test.ts packages/server/test/handler/generated-handler-registry.test.ts packages/server/test/handler/generated-registry-discovery.test.ts packages/server/test/handler/generated-registry-writer.test.ts packages/server/test/handler/build-time-handler-analyzer.test.ts packages/server/test/repository/repository-routing.test.ts packages/server/test/index.test.ts`:
  passed; 9 files, 207 tests.
- `pnpm --config.verify-deps-before-run=false typecheck:build:generated`:
  passed.
- `pnpm --config.verify-deps-before-run=false docs:check`: passed with the
  existing TypeDoc invalid `origin` remote warning only.
- `pnpm --config.verify-deps-before-run=false lint`: passed after local lint
  cleanup; includes proto generation, `tsc -b`, ESLint, and cleanup rules.
- `pnpm --config.verify-deps-before-run=false format:check`: passed after
  running formatter on local edits.
- `pnpm --config.verify-deps-before-run=false proto:check-generated`: passed.
- `git diff --check`: passed.

## Concerns

- Full `pnpm --config.verify-deps-before-run=false verify` was not run. The
  requested focused tests plus typecheck, docs check, lint, format check,
  generated-output check, and diff whitespace check all passed.
