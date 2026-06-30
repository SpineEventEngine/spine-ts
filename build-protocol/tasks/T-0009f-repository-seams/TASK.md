# T-0009f: Repository Seams And Bounded-Context Registration Skeleton

Status: Requirements Split Complete; First Subtask Selected
Start: `2026-06-30 05:21 WEST`
Baseline commit: `ec70945`
Task log path: `build-protocol/tasks/T-0009f-repository-seams/TASK.md`
Branch: `task/T-0009f-repository-seams`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009f-repository-seams`
Requirements splitter:
`019f16c7-9335-72e3-ab82-7c4ce7fc8e9c` (Singer the 4th, closed)
Authoring sub-agent: T-0009f.1 setup pending implementation
Reviewer sub-agents: pending

## Objective

Introduce the first TypeScript repository and bounded-context registration
skeleton for `@spine-ts/server`, building on T-0009e entity base classes without
adding dispatch, storage execution, bus, delivery, stand, gRPC, ZeroMQ, or
system-context behavior.

The first slice should provide stable registration contracts that later runtime
tasks can consume: repository identity, entity-family ownership metadata,
bounded-context name and tenant mode, builder add/remove APIs, duplicate and
conflicting-registration checks, immutable built context snapshots, and public
documentation that clearly names deferred runtime behavior.

## Required JVM Shape

Server work must inspect task-relevant Spine JVM `core-jvm/server` code before
inventing behavior. Setup inspected:

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, bounded-context
  builder surface, registration, server assembly, tenancy, and storage wiring
  sections;
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`, repository dispatch
  to inbox section;
- `build-protocol/DEVELOPER_API.md`, repository and bounded-context assembly
  section;
- `build-protocol/RUNTIME_ARCHITECTURE.md`, bounded context, repository,
  worker declaration, and bus semantics sections;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Repository.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/RecordBasedRepository.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/aggregate/AggregateRepository.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/projection/ProjectionRepository.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/procman/ProcessManagerRepository.java`.

Implementation impact:

- JVM assembly starts from `BoundedContext.singleTenant(name)` and
  `BoundedContext.multitenant(name)` builders.
- JVM builder accepts repositories or entity classes, plus explicit dispatcher
  registration APIs; repositories passed as dispatchers are diverted into
  repository registration.
- JVM `BoundedContext.register(repository)` registers context-aware components,
  visibility, storage, and stand suppliers, but those runtime pieces do not yet
  exist in the TypeScript implementation.
- JVM repository dispatch normally routes to inbox endpoints and returns
  dispatch outcomes; it does not directly run handlers in the common path.
- T-0009f must therefore create registration seams and immutable snapshots, not
  dispatch or persistence behavior.

## Skill Applicability

Session inventory exposed installed skills including `planning-with-files`,
`subagent-driven-development`, `using-git-worktrees`, `architecture-patterns`,
`cqrs-implementation`, `domain-modeling`, `codebase-design`,
`typescript-advanced-types`, `test-driven-development`,
`requesting-code-review`, and `verification-before-completion`.

Selected skills read before setup:

- `planning-with-files`: applicable for durable resumability; project-specific
  build-protocol logs remain the durable plan instead of creating separate root
  planning files.
- `subagent-driven-development`: applicable because BUILD_PROTOCOL requires
  splitter, implementation, and reviewer sub-agents.
- `using-git-worktrees`: applicable and used to create this isolated worktree.
- `architecture-patterns`: applicable to bounded-context and repository seam
  design.
- `cqrs-implementation`: applicable as a read/write segregation guardrail.
- `domain-modeling`: applicable for bounded-context terminology, but no
  separate glossary file was created during setup because terms are already
  defined in build protocol/JVM docs.

Skipped relevant-looking skills during setup:

- `event-store-design`, `projection-patterns`, and `saga-orchestration`: likely
  relevant to later runtime tasks, but T-0009f setup does not implement event
  storage, projections, or sagas.
- `nodejs-backend-patterns`: not selected for setup because no HTTP/gRPC server
  implementation is in scope.
- `security-best-practices`: not selected for setup because no runtime source is
  edited yet; security review remains mandatory for implementation/review.

Task-provided skill names/paths: none beyond the session inventory and protocol
requirements.

Repo expected-skill manifest:
`build-protocol/skills/EXPECTED_SKILLS.md` must be checked by implementers and
reviewers. Installed-skill enumeration command to record in sub-agent logs:
`find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
Installed-skill lock manifest source:
`/Users/armiol/.agents/.skill-lock.json`.

