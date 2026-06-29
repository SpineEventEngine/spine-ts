# T-0009d.1: Built-In Set-Once Transition Validation

Status: Round 20 clean re-review complete; ready for integration
Start: `2026-06-29 14:52 WEST`
End: `2026-06-29 19:39 WEST`
Baseline commit: `1d939d7`
Task log path: `build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md`
Branch: `task/T-0009d1-set-once-transition-validation`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009d1-set-once-transition-validation`
Requirements splitter: `019f13a4-a6f5-7302-94e0-7b16366b0701` (Popper)
Branch setup commit: `88cb0f3`
Authoring sub-agent: Codex implementation sub-agent
Reviewer sub-agents: Round 1 through Round 20 role reviewers for code
style/maintainability, documentation, TypeScript/API docs, security, and
performance/reliability; individual reviewer IDs are not present in durable task
evidence.
Baseline verification evidence commit: `345c093`

## Objective

Add the first built-in server-side state-transition validation for Spine
`(set_once)` fields. The API must derive rules from descriptor-backed
`EntityMetadata`, delegate result shaping and sanitization to the existing
`@spine-ts/core` `validateTransition()` facade, and remain a pure validation
surface with no entity instantiation, handler invocation, repositories, storage
writes, buses, runtime dispatch, gRPC, or ZeroMQ.

## Splitter Result

The requirements splitter selected `T-0009d.1 Built-In Set-Once Transition
Validation` after `T-0009c.1` was completed and integrated.

Staged roadmap:

1. `T-0009d.1 Built-In Set-Once Transition Validation`
2. `T-0009d.2 Entity Transaction Draft/Result Kernel` without storage,
   repositories, or handler dispatch
3. `T-0009e Concrete OOP Entity Base Classes` consuming the validation kernel
4. `T-0009f Repository Seams And Bounded-Context Registration Skeleton`
5. Later runtime dispatch, storage writes, buses, gRPC, ZeroMQ transport,
   read-side querying, and to-do behavior

No blocking questions were identified.

## Required Inputs Read

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0009c1-decorator-metadata-collection/TASK.md`
- `build-protocol/work-logs/T-0009c1.md`
- `packages/core/src/index.ts`
- `packages/core/src/validation-facade-boundary.test.ts`
- `packages/server/src/entity-metadata.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `packages/server/package.json`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `packages/server/README.md`

## Skill Applicability

Canonical checklist: `BUILD_PROTOCOL.md#skills-and-tooling` remains governing.

Selected skills read before task actions:

| Skill                            | Source                                                     | Applicability                             | Instructions Applied                                                        |
| -------------------------------- | ---------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `subagent-driven-development`    | `~/.agents/skills/subagent-driven-development/SKILL.md`    | Required protocol execution model.        | Splitter, implementer, five reviewer roles, review loop, and agent closure. |
| `using-git-worktrees`            | `~/.agents/skills/using-git-worktrees/SKILL.md`            | Required isolated worktree per task.      | Use project-local `.worktrees` branch/worktree and baseline verification.   |
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | Mandatory review before task completion.  | Review implementation and any review-fix ranges.                            |
| `receiving-code-review`          | `~/.agents/skills/receiving-code-review/SKILL.md`          | Required reviewer comment handling.       | Verify comments before fix dispatch; no performative acceptance.            |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims.        | Run and read verification before merge/completion.                          |
| `test-driven-development`        | `~/.agents/skills/test-driven-development/SKILL.md`        | New validation behavior.                  | Authoring sub-agent must write failing tests before production code.        |
| `javascript-testing-patterns`    | `~/.agents/skills/javascript-testing-patterns/SKILL.md`    | Vitest coverage and fixture design.       | Behavior-level transition validation tests.                                 |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Typed validation API and schema generics. | Preserve useful schema/message types without opaque type machinery.         |
| `architecture-decision-records`  | `~/.agents/skills/architecture-decision-records/SKILL.md`  | D-0038 set-once semantics decision.       | Record context, decision, alternatives, and consequences.                   |

Skills to pass to sub-agents/reviewers:

| Recipient           | Skills/Instructions To Pass                                                                                   | Notes                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Authoring sub-agent | TDD, JavaScript testing, TypeScript/API, ADR/domain, verification instructions.                               | Must implement in the task worktree and update durable logs/docs.      |
| Reviewers           | Five role-specific reviewers: maintainability, documentation, TS/API docs, security, performance/reliability. | Must inspect the committed task range and report clean/finding status. |

