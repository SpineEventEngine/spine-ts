# T-0006: Validation Facade

Status: Implementation sub-agent active
Start: `2026-06-28 17:22 WEST`
End: Pending
Setup baseline commit: `62ffc33`
Implementation baseline commit: `e953662`
Task log path: `build-protocol/tasks/T-0006-validation-facade/TASK.md`
Branch: `task/T-0006a-validation-facade-contract`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0006a-validation-facade-contract`
Authoring sub-agent: T-0006a implementation sub-agent (Codex)
Reviewer sub-agents: Round 1 completed; changes requested
Implementation commit: `4726985e1786929f5222707dc7abf77c448e8fa3`
Current branch HEAD: `291a9b14b045f602cf56712c1f006a050d291b50`
Final branch HEAD: Pending review-fix pass

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

## Human Questions And Answers

- Blocking questions: none known at setup time.
- Non-blocking questions: none yet.

## Files Changed

- Baseline `CI=true corepack pnpm verify` passed: 8 test files and 23 tests
  passed; coverage statements 98.91%, branches 96.96%, functions 100%, lines
  98.91%; docs check passed with the known TypeDoc invalid `origin` warning;
  proto lint/generate passed; generated output was clean.

## Tests Run

- RED cycle 1: `corepack pnpm test packages/core/src/index.test.ts` failed as
  expected. Vitest ran 12 tests; 11 passed and the new
  `validateMessage()` test failed with `TypeError: validateMessage is not a
function`, proving the public facade export is missing.
- GREEN cycle 1 pending run: `corepack pnpm test packages/core/src/index.test.ts`.
- GREEN cycle 1: `corepack pnpm test packages/core/src/index.test.ts` passed;
  Vitest ran 12 tests and all passed.
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

## Integration Result

Pending.
