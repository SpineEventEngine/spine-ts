# T-0009d.2c: Public API Polish, Compatibility Notes, Verification Closure

Status: Round 1 Fix Complete
Start: `2026-06-29 21:20 WEST`
Baseline commit: `5367bb8`
Task log path: `build-protocol/tasks/T-0009d2c-public-api-closure/TASK.md`
Branch: `task/T-0009d2c-public-api-closure`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009d2c-public-api-closure`
Requirements splitter: T-0009d.2 splitter
`019f14c2-9605-7d11-b8c5-3f891b1880f7` (Sartre the 2nd, closed)
Authoring sub-agent: current implementation sub-agent in this worktree; no
additional sub-agents spawned
Reviewer sub-agents: Round 1 complete; five reviewers closed
Baseline verification evidence: `CI=true corepack pnpm verify` passed on
`2026-06-29 21:25 WEST`

## Objective

Close the `T-0009d.2` transaction-kernel series by polishing public API notes,
compatibility boundaries, parent roadmap status, and verification evidence
after `T-0009d.2a` and `T-0009d.2b` are integrated.

This is a closure slice. It should clarify and verify the existing
`EntityTransaction` API surface, not introduce repositories, dispatch,
storage-backed transactions, entity base classes, async runtime phases, buses,
gRPC, ZeroMQ, lifecycle event emission, automatic versioning, or new generated
protobuf contracts.

## Required JVM Shape

Server work must inspect task-relevant Spine JVM `core-jvm/server` code before
inventing server/runtime behavior. For this closure slice, the baseline
transaction behavior was already checked against:

- `spine-jvm-docs/spine-entities-repositories-and-state.md`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Transaction.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/TransactionalEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/VersionIncrement.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/InvalidEntityStateException.java`.

Implementation impact:

- clarify the API as a JVM-familiar buffered draft/commit boundary;
- preserve D-0040, D-0041, and D-0042 behavior;
- do not broaden the server module with speculative runtime infrastructure; and
- record any additional JVM source inspection if new behavior becomes tempting.

## Skill Applicability

Canonical checklist: `BUILD_PROTOCOL.md#skills-and-tooling` remains governing.

Selected skills for this setup:

| Skill                            | Source                                                     | Applicability                           | Instructions Applied                                                       |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------- |
| `subagent-driven-development`    | `~/.agents/skills/subagent-driven-development/SKILL.md`    | Required protocol execution model.      | Dedicated authoring worker, five reviewer roles, review loop, and closure. |
| `using-git-worktrees`            | `~/.agents/skills/using-git-worktrees/SKILL.md`            | Required isolated worktree per subtask. | Created project-local `.worktrees/T-0009d2c-public-api-closure`.           |
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | Mandatory review before integration.    | Five role reviewers must inspect the committed task range.                 |
| `receiving-code-review`          | `~/.agents/skills/receiving-code-review/SKILL.md`          | Required for reviewer comments.         | Findings must be verified and fed back to a fix worker if needed.          |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims.      | Baseline and final verification must be run and recorded.                  |
| `test-driven-development`        | `~/.agents/skills/test-driven-development/SKILL.md`        | Public API/doc assertion changes.       | Add tests first if the closure exposes or tightens behavior.               |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Public generic API compatibility.       | Keep transaction generics simple and caller-owned.                         |
| `architecture-decision-records`  | `~/.agents/skills/architecture-decision-records/SKILL.md`  | Closure policy decision.                | Record D-0043 for the public API polish boundary.                          |

Skipped relevant-looking skills:

| Skill                     | Source                                              | Reason Skipped                                                                     |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `event-store-design`      | `~/.agents/skills/event-store-design/SKILL.md`      | No event persistence, append, replay, or storage behavior is in scope.             |
| `cqrs-implementation`     | `~/.agents/skills/cqrs-implementation/SKILL.md`     | Read/write segregation remains a boundary; no read-side runtime is touched.        |
| `saga-orchestration`      | `~/.agents/skills/saga-orchestration/SKILL.md`      | No process-manager workflow or compensation behavior is in scope.                  |
| `nodejs-backend-patterns` | `~/.agents/skills/nodejs-backend-patterns/SKILL.md` | No HTTP/gRPC server, middleware, or service endpoint work is in this closure task. |

Implementation sub-agent re-check on `2026-06-29 21:28 WEST`:

- Fully read the selected `SKILL.md` files for
  `test-driven-development`, `typescript-advanced-types`,
  `verification-before-completion`, and `subagent-driven-development`.