Skipped relevant-looking skills:

| Skill                 | Source                                          | Reason Skipped                                                                    |
| --------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `cqrs-implementation` | `~/.agents/skills/cqrs-implementation/SKILL.md` | Only read/write boundary language is relevant; no CQRS runtime is implemented.    |
| `event-store-design`  | `~/.agents/skills/event-store-design/SKILL.md`  | No event persistence, replay, storage append, or repository behavior is in scope. |
| `saga-orchestration`  | `~/.agents/skills/saga-orchestration/SKILL.md`  | No process-manager execution, compensation, or orchestration runtime is in scope. |

Fix round 17 sub-agent skill applicability check (`2026-06-29 19:00 WEST`):
session inventory exposed applicable `test-driven-development`, `tdd`,
`javascript-testing-patterns`, `typescript-advanced-types`, and
`verification-before-completion` skills. Task prompt explicitly required TDD,
TypeScript, JavaScript testing, and verification skills. Read
`BUILD_PROTOCOL.md#skills-and-tooling`, `EXPECTED_SKILLS.md`,
`~/.agents/skills/test-driven-development/SKILL.md`,
`~/.agents/skills/tdd/SKILL.md`,
`~/.agents/skills/javascript-testing-patterns/SKILL.md`,
`~/.agents/skills/typescript-advanced-types/SKILL.md`, and
`~/.agents/skills/verification-before-completion/SKILL.md`. Bounded inventory
commands used:
`find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`
and
`test -f /Users/armiol/.agents/.skill-lock.json && sed -n '1,220p' /Users/armiol/.agents/.skill-lock.json || true`.
No skill source was unreachable; no sub-agents are allowed for this fix round.
Skipped adjacent runtime/architecture skills because the requested fix is a
narrow cache/test/docs update, not a runtime or transaction design change.

Fix round 18 verification-fix skill applicability check
(`2026-06-29 19:20 WEST`): session inventory exposed applicable
`javascript-testing-patterns`, `typescript-advanced-types`, and
`verification-before-completion` skills. Task prompt explicitly required
reading `BUILD_PROTOCOL.md#skills-and-tooling` and
`EXPECTED_SKILLS.md`, using TypeScript/testing/verification guidance, avoiding
sub-agents, staying in this worktree, and editing only the owned files. Read
`build-protocol/BUILD_PROTOCOL.md`,
`build-protocol/skills/EXPECTED_SKILLS.md`,
`build-protocol/CODE_QUALITY.md`,
`~/.agents/skills/javascript-testing-patterns/SKILL.md`,
`~/.agents/skills/typescript-advanced-types/SKILL.md`, and
`~/.agents/skills/verification-before-completion/SKILL.md`. Bounded inventory
commands used:
`find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`
and a targeted `/Users/armiol/.agents/.skill-lock.json` query for expected
skills. No skill source was unreachable. Skipped worktree, sub-agent, TDD,
architecture, and runtime skills because this round is a narrow lint
verification fix with no behavior change and the prompt forbids sub-agents.

## Scope

In scope:

- Public server transition-validation API for entity state transitions.
- Built-in `(set_once)` checks derived from `describeEntityMetadata()`.
- Creation transitions where `previous === undefined` may initialize supported
  `(set_once)` fields; unsupported repeated, map-valued, and explicit optional
  `(set_once)` declarations fail closed even on creation.
- Existing-state transitions fail when a supported `(set_once)` field changes.
- Equal previous/next supported `(set_once)` values pass.
- Violations use repo-local `spine.validation.ConstraintViolation` data with
  `fieldPath` and no raw previous/next payload leakage.
- Focused TDD tests, public exports, TypeDoc comments, API docs guard, package
  README, framework user guide, API README, architecture notes, durable logs,
  and ADR update.

Out of scope:

- Entity base classes or mutation helpers.
- Applying events to state.
- Handler invocation or runtime dispatch.
- Repositories, storage writes, storage reads, or snapshots.
- Command/event buses, delivery workers, gRPC, ZeroMQ, or transport.
- Read-side query/subscription execution.

## Decisions

- D-0038: enforce `(set_once)` as immutable after first committed state.
- D-0039: keep server validation boundaries JVM-familiar; repeated,
  map-valued, and explicit optional `(set_once)` fields are unsupported in the
  JVM generation contract and fail closed here rather than adding speculative
  collection or presence canonicalization.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none known for setup.

## Files Changed

