# Implementation Report: T-0009d.2 Entity Transaction Draft/Result Kernel

Status: `T-0009d.2a` implemented, clean-reviewed, and integrated
Task log: `build-protocol/tasks/T-0009d2-entity-transaction-kernel/TASK.md`
Work log: `build-protocol/work-logs/T-0009d2.md`
Review log: `build-protocol/reviews/T-0009d2-entity-transaction-kernel.md`
Branch: `task/T-0009d2-entity-transaction-kernel`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009d2-entity-transaction-kernel`

## Summary

Implemented the `T-0009d.2a` minimal server transaction draft/result kernel.
The new public API exposes `EntityTransaction`, `createEntityTransaction()`,
typed draft/update/commit/rollback results, lifecycle flags, explicit version
metadata, and deterministic closed-transaction errors. The kernel mirrors the
JVM transaction concept as an in-memory buffered commit boundary without
pulling in storage, repositories, handler dispatch, phases, buses, gRPC, or
ZeroMQ.

## JVM Research Used

Implementation must use the task-relevant JVM references recorded in `TASK.md`.
The expected design impact is a buffered draft, active transaction status,
commit-time validation, rollback/release semantics, and no entity mutation until
the transaction result is accepted by later runtime code.

## Implementer Skill Applicability Check

Canonical checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.
Checked at `2026-06-29 20:10 WEST` before implementation code or test edits.

Inventory evidence:

- Session skill inventory exposed required workflow and TS/testing skills,
  including `subagent-driven-development`, `test-driven-development`,
  `javascript-testing-patterns`, `typescript-advanced-types`, and
  `verification-before-completion`.
- Task prompt explicitly required
  `test-driven-development`, `javascript-testing-patterns`,
  `typescript-advanced-types`, and `verification-before-completion`, and asked
  this worker to use the orchestrator-passed `subagent-driven-development`
  guidance.
- Repo manifest checked with `cat build-protocol/skills/EXPECTED_SKILLS.md`.
- User-installed entrypoints checked with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
- Installed lock checked with `cat /Users/armiol/.agents/.skill-lock.json`.

Selected skills fully read before use:

| Skill                            | Source                                                                 | Applied To                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `subagent-driven-development`    | `/Users/armiol/.agents/skills/subagent-driven-development/SKILL.md`    | Follow isolated worker protocol, durable logs, and no extra sub-agent spawning from this implementer. |
| `test-driven-development`        | `/Users/armiol/.agents/skills/test-driven-development/SKILL.md`        | Add RED Vitest coverage before production implementation.                                             |
| `javascript-testing-patterns`    | `/Users/armiol/.agents/skills/javascript-testing-patterns/SKILL.md`    | Keep focused Vitest tests behavior-oriented and fixture-backed.                                       |
| `typescript-advanced-types`      | `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md`      | Keep the public generic API typed without unnecessary type machinery.                                 |
| `verification-before-completion` | `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md` | Run fresh verification before completion claims and before commit.                                    |

Skipped relevant-looking skills:

| Skill                     | Source Evidence                            | Reason                                                                                             |
| ------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `using-git-worktrees`     | Expected manifest and installed entrypoint | Worktree was already created by the orchestrator; this worker only verified the assigned worktree. |
| `requesting-code-review`  | Expected manifest and installed entrypoint | Five-role review is orchestrator-owned after this committed implementation.                        |
| `receiving-code-review`   | Installed entrypoint                       | No reviewer findings are assigned to this worker yet.                                              |
| `cqrs-implementation`     | Installed entrypoint                       | This slice has no read model/projection runtime.                                                   |
| `event-store-design`      | Installed entrypoint                       | Event persistence and append/replay are out of scope.                                              |
| `nodejs-backend-patterns` | Expected manifest and installed entrypoint | No HTTP/gRPC service, middleware, or endpoint implementation is in scope.                          |
| `saga-orchestration`      | Installed entrypoint                       | No process-manager workflow or compensation logic is in scope.                                     |

## Round 1 Review-Fix Skill Applicability Check

Canonical checklist source: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.
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

| Skill                            | Source                                                                 | Applied To                                                                                  |
| -------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `receiving-code-review`          | `/Users/armiol/.agents/skills/receiving-code-review/SKILL.md`          | Evaluate and apply round 1 documentation, reliability, TypeScript/API, and docs findings.   |
| `test-driven-development`        | `/Users/armiol/.agents/skills/test-driven-development/SKILL.md`        | Add focused tests before type/API implementation changes where production behavior changes. |
| `typescript-advanced-types`      | `/Users/armiol/.agents/skills/typescript-advanced-types/SKILL.md`      | Parameterize version metadata without complex type machinery.                               |
| `verification-before-completion` | `/Users/armiol/.agents/skills/verification-before-completion/SKILL.md` | Run fresh targeted and full verification before completion claims and commit.               |

Skipped relevant-looking skills:

| Skill                           | Source Evidence                                     | Reason                                                                                             |
| ------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `javascript-testing-patterns`   | Installed entrypoint and session inventory metadata | TDD skill covers the focused Vitest additions; no mocks or new shared test utilities are expected. |
| `architecture-decision-records` | Expected manifest and installed entrypoint          | Review fixes apply existing D-0040/D-0041 decisions; no new decision is planned.                   |
| `requesting-code-review`        | Expected manifest and installed entrypoint          | This turn fixes already-received review findings; it does not spawn or request sub-agents.         |

Round 1 fix plan:

- Update user/API docs to describe the available buffered entity transaction
  boundary and explicitly exclude entities, storage/repositories, handler
  dispatch, buses/transports, and async-local/global transaction state.
- Add focused Vitest assertions for rollback-after-close and failed-update
  invariants; record as assertion-only coverage if current behavior already
  satisfies them.
- Add every intended transaction export to `scripts/check-api-docs.mjs`.
- Parameterize transaction version metadata generically so caller-supplied
  draft metadata flows to accepted committed metadata with its type preserved.

## Files Changed

- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0009d2-entity-transaction-kernel/TASK.md`
- `build-protocol/tasks/T-0009d2-entity-transaction-kernel/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0009d2.md`
- `build-protocol/reviews/T-0009d2-entity-transaction-kernel.md`
- `docs/architecture/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `packages/server/README.md`
- `packages/server/src/entity-transaction.ts`
- `packages/server/src/entity-transaction.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`

## Round 1 Review Fixes

Accepted and fixed all round 1 findings assigned in this turn:

- Documentation P2: added a user guide entity transaction section with a minimal
  `createEntityTransaction()` example and explicit exclusions for entity
  instantiation, storage/repositories, handler dispatch, buses/transports, and
  async-local/global transaction state.
- Performance/reliability P2: added focused assertions for rollback after
  accepted commit, rollback after rollback, rollback after rejected commit, and
  throwing `update()` leaving status and `currentDraft` unchanged. These were
  assertion-only coverage because existing runtime behavior already passed.
- TypeScript/API P1: added every intended transaction export from
  `packages/server/src/index.ts` to `scripts/check-api-docs.mjs`
  `expectedServerExports`; docs check now reports 56 expected server exports.
- TypeScript/API docs P2: updated `docs/api/README.md` to mention the
  transaction kernel plus commit/rollback status behavior.
- TypeScript/API P2: parameterized transaction version metadata generically with
  `Version = unknown` across options, class, commit result, rollback result,
  accepted/rejected metadata, and `createEntityTransaction()`. Added type
  coverage proving accepted commit metadata preserves the caller-supplied
  version type.

No reviewer comments were rejected. No sub-agents were spawned.

## Verification

- Baseline `CI=true corepack pnpm verify` passed on
  `2026-06-29 20:02 WEST`: 13 test files / 111 tests; coverage statements
  97.38%, branches 90.78%, functions 100%, lines 97.31%; docs/API and proto
  checks passed with the known TypeDoc invalid-origin warning.
- RED `corepack pnpm vitest run packages/server/src/entity-transaction.test.ts packages/server/src/index.test.ts`
  failed on `2026-06-29 20:13 WEST` as expected: 2 files ran, 7 tests failed
  because `createEntityTransaction`/`EntityTransaction` and root exports were
  not implemented yet.
- GREEN focused
  `corepack pnpm vitest run packages/server/src/entity-transaction.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 20:17 WEST`: 2 files / 16 tests.
- `corepack pnpm typecheck` passed on `2026-06-29 20:17 WEST`.
- `corepack pnpm lint` passed on `2026-06-29 20:17 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-29 20:17 WEST` with the known
  TypeDoc invalid-origin warning.
- `corepack pnpm format:check` passed on `2026-06-29 20:17 WEST`.
- Full `CI=true corepack pnpm verify` passed on `2026-06-29 20:18 WEST`: 14
  test files / 118 tests; coverage statements 97.51%, branches 90.28%,
  functions 100%, lines 97.46%; docs/API and proto checks passed with the known
  TypeDoc invalid-origin warning.
- Final full `CI=true corepack pnpm verify` passed again on
  `2026-06-29 20:21 WEST` after durable-log updates with the same 14 test files
  / 118 tests and coverage above thresholds.
- Round 1 review-fix RED/GREEN:
  - Focused assertion run before production changes,
    `corepack pnpm vitest run packages/server/src/entity-transaction.test.ts packages/server/src/index.test.ts`,
    passed on `2026-06-29 20:31 WEST`: 2 files / 21 tests. The reliability
    findings were assertion-only coverage because production behavior already
    satisfied them.
  - Type-level RED `corepack pnpm typecheck` failed on
    `2026-06-29 20:31 WEST` with
    `Type '{ revision: number; source: "draft"; }' does not satisfy the constraint '"Expected: ..., Actual: unknown"'`,
    confirming accepted committed metadata was still `unknown`.
  - GREEN focused
    `corepack pnpm vitest run packages/server/src/entity-transaction.test.ts packages/server/src/index.test.ts`
    passed on `2026-06-29 20:33 WEST`: 2 files / 21 tests.
  - GREEN `corepack pnpm typecheck` passed on `2026-06-29 20:33 WEST`.
  - `corepack pnpm docs:check` passed on `2026-06-29 20:33 WEST` with the known
    invalid-origin TypeDoc warning; API export counts now include 56
    `@spine-ts/server` exports.
  - Initial `corepack pnpm format:check` failed on `2026-06-29 20:33 WEST` for
    four durable log files. After Prettier formatting, `corepack pnpm
