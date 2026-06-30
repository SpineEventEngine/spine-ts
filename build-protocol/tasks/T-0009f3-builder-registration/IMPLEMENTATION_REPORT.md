# Implementation Report: T-0009f.3 Builder Repository Registration And Conflict Checks

Status: Integrated Into Parent; Parent Verification Passed
Task log: `build-protocol/tasks/T-0009f3-builder-registration/TASK.md`
Work log: `build-protocol/work-logs/T-0009f3.md`
Review log: `build-protocol/reviews/T-0009f3-builder-registration.md`

## Summary

Added metadata-only repository registration to `BoundedContextBuilder`.
Builders now accept explicit `Repository` identity objects through
`add(repository)` and `remove(repository)`, expose frozen fresh-copy repository
identity snapshots, and build `BoundedContext` snapshots that include the
repository identities present at build time.

## JVM Research Used

Setup research refreshed:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, especially
  bounded-context builder add/remove APIs and runtime build sequence.
- `spine-jvm-docs/spine-entities-repositories-and-state.md`, especially
  repository lifecycle owner behavior and default repository factory notes.
- Current TypeScript `packages/server/src/bounded-context.ts` and
  `packages/server/src/repository.ts`.

Implementation sub-agent inspected the task-relevant JVM source files listed in
the task log before production code changes.

Impact:

- `BoundedContextBuilder.java` shaped the public `add(repository)` /
  `remove(repository)` API and the builder-owned registration list.
- `BoundedContext.java` showed that duplicate state ownership fails during
  runtime registration in the JVM. This TypeScript slice moves the check
  earlier into metadata registration for deterministic feedback.
- `Repository.java` shaped the identity fields copied into snapshots:
  constructor identity, entity family, state schema/type name, metadata, and ID
  field.
- `DefaultRepository.java` confirmed default repository construction would pull
  in runtime repository implementations, so `add(entityClass)` remains deferred.
- The two `spine-jvm-docs` notes confirmed storage opening, stand/type-supplier
  registration, runtime repository registration, buses, system context,
  handler invocation, routing, inboxes, transport, and lifecycle callbacks are
  out of scope.

## Implementation Notes

- Duplicate registration of the same repository identity is idempotent.
- A single entity constructor cannot be registered with a different state schema
  identity.
- A single state type cannot be claimed by multiple entity constructors.
- `BoundedContextRepositoryRegistrationError` reports stable conflict codes and
  structured existing/incoming ownership details.
- Malformed or unreadable repository snapshot metadata is wrapped in
  `BoundedContextRepositoryRegistrationError` with
  `INVALID_REPOSITORY_SNAPSHOT` rather than leaking raw subclass/accessor
  exceptions.
- Conflict diagnostics read entity constructor names through a safe fallback,
  so hostile or non-string `name` accessors report `(anonymous)` instead of
  leaking raw errors.
- Public docs and `scripts/check-api-docs.mjs` were updated for the new API
  surface.
- The repository registration error branch detail types and registration
  operation type are public exports, so the emitted `.d.ts` and TypeDoc API
  surface no longer reference private branch names.
- Repository snapshot cloning validates `metadata.columns` and
  `metadata.setOnceFields` with `Array.isArray()` and index-based loops to
  avoid trusting caller-controlled array helpers.
- Repository snapshot metadata field-list cloning and validation reject sparse
  arrays with missing own indices before cloning or validating each field, so
  hostile snapshots cannot hide absent column or set-once field metadata in
  array holes.
- Repository snapshot cloning and validation require `metadata.semanticTags` to
  be a real array whose entries are strings, rejecting non-array iterables,
  sparse arrays, and non-string entries as malformed repository snapshots.
- Repository snapshot cloning and validation require `metadata.semanticTags`
  entries to be non-empty canonical strings that do not need trimming, matching
  the descriptor-derived semantic-tag boundary for hostile snapshot input.
- Repository snapshot cloning and validation require `metadata.semanticTags`
  entries to be deduplicated and sorted, matching descriptor-derived canonical
  tag ordering from `entity-metadata.ts`.
- Repository snapshot validation directly verifies
  `stateSchema.typeName === stateFullTypeName`, so hostile snapshots cannot
  forge `stateFullTypeName` and `metadata.fullTypeName` while retaining a
  different schema object.
- Repository snapshot validation verifies `entityType` is a supported
  Aggregate/Projection/ProcessManager class and that the inferred family
  matches `snapshot.entityFamily`, so hostile snapshots cannot substitute an
  arbitrary function or cross-family constructor.