- `build-protocol/DEVELOPER_API.md`
- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/reviews/T-0009d1-set-once-transition-validation.md`
- `build-protocol/tasks/T-0009d1-set-once-transition-validation/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md`
- `build-protocol/work-logs/T-0009d1.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `README.md`
- `packages/server/README.md`
- `packages/server/package.json`
- `packages/server/src/entity-transition-validation.test.ts`
- `packages/server/src/entity-transition-validation.ts`
- `packages/server/src/index.test.ts`
- `packages/server/src/index.ts`
- `packages/server/test-fixtures/entity-metadata-fixtures.ts`
- `packages/server/test-fixtures/proto/entity-metadata/main.proto`
- `pnpm-lock.yaml`
- `scripts/check-api-docs.mjs`

## Tests Run

- Branch setup is based on `88cb0f3`.
- `corepack pnpm install --offline` failed because
  `@bufbuild/protoc-gen-es@2.12.1` was missing from the local pnpm store.
- `corepack pnpm install` passed with the existing lockfile and hydrated the new
  worktree dependency metadata.
- Baseline `CI=true corepack pnpm verify` passed on `2026-06-29 14:57 WEST`:
  12 test files / 83 tests passed; coverage statements 98.72%, branches
  91.16%, functions 100%, lines 98.69%; docs/API and proto checks passed with
  the known TypeDoc invalid-origin warning.
- RED `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected on `2026-06-29 15:03 WEST` with four behavior failures
  because `validateEntityStateTransition` was not a function.
- `corepack pnpm install --offline` was interrupted after pnpm attempted
  network registry/attestation lookups while hydrating `node_modules`; rerun
  `corepack pnpm install` with network approval passed.
- GREEN `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 15:12 WEST`: 2 test files / 15 tests.
- `corepack pnpm typecheck` passed on `2026-06-29 15:10 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-29 15:09 WEST` with the known
  TypeDoc invalid-origin warning and 43 expected `@spine-ts/server` exports.
- `corepack pnpm format:check` passed on `2026-06-29 15:10 WEST`.
- `corepack pnpm test:coverage` passed on `2026-06-29 15:12 WEST`: 13 test
  files / 89 tests; coverage statements 98.79%, branches 92.34%, functions
  100%, lines 98.76%.
- Initial full verification failed first on Markdown formatting, then on branch
  coverage after the new equality helper. Formatting and equality-path coverage
  were added.
- Final `CI=true corepack pnpm verify` passed on `2026-06-29 15:15 WEST`: 13
  test files / 89 tests; coverage statements 98.79%, branches 92.34%,
  functions 100%, lines 98.76%; docs/API and proto checks passed with the known
  TypeDoc invalid-origin warning.
- RED fix-round
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected on `2026-06-29 15:26 WEST`: 3 of 10 tests failed because
  inherited/accessor forged fields and non-plain objects were accepted, and
  cyclic input did not preserve a field-specific set-once violation.
- GREEN fix-round
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 15:27 WEST`: 2 test files / 19 tests.
- Fix-round `corepack pnpm typecheck` passed on `2026-06-29 15:29 WEST`.
- Fix-round `corepack pnpm docs:check` passed on `2026-06-29 15:29 WEST` with
  the known TypeDoc invalid-origin warning and 43 expected `@spine-ts/server`
  exports.
- Fix-round full verification initially failed on lint, then on formatting.
  After cleanup, final `CI=true corepack pnpm verify` passed on
  `2026-06-29 15:31 WEST`: 13 test files / 93 tests; coverage statements
  98.48%, branches 92.34%, functions 100%, lines 98.44%; docs/API and proto
  checks passed with the known TypeDoc invalid-origin warning.
- RED fix-round 2
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected on `2026-06-29 15:40 WEST`: 1 of 11 tests failed because
  descriptor-valid singular message set-once field `details` was absent from
  both previous and next states but treated as unsafe.
