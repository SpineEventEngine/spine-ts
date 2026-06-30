# T-0009f.2: Repository Identity And Entity Ownership Seam

Status: Implementation Complete - Pending Review
Start: `2026-06-30 07:34 WEST`
Parent task: `T-0009f Repository Seams And Bounded-Context Registration Skeleton`
Parent branch: `task/T-0009f-repository-seams`
Branch: `task/T-0009f2-repository-identity-seam`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009f2-repository-identity-seam`
Baseline commit: `a6e72be`
Task log path:
`build-protocol/tasks/T-0009f2-repository-identity-seam/TASK.md`
Implementation report path:
`build-protocol/tasks/T-0009f2-repository-identity-seam/IMPLEMENTATION_REPORT.md`
Work log path: `build-protocol/work-logs/T-0009f2.md`
Review log path: `build-protocol/reviews/T-0009f2-repository-identity-seam.md`

## Scope

Create the metadata-only repository identity seam over entity constructors and
state schemas. This subtask prepares later bounded-context registration and
conflict checks without implementing repository runtime behavior.

In scope:

- A repository base/options API that owns exactly one entity family/state schema.
- Repository identity metadata derived from existing `describeEntityMetadata()`
  and entity family marker classes.
- Deterministic snapshots for later builder registration checks.
- Tests proving aggregate, projection, and process-manager ownership metadata.
- Public exports and API-doc guard updates for the new surface.
- Documentation and durable logs describing the metadata-only boundary.

Out of scope:

- `create`, `find`, `store`, storage adapters, record conversion, or entity
  construction factories.
- Routing execution, inbox writes, command/event dispatch, handler invocation,
  repository cache, lifecycle monitor, catch-up, query stand, system context, or
  close/open lifecycle.
- Default repository construction beyond static metadata/helpers explicitly
  needed for the registration seam.
- ZeroMQ, transport, buses, gRPC services, and read-side query execution.

## JVM Source Evidence Required

The implementation sub-agent must closely inspect the relevant Spine JVM
`core-jvm/server` files before coding and keep the TS surface conservative:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Repository.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/RecordBasedRepository.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/DefaultRepository.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/aggregate/AggregateRepository.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/projection/ProjectionRepository.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/procman/ProcessManagerRepository.java`
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`
- `spine-jvm-docs/spine-entities-repositories-and-state.md`

Observed JVM boundary for this subtask:

- `Repository<I, E>` owns a model entity class and exposes `idClass()`,
  `entityClass()`, and `entityStateType()` metadata.
- `Repository.registerWith(context)` assigns a bounded context once and opens
  storage, but storage/open/stand registration are later runtime concerns.
- `DefaultRepository.of(Class<E>)` chooses an aggregate/projection/process
  manager repository by entity class family. It deliberately favors convenient
  syntax over a deep hierarchy.
- Concrete repository classes add routing, inbox, cache, catch-up, import, and
  command/event registration. Those behaviors are not part of this metadata
  seam.

## Acceptance Criteria

- [x] Tests are written before production code and fail for the expected
      missing repository surface.
- [x] Repository identity can be constructed for aggregate, projection, and
      process-manager entity constructors whose state schemas match the family.
- [x] Mismatched entity family and state-schema kind are rejected with a
      structured error.
- [x] Snapshots are immutable/fresh-copy values suitable for later builder
      duplicate and conflict checks.
- [x] Public exports, TypeDoc/API docs checks, and package docs include the new
      API.
- [x] Docs explicitly state this is metadata-only and does not create/find/store,
      route, dispatch, or open storage.
- Required reviewer lanes all report no remaining comments before integration.

## Required Verification

- [x] Focused RED and GREEN Vitest commands for the new repository tests.
- [x] Focused index/API tests when exports change.
- [x] `node scripts/check-api-docs.mjs`
- [x] `CI=true corepack pnpm verify`

## Review Lanes

For this task, including docs-only changes, the orchestrator must run separate
reviewer sub-agents for:

- code style/maintainability,
- documentation,
- TypeScript/API docs,
- security,
- performance/reliability.

Reviewer comments must be fed back to the authoring sub-agent and review rounds
must repeat until no comments remain.
