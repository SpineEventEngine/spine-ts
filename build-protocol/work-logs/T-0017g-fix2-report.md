# T-0017g Second Fix Report

Status: `DONE`

## Files Changed

- `packages/server/src/context/bounded-context.ts`
- `packages/server/src/context/process-manager-handoff.ts`
- `packages/server/src/repository/repository.ts`
- `docs/api/README.md`
- `packages/server/README.md`

## Fix Summary

- Moved the local process-manager inbox handoff implementation and its helper
  logic out of `bounded-context.ts` into
  `packages/server/src/context/process-manager-handoff.ts`, leaving
  `BoundedContext` responsible only for constructing the handoff object and
  registering repository replay targets.
- Shortened the repository-local inbox/replay vocabulary to fit the semantic
  name limit, including `ProcessManagerInboxTarget`, `createInboxTarget()`,
  `validateReplayTenant()`, and `validateReplayTarget()`.
- Updated `docs/api/README.md` and `packages/server/README.md` so they describe
  the current boundary accurately: framework-owned durable inbox handoff exists
  for process-manager command replay, while broader delivery lifecycle
  management remains deferred.

## Verification

- `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts` - passed (`107` tests)
- `pnpm --config.verify-deps-before-run=false format:check` - passed
- `git diff --check` - passed
- `pnpm --config.verify-deps-before-run=false docs:check` - passed (TypeDoc completed with the pre-existing `origin` remote warning only)
- Final name cleanup applied: `repositoryProcessManagerInboxTargets` is now `repositoryPmInboxTargets` in `packages/server/src/repository/repository.ts`. Commands used: `pnpm --config.verify-deps-before-run=false exec vitest run packages/server/test/repository/repository-routing.test.ts`, `pnpm --config.verify-deps-before-run=false format:check`, `git diff --check`.

## Concerns

- The durable handoff remains intentionally narrow. This fix does not expand
  scheduler/retry behavior, worker loops, or cross-process recovery beyond the
  existing process-manager command replay path.