- GREEN fix-round 2
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 15:40 WEST`: 2 test files / 20 tests.
- Fix-round 2 `corepack pnpm docs:check` passed on
  `2026-06-29 15:42 WEST` with the known TypeDoc invalid-origin warning and
  expected API export counts.
- Fix-round 2 `corepack pnpm typecheck` passed on `2026-06-29 15:42 WEST`.
- Fix-round 2 full verification first failed on Prettier formatting for
  `build-protocol/work-logs/T-0009d1.md`. After formatting cleanup,
  `CI=true corepack pnpm verify` passed on `2026-06-29 15:44 WEST`: 13 test
  files / 94 tests; coverage statements 98.48%, branches 92.46%, functions
  100%, lines 98.45%; docs/API and proto checks passed with the known TypeDoc
  invalid-origin warning.
- RED fix-round 3
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected on `2026-06-29 15:54 WEST`: 2 of 13 tests failed because
  forged bytes and repeated set-once collections were accepted through
  overridden collection methods and indexed reads.
- GREEN fix-round 3
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 15:56 WEST`: 2 test files / 22 tests.
- Fix-round 3 `corepack pnpm docs:check` initially failed on the new
  typed-array helper type, then passed on `2026-06-29 15:57 WEST` with the
  known TypeDoc invalid-origin warning and expected API export counts.
- Fix-round 3 `corepack pnpm typecheck` initially failed on the same helper and
  test-helper types, then passed on `2026-06-29 15:58 WEST`.
- Fix-round 3 full verification first failed on lint for the new proxy/helper
  code, then on Prettier formatting for
  `packages/server/src/entity-transition-validation.test.ts`. After cleanup,
  `CI=true corepack pnpm verify` passed on `2026-06-29 16:00 WEST`: 13 test
  files / 96 tests; coverage statements 97.34%, branches 90.72%, functions
  100%, lines 97.26%; docs/API and proto checks passed with the known TypeDoc
  invalid-origin warning.
- RED fix-round 4
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  failed as expected on `2026-06-29 16:15 WEST`: 3 tests failed because
  top-level and nested proxy-forged descriptors could hide changed set-once
  values and same-reference unsupported values bypassed shape validation.
- GREEN fix-round 4
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 16:25 WEST`: 2 test files / 28 tests.
- Fix-round 4 `corepack pnpm typecheck` passed on `2026-06-29 16:19 WEST`.
- Fix-round 4 `corepack pnpm docs:check` passed on `2026-06-29 16:19 WEST`
  with the known TypeDoc invalid-origin warning and expected API export counts.
- Fix-round 4 lint/format cleanup: `corepack pnpm lint` and
  `corepack pnpm format:check` initially failed on a validator type assertion
  and Prettier formatting. After cleanup, focused tests, lint, and format check
  passed on `2026-06-29 16:19 WEST`.
- Fix-round 4 full verification initially failed on branch coverage after the
  canonicalization helpers were added. After adding symbol-keyed repeated
  collection, throwing nested proxy, and subclassed bytes coverage,
  `corepack pnpm test:coverage` passed on `2026-06-29 16:25 WEST`: 13 test
  files / 102 tests; coverage statements 96.79%, branches 90.09%, functions
  100%, lines 96.71%.
- Final fix-round 4 `CI=true corepack pnpm verify` passed on
  `2026-06-29 16:29 WEST`: 13 test files / 102 tests; coverage statements
  96.79%, branches 90.09%, functions 100%, lines 96.71%; docs/API and proto
  checks passed with the known TypeDoc invalid-origin warning.
- RED fix-round 5
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  failed as expected on `2026-06-29 16:39 WEST`: 2 of 31 tests failed because
  throwing top-level proxy reflection produced the core generic rule-failed
  violation without `fieldPath`, and map-valued set-once fields used the
  generic set-once message instead of the explicit unsupported-map contract.
- GREEN fix-round 5
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 16:40 WEST`: 2 test files / 31 tests.
- Fix-round 5 `corepack pnpm docs:check` passed on `2026-06-29 16:41 WEST`
  with the known TypeDoc invalid-origin warning and expected API export counts.
- Fix-round 5 `corepack pnpm typecheck` passed on `2026-06-29 16:41 WEST`.
- Final fix-round 5 `CI=true corepack pnpm verify` passed on
  `2026-06-29 16:50 WEST`: 13 test files / 105 tests; coverage statements
  97.12%, branches 91.07%, functions 100%, lines 97.05%; docs/API and proto
  checks passed with the known TypeDoc invalid-origin warning.
- RED fix-round 6
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected on `2026-06-29 16:55 WEST`: 1 of 22 tests failed because
  unchanged `RichSetOnceState.tags` was accepted instead of rejected as an
  unsupported repeated set-once field.
