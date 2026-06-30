# Implementation Report: T-0009f.2 Repository Identity And Entity Ownership Seam

Status: Round-6 Review Fixes Complete - Pending Re-review
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
- Second-round review fixes made bare `RepositoryOptions` annotations invalid
  so callers cannot erase the constructor-carried schema constraint, added an
  early runtime function/class-constructor guard for forged entity-type objects,
  and refreshed stale architecture wording around the now-present
  metadata-only `Repository` identity class.
- Third-round review fixes made malformed nameless entity-type diagnostics
  consistently produce `RepositoryIdentityError`, captured `entityType` and
  `schema` once at constructor entry before validation/storage, and added an
  abstract construct signature to `RepositoryEntityType` so non-function object
  literals no longer type-check.
- Fourth-round review fixes added an early non-null options-object guard before
  reading `options.entityType`/`options.schema`, removed the broad default
  generic from `Repository`, required subclasses to bind their entity
  constructor type explicitly, and refreshed user-guide status wording for the
  repository identity seam.
- Fifth-round review fixes resolve entity family before schema introspection,
  require both constructor/static and prototype inheritance for family
  detection, wrap malformed supported-entity schemas in
  `RepositoryIdentityError`, and reject broad or union repository generics for
  both `RepositoryOptions` and subclasses.
- Sixth-round review fixes add an ES class constructor check so ordinary
  functions cannot spoof both static and instance entity family inheritance,
  and reject family-specific repository generic bindings whose extracted state
  schema is still broad `DescriptorMessageSchema`.
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
- Round-2 RED: focused Vitest failed because a forged non-function
  `{ name, prototype }` object was accepted as an aggregate repository entity
  type; `corepack pnpm typecheck:tooling` failed with an unused
  `@ts-expect-error` for annotated bare `RepositoryOptions` schema erasure.
- Round-2 GREEN: focused Vitest passed with 2 files and 15 tests;
  `corepack pnpm typecheck:tooling` passed after removing the default
  `RepositoryOptions` generic and adding the runtime constructor guard.
- Round-2 full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 174 tests, coverage, docs check, proto lint/generate, and
  generated-clean.
- Round-3 RED: focused Vitest failed because malformed entity types threw
  `TypeError` and accessor-backed options could produce a validated/stored
  constructor divergence; `corepack pnpm typecheck:tooling` failed with an
  unused `@ts-expect-error` for a non-function object-literal entity type.
- Round-3 GREEN: focused Vitest passed with 2 files and 17 tests;
  `corepack pnpm typecheck:tooling` passed after capturing constructor inputs
  once, hardening entity-type names for unknown values, and adding the
  construct signature to `RepositoryEntityType`.
- Round-3 API docs guard: `node scripts/check-api-docs.mjs` passed and
  reported 87 expected `@spine-ts/server` exports.
- Round-3 full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 176 tests, coverage, docs check, proto lint/generate, and
  generated-clean.
- Round-4 RED: focused Vitest failed because `new Repository(null as any)`
  threw `TypeError` instead of `RepositoryIdentityError`; tooling typecheck
  failed with an unused `@ts-expect-error` because `extends Repository` still
  type-checked without a bound entity constructor.
- Round-4 GREEN: focused Vitest passed with 2 files and 18 tests;
  `corepack pnpm typecheck:tooling` passed after guarding options before
  dereference and removing the default `Repository` generic.
- Round-4 API docs guard: `node scripts/check-api-docs.mjs` passed and
  reported 87 expected `@spine-ts/server` exports.
- Round-4 full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 177 tests, coverage, docs check, proto lint/generate, and
  generated-clean.
- Round-5 RED: focused Vitest failed because unsupported entity classes and
  supported entities with malformed schemas could throw raw `TypeError` from
  schema introspection; `corepack pnpm typecheck:tooling` failed with unused
  `@ts-expect-error` directives for broad/union `RepositoryOptions` and
  subclass generics.
- Round-5 GREEN: focused Vitest passed with 2 files and 19 tests;
  `corepack pnpm typecheck:tooling` passed after moving family resolution
  before schema introspection, adding static constructor-chain checks, wrapping
  malformed supported schemas, and rejecting broad/union repository generic
  bindings.
- Round-5 API docs guard: `node scripts/check-api-docs.mjs` passed and
  reported 87 expected `@spine-ts/server` exports.
- Round-5 full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 178 tests, coverage, docs check, proto lint/generate, and
  generated-clean.
- Round-6 RED: focused Vitest failed because an ordinary function with both
  `Object.setPrototypeOf(Forged, Aggregate)` and
  `Object.setPrototypeOf(Forged.prototype, Aggregate.prototype)` was accepted;
  `corepack pnpm typecheck:tooling` failed with unused `@ts-expect-error`
  directives for family-broad `RepositoryOptions` and `Repository` subclass
  bindings.
- Round-6 GREEN: focused Vitest passed with 2 files and 19 tests;
  `corepack pnpm typecheck:tooling` passed after adding the class-constructor
  guard and broad extracted-schema generic guard.
- Round-6 API docs guard: `node scripts/check-api-docs.mjs` passed and
  reported 87 expected `@spine-ts/server` exports.
- Round-6 full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 178 tests, coverage, docs check, proto lint/generate, and
  generated-clean.

## Review

- First-, second-, third-, fourth-, fifth-, and sixth-round reviewer findings were applied by review-fix
  sub-agents.
  Re-review by the orchestrator lanes remains pending.
