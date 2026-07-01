# T-0012.6: BoundedContext Assembly

Status: implementation complete; verified
Start: `2026-07-01 22:58 WEST`
Parent task: `T-0012 Corrective Cleanup And Roadmap Reset`
Branch: `task/T-0012-6-bounded-context-assembly`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-6-bounded-context-assembly`
Baseline commit: `e0a6f5e`

## Goal

Move `BoundedContext` from a metadata-only shell toward JVM-familiar assembly:

- `BoundedContextBuilder` collects command and event dispatchers;
- `build()` creates a `BoundedContext` that owns `CommandBus` and `EventBus`;
- `EventBus` is backed by `EventStore` created from a `StorageFactory`;
- built contexts expose `commandBus()` and `eventBus()` accessors; and
- repository registration remains a narrow pending seam for `T-0012.7`.

## Must Preserve

- Follow corrected order from `D-0047`: storage and buses exist; repositories,
  delivery, stand, gRPC, scheduler, import bus, and system context remain later
  tasks.
- Keep close conceptual alignment with Spine JVM `BoundedContext` and
  `BoundedContextBuilder`.
- Aggressively avoid overengineering and invented detail hierarchies.
- Prefer JVM names: `commandBus()`, `eventBus()`, `addCommandDispatcher()`,
  `addEventDispatcher()`.
- No exported standalone helpers unless a strong reason is recorded.
- Names must have no more than four semantic components.
- Tests stay under `packages/server/test/context`.
- Update docs/API docs and durable logs for every public API change.

## JVM Evidence

Required evidence for this task:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/ServerEnvironment.java`;
- existing TS `CommandBus`, `EventBus`, `EventStore`, and `StorageFactory`.

Relevant JVM shape:

- public entry points are `BoundedContext.singleTenant(name)` and
  `BoundedContext.multitenant(name)`;
- builder stores registrations and builds runtime parts;
- built context owns command and event buses;
- command/event dispatcher registration belongs to the builder/context path;
- repositories are registered by the context later, but TS repository lifecycle
  is a separate `T-0012.7` task.

## Required Changes

- Simplify `packages/server/src/context/bounded-context.ts` enough for this
  slice:
  - remove exported repository-registration error-code/detail types unless still
    needed by a deliberately small public API;
  - avoid snapshot-heavy names in public API;
  - keep `ContextSpec` small;
  - build `CommandBus` and `EventBus` from builder configuration.
- Add builder methods:
  - `addCommandDispatcher(dispatcher)`;
  - `removeCommandDispatcher(dispatcher)`;
  - `addEventDispatcher(dispatcher)`;
  - `removeEventDispatcher(dispatcher)`.
- Add a way to provide a `StorageFactory` for the context's `EventStore`.
  Prefer a direct option or builder method over a global environment facade for
  now.
- Keep `add(repository)` and `remove(repository)` only as narrow pending
  repository registration if it can stay simple. Do not implement repository
  lifecycle, storage opening, or entity method dispatch in this task.
- Update `packages/server/src/index.ts`, docs, API checks, and tests.

## Acceptance

- [x] Built single-tenant and multitenant contexts expose the configured name and
      tenant mode.
- [x] Built contexts expose working post-only `commandBus()` and `eventBus()`
      endpoints that do not expose dispatcher `register()`.
- [x] Dispatchers added to the builder are registered in the built buses.
- [x] Removed dispatchers are not registered in the built buses.
- [x] Event posting through `context.eventBus().post(event)` stores events in the
      context event store before dispatch.
- [x] Command posting through `context.commandBus().post(command)` reaches the
      registered command dispatcher.
- [x] No repository lifecycle, delivery, stand, gRPC, transport execution,
      scheduler, import bus, or system-context runtime behavior is introduced.
- [x] The public API is smaller than the previous snapshot-heavy context surface.

## Implementation Notes

- `BoundedContextBuilder` now collects command and event dispatchers with
  JVM-familiar add/remove methods and builds fresh `CommandBus` / `EventBus`
  instances for each built context.
- `BoundedContextBuilder.withStorageFactory(factory)` supplies the
  `StorageFactory` used to create the context `EventStore`; the default remains
  in-memory storage for this slice.
- `BoundedContext` exposes post-only `commandBus()` and `eventBus()` endpoints,
  plus small name/spec/tenant metadata. The concrete bus `register()` methods
  remain outside the public context API.
- `add(repository)` / `remove(repository)` are chainable pending no-ops for the
  later repository-runtime slice. Built contexts do not expose repository
  arrays.
- The bounded-context repository registration error/code/operation exports were
  removed from the package root.

## Round-1 Review Fixes

- Reordered `packages/server/src/context/bounded-context.ts` so the primary
  `BoundedContext` declaration precedes `BoundedContextBuilder` and
  `ContextSpec`.
- Converted repository references in bounded-context assembly to type-only
  imports.
- Added small exported `CommandEndpoint` and `EventEndpoint` types, and changed
  context bus accessors to return stable post-only endpoints.
- Removed the write-only repository set from the builder; repository
  `add()`/`remove()` are documented and tested as pending no-ops.
- Updated docs/logs to describe the current assembly surface and keep
  repositories, delivery, Stand, gRPC, transport execution, scheduler, import
  bus, system context runtime, tenant index, and server builder out of scope.
- Known concern carried forward: multitenant event storage has no tenant
  selection seam yet; tenant-specific event-store scoping belongs with later
  tenancy/runtime work.

## Baseline Verification

Fresh baseline in this worktree:

- Command: `env CI=true corepack pnpm verify`.
- Result: passed.
- Evidence: 35 test files, 302 tests, coverage statements 95.61%, branches
  90.08%, functions 98.37%, lines 95.60%.
- Existing warning only: TypeDoc cannot build source links because the local
  `origin` remote is not valid.

## Process

- One implementation sub-agent owns the code change.
- Required reviewer lanes after implementation:
  - code style/maintainability;
  - documentation;
  - TypeScript/API docs;
  - security;
  - performance/reliability.
- Reviewer comments feed back to the authoring sub-agent until all lanes are
  clean.
- All participating sub-agents are closed after their role is complete.