- GREEN fix-round 6
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 16:58 WEST`: 2 test files / 31 tests.
- Fix-round 6 full verification initially failed on global branch coverage after
  top-level repeated/list equality support and tests were removed. After
  narrowing obsolete array/cycle-pair helper behavior and adding focused
  supported bytes/singular-message coverage, `corepack pnpm test:coverage`
  passed on `2026-06-29 17:06 WEST`: 13 test files / 105 tests; coverage
  statements 97.47%, branches 90.63%, functions 100%, lines 97.40%.
- Fix-round 6 `corepack pnpm docs:check` passed on `2026-06-29 17:07 WEST`
  with the known TypeDoc invalid-origin warning and expected API export counts.
- Fix-round 6 `corepack pnpm typecheck` passed on `2026-06-29 17:07 WEST`.
- Final fix-round 6 `CI=true corepack pnpm verify` passed on
  `2026-06-29 17:08 WEST`: 13 test files / 105 tests; coverage statements
  97.47%, branches 90.63%, functions 100%, lines 97.40%; docs/API and proto
  checks passed with the known TypeDoc invalid-origin warning.
- RED fix-round 7
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected on `2026-06-29 17:19 WEST`: 4 of 26 tests failed because
  creation transitions skipped unsupported repeated/map set-once fields and
  throwing bytes/message shape proxies produced generic core rule failures
  without field paths.
- RED fix-round 7 explicit optional
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected on `2026-06-29 17:22 WEST`: 1 of 27 tests failed because
  unchanged `optional string explicit_id` was accepted instead of rejected as an
  unsupported explicit optional set-once field.
- GREEN fix-round 7
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 17:25 WEST`: 2 test files / 36 tests.
- Fix-round 7 `corepack pnpm docs:check` passed on `2026-06-29 17:22 WEST`
  with the known TypeDoc invalid-origin warning and expected API export counts.
- Fix-round 7 `corepack pnpm typecheck` passed on `2026-06-29 17:23 WEST`.
- Fix-round 7 full verification initially failed on lint after the creation
  guard made a previous-state type assertion unnecessary, then on Prettier
  formatting for `packages/server/src/entity-transition-validation.ts`. After
  cleanup, `CI=true corepack pnpm verify` passed on `2026-06-29 17:29 WEST`:
  13 test files / 110 tests; coverage statements 97.35%, branches 90.72%,
  functions 100%, lines 97.28%; docs/API and proto checks passed with the known
  TypeDoc invalid-origin warning.
- Fix-round 8 docs/log verification: `corepack pnpm format:check` first failed
  on Prettier formatting for `TASK.md` and
  `build-protocol/work-logs/T-0009d1.md`. After
  `corepack pnpm exec prettier --write` on those two files,
  `corepack pnpm format:check` passed on `2026-06-29 17:40 WEST`;
  `corepack pnpm docs:check` passed on `2026-06-29 17:42 WEST` with the known
  TypeDoc invalid-origin warning and expected API export counts. The final
  `corepack pnpm typecheck` passed on `2026-06-29 17:43 WEST`.
- Fix-round 9 docs/log verification: `corepack pnpm format:check` initially
  failed on `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed on `2026-06-29 17:55 WEST`.
  `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts; `corepack pnpm typecheck` passed;
  `git diff --check` passed.
- Fix-round 10 docs/log verification: `corepack pnpm format:check` initially
  failed on `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed on `2026-06-29 18:03 WEST`.
  `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts; `corepack pnpm typecheck` passed;
  `git diff --check` passed.
- Fix-round 11 docs/log verification: `corepack pnpm format:check` initially
  failed on `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed. `corepack pnpm docs:check` passed with
  the known TypeDoc invalid-origin warning and expected API export counts;
  `corepack pnpm typecheck` passed; `git diff --check` passed.
- Fix-round 12 docs/log verification: `corepack pnpm format:check` passed.
  `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts; `corepack pnpm typecheck` passed;
  `git diff --check` passed.
- Fix-round 13 docs/log verification: `corepack pnpm format:check` initially
  failed on `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed. `corepack pnpm docs:check` passed with
  the known TypeDoc invalid-origin warning and expected API export counts;
  `corepack pnpm typecheck` passed; `git diff --check` passed.
- Fix-round 14 docs/log verification: `corepack pnpm format:check` initially
  failed on `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed. `corepack pnpm docs:check` passed with
  the known TypeDoc invalid-origin warning and expected API export counts;
  `corepack pnpm typecheck` passed; `git diff --check` passed.
