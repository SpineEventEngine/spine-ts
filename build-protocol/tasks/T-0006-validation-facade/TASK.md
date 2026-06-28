# T-0006: Validation Facade

Status: Round-2 focused fix complete; ready for round 3
Start: `2026-06-28 17:22 WEST`
End: Pending
Setup baseline commit: `62ffc33`
Implementation baseline commit: `e953662`
Task log path: `build-protocol/tasks/T-0006-validation-facade/TASK.md`
Branch: `task/T-0006a-validation-facade-contract`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0006a-validation-facade-contract`
Authoring sub-agent: T-0006a implementation sub-agent (Codex)
Reviewer sub-agents: Round 2 completed; round 3 pending dispatch
Implementation commit: `4726985e1786929f5222707dc7abf77c448e8fa3`
Review-finding log HEAD: `7d519d1f4555ffab058d1642065947355c0acf9e`
Review-fix commit: `0cecc9304eaf4ba2d16b3c4b5101d1b1c4ffbc89`
Round-2 findings log HEAD: `15b7933216b038888e10ab3cbbefc93c7a79d78d`
Current branch HEAD before round-2 fix: `15b7933216b038888e10ab3cbbefc93c7a79d78d`
Round-2 code-fix commit: `74d56ab798eb3fad09759d69e480985320af363a`
Round-2 log handoff commit: `76f6b017c55e51f5af639a837b2b529a469d47ac`
Current branch HEAD: `76f6b017c55e51f5af639a837b2b529a469d47ac`
Final branch HEAD: Pending round-3 review closure

## Objective

Implement the first `@spine-ts/core` validation facade over
`@spine-event-engine/validation-ts` for single-message validation, preserve
structured Spine validation errors, and add the framework-owned seam for later
state-transition validation such as `(set_once)`.

## Required Inputs Read

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/skills/EXPECTED_SKILLS.md`
- `build-protocol/tasks/T-0004-proto-intake/TASK.md`
- `build-protocol/tasks/T-0005-metadata-type-registry/TASK.md`
- `spine-jvm-docs/spine-validation-storage-observability-and-support.md`
- `spine-jvm-docs/spine-domain-model-and-signals.md`

## Requirements Splitter Output

Requirements splitter: `019f0f0b-fb2c-7f41-a030-31329ce630dd`.

Blocking questions: none.

Staged roadmap:

1. Dependency and contract discovery: verify current
   `@spine-event-engine/validation-ts` package metadata, peer compatibility,
   exported API, result/error shape, and ESM behavior; record the dependency
   decision.
2. Core facade public contract: expose typed validation APIs from
   `@spine-ts/core` while hiding direct `validation-ts` imports from framework
   users.
3. Single-message validation adapter: call the upstream validator for valid and
   invalid Protobuf-ES messages and provide result and throwing check paths.
4. Spine error contract preservation: construct/expose
   `spine.validation.ValidationError` data with repeated `ConstraintViolation`
   values and avoid making deprecated proto fields the primary API.
5. Transition-validation seam: define framework-owned previous/next state
   validation interfaces for stateful rules such as `(set_once)`.
6. Docs and API checks: update package README, framework guide, API docs,
   architecture notes, and TypeDoc export assertions.
7. Verification and review closure: run full verification, maintain at least
   90% coverage, and complete all five reviewer roles with no remaining
   comments.

Selected first non-blocked implementable slice: T-0006a validation dependency
and facade contract. Owned files include `packages/core/package.json`,
`pnpm-lock.yaml`, `packages/core/src/index.ts`,
`packages/core/src/index.test.ts`, `scripts/check-api-docs.mjs`, T-0006 durable
logs, and docs needed by the public API.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Skill sources checked:

| Source                                     | Scope Checked                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------ | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Session skill inventory                    | Task-relevant subset exposed in session   | Applicable installed skills include `subagent-driven-development`, `using-git-worktrees`, `implement`, `test-driven-development`, `tdd`, `requesting-code-review`, `receiving-code-review`, `verification-before-completion`, `architecture-decision-records`, `typescript-advanced-types`, `nodejs-backend-patterns`, `javascript-testing-patterns`, `codebase-design`, `security-best-practices`, and `performance`. |
| Task-provided skill names/paths            | User request and protocol requirements    | User required sub-agents, review loops, tool investigation, durable logs, and installed skills use where needed.                                                                                                                                                                                                                                                                                                       |
| `build-protocol/skills/EXPECTED_SKILLS.md` | Checked                                   | Expected manifest names sub-agent/worktree/review/verification and TypeScript/backend skills.                                                                                                                                                                                                                                                                                                                          |
| `~/.agents/skills/*/SKILL.md`              | Full user skill directory entrypoint scan | `find ~/.agents/skills -maxdepth 2 -type f -name SKILL.md -print` listed expected skills and additional advisory skills.                                                                                                                                                                                                                                                                                               |
| `~/.agents/.skill-lock.json`               | Checked first section and source metadata | Manifest records expected installed GitHub-sourced skills, including `obra/superpowers`, `mattpocock/skills`, and `wshobson/agents` entries.                                                                                                                                                                                                                                                                           |

