# T-0009c.1 Round 2 Fix Report

Status: ready for re-review

Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009c1-decorator-metadata-collection`

Branch: `task/T-0009c1-decorator-metadata-collection`

Implementation commit under review: `39008b7`

Round 1 fix commit: `f84ca92`

Round 2 fix commit: `e480a33`

## Findings Addressed

- P2 maintainability: `readClassDecoratorMetadata()` read inherited
  `Symbol.metadata` via normal property lookup, allowing an undecorated subclass
  override with the same method name to borrow base-class handler metadata.
- P3 documentation/logs: `TASK.md` coverage values still reflected pre-Round 1
  final verification numbers.

## Fix Summary

- Added a regression test for a decorated base class and an undecorated subclass
  that overrides the same handler method name. The subclass must materialize no
  handlers.
- Changed `readClassDecoratorMetadata()` to read only the requested entity
  constructor's own `Symbol.metadata` property descriptor before consuming
  decorator records.
- Updated `TASK.md` coverage to the Round 1 final verification evidence: 12
  test files / 82 tests, statements 98.72%, branches 91.16%, functions 100%,
  and lines 98.69%.

The fix preserves the metadata-only boundary: no handler invocation, entity
instantiation, storage, buses, repositories, transactions, runtime dispatch,
gRPC, ZeroMQ, `reflect-metadata`, `emitDecoratorMetadata`, or parameter
decorators were added.

## TDD Evidence

- RED `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  failed on `2026-06-29 14:26 WEST` with the expected subclass override
  metadata borrowing assertion.
- GREEN
  `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  passed on `2026-06-29 14:26 WEST`: 1 test file / 8 tests.

## Verification Evidence

- `corepack pnpm typecheck` passed on `2026-06-29 14:27 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-29 14:27 WEST` with the known
  TypeDoc invalid-origin warning.
- First `CI=true corepack pnpm verify` failed at lint because
  `Object.getOwnPropertyDescriptor().value` is typed as `any`.
- After adding explicit `unknown` narrowing, focused GREEN
  `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  passed again on `2026-06-29 14:28 WEST`: 1 test file / 8 tests.
- Final `CI=true corepack pnpm verify` passed on
  `2026-06-29 14:29 WEST`:
  - 12 test files / 83 tests passed;
  - coverage statements 98.72%;
  - coverage branches 91.16%;
  - coverage functions 100%;
  - coverage lines 98.69%;
  - docs/API checks passed with the known TypeDoc invalid-origin warning;
  - proto lint/generate and generated-output cleanliness checks passed.

## Files Changed

- `packages/server/src/handler-decorators.ts`
- `packages/server/src/handler-decorators.test.ts`
- `build-protocol/tasks/T-0009c1-decorator-metadata-collection/TASK.md`
- `build-protocol/tasks/T-0009c1-decorator-metadata-collection/ROUND2_FIX_REPORT.md`
- `build-protocol/work-logs/T-0009c1.md`
- `build-protocol/reviews/T-0009c1-decorator-metadata-collection.md`

## Next Step

Round 2 fix was committed as `e480a33` with log commit `e5e4f66`. Round 3
requested a final audit-log wording cleanup, which was applied in `444623c` and
is ready for re-review.
