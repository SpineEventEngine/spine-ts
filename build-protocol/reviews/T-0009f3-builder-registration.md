# Review Log: T-0009f.3 Builder Repository Registration And Conflict Checks

Status: Complete; All Review Lanes Clean; Integrated Into Parent

## Required Review Lanes

Every implementation subtask and docs-only subtask must complete these review
lanes before integration:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review State

- Implementation sub-agent completed code, docs, and durable log updates in
  commit `108d5fa`.
- First external review round reported four findings:
  - Security Low: `readRepositorySnapshot()` trusted virtual
    `Repository.snapshot` after `instanceof Repository`, letting subclasses
    leak raw errors from snapshot/metadata access.
  - Security Low: conflict diagnostics read `snapshot.entityType.name`
    directly, letting hostile constructor `name` accessors leak raw errors or
    odd values.
  - Documentation P2: `IMPLEMENTATION_REPORT.md` cited
    `VisibilityGuard.java` without an exact inspected path/impact in durable
    task/work logs.
  - Documentation P3: `build-protocol/work-logs/T-0009f3.md` still said
    "Commit is in progress" after implementation commit `108d5fa`.
- Already clean review lanes from the first round: code style/maintainability,
  TypeScript/API docs, and performance/reliability.

## Review Fix State

- Added RED/GREEN tests for unreadable repository snapshots, malformed
  repository snapshot metadata, and hostile entity constructor names.
- `BoundedContextBuilder.add/remove` now wrap unreadable or malformed snapshot
  metadata in `BoundedContextRepositoryRegistrationError` with
  `INVALID_REPOSITORY_SNAPSHOT`.
- Conflict detail construction now reads entity constructor names through a
  safe string fallback and reports `(anonymous)` when the name is inaccessible
  or not a non-empty string.
- Removed the unlogged `VisibilityGuard.java` citation from the implementation
  report instead of fabricating exact JVM evidence.
- Updated the work log to record implementation commit `108d5fa`.
- Required focused and full verification passed before committing the review
  fix:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 45 tests; `corepack pnpm typecheck:tooling` passed;
  `node scripts/check-api-docs.mjs` passed with one TypeDoc source-link warning
  for invalid local `origin`; `CI=true corepack pnpm verify` passed 17 test
  files / 196 tests plus coverage, docs, proto lint/generate, and
  generated-clean.

## Round 2 Review State

- Second external review round reported four findings:
  - Documentation P3: `IMPLEMENTATION_REPORT.md` said the first-round
    review-fix bounded-context GREEN run passed 20 tests, while the work log
    and reviewed test file showed 16 tests for that bounded-context-only run.
  - TypeScript/API P3: the exported
    `BoundedContextRepositoryRegistrationErrorDetails` union referenced
    private branch detail interfaces and a private registration operation type
    in emitted declaration/API docs.
  - Reliability P2: repository snapshot metadata-list cloning trusted
    caller-controlled `.map()` and did not assert `metadata.columns` or
    `metadata.setOnceFields` were arrays before accepting the cloned shape.
  - Reliability P3: `build()` deep-cloned repository snapshots in multiple
    layers.
- Already clean review lanes from the second round: code style and security.

## Round 2 Fix State

- Corrected the implementation report's first-round review-fix bounded-context
  GREEN evidence from 20 tests to 16 tests and recorded that the later focused
  trio passed 45 tests.
- Exported
  `BoundedContextRepositoryRegistrationOperation`,
  `BoundedContextRepositoryRegistrationConflictErrorDetails`, and
  `BoundedContextRepositorySnapshotErrorDetails` from `bounded-context.ts` and
  the root `@spine-ts/server` export.
- Updated `scripts/check-api-docs.mjs` to expect the new public server type
  exports.
- Added RED/GREEN coverage for hostile repository snapshots whose metadata
  lists are not arrays but expose deceptive `map()` / `forEach()` methods.
- Added `Array.isArray()` checks before cloning or validating repository
  metadata lists and avoided caller-controlled array `map()`/`forEach()` in
  the affected paths.