Selected skills read before task actions:

| Skill                                                | Source                                                                                                | Applicability                                                                     | Instructions Applied                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `subagent-driven-development`                        | `~/.agents/skills/subagent-driven-development/SKILL.md`                                               | Required by the user and build protocol for delegated implementation/review flow. | Use isolated agents for splitter, implementer, reviewers, and close them when done. |
| `using-git-worktrees`                                | `~/.agents/skills/using-git-worktrees/SKILL.md`                                                       | Required for one worktree per task/sub-task.                                      | Create a task branch/worktree before implementation.                                |
| `implement`                                          | `~/.agents/skills/implement/SKILL.md`                                                                 | Implementation worker guidance.                                                   | Give the worker a concrete brief, ownership, and verification expectations.         |
| `test-driven-development` and `tdd`                  | `~/.agents/skills/test-driven-development/SKILL.md`, `~/.agents/skills/tdd/SKILL.md`                  | Validation facade behavior must be specified by tests first.                      | Require RED/GREEN evidence for new validation APIs.                                 |
| `requesting-code-review` and `receiving-code-review` | `~/.agents/skills/requesting-code-review/SKILL.md`, `~/.agents/skills/receiving-code-review/SKILL.md` | Required review loop and feedback handling.                                       | Review before merge; verify findings before changes.                                |
| `verification-before-completion`                     | `~/.agents/skills/verification-before-completion/SKILL.md`                                            | Required before marking the task complete.                                        | Run full repository verification and record exact outcomes.                         |
| `architecture-decision-records`                      | `~/.agents/skills/architecture-decision-records/SKILL.md`                                             | Validation facade dependency and boundary decisions must be recorded.             | Add/update decision records before or alongside dependency/API choices.             |
| `typescript-advanced-types`                          | `~/.agents/skills/typescript-advanced-types/SKILL.md`                                                 | Public validation APIs should preserve schema/message generics.                   | Prefer typed facade signatures over untyped message plumbing.                       |
| `nodejs-backend-patterns`                            | `~/.agents/skills/nodejs-backend-patterns/SKILL.md`                                                   | Validation errors are runtime/backend API concerns.                               | Keep error handling explicit and structured.                                        |
| `javascript-testing-patterns`                        | `~/.agents/skills/javascript-testing-patterns/SKILL.md`                                               | Unit and integration tests for facade behavior.                                   | Use focused Vitest tests plus full verification.                                    |
| `codebase-design`                                    | `~/.agents/skills/codebase-design/SKILL.md`                                                           | Keep the validation facade boundary small and deep.                               | Hide third-party validator details behind `@spine-ts/core`.                         |

Skills passed to sub-agents/reviewers:

| Recipient             | Skills/Instructions Passed                                                                                                                                                                                                                                                 | Notes                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Requirements splitter | `subagent-driven-development`, `architecture-decision-records`, `typescript-advanced-types`, `codebase-design`; project protocol references                                                                                                                                | Split validation facade into implementable, reviewable slices and identify blockers. |
| Implementer           | `implement`, `test-driven-development`, `tdd`, `using-git-worktrees`, `verification-before-completion`, `architecture-decision-records`, `typescript-advanced-types`, `javascript-testing-patterns`, `nodejs-backend-patterns`, `codebase-design`, `receiving-code-review` | To be passed after splitter output and branch/worktree creation.                     |
| Reviewers             | `requesting-code-review`, `code-review-excellence`, role-specific skill summaries                                                                                                                                                                                          | To be passed when branch is ready for review.                                        |

Skipped relevant-looking skills:

| Skill                     | Source                                            | Reason Skipped                                                                                                 |
| ------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `planning-with-files`     | `~/.agents/skills/planning-with-files/SKILL.md`   | Project build protocol already defines durable task/work/review logs; no separate planning file format needed. |
| `api-design-principles`   | `~/.agents/skills/api-design-principles/SKILL.md` | Useful but less directly applicable than TypeScript/core API skills for this narrow facade.                    |
| `security-best-practices` | Session/system skill                              | Reserved for the dedicated security reviewer, not the initial task setup.                                      |
| `performance`             | `~/.agents/skills/performance/SKILL.md`           | Reserved for performance/reliability review; this is not a web performance task.                               |

