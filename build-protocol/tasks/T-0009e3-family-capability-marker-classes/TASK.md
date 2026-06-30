# T-0009e.3: Family Capability Marker Classes

Status: Started
Parent task: `build-protocol/tasks/T-0009e-entity-base-classes/TASK.md`
Task log path:
`build-protocol/tasks/T-0009e3-family-capability-marker-classes/TASK.md`
Branch: `task/T-0009e3-family-capability-marker-classes`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e3-family-capability-marker-classes`
Baseline commit: `26aa510`

## Objective

Introduce the first public entity-family base classes for `@spine-ts/server`
without adding repository, dispatch, storage, bus, process, query, or handler
execution behavior.

The task is a capability-marker slice over the existing `TransactionalEntity`
shell. It should give application code and later framework runtime code clear
OOP type families for aggregate, projection, and process-manager entities while
preserving strict read-side/write-side segregation and avoiding fake behavior
that later infrastructure has not implemented yet.

## Required JVM Research

Before adding any family-specific behavior, inspect the corresponding
`core-jvm/server` classes and keep the TypeScript API close to the useful shape
instead of over-inventing:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/aggregate/Aggregate.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/projection/Projection.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/procman/ProcessManager.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/TransactionalEntity.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Entity.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`

Observed boundary for this task:

- JVM `Projection` directly extends `TransactionalEntity`.
- JVM `Aggregate` and `ProcessManager` extend assignee-capable transactional
  bases and implement many dispatch/runtime interfaces.
- Those runtime interfaces are out of scope here. The TypeScript slice should
  capture only family identity and capability segregation that can be represented
  safely over the existing `TransactionalEntity` base.

## In Scope

- Abstract `Aggregate`, `Projection`, and `ProcessManager` family classes in
  `packages/server/src/entity.ts`.
- Family metadata types or constants only if needed to make family identity
  explicit and type-safe.
- Generics matching the existing `TransactionalEntity<Id, Schema, Version>`
  pattern.
- Tests that prove the family classes extend `TransactionalEntity`, expose the
  expected family identity, keep protected transaction helpers non-public, and
  preserve snapshot/transaction behavior inherited from the base.
- Root exports and API export checks.
- Updates to package README, API docs, user/architecture docs where relevant.
- Durable task, work, review, and implementation-report logs.

## Out Of Scope

- Repositories, entity records, storage integration, aggregate event history,
  snapshots, lifecycle system events, handler invocation, routing, buses,
  services, transports, process workers, query clients, Bounded Context
  assembly, command posting, process workflow execution, idempotency guards,
  event import, `RecentHistory`, async-local transaction state, Java builders,
  automatic version increments, or runtime dispatch.

## Implementation Guidance

- Keep the API intentionally small. A family class that only extends
  `TransactionalEntity` and exposes a stable family marker is preferable to
  speculative runtime hooks.
- Use TypeScript generics and protected inheritance rather than Java-style
  builders.
- Do not add public state mutators.
- If a proposed method cannot be justified by the inspected JVM class without
  also implementing its runtime owner, defer it.
- Use TDD: add focused failing tests before implementation.

## Expected Files

- `packages/server/src/entity.ts`
- `packages/server/src/entity.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/server/README.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `build-protocol/tasks/T-0009e3-family-capability-marker-classes/TASK.md`
- `build-protocol/tasks/T-0009e3-family-capability-marker-classes/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e3.md`
- `build-protocol/reviews/T-0009e3-family-capability-marker-classes.md`

## Required Review

Every review round must use separate reviewer sub-agents for:

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

All reviewer comments must be fed back to the authoring sub-agent. Review
rounds continue until all five lanes are clean. Each participating sub-agent
must be closed after its role is complete.

## Blocking Questions

None known.
