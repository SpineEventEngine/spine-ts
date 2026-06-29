# T-0009c.1 Implementation Report

Status: DONE

Authoring sub-agent: `019f1368-7ce7-75b3-90e6-b20e86b54e1b`

Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009c1-decorator-metadata-collection`

Branch: `task/T-0009c1-decorator-metadata-collection`

Baseline before implementation: `722a192`

## Summary

Implemented the first `@spine-ts/server` TypeScript 5+ standard method
decorator adapter for handler metadata collection.

Public additions:

- `@Assign(schema)`
- `@Command(schema)`
- `@Subscribe(schema)`
- `@React(schema)`
- `@Apply(schema, options?)`
- `HandlerMethodDecorator`
- `HandlerMethodValue`
- `materializeDecoratedEntityHandlers(entityType, stateSchema)`

Decorators require explicit generated Protobuf-ES schemas and collect metadata
only. `materializeDecoratedEntityHandlers()` materializes the requested entity
class's decorator records after confirming the recorded handler names are still
own prototype methods, and returns the same frozen `EntityHandlersMetadata`
shape produced by `defineEntityHandlers()` and accepted by
`HandlerMetadataRegistry`.

No handler invocation, entity instantiation, storage, buses, repositories,
transactions, gRPC, ZeroMQ, `reflect-metadata`, `emitDecoratorMetadata`,
parameter decorators, inferred message metadata, or global handler registry was
added.

## Files Changed

- `packages/server/src/handler-decorators.ts`
- `packages/server/src/handler-decorators.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `scripts/check-api-docs.mjs`
- `tsconfig.base.json`
- `build-protocol/tasks/T-0009c1-decorator-metadata-collection/TASK.md`
- `build-protocol/tasks/T-0009c1-decorator-metadata-collection/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009c1.md`
- `build-protocol/reviews/T-0009c1-decorator-metadata-collection.md`

## TDD Evidence

- RED: `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  failed on `2026-06-29 13:48 WEST` with five expected failures because
  `Assign` was not yet implemented/exported.
- GREEN: `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  passed on `2026-06-29 13:50 WEST`: 1 test file / 5 tests passed.
- Focused decorator/export check:
  `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 13:52 WEST`: 2 test files / 14 tests passed.

The decorator tests compile a tiny TypeScript source fixture containing real
standard decorator syntax with the repo's TypeScript dependency, then import the
compiled module and exercise the real public decorator functions. This avoids
mocking and proves decorator behavior without changing the Vitest transform
pipeline.

Covered behavior:

- deterministic declaration order;
- all five decorator kinds;
- `@Apply(..., { allowImport: true })`;
- materialization into `EntityHandlersMetadata`;
- registration and lookup through `HandlerMetadataRegistry`;
- class-owned isolation/no default registry leakage;
- duplicate-policy parity with explicit metadata;
- explicit `defineEntityHandlers()` fallback parity.

## Verification Evidence

- `corepack pnpm typecheck` passed on `2026-06-29 13:53 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-29 13:52 WEST` with the known
  TypeDoc invalid-origin warning.
- First `CI=true corepack pnpm verify` failed at lint on
  `2026-06-29 13:53 WEST`; lint reported unnecessary decorator-factory generics
  and a redundant `context.kind` check. Both were removed.
- Final `CI=true corepack pnpm verify` passed on `2026-06-29 13:56 WEST`:
  - 12 test files / 80 tests passed;
  - coverage statements 98.89%;
  - coverage branches 91.42%;
  - coverage functions 100%;
  - coverage lines 98.86%;
  - docs/API checks passed with the known TypeDoc invalid-origin warning;
  - proto lint/generate and generated-output cleanliness checks passed.

## Decisions

No meaningful change to D-0037 was discovered. The implementation follows the
accepted decision: decorators are metadata-only adapters over the explicit
handler registration contract, with `defineEntityHandlers()` preserved as the
canonical fallback.

## Concerns And Follow-Up

- Reviewer sub-agents were not spawned by this implementation sub-agent because
  the handoff explicitly said not to spawn sub-agents. Round 1 review found the
  original module-private method-function `WeakMap` was not truly class-owned
  when decorated methods were copied between prototypes.
- The Round 1 fix replaces that storage with standard per-class decorator
  metadata and adds copied-method regression coverage. Re-review is the next
  protocol step.
