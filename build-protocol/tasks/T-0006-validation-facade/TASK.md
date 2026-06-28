# T-0006: Validation Facade

Status: Split complete; ready for implementation worktree
Start: `2026-06-28 17:22 WEST`
End: Pending
Setup baseline commit: `62ffc33`
Implementation baseline commit: `296b784`
Task log path: `build-protocol/tasks/T-0006-validation-facade/TASK.md`
Branch: `task/T-0006a-validation-facade-contract`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0006a-validation-facade-contract`
Authoring sub-agent: Pending
Reviewer sub-agents: Pending
Implementation commit: Pending branch commit
Final branch HEAD: Pending branch commit

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

- Pending.

## Tests Run

- Pending.

## Coverage Result

- Pending.

## Documentation And Public API Impact

| Area                             | Impact                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| Package README impact            | `packages/core/README.md` must document the validation facade.          |
| TypeDoc/API docs impact          | Public validation facade exports must be added to TypeDoc checks.       |
| Public API additions/removals    | New validation result/check/exception API expected in `@spine-ts/core`. |
| Framework `USER_GUIDE.md` impact | Must show how framework users validate messages.                        |
| Example `USER_GUIDE.md` impact   | N/A unless the task touches the to-do example.                          |
| API examples                     | Add concise validation examples.                                        |
| Compatibility notes              | Must document the single-message vs transition-validation split.        |

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

- Pending.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                                                                | Owner                    | Linked Task/Decision   | Disposition                                                                                      | Next Review Point         |
| ----------------------------------------------------------------------------- | ------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------ | ------------------------- |
| `validation-ts` package API/version may have changed since earlier discovery. | Orchestrator/implementer | D-0029                 | Checked on 2026-06-28; exact `2.0.0-snapshot.4` selected for T-0006.                             | Dependency update reviews |
| `(set_once)` requires previous and proposed state, not a single message.      | T-0006 implementer       | `PROTOBUF_CONTRACT.md` | Implement facade seam now; full entity transaction enforcement may remain in later runtime task. | Runtime/entity task       |

## Review Rounds

- Pending.

## Integration Result

Pending.
