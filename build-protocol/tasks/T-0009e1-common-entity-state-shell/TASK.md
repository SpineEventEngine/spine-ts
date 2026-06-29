# T-0009e.1: Common Entity State Shell

Status: Setup In Progress
Start: `2026-06-29 22:06 WEST`
Baseline commit: `2ca23fd`
Task log path: `build-protocol/tasks/T-0009e1-common-entity-state-shell/TASK.md`
Branch: `task/T-0009e1-common-entity-state-shell`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e1-common-entity-state-shell`
Parent task: `T-0009e`
Requirements splitter:
`019f1531-96a3-7870-bb40-b24fc9a456c8` (Goodall the 3rd, closed)
Authoring sub-agent: pending
Reviewer sub-agents: pending
Baseline verification evidence: `CI=true corepack pnpm verify` passed on
`2026-06-29 22:12 WEST`

## Objective

Add the first common `Entity` OOP state shell in `@spine-ts/server`.

The class should expose identity, descriptor-derived metadata, state snapshots,
version metadata, lifecycle flags, active/archived/deleted accessors, and
lifecycle-change tracking. It must not expose public state setters or implement
transactions, repositories, handler invocation, dispatch, storage, lifecycle
events, automatic version increments, ID routing, query support, buses, gRPC,
ZeroMQ, or global runtime state.

## Required JVM Shape

Server work must inspect task-relevant Spine JVM `core-jvm/server` code before
inventing behavior. This subtask uses the parent task inspection:

- `spine-jvm-docs/spine-entities-repositories-and-state.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Entity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/TransactionalEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/aggregate/Aggregate.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/projection/Projection.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/procman/ProcessManager.java`.

Implementation impact for this subtask:

- JVM `Entity`/`AbstractEntity` justify ID, state, version, lifecycle flags,
  active/inactive status, lifecycle-change tracking, and model metadata.
- State values should be snapshots. No direct public mutation.
- JVM validation/update internals do not justify adding repositories, dispatch,
  lifecycle events, or storage in this subtask.
- TypeScript should use a Protobuf-ES schema and `EntityMetadata` instead of JVM
  reflection `EntityClass`.

## Scope

In scope:

- `packages/server/src/entity.ts` with common base-class types and errors if
  needed.
- Constructor/configuration options for schema, ID, initial state, version
  metadata, and lifecycle flags.
- Snapshot-style `state`, `metadata`, `version`, and `lifecycle` accessors.
- `isArchived`, `isDeleted`, `isActive`, and `lifecycleFlagsChanged` accessors.
- Protected/internal helpers only if required for construction or future
  subclasses; no public mutation helpers.
- Focused tests, root exports, API docs gate, public docs, and durable logs.

Out of scope:

- `TransactionalEntity` mutation helpers.
- `Aggregate`, `Projection`, and `ProcessManager` family classes.
- Any repository/runtime/storage/dispatch behavior.
- ID-field initialization or state-ID mismatch validation unless the
  implementation proves a tiny descriptor-safe invariant and records it.

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
- `build-protocol/tasks/T-0009e1-common-entity-state-shell/TASK.md`
- `build-protocol/tasks/T-0009e1-common-entity-state-shell/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e1.md`
- `build-protocol/reviews/T-0009e1-common-entity-state-shell.md`

## Skill Applicability

Canonical checklist: `BUILD_PROTOCOL.md#skills-and-tooling` remains governing.

Selected skills for setup:

| Skill                            | Source                                                     | Applicability                           | Instructions Applied                                                |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------- |
| `subagent-driven-development`    | `~/.agents/skills/subagent-driven-development/SKILL.md`    | Required protocol execution model.      | Dedicated implementer, five reviewer roles, review loop, closure.   |
| `using-git-worktrees`            | `~/.agents/skills/using-git-worktrees/SKILL.md`            | Required isolated worktree per subtask. | Created `.worktrees/T-0009e1-common-entity-state-shell`.            |
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | Mandatory review before integration.    | Five role reviewers must inspect committed ranges.                  |
| `receiving-code-review`          | `~/.agents/skills/receiving-code-review/SKILL.md`          | Required reviewer comment handling.     | Findings must be verified and fed back to fix workers.              |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims.      | Baseline and final verification must be run and recorded.           |
| `test-driven-development`        | `~/.agents/skills/test-driven-development/SKILL.md`        | New public entity behavior.             | Authoring worker must add RED tests before production changes.      |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Generic ID/state/version API.           | Preserve useful schema/message types without opaque type machinery. |

Skipped relevant-looking skills:

| Skill                 | Source                                          | Reason Skipped                                                         |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `event-store-design`  | `~/.agents/skills/event-store-design/SKILL.md`  | No event history, append, replay, snapshots, or storage are in scope.  |
| `cqrs-implementation` | `~/.agents/skills/cqrs-implementation/SKILL.md` | Read/write segregation is a boundary; no read-side runtime is touched. |
| `saga-orchestration`  | `~/.agents/skills/saga-orchestration/SKILL.md`  | Process-manager workflow behavior is out of scope.                     |

## Decisions

- D-0044: entity bases start as scoped OOP state shells and must not broaden
  into repository/runtime behavior.

## Human Questions And Answers

- Blocking questions: none known.
- Non-blocking questions: none known for setup.

## Files Changed

- `build-protocol/tasks/T-0009e1-common-entity-state-shell/TASK.md`
- `build-protocol/tasks/T-0009e1-common-entity-state-shell/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e1.md`
- `build-protocol/reviews/T-0009e1-common-entity-state-shell.md`

## Tests Run

- Dependency hydration: escalated `corepack pnpm install` passed for the fresh
  worktree using the existing lockfile/store.
- Baseline `CI=true corepack pnpm verify` passed on
  `2026-06-29 22:12 WEST`: 14 test files / 129 tests; coverage statements
  97.61%, branches 90.51%, functions 100%, lines 97.56%; TypeDoc/API reported
  100 proto, 28 core, 59 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.

## Review Rounds

- Pending implementation.

## Current State

- Branch/worktree exists from `2ca23fd`.
- Durable setup logs are committed at `d9c5494`.
- Baseline verification passed on `2026-06-29 22:12 WEST`.
- Implementation delegation is next.