- Fix-round 15 docs/log verification: `corepack pnpm format:check` initially
  failed on `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write build-protocol/work-logs/T-0009d1.md`,
  `corepack pnpm format:check` passed. `corepack pnpm docs:check` passed with
  the known TypeDoc invalid-origin warning and expected API export counts;
  `corepack pnpm typecheck` passed; `git diff --check` passed.
- Fix-round 16 docs/log verification: `corepack pnpm format:check` passed.
  `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts; `corepack pnpm typecheck` passed;
  `git diff --check` passed.
- RED fix-round 17
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts`
  failed as expected on `2026-06-29 19:02 WEST`: 1 of 28 tests failed because
  the same-schema second validation still re-read descriptor `fields`, moving
  the schema traversal counter from 3 to 6.
- GREEN fix-round 17 focused verification:
  `corepack pnpm vitest run packages/server/src/entity-transition-validation.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 19:02 WEST`: 2 test files / 37 tests.
- Fix-round 17 verification: `corepack pnpm format:check` first failed on
  `packages/server/src/entity-transition-validation.ts` and
  `build-protocol/work-logs/T-0009d1.md`, then needed one additional work-log
  wrap after final evidence text was added; after
  `corepack pnpm exec prettier --write packages/server/src/entity-transition-validation.ts packages/server/src/entity-transition-validation.test.ts build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md build-protocol/tasks/T-0009d1-set-once-transition-validation/IMPLEMENTATION_REPORT.md build-protocol/work-logs/T-0009d1.md build-protocol/reviews/T-0009d1-set-once-transition-validation.md`,
  `corepack pnpm format:check` passed on `2026-06-29 19:08 WEST`.
  `corepack pnpm docs:check` passed with the known TypeDoc invalid-origin
  warning and expected API export counts; `corepack pnpm typecheck` passed;
  `git diff --check` passed.
- Pre-fix full verification for fix round 18:
  `CI=true corepack pnpm verify` failed at lint with two
  `@typescript-eslint/no-unnecessary-type-assertion` errors:
  `packages/server/src/entity-transition-validation.ts` cached rule storage
  asserted the inferred frozen rule array, and
  `packages/server/src/entity-transition-validation.test.ts` asserted the
  schema proxy/helper return type. This round removes those redundant
  assertions without changing behavior or public API, then reruns fresh lint,
  full verification, diff, and format checks.
- Fix-round 18 verification: `corepack pnpm lint` passed on
  `2026-06-29 19:22 WEST`. Fresh `CI=true corepack pnpm verify` first failed
  on Prettier formatting for `build-protocol/work-logs/T-0009d1.md`; after
  `corepack pnpm exec prettier --write packages/server/src/entity-transition-validation.ts packages/server/src/entity-transition-validation.test.ts build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md build-protocol/tasks/T-0009d1-set-once-transition-validation/IMPLEMENTATION_REPORT.md build-protocol/work-logs/T-0009d1.md build-protocol/reviews/T-0009d1-set-once-transition-validation.md`,
  `CI=true corepack pnpm verify` passed on `2026-06-29 19:24 WEST`: 13 test
  files / 111 tests; coverage statements 97.38%, branches 90.78%, functions
  100%, lines 97.31%; docs/API and proto checks passed with the known TypeDoc
  invalid-origin warning. `git diff --check` passed and
  `corepack pnpm format:check` passed.

## Coverage Result

Latest full verification coverage: statements 97.38%, branches 90.78%,
functions 100%, lines 97.31%.

## Documentation And Public API Impact

| Area                             | Expected Impact                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| Package README impact            | Documented set-once transition validation and metadata-only boundaries.                     |
| TypeDoc/API docs impact          | Added public transition validation API with TypeDoc and API guard coverage.                 |
| Public API additions/removals    | Added high-level server validation API; no removals.                                        |
| Framework `USER_GUIDE.md` impact | Explained single-message vs state-transition validation.                                    |
| Example `USER_GUIDE.md` impact   | N/A for this slice; to-do example is not implemented yet.                                   |
| API examples                     | Expected in server README and API overview.                                                 |
| Compatibility notes              | Supported `(set_once)` fields initialize on creation; unsupported declarations fail closed. |

## Security Impact

| Area                 | Expected Impact                                                         |
| -------------------- | ----------------------------------------------------------------------- |
| Secrets/auth         | None; local validation API only.                                        |
| Payload leakage      | Violations must not include previous/next field values.                 |
| Runtime side effects | Must avoid storage, dispatch, handler invocation, and entity instances. |
| Tenant boundaries    | N/A until runtime/repository tasks consume this API.                    |