- Reduced build-time clone churn by letting `BoundedContext` constructor
  validation own the repository snapshot clone and by freezing already
  validated context snapshot children without cloning them again.
- Required focused and full verification passed before committing the round-2
  fix:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 47 tests; `corepack pnpm typecheck:tooling` passed;
  `node scripts/check-api-docs.mjs` passed with one TypeDoc source-link warning
  for invalid local `origin`; `CI=true corepack pnpm verify` passed 17 test
  files / 198 tests plus coverage, docs, proto lint/generate, and
  generated-clean.

## Round 3 Review State

- Third external review round reported two findings:
  - Reliability P2: sparse `metadata.columns` and
    `metadata.setOnceFields` arrays could still bypass malformed snapshot
    rejection because `Array.prototype.map.call()` and
    `Array.prototype.forEach.call()` skip holes.
  - Security Low: `metadata.semanticTags` was cloned with spread and not
    validated in `validateRepositorySnapshot()`, allowing non-array iterables
    or arrays containing non-strings to be accepted.
- Already clean review lanes from the third round: code style, documentation,
  and TypeScript/API docs.

## Round 3 Fix State

- Added RED/GREEN coverage for sparse `metadata.columns`, sparse
  `metadata.setOnceFields`, sparse `metadata.semanticTags`, non-array
  `metadata.semanticTags`, and non-string `metadata.semanticTags`.
- Replaced metadata field-list clone/validation with index-based loops that
  reject missing own indices before cloning or validating each field.
- Added `metadata.semanticTags` clone and validation helpers that require a
  dense string array.
- Preserved the metadata-only builder boundary: no storage, routing, stand,
  bus, handler, default runtime repository, or context runtime behavior was
  added.
- Required focused and full verification passed before committing the round-3
  fix:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 52 tests; `corepack pnpm typecheck:tooling` passed;
  `node scripts/check-api-docs.mjs` passed with one TypeDoc source-link warning
  for invalid local `origin`; `CI=true corepack pnpm verify` passed 17 test
  files / 203 tests plus coverage, docs, proto lint/generate, and
  generated-clean.

## Round 4 Review State

- Fourth external review round reported two findings:
  - Security Low: `cloneRepositorySemanticTags()` /
    `validateRepositorySemanticTags()` accepted empty or blank semantic tags
    from hostile snapshots even though descriptor-derived tags are trimmed and
    empty tags are rejected in `entity-metadata.ts`.
  - Reliability P2: `validateRepositorySnapshot()` did not verify
    `snapshot.stateSchema.typeName === snapshot.stateFullTypeName`, allowing a
    hostile repository subclass to forge `stateFullTypeName` and
    `metadata.fullTypeName` while retaining the real schema object.
- Already clean review lanes from the fourth round: code style,
  documentation, and TypeScript/API docs.

## Round 4 Fix State

- Added RED/GREEN coverage for empty, blank, and trim-needed
  `metadata.semanticTags`.
- Added RED/GREEN coverage for forged `stateFullTypeName` /
  `metadata.fullTypeName` values that do not match `stateSchema.typeName`.
- Repository snapshot cloning and validation now reject empty, blank, or
  trim-needed semantic tags.
- Repository snapshot validation now verifies `stateSchema.typeName` directly
  against `stateFullTypeName` before accepting the snapshot.
- Preserved the metadata-only builder boundary: no storage, routing, stand,
  bus, handler, default runtime repository, or context runtime behavior was
  added.
- Required focused and full verification passed before committing the round-4
  fix:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 56 tests; `corepack pnpm typecheck:tooling` passed;
  `node scripts/check-api-docs.mjs` passed with one TypeDoc source-link warning
  for invalid local `origin`; `CI=true corepack pnpm verify` passed 17 test
  files / 207 tests plus coverage, docs, proto lint/generate, and
  generated-clean.

## Round 5 Review State

