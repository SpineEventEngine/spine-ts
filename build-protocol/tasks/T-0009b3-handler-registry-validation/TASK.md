# T-0009b.3: Handler Metadata Registry And Validation

Status: Complete and integrated
Start: `2026-06-29 12:49 WEST`
End: `2026-06-29 13:02 WEST`
Baseline commit: `3ecdaf0`
Task log path: `build-protocol/tasks/T-0009b3-handler-registry-validation/TASK.md`
Branch: `task/T-0009b3-handler-registry-validation`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009b3-handler-registry-validation`
Requirements splitter: `019f1334-c2a6-7463-ba98-6dbd12020957` (Parfit)
Authoring sub-agent: T-0009b.3 implementation sub-agent
Reviewer sub-agents: Round 1 completed; durable-log/docs follow-up requested
Branch setup commit: `041dc61`
Implementation baseline commit: `6a99321`
Implementation commit reviewed in round 1: `2c03b6a82902e4abdc066c67703354bf9140944f`
Final reviewed implementation HEAD: `2c03b6a82902e4abdc066c67703354bf9140944f`
Review-fix commit: `19876ac756c96f425d6868b5e68f46e3957e913b`
Review-closure checkpoint: `5975f7d`
Integration merge commit: `d4f92ac`
Integration verification commit: `a836462`

## Objective

Add the first caller-owned `@spine-ts/server` handler metadata registry over
`EntityHandlersMetadata`. The registry must validate duplicate/conflicting
handler declarations and expose deterministic frozen lookup/listing views for
later decorator, transaction, repository, and runtime tasks. It must not invoke
handlers, instantiate entities, mutate global process state, touch storage,
start buses, or introduce ZeroMQ.

## Splitter Result

The requirements splitter selected `T-0009b.3 Handler Metadata Registry And
Validation` as the next non-blocked implementable task after T-0009b.

Staged roadmap:

1. `T-0009b.3 Handler Metadata Registry And Validation`
2. `T-0009b.4 Docs/API Guard For Handler Registry`
3. `T-0009c` decorator adapter targeting the explicit metadata contract
4. Transaction kernel and state-transition validation such as `(set_once)`
5. Entity base classes and repository assembly skeleton

No blocking questions were identified.

## Required Inputs Read

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0009b-handler-metadata/TASK.md`
- `build-protocol/reviews/T-0009b-handler-metadata.md`
- `packages/server/src/handler-metadata.ts`
- `packages/server/src/handler-metadata.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
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
| `epic-breakdown-advisor`         | `~/.agents/skills/epic-breakdown-advisor/SKILL.md`         | Requirements splitting for next slice.    | Split T-0009 continuation into implementable stages.                        |
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | Mandatory review before task completion.  | Review every committed implementation/fix/doc slice.                        |
| `receiving-code-review`          | `~/.agents/skills/receiving-code-review/SKILL.md`          | Required reviewer comment handling.       | Verify comments before fix dispatch; no performative acceptance.            |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims.        | Run and read verification before merge/completion.                          |
| `api-design-principles`          | `~/.agents/skills/api-design-principles/SKILL.md`          | Public registry API design.               | Keep lookup API small, deterministic, and developer-friendly.               |
| `architecture-decision-records`  | `~/.agents/skills/architecture-decision-records/SKILL.md`  | D-0036 duplicate-policy decision.         | Record context, decision, alternatives, consequences, and follow-up.        |
| `domain-modeling`                | `~/.agents/skills/domain-modeling/SKILL.md`                | Handler terminology and duplicate policy. | Preserve Spine command/event handler vocabulary and role boundaries.        |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Typed registry and lookup contracts.      | Prefer useful generics without opaque conditional-type machinery.           |
| `test-driven-development`        | `~/.agents/skills/test-driven-development/SKILL.md`        | New feature implementation.               | Authoring sub-agent must write failing tests before production code.        |
| `javascript-testing-patterns`    | `~/.agents/skills/javascript-testing-patterns/SKILL.md`    | Vitest coverage and focused fixtures.     | Use behavior-level registry validation tests and full verification.         |

Skills passed to sub-agents/reviewers:

| Recipient           | Skills/Instructions Passed                                                          | Notes                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Splitter            | Protocol/spec docs, T-0009b logs, current server sources, `epic-breakdown-advisor`. | Produced T-0009b.3 recommendation with no blockers; splitter was closed after result capture.                            |
| Authoring sub-agent | TDD, JavaScript testing, TypeScript/API, ADR/domain, verification instructions.     | Implemented registry, tests, docs, API guard, and logs in this worktree.                                                 |
| Reviewers           | Round 1 and follow-up completed.                                                    | Round 1 found stale durable-log/docs metadata and one scope wording gap; follow-up re-review was clean across all roles. |

Skipped relevant-looking skills:

| Skill                   | Source                                           | Reason Skipped                                                                           |
| ----------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `cqrs-implementation`   | `~/.agents/skills/cqrs-implementation/SKILL.md`  | Registry validation is still metadata-only and does not implement read/write processing. |
| `saga-orchestration`    | `~/.agents/skills/saga-orchestration/SKILL.md`   | No process-manager orchestration or compensating workflow is in scope.                   |
| `event-store-design`    | `~/.agents/skills/event-store-design/SKILL.md`   | No event persistence, replay, or storage adapter work is in scope.                       |
| `security-threat-model` | `~/.codex/skills/security-threat-model/SKILL.md` | No threat model requested; security reviewer will inspect the bounded diff.              |

## Scope

In scope:

- Caller-owned `HandlerMetadataRegistry` or equivalent registry builder in
  `@spine-ts/server`.
- Registration of existing `EntityHandlersMetadata` objects produced by
  `defineEntityHandlers()`.
- Frozen deterministic listing and lookup views by entity state, handler kind,
  and message full type name.
- Duplicate validation for one command assignment per command type in one
  registry.
- Duplicate validation for one event applier per entity state/event type in one
  registry.
- Many-to-one event subscribers/reactors and command reactions where later
  fan-out semantics need it.
- Focused TDD tests, public exports, TypeDoc comments, API docs guard, package
  README, framework user guide, API README, architecture notes, and durable logs.

Out of scope:

- Handler invocation.
- Decorators or decorator metadata collection.
- Transactions, repositories, storage writes, buses, inbox/delivery, gRPC,
  ZeroMQ, or bounded-context runtime behavior.
- Process-wide global registry mutation.
- State-transition validation such as `(set_once)`.
- Read-side query/subscription execution.

## Decisions

- D-0035: explicit handler registration before decorators.
- D-0036: caller-owned handler registry and duplicate policy.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Files Changed

- `packages/server/src/handler-metadata.ts`
- `packages/server/src/handler-metadata.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `scripts/check-api-docs.mjs`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `build-protocol/tasks/T-0009b3-handler-registry-validation/TASK.md`
- `build-protocol/work-logs/T-0009b3.md`
- `build-protocol/reviews/T-0009b3-handler-registry-validation.md`

