# Implementation Report: T-0009f.2 Repository Identity And Entity Ownership Seam

Status: Round-12 Review Fixes Complete - Pending Re-review
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
  implementation uses a metadata-only runtime guard over same-realm ES class
  constructors plus constructor/prototype inheritance to infer family identity,
  without instantiating repositories or entities.
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
  infers the entity family from same-realm class constructor and instance
  prototype chains reaching `Aggregate`, `Projection`, or `ProcessManager`, and
  rejects unsupported constructors or schema-kind mismatches.
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
- Seventh-round review fixes reject prototype-reparented ES classes that do not
  declare a subclass relationship, make optional diagnostic reads exception-safe
  for accessor/proxy-backed `name` and `typeName` values, reject schema-union
  repository bindings, and add public-facing TypeDoc type-parameter notes for
  the single concrete constructor/state schema rule.
- Eighth-round review fixes guard `options.entityType` and `options.schema`
  property capture so throwing accessors or revoked proxies produce structured
  `RepositoryIdentityError` diagnostics, strengthen the declared-subclass check
  to require the class header to name the resolved built-in family base class,
  reject family-broad constructor aliases even when they carry a concrete state
  schema, and bind `RepositoryIdentitySnapshot` to the constructor-carried
  state schema.
- Ninth-round review fixes remove source-name parsing from entity family
  acceptance so aliased bases, namespace/member base expressions, and
  intermediate domain base classes are valid. The runtime now documents and
  tests the explicit same-realm metadata boundary: ES classes reparented onto a
  supported family prototype chain are trusted rather than rejected. A
  type-only inherited entity-constructor brand rejects manually spelled
  family-broad constructor aliases with real constructor parameters.
- Tenth-round review fixes replace the public string-keyed entity-constructor
  brand with a TypeScript-only protected constructor-side marker inherited from
  the entity base class. `RepositoryEntityType` now uses the built-in entity
  constructor marker rather than a caller-spellable string property, and
  public repository signatures use `ConcreteRepositoryEntityType` and
  `RepositoryStateSchema` instead of leading with private helper names.
- Tenth-round runtime hardening wraps entity family prototype-chain checks so
  hostile caller-controlled constructor/prototype chains return structured
  `RepositoryIdentityError` diagnostics instead of raw proxy/prototype errors.
- Tenth-round docs note that the repository identity seam follows Spine
  `core-jvm` `Repository` identity concepts closely while deferring runtime
  behavior.
- Eleventh-round review fixes make the inherited entity-constructor marker
  declaration-only so it does not emit a runtime static brand property, reshape
  `ConcreteRepositoryEntityType` around `never` invalid branches and
  `ConstructorParameters` so TypeDoc no longer renders diagnostic
  pseudo-properties or custom helper names, and expand the API-doc guard for
  those leaks.
- Eleventh-round reliability hardening captures the repository entity type
  display name once per validation failure path and reuses it for both the
  thrown message and structured details.
- Twelfth-round review fixes remove the `EntityConstructor` identifier from the
  repository public type signatures and generated TypeDoc output by renaming
  the inherited nominal marker base and using the neutral
  `EntityStaticMarkerBase` type in `RepositoryEntityType`.
- Twelfth-round tests now assert that the current declaration-only
  `spineTsEntityConstructor` marker is absent from aggregate, projection, and
  process-manager runtime constructor shapes.
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
- Round-7 RED: focused Vitest failed because a prototype-reparented ES class
  was accepted and throwing `name`/`typeName` accessors escaped structured
  diagnostics; `corepack pnpm typecheck:tooling` failed with unused
  `@ts-expect-error` directives for schema-union `RepositoryOptions` and
  `Repository` subclass bindings.
- Round-7 GREEN: focused Vitest passed with 2 files and 19 tests;
  `corepack pnpm typecheck:tooling` passed after adding the declared-subclass
  runtime guard, safe optional diagnostic reads, and the schema-union generic
  guard.
- Round-7 API docs guard: `node scripts/check-api-docs.mjs` passed and
  reported 87 expected `@spine-ts/server` exports.
- Round-7 full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 178 tests, coverage, docs check, proto lint/generate, and
  generated-clean.