- Fifth external review round reported three findings:
  - Security Low: `cloneRepositorySemanticTags()` /
    `validateRepositorySemanticTags()` rejected blank strings but still did
    not enforce descriptor metadata's deduplicated and sorted semantic-tag
    contract.
  - Documentation P3: `packages/server/README.md` still said "later
    bounded-context builder code" needs `Repository` even though
    `BoundedContextBuilder.add(repository)` is implemented.
  - Reliability P2: `validateRepositorySnapshot()` only checked
    `snapshot.entityType` was a function and did not verify it is a supported
    Aggregate/Projection/ProcessManager constructor whose inferred family
    matches `snapshot.entityFamily`.
- Already clean review lanes from the fifth round: code style and
  TypeScript/API docs.

## Round 5 Fix State

- Added RED/GREEN coverage for duplicate and unsorted
  `metadata.semanticTags`.
- Added RED/GREEN coverage for hostile snapshots with an arbitrary function
  `entityType` and with an entity constructor/family mismatch.
- Repository snapshot cloning and validation now reject semantic tags that are
  not already deduplicated and sorted.
- Repository snapshot validation now verifies `entityType` is a supported
  Aggregate/Projection/ProcessManager class and that the inferred family
  matches `snapshot.entityFamily`.
- README repository identity docs now describe present-tense
  `BoundedContextBuilder.add(repository)` usage while keeping runtime
  registration deferred.
- Preserved the metadata-only builder boundary: no storage, routing, stand,
  bus, handler, default runtime repository, or context runtime behavior was
  added.
- Required focused and full verification passed before committing the round-5
  fix:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 60 tests; `corepack pnpm typecheck:tooling` passed;
  `node scripts/check-api-docs.mjs` passed with one TypeDoc source-link warning
  for invalid local `origin`; `CI=true corepack pnpm verify` passed 17 test
  files / 211 tests plus coverage, docs, proto lint/generate, and
  generated-clean.

## Round 6 Review State

- Sixth external review round reported four findings:
  - Code style P3: `resolveRepositorySnapshotEntityFamily()` duplicated the
    class/family detection already present in `repository.ts`.
  - Code style P3: semantic-tag canonicality was implemented separately in
    clone and validation paths.
  - Documentation P3: top-level durable status still named stale round-4 or
    round-5 fix state.
  - Reliability P2: `validateRepositorySnapshot()` trusted
    `snapshot.metadata.kind` instead of descriptor-derived metadata from
    `stateSchema`, allowing a self-consistent forged snapshot to lie about the
    schema kind.
- Already clean review lanes from the sixth round: TypeScript/API docs and
  security.

## Round 6 Fix State

- Added RED/GREEN coverage for a hostile repository snapshot that swaps in a
  projection `stateSchema` while forging aggregate metadata fields that are
  otherwise self-consistent.
- Exported a narrow `@internal` `resolveRepositoryEntityFamily()` helper from
  `repository.ts` and reused it from bounded-context snapshot validation
  without adding it to the root package export surface.
- Replaced separate semantic-tag clone/validate loops with one
  `readCanonicalRepositorySemanticTags()` helper that validates and returns a
  dense canonical string array.
- Repository snapshot validation now derives trusted metadata from
  `stateSchema` with `describeEntityMetadata()` and requires the trusted schema
  kind to match `snapshot.entityFamily`.
- Preserved the metadata-only builder boundary: no storage, routing, stand,
  bus, handler, default runtime repository, or context runtime behavior was
  added.
- Required focused and full verification passed before committing the round-6
  fix:
  `corepack pnpm exec vitest run --passWithNoTests packages/server/src/bounded-context.test.ts packages/server/src/repository.test.ts packages/server/src/index.test.ts`
  passed 61 tests; `corepack pnpm typecheck:tooling` passed;
  `node scripts/check-api-docs.mjs` passed with one TypeDoc source-link warning
  for invalid local `origin`; the first full `CI=true corepack pnpm verify`
  attempt failed at Prettier for this work log, then the rerun passed 17 test
  files / 212 tests plus coverage, docs, proto lint/generate, and
  generated-clean.

## Round 7 Review State

- Seventh external review round reported no remaining findings:
  code style/maintainability, documentation, TypeScript/API docs, security, and
  performance/reliability lanes were all clean.
- T-0009f.3 merged into the parent branch on `2026-06-30 13:27 WEST` as merge
  commit `32a664e`, and parent verification passed after integration.
