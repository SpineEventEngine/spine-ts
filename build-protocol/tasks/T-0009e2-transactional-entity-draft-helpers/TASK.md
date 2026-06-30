# T-0009e.2: TransactionalEntity Scoped Draft Helpers

Status: Implementation Complete; Round 5 Clean Review Recorded
Start: `2026-06-30 00:28 WEST`
Baseline commit: `bd8d02e`
Task log path:
`build-protocol/tasks/T-0009e2-transactional-entity-draft-helpers/TASK.md`
Branch: `task/T-0009e2-transactional-entity-draft-helpers`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e2-transactional-entity-draft-helpers`
Parent task: `T-0009e`
Requirements splitter:
`019f1531-96a3-7870-bb40-b24fc9a456c8` (Goodall the 3rd, closed)
Authoring sub-agent:
`019f15ba-f2f2-7f21-a244-bd61564e0eb6` (Aquinas the 3rd)
Reviewer sub-agents: Round 1 closed; Round 2 closed; Round 3 closed; Round 4
closed; Round 5 clean and closed
Baseline verification evidence: `CI=true corepack pnpm verify` passed on
`2026-06-30 00:31 WEST`

## Objective

Add the small `TransactionalEntity` OOP base layer in `@spine-ts/server`.

The class should extend the common `Entity` shell from `T-0009e.1` and expose a
protected, scoped transaction/draft interface backed by the existing
`EntityTransaction` kernel. It should let future entity-family subclasses start a
single active in-memory transaction, mutate the draft through narrow protected
helpers, commit accepted transaction results back into the entity, and rollback
without touching repositories, handlers, buses, storage, or runtime dispatch.

## Required JVM Shape

Server work must inspect task-relevant Spine JVM `core-jvm/server` code before
inventing behavior. This subtask inspected:

- `spine-jvm-docs/spine-entities-repositories-and-state.md`, especially
  `TransactionalEntity`, transaction builder/draft, lifecycle flags, and
  implementation-notes sections;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/TransactionalEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Transaction.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`.

Implementation impact for this subtask:

- JVM `TransactionalEntity` exposes state mutation only while an active
  transaction is injected.
- JVM `Transaction` buffers state, version, and lifecycle flags and applies them
  to the entity only on commit.
- JVM `changed()` considers transaction state changes plus lifecycle flag
  changes; TS should expose a similarly small changed signal without adding
  repository storage decisions.
- This TypeScript slice should not implement JVM phase propagation, version
  increments, transaction listeners, recent history, handler invocation,
  lifecycle events, storage writes, or family-specific restrictions.

## Scope

In scope:

- a public abstract `TransactionalEntity` base class in
  `packages/server/src/entity.ts` or a closely matching server module;
- protected helpers for starting, accessing, committing, and rolling back one
  active transaction;
- protected draft helpers that delegate to `EntityTransaction` for state update,
  lifecycle flags, and version metadata;
- a deterministic error for missing/duplicate/closed transaction access if the
  existing transaction errors are not sufficient;
- tests proving transaction scope, commit/rollback behavior, snapshot isolation,
  lifecycle/version propagation, and no public state setters;
- root exports, API docs gate, server README, API/user/architecture docs, and
  durable logs.

Out of scope:

- repositories, entity records, storage integration, event history, snapshots,
  handler invocation, routing, buses, services, transport, process workers,
  command posting, query clients, lifecycle event emission, automatic version
  increments, transaction listeners, recent history, and family-specific
  aggregate/projection/process-manager behavior.

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
- `build-protocol/tasks/T-0009e2-transactional-entity-draft-helpers/TASK.md`
- `build-protocol/tasks/T-0009e2-transactional-entity-draft-helpers/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009e2.md`
- `build-protocol/reviews/T-0009e2-transactional-entity-draft-helpers.md`

## Skill Applicability

Canonical checklist: `BUILD_PROTOCOL.md#skills-and-tooling` remains governing.

Selected skills for setup:

| Skill                            | Source                                                     | Applicability                           | Instructions Applied                                                 |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------- |
| `subagent-driven-development`    | `~/.agents/skills/subagent-driven-development/SKILL.md`    | Required protocol execution model.      | Dedicated implementer, five reviewer roles, review loop, closure.    |
| `using-git-worktrees`            | `~/.agents/skills/using-git-worktrees/SKILL.md`            | Required isolated worktree per subtask. | Created `.worktrees/T-0009e2-transactional-entity-draft-helpers`.    |
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | Mandatory review before integration.    | Five role reviewers must inspect committed ranges.                   |
| `receiving-code-review`          | `~/.agents/skills/receiving-code-review/SKILL.md`          | Required reviewer comment handling.     | Findings must be verified and fed back to fix workers.               |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims.      | Baseline and final verification must be run and recorded.            |
| `test-driven-development`        | `~/.agents/skills/test-driven-development/SKILL.md`        | New public base-class behavior.         | Authoring worker must add RED tests before production changes.       |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Generic ID/state/version API.           | Preserve useful type inference without opaque type machinery.        |
| `codebase-design`                | `~/.agents/skills/codebase-design/SKILL.md`                | Entity base interface design.           | Keep a small protected interface over existing transaction behavior. |