## Performance/Reliability Impact

| Area             | Expected Impact                                                            |
| ---------------- | -------------------------------------------------------------------------- |
| Runtime overhead | Pure descriptor/field comparison for explicitly marked fields only.        |
| Reliability      | Deterministic validation order from descriptor metadata declaration order. |
| Concurrency      | No asynchronous runtime or transport behavior in scope.                    |

## Review Rounds

- Round 1 reviewed implementation commit `e32f906` through review package
  `.superpowers/sdd/review-cd98ca3..e32f906.diff`; findings were fixed in
  `70c0052`. Round 1 role reviewers were closed after result capture.
- Round 2 reviewed fix commit `70c0052` through review package
  `.superpowers/sdd/review-cd98ca3..70c0052.diff`; findings required the
  absent-on-both singular message set-once semantics fix plus stale task,
  work-log, review-log, and API status documentation cleanup. Round 2 role
  reviewers were closed after result capture.
- Fix round 2 was committed as `01cfb47` with absent-field semantics and
  durable-doc cleanup.
- Round 3 reviewed `01cfb47` through review package
  `.superpowers/sdd/review-cd98ca3..01cfb47.diff`; findings required hardened
  bytes/repeated collection comparison plus durable-doc consistency cleanup.
- Fix round 3 was committed as `3ccca04` with hardened bytes/repeated
  collection comparison and durable-doc cleanup.
- Round 4 reviewed `3ccca04` through review package
  `.superpowers/sdd/review-cd98ca3..3ccca04.diff`; findings required
  canonical set-once field comparison for proxy-forged top-level and nested
  state, same-reference object/collection validation before equality
  short-circuiting, direct singular message presence transition coverage,
  bytes comparison without number-array materialization, and final durable-doc
  cleanup.
- Fix round 4 was committed as `e2369cc` with proxy/reflection hardening and
  durable-doc cleanup.
- Round 5 reviewed `e2369cc` through review package
  `.superpowers/sdd/review-cd98ca3..e2369cc.diff`; findings required
  field-specific handling for throwing top-level proxy reflection, an explicit
  public contract for unsupported map-valued set-once fields, descriptor-backed
  recursive message depth/cycle coverage, descriptor-backed same-reference
  unsupported message coverage, and durable-doc cleanup.
- Fix round 5 catches top-level field reflection failures as unsafe field reads,
  reports unsupported map-valued set-once fields with a field-specific
  unsupported-map violation, adds descriptor-valid map and recursive
  `RichSetOnceState.details` coverage, and refreshes durable docs after
  `e2369cc`.
- Human steering after fix round 5 required server-module work to inspect the
  local Spine JVM notes before broadening behavior. The fix round inspected:
  `spine-jvm-docs/README.md`;
  `spine-jvm-docs/spine-validation-storage-observability-and-support.md`;
  `spine-jvm-docs/spine-domain-model-and-signals.md`; and
  `spine-jvm-docs/spine-entities-repositories-and-state.md`. The JVM notes
  confirm `(set_once)` is a generated builder/state-update validation boundary
  for normal Protobuf state and that repeated/map/explicit optional fields are
  unsupported at build time, so no broader defensive comparison abstraction was
  added.
- Fix round 6 was directed by human pre-review steering after D-0039: the
  descriptor-level repeated/list set-once path still accepted unchanged
  `RichSetOnceState.tags`, which over-invented beyond the JVM boundary and was
  inconsistent with unsupported map-valued set-once handling. The fix removes
  top-level repeated set-once support, fails repeated/list set-once fields
  closed with a field-specific unsupported-repeated violation, keeps bytes and
  singular-message set-once coverage on a singular-only fixture, and updates
  public docs/TypeDoc wording to name repeated and map set-once as unsupported
  in this slice.
- Fix round 7 addressed review package
  `.superpowers/sdd/review-cd98ca3..d61874b.diff`: unsupported repeated/map
  set-once fields now fail closed on creation transitions as well as
  existing-state transitions; bytes/message shape-check reflection failures are
  caught as unsafe field values so violations remain field-specific and
  sanitized; explicit optional set-once fields are detected through the
  Protobuf-ES `proto3Optional` descriptor flag and fail closed with a
  field-specific unsupported-explicit-optional violation. Public and durable
  docs now name repeated, map-valued, and explicit optional set-once fields as
  unsupported in this slice.