Conflict resolution: project protocol, task scope, sandbox/approval rules, and
explicit human/orchestrator authorization override advisory skill content.

### Implementation Sub-Agent Skill Applicability Check

Timestamp: `2026-06-28 17:36 WEST`

Canonical checklist performed before implementation actions:

- Session skill inventory exposed in this conversation includes the
  task-selected skills `implement`, `test-driven-development`, `tdd`,
  `verification-before-completion`, `receiving-code-review`,
  `architecture-decision-records`, `typescript-advanced-types`,
  `javascript-testing-patterns`, `nodejs-backend-patterns`,
  `codebase-design`, and `using-git-worktrees`, plus related review/security
  skills reserved for later reviewer roles.
- Task-provided selected skills were read from the implementation brief and
  matched against the session inventory.
- Repo-local manifest `build-protocol/skills/EXPECTED_SKILLS.md` was read.
- User-installed skill entrypoints were enumerated with
  `find /Users/armiol/.agents/skills -maxdepth 2 -type f -name SKILL.md -print`.
- Installed-skill lock evidence was sampled from
  `/Users/armiol/.agents/.skill-lock.json`; expected sources include
  `mattpocock/skills`, `obra/superpowers`, and `wshobson/agents`.
- Selected `SKILL.md` files were fully read before governed actions:
  `implement`, `test-driven-development`, `tdd`,
  `verification-before-completion`, `receiving-code-review`,
  `architecture-decision-records`, `typescript-advanced-types`,
  `javascript-testing-patterns`, `nodejs-backend-patterns`,
  `codebase-design`, and `using-git-worktrees`.
- Worktree detection per `using-git-worktrees` found
  `git rev-parse --git-dir` at
  `/Users/armiol/development/experiments/spine-ts/.git/worktrees/T-0006a-validation-facade-contract`,
  `git rev-parse --git-common-dir` at
  `/Users/armiol/development/experiments/spine-ts/.git`, no superproject, and
  branch `task/T-0006a-validation-facade-contract`; this is already an isolated
  worktree, so no new worktree was created.
- Skipped relevant-looking skills: `requesting-code-review` is reserved for the
  later review request loop; `code-review-excellence`, `security-best-practices`,
  `performance`, and `api-design-principles` are more appropriate for dedicated
  reviewer/advisory roles than this implementation slice; `planning-with-files`
  is superseded by the project build-protocol logs.
- Conflict resolution: installed skills are advisory only. `BUILD_PROTOCOL.md`,
  `CODE_QUALITY.md`, task scope, sandbox/approval rules, and explicit
  human/orchestrator authorization govern this implementation.

### Review-Fix Skill Applicability Check

Timestamp: `2026-06-28 18:15 WEST`

Canonical checklist performed before review-fix implementation actions:

- Session skill inventory exposed in this conversation includes the
  review-fix-relevant skills `receiving-code-review`,
  `test-driven-development`, `verification-before-completion`,
  `security-best-practices`, plus the previously selected implementation
  skills for TypeScript API design and test coverage.
- The human review-fix brief explicitly requires receiving round-1 feedback,
  using TDD for new behavior, updating durable logs, running focused checks and
  full `CI=true corepack pnpm verify`, and committing the fix pass.
- Repo-local protocol `build-protocol/BUILD_PROTOCOL.md` was read before
  review-fix edits; `build-protocol/skills/EXPECTED_SKILLS.md` was already
  recorded for this task.
- Selected `SKILL.md` files fully read before governed actions:
  `receiving-code-review`, `test-driven-development`,
  `verification-before-completion`, and `security-best-practices`.
- Security reference check found no Node library-specific reference file in
  the available security skill bundle; the fix pass applies the general
  secure-default rule of minimizing exposed payload data and avoiding raw
  exception leakage.
- Worktree check confirmed branch
  `task/T-0006a-validation-facade-contract` at review-finding log head
  `7d519d1f4555ffab058d1642065947355c0acf9e` with a clean status.
- Skipped relevant-looking skills: `requesting-code-review` is reserved for
  the next review request after fixes; `planning-with-files` remains superseded
  by the build-protocol task/work/review logs.
- Conflict resolution: review comments are actionable and aligned with the
  task scope. Project protocol, task scope, sandbox/approval rules, and
  explicit human/orchestrator authorization govern over advisory skill content.

Review-fix TDD plan:

1. Add RED coverage for the discriminated validation result invariant.
2. Add RED coverage for default redaction and structured upstream validator
   failures.