Skipped relevant-looking skills:

| Skill                 | Source                                          | Reason Skipped                                                         |
| --------------------- | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `event-store-design`  | `~/.agents/skills/event-store-design/SKILL.md`  | No event history, append, replay, snapshots, or storage are in scope.  |
| `cqrs-implementation` | `~/.agents/skills/cqrs-implementation/SKILL.md` | Read/write segregation is a boundary; no read-side runtime is touched. |
| `saga-orchestration`  | `~/.agents/skills/saga-orchestration/SKILL.md`  | Process-manager workflow behavior is out of scope.                     |

## Decisions

- D-0044: entity bases start as scoped OOP state shells and must not broaden
  into repository/runtime behavior.
- D-0039: server work must stay JVM-familiar and inspect task-relevant
  `core-jvm/server` code before broadening behavior.
- Rejected `TransactionalEntity` commits keep the scoped transaction active for
  correction or explicit rollback, matching the current
  `EntityTransaction.commit()` accepted/rejected behavior.

## Human Questions And Answers

- Blocking questions: none known.
- Non-blocking questions: none known for setup.

## Current State

- Branch/worktree exists on
  `task/T-0009e2-transactional-entity-draft-helpers` at baseline `bd8d02e`.
- Parent `T-0009e.1` integration passed full verification before this branch was
  created.
- Baseline verification passed on `2026-06-30 00:31 WEST`: 15 test files / 145
  tests; coverage 97.31% statements / 91.28% branches / 100% functions / 97.25%
  lines; TypeDoc/API/proto gates passed with 64 expected server exports.
- Authoring sub-agent `019f15ba-f2f2-7f21-a244-bd61564e0eb6` (Aquinas the 3rd)
  added RED tests and implemented the scoped `TransactionalEntity` draft helper
  layer. Focused GREEN verification passed on `2026-06-30 00:37 WEST`:
  `corepack pnpm vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  reported 2 files / 31 tests passing.
- Final verification passed on `2026-06-30 00:41 WEST`:
  `CI=true corepack pnpm verify` reported 15 test files / 151 tests passing,
  coverage statements 97.22%, branches 91.37%, functions 99.14%, lines 97.16%;
  TypeDoc/API/proto gates passed with 68 expected server exports and generated
  proto output clean.
- Implementation commit `13f8a05` and verification evidence commit `a7acaca`
  were reviewed in Round 1 over range `4e250b2..a7acaca`.
- Round 1 review requested changes for rejected commit version result snapshot
  isolation and stale durable status wording. The focused fix was implemented,
  verified, and reviewed in Round 2.
- Round 2 reviewed committed range `a7acaca..4246385`; four lanes returned
  clean and documentation requested one header-status cleanup. All Round 2
  reviewers were closed. The docs-only cleanup is verified and was reviewed in
  Round 3.
- Round 3 reviewed committed range `4246385..bd4052a`; three lanes returned
  clean and maintainability/documentation/reliability requested stale live-state
  routing cleanup. All Round 3 reviewers were closed.
- Round 3 docs-only cleanup verification passed on `2026-06-30 01:07 WEST`:
  full `CI=true corepack pnpm verify` reported 15 test files / 152 tests,
  coverage statements 97.23%, branches 91.41%, functions 99.15%, lines 97.17%;
  TypeDoc/API/proto gates passed with 68 expected server exports and generated
  proto output clean.
- Round 4 reviewed the Round 3 docs-only cleanup: TypeScript/API docs and
  security returned clean; maintainability, documentation, and
  performance/reliability requested stale durable-review-history and
  completed-risk-routing cleanup. All Round 4 reviewers were closed.
- Round 4 docs-only follow-up updated the live reviewer status, completed
  rejected-result risk routing, chronological review-log ordering, and durable
  Round 4 review result.
- Round 4 docs-only cleanup verification passed on `2026-06-30 01:16 WEST`:
  full `CI=true corepack pnpm verify` reported 15 test files / 152 tests,
  coverage statements 97.23%, branches 91.41%, functions 99.15%, lines 97.17%;
  TypeDoc/API/proto gates passed with 68 expected server exports and generated
  proto output clean.
- Round 5 reviewed committed range `23b757f..f97701a`; all five lanes returned
  clean and all reviewer handles were closed. No implementation, API,
  documentation, security, or reliability follow-up remains for T-0009e.2.