format:check` passed on `2026-06-29 20:34 WEST`.
  - Initial `corepack pnpm lint` failed on `2026-06-29 20:33 WEST` for one
    `@typescript-eslint/consistent-type-definitions` error in the type test.
    After switching the local test shape to an interface, `corepack pnpm lint`
    passed on `2026-06-29 20:34 WEST`.
  - Full `CI=true corepack pnpm verify` passed on `2026-06-29 20:35 WEST`: 14
    test files / 123 tests; coverage statements 97.51%, branches 90.28%,
    functions 100%, lines 97.46%; docs/API and proto checks passed with the
    known TypeDoc invalid-origin warning.
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

## Review

- Round 1 review findings fixed; no reviewer comment was rejected.
- Round 2 re-review of `7b13f1c..285710c` completed clean for all required
  roles: code style/maintainability, documentation, TypeScript/API docs,
  security, and performance/reliability.
- All authoring, fix, splitter, and reviewer sub-agents have been closed.

## Integration

- Merge commit: `2b3f3e9` (`Merge T-0009d.2a entity transaction kernel`).
- Main verification: passed on `2026-06-29 20:46 WEST`.
- Follow-up routing: continue `T-0009d.2b Lifecycle And Version Draft Helpers`
  in a fresh branch/worktree.