3. Add RED coverage for transition-rule exception isolation and deterministic
   ordering.
4. Implement minimal facade changes, update docs/API logs, then run focused and
   full verification.

### Round-2 Focused Fix Skill Applicability Check

Timestamp: `2026-06-28 18:40 WEST`

Canonical checklist performed before round-2 fix implementation actions:

- Session skill inventory exposed in this conversation includes
  `receiving-code-review`, `test-driven-development`,
  `verification-before-completion`, and `security-best-practices`, which match
  the security and durable-log review-fix brief.
- Human round-2 feedback requires strict safe-by-default placeholder redaction,
  TDD RED/GREEN evidence, focused and full verification, durable log metadata
  consistency, and commits without merging.
- Repo-local protocol `build-protocol/BUILD_PROTOCOL.md` and manifest
  `build-protocol/skills/EXPECTED_SKILLS.md` were read before round-2 fix
  edits.
- Selected `SKILL.md` files fully read before governed actions:
  `receiving-code-review`, `test-driven-development`,
  `verification-before-completion`, and `security-best-practices`.
- Security reference check found no Node library-specific security reference in
  the available security skill bundle; the fix applies the general
  secure-default rule of exposing no raw upstream placeholder values.
- Worktree check confirmed branch
  `task/T-0006a-validation-facade-contract` at round-2 findings log head
  `15b7933216b038888e10ab3cbbefc93c7a79d78d` with a clean status.
- Skipped relevant-looking skills: `requesting-code-review` is reserved for
  the next review request after this focused fix; `planning-with-files` remains
  superseded by the build-protocol task/work/review logs.
- Conflict resolution: round-2 security feedback is technically correct because
  upstream `TemplateString.placeholderValue` keys are unrestricted. The facade
  will redact all upstream placeholder values while preserving keys.

Round-2 TDD plan:

1. Add RED regression coverage proving arbitrary upstream placeholder keys do
   not leak through `validateMessage().violations`, `validateMessage().error`,
   or `ValidationException.asMessage()`.
2. Implement strict value redaction for every upstream placeholder key.
3. Update docs/logs to say all upstream placeholder values are redacted by
   default.
4. Run focused validation tests, relevant checks, full
   `CI=true corepack pnpm verify`, then commit the code fix and a final log
   handoff if needed to record exact commit metadata.

## Scope

In scope:

- Current dependency/tooling investigation for
  `@spine-event-engine/validation-ts` before selecting the package version.
- Public validation facade in `@spine-ts/core`, with generic schema/message API.
- Structured validation result and exception surface aligned with Spine
  `ValidationError`/`ConstraintViolation` concepts.
- Adapter boundary that hides direct dependency details from framework callers.
- Tests and docs for valid, invalid, and exception-based validation paths.
- Documented seam for state-transition validation such as `(set_once)`, even if
  full entity transaction enforcement remains in a later runtime task.

Out of scope:

- Full entity transaction/runtime layer.
- Complete generated validator implementation if `validation-ts` supplies it.
- Remote service acknowledgement/rejection envelopes.
- ZeroMQ transport or multi-process runtime behavior.
- To-do example integration unless needed for a minimal validation usage sample.

## Work Log

- `2026-06-28 17:22 WEST`: Created T-0006 durable task, work, and review logs
  before splitter work.
- `2026-06-28 17:27 WEST`: Recorded splitter output, current dependency
  inspection, and D-0029 before creating the implementation worktree.
- `2026-06-28 17:31 WEST`: Created branch
  `task/T-0006a-validation-facade-contract` and worktree
  `.worktrees/T-0006a-validation-facade-contract` at base `e953662`.
- `2026-06-28 17:33 WEST`: Baseline `CI=true corepack pnpm verify` passed in
  the T-0006a worktree.
- `2026-06-28 18:11 WEST`: Dispatched round-1 reviewer sub-agents for
  maintainability, documentation, TypeScript/API docs, security, and
  performance/reliability.
- `2026-06-28 18:18 WEST`: Recorded round-1 reviewer findings; changes are
  required before re-review.
- `2026-06-28 18:15 WEST`: Review-fix sub-agent confirmed current branch head
  `7d519d1f4555ffab058d1642065947355c0acf9e`, reread applicable skills, and
  recorded the RED/GREEN fix plan before behavior changes.
- `2026-06-28 18:18 WEST`: Added review-fix RED tests for result narrowing,
  default redaction, upstream structured failures, and transition-rule
  isolation.
- `2026-06-28 18:19 WEST`: Implemented review-fix GREEN candidate: a
  discriminated validation result, default upstream value redaction, structured
  validation-runtime failures, and transition-rule exception isolation.