- Round-8 RED: focused Vitest failed because a reparented unrelated subclass
  could still be accepted and throwing options accessors escaped raw errors;
  `corepack pnpm typecheck:tooling` failed on the old independent
  snapshot generic and unused `@ts-expect-error` directives for concrete-schema
  family-broad repository bindings.
- Round-8 GREEN: focused Vitest passed with 2 files and 20 tests;
  `corepack pnpm typecheck:tooling` passed after guarded option reads, the
  stronger declared-family-class-header check, the constructor-parameter
  erasure type guard, and the single-generic `RepositoryIdentitySnapshot`
  binding.
- Round-8 API docs guard: `node scripts/check-api-docs.mjs` passed and
  reported 87 expected `@spine-ts/server` exports.
- Round-8 full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 179 tests, coverage, docs check, proto lint/generate, and
  generated-clean.
- Round-9 RED: focused Vitest failed because aliased aggregate bases and
  same-realm reparented ES classes were rejected by source-name parsing;
  `corepack pnpm typecheck:tooling` failed with unused `@ts-expect-error`
  directives for manually spelled family-broad constructor aliases with real
  constructor parameters.
- Round-9 GREEN: focused Vitest passed with 2 files and 22 tests;
  `corepack pnpm typecheck:tooling` passed after removing the source-name
  subclass parser and adding the inherited entity-constructor type brand.
- Round-9 API docs guard: `node scripts/check-api-docs.mjs` passed and
  reported 87 expected `@spine-ts/server` exports.
- Round-9 full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 181 tests, coverage, docs check, proto lint/generate, and
  generated-clean.
- Round-10 RED: focused Vitest failed because a hostile static prototype chain
  escaped as a raw error; `corepack pnpm typecheck:tooling` failed with unused
  `@ts-expect-error` directives proving callers could still spell the old
  public string brand in a manually shaped constructor alias.
- Round-10 GREEN: focused Vitest passed with 2 files and 23 tests;
  `corepack pnpm typecheck:tooling` passed after replacing the string brand
  with the protected built-in entity constructor marker and wrapping family
  inheritance checks.
- Round-10 API docs guard: `node scripts/check-api-docs.mjs` passed and now
  also rejects the old internal repository helper names and old public string
  brand from TypeDoc JSON.
- Round-10 full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 182 tests, coverage, docs check, proto lint/generate, and
  generated-clean.
- Round-11 RED: focused Vitest failed because the constructor marker was
  observable at runtime and volatile entity-type names differed between message
  and details; `node scripts/check-api-docs.mjs` failed after adding guards for
  `BuiltInEntityConstructor`, `BuiltInEntityConstructorBase`,
  `HasErasedRepositoryConstructorParameters`, and the repository diagnostic
  pseudo-property names.
- Round-11 GREEN: focused Vitest passed with 2 files and 25 tests;
  `corepack pnpm typecheck:tooling` passed after the marker/type reshaping and
  redundant schema-side `@ts-expect-error` comments were removed.
- Round-11 API docs guard: `node scripts/check-api-docs.mjs` passed and now
  rejects the round-11 leaked names plus replacement constraint-marker names
  from TypeDoc JSON.
- Round-11 full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 184 tests, coverage, docs check, proto lint/generate, and
  generated-clean.
- Round-12 RED: `node scripts/check-api-docs.mjs` failed after adding
  `EntityConstructor` to the forbidden TypeDoc-name guard, proving the current
  generated JSON still exposed the old nominal base name.
- Round-12 GREEN: focused Vitest passed with 2 files and 25 tests;
  `corepack pnpm typecheck:tooling` passed after the nominal marker base was
  renamed and repository signatures stopped referencing `typeof
EntityConstructor`.
- Round-12 API docs guard: `node scripts/check-api-docs.mjs` passed and now
  rejects `EntityConstructor` from TypeDoc JSON.
- Round-12 full verification: `CI=true corepack pnpm verify` passed with 17
  test files, 184 tests, coverage, docs check, proto lint/generate, and
  generated-clean.

## Review

- First-, second-, third-, fourth-, fifth-, sixth-, seventh-, eighth-, ninth-,
  tenth-, eleventh-, and twelfth-round reviewer findings were applied by review-fix
  sub-agents.
  Re-review by the orchestrator lanes remains pending.