- Repository snapshot validation reuses the repository module's shared
  internal entity-family resolver, avoiding duplicate constructor/family
  inheritance checks in bounded-context registration.
- Repository snapshot cloning and validation share one semantic-tag helper that
  validates and returns a dense canonical string array before freezing clones.
- Repository snapshot validation derives trusted metadata from `stateSchema`
  with `describeEntityMetadata()` and verifies the descriptor-derived schema
  kind matches `snapshot.entityFamily`, so hostile snapshots cannot forge
  self-consistent `metadata.kind` values around a different descriptor kind.
- `BoundedContextBuilder.build()` no longer pre-clones repository snapshots
  before constructing `BoundedContext`; constructor validation performs the
  defensive copy once, and context snapshot freezing preserves already
  validated/frozen child snapshots instead of cloning them again.
- The implementation remains metadata-only: it does not create/find/store
  entities, open storage, register repositories in a runtime context, register
  type suppliers with a stand, route messages, invoke handlers, write inboxes,
  construct buses, start transport, or create system contexts.

## Verification

- Baseline focused verification before source changes:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  failed before implementation because `@spine-ts/proto` package `dist` output
  had not been built for the worktree; existing `bounded-context.test.ts`
  alone passed 8 tests.
- RED:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  failed with five expected `builder.add is not a function` failures after the
  repository registration tests were added.
- GREEN focused bounded-context:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  passed 13 tests.
- Focused server test trio:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 38 tests after export expectations were updated.
- `corepack pnpm typecheck:build` passed after the implementation.
- Required focused verification:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 3 test files and 38 tests.
- `corepack pnpm typecheck:tooling` passed.
- `node scripts/check-api-docs.mjs` passed. TypeDoc emitted one source-link
  warning because the local `origin` remote is not valid; the API JSON guard
  passed.
- Full verification:
  `CI=true corepack pnpm verify` passed. Evidence: node version check,
  `tsc -b`, tooling typecheck, ESLint, Prettier check, 17 Vitest files / 189
  tests, coverage, TypeDoc/API guard, proto lint, proto generate, and generated
  clean check all completed successfully.
- Review-fix RED:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  failed with three expected raw-error leaks: unreadable repository snapshots,
  malformed repository snapshot metadata, and hostile entity constructor
  `name` accessors.
- Review-fix GREEN:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  passed 16 tests after adding snapshot validation/wrapping and safe conflict
  names. The previous report entry that said 20 tests was incorrect for this
  bounded-context-only GREEN run; the durable work log and test file reflected
  16 tests at that point.
- Review-fix required focused verification:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 3 test files and 45 tests.
- Review-fix `corepack pnpm typecheck:tooling` passed.
- Review-fix `node scripts/check-api-docs.mjs` passed. TypeDoc emitted one
  source-link warning because the local `origin` remote is not valid; the API
  JSON guard passed.
- Review-fix full verification:
  `CI=true corepack pnpm verify` passed. Evidence: node version check,
  `tsc -b`, tooling typecheck, ESLint, Prettier check, 17 Vitest files / 196
  tests, coverage over thresholds, TypeDoc/API guard, proto lint, proto
  generate, and generated-clean completed successfully.
- Round-2 metadata-list RED:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  failed with two expected failures because non-array `metadata.columns` and
  `metadata.setOnceFields` values could bypass validation.
- Round-2 type-export RED:
  `corepack pnpm typecheck:tooling` failed because the root server export did
  not expose
  `BoundedContextRepositoryRegistrationConflictErrorDetails`,
  `BoundedContextRepositoryRegistrationOperation`, or
  `BoundedContextRepositorySnapshotErrorDetails`.
- Round-2 bounded-context GREEN:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  passed 22 tests after adding array validation and clone reduction.
- Round-2 `corepack pnpm typecheck:tooling` passed after exporting the public
  branch detail and operation types.
- Round-2 `node scripts/check-api-docs.mjs` passed. TypeDoc emitted one
  source-link warning because the local `origin` remote is not valid; the API
  JSON guard passed with 96 expected `@spine-ts/server` exports.
- Round-2 required focused verification:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 3 test files and 47 tests.
- Round-2 `corepack pnpm typecheck:tooling` passed.
- Round-2 `node scripts/check-api-docs.mjs` passed. TypeDoc emitted one
  source-link warning because the local `origin` remote is not valid; the API
  JSON guard passed with 96 expected `@spine-ts/server` exports.
