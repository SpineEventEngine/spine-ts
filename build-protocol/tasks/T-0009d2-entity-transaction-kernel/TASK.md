# T-0009d.2: Entity Transaction Draft/Result Kernel

Status: `T-0009d.2a` and `T-0009d.2b` complete and integrated to `main`;
`T-0009d.2c` public API closure in progress
Start: `2026-06-29 19:58 WEST`
End: `T-0009d.2a` integrated `2026-06-29 20:47 WEST`; `T-0009d.2b`
integrated `2026-06-29 21:19 WEST`; `T-0009d.2c` pending final review and
integration
Baseline commit: `3d08195`
Task log path: `build-protocol/tasks/T-0009d2-entity-transaction-kernel/TASK.md`
Branch: `task/T-0009d2-entity-transaction-kernel`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009d2-entity-transaction-kernel`
Requirements splitter: `019f14c2-9605-7d11-b8c5-3f891b1880f7` (Sartre the 2nd, closed)
Authoring sub-agent: `019f14c7-1e68-73e3-a228-d0ce2dc487bf` (Boyle the 2nd, closed)
Review-fix sub-agent: `019f14db-1a42-7291-985e-46a44d0c00e3` (Kuhn the 2nd, closed)
Reviewer sub-agents:

- Round 1 code style/maintainability:
  `019f14d7-fdca-7030-9e3f-cba488c467e1` (Carson the 2nd, closed)
- Round 1 documentation:
  `019f14d7-fe57-7840-adb9-f1425c74df13` (Dewey the 2nd, closed)
- Round 1 TypeScript/API docs:
  `019f14d7-fec9-78f3-b964-7dbda8f50b8b` (Godel the 2nd, closed)
- Round 1 security:
  `019f14d7-ff46-7b22-8b2b-ccc03d6d3c6a` (Maxwell the 2nd, closed)
- Round 1 performance/reliability:
  `019f14d8-039b-75e0-a6fd-dd1a2bbe5526` (Plato the 2nd, closed)
- Round 2 code style/maintainability:
  `019f14e4-9a52-7162-adb0-816465957fa2` (Huygens the 2nd, closed)
- Round 2 documentation:
  `019f14e4-9aca-7871-8107-1a85a798ba42` (Hubble the 2nd, closed)
- Round 2 TypeScript/API docs:
  `019f14e4-9b31-7153-85e1-b3f76562e306` (Parfit the 2nd, closed)
- Round 2 security:
  `019f14e4-9bc3-7213-9028-a9fc38b43240` (Archimedes the 2nd, closed)
- Round 2 performance/reliability:
  `019f14e4-9c35-71b3-a777-5a68966374d0` (Bacon the 2nd, closed)

Baseline verification evidence: `CI=true corepack pnpm verify` passed on
`2026-06-29 20:02 WEST`

## Objective

Add the first server transaction draft/result kernel for entity state updates.
The slice must remain smaller than repositories or dispatch: it should model a
framework-owned transaction as an active draft over previous state, proposed
next state, lifecycle flags, version metadata, commit/rollback status, and
structured validation result. The kernel must consume
`validateEntityStateTransition()` from `T-0009d.1` so `(set_once)` is enforced
before commit results are accepted.

## Required JVM Shape

Per the human note added to `BUILD_PROTOCOL.md`, server work must closely
inspect Spine JVM `core-jvm/server` before inventing runtime behavior. The
orchestrator inspected these task-relevant sources before implementation:

- `spine-jvm-docs/spine-entities-repositories-and-state.md`, especially
  "Transactions and State Builders";
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Transaction.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/TransactionalEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`;
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/InvalidEntityStateException.java`.

Implementation impact:

- keep transaction state buffered until commit;
- expose mutation through an explicit draft/update function rather than public
  entity setters;
- keep active/released transaction status visible to tests and future entity
  bases;
- validate proposed state at commit and return structured failures instead of
  mutating the entity;
- keep version/lifecycle metadata as draft/result data only in this slice; and
- avoid storage, repositories, handler dispatch, phases, buses, gRPC, or
  ZeroMQ.

## Skill Applicability

Canonical checklist: `BUILD_PROTOCOL.md#skills-and-tooling` remains governing.

