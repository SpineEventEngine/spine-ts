# T-0009c.1: Decorator Metadata Collection

Status: In progress
Start: `2026-06-29 13:37 WEST`
End: TBD
Baseline commit: `de0860f`
Task log path: `build-protocol/tasks/T-0009c1-decorator-metadata-collection/TASK.md`
Branch: `task/T-0009c1-decorator-metadata-collection`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009c1-decorator-metadata-collection`
Requirements splitter: `019f135f-f815-7143-928f-8ba84237d0af` (Goodall)
Branch setup commit: `e711edc`
Authoring sub-agent: `019f1368-7ce7-75b3-90e6-b20e86b54e1b`
Reviewer sub-agents: Round 1 completed; see review log.
Baseline verification evidence commit: `07e40c0`
Implementation commit under review: `39008b7`
Round 1 fix commit: `f84ca92`
Round 2 fix commit: `e480a33`

## Objective

Add the first TypeScript 5+ standard decorator adapter for the explicit
`@spine-ts/server` handler metadata contract. Decorators must collect
metadata only, require explicit Protobuf-ES schema arguments, avoid global
process-wide registration, and materialize into the same
`EntityHandlersMetadata` shape accepted by `HandlerMetadataRegistry`.

## Splitter Result

The requirements splitter selected `T-0009c: Standard Decorator Adapter And
Explicit Fallback Parity` after deciding that `T-0009b.4` was absorbed by
`T-0009b.3`.

Staged roadmap:

1. `T-0009c.1 Decorator Metadata Collection`
2. `T-0009d` transaction kernel and built-in state-transition validation,
   especially `(set_once)`
3. `T-0009e` concrete OOP entity base classes with capability/read-write
   segregation
4. `T-0009f` repository seams and bounded-context registration skeleton
5. Later runtime dispatch, storage integration, buses, services, transport,
   and to-do example behavior

No blocking questions were identified.

## Required Inputs Read

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0009b3-handler-registry-validation/TASK.md`
- `build-protocol/work-logs/T-0009b3.md`
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
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | Mandatory review before task completion.  | Review implementation and any review-fix ranges.                            |
| `receiving-code-review`          | `~/.agents/skills/receiving-code-review/SKILL.md`          | Required reviewer comment handling.       | Verify comments before fix dispatch; no performative acceptance.            |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims.        | Run and read verification before merge/completion.                          |
| `test-driven-development`        | `~/.agents/skills/test-driven-development/SKILL.md`        | New public decorator behavior.            | Authoring sub-agent must write failing tests before production code.        |
| `javascript-testing-patterns`    | `~/.agents/skills/javascript-testing-patterns/SKILL.md`    | Vitest coverage and fixture design.       | Behavior-level decorator and registry-parity tests.                         |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Typed decorator APIs and materialization. | Prefer useful generics without opaque conditional-type machinery.           |
| `architecture-decision-records`  | `~/.agents/skills/architecture-decision-records/SKILL.md`  | D-0037 decorator adapter decision.        | Record context, decision, alternatives, and consequences.                   |

Skills to pass to sub-agents/reviewers:

| Recipient           | Skills/Instructions To Pass                                                                                   | Notes                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Authoring sub-agent | TDD, JavaScript testing, TypeScript/API, ADR/domain, verification instructions.                               | Must implement in the task worktree and update durable logs/docs.      |
| Reviewers           | Five role-specific reviewers: maintainability, documentation, TS/API docs, security, performance/reliability. | Must inspect the committed task range and report clean/finding status. |

Skipped relevant-looking skills:

| Skill                 | Source                                          | Reason Skipped                                                                      |
| --------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `cqrs-implementation` | `~/.agents/skills/cqrs-implementation/SKILL.md` | Decorator collection is metadata-only and does not implement read/write processing. |
| `event-store-design`  | `~/.agents/skills/event-store-design/SKILL.md`  | No event persistence, replay, or storage adapter work is in scope.                  |
| `saga-orchestration`  | `~/.agents/skills/saga-orchestration/SKILL.md`  | No process-manager execution, compensation, or orchestration runtime is in scope.   |

## Scope

In scope:

- Public `@Assign`, `@Command`, `@Subscribe`, `@React`, and `@Apply`
  standard method decorators.
- Explicit schema arguments for every decorator; no `emitDecoratorMetadata`,
  reflect-metadata, parameter decorators, or inferred message types.
- Class-owned deterministic metadata collection with no global registry
  mutation and no handler invocation.
- A public materialization function that converts decorated class metadata
  into `EntityHandlersMetadata` compatible with `HandlerMetadataRegistry`.