- Round-2 full verification:
  `CI=true corepack pnpm verify` passed. Evidence: node version check,
  `tsc -b`, tooling typecheck, ESLint, Prettier check, 17 Vitest files / 198
  tests, coverage over thresholds, TypeDoc/API guard, proto lint, proto
  generate, and generated-clean completed successfully.
- Round-3 metadata RED:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  failed with four expected failures because sparse `metadata.columns`,
  sparse `metadata.setOnceFields`, non-array `metadata.semanticTags`, and
  non-string `metadata.semanticTags` values were accepted instead of producing
  deterministic `INVALID_REPOSITORY_SNAPSHOT` errors.
- Round-3 bounded-context GREEN:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  passed 26 tests after index-based metadata-list loops and semantic-tag
  validation were added.
- Round-3 focused verification:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 3 test files and 52 tests after the sparse semantic-tag regression
  case was added.
- Round-3 `corepack pnpm typecheck:tooling` passed.
- Round-3 `node scripts/check-api-docs.mjs` passed. TypeDoc emitted one
  source-link warning because the local `origin` remote is not valid; the API
  JSON guard passed with 96 expected `@spine-ts/server` exports.
- Round-3 full verification:
  `CI=true corepack pnpm verify` passed. Evidence: node version check,
  `tsc -b`, tooling typecheck, ESLint, Prettier check, 17 Vitest files / 203
  tests, coverage over thresholds, TypeDoc/API guard, proto lint, proto
  generate, and generated-clean completed successfully.
- Round-4 metadata RED:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  failed with four expected failures because forged `stateFullTypeName` /
  `metadata.fullTypeName` values, empty semantic tags, blank semantic tags, and
  trim-needed semantic tags were accepted instead of producing deterministic
  `INVALID_REPOSITORY_SNAPSHOT` errors.
- Round-4 bounded-context GREEN:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  passed 31 tests after canonical semantic-tag validation and the direct
  `stateSchema.typeName` check were added.
- Round-4 focused verification:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 3 test files and 56 tests.
- Round-4 `corepack pnpm typecheck:tooling` passed.
- Round-4 `node scripts/check-api-docs.mjs` passed. TypeDoc emitted one
  source-link warning because the local `origin` remote is not valid; the API
  JSON guard passed with 96 expected `@spine-ts/server` exports.
- Round-4 full verification:
  `CI=true corepack pnpm verify` passed. Evidence: node version check,
  `tsc -b`, tooling typecheck, ESLint, Prettier check, 17 Vitest files / 207
  tests, coverage over thresholds, TypeDoc/API guard, proto lint, proto
  generate, and generated-clean completed successfully.
- Round-5 metadata RED:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  failed with four expected failures because duplicate semantic tags, unsorted
  semantic tags, arbitrary function `entityType`, and entity constructor/family
  mismatch snapshots were accepted instead of producing deterministic
  `INVALID_REPOSITORY_SNAPSHOT` errors.
- Round-5 bounded-context GREEN:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  passed 35 tests after canonical semantic-tag list validation and entity
  constructor/family validation were added.
- Round-5 required focused verification:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 3 test files and 60 tests.
- Round-5 `corepack pnpm typecheck:tooling`:
  passed.
- Round-5 `node scripts/check-api-docs.mjs`:
  passed. TypeDoc emitted one source-link warning because the local `origin`
  remote is not valid; the API JSON guard passed.
- Round-5 full verification:
  `CI=true corepack pnpm verify` passed. Evidence: node version check,
  `tsc -b`, tooling typecheck, ESLint, Prettier check, 17 Vitest files / 211
  tests, coverage over thresholds, TypeDoc/API guard, proto lint, proto
  generate, and generated-clean completed successfully.
- Round-6 descriptor-kind RED:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  failed with one expected failure because a hostile snapshot with aggregate
  `entityType`/`entityFamily`, projection `stateSchema`, and forged aggregate
  `metadata.kind` was accepted instead of producing deterministic
  `INVALID_REPOSITORY_SNAPSHOT`.