Selected skills read or already available in this resumed root session before
task setup:

| Skill                            | Source                                                     | Applicability                           | Instructions Applied                                                            |
| -------------------------------- | ---------------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| `subagent-driven-development`    | `~/.agents/skills/subagent-driven-development/SKILL.md`    | Required protocol execution model.      | Dedicated splitter, implementer, five reviewer roles, review loop, and closure. |
| `using-git-worktrees`            | `~/.agents/skills/using-git-worktrees/SKILL.md`            | Required isolated worktree per task.    | Project-local `.worktrees` branch/worktree was created for this task.           |
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | Mandatory review before completion.     | Five role reviews must inspect committed task ranges.                           |
| `receiving-code-review`          | `~/.agents/skills/receiving-code-review/SKILL.md`          | Required handling of reviewer comments. | Reviewer findings must be verified and fed back to the authoring agent.         |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims.      | Baseline and final verification must be run and recorded.                       |
| `test-driven-development`        | `~/.agents/skills/test-driven-development/SKILL.md`        | New transaction behavior.               | Authoring agent must add RED tests before production code.                      |
| `javascript-testing-patterns`    | `~/.agents/skills/javascript-testing-patterns/SKILL.md`    | Vitest behavior coverage.               | Tests should cover lifecycle/commit/rollback and validation boundaries.         |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Generic transaction API.                | Preserve useful schema/message types without opaque type machinery.             |
| `architecture-decision-records`  | `~/.agents/skills/architecture-decision-records/SKILL.md`  | New server transaction decision.        | Record the bounded JVM-familiar transaction kernel decision.                    |

Task-relevant skill inventory evidence:

- Session skill inventory exposed the selected skills above plus adjacent
  runtime/design skills including `architecture-patterns`,
  `cqrs-implementation`, `event-store-design`, `nodejs-backend-patterns`, and
  `projection-patterns`.
- Repo manifest checked:
  `build-protocol/skills/EXPECTED_SKILLS.md`.
- User-installed skill entrypoints are reachable at
  `/Users/armiol/.agents/skills/*/SKILL.md` and will be checked by sub-agents
  in their own role logs.

Skipped relevant-looking skills:

| Skill                     | Source                                              | Reason Skipped                                                                  |
| ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------- |
| `cqrs-implementation`     | `~/.agents/skills/cqrs-implementation/SKILL.md`     | Read/write segregation matters, but this slice has no query/read model runtime. |
| `event-store-design`      | `~/.agents/skills/event-store-design/SKILL.md`      | No event persistence, append, replay, or storage adapter is in scope.           |
| `saga-orchestration`      | `~/.agents/skills/saga-orchestration/SKILL.md`      | No process-manager dispatch or compensation workflow is in scope.               |
| `nodejs-backend-patterns` | `~/.agents/skills/nodejs-backend-patterns/SKILL.md` | No HTTP/gRPC server, middleware, or service endpoint is in scope.               |

### Round 1 Review-Fix Skill Applicability Check

Checked at `2026-06-29 20:29 WEST` before review-fix source, test, or docs
edits.

Inventory evidence:

- Session skill inventory exposed the task-required skills:
  `receiving-code-review`, `test-driven-development`,
  `typescript-advanced-types`, and `verification-before-completion`, plus
  adjacent `javascript-testing-patterns`.
- Task prompt explicitly required `receiving-code-review`,
  `test-driven-development` or `javascript-testing-patterns`,
  `typescript-advanced-types`, and `verification-before-completion`.
- Repo manifest checked with `cat build-protocol/skills/EXPECTED_SKILLS.md`.
- User-installed entrypoints checked with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
- Installed lock checked with
  `rg -n "receiving-code-review|test-driven-development|javascript-testing-patterns|typescript-advanced-types|verification-before-completion" /Users/armiol/.agents/.skill-lock.json`.

