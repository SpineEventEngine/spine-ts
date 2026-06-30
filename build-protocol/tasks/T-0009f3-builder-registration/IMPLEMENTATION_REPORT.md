# Implementation Report: T-0009f.3 Builder Repository Registration And Conflict Checks

Status: Round 2 Review Fix Implemented And Verified
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
  `metadata.setOnceFields` with `Array.isArray()` before mapping them and uses
  `Array.prototype.map.call` for array clones to avoid trusting
  caller-controlled `map()` methods.
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
