# T-0009e.1: Common Entity State Shell

Status: Round 3 Review Fix Required
Start: `2026-06-29 22:06 WEST`
Baseline commit: `2ca23fd`
Task log path: `build-protocol/tasks/T-0009e1-common-entity-state-shell/TASK.md`
Branch: `task/T-0009e1-common-entity-state-shell`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009e1-common-entity-state-shell`
Parent task: `T-0009e`
Requirements splitter:
`019f1531-96a3-7870-bb40-b24fc9a456c8` (Goodall the 3rd, closed)
Authoring sub-agent: Codex implementation sub-agent in this thread
Round 1 reviewer sub-agents: complete; changes requested and accepted.
Round 2 reviewer sub-agents: complete; changes requested and accepted.
Round 3 reviewer sub-agents: complete; changes requested and accepted.
Review-fix implementation: second pass implemented for version metadata
contract hardening; third pass queued for descriptor-safe cloning and generic
constraint fixes.
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

## Tests Run

- Dependency hydration: escalated `corepack pnpm install` passed for the fresh
  worktree using the existing lockfile/store.
- Baseline `CI=true corepack pnpm verify` passed on
  `2026-06-29 22:12 WEST`: 14 test files / 129 tests; coverage statements
  97.61%, branches 90.51%, functions 100%, lines 97.56%; TypeDoc/API reported
  100 proto, 28 core, 59 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.
- RED focused check `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  failed on `2026-06-29 22:18 WEST` because `Entity` was not exported and the
  new entity test could not subclass it.
- GREEN focused check `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 22:19 WEST`: 2 test files / 14 tests.
- Initial final verification attempt `CI=true corepack pnpm verify` failed on
  `2026-06-29 22:25 WEST` at the coverage threshold: branch coverage was
  89.73% against the 90% global threshold.
- Coverage follow-up focused check `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 22:25 WEST`: 2 test files / 15 tests.
- `corepack pnpm typecheck`, `corepack pnpm lint`,
  `corepack pnpm format:check`, and `corepack pnpm docs:check` passed on
  `2026-06-29 22:26 WEST`; TypeDoc reported 62 expected server exports.
- Final `CI=true corepack pnpm verify` passed on `2026-06-29 22:27 WEST`: 15
  test files / 135 tests; coverage statements 97.69%, branches 90.9%,
  functions 100%, lines 97.64%; TypeDoc/API reported 100 proto, 28 core, 62
  server, and 26 storage expected exports; proto lint/generate/check passed
  with generated output clean.
- Review-fix RED focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` failed on
  `2026-06-29 22:35 WEST` as expected: 1 test file / 8 tests, with 2 failures
  covering constructor/getter and protected replacement version metadata
  aliasing.
- Review-fix GREEN focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` passed on
  `2026-06-29 22:36 WEST`: 1 test file / 8 tests.
- Review-fix focused root/API check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 22:37 WEST`: 2 test files / 17 tests.
- Targeted stale-marker search for live implementation-precommit wording in
  T-0009e.1 task/report/work/review logs found no matches on
  `2026-06-29 22:37 WEST`.
- Review-fix `corepack pnpm typecheck` first failed on `2026-06-29 22:37 WEST`
  because the regression tests intentionally mutated readonly metadata through
  casts; after making the casts explicit through `unknown`, rerun passed.
- Review-fix `corepack pnpm lint` passed on `2026-06-29 22:38 WEST`.
- Review-fix `corepack pnpm format:check` first found the edited work log on
  `2026-06-29 22:38 WEST`; after formatting that file, rerun passed.
- Review-fix `CI=true corepack pnpm verify` passed on
  `2026-06-29 22:38 WEST`: 15 test files / 137 tests; coverage statements
  97.7%, branches 90.72%, functions 100%, lines 97.65%; TypeDoc/API reported
  100 proto, 28 core, 62 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.
- Round 2 fix RED focused check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts` failed on
  `2026-06-29 22:52 WEST` as expected: 1 test file / 10 tests, with 1 failure
  because non-plain version metadata was still accepted.
- Round 2 fix GREEN focused root/API check
  `corepack pnpm exec vitest run packages/server/src/entity.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 22:56 WEST`: 2 test files / 19 tests.
- Round 2 fix `corepack pnpm typecheck`, `corepack pnpm lint`,
  `corepack pnpm format:check`, and `corepack pnpm docs:check` passed on
  `2026-06-29 22:56 WEST`; TypeDoc/API reported 63 expected server exports.
- Round 2 fix `CI=true corepack pnpm verify` passed on
  `2026-06-29 23:03 WEST`: 15 test files / 139 tests; coverage statements
  97.69%, branches 91.24%, functions 100%, lines 97.64%; TypeDoc/API reported
  100 proto, 28 core, 63 server, and 26 storage expected exports; proto
  lint/generate/check passed with generated output clean.

## Review Rounds

- Round 1 reviewed implementation commit `4ade81d`; result: changes
  requested.
- Accepted P2 finding: object-shaped `Version` metadata was stored and returned
  by reference, allowing mutation outside `replaceVersionMetadata()`.
- Accepted P2 finding: durable task/work/review/report logs retained stale
  pre-commit wording after implementation commit `4ade81d`.
- Fix route: add RED regression tests for constructor/getter and protected
  replacement version snapshot isolation, then clone structured-clone-compatible
  object version metadata at constructor, accessor, and protected replacement
  boundaries.
- Round 2 reviewed review-fix commit `aef6297`; result: changes requested.
- Accepted P2 finding: `structuredClone()` leaves a shared-memory mutation path
  for `SharedArrayBuffer`-backed typed arrays.
- Accepted P2 finding: `structuredClone()` is a fragile contract for
  unconstrained generic `Version` metadata because it rejects functions and
  changes prototype-bearing objects.
- Fix route: define version metadata as plain snapshot data and replace
  `structuredClone()` with an explicit clone/rejection helper covered by
  focused regressions.
- Round 2 fix implemented: version metadata now uses an explicit
  `EntityVersionMetadata` plain snapshot data contract, rejects non-plain
  object graphs, and keeps nested plain metadata isolated at construction,
  read, and protected replacement boundaries.
- Round 3 reviewed Round 2 fix commit `50a1802`; result: changes requested.
- Accepted P2/API finding: `Version` generics must be constrained to
  `EntityVersionMetadata` so compile-time API matches the runtime contract.
- Accepted security/reliability findings: array cloning must avoid
  `Array.prototype.map()` and descriptor/accessor execution, object cloning must
  avoid `__proto__` prototype mutation, rejection labels must not read
  caller-controlled constructors, deep metadata must reject with a domain error
  instead of overflowing the stack, and array custom own properties must not be
  silently dropped.
- Fix route: harden descriptor-based plain metadata cloning, add focused RED
  regressions, update logs/docs if public wording changes, verify, and rerun all
  five review roles.

## Current State

- Branch/worktree exists on `task/T-0009e1-common-entity-state-shell` at
  baseline `ae5110c`.
- Round 1 review was captured in commit `bff6e5e`.
- Common abstract `Entity` state shell implementation exists in commit
  `4ade81d`.
- This review-fix pass addressed accepted Round 1 findings with focused
  regression coverage and durable-log cleanup.
- Round 2 review was captured after commit `aef6297`; the accepted metadata
  contract findings have been addressed with focused regressions, docs/API
  updates, and full verification.
- Round 3 review was captured after commit `50a1802`; the accepted findings
  require another focused review-fix pass before completion.