Selected skills fully read before use:

| Skill                            | Source                                                                 | Applicability                                      | Instructions Applied                                                                  |
| -------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `receiving-code-review`          | `/Users/armiol/.agents/skills/receiving-code-review/SKILL.md`          | Required for round 1 reviewer findings.            | Verify each finding against the codebase, implement accepted fixes, and record scope. |
| `test-driven-development`        | `/Users/armiol/.agents/skills/test-driven-development/SKILL.md`        | Focused assertion additions and behavior coverage. | Add focused tests first; record assertion-only coverage when behavior already passes. |
| `typescript-advanced-types`      | `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md`      | Generic version metadata API change.               | Preserve caller metadata types with simple generic parameters and type coverage.      |
| `verification-before-completion` | `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md` | Required before final claims and commit.           | Run fresh targeted and full verification before reporting completion.                 |

Skipped relevant-looking skills:

| Skill                           | Source                                                                | Reason Skipped                                                                                     |
| ------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `javascript-testing-patterns`   | `/Users/armiol/.agents/skills/javascript-testing-patterns/SKILL.md`   | TDD skill covers the focused Vitest additions; no mocks or new shared test utilities are expected. |
| `architecture-decision-records` | `/Users/armiol/.agents/skills/architecture-decision-records/SKILL.md` | Review fixes apply existing D-0040/D-0041 decisions; no new decision is planned.                   |
| `requesting-code-review`        | `/Users/armiol/.agents/skills/requesting-code-review/SKILL.md`        | This turn fixes already-received review findings; it does not spawn or request review sub-agents.  |

## Scope

In scope:

- Public transaction draft/result API in `@spine-ts/server`.
- Generic state schema typing with Protobuf-ES `MessageShape`.
- Explicit transaction lifecycle: active, committed, rolled back/released.
- Draft update helper equivalent in spirit to JVM builder access.
- Commit-time transition validation through `validateEntityStateTransition()`.
- Structured commit result that reports previous state, next state, version,
  lifecycle flags, and validation failures without storage side effects.
- Focused tests, public exports, TypeDoc comments, package README,
  user/API/architecture docs, durable logs, and decision log updates.

Out of scope:

- Concrete `Aggregate`, `Projection`, `ProcessManager`, or `Entity` base
  classes.
- Handler invocation, event application, dispatcher phases, recent history, or
  repositories.
- Storage writes/reads, snapshots, entity records, query/subscription runtime,
  buses, gRPC, ZeroMQ, worker processes, or transport adapters.
- Automatic ID-field initialization from entity ID unless the splitter proves a
  very small descriptor-backed helper is needed for this slice.

## Splitter Result

The dedicated splitter reported no blocking questions and recommended three
staged subtasks:

1. `T-0009d.2a Minimal Transaction Draft/Commit Kernel`
2. `T-0009d.2b Lifecycle And Version Draft Helpers`
3. `T-0009d.2c Public API Polish, Compatibility Notes, Verification Closure`

Recommended first implementable subtask: `T-0009d.2a`.

`T-0009d.2a` scope:

- add the first public transaction module in `@spine-ts/server`;
- model `schema`, `previous`, draft next state, lifecycle flags, version
  metadata, and status;
- expose an OOP-style generic API such as `EntityTransaction<Schema>` with
  `update(fn)`, `commit()`, `rollback()`, `status`, `previous`, and
  `currentDraft`;
- call `validateEntityStateTransition({ schema, previous, next })` during
  commit;
- return a rejected commit result with validator violations when transition
  validation fails; and
- avoid storage, repositories, handler invocation, phases, concrete entity
  classes, buses, gRPC, ZeroMQ, and entity records.

`T-0009d.2a` owned files:

- `packages/server/src/entity-transaction.ts`
- `packages/server/src/entity-transaction.test.ts`
- `packages/server/src/index.ts`
- `packages/server/README.md`
- `docs/architecture/README.md`
- durable task/work/review/report logs