- Registry parity tests proving decorator-produced metadata can be registered
  and queried through the existing lookup/duplicate policy.
- Focused TDD tests, public exports, TypeDoc comments, API docs guard, package
  README, framework user guide, API README, architecture notes, and durable logs.

Out of scope:

- Handler invocation.
- Transactions, repositories, storage writes, buses, inbox/delivery, gRPC,
  ZeroMQ, or bounded-context runtime behavior.
- Process-wide global registry mutation.
- State-transition validation such as `(set_once)`.
- Code generation for handler registration.
- Read-side query/subscription execution.

## Decisions

- D-0035: explicit handler registration before decorators.
- D-0036: caller-owned handler registry and duplicate policy.
- D-0037: standard decorators are metadata-only adapters over explicit handler
  registration.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none known for setup.

## Files Changed

- `packages/server/src/handler-decorators.ts`
- `packages/server/src/handler-decorators.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `scripts/check-api-docs.mjs`
- `tsconfig.base.json`
- `build-protocol/tasks/T-0009c1-decorator-metadata-collection/TASK.md`
- `build-protocol/tasks/T-0009c1-decorator-metadata-collection/IMPLEMENTATION_REPORT.md`
- `build-protocol/tasks/T-0009c1-decorator-metadata-collection/ROUND1_FIX_REPORT.md`
- `build-protocol/work-logs/T-0009c1.md`
- `build-protocol/reviews/T-0009c1-decorator-metadata-collection.md`

## Tests Run

- `corepack pnpm install --offline` failed because
  `@bufbuild/buf@1.71.0` was missing from the local pnpm store.
- `corepack pnpm install` passed with the existing lockfile and hydrated the new
  worktree dependency metadata.
- First baseline `CI=true corepack pnpm verify` failed at `format:check`
  because the new T-0009c.1 setup logs needed Prettier formatting.
- `corepack pnpm exec prettier --write
build-protocol/tasks/T-0009c1-decorator-metadata-collection/TASK.md
build-protocol/work-logs/T-0009c1.md` formatted the setup logs.
- Baseline `CI=true corepack pnpm verify` passed on `2026-06-29 13:41 WEST`:
  11 test files / 75 tests passed; coverage statements 99.52%, branches
  93.24%, functions 100%, lines 99.51%; docs/API and proto checks passed with
  the known TypeDoc invalid-origin warning.
- RED `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  failed on `2026-06-29 13:48 WEST` with five expected failures because
  `Assign` was not yet implemented/exported.
