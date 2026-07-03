# T-0012.9: Stand And Entity Updates

Status: implemented; verification passed
Branch: `task/T-0012-9-stand-entity-updates`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-9-stand-entity-updates`
Baseline commit: `796221d`

## Objective

Add the first usable direct `Stand` slice for read-side entity-state access and
entity update notifications, without adding gRPC service adapters yet.

The slice must stay small and JVM-familiar:

- `Stand` is the read-side access point owned by a built `BoundedContext`.
- Repositories registered with a context make their entity state types known to
  the context `Stand`.
- Entity state updates are recorded through the `Stand` and can notify direct
  in-process subscribers.
- Query/subscription behavior is direct framework API only. Real gRPC
  `QueryService` and `SubscriptionService` remain `T-0012.10`.

## Required Scope

- Add a semantic `packages/server/src/stand/` folder and mirrored
  `packages/server/test/stand/` tests.
- Keep the first API explicit and small. Prefer a direct class/object API such
  as registering state types, writing/updating entity state, reading states by
  type/ID, and subscribing to state updates.
- Store read-side state through `StorageFactory` / `RecordStorage`; do not add a
  separate storage abstraction.
- Reuse generated Protobuf-ES APIs for cloning and packing/unpacking where
  possible.
- Keep tenant isolation compatible with existing `StorageContext` rules.
- Expose the built context's stand via a direct method or property with a
  short JVM-familiar name.
- Update `packages/server/src/index.ts`, docs/API docs, and durable logs for
  any public API additions.

## Explicitly Out Of Scope

- No gRPC services or simulated service adapters.
- No full client query DSL.
- No cross-context unknown-target subscription fallback.
- No worker-thread or ZeroMQ read-side execution.
- No repository handler invocation or projection catch-up loop unless a minimal
  direct update hook proves necessary.
- No broad cache framework, lifecycle manager, integration broker, import bus,
  scheduler, or system context runtime.

## JVM Evidence

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md` says a bounded
  context owns a read-side `Stand`, repositories register exposed state types
  with it, and `QueryService`/`SubscriptionService` are thin service routers
  over the stand.
- `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md` says
  queries return entity states with versions and subscriptions deliver entity
  state updates or no-longer-matching IDs.
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md` says read-side
  query/subscription services stay separate from write-side bus and inbox
  delivery.
- The local checkout path
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/stand`
  exists but is empty in this workspace snapshot, so there is no local Java
  `Stand` implementation source to mirror directly in this round.

## Current TS Evidence

- `BoundedContextBuilder.build()` already owns the storage factory, event
  store, buses, and registered repositories.
- `RepositoryView` already exposes `stateSchema`, `stateFullTypeName`,
  metadata, entity family, and ID-field metadata.
- `RecordStorage` already supports read, write, query, query entries, masks,
  filters, limits, and storage-context tenancy.
- No `packages/server/src/stand` implementation exists yet.

## Acceptance Criteria

- A direct `Stand` API can register known entity state types and reject unknown
  state types on reads/subscriptions.
- A built `BoundedContext` owns and exposes a `Stand` whose known state types
  come from registered repositories.
- The direct `Stand` API can record an entity state update, read it back, and
  deliver an in-process update to a subscriber.
- Subscriber cleanup is explicit and deterministic.
- Single-tenant and multitenant storage contexts are covered by tests.
- Public docs/API docs explain this is direct stand behavior, not gRPC.
- All required review lanes pass with no comments.
- Parent verification after integration must keep branch coverage at or above
  90%.

## Verification Plan

- Focused stand and bounded-context tests.
- `pnpm typecheck`.
- `pnpm lint`.
- tracked-file Prettier check or narrower changed-file Prettier check plus a
  documented reason.
- `pnpm test`; escalate only for the known ZeroMQ local IPC sandbox failure.
- `pnpm test:coverage`; escalate only for the known ZeroMQ local IPC sandbox
  failure.
- `pnpm docs:check`.
- `pnpm proto:lint`, `pnpm proto:generate`, and
  `pnpm proto:check-generated` if proto/doc generation is touched or as part
  of parent verification.
- `git diff --check`.

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Current State

Implementation adds the first direct storage-backed `Stand` slice, exposes it
from built bounded contexts, registers repository state schemas with the
context stand, and documents the public direct API boundary. Full required
verification passed. No blocking human question is known.
