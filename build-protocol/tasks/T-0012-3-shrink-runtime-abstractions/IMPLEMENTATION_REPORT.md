# Implementation Report: T-0012.3 Delete Or Shrink Abandoned Runtime Abstractions

Status: Implemented; verification passed
Branch: `task/T-0012-3-shrink-runtime-abstractions`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-3-shrink-runtime-abstractions`
Baseline commit: `9b5690c` per implementation prompt; task seed files still
recorded parent setup commit `cb5ace3`.

## Setup Summary

- Parent corrective branch integrated `T-0012.1` and `T-0012.2`.
- Parent verification passed after the source-folder repack.
- This task starts before storage/event-store reset, so it must delete or
  shrink wrong abstractions rather than replacing them with new behavior.

## Expected Implementation Shape

- Prefer deleting public types/tests over moving them sideways.
- Keep remaining errors simple.
- Update export lists and TypeDoc expected counts when API shrinkage is
  deliberate.
- Keep transport abstraction focused on topic/subscription plus
  publish/request/respond.
- Leave later roadmap behavior absent.

## Verification Plan

- Focused tests for removed/shrunk APIs where practical.
- `corepack pnpm lint`
- `corepack pnpm typecheck`
- `corepack pnpm test`
- `corepack pnpm docs:check`
- `corepack pnpm proto:generate`
- `corepack pnpm proto:check-generated`
- `git diff --check`
- `env CI=true corepack pnpm verify`, escalated if ZeroMQ local IPC is blocked
  by the sandbox.

## Implementation Notes

- Deleted `BoundedContextRuntime` and `BoundedContextRuntimeOptions`. The class
  only copied bounded-context metadata and delegated lifecycle to
  `SingleProcessServerRuntime` or an injected lifecycle, so it was a shallow
  ahead-of-roadmap wrapper rather than a JVM-backed bounded-context runtime.
- Deleted `BuiltBoundedContextSnapshot`. `BoundedContextSnapshot` already names
  the immutable metadata shell returned by `context.snapshot`; the alias added
  public vocabulary without behavior.
- Deleted bounded-context registration detail exports:
  `BoundedContextRepositoryRegistrationConflictErrorDetails`,
  `BoundedContextRepositorySnapshotErrorDetails`,
  `BoundedContextRepositoryRegistrationErrorDetails`, and
  `RepositoryRegistrationConflictDetails`.
  `BoundedContextRepositoryRegistrationError` now exposes only `code` and a
  sanitized message.
- Deleted `RepositoryIdentityErrorDetails` and `.details`.
  `RepositoryIdentityError` now exposes only `code` and a sanitized message.
- Deleted transport participant/lifecycle helpers:
  `TransportParticipantKind`, `TransportWorkerRole`,
  `TransportLifecycleState`, `TransportReadinessState`,
  `TransportParticipantIdentityInput`, `TransportParticipantIdentity`,
  `TransportWorkerRegistrationInput`, `TransportWorkerRegistration`,
  `TransportLifecycleSnapshotInput`, `TransportLifecycleSnapshot`,
  `TransportLifecycleParticipant`, `createTransportParticipantIdentity()`,
  `createTransportWorkerRegistration()`, and
  `createTransportLifecycleSnapshot()`.
- Deleted transport delivery/retry helpers:
  `TransportDeliveryStatus`, `TransportDeliveryOutcome`,
  `TransportDeliveryFailureKind`, `TransportRetryEligibility`,
  `TransportDeliveryFailureDetailValue`, `TransportDeliveryFailureDetails`,
  `TransportDeliveryFailureClassificationInput`,
  `TransportDeliveryFailureClassification`, `TransportDeliveryAttemptInput`,
  `TransportDeliveryAttempt`, `TransportDeliveryResultInput`,
  `TransportDeliveryResult`, `createTransportDeliveryAttempt()`,
  `classifyTransportDeliveryFailure()`, and
  `createTransportDeliveryResult()`.
- Removed `"delivery"` from `TransportSignalKind`; delivery/inbox routing is a
  later roadmap task.
- Shrunk `createServerRuntimeRoutingPlan()` to avoid transport worker
  registrations. The planner now exposes topics, subscriptions, planner-local
  `workerIds`, and route correlation keys only.

## Intentionally Kept

- Kept `BoundedContext`, `BoundedContextBuilder`, `ContextSpec`, and
  `BoundedContextSnapshot` as the small metadata-only builder/shell aligned
  with the current bounded-context slice.
- Kept `BoundedContextRepositoryRegistrationErrorCode` and
  `BoundedContextRepositoryRegistrationOperation` because tests and callers can
  branch on stable codes without preserving detail hierarchies.
- Kept `RepositoryIdentityErrorCode` for the same reason.
- Kept `SingleProcessServerRuntime`, signal intake result values, and
  `createServerRuntimeRoutingPlan()` because they are existing runtime
  foundation slices outside the transport lifecycle/delivery helper removal;
  the routing planner was shrunk where it depended on removed worker
  registrations.
- Kept transport topic/subscription/publish/request/respond/async-close
  contracts and ZeroMQ adapter-private code. ZeroMQ details remain hidden behind
  the transport abstraction.

## Public API Count Changes

- `@spine-ts/server` TypeDoc expected exports: `130 -> 122`.
- `@spine-ts/transport` TypeDoc expected exports: `46 -> 17`.
- `@spine-ts/proto`, `@spine-ts/core`, and `@spine-ts/storage` counts were
  unchanged by this task. Latest `docs:check` reported proto `100`, core `28`,
  server `122`, storage `26`, transport `17`.

## Verification Results

- Focused tests:
  `npx vitest run packages/transport/test/index.test.ts packages/server/test/context/bounded-context.test.ts packages/server/test/repository/repository.test.ts packages/server/test/runtime/runtime-routing.test.ts packages/server/test/index.test.ts`
  passed: 5 files, 81 tests.
- `corepack pnpm lint` passed after formatting and cleanup-rule exception line
  updates.
- `corepack pnpm typecheck` passed.
- `corepack pnpm test` in the sandbox failed only the two ZeroMQ
  `ipc://` smoke tests with `Operation not permitted`; 27 of 28 files and 289
  of 291 tests passed in that sandbox run.
- Escalated/native IPC `corepack pnpm test` passed: 28 files, 291 tests.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and updated export counts.
- `corepack pnpm proto:generate` passed.
- `corepack pnpm proto:check-generated` passed.
- `git diff --check` passed.
- `env CI=true corepack pnpm verify` in the sandbox failed only when ZeroMQ
  `ipc://` smoke tests hit `Operation not permitted`; preceding node/proto,
  typecheck, lint, and format gates passed.
- Escalated/native IPC `env CI=true corepack pnpm verify` passed. It reported
  28 test files / 291 tests passed, coverage `96.53%` statements and `91.39%`
  branches, docs check passed with the known invalid-origin warning, proto lint
  passed, and generated proto output was ignored/untracked/freshly regenerated.