## Tests Run

- `corepack pnpm install --offline` failed because
  `@bufbuild/protoplugin@2.12.1` was missing from the local pnpm store.
- `corepack pnpm install` passed with the existing lockfile and hydrated the new
  worktree dependency metadata.
- Baseline `CI=true corepack pnpm verify` passed on
  `2026-06-29 12:52 WEST`: 11 test files / 70 tests passed; coverage statements
  99.44%, branches 93.7%, functions 100%, lines 99.43%; docs/API check
  confirmed 100 proto exports, 28 core exports, 27 server exports, and 26
  storage exports; proto lint/generate/check-generated passed; known TypeDoc
  invalid-origin source-link warning remains.
- RED `corepack pnpm vitest run packages/server/src/handler-metadata.test.ts`
  failed as expected after adding focused registry tests: 5 existing tests passed
  and 5 new tests failed because `HandlerMetadataRegistry` was not a
  constructor.
- GREEN `corepack pnpm vitest run packages/server/src/handler-metadata.test.ts`
  passed after implementation: 1 test file / 10 tests passed.
- RED `corepack pnpm vitest run packages/server/src/index.test.ts` failed as
  expected after adding runtime exports: 8 tests passed and 1 export guard test
  failed until `HandlerMetadataRegistry` and `HandlerMetadataRegistryError` were
  added to the expected runtime surface.
- `corepack pnpm vitest run packages/server/src/handler-metadata.test.ts packages/server/src/index.test.ts`
  passed: 2 test files / 19 tests passed.
- `corepack pnpm typecheck` passed.
- `corepack pnpm docs:check` passed; TypeDoc reported the known invalid
  `origin` source-link warning and confirmed 100 proto exports, 28 core exports,
  32 server exports, and 26 storage exports.
- First `CI=true corepack pnpm verify` run failed at lint because new tests
  destructured builder methods and triggered `@typescript-eslint/unbound-method`.
  Tests were adjusted to call through the builder object.