- Round-6 bounded-context GREEN:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts`
  passed 36 tests after descriptor-derived schema-kind validation and the
  helper deduplication changes were added.
- Round-6 required focused verification:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 3 test files and 61 tests.
- Round-6 `corepack pnpm typecheck:tooling`:
  passed.
- Round-6 `node scripts/check-api-docs.mjs`:
  passed. TypeDoc emitted one source-link warning because the local `origin`
  remote is not valid; the API JSON guard passed.
- Round-6 first full verification attempt:
  `CI=true corepack pnpm verify` failed at `pnpm format:check` because
  `build-protocol/work-logs/T-0009f3.md` needed Prettier formatting after the
  round-6 entries were added.
- Round-6 full verification rerun:
  `CI=true corepack pnpm verify` passed. Evidence: node version check,
  `tsc -b`, tooling typecheck, ESLint, Prettier check, 17 Vitest files / 212
  tests, coverage over thresholds, TypeDoc/API guard, proto lint, proto
  generate, and generated-clean completed successfully.

## Review

- First external review round reported two low-severity security findings and
  two documentation findings.
- Fixed security finding 1 by wrapping unreadable/malformed repository snapshot
  reads in deterministic bounded-context registration errors.
- Fixed security finding 2 by sanitizing entity constructor names used in
  conflict diagnostics.
- Fixed documentation finding 3 by removing the unsupported
  `VisibilityGuard.java` citation rather than fabricating unlogged evidence.
- Fixed documentation finding 4 by updating the work log to record reviewed
  implementation commit `108d5fa`.
- Required focused and full verification passed for this review-fix commit.
- Second external review round reported one documentation finding, one
  TypeScript/API finding, and two reliability findings.
- Fixed round-2 documentation finding by correcting the inaccurate
  bounded-context-only GREEN test count and explaining the mismatch.
- Fixed round-2 TypeScript/API finding by exporting the registration operation
  and both branch detail interfaces from the module and root server surface.
- Fixed round-2 reliability finding 1 with hostile metadata-list RED/GREEN
  coverage and `Array.isArray()` validation before clone/list acceptance.
- Fixed round-2 reliability finding 2 by removing one build-time repository
  snapshot clone and avoiding a second context-snapshot deep clone after
  validation.
- Required focused and full verification passed for the round-2 fix.
- Third external review round reported one reliability finding and one
  low-severity security finding.
- Fixed round-3 reliability finding by adding sparse metadata-list RED/GREEN
  coverage and replacing field-list `map()`/`forEach()` cloning/validation
  with index-based loops that reject missing own indices.
- Fixed round-3 security finding by validating and cloning
  `metadata.semanticTags` as a dense string array instead of spreading any
  iterable.
- Required focused and full verification passed for the round-3 fix.
- Fourth external review round reported one low-severity security finding and
  one reliability finding.
- Fixed round-4 security finding by rejecting empty, blank, and trim-needed
  semantic tags in repository snapshot clone/validation paths.
- Fixed round-4 reliability finding by requiring `stateSchema.typeName` to
  match the snapshot's `stateFullTypeName` before accepting repository
  snapshots.
- Required focused and full verification passed for the round-4 fix.
- Fifth external review round reported one low-severity security finding, one
  documentation finding, and one reliability finding.
- Fixed round-5 security finding by requiring hostile snapshot semantic tags
  to already be deduplicated and sorted.
- Fixed round-5 documentation finding by updating the README repository
  identity section to describe present-tense
  `BoundedContextBuilder.add(repository)` usage while keeping runtime
  registration deferred.
- Fixed round-5 reliability finding by requiring snapshot `entityType` to be a
  supported Aggregate/Projection/ProcessManager class and requiring its
  inferred family to match `snapshot.entityFamily`.
- Required focused and full verification passed for the round-5 fix.
- Sixth external review round reported two code-style findings, one
  documentation finding, and one reliability finding.
- Fixed round-6 code-style finding 1 by reusing a shared internal repository
  entity-family resolver from bounded-context snapshot validation.
- Fixed round-6 code-style finding 2 by routing semantic-tag cloning and
  validation through one canonical dense-array helper.
- Fixed round-6 documentation finding by updating durable top-level status and
  round-6 fix notes.
- Fixed round-6 reliability finding by validating descriptor-derived metadata
  from `stateSchema` before accepting the snapshot kind.
- Required focused and full verification passed for the round-6 fix.
- Seventh external review round reported no remaining findings across code
  style/maintainability, documentation, TypeScript/API docs, security, and
  performance/reliability.
- T-0009f.3 merged into the parent branch on `2026-06-30 13:27 WEST` as merge
  commit `32a664e`, followed by parent verification with 17 files / 212 tests
  and clean TypeDoc/API, proto, and generated-output gates.
