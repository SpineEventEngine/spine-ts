# T-0009e: Concrete OOP Entity Base Classes With Capability Segregation

Status: T-0009e.1 Integrated; T-0009e.2 Integrated; T-0009e.3 Integrated; T-0009e.4 Pending
Start: `2026-06-29 21:58 WEST`
Baseline commit: `47eae4e`
Task log path: `build-protocol/tasks/T-0009e-entity-base-classes/TASK.md`
Branch: `task/T-0009e-entity-base-classes`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e-entity-base-classes`
Requirements splitter:
`019f1531-96a3-7870-bb40-b24fc9a456c8` (Goodall the 3rd, closed)
Authoring sub-agent: T-0009e.1, T-0009e.2, and T-0009e.3 completed in subtask branches
Reviewer sub-agents: T-0009e.1 Round 8 clean and closed; T-0009e.2 Round 11
clean and closed; T-0009e.3 Round 3 clean and closed
Baseline verification evidence: `CI=true corepack pnpm verify` passed on
`2026-06-29 22:01 WEST`

## Objective

Introduce concrete OOP entity base-class APIs for the server package in a
JVM-familiar but TypeScript-idiomatic way. The task must start small: entity
bases should expose identity, state snapshots, lifecycle/version metadata, and
scoped transaction-backed draft mutation for future repository/runtime callers.

This task must not implement repositories, handler invocation, event dispatch,
event sourcing history, process-manager command posting, query clients, storage
writes, buses, gRPC, ZeroMQ, lifecycle event emission, or hidden global runtime
state.

## Roadmap Context

The T-0009 roadmap now has these completed prerequisites:

1. `T-0009a` descriptor-derived entity metadata.
2. `T-0009b` explicit handler metadata and registry.
3. `T-0009c.1` standard decorator adapter and explicit fallback parity.
4. `T-0009d.1` built-in set-once transition validation.
5. `T-0009d.2` entity transaction draft/result kernel and closure.

Next roadmap item: this `T-0009e` entity base-class task. The following task is
`T-0009f` repository seams and bounded-context registration skeleton.

## Required JVM Shape

Server work must inspect task-relevant Spine JVM `core-jvm/server` code before
inventing behavior. Setup inspected:

- `spine-jvm-docs/spine-entities-repositories-and-state.md`, entity base,
  transaction, aggregate, projection, and process-manager sections;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Entity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/TransactionalEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/aggregate/Aggregate.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/projection/Projection.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/procman/ProcessManager.java`.

Implementation impact:

- JVM `Entity` exposes `id`, `state`, `version`, lifecycle flags, and model
  class metadata.
- JVM `AbstractEntity` owns state/version/lifecycle and validates state before
  applying updates.
- JVM `TransactionalEntity` exposes mutation only through an active
  transaction/builder and delegates lifecycle flag updates to that transaction.
- JVM family classes mostly add dispatch/repository-owned behavior; the first
  TS slice must avoid pretending those runtime phases exist.
- TypeScript should use Protobuf-ES schemas and value updates rather than Java
  builders.

## Skill Applicability

Canonical checklist: `BUILD_PROTOCOL.md#skills-and-tooling` remains governing.

Selected skills for setup:

| Skill                            | Source                                                     | Applicability                        | Instructions Applied                                                        |
| -------------------------------- | ---------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------- |
| `subagent-driven-development`    | `~/.agents/skills/subagent-driven-development/SKILL.md`    | Required protocol execution model.   | Splitter, implementer, five reviewer roles, review loop, and agent closure. |
| `using-git-worktrees`            | `~/.agents/skills/using-git-worktrees/SKILL.md`            | Required isolated worktree per task. | Created project-local `.worktrees/T-0009e-entity-base-classes`.             |
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | Mandatory review before integration. | Five role reviewers must inspect committed task ranges.                     |
| `receiving-code-review`          | `~/.agents/skills/receiving-code-review/SKILL.md`          | Required reviewer comment handling.  | Reviewer findings must be verified and fed back to fix workers.             |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims.   | Baseline and final verification must be run and recorded.                   |
| `test-driven-development`        | `~/.agents/skills/test-driven-development/SKILL.md`        | New public base-class behavior.      | Authoring workers must add RED tests before production changes.             |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Generic ID/state/version API design. | Preserve type safety without opaque type machinery.                         |
| `architecture-decision-records`  | `~/.agents/skills/architecture-decision-records/SKILL.md`  | New entity-base boundary decision.   | Record D-0044.                                                              |
| `codebase-design`                | `~/.agents/skills/codebase-design/SKILL.md`                | Deep module/API boundary design.     | Keep entity bases small and defer runtime ownership to repositories.        |

Skipped relevant-looking skills:

| Skill                 | Source                                          | Reason Skipped                                                                  |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| `event-store-design`  | `~/.agents/skills/event-store-design/SKILL.md`  | Aggregate event persistence/history is explicitly out of scope for setup.       |
| `cqrs-implementation` | `~/.agents/skills/cqrs-implementation/SKILL.md` | Read/write segregation matters, but no read-side/query runtime is in scope yet. |
| `saga-orchestration`  | `~/.agents/skills/saga-orchestration/SKILL.md`  | Process-manager workflow execution is not in the first entity-base slice.       |

## Splitter Requirement

A dedicated requirements-splitting sub-agent must refine `T-0009e` into staged
subtasks before implementation. The splitter should:

- preserve the D-0044 no-runtime-expansion boundary;
- identify the first non-blocked implementable subtask;
- decide whether family classes should be introduced in the first slice or
  deferred behind a common `TransactionalEntity` base;
- require JVM source inspection for any proposed family-specific behavior; and
- list files/docs/tests expected for each subtask.

## Splitter Result

The dedicated splitter reported no blocking questions and recommended this
staged roadmap:

1. `T-0009e.1 Common Entity State Shell`
2. `T-0009e.2 TransactionalEntity Scoped Draft Helpers`
3. `T-0009e.3 Family Capability Marker Classes`
4. `T-0009e.4 Public API Closure And Verification`

Recommended first non-blocked subtask: `T-0009e.1 Common Entity State Shell`.

`T-0009e.1` scope:

- add an abstract `Entity` base class for identity, state snapshots, version
  metadata, lifecycle flags, active/archived/deleted accessors,
  lifecycle-change tracking, and descriptor-derived metadata;
- use Protobuf-ES schema/value snapshots, not Java-style builders;
- keep state mutation out of public API; and
- avoid transactions, repositories, handler invocation, dispatch, storage,
  lifecycle events, automatic version increments, ID routing, and query support.

`T-0009e.1` expected files:

- `packages/server/src/entity.ts`
- `packages/server/src/entity.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/server/README.md`
- `docs/api/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- durable task/work/review/report logs

Splitter JVM impact notes for `T-0009e.1`:

- JVM `Entity` and `AbstractEntity` expose ID, state, version, lifecycle flags,
  active/inactive status, lifecycle-change tracking, and model metadata.
- JVM validates and updates state internally, not through arbitrary public
  mutation.
- Storage, lifecycle event emission, repository filtering, and dispatch are left
  to later infrastructure.
- TypeScript should use schema plus `EntityMetadata` instead of JVM reflection
  `EntityClass`, return cloned Protobuf-ES snapshots, keep version metadata
  caller-owned for now, and avoid Java builders, recent history, transaction
  listeners, lifecycle system events, or repositories.

## Subtask Integration

`T-0009e.1 Common Entity State Shell` was merged into this parent branch on
`2026-06-30 00:24 WEST` from
`task/T-0009e1-common-entity-state-shell`.

Integrated result:

- abstract `Entity` state shell in `packages/server/src/entity.ts`;
- focused entity/root tests and API export checks;
- public docs and architecture/API/user guide updates;
- durable task/report/work/review logs for all T-0009e.1 review rounds; and
- Round 8 clean review across code style/maintainability, documentation,
  TypeScript/API docs, security, and performance/reliability.

`T-0009e.2 TransactionalEntity Scoped Draft Helpers` was merged into this parent
branch on `2026-06-30 01:50 WEST` from
`task/T-0009e2-transactional-entity-draft-helpers`.

Integrated result:

- protected `TransactionalEntity` draft/commit/rollback helpers in
  `packages/server/src/entity.ts`;
- commit-result snapshot isolation for accepted and rejected version evidence;
- focused transaction/root tests and API export checks;
- public docs and architecture/API/user guide updates;
- durable task/report/work/review logs for all T-0009e.2 review rounds; and
- Round 11 clean review across code style/maintainability, documentation,
  TypeScript/API docs, security, and performance/reliability.

Parent integration verification passed on `2026-06-30 01:51 WEST`:
`CI=true corepack pnpm verify` reported 15 test files / 152 tests, coverage
statements 97.23%, branches 91.41%, functions 99.15%, lines 97.17%;
TypeDoc/API/proto gates passed with 68 expected server exports and generated
proto output clean.

Completed parent subtask: `T-0009e.3 Family Capability Marker Classes`.

`T-0009e.3` started on `2026-06-30 01:57 WEST` in isolated branch
`task/T-0009e3-family-capability-marker-classes` from parent commit `26aa510`.
It is scoped to thin `Aggregate`, `Projection`, and `ProcessManager` family
capability marker classes over `TransactionalEntity`. Round 3 review returned
clean across all required lanes. The family classes install locked own family
markers and avoid speculative repository, dispatch, query, process, bus,
transport, or storage APIs.

`T-0009e.3 Family Capability Marker Classes` was merged into this parent branch
on `2026-06-30 02:46 WEST` from
`task/T-0009e3-family-capability-marker-classes`.

Integrated result:

- abstract `Aggregate`, `Projection`, and `ProcessManager` family marker classes
  over `TransactionalEntity` in `packages/server/src/entity.ts`;
- locked own `entityFamily` markers typed by the `EntityFamily` union;
- focused family-marker, reflection-hardening, root export, and inherited
  transaction behavior tests;
- public package/API/user/architecture documentation updates;
- durable T-0009e.3 task/report/work/review logs; and
- Round 3 clean review across code style/maintainability, documentation,
  TypeScript/API docs, security, and performance/reliability.

Parent integration verification passed on `2026-06-30 02:46 WEST`:
`CI=true corepack pnpm verify` reported 15 test files / 158 tests, coverage
statements 97.25%, branches 91.41%, functions 99.16%, lines 97.19%;
TypeDoc/API/proto gates passed with 72 expected server exports and generated
proto output clean.

Next parent subtask: `T-0009e.4 Public API Closure And Verification`.

## Initial Scope Constraints

In scope for `T-0009e` overall:

- Public OOP base-class shapes in `@spine-ts/server`.
- Typed ID/state/schema/version/lifecycle metadata access.
- Scoped transaction/draft helpers consuming the existing `EntityTransaction`
  kernel.
- Capability segregation among aggregate/projection/process-manager families
  where it can be represented without dispatch.
- Focused tests, TypeDoc exports, package/user/API/architecture docs, durable
  logs, and decision logs.

Out of scope until later tasks:

- Repositories, entity records, storage integration, event history/snapshots,
  handler invocation, routing, buses, services, transport, process workers,
  lifecycle event emission, command posting, query clients, and Bounded Context
  assembly.

## Decisions

- D-0044: `T-0009e` entity bases start as scoped OOP state shells and must not
  broaden into repository/runtime behavior.

## Human Questions And Answers

- Blocking questions: none known.
- Non-blocking questions: none known for setup.

## Files Changed

- `build-protocol/tasks/T-0009e-entity-base-classes/TASK.md`
- `build-protocol/tasks/T-0009e-entity-base-classes/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e.md`
- `build-protocol/reviews/T-0009e-entity-base-classes.md`
- `build-protocol/DECISION_LOG.md`

## Tests Run

- Dependency hydration: escalated `corepack pnpm install` passed for the fresh
  worktree using the existing lockfile/store.
- Baseline `CI=true corepack pnpm verify` passed on
  `2026-06-29 22:01 WEST`: 14 test files / 129 tests; coverage statements
  97.61%, branches 90.51%, functions 100%, lines 97.56%; TypeDoc/API reported
  100 proto, 28 core, 59 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.
- T-0009e.2 parent integration `CI=true corepack pnpm verify` passed on
  `2026-06-30 01:51 WEST`: 15 test files / 152 tests; coverage statements
  97.23%, branches 91.41%, functions 99.15%, lines 97.17%; TypeDoc/API/proto
  gates passed with 68 expected server exports and generated proto output clean.

## Review Rounds

- T-0009e.1 completed eight review rounds; Round 8 returned clean across all
  five required reviewer lanes and all reviewers were closed.
- T-0009e.2 completed eleven review rounds; Round 11 returned clean across all
  five required reviewer lanes and all reviewers were closed.
- T-0009e.3 completed implementation plus Round 1 and Round 2 fix passes.
  Follow-up review is still pending, so this parent task does not claim a clean
  T-0009e.3 review.

## Current State

- Branch/worktree exists from `47eae4e`.
- Durable setup logs are committed at `3ff607b`.
- Baseline verification passed on `2026-06-29 22:01 WEST`.
- Requirements splitter completed with no blockers and was closed.
- `T-0009e.1 Common Entity State Shell` is merged into the parent branch with
  parent integration logs updated.
- `T-0009e.2 TransactionalEntity Scoped Draft Helpers` is merged into the parent
  branch with parent integration logs updated.
- T-0009e.2 parent integration verification passed on
  `2026-06-30 01:51 WEST`: 15 test files / 152 tests; coverage 97.23%
  statements, 91.41% branches, 99.15% functions, 97.17% lines; TypeDoc/API/proto
  gates passed with 68 expected server exports.
- `T-0009e.3 Family Capability Marker Classes` is implemented in its isolated
  branch with Round 2 fixes applied.
- Next step: run follow-up review for T-0009e.3; this parent task does not
  claim the subtask is clean until reviewers return clean.
