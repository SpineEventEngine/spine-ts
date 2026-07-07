# T-0015b Implementer Report

Status: DONE

## Summary

Implemented the framework-owned generated handler registry ingestion API for
T-0015b. The new API defines a version-1 generated registry contract with entity
groups, handler records, `methodName`, `signalSchema`, `emittedSchemas`, and
`parameterCount: 1 | 2`. `HandlerRegistryIngestor` converts generated records
through `defineEntityHandlers()` and can register the resulting
`EntityHandlersMetadata` into `HandlerMetadataRegistry`.

The implementation rejects unsupported registry versions, generated
`event-application` records, invalid public arity, empty emitted schemas for
emitting handler kinds, and emitted schemas on event subscriptions. Method-name
validation stays in `defineEntityHandlers()`, and duplicate command assignment
validation stays in `HandlerMetadataRegistry`.

No analyzer, package generator, automatic runtime discovery, to-do migration,
handler invocation behavior, or generated files were added.

## Changed Files

- `packages/server/src/handler/generated-handler-registry.ts`
- `packages/server/test/handler/generated-handler-registry.test.ts`
- `packages/server/src/index.ts`
- `packages/server/test/index.test.ts`
- `packages/server/README.md`
- `scripts/check-api-docs.mjs`
- `build-protocol/tasks/T-0015b-registry-ingestion-api/TASK.md`
- `build-protocol/work-logs/T-0015b.md`
- `build-protocol/reviews/T-0015b-registry-ingestion-api.md`
- `build-protocol/work-logs/T-0015b-implementer-report.md`

## Verification

- `corepack pnpm vitest run packages/server/test/handler/generated-handler-registry.test.ts`
  - Exit status: 0
  - Result: 1 test file, 9 tests passed.
- `corepack pnpm typecheck:build`
  - Exit status: 0
- `corepack pnpm docs:check`
  - Exit status: 0
  - Note: TypeDoc reported the existing invalid `origin` source-link warning.
- `corepack pnpm lint`
  - Exit status: 0
- `corepack pnpm format:check`
  - Exit status: 0
- `git diff --check`
  - Exit status: 0

## Concerns

- None blocking.
- Automatic discovery/loading of generated registries remains deferred by task
  boundary.

## Review Round 1 Fix Report

Status: DONE

Fixed the round-1 review findings without expanding the task boundary.

- Reliability P1: `HandlerRegistryIngestor.register()` now materializes the
  generated metadata, preflights the complete target state in a scratch
  `HandlerMetadataRegistry`, and mutates the caller-owned registry only after
  validation succeeds. Added a regression test proving a failed duplicate does
  not leave earlier generated metadata registered.
- Security Medium: generated `stateSchema`, handler `signalSchema`, and every
  `emittedSchemas` item are validated before canonical metadata creation. The
  check stays small and rejects non-object schemas plus missing, empty, or
  whitespace-only `typeName` values.
- TS/API P1: top-level `GeneratedHandlerRegistry.entities` now accepts
  type-erased `GeneratedEntityHandlerGroup` values, while concrete
  `GeneratedEntityHandlers<ConcreteEntity>` groups preserve method-name typing
  for generated code. Export expectations and public export tests were updated.
- JVM/ADR P1: generated `event-reaction` records may now declare zero emitted
  schemas. Non-empty emitted schemas remain required for command assignments and
  command reactions, and event subscriptions still reject emitted schemas.
  README language was updated to avoid implying all `@React` handlers emit
  events.

### Round 1 Verification

- `corepack pnpm vitest run packages/server/test/handler/generated-handler-registry.test.ts packages/server/test/handler/handler-metadata.test.ts packages/server/test/index.test.ts`
  - Exit status: 0
  - Result: 3 test files, 35 tests passed.
- `corepack pnpm typecheck:build`
  - Exit status: 0
- `corepack pnpm docs:check`
  - Exit status: 0
  - Note: TypeDoc reported the existing invalid `origin` source-link warning.
- `corepack pnpm lint`
  - Exit status: 0
- `corepack pnpm format:check`
  - Exit status: 0
- `git diff --check`
  - Exit status: 0

### Round 1 Concerns

- None blocking.
- Automatic generated-registry discovery/loading remains deferred by task
  boundary.
