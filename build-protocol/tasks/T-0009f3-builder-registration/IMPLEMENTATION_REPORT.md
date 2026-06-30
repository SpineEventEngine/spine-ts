# Implementation Report: T-0009f.3 Builder Repository Registration And Conflict Checks

Status: Implemented And Verified - External Review Pending
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
- `BoundedContext.java` and `VisibilityGuard.java` showed that duplicate state
  ownership fails during runtime registration in the JVM. This TypeScript slice
  moves the check earlier into metadata registration for deterministic feedback.
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
- Public docs and `scripts/check-api-docs.mjs` were updated for the new API
  surface.
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

## Review

- Pending external review lanes from the orchestrator. This implementation
  sub-agent was instructed not to spawn sub-agents.
