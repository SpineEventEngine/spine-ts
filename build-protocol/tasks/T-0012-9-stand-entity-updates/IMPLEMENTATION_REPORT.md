# Implementation Report: T-0012.9 Stand And Entity Updates

Status: implemented; verification passed
Branch: `task/T-0012-9-stand-entity-updates`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-9-stand-entity-updates`
Baseline commit: `796221d`

## Summary

This task starts the read-side `Stand` slice after storage, buses, bounded
context, repositories, aggregate storage/routing, and delivery/inbox are in
place.

The implementation must keep the first `Stand` API direct and small. It must
not introduce gRPC service adapters, client DSLs, worker-thread read-side
execution, or repository handler invocation.

## Initial Evidence

- Parent `main` verification passed after `T-0012.8b` with 42 test files, 489
  tests, and branch coverage 90.02%.
- Existing TS code has no `packages/server/src/stand` folder.
- Existing repository/context code already carries enough state-type metadata
  to register direct stand type support.
- The local JVM server stand source directory is empty, so the local JVM
  evidence for this task is the documentation and service-routing notes rather
  than Java source bodies.

## Skill Applicability

Implementation and reviewers must apply the already-installed skills where
needed:

- `subagent-driven-development` for worker/reviewer split.
- `test-driven-development` and `javascript-testing-patterns` for the new
  stand behavior.
- `cqrs-implementation` or equivalent CQRS guidance for strict read-side /
  write-side segregation.
- `api-design-principles` and `typescript-advanced-types` only where public API
  shape or generic state typing needs review.
- `verification-before-completion` before claiming task completion.

## Implemented Shape

The first slice is:

- a `Stand` class in `packages/server/src/stand`;
- direct state-type registration from generated schemas, with repository
  metadata registering built-context state types;
- storage-backed latest-state `update()` / `read()` behavior using
  `StorageFactory` and per-state-type `RecordStorage`;
- direct in-process subscribers with explicit idempotent `unsubscribe()` and
  cloned update payloads per subscriber;
- bounded-context exposure of its owned `Stand` via `stand()`;
- public exports and docs for the direct stand API.

The API stays direct and short: `register`, `stateTypes`, `update`, `read`, and
`subscribe`. Multitenant stands require a tenant ID on reads, updates, and
subscriptions; single-tenant stands reject tenant options. Unknown state types
throw `StandStateTypeError`.

No standalone exported helper functions were added. Generated Protobuf-ES
messages are cloned with Buf `clone()`. State updates are recorded directly
through the stand; no repository handler invocation, projection catch-up loop,
cache framework, gRPC service simulation, client DSL, worker thread, or ZeroMQ
read-side execution was added.

## Verification Evidence

- Red focused tests first:
  `pnpm vitest run packages/server/test/stand/stand.test.ts packages/server/test/context/bounded-context.test.ts packages/server/test/index.test.ts`
  initially failed because `Stand` was not exported, `context.stand()` did not
  exist, and `Stand` was not constructible.
- Green focused tests:
  same focused Vitest command passed with 3 files and 44 tests.
- `pnpm typecheck` passed after fixing exact optional tenant context shaping.
- Final verification:
  - focused stand/context/export tests passed: 3 files, 44 tests.
  - `pnpm typecheck` passed.
  - `pnpm lint` passed.
  - changed-file Prettier check passed.
  - `pnpm test` initially hit the known ZeroMQ local IPC sandbox
    `Operation not permitted`; escalated retry passed with 43 files and 501
    tests.
  - `pnpm test:coverage` initially hit the same sandbox issue; escalated retry
    passed with 43 files, 501 tests, and global branch coverage 90.11%.
  - `pnpm docs:check` passed after updating the API export expectation list for
    the new Stand exports. It emitted the existing invalid-origin TypeDoc
    warning and reported 164 expected `@spine-ts/server` exports.
  - `pnpm proto:lint`, `pnpm proto:generate`, and
    `pnpm proto:check-generated` passed.
  - `git diff --check` passed.

## Tooling Notes

This fresh worktree refused `pnpm vitest` with `VERIFY_DEPS`; sandboxed
`pnpm install` then failed with registry `ENOTFOUND`. The escalated
`pnpm install` retry completed successfully and reused the package store.

## Current State

Implementation files, tests, docs, and durable logs are ready to commit. No
blocking human question is known.
