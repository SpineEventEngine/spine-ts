# Implementation Report: T-0009f.2 Repository Identity And Entity Ownership Seam

Status: Review Fixes Complete - Pending Re-review
Task log: `build-protocol/tasks/T-0009f2-repository-identity-seam/TASK.md`
Work log: `build-protocol/work-logs/T-0009f2.md`
Review log: `build-protocol/reviews/T-0009f2-repository-identity-seam.md`

## Summary

Implemented the metadata-only repository identity seam from baseline
`a6e72be`. The TypeScript surface now records one entity constructor, the
inferred aggregate/projection/process-manager family, one matching
descriptor-backed entity state schema, descriptor metadata, state full type
name, and ID-field metadata. It leaves storage, routing, dispatch, inboxes,
caches, lifecycle, stand, context registration execution, buses, transport, and
gRPC to later subtasks.

## JVM Research Used

Implementation research inspected and used:

- `Repository.java`: model-class identity, `idClass()`, `entityClass()`,
  `entityStateType()`, one-context registration, and storage/open lifecycle.
  The TypeScript seam kept only identity metadata and did not port
  `registerWith()`, `open()`, `storage()`, routing helpers, or lifecycle hooks.
- `RecordBasedRepository.java`: entity-record persistence is a subclass/runtime
  concern and must stay out of this subtask. Its `create`, `find`, `store`,
  converter, query, migration, and record-storage methods remained out of
  scope.
- `DefaultRepository.java`: family-based default repository selection is a
  convenience seam, not an invitation to build runtime repositories now. The TS
  implementation uses constructor prototype inheritance only to infer family
  identity.
- `AggregateRepository.java`, `ProjectionRepository.java`, and
  `ProcessManagerRepository.java`: routing, inbox, cache, dispatch, catch-up,
  import, command bus, event bus, and query behavior are concrete repository
  runtime behavior and out of scope for this subtask.
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` and
  `spine-jvm-docs/spine-entities-repositories-and-state.md`: bounded context
  registration and repository runtime wiring are future tasks.

## Implementation Notes

- Added `packages/server/src/repository.ts` with `Repository`,
  `RepositoryOptions`, `RepositoryEntityType`, `RepositoryIdentitySnapshot`,
  `RepositoryIdentityError`, and structured error detail/code exports.
- `Repository` derives descriptor metadata through `describeEntityMetadata()`,
  infers the entity family from `Aggregate`, `Projection`, or `ProcessManager`
  prototype inheritance, and rejects unsupported constructors or schema-kind
  mismatches.
- `snapshot` returns frozen fresh-copy metadata suitable for later
  bounded-context duplicate/conflict checks.
- First-round review fixes removed base-instance freezing so repository
  subclasses can initialize fields after `super(...)`, tightened
  `RepositoryOptions` so TypeScript callers must pair entity constructors with
  the constructor-carried state schema, and kept runtime structured errors for
  JavaScript/cast inputs.
- Public root exports, TypeDoc export guard, package README, API docs, user
  guide, and architecture notes now describe the metadata-only boundary.

## Verification

- RED: `corepack pnpm exec vitest run --passWithNoTests packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  failed as expected before production code because `Repository` was not a
  constructor and root exports lacked `Repository`/`RepositoryIdentityError`.
- GREEN: `corepack pnpm exec vitest run --passWithNoTests packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed with 2 files and 13 tests.
- API docs guard: `node scripts/check-api-docs.mjs` passed and reported 87
  expected `@spine-ts/server` exports.
- Full verification: `CI=true corepack pnpm verify` passed with 17 test files,
  172 tests, coverage, docs check, proto lint/generate, and generated-clean.
- Review-fix RED: focused Vitest failed while `Repository` froze the base
  instance and `corepack pnpm typecheck:tooling` failed with unused
  `@ts-expect-error` directives for mismatched repository entity/schema pairs.
- Review-fix GREEN: focused Vitest, `corepack pnpm typecheck:build`, and
  `corepack pnpm typecheck:tooling` passed after the fixes.
- Review-fix full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 174 tests, coverage, docs check, proto lint/generate, and
  generated-clean.

## Review

- First-round reviewer findings were applied by the review-fix sub-agent.
  Re-review by the orchestrator lanes remains pending.