- Fix round 8 is a docs/log-only cleanup after committed fix-round 7 commit
  `3d2cb06`. It removes stale round-order and verification evidence from the
  implementation report, updates task/work/review durable state for clean
  re-review/integration, and qualifies public/TypeDoc creation-transition
  wording so only supported set-once fields may initialize on creation while
  unsupported repeated, map-valued, and explicit optional declarations fail
  closed.
- Fix round 9 is a docs/log-only follow-up after round-8 re-review and human
  server-module steering. It strengthens `BUILD_PROTOCOL.md` to require close
  inspection of corresponding Spine `core-jvm` `server` module source for
  `@spine-ts/server` work when available, records that the local
  `/private/tmp/spine-research/core-jvm/server` checkout is present, and cleans
  remaining D-0038/report/work-log/review-log evidence drift without changing
  runtime code.
- Fix round 10 addresses round-9 maintainability/reliability review findings.
  It inspects actual Spine `core-jvm` `server` source files:
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Transaction.java`
  lines 54-111 and 327-408,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/TransactionalEntity.java`
  lines 40-147,
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/AbstractEntity.java`
  lines 302-349, and
  `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/InvalidEntityStateException.java`
  lines 50-90. The source confirms the JVM server keeps state mutation behind
  a transaction-owned validating builder and validates replacement state during
  transaction commit/update. The implementation impact is to keep T-0009d.1 as
  a narrow transition-validation boundary for future transaction/runtime code,
  rather than adding a speculative TypeScript transaction stack in this slice.
  This round also refreshes the final task end timestamp and the Tests Run
  section for fix-round 9 verification evidence.
- Fix round 11 addresses round-10 re-review findings by adding fix-round 10
  verification evidence to `TASK.md`, the work-log chronological row, and the
  work-log Current State summary.
- Fix round 12 addresses round-11/final re-review findings by updating this
  task status/reviewer metadata, moving the review-log rounds into
  chronological order, and making the work-log Current State identify the
  latest completed review state accurately.
- Fix round 13 addresses round-12/final re-review findings by rewriting the
  review-log tail so Rounds 9-13 physically appear in chronological order and
  updating task/work/report metadata to name this final chronology cleanup.
- Fix round 14 addresses round-13/final re-review findings by adding
  fix-round 11-13 verification evidence to this canonical Tests Run section and
  the work-log Current State verification summary.
- Fix round 15 addresses round-14/final re-review findings by adding
  fix-round 14 verification evidence to this canonical Tests Run section and
  the work-log Current State verification summary.
- Fix round 16 addresses round-16/final re-review findings by adding
  fix-round 15 verification evidence to this canonical Tests Run section,
  correcting stale round/package wording in the work-log Current State, and
  recording round-16 review outcomes.
- Fix round 17 addresses the latest performance/reliability and durable-doc
  findings by caching descriptor-derived set-once transition rules in a
  module-level `WeakMap` keyed by schema, adding a focused schema traversal
  regression test, adding this missing fix-round-16 Review Rounds bullet, and
  clarifying that the early 15:15 full verification was superseded by the
  later 17:29 full verification evidence.
- Fix round 18 addresses a post-round-17 full-verification lint failure by
  removing redundant TypeScript assertions from the schema-keyed cache write
  and schema traversal proxy helper, with no behavior or public API change. It
  also refreshes durable logs and reviewer metadata for the failed full
  verification and routes the next step to clean re-review/integration after
  fresh verification.
- Fix round 19 addresses round-18 documentation/maintainability findings by
  updating the top-level task end timestamp and reviewer metadata to match the
  latest completed verification/review evidence, with no runtime, public API, or
  test behavior change.
- Fix round 20 addresses round-19 documentation findings by keeping top-level
  reviewer metadata at the latest completed reviewer round while recording this
  fix as pending clean re-review, with no runtime, public API, or test behavior
  change.
- Round 20 clean re-review completed with all five role reviewers clean for
  maintainability, documentation, TypeScript/API docs, security, and
  performance/reliability. The task is ready for integration.

## Completion Checklist

- [x] Baseline verification captured in the task worktree.
- [x] Authoring sub-agent report captured and closed.
- [x] Five reviewer role sub-agents completed and closed for the latest
      captured review round.
- [x] Review comments either fixed and re-reviewed or technically resolved.
- [x] Full verification passed on the task branch.
- [ ] Task branch merged back to `main`.
- [ ] Full verification passed on `main`.
- [x] Durable task/work/review logs updated with final commits and verification.