- Final `CI=true corepack pnpm verify` passed on `2026-06-29 13:02 WEST`: 11
  test files / 75 tests passed; docs/API and proto checks passed with the known
  TypeDoc invalid-origin warning.
- Review-closure branch verification `CI=true corepack pnpm verify` passed on
  `2026-06-29 13:28 WEST` at `5975f7d`: 11 test files / 75 tests passed;
  docs/API and proto checks passed with the known TypeDoc invalid-origin
  warning.

## Coverage Result

- Baseline `CI=true corepack pnpm verify` coverage: statements 99.44%, branches
  93.7%, functions 100%, lines 99.43%.
- Final `CI=true corepack pnpm verify` coverage: statements 99.52%, branches
  93.24%, functions 100%, lines 99.51%.
- Review-closure branch verification coverage: statements 99.52%, branches
  93.24%, functions 100%, lines 99.51%.

## Documentation And Public API Impact

| Area                             | Impact                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------- |
| Package README impact            | Added registry creation/lookup example and duplicate-policy notes.              |
| TypeDoc/API docs impact          | Added registry public types/classes with comments and API guard coverage.       |
| Public API additions/removals    | Added caller-owned registry, lookup/entry types, and structured registry error. |
| Framework `USER_GUIDE.md` impact | Added handler registry usage and non-runtime boundary notes.                    |
| Example `USER_GUIDE.md` impact   | N/A for this slice; to-do example is not implemented yet.                       |
| API examples                     | Expected in server README and API overview.                                     |
| Compatibility notes              | Expected: registry validates metadata before later decorators/runtime use it.   |

## Security Impact

| Area                    | Impact                                                              |
| ----------------------- | ------------------------------------------------------------------- |
| Dependencies            | No new dependencies expected.                                       |
| Secrets and credentials | N/A; no secret handling.                                            |
| IPC                     | N/A; no bus or transport in scope.                                  |
| Validation              | Adds metadata-level duplicate/conflict validation only.             |
| Tenant boundaries       | N/A; registry is caller-owned and not tenant-aware yet.             |
| `Any`/deserialization   | N/A; registry stores schemas/metadata and does not unpack payloads. |
| Logging                 | No payload logging or handler invocation.                           |

## Verification

- Baseline `CI=true corepack pnpm verify` passed in
  `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009b3-handler-registry-validation`
  on `2026-06-29 12:52 WEST`.
- Final `CI=true corepack pnpm verify` passed in
  `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009b3-handler-registry-validation`
  on `2026-06-29 13:02 WEST`.
- Review-closure `CI=true corepack pnpm verify` passed in the same worktree on
  `2026-06-29 13:28 WEST` at `5975f7d`.
- Integration: merged `task/T-0009b3-handler-registry-validation` into `main`
  as `d4f92ac` on `2026-06-29 13:30 WEST`; main verification is the next gate.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                                                   | Owner               | Linked Task/Decision | Disposition                                                      | Next Review Point           |
| ---------------------------------------------------------------- | ------------------- | -------------------- | ---------------------------------------------------------------- | --------------------------- |
| Registry API could imply runtime dispatch.                       | Author/reviewers    | T-0009b.3            | Added lookup-only docs and no-instantiation/no-invocation tests. | Maintainability/docs review |
| Duplicate policy may need refinement for custom command routing. | Future routing task | D-0036               | First policy covers default one-effective-command-handler rule.  | Repository/routing design   |
| Decorator adapter must target this registry contract later.      | T-0009c             | D-0035               | Defer until registry semantics are stable.                       | T-0009c setup               |

## Review Rounds

- Implementation sub-agent self-verification completed against
  `2c03b6a82902e4abdc066c67703354bf9140944f`.
- Round 1 reviewers checked the implementation range
  `6a993212a5fa436a19214fc03ac52901a4035bdd..2c03b6a82902e4abdc066c67703354bf9140944f`.
  Their follow-up was limited to stale durable-log/docs metadata and the scope
  wording for command reactions; this review-fix commit updates those records
  without changing production code.
- Follow-up reviewers checked
  `2c03b6a82902e4abdc066c67703354bf9140944f..19876ac756c96f425d6868b5e68f46e3957e913b`.
  Code style/maintainability, documentation, TypeScript/API docs, security, and
  performance/reliability all returned clean results. All follow-up reviewer
  agents were closed after result capture.

## Integration Result

Implementation and follow-up review loop are clean. Review-closure branch
verification passed, the branch is integrated into `main`, and main verification
passed at `a836462`.