## Scope For Splitter

The requirements splitter must produce small subtasks. Candidate boundaries:

1. Bounded-context name, tenant-mode, and builder shell.
2. Repository base/options/metadata seam over entity constructors.
3. Builder registration, duplicate/conflict checks, and immutable context
   snapshot.
4. Public API/docs/export closure and verification.

The splitter may revise these boundaries after inspecting the code, but it must
keep runtime execution out of the first subtasks unless it records a separate
decision and the required JVM source evidence.

## Splitter Roadmap

Requirements splitter `019f16c7-9335-72e3-ab82-7c4ce7fc8e9c` completed on
`2026-06-30 05:29 WEST` and was closed. It found no blockers and selected
`T-0009f.1 Context Spec And Builder Shell` as the first non-blocked implementable
subtask.

Staged subtasks:

1. `T-0009f.1 Context Spec And Builder Shell`: immutable context
   name/tenant-mode values, `BoundedContext.singleTenant(name)`,
   `BoundedContext.multitenant(name)`, builder shell, name validation, and build
   snapshot shape. No system context, tenant index, buses, stand, storage, or
   service routing.
2. `T-0009f.2 Repository Identity And Entity Ownership Seam`: metadata-only
   repository base/options over entity constructors and schemas. No create/find,
   storage adapters, routing execution, inbox writes, or handler invocation.
3. `T-0009f.3 Builder Repository Registration And Conflict Checks`: builder
   `add(...)`/`remove(...)`, default repository metadata where possible, and
   duplicate/conflict checks. No bus registration or dispatcher execution.
4. `T-0009f.4 Immutable Built Context Snapshot And Public Closure`: final built
   context snapshot, docs, exports, and deferred capability markers. No close,
   delivery dispatchers, system context, or storage lifecycle.
5. `T-0009f.5 Verification And Review Closure`: focused tests, docs/API checks,
   full verification, logs, and review closure. No new runtime behavior.

## Out Of Scope

- Handler invocation.
- Command/event routing or dispatch outcomes.
- Inbox or delivery storage writes.
- Event store or entity-record persistence.
- Query stand execution or subscription updates.
- System context construction.
- Server/gRPC service implementation.
- ZeroMQ or transport integration.
- Production storage adapter selection.
- Tenant index persistence.

## Decisions

- D-0045: future `@spine-ts/server` code must closely inspect task-relevant
  Spine JVM `core-jvm/server` source before creating or changing server
  runtime/API code, avoid over-inventing, and defer unsupported behavior.
- D-0046: T-0009f starts with repository and bounded-context registration seams,
  not dispatch/storage execution.

## Files Changed

- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0009f-repository-seams/TASK.md`
- `build-protocol/tasks/T-0009f-repository-seams/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009f.md`
- `build-protocol/reviews/T-0009f-repository-seams.md`

## Verification

- Baseline verification passed on `2026-06-30 05:23 WEST`: `CI=true corepack
pnpm verify` passed with 15 test files / 160 tests, coverage 97.25%
  statements / 91.41% branches / 99.16% functions / 97.19% lines, TypeDoc/API
  checks with 100 proto / 28 core / 72 server / 26 storage expected exports,
  proto lint/generate checksum verification, and generated proto output clean.
  Repeat verification after recording this evidence passed on
  `2026-06-30 05:25 WEST` with the same test count, coverage, API, proto, and
  generated-output gates clean.
- Requirements splitter completed on `2026-06-30 05:29 WEST`; no verification
  run was needed because it was read-only. Follow-up verification is pending
  after recording this split.
- `T-0009f.1 Context Spec And Builder Shell` subtask branch/worktree created on
  `2026-06-30 05:31 WEST`; baseline verification is pending.

## Human Questions And Answers

- None.