- `2026-06-28 18:21 WEST`: Updated docs/logs for review-fix findings and ran
  focused quality checks before full verification.
- `2026-06-28 18:23 WEST`: Full review-fix verification pass 1 succeeded;
  final log formatting and a final full verify pass remain before commit.
- `2026-06-28 18:25 WEST`: Final review-fix verification pass succeeded on the
  formatted tree; logs were updated with final evidence before commit.
- `2026-06-28 18:42 WEST`: Added round-2 strict-redaction regression tests and
  captured RED focused test evidence before implementation.
- `2026-06-28 18:42 WEST`: Implemented strict all-placeholder-value redaction
  and captured GREEN focused validation test evidence.
- `2026-06-28 18:44 WEST`: Updated docs for strict placeholder redaction and
  captured focused quality check evidence before full verification.
- `2026-06-28 18:45 WEST`: Full round-2 verification passed before the
  round-2 code-fix commit.
- `2026-06-28 18:47 WEST`: Committed round-2 code fix as
  `74d56ab798eb3fad09759d69e480985320af363a`; recording exact commit metadata
  in durable logs before log-finalization commit.
- `2026-06-28 18:30 WEST`: Recorded review-fix commit
  `0cecc9304eaf4ba2d16b3c4b5101d1b1c4ffbc89` and prepared round-2 review
  dispatch.
- `2026-06-28 18:31 WEST`: Dispatched round-2 reviewer sub-agents for
  maintainability, documentation, TypeScript/API docs, security, and
  performance/reliability.
- `2026-06-28 18:36 WEST`: Recorded round-2 reviewer findings; strict
  placeholder redaction and durable-log metadata fixes are required before
  re-review.
- `2026-06-28 17:36 WEST`: T-0006a implementation sub-agent performed the
  canonical skill applicability check, confirmed the assigned isolated
  worktree, and recorded selected/skipped skills before implementation edits.
- `2026-06-28 17:40 WEST`: Began TDD RED cycle 1 by adding a public
  `validateMessage()` facade test for a valid `ValidationError` message using
  only `@spine-ts/core` imports.
- `2026-06-28 17:43 WEST`: Installed exact
  `@spine-event-engine/validation-ts@2.0.0-snapshot.4` dependency in
  `@spine-ts/core`, inspected its declarations, and added the minimal
  dependency-backed `validateMessage()` implementation with repo-local
  validation error types.
- `2026-06-28 17:46 WEST`: GREEN cycle 1 focused test passed, then RED cycle 2
  added a deterministic descriptor fixture with `(required) = true` and a
  `checkValid()`/`ValidationException.asMessage()` test.
- `2026-06-28 17:47 WEST`: RED cycle 2 failed on the missing exception
  constructor; added `ValidationException` and `checkValid()` on top of the
  shared `validateMessage()` adapter path.
- `2026-06-28 17:48 WEST`: GREEN cycle 2 focused test passed, then RED cycle 3
  added non-throwing invalid-result assertions and a missing
  `createValidationError()` public helper test.
- `2026-06-28 17:49 WEST`: RED cycle 3 failed on the missing helper; added
  `createValidationError()` and routed `validateMessage()` through it.
- `2026-06-28 17:50 WEST`: GREEN cycle 3 focused test passed, then RED cycle 4
  added a framework-owned `validateTransition()` seam test that is separate
  from single-message validation.
- `2026-06-28 17:51 WEST`: RED cycle 4 failed on the missing transition
  facade; added `TransitionValidationRequest`, `TransitionValidationRule`,
  `TransitionValidationResult`, and `validateTransition()`.
- `2026-06-28 17:54 WEST`: GREEN cycle 4 focused test passed, then updated
  TypeDoc export checks and package/user/API/architecture docs for the
  validation facade and transition seam.
- `2026-06-28 17:56 WEST`: Focused verification passed for typecheck, core
  validation tests, and API docs/export guard.
- `2026-06-28 17:58 WEST`: Full verification failed at lint. Fixed
  `ValidationException` message formatting and removed deprecated
  `ConstraintViolation` fields from the upstream-to-local conversion helper.
- `2026-06-28 17:59 WEST`: Post-lint-fix focused core tests and lint passed.
- `2026-06-28 18:00 WEST`: Full verification attempt 2 failed at
  `format:check`; ran Prettier on the four touched files.
- `2026-06-28 18:01 WEST`: Full verification attempt 3 failed at
  `format:check` on the work log after recording attempt 2; reran Prettier on
  the durable logs.
- `2026-06-28 18:03 WEST`: Full verification attempt 4 reached coverage and
  failed because branch coverage was 89.13%; added focused tests for the
  `checkValid()` valid path and empty transition-rule path.
