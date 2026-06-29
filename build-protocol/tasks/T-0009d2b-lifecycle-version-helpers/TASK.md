# T-0009d.2b: Lifecycle And Version Draft Helpers

Status: Complete
Start: `2026-06-29 20:50 WEST`
End: `2026-06-29 21:17 WEST`
Baseline commit: `2127b86`
Task log path: `build-protocol/tasks/T-0009d2b-lifecycle-version-helpers/TASK.md`
Branch: `task/T-0009d2b-lifecycle-version-helpers`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009d2b-lifecycle-version-helpers`
Requirements splitter: T-0009d.2 splitter
`019f14c2-9605-7d11-b8c5-3f891b1880f7` (Sartre the 2nd, closed)
Authoring sub-agent:
`019f14f3-f9bd-7633-83fe-c447260122c6` (Ramanujan the 2nd, closed)
Reviewer sub-agents:
`019f1500-e9e6-7290-ac3e-f2d7273aa79c`,
`019f1500-ea69-79c2-9c0c-a0eca1b0408a`,
`019f1500-eace-74f0-8bd8-c500411fcfaa`,
`019f1500-eb70-78e0-b2c8-edf650aac991`,
`019f1500-ebd7-7751-9255-8fca64c8fcee` (all closed)
Baseline verification evidence: `CI=true corepack pnpm verify` passed on
`2026-06-29 20:54 WEST`

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

Implementation sub-agent re-check on `2026-06-29 20:57 WEST`:

- Session skill inventory exposed included task-relevant built-in and
  user-installed skills: `subagent-driven-development`,
  `test-driven-development`, `javascript-testing-patterns`,
  `typescript-advanced-types`, and `verification-before-completion`.
- Task prompt explicitly required `test-driven-development`,
  `typescript-advanced-types`, `verification-before-completion`, use of
  `subagent-driven-development` guidance, and `javascript-testing-patterns` if
  useful. `javascript-testing-patterns` is useful because this task adds focused
  Vitest coverage.
- Checked repo expected manifest with `sed -n '1,260p'
build-protocol/skills/EXPECTED_SKILLS.md`.
- Enumerated readable user-installed entrypoints with `find
/Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
- Inspected installed-skill lock evidence with `sed -n '1,260p'
/Users/armiol/.agents/.skill-lock.json` and targeted `rg` for task-relevant
  skills in that lock file.
- Fully read selected `SKILL.md` files before implementation actions:
  `~/.agents/skills/subagent-driven-development/SKILL.md`,
  `~/.agents/skills/test-driven-development/SKILL.md`,
  `~/.agents/skills/javascript-testing-patterns/SKILL.md`,
  `~/.agents/skills/typescript-advanced-types/SKILL.md`, and
  `~/.agents/skills/verification-before-completion/SKILL.md`.
- Conflict resolution: `subagent-driven-development` normally dispatches
  sub-agents, but the orchestrator prompt explicitly says "Do not spawn
  sub-agents." The implementation sub-agent will apply its durable ledger,
  scoped execution, and review discipline manually and will spawn no sub-agents.
- Skipped relevant-looking installed skills: `event-store-design`,
  `cqrs-implementation`, and `saga-orchestration` for the same out-of-scope
  reasons above; `nodejs-backend-patterns` because no server process/API
  infrastructure changes are in scope; `using-git-worktrees`,
  `requesting-code-review`, and `receiving-code-review` because the worktree
  and review orchestration already exist and this prompt forbids spawning
  reviewer sub-agents from this implementation role.

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
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `packages/server/README.md`
- `packages/server/src/entity-transaction.ts`
- `packages/server/src/entity-transaction.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`

## Tests Run

- Dependency hydration: escalated `corepack pnpm install` passed for the fresh
  worktree using the existing lockfile/store.
- Baseline `CI=true corepack pnpm verify` passed on
  `2026-06-29 20:54 WEST`: 14 test files / 123 tests; coverage statements
  97.51%, branches 90.28%, functions 100%, lines 97.46%; TypeDoc/API check
  reported 100 proto, 28 core, 56 server, and 26 storage expected exports;
  proto lint/generate/check passed.
- RED focused `corepack pnpm exec vitest run
packages/server/src/entity-transaction.test.ts packages/server/src/index.test.ts`
  failed as expected on `2026-06-29 20:59 WEST`: 7 failures for missing
  `archive`, `markDeleted`, `requireActive`, `updateVersionMetadata`, and root
  `EntityTransactionDraftStateError`.
- GREEN focused `corepack pnpm exec vitest run
packages/server/src/entity-transaction.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 21:04 WEST`: 2 test files / 27 tests.
- `corepack pnpm typecheck` passed on `2026-06-29 21:04 WEST`.
- `corepack pnpm lint` passed on `2026-06-29 21:04 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-29 21:04 WEST` with the known
  invalid-origin TypeDoc warning; API gate reported 100 proto, 28 core, 59
  server, and 26 storage expected exports.
- `corepack pnpm format:check` passed on `2026-06-29 21:04 WEST`.
- `CI=true corepack pnpm verify` passed on `2026-06-29 21:05 WEST`: 14 test
  files / 129 tests; coverage statements 97.61%, branches 90.51%, functions
  100%, lines 97.56%; TypeDoc/API and proto workflow passed with the known
  invalid-origin TypeDoc warning.
- Final branch `CI=true corepack pnpm verify` passed on
  `2026-06-29 21:17 WEST`: 14 test files / 129 tests; coverage statements
  97.61%, branches 90.51%, functions 100%, lines 97.56%; TypeDoc/API reported
  100 proto, 28 core, 59 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.

## Review Rounds

- Implementation sub-agent spawned no sub-agents per prompt.
- Orchestrator-level Round 1 five-role review completed on
  `2026-06-29 21:14 WEST` against implementation commit `3bdf076`.
- Code style/maintainability, documentation, TypeScript/API docs, security, and
  performance/reliability reviewers all reported clean.
- Reviewer IDs and evidence are recorded in
  `build-protocol/reviews/T-0009d2b-lifecycle-version-helpers.md`.
- All reviewer sub-agents were closed after result capture.
- No comments required a fix round. No reviewer comments were rejected.

## Current State

- Branch/worktree exists from `2127b86`.
- Durable setup logs are committed through baseline `7a9363e`.
- Implementation and mandatory review loop are complete and clean.
- Final branch verification passed on `2026-06-29 21:17 WEST`.