Splitter JVM impact summary:

- JVM `Transaction` buffers state, version, and lifecycle until commit; TS
  should do the same.
- JVM exposes mutation only while a transaction is active; TS should reject
  updates after commit/rollback.
- JVM validates before applying state; TS must call
  `validateEntityStateTransition()` before accepting commit results.
- JVM rollback restores initial state/version and releases the transaction; TS
  should expose rollback/release status explicitly.
- JVM phases, listeners, entity records, repository storage, recent history,
  and concrete entity-family rules are intentionally excluded from `T-0009d.2`.

## Decisions

- D-0040: keep the transaction kernel JVM-familiar and deliberately smaller
  than runtime dispatch/storage.
- D-0041: validation-rejected commits return structured rejected results and
  leave the minimal transaction active; accepted commit and rollback close it.

## Human Questions And Answers

- Blocking questions: none known.
- Non-blocking questions: none known for setup.

## Files Changed

- `build-protocol/tasks/T-0009d2-entity-transaction-kernel/TASK.md`
- `build-protocol/tasks/T-0009d2-entity-transaction-kernel/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009d2.md`
- `build-protocol/reviews/T-0009d2-entity-transaction-kernel.md`
- `build-protocol/DECISION_LOG.md`
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

- Dependency hydration: sandboxed `corepack pnpm install` was interrupted after
  registry DNS retries. Escalated `corepack pnpm install` passed and hydrated
  the worktree from the existing lockfile/store.
- Baseline `CI=true corepack pnpm verify` passed on
  `2026-06-29 20:02 WEST`: 13 test files / 111 tests; coverage statements
  97.38%, branches 90.78%, functions 100%, lines 97.31%; docs/API and proto
  checks passed with the known TypeDoc invalid-origin warning.
- RED `corepack pnpm vitest run packages/server/src/entity-transaction.test.ts packages/server/src/index.test.ts`
  failed on `2026-06-29 20:13 WEST` as expected: 2 files ran, 7 tests failed
  because `createEntityTransaction`, `EntityTransaction`, and root exports were
  not implemented.
- GREEN focused
  `corepack pnpm vitest run packages/server/src/entity-transaction.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 20:17 WEST`: 2 files / 16 tests.
- `corepack pnpm typecheck` passed on `2026-06-29 20:17 WEST`.
- `corepack pnpm lint` passed on `2026-06-29 20:17 WEST` after removing an
  unnecessary optional chain in the new test.
- `corepack pnpm docs:check` passed on `2026-06-29 20:17 WEST` with the known
  invalid-origin TypeDoc warning; API export counts included 43
  `@spine-ts/server` exports.
- `corepack pnpm format:check` passed on `2026-06-29 20:17 WEST` after
  Prettier formatting touched source/docs/log files.
- Full `CI=true corepack pnpm verify` passed on `2026-06-29 20:18 WEST`: 14
  test files / 118 tests; coverage statements 97.51%, branches 90.28%,
  functions 100%, lines 97.46%; docs/API and proto checks passed with the known
  TypeDoc invalid-origin warning.
- Final full `CI=true corepack pnpm verify` passed again on
  `2026-06-29 20:21 WEST` after durable-log updates with the same 14 test files
  / 118 tests and coverage above thresholds.
- Round 1 review-fix focused assertion run before production changes,
  `corepack pnpm vitest run packages/server/src/entity-transaction.test.ts packages/server/src/index.test.ts`,
  passed on `2026-06-29 20:31 WEST`: 2 files / 21 tests. This recorded the
  reliability findings as assertion-only coverage because existing behavior
  already satisfied rollback-after-close, rejected-commit-then-rollback, and
  failed-update invariants.
- Round 1 review-fix type-level RED `corepack pnpm typecheck` failed on
  `2026-06-29 20:31 WEST` because accepted committed version metadata was still
  `unknown`.
