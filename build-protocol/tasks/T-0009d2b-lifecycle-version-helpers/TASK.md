# T-0009d.2b: Lifecycle And Version Draft Helpers

Status: In progress
Start: `2026-06-29 20:50 WEST`
End: pending
Baseline commit: `2127b86`
Task log path: `build-protocol/tasks/T-0009d2b-lifecycle-version-helpers/TASK.md`
Branch: `task/T-0009d2b-lifecycle-version-helpers`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009d2b-lifecycle-version-helpers`
Requirements splitter: T-0009d.2 splitter
`019f14c2-9605-7d11-b8c5-3f891b1880f7` (Sartre the 2nd, closed)
Authoring sub-agent: pending
Reviewer sub-agents: pending
Baseline verification evidence: pending

## Objective

Extend the minimal `EntityTransaction` kernel with small draft helpers for
lifecycle flags and explicit version metadata. The helpers must remain
in-memory draft/result behavior only: no repositories, storage, entity records,
handler dispatch, transaction phases, buses, gRPC, ZeroMQ, or runtime lifecycle
event emission.

## Required JVM Shape

Server work must inspect Spine JVM `core-jvm/server` before inventing behavior.
The orchestrator inspected:

- `build-protocol/tasks/T-0009d2-entity-transaction-kernel/TASK.md`;
- `build-protocol/DEVELOPER_API.md`, `Entity Transactions`;
- `spine-jvm-docs/spine-entities-repositories-and-state.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Transaction.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/TransactionalEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/VersionIncrement.java`.

Implementation impact:

- JVM `Transaction.setArchived()` and `setDeleted()` mutate only buffered
  lifecycle flags before commit.
- JVM `TransactionalEntity.setArchived()` and `setDeleted()` delegate to the
  active transaction, so TS helpers should require an active transaction.
- JVM rollback emits/uses the current buffered flags as rollback evidence, then
  releases the transaction.
- JVM version increments are phase/runtime-owned through `VersionIncrement`;
  this slice must not invent automatic increments. It may expose an explicit
  draft version replacement helper if it remains caller-owned metadata.

## Skill Applicability

Canonical checklist: `BUILD_PROTOCOL.md#skills-and-tooling` remains governing.

Selected skills for this setup:

| Skill                            | Source                                                     | Applicability                           | Instructions Applied                                                       |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| `subagent-driven-development`    | `~/.agents/skills/subagent-driven-development/SKILL.md`    | Required protocol execution model.      | Dedicated authoring worker, five reviewer roles, review loop, and closure. |
| `using-git-worktrees`            | `~/.agents/skills/using-git-worktrees/SKILL.md`            | Required isolated worktree per subtask. | Created project-local `.worktrees/T-0009d2b-lifecycle-version-helpers`.    |
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | Mandatory review before integration.    | Five role reviewers must inspect committed task ranges.                    |
| `receiving-code-review`          | `~/.agents/skills/receiving-code-review/SKILL.md`          | Required for review comments.           | Findings must be verified and fed back to a fix worker if needed.          |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims.      | Baseline and final verification must be run and recorded.                  |
| `test-driven-development`        | `~/.agents/skills/test-driven-development/SKILL.md`        | New helper behavior.                    | Authoring worker must add RED tests before production changes.             |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Generic version helper API.             | Preserve simple caller-owned version metadata types.                       |

Skipped relevant-looking skills:

| Skill                 | Source                                          | Reason Skipped                                                              |
| --------------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `event-store-design`  | `~/.agents/skills/event-store-design/SKILL.md`  | No event persistence, append, replay, or storage behavior is in scope.      |
| `cqrs-implementation` | `~/.agents/skills/cqrs-implementation/SKILL.md` | Read/write segregation remains a boundary; no read-side runtime is touched. |
| `saga-orchestration`  | `~/.agents/skills/saga-orchestration/SKILL.md`  | No process-manager workflow or compensation behavior is in scope.           |

## Scope

In scope:

- `EntityTransaction` helpers such as `requireActive()`, `archive()`,
  `unarchive()`, `markDeleted()`, `restore()`, and a small explicit draft
  version metadata replacement helper if useful.
- Lifecycle helpers mutate only the buffered lifecycle metadata and return a
  draft snapshot or the transaction for fluent OOP-style use.
- `requireActive()` reports archived/deleted draft flags before a handler tries
  to mutate active-only state, without storage/query filtering.
- Commit and rollback results include the updated draft lifecycle/version
  metadata.
- Focused tests, TypeDoc, package README, user/API/architecture docs if the
  public helper surface changes, durable logs, and review logs.

Out of scope:

- Automatic version increments, clocks, event versions, producer metadata, or
  phase-owned `VersionIncrement` behavior.
- Lifecycle events/diagnostics such as `EntityArchived`, `EntityDeleted`, or
  query filtering.
- Concrete `Entity`, `Aggregate`, `Projection`, or `ProcessManager` base
  classes.
- Storage/repository writes, dispatch phases, recent history, buses, gRPC,
  ZeroMQ, worker processes, or transport adapters.

## Decisions

- D-0042: lifecycle/version helpers remain caller-owned draft metadata; no
  automatic versioning or lifecycle persistence in this slice.

## Human Questions And Answers

- Blocking questions: none known.
- Non-blocking questions: none known for setup.

## Files Changed

- `build-protocol/tasks/T-0009d2b-lifecycle-version-helpers/TASK.md`
- `build-protocol/tasks/T-0009d2b-lifecycle-version-helpers/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009d2b.md`
- `build-protocol/reviews/T-0009d2b-lifecycle-version-helpers.md`
- `build-protocol/DECISION_LOG.md`

## Tests Run

- Baseline verification: pending.

## Review Rounds

- Pending implementation and five-role review loop.

## Current State

- Branch/worktree exists from `2127b86`.
- Durable setup logs are being created before authoring implementation work.
- Next step: commit setup logs, run baseline verification, then spawn the
  implementation worker.