- GREEN `corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
  passed on `2026-06-29 13:50 WEST`: 1 test file / 5 tests passed.
- Focused export/decorator check `corepack pnpm vitest run
packages/server/src/handler-decorators.test.ts packages/server/src/index.test.ts`
  passed on `2026-06-29 13:52 WEST`: 2 test files / 14 tests passed.
- `corepack pnpm typecheck` passed on `2026-06-29 13:53 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-29 13:52 WEST` with the known
  TypeDoc invalid-origin warning.
- First full `CI=true corepack pnpm verify` failed at lint on
  `2026-06-29 13:53 WEST`; lint reported unnecessary single-use generics in
  decorator factories and a redundant `context.kind` check.
- Final `CI=true corepack pnpm verify` passed on `2026-06-29 13:56 WEST`: 12
  test files / 80 tests passed; coverage statements 98.89%, branches 91.42%,
  functions 100%, lines 98.86%; docs/API, proto lint/generate, and generated
  output checks passed with the known TypeDoc invalid-origin warning.
- Round 1 RED `corepack pnpm vitest run
packages/server/src/handler-decorators.test.ts` failed with two expected
  failures: semantic TypeScript reported TS1241 for a typed decorated handler,
  and copied method materialization borrowed the source class handler metadata.
- Round 1 GREEN `corepack pnpm vitest run
packages/server/src/handler-decorators.test.ts` passed on
  `2026-06-29 14:13 WEST`: 1 test file / 7 tests passed.
- Round 1 `corepack pnpm typecheck` passed on `2026-06-29 14:14 WEST`.
- Round 1 `corepack pnpm docs:check` passed on `2026-06-29 14:14 WEST` with
  the known TypeDoc invalid-origin warning.
- Round 1 final `CI=true corepack pnpm verify` passed on
  `2026-06-29 14:14 WEST`: 12 test files / 82 tests passed; coverage
  statements 98.72%, branches 91.16%, functions 100%, lines 98.69%;
  docs/API, proto lint/generate, and generated output checks passed with the
  known TypeDoc invalid-origin warning.

## Coverage Result

Round 1 final full verification coverage from `CI=true corepack pnpm verify`:

- Test files / tests: 12 / 82
- Statements: 98.72%
- Branches: 91.16%
- Functions: 100%
- Lines: 98.69%

## Documentation And Public API Impact

| Area                             | Expected Impact                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------- |
| Package README impact            | Document decorator usage and explicit fallback parity.                          |
| TypeDoc/API docs impact          | Add public decorator/materialization APIs with comments and API guard coverage. |
| Public API additions/removals    | Add decorators and a materialization helper; no removals expected.              |
| Framework `USER_GUIDE.md` impact | Add decorator example and no-global-runtime boundary notes.                     |
| Example `USER_GUIDE.md` impact   | N/A for this slice; to-do example is not implemented yet.                       |
| API examples                     | Expected in server README and API overview.                                     |
| Compatibility notes              | Decorators target the same metadata contract as explicit registration.          |

## Security Impact

| Area                 | Expected Impact                                                           |
| -------------------- | ------------------------------------------------------------------------- |
| Secrets/auth         | None; metadata-only local runtime API.                                    |
| Runtime side effects | Must avoid global mutable registration and import-time process mutation.  |
| User code execution  | Must not instantiate entities or invoke handler methods.                  |
| Input validation     | Schema arguments must be explicit descriptor-bearing Protobuf-ES schemas. |

## Performance/Reliability Impact

| Area             | Expected Impact                                                          |
| ---------------- | ------------------------------------------------------------------------ |
| Runtime overhead | Class metadata collection only; materialization should be deterministic. |
| Reliability      | Must avoid import-order-sensitive global registries.                     |
| Concurrency      | No asynchronous processing or transport behavior in scope.               |

## Review Rounds

Implementation authored and verified. Reviewer sub-agents were not spawned by
this implementation sub-agent per the handoff instruction.

Round 1 reviewed implementation commit `39008b7` and was not clean. Findings:

- P1: public decorator types rejected normally typed handler methods under
  strict TypeScript.
- P2: method-function-keyed decorator storage allowed copied/reused method
  functions to borrow another class's metadata.
- P3: durable audit logs contained stale authoring-agent and next-step markers.

Round 1 fix commit `f84ca92` addresses P1/P2 with semantic TypeScript and
copied-method regression tests, class-owned standard decorator metadata, and
generic decorator method types. Durable logs were updated in this report pass.
Next protocol step: re-review the fix range.

Round 2 reviewed the Round 1 fix range and was not clean. Findings:

- P2: `readClassDecoratorMetadata()` read inherited `Symbol.metadata` through
  normal property lookup, allowing an undecorated subclass override with the
  same method name to borrow base-class handler metadata.
- P3: this task log's coverage section still contained pre-Round 1 final
  verification coverage values.

Round 2 focused fix addressed both findings. RED
`corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
failed on `2026-06-29 14:26 WEST` with the expected subclass override metadata
borrowing assertion. GREEN
`corepack pnpm vitest run packages/server/src/handler-decorators.test.ts`
passed on `2026-06-29 14:26 WEST`: 1 test file / 8 tests passed.
After a lint-safe `unknown` annotation for
`Object.getOwnPropertyDescriptor().value`, focused GREEN was rerun on
`2026-06-29 14:28 WEST`: 1 test file / 8 tests passed.
`corepack pnpm typecheck` passed on `2026-06-29 14:27 WEST`.
`corepack pnpm docs:check` passed on `2026-06-29 14:27 WEST` with the known
TypeDoc invalid-origin warning. First Round 2 full
`CI=true corepack pnpm verify` failed at lint because
`Object.getOwnPropertyDescriptor().value` is typed as `any`; after the explicit
`unknown` narrowing, final `CI=true corepack pnpm verify` passed on
`2026-06-29 14:29 WEST`: 12 test files / 83 tests passed; coverage statements
98.72%, branches 91.16%, functions 100%, lines 98.69%; docs/API, proto
lint/generate, and generated output checks passed with the known TypeDoc
invalid-origin warning.

## Completion Checklist

- [x] Baseline verification captured in the task worktree.
- [x] Authoring sub-agent report captured and closed.
- [x] Five reviewer sub-agents completed and closed for Round 1.
- [ ] Review comments either fixed and re-reviewed or technically resolved.
- [x] Full verification passed on the task branch.
- [ ] Task branch merged back to `main`.
- [ ] Full verification passed on `main`.
- [x] Durable task/work/review logs updated with Round 1 fix commit and
      verification.
- [x] Durable task/work/review logs updated with Round 2 fix verification.