- Round 1 review-fix GREEN focused
  `corepack pnpm vitest run packages/server/src/entity-transaction.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 20:33 WEST`: 2 files / 21 tests.
- `corepack pnpm typecheck` passed on `2026-06-29 20:33 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-29 20:33 WEST` with the known
  invalid-origin TypeDoc warning; API export counts included 56
  `@spine-ts/server` exports.
- Initial `corepack pnpm format:check` and `corepack pnpm lint` failed on
  `2026-06-29 20:33 WEST` for durable-log formatting and one test-local
  type/interface style issue. After cleanup, `corepack pnpm format:check` and
  `corepack pnpm lint` passed on `2026-06-29 20:34 WEST`.
- Full `CI=true corepack pnpm verify` passed on `2026-06-29 20:35 WEST`: 14
  test files / 123 tests; coverage statements 97.51%, branches 90.28%,
  functions 100%, lines 97.46%; docs/API and proto checks passed with the known
  TypeDoc invalid-origin warning.
- Final pre-integration `CI=true corepack pnpm verify` passed on
  `2026-06-29 20:44 WEST` from clean-review commit `9e145b9`: 14 test files /
  123 tests; coverage statements 97.51%, branches 90.28%, functions 100%,
  lines 97.46%; TypeDoc/API check reported 100 proto, 28 core, 56 server, and
  26 storage expected exports; proto lint/generate/check passed.
- Main integration `CI=true corepack pnpm verify` passed on
  `2026-06-29 20:46 WEST` after merge commit `2b3f3e9`: 14 test files / 123
  tests; coverage statements 97.51%, branches 90.28%, functions 100%, lines
  97.46%; TypeDoc/API check reported 100 proto, 28 core, 56 server, and 26
  storage expected exports; proto lint/generate/check passed.
- `T-0009d.2b` main integration `CI=true corepack pnpm verify` passed on
  `2026-06-29 21:19 WEST` after merge commit `5c182d3`: 14 test files / 129
  tests; coverage statements 97.61%, branches 90.51%, functions 100%, lines
  97.56%; TypeDoc/API check reported 100 proto, 28 core, 59 server, and 26
  storage expected exports; proto lint/generate/check passed.
- `T-0009d.2c` baseline `CI=true corepack pnpm verify` passed on
  `2026-06-29 21:25 WEST` from branch baseline `5367bb8`: 14 test files / 129
  tests; coverage statements 97.61%, branches 90.51%, functions 100%, lines
  97.56%; TypeDoc/API check reported 100 proto, 28 core, 59 server, and 26
  storage expected exports; proto lint/generate/check passed with generated
  output clean.

## Round 1 Review Fix Outcome

All assigned round 1 findings were accepted and fixed. No reviewer comments were
rejected. No sub-agents were spawned.

## Review Rounds

- Round 1 review of `7b13f1c..ca95f41` completed with accepted findings from
  documentation, TypeScript/API docs, and performance/reliability. Code
  style/maintainability and security were clean.
- Round 1 fix commit `285710c` accepted all findings and rejected none.
- Round 2 review of `7b13f1c..285710c` completed clean for
  code style/maintainability, documentation, TypeScript/API docs, security, and
  performance/reliability. All round 2 reviewer sub-agents were closed.

## Current State

- Branch/worktree exists from `3d08195`.
- Setup logs are committed at `7c267ee`.
- `T-0009d.2a` implementation is complete, verified locally, clean-reviewed,
  and integrated to `main` at `2b3f3e9`.
- `T-0009d.2b` lifecycle/version helper follow-up is complete, clean-reviewed,
  and integrated to `main` at `5c182d3`.
- Requirements splitter completed and was closed.
- All participating `2a` and `2b` splitter, author, fix, and reviewer
  sub-agents are closed.
- `T-0009d.2c` is active in
  `.worktrees/T-0009d2c-public-api-closure` for public API compatibility notes,
  parent-roadmap cleanup, and verification closure only.
