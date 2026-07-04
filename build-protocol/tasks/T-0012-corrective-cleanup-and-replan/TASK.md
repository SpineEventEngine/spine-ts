# T-0012: Corrective Cleanup And Roadmap Reset

Status: T-0012.10 in progress
Start: `2026-07-01 16:48 WEST`
Baseline commit: `a9769d4`
Branch: `task/T-0012-cleanup-replan`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-cleanup-replan`

## Objective

Abandon the over-engineered command-execution-first branch line and reset the
framework implementation from trunk toward a simpler Spine JVM-aligned design.

## Human Answers Recorded

- Corrective cleanup must happen before further feature work.
- The previous T-0012 roadmap is replaced by the human-provided order recorded
  in `D-0047` and `TECHNICAL_SPEC.md`.
- Cleanup may be very aggressive; no external users depend on the current code.
- Whole modules/tests may be deleted or replaced when they encode wrong
  abstractions.
- Source files must be grouped by each package's own semantics. Package-root
  `src/` folders should contain only a few top-level files.
- Tests must live under `packages/<package>/test/` and mirror the
  corresponding `src/` folder structure.
- Generated Protobuf-ES output must live under `packages/<package>/generated/`,
  be ignored by Git, and be removed/regenerated on each build.
- Production code may import generated files directly.
- Generated message prototype/interface extensions are acceptable when behavior
  belongs to one generated message instance; such extensions live in regular
  `src` code where the equivalent helper would live.
- Prefer JVM names and short concepts over very precise long TypeScript names.
- Public standalone functions are disallowed unless a strong reason is recorded.
- Use simple errors/exceptions for programmer/configuration problems and small
  result objects only for runtime signal outcomes.
- `BoundedContext` must be shaped by the Spine JVM implementation rather than
  invented snapshot/conflict-detail concepts.
- The to-do example may use in-memory storage but must run with real gRPC,
  query, and subscription support.

## Negative Examples

- `bounded-context.ts` is a representative over-engineering example.
- Names such as `BoundedContextRepositorySnapshotErrorDetails` and
  `BoundedContextRepositoryRegistrationConflictErrorDetails` are forbidden
  unless JVM source and task scope justify them.

## Required First Outcome

Before more framework capability is added, create an autonomous cleanup plan
and enforce the new quality gates for:

- generated-code location and Git ignore policy;
- package/test layout;
- naming and line-length rules;
- no committed generated output;
- no co-located tests under `src`;
- short JVM-aligned APIs;
- corrected implementation order.

No blocking human question is known.

## Integrated Subtasks

- `T-0012.1 Cleanup Enforcement Baseline` is integrated on the parent branch.
  It removed tracked generated Protobuf-ES output, moved package tests out of
  `src`, added cleanup checks, passed all review lanes, and passed escalated
  `env CI=true corepack pnpm verify`.

## Current Subtask State

`T-0012.2 Source Folder Repack` is integrated on the parent branch. It repacked
server and transport source/test folders by semantics, passed all review lanes,
and passed escalated `env CI=true corepack pnpm verify`.

`T-0012.3 Delete Or Shrink Abandoned Runtime Abstractions` is integrated on the
parent branch. It removed or shrank ahead-of-roadmap runtime abstractions,
passed all review lanes, and passed escalated `env CI=true corepack pnpm
verify`. Parent verification after integration also passed with 28 test files,
291 tests, coverage above 90%, docs/API checks, proto lint/generate, and
generated-clean comparison.

`T-0012.4 Storage Factory And Record Storage Reset` is integrated on the
parent branch. It replaced the broad storage adapter with a JVM-like
`StorageFactory` / `RecordStorage` seam, added in-memory record storage and a
storage-only event store delegate, passed all review lanes, and passed
escalated `env CI=true corepack pnpm verify`. Parent verification after
integration also passed with 32 test files, 294 tests, coverage above 90%,
docs/API checks, proto lint/generate, and generated-clean comparison.

`T-0012.7b Aggregate Storage And Signal Routing` is integrated on the parent
branch. It added aggregate snapshot/event storage and repository signal routing,
passed all review lanes, and passed focused final verification before
integration.

`T-0012.7c Integration Verification Fix` is integrated on the parent branch.
It fixed the bounded-context observing fixture for EventStore batch writes,
passed all review lanes, and passed escalated `env CI=true corepack pnpm
verify`.

Parent tracked-state verification passed after `T-0012.7c` integration:
check-node, typecheck, lint, tracked-file formatting, tests, coverage,
docs/API, proto lint/generate/clean, and `git diff --check`. The unrelated
untracked root file `human-review-1-jul.md` remains outside the autonomous task
scope.

`T-0012.8 Delivery And Inbox` is integrated on `main`. It added the first
durable delivery slice with `Inbox`, `Delivery`, storage-backed inbox records,
shard pickup/release, live deduplication, focused delivery/storage tests, and
durable documentation. All required review lanes are clean through reviewed
commit `0d6089a`, final task bookkeeping was committed as `2d0e34e`, and the
parent integration merge was prepared on `2026-07-03 23:10 WEST`.

Parent integration verification after `T-0012.8` found a real coverage gate
failure: escalated `pnpm test:coverage` passed all tests but reported 89.2%
branch coverage, below the 90% threshold.

`T-0012.8b Integration Coverage Fix` is integrated on `main`. It added focused
delivery tests for meaningful inbox, shard, corruption, base64, and tenant
branches, recovered global branch coverage to 90.02%, passed all required
review lanes, and landed through reviewed commit `8e2e410`.

Parent tracked-state verification passed after `T-0012.8b` integration:
check-node, typecheck, lint, tracked-file formatting, escalated tests,
escalated coverage, docs/API, proto lint/generate/clean, and
`git diff --check`. Non-escalated tests and coverage still hit the known
ZeroMQ local IPC sandbox failure. Coverage was statements 94.85%, branches
90.02%, functions 96.95%, and lines 94.88%.

`T-0012.9 Stand And Entity Updates` is integrated on `main`. It added the
first direct storage-backed `Stand`, context-owned stand exposure, direct
entity-state updates, in-process subscriptions, and documentation that keeps
gRPC `QueryService` and `SubscriptionService` in the next task.

Parent tracked-state verification passed after `T-0012.9` integration:
check-node, typecheck, lint, tracked-file formatting, escalated tests,
escalated coverage, docs/API, proto lint/generate/clean, and
`git diff --check`. Non-escalated tests and coverage still hit the known
ZeroMQ local IPC sandbox failure. Coverage was statements 94.93%, branches
90.07%, functions 97.05%, and lines 94.96%.

Current subtask: `T-0012.10 Real gRPC Services`.

## T-0012.2 Selection Rationale

Rationale:

- The cleanup enforcement baseline is now in place.
- Source/test folder structure must be corrected before deleting or rebuilding
  runtime abstractions.
- This task is non-blocked and should remain mostly mechanical: move files into
  semantic package folders, update exports/imports, and avoid behavioral
  redesign.

## T-0012.3 Selection Rationale

- The source/test folder structure is now navigable enough to safely remove or
  shrink wrong abstractions.
- This is the next roadmap item and directly addresses the user's main
  over-engineering complaint.
- The task should delete or reduce abandoned command-execution-first concepts
  and long detail/error hierarchies without adding replacement behavior before
  storage and buses are rebuilt.

## T-0012.4 Selection Rationale

- The cleanup tasks have removed the worst ahead-of-roadmap surfaces.
- The corrected implementation order starts real framework behavior with
  `StorageFactory`, `RecordStorage`, an in-memory storage implementation, and
  event store.
- This task should inspect Spine JVM storage source closely and keep the TS API
  small, with higher-level stores built later over the record-storage seam.

## T-0012.5 Selection Rationale

- Storage now exists as the first mandatory seam in the corrected implementation
  order.
- The next user-specified step is adding `CommandBus`, `EventBus`, and
  dispatching mechanisms around JVM-familiar handler annotations/metadata.
- The task must keep store-before-dispatch for events and avoid bounded-context
  assembly, repositories, delivery, stand, gRPC, scheduler, import bus, or
  system audit until their later slices.

## Requirements Splitter Skill Applicability

Splitter timestamp: `2026-07-01 16:54 WEST`

Session/task-provided applicable skills selected:

- `epic-breakdown-advisor`
  (`/Users/armiol/.agents/skills/epic-breakdown-advisor/SKILL.md`):
  selected to split the corrective epic into small autonomous subtasks. Used
  non-interactively because the human reset already supplied the binding
  answers. Its referenced `workshop-facilitation` entrypoint was not present at
  `/Users/armiol/.agents/skills/workshop-facilitation/SKILL.md`; this is
  non-blocking for this prompt.
- `architecture-decision-records`
  (`/Users/armiol/.agents/skills/architecture-decision-records/SKILL.md`):
  selected for decision hygiene. No new ADR was added because `D-0047` already
  records the cleanup reset, trunk base, generated-code policy, source/test
  layout, and corrected implementation order.
- `codebase-design`
  (`/Users/armiol/.agents/skills/codebase-design/SKILL.md`) plus
  `DEEPENING.md`: selected to evaluate shallow modules, exported helper sprawl,
  and where seams should shrink or disappear.
- TypeScript/code-quality skills are advisory only. `typescript-advanced-types`
  and `nodejs-backend-patterns` were identified in the installed inventory and
  expected-skill manifest, but were not fully applied because this splitter did
  not edit implementation code. `BUILD_PROTOCOL.md`, `CODE_QUALITY.md`,
  `D-0047`, and the explicit human reset override skill guidance.

Skill evidence gathered:

- Session inventory exposed task-relevant skills including
  `epic-breakdown-advisor`, `architecture-decision-records`,
  `codebase-design`, `typescript-advanced-types`, `nodejs-backend-patterns`,
  and verification/review skills.
- Repo manifest inspected:
  `build-protocol/skills/EXPECTED_SKILLS.md`.
- Installed entrypoints enumerated with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
- Installed lock inspected at `/Users/armiol/.agents/.skill-lock.json`.

## Inspection Evidence

Current TypeScript structure issues:

- `packages/proto/src/generated/**` is tracked generated Protobuf-ES output,
  contrary to the reset rule that generated output belongs under
  `packages/<package>/generated/` and is ignored.
- Every package still has tests co-located under `src/`, for example
  `packages/server/src/bounded-context.test.ts` and
  `packages/storage/src/index.test.ts`, contrary to
  `packages/<package>/test/` mirroring the `src` structure.
- Several packages are flat at `src/index.ts`; `packages/server/src` contains
  many root files instead of semantic folders.
- `packages/server/src/bounded-context.ts` contains the named negative pattern:
  long exported detail types, snapshot-centered public contracts, and a
  `BoundedContextRuntime` lifecycle handle before the corrected storage/bus
  layers exist.
- `packages/storage/src/index.ts` exposes a broad `StorageAdapter` plus many
  pre-specialized stores. JVM evidence points to one mandatory
  `StorageFactory.createRecordStorage(context, spec)` adapter seam, with
  higher-level storage built by framework code.
- `packages/transport/src/index.ts` contains transport delivery/retry concepts
  that are ahead of the corrected roadmap's storage, bus, bounded-context,
  repository, and delivery order.

Spine JVM evidence inspected:

- Local notes:
  `spine-jvm-docs/spine-validation-storage-observability-and-support.md`,
  `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`,
  `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`,
  `spine-jvm-docs/spine-entities-repositories-and-state.md`, and
  `spine-jvm-docs/spine-client-api-queries-subscriptions-and-tests.md`.
- JVM source:
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/StorageFactory.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/RecordStorage.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/commandbus/CommandBus.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/event/EventBus.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Repository.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/delivery/Inbox.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/delivery/Delivery.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/stand/Stand.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/CommandService.java`,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/QueryService.java`,
  and
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/SubscriptionService.java`.

High-level JVM correction:

- Storage starts with `StorageFactory` and `RecordStorage`. Event store, entity
  storage, aggregate storage, inbox storage, catch-up storage, and tenant
  storage are framework-level delegates over record storage.
- `CommandBus` is unicast by command type; `EventBus` is multicast and stores
  events before dispatch.
- `BoundedContextBuilder` builds system and domain contexts after bus, stand,
  tenant index, storage, delivery, and registration concepts exist.
- Repositories own entity lifecycle, routing, storage, cache, and context
  registration. They are not just metadata snapshots.
- `Inbox` and `Delivery` are a durable sharded delivery layer with
  deduplication, not transport retry records.
- `Stand` is the read-side query/subscription bridge. The gRPC services are
  thin adapters over context buses and `Stand`, so they must wait until those
  internals are real.

## Corrective Roadmap

The cleanup uses the epic-breakdown pattern "simple/complex" plus "workflow
steps": first make the repository enforce the corrected rules, then remove
wrong abstractions, then add framework behavior in the order from `D-0047`.

### T-0012.1 Cleanup Enforcement Baseline

Goal: make wrong structure hard to continue.

Scope:

- Move tracked generated Protobuf-ES output out of `src/generated` into the
  ignored `packages/proto/generated` workflow or delete it from VCS and update
  generation/import paths in the minimal way needed.
- Move package tests from `src` to `packages/<package>/test`, mirroring the
  source structure.
- Add or tighten automated checks for generated-code location, co-located
  tests, maximum line length, callback naming, semantic name component count,
  and forbidden committed generated output.
- Keep implementation behavior changes limited to path/import updates needed
  by the layout move.

Acceptance:

- No tracked file remains under `packages/*/src/generated`.
- No `*.test.ts` file remains under package `src`.
- The new checks fail on the old patterns.
- Existing tests/typecheck pass after path/import updates.

### T-0012.2 Source Folder Repack

Goal: make each package navigable before behavior changes.

Scope:

- Reorganize `packages/server/src` into a small set of semantic folders such as
  `entity`, `repository`, `context`, `handler`, `runtime`, and `validation`.
- Keep package root `src` files to a handful of entry points.
- Mirror the new source folders under `packages/server/test`.
- Apply the same rule to `core`, `storage`, `transport`, and `testing` where
  they have more than a skeleton entry point.

Acceptance:

- Root package `src` folders contain only entry files and intentionally global
  package modules.
- Imports and package exports remain coherent.
- Tests still pass.

### T-0012.3 Delete Or Shrink Abandoned Runtime Abstractions

Goal: remove concepts from the abandoned command-execution-first line before
new feature work.

Scope:

- Remove or quarantine `BoundedContextRuntime`, runtime routing plans,
  transport delivery attempts/results, and other lifecycle/transport concepts
  that are ahead of the corrected order.
- Replace large exported detail hierarchies in `bounded-context.ts` and
  `repository.ts` with simple errors unless a JVM-backed reason is recorded.
- Remove unnecessary public standalone factory/helper exports, preferring small
  classes, object methods, or generated prototype/interface extensions when
  behavior belongs to one generated message.

Acceptance:

- `bounded-context.ts` no longer exports snapshot/conflict-detail hierarchies.
- No public runtime routing/transport delivery API remains without a
  `D-0047`-ordered consumer.
- Reviewers can explain every retained public standalone function.

### T-0012.4 Storage Factory And Record Storage Reset

Goal: rebuild storage on the JVM-like mandatory seam.

Scope:

- Replace the broad `StorageAdapter` surface with a small `StorageFactory` and
  `RecordStorage` contract.
- Add declarative `RecordSpec` and in-memory record storage with tenant slices,
  columns, deterministic query/index behavior, masks/sorting/limits as scoped
  by the task.
- Build event store as a framework delegate over record storage.
- Keep higher-level aggregate/entity/delivery stores out until their subtasks.

Acceptance:

- In-memory storage is a full adapter for the record-storage contract, not a
  test stub.
- Event store persists events before dispatch can be added.
- No bus, bounded-context runtime, repository dispatch, or delivery behavior is
  introduced.

### T-0012.5 CommandBus, EventBus, And Handler Registration

Goal: add the write-side buses after storage exists.

Scope:

- Implement `CommandBus` unicast registration and duplicate command dispatcher
  rejection.
- Implement `EventBus` multicast registration, domestic/external distinction,
  and store-before-dispatch behavior through the event store.
- Keep scheduler, system audit, import bus, delivery, and gRPC out unless
  separately split.

Acceptance:

- Command handlers have one effective dispatcher per command type.
- Events are persisted before dispatch.
- Handler decorators/metadata stay small and JVM-named.

### T-0012.6 BoundedContext Assembly

Goal: reintroduce bounded context as a real assembly object after storage and
buses are available.

Scope:

- Shape `ContextSpec`, `BoundedContextBuilder`, and `BoundedContext` from the
  JVM build sequence.
- Register repositories/dispatchers/listeners/filters/enrichers at the correct
  internal seams.
- Decide one-shot versus reusable builder behavior in task docs before code.

Acceptance:

- `BoundedContext` owns buses, stand placeholder only if justified, tenant
  index, and registered parts according to inspected JVM source.
- The API is short: `BoundedContext`, `ContextSpec`, `BoundedContextBuilder`,
  `CommandBus`, `EventBus`, `Repository`.
- No public snapshot API is the primary interface.

### T-0012.7 Entities, Repositories, Routing, And Aggregate Storage

Goal: make repositories the domain dispatch and persistence owners.

Scope:

- Implement entity kinds and repository registration against real context
  runtime objects.
- Add routing functions and default first-field routing.
- Add aggregate storage as snapshots plus events, with latest-state side
  channel only if the task records the JVM-backed choice.
- Add repository cache around delivery batches only when delivery exists.

Acceptance:

- Repositories own storage, routing, lifecycle, and dispatch entry points.
- Aggregate loading uses snapshot plus events.
- Query visibility follows entity kind and Spine options.

Subtask split:

- `T-0012.7 Repository Registration And Storage Opening` is integrated. It made
  `BoundedContext` own repository registration and open repository
  `RecordStorage`.
- `T-0012.7b Aggregate Storage And Signal Routing` remains before delivery. It
  must add aggregate snapshot-plus-events storage and route command/event
  signals to repositories without adding `Inbox`, `Stand`, or gRPC behavior.

### T-0012.8 Delivery And Inbox

Goal: add durable dispatch delivery after repositories can receive signals.

Scope:

- Implement `Inbox`, `Delivery`, inbox records, labels, statuses, shard
  strategy, shard pickup, deduplication, retry/monitor seams, and dispatch
  transactions at a small first slice.
- Keep transport adapter retry concepts separate from inbox delivery unless a
  concrete integration task needs them.

Acceptance:

- Inbox dedup key is signal plus target inbox, not just record ID.
- Delivery is durable storage-backed when configured.
- Dispatch transactions persist status changes atomically for the chosen store.

### T-0012.9 Stand And Entity Updates

Goal: add the read-side bridge after write-side delivery exists.

Scope:

- Implement `Stand`, exposed type registry, query execution, subscription
  creation/activation/cancel, and entity-updated system events.
- Keep gRPC services out until this API is usable directly.

Acceptance:

- Queries read projection/entity state through read-side storage.
- Subscriptions receive updates from entity state changes.
- Unknown-target behavior is documented before implementation.

### T-0012.10 Real gRPC Services

Goal: expose real public client contracts.

Scope:

- Implement `CommandService.Post`, `QueryService.Read`, and
  `SubscriptionService.Subscribe/Activate/Cancel` against Spine JVM protobuf
  definitions.
- Use real service generation/runtime choices recorded in `DECISION_LOG.md`.
- Preserve immediate command acknowledgement semantics and subscription opaque
  IDs.

Acceptance:

- Services are thin adapters over real buses and `Stand`.
- Unsupported/unpublished command/query/subscription cases match JVM behavior
  at the protobuf contract level.

### T-0012.11 Missing Details And Example Readiness

Goal: fill verified gaps before the example.

Scope:

- Add omitted details discovered by implementation or review, such as system
  context, import bus, scheduler, tenant index, observability, or catch-up,
  only when they are prerequisites for a real framework workflow.
- Update docs and TypeDoc/API docs.

Acceptance:

- Gaps are tied to concrete framework behavior, not speculative completeness.
- Review lanes report no remaining order violations.

### T-0012.12 To-Do Example

Goal: prove the framework by building the required app.

Scope:

- Implement the server-side to-do bounded context with real gRPC, command
  handling, event production, projection updates, queries, subscriptions,
  validation, and black-box tests.
- If the example reveals a missing framework feature, split and implement the
  framework feature first, then resume the example.

Acceptance:

- The example has its own `USER_GUIDE.md`.
- It does not simulate gRPC/query/subscription behavior.

## First Selected Cleanup Subtask

Selected: `T-0012.1 Cleanup Enforcement Baseline`.

Reason:

- It is non-blocked and directly implements the reset's first safety rails.
- It prevents continuing the abandoned shape by enforcing generated-code,
  layout, naming, callback, and line-length rules before adding framework
  behavior.
- It can be implemented autonomously with tests/checks and without making
  architectural behavior decisions beyond `D-0047`.

Implementer constraints:

- Do not delete or redesign runtime behavior beyond path/import moves required
  by test/generated-code relocation.
- Do not add new framework features.
- Record any unavoidable temporary exception with a specific follow-up subtask.

## Splitter Closure

Requirements splitter agent `019f1e60-fd4e-7ef0-b5ec-223d6928f739` completed
the roadmap in commit `62164aa` and is closed. The first selected subtask is
`T-0012.1 Cleanup Enforcement Baseline`.