- Applied `test-driven-development` as a guard: no production behavior or API
  assertions were changed, so no new RED/GREEN test cycle was required.
- Applied `typescript-advanced-types` by preserving the existing simple
  `Schema`/`Version` generic public surface and avoiding new helper types.
- Applied `verification-before-completion` by planning fresh `format:check`,
  `docs:check`, and `CI=true corepack pnpm verify` runs before completion
  claims or commit.
- Applied only the durable-log guidance from
  `subagent-driven-development`; the task prompt forbids spawning sub-agents,
  so none were spawned.

## Scope

In scope:

- Parent `T-0009d.2` task/work-log status updates for integrated `2a`, `2b`,
  and closure `2c`.
- Public API compatibility notes for `EntityTransaction` and its helper
  contracts.
- API docs/readme polish that prevents users from reading the transaction
  kernel as storage-backed runtime machinery.
- API export gate and TypeDoc checks if the public docs surface changes.
- Focused tests only if behavior or public exported names change.
- Durable task/work/review/report logs and D-0043 decision entry.

Out of scope:

- New production runtime behavior.
- New public transaction helper methods unless a reviewer identifies a concrete
  compatibility gap that cannot be solved with docs/tests.
- Storage, repositories, entity base classes, handler invocation, async phases,
  buses, transport, lifecycle event emission, or automatic version increments.

## Decisions

- D-0043: `T-0009d.2c` is a public API compatibility and verification closure,
  not a runtime expansion.

## Human Questions And Answers

- Blocking questions: none known.
- Non-blocking questions: none known for setup.

## Files Changed

- `build-protocol/tasks/T-0009d2c-public-api-closure/TASK.md`
- `build-protocol/tasks/T-0009d2c-public-api-closure/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0009d2-entity-transaction-kernel/TASK.md`
- `build-protocol/work-logs/T-0009d2c.md`
- `build-protocol/work-logs/T-0009d2.md`
- `build-protocol/reviews/T-0009d2c-public-api-closure.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `packages/server/README.md`

## Tests Run

- Dependency hydration: escalated `corepack pnpm install` passed for the fresh
  worktree using the existing lockfile/store.
- Baseline `CI=true corepack pnpm verify` passed on
  `2026-06-29 21:25 WEST`: 14 test files / 129 tests; coverage statements
  97.61%, branches 90.51%, functions 100%, lines 97.56%; TypeDoc/API reported
  100 proto, 28 core, 59 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.
- Focused documentation/API check `corepack pnpm docs:check` passed on
  `2026-06-29 21:35 WEST` with the known invalid-origin TypeDoc warning; API
  export counts remained 100 proto, 28 core, 59 server, and 26 storage.
- Required `corepack pnpm format:check` passed on `2026-06-29 21:35 WEST`.
- Required full `CI=true corepack pnpm verify` passed on
  `2026-06-29 21:35 WEST`: 14 test files / 129 tests; coverage statements
  97.61%, branches 90.51%, functions 100%, lines 97.56%; TypeDoc/API reported
  100 proto, 28 core, 59 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.
- Round 1 fix stale-marker search passed on `2026-06-29 21:43 WEST`: the
  required `rg -n` search for stale implementation-commit-pending markers
  returned no matches across the task, review, and work-log paths.
- Round 1 fix `corepack pnpm format:check` passed on
  `2026-06-29 21:43 WEST`.
- Round 1 fix `git diff --check` passed on `2026-06-29 21:43 WEST`.

## Review Rounds

- Implementation sub-agent spawned no sub-agents per prompt.
- Round 1 reviewed implementation commit `e606cff` and requested changes.
  Maintainability and performance/reliability accepted the same P2 finding: the
  review log retained stale implementation-pending language after `e606cff`
  existed, which made the durable state interruption-risky.
- This focused fix worker updated only durable task/review/work/report logs for
  the accepted finding and spawned no sub-agents.

## Current State

- Branch/worktree exists from `5367bb8`.
- Durable setup logs are committed at `5361b7e`; baseline verification was
  recorded at `19b4805`.
- Baseline verification passed on `2026-06-29 21:25 WEST`.
- Implementation commit `e606cff` is complete and limited to public
  compatibility wording, parent roadmap cleanup, and durable evidence logs. No
  runtime/source behavior was added.
- Round 1 found one accepted P2 stale-marker issue in durable review state; the
  fix cleared that stale marker and recorded the fix path.
- No new decision was needed; D-0043 covers the closure boundary.
