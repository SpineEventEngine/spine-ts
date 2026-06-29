# T-0009d.1: Built-In Set-Once Transition Validation

Status: In progress
Start: `2026-06-29 14:52 WEST`
End: TBD
Baseline commit: `1d939d7`
Task log path: `build-protocol/tasks/T-0009d1-set-once-transition-validation/TASK.md`
Branch: `task/T-0009d1-set-once-transition-validation`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009d1-set-once-transition-validation`
Requirements splitter: `019f13a4-a6f5-7302-94e0-7b16366b0701` (Popper)
Branch setup commit: `88cb0f3`
Authoring sub-agent: TBD
Reviewer sub-agents: TBD
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

## Scope

In scope:

- Public server transition-validation API for entity state transitions.
- Built-in `(set_once)` checks derived from `describeEntityMetadata()`.
- Creation transitions where `previous === undefined` pass `(set_once)` checks.
- Existing-state transitions fail when a `(set_once)` field changes.
- Equal previous/next `(set_once)` values pass.
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

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none known for setup.

## Files Changed

TBD

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

## Coverage Result

TBD

## Documentation And Public API Impact

| Area                             | Expected Impact                                                           |
| -------------------------------- | ------------------------------------------------------------------------- |
| Package README impact            | Document set-once transition validation and metadata-only boundaries.     |
| TypeDoc/API docs impact          | Add public transition validation API with TypeDoc and API guard coverage. |
| Public API additions/removals    | Add high-level server validation API; no removals expected.               |
| Framework `USER_GUIDE.md` impact | Explain single-message vs state-transition validation.                    |
| Example `USER_GUIDE.md` impact   | N/A for this slice; to-do example is not implemented yet.                 |
| API examples                     | Expected in server README and API overview.                               |
| Compatibility notes              | `(set_once)` is enforced after first committed state, not on creation.    |

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

TBD

## Completion Checklist

- [x] Baseline verification captured in the task worktree.
- [ ] Authoring sub-agent report captured and closed.
- [ ] Five reviewer sub-agents completed and closed.
- [ ] Review comments either fixed and re-reviewed or technically resolved.
- [ ] Full verification passed on the task branch.
- [ ] Task branch merged back to `main`.
- [ ] Full verification passed on `main`.
- [ ] Durable task/work/review logs updated with final commits and verification.
