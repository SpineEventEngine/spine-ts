# T-0009c.1 Round 1 Fix Report

Status: ready for re-review

Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009c1-decorator-metadata-collection`

Branch: `task/T-0009c1-decorator-metadata-collection`

Authoring sub-agent: `019f1368-7ce7-75b3-90e6-b20e86b54e1b`

Implementation commit under review: `39008b7`

Fix commit: `f84ca92`

## Findings Addressed

- P1 TypeScript/API: `HandlerMethodDecorator` and `HandlerMethodValue` were too
  narrow for normally typed handler methods under strict TypeScript.
- P2 maintainability/reliability: method-function-keyed decorator metadata
  could be borrowed when a decorated method function was copied onto another
  prototype.
- P3 durable logs: task/work/review logs had stale authoring-agent and next-step
  markers.

## Fix Summary

- Added semantic TypeScript coverage using the repo compiler API so typed
  decorated handlers are checked by `tsc` semantics instead of
  `transpileModule()`.
- Made public decorator method types generic over handler `this`, parameter
  tuple, and return value.
- Replaced module-private method-function `WeakMap` storage with standard
  per-class decorator metadata. The module installs a `Symbol.metadata` runtime
  fallback for current Node support, then records handler declarations on the
  class metadata object produced by TypeScript standard decorators.
- Kept materialization metadata-only: no handler invocation, no entity
  instantiation, no global handler registry, and no runtime dispatch. During
  materialization, recorded handler names are confirmed against the requested
  entity class's own prototype methods before passing through
  `defineEntityHandlers()`.
- Preserved `defineEntityHandlers()` fallback and `HandlerMetadataRegistry`
  compatibility.
- Updated docs and durable logs to describe standard per-class metadata and the
  Round 1 fix state.

## TDD Evidence

- RED `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  failed with two expected failures:
  - semantic TypeScript reported TS1241 because `(command: CreateTask) => void`
    was not assignable to the old `HandlerMethodValue`;
  - copied method materialization returned the source class's `assignCreate`
    metadata for the borrowing class.
- GREEN `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  passed on `2026-06-29 14:13 WEST`: 1 test file / 7 tests.

## Verification Evidence

- `corepack pnpm typecheck` passed on `2026-06-29 14:14 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-29 14:14 WEST` with the known
  TypeDoc invalid-origin warning.
- `CI=true corepack pnpm verify` passed on `2026-06-29 14:14 WEST`:
  - 12 test files / 82 tests passed;
  - coverage statements 98.72%;
  - coverage branches 91.16%;
  - coverage functions 100%;
  - coverage lines 98.69%;
  - docs/API checks passed with the known TypeDoc invalid-origin warning;
  - proto lint/generate and generated-output cleanliness checks passed.

## Files Changed

- `packages/server/src/handler-decorators.ts`
- `packages/server/src/handler-decorators.test.ts`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `build-protocol/tasks/T-0009c1-decorator-metadata-collection/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0009c1-decorator-metadata-collection/TASK.md`
- `build-protocol/tasks/T-0009c1-decorator-metadata-collection/ROUND1_FIX_REPORT.md`
- `build-protocol/work-logs/T-0009c1.md`
- `build-protocol/reviews/T-0009c1-decorator-metadata-collection.md`

## Next Step

Re-run all five reviewer roles against the Round 1 fix range.