- `2026-06-28 18:04 WEST`: Focused coverage passed after the coverage test
  addition.
- `2026-06-28 18:06 WEST`: Full verification attempt 5 passed.
- `2026-06-28 18:08 WEST`: Final full verification pass completed on the
  formatted tree.

## Decisions

- Existing constraints: `PROTOBUF_CONTRACT.md` mandates
  `@spine-event-engine/validation-ts` for single-message validation and
  framework-level state-transition validation for `(set_once)`.
- `D-0029`: use exact `@spine-event-engine/validation-ts@2.0.0-snapshot.4`
  behind a core facade, based on npm metadata checked on 2026-06-28.
- Review-fix adapter locality decision: keep validation adapter helpers private
  in `packages/core/src/index.ts` for this pass because the package currently
  exposes a single small entry-point module and the review fixes only add
  boundary helpers for that facade. Split a dedicated validation module when
  `@spine-ts/core` grows beyond registry plus validation facade responsibilities.

## Human Questions And Answers

- Blocking questions: none known at setup time.
- Non-blocking questions: none yet.

## Files Changed

- `packages/core/package.json`
- `pnpm-lock.yaml`
- `packages/core/src/index.ts`
- `packages/core/src/index.test.ts`
- `packages/core/src/validation-facade-boundary.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/core/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `build-protocol/tasks/T-0006-validation-facade/TASK.md`
- `build-protocol/work-logs/T-0006.md`
- `build-protocol/reviews/T-0006-validation-facade.md`

## Tests Run

- Round-2 RED focused tests:
  `corepack pnpm test packages/core/src/index.test.ts
packages/core/src/validation-facade-boundary.test.ts` failed as expected.
  Vitest ran 20 tests: 17 passed and 3 failed because the heuristic redaction
  still preserved upstream placeholder values for unrestricted keys such as
  `field`, `minimum`, `candidate`, and `email`.
- Round-2 GREEN focused validation tests:
  `corepack pnpm test packages/core/src/index.test.ts
packages/core/src/validation-facade-boundary.test.ts` passed with 2 test files
  and 20 tests.
- Round-2 focused quality checks: `corepack pnpm typecheck`,
  `corepack pnpm test packages/core/src/index.test.ts
packages/core/src/validation-facade-boundary.test.ts`, `corepack pnpm lint`,
  `corepack pnpm docs:check`, and `corepack pnpm format:check` all passed.
  Docs check confirmed 13 expected `@spine-ts/proto` exports and 21 expected
  `@spine-ts/core` exports with the known invalid `origin` TypeDoc warning.
- Round-2 full verification before code-fix commit:
  `CI=true corepack pnpm verify` passed. Vitest ran 9 test files and 32 tests;
  coverage statements 99.19%, branches 92.85%, functions 100%, lines 99.18%;
  docs check confirmed 13 proto exports and 21 core exports with the known
  invalid `origin` TypeDoc warning; proto lint/generate and generated-output
  cleanliness passed.
- Round-2 code-fix commit:
  `74d56ab798eb3fad09759d69e480985320af363a` created with message
  `fix(core): redact validation placeholders strictly`.
- RED cycle 1: `corepack pnpm test packages/core/src/index.test.ts` failed as
  expected. Vitest ran 12 tests; 11 passed and the new
  `validateMessage()` test failed with `TypeError: validateMessage is not a
function`, proving the public facade export is missing.
- GREEN cycle 1: `corepack pnpm test packages/core/src/index.test.ts` passed;
  Vitest ran 12 tests and all passed.
- Review-fix RED typecheck: `corepack pnpm typecheck` failed as expected.
  TypeScript reported that `MessageValidationResult` did not narrow valid
  results to empty violations/undefined error or invalid results to non-empty
  violations/`ValidationError`.
- Review-fix RED focused tests:
  `corepack pnpm test packages/core/src/index.test.ts
packages/core/src/validation-facade-boundary.test.ts` failed as expected. Vitest
  ran 20 tests: 15 passed and 5 failed on unredacted placeholder values, copied
  upstream `fieldValue`, raw upstream exception propagation, and transition-rule
  exception propagation.
- Review-fix GREEN focused checks: `corepack pnpm typecheck` passed;
  `corepack pnpm test packages/core/src/index.test.ts
packages/core/src/validation-facade-boundary.test.ts` passed with 2 test files
  and 20 tests.
- Review-fix focused quality checks: `corepack pnpm typecheck`,
  `corepack pnpm test packages/core/src/index.test.ts
packages/core/src/validation-facade-boundary.test.ts`, `corepack pnpm lint`,
  `corepack pnpm docs:check`, and `corepack pnpm format:check` all passed.
  Docs check confirmed 13 expected `@spine-ts/proto` exports and 21 expected
  `@spine-ts/core` exports with the known invalid `origin` TypeDoc warning.
- Review-fix full verification pass 1: `CI=true corepack pnpm verify` passed.
  Vitest ran 9 test files and 32 tests; coverage statements 99.2%, branches
  94.33%, functions 100%, lines 99.2%; docs check confirmed 13 proto exports
  and 21 core exports with the known invalid `origin` TypeDoc warning; proto
  lint/generate and generated-output cleanliness passed.
- Final review-fix verification pass: `CI=true corepack pnpm verify` passed.
  Vitest ran 9 test files and 32 tests; coverage statements 99.2%, branches
  94.33%, functions 100%, lines 99.2%; docs check confirmed 13 proto exports
  and 21 core exports with the known invalid `origin` TypeDoc warning; proto
  lint/generate and generated-output cleanliness passed.
- RED cycle 2: `corepack pnpm test packages/core/src/index.test.ts` failed as
  expected. Vitest ran 13 tests; 12 passed and the new throwing-path test failed
  because `ValidationException` was still undefined.
- GREEN cycle 2: `corepack pnpm test packages/core/src/index.test.ts` passed;
  Vitest ran 13 tests and all passed.
- RED cycle 3: `corepack pnpm test packages/core/src/index.test.ts` failed as
  expected. Vitest ran 14 tests; 13 passed and the new helper test failed with
  `TypeError: createValidationError is not a function`.
- GREEN cycle 3: `corepack pnpm test packages/core/src/index.test.ts` passed;
  Vitest ran 14 tests and all passed.
- RED cycle 4: `corepack pnpm test packages/core/src/index.test.ts` failed as
  expected. Vitest ran 15 tests; 14 passed and the transition-seam test failed
  with `TypeError: validateTransition is not a function`.
- GREEN cycle 4: `corepack pnpm test packages/core/src/index.test.ts` passed;
  Vitest ran 15 tests and all passed.
- Focused verification: `corepack pnpm typecheck` passed; `corepack pnpm test
packages/core/src/index.test.ts` passed with 1 file and 15 tests; `corepack
pnpm docs:check` passed and confirmed 13 expected `@spine-ts/proto` exports
  and 21 expected `@spine-ts/core` exports, with the known invalid `origin`
  TypeDoc warning.

## Coverage Result

- Focused coverage after coverage fix: statements 99.08%, branches 93.47%,
  functions 100%, lines 99.07%.
- Review-fix full verification pass 1 coverage: statements 99.2%, branches
  94.33%, functions 100%, lines 99.2%.
- Final review-fix coverage: statements 99.2%, branches 94.33%, functions
  100%, lines 99.2%.
- Round-2 full verification coverage: statements 99.19%, branches 92.85%,
  functions 100%, lines 99.18%.

## Documentation And Public API Impact

| Area                             | Impact                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| Package README impact            | `packages/core/README.md` must document the validation facade.          |
| TypeDoc/API docs impact          | Public validation facade exports must be added to TypeDoc checks.       |
| Public API additions/removals    | New validation result/check/exception API expected in `@spine-ts/core`. |
| Framework `USER_GUIDE.md` impact | Must show how framework users validate messages.                        |
| Example `USER_GUIDE.md` impact   | N/A unless the task touches the to-do example.                          |
| API examples                     | Add concise validation examples.                                        |
| Compatibility notes              | Documented the single-message vs transition-validation split.           |

## Security Impact

| Area                    | Impact                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------- |
| Dependencies            | Adds or updates validation dependency after current registry check.                |
| Secrets and credentials | No secrets expected; logs must avoid environment/token dumps.                      |
| IPC                     | N/A. No transport work in this task.                                               |
| Validation              | Central behavior of this task; errors must be structured and non-leaky.            |
| Tenant boundaries       | N/A for first facade unless envelope validation is included by splitter.           |
| `Any`/deserialization   | Must avoid unsafe unpacking; unknown `Any` handling must be documented if touched. |
| Logging                 | Validation errors must be recordable without sensitive payload dumps.              |

## Verification

- Baseline `CI=true corepack pnpm verify` passed before implementation: 8 test
  files and 23 tests passed; coverage statements 98.91%, branches 96.96%,
  functions 100%, lines 98.91%; docs check passed with the known TypeDoc
  invalid `origin` warning; proto lint/generate passed; generated output was
  clean.
- Focused checks passed.
- Full `CI=true corepack pnpm verify` attempt 1 failed at lint:
  `@typescript-eslint/restrict-template-expressions` on the violation count and
  `@typescript-eslint/no-deprecated` on deprecated `msgFormat`, `param`, and
  `violation` fields in the conversion helper.
- Post-fix focused check: `corepack pnpm test packages/core/src/index.test.ts`
  passed with 15 tests; `corepack pnpm lint` passed.
- Full `CI=true corepack pnpm verify` attempt 2 failed at `format:check` on
  `packages/core/src/index.ts`, `packages/core/src/index.test.ts`,
  `build-protocol/tasks/T-0006-validation-facade/TASK.md`, and
  `build-protocol/work-logs/T-0006.md`; `corepack pnpm exec prettier --write`
  rewrote those files.
- Full `CI=true corepack pnpm verify` attempt 3 failed at `format:check` on
  `build-protocol/work-logs/T-0006.md` after recording attempt 2; Prettier was
  rerun on the durable logs.
- Full `CI=true corepack pnpm verify` attempt 4 passed typecheck, lint,
  format, and tests, then failed at coverage: 8 test files and 27 tests passed;
  statements 98.16%, branches 89.13%, functions 100%, lines 98.14%; branch
  threshold requires 90%.
- Focused `corepack pnpm test:coverage` passed after coverage test addition:
  8 test files and 28 tests passed; statements 99.08%, branches 93.47%,
  functions 100%, lines 99.07%.
- Full `CI=true corepack pnpm verify` attempt 5 passed: typecheck, lint,
  format, tests, coverage, docs check, proto lint/generate, and generated-output
  cleanliness all passed. Vitest ran 8 test files and 28 tests; coverage
  statements 99.08%, branches 93.47%, functions 100%, lines 99.07%. TypeDoc
  emitted the known invalid `origin` source-link warning and confirmed 13 proto
  exports plus 21 core exports.
- Final `CI=true corepack pnpm verify` pass completed after final log
  formatting with the same result: 8 test files and 28 tests passed; coverage
  statements 99.08%, branches 93.47%, functions 100%, lines 99.07%; docs check
  passed with the known invalid `origin` warning; proto lint/generate and
  generated-output cleanliness passed.
- Review-fix focused verification passed before the full gate: typecheck,
  focused validation tests, lint, docs check, and format check.
- Review-fix full verification pass 1 succeeded:
  `CI=true corepack pnpm verify` passed typecheck, lint, format, tests,
  coverage, docs check, proto lint/generate, and generated-output cleanliness.
- Final review-fix verification succeeded on the formatted tree:
  `CI=true corepack pnpm verify` passed typecheck, lint, format, tests,
  coverage, docs check, proto lint/generate, and generated-output cleanliness.
- Round-2 full verification succeeded before the code-fix commit:
  `CI=true corepack pnpm verify` passed typecheck, lint, format, tests,
  coverage, docs check, proto lint/generate, and generated-output cleanliness.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                                                                | Owner                    | Linked Task/Decision   | Disposition                                                                                      | Next Review Point         |
| ----------------------------------------------------------------------------- | ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------ | ------------------------- |
| `validation-ts` package API/version may have changed since earlier discovery. | Orchestrator/implementer | D-0029                 | Checked on 2026-06-28; exact `2.0.0-snapshot.4` selected for T-0006.                             | Dependency update reviews |
| `(set_once)` requires previous and proposed state, not a single message.      | T-0006 implementer       | `PROTOBUF_CONTRACT.md` | Implement facade seam now; full entity transaction enforcement may remain in later runtime task. | Runtime/entity task       |

## Review Rounds

- Round 1 completed:
  - Maintainability requested a discriminated validation result type, validation
    adapter locality cleanup, and descriptor-fixture comments.
  - Documentation requested stale log/status/SHA fixes, changed-file inventory,
    guide status cleanup, and namespace correction.
  - TypeScript/API docs reported no comments.
  - Security requested safe-by-default redaction of invalid field values.
  - Performance/reliability requested structured handling for upstream/rule
    exceptions and SHA traceability.
- Review-fix pass completed in
  `0cecc9304eaf4ba2d16b3c4b5101d1b1c4ffbc89`; round-2 reviewer dispatch is
  in progress.
- Round 2 completed:
  - Maintainability reported no comments.
  - Documentation requested stale durable-log headers be made internally
    consistent after round-2 dispatch.
  - TypeScript/API docs reported no comments.
  - Security requested strict safe-by-default redaction for all upstream
    placeholder values, because placeholder keys are unrestricted.
  - Performance/reliability requested stale branch-head and reviewed-basis
    metadata be corrected.

## Integration Result

Pending.
