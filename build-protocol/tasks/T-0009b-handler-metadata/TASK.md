# T-0009b: Handler Metadata Contract And Explicit Registration API

Status: Awaiting orchestrator-supplied follow-up re-review package
Start: `2026-06-29 00:40 WEST`
End: Pending
Baseline commit: `11a6c70`
Task log path: `build-protocol/tasks/T-0009b-handler-metadata/TASK.md`
Branch: `task/T-0009b-handler-metadata`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009b-handler-metadata`
Requirements splitter: `019f1097-55bb-7b73-a9f8-706db486721e` (Kierkegaard the 2nd)
Authoring sub-agent: `019f109d-ce8b-7b42-94d3-cc93b9ead054` (Russell the 2nd)
Reviewer sub-agents: Round 1 and follow-up re-review completed
Branch setup commit: `2b03b6b`
Implementation baseline commit: `b1d158e`
Implementation commit: `28d8e419918c14ac1d54079bc912931ce8b23bd9`
Round-1 fix commit: `195112ab968b4560c5efab1c557a56ba59a0182b`
Follow-up fix commit: `b6c8251a7404c974b073615b1a2aa888444bdac4`
Durable-log correction checkpoint: `6b514ac2f2f44af40358bf66135097740befef69`

## Objective

Add the first `@spine-ts/server` handler metadata contract and explicit
registration API. The API must let framework users bind generated Protobuf-ES
command/event schemas to entity class method names and produce deterministic
metadata for later decorator, transaction, repository, and runtime tasks. It
must not execute handlers.

## Splitter Result

The requirements splitter recommended the `T-0009` continuation:

1. `T-0009b.1 Handler Metadata Contract`
2. `T-0009b.2 Explicit Registration API`
3. `T-0009b.3 Handler Registry And Validation`
4. `T-0009b.4 Docs/API Guard`

Selected first non-blocked implementable slice: `T-0009b.1 + T-0009b.2`.

`T-0009b.3` registry validation and `T-0009b.4` broader docs/API guard remain
follow-up slices unless the first implementation discovers that a tiny
caller-owned definition object is required to make explicit registration useful.

## Required Inputs Read

- `build-protocol/BUILD_PROTOCOL.md`
- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/tasks/T-0009a-entity-metadata/TASK.md`
- `build-protocol/DECISION_LOG.md`
- `packages/server/src/entity-metadata.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`

## Skill Applicability

Selected skills read before task actions:

| Skill                            | Source                                                     | Applicability                                      | Instructions Applied                                                        |
| -------------------------------- | ---------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `subagent-driven-development`    | `~/.agents/skills/subagent-driven-development/SKILL.md`    | Required protocol execution model.                 | Splitter, implementer, five reviewer roles, review loop, closure of agents. |
| `using-git-worktrees`            | `~/.agents/skills/using-git-worktrees/SKILL.md`            | Required isolated worktree per task.               | Use project-local `.worktrees` branch/worktree and verify baseline.         |
| `requesting-code-review`         | `~/.agents/skills/requesting-code-review/SKILL.md`         | Mandatory review before task completion.           | Review every committed implementation/fix/doc slice.                        |
| `receiving-code-review`          | `~/.agents/skills/receiving-code-review/SKILL.md`          | Required handling of reviewer comments.            | Verify comments, route actionable fixes to authoring sub-agent.             |
| `verification-before-completion` | `~/.agents/skills/verification-before-completion/SKILL.md` | Required before completion claims.                 | Run and read verification before merge/completion.                          |
| `api-design-principles`          | `~/.agents/skills/api-design-principles/SKILL.md`          | Public framework registration API design.          | Keep API small, consistent, and developer-friendly.                         |
| `architecture-decision-records`  | `~/.agents/skills/architecture-decision-records/SKILL.md`  | D-0035 records explicit-before-decorator decision. | Context/decision/consequences logged in `DECISION_LOG.md`.                  |
| `domain-modeling`                | `~/.agents/skills/domain-modeling/SKILL.md`                | Handler terminology and role boundaries.           | Preserve Spine vocabulary and avoid runtime behavior creep.                 |
| `typescript-advanced-types`      | `~/.agents/skills/typescript-advanced-types/SKILL.md`      | Generic method-name/schema typing.                 | Prefer useful generics without contorted type machinery.                    |
| `test-driven-development`        | `~/.agents/skills/test-driven-development/SKILL.md`        | New feature implementation.                        | Authoring sub-agent must write failing tests before production code.        |
| `javascript-testing-patterns`    | `~/.agents/skills/javascript-testing-patterns/SKILL.md`    | Vitest coverage and fixtures.                      | Use focused behavioral tests and full verification.                         |

Skills passed to sub-agents/reviewers:

| Recipient           | Skills/Instructions Passed                                     | Notes                                                                                                                                                                                                          |
| ------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Splitter            | Protocol/spec docs and T-0009a/D-0034 context.                 | Produced first-slice recommendation with no blockers.                                                                                                                                                          |
| Authoring sub-agent | TDD, TypeScript/API, ADR, worktree, verification instructions. | Produced implementation commit `28d8e419918c14ac1d54079bc912931ce8b23bd9`, round-1 fix commit `195112ab968b4560c5efab1c557a56ba59a0182b`, and follow-up fix commit `b6c8251a7404c974b073615b1a2aa888444bdac4`. |
| Reviewers           | T-0009b scope/non-scope and diff packages.                     | Round 1 and first follow-up re-review completed; orchestrator supplies the next explicit review package/range and records the upper bound after package creation.                                              |

Skipped relevant-looking skills:

| Skill                   | Source                                           | Reason Skipped                                                                                                    |
| ----------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `cqrs-implementation`   | `~/.agents/skills/cqrs-implementation/SKILL.md`  | Already read in prior T-0009 work; this first slice is metadata only and must not implement read/write execution. |
| `saga-orchestration`    | `~/.agents/skills/saga-orchestration/SKILL.md`   | Handler registration does not implement process-manager orchestration yet.                                        |
| `security-threat-model` | `~/.codex/skills/security-threat-model/SKILL.md` | No threat model requested; security reviewer will inspect the bounded diff.                                       |

## Scope

In scope:

- Public handler metadata types for command assignment, command reaction,
  event subscription, event reaction, and event application.
- Explicit registration helpers/builders that bind generated Protobuf-ES
  schemas to entity class method names.
- Integration with T-0009a `EntityMetadata` / `describeEntityMetadata()`.
- Deterministic frozen metadata preserving handler declaration order.
- Registration-time structural invariants needed by the first definition API.
- TypeDoc comments, README/API/architecture docs, and API export guard updates
  for the public surface added in this slice.

Out of scope:

- TypeScript decorator runtime or decorator metadata storage.
- Handler invocation.
- Transaction execution or `(set_once)` enforcement.
- Repository classes, storage writes, buses, inbox/delivery, ZeroMQ, gRPC, or
  bounded-context build/runtime behavior.
- Caller-owned `HandlerMetadataRegistry` lookups unless the authoring sub-agent
  demonstrates that a minimal definition container is required for the first API.
- Entity base classes beyond minimal generic constructor/type aliases needed by
  explicit registration.

## Decisions

- D-0034 keeps entity metadata in `@spine-ts/server` with narrow proto option
  exports.
- D-0035 records explicit handler registration before decorators.

## Human Questions And Answers

- Blocking questions: none.
- Non-blocking questions: none.

## Files Changed

- `packages/server/src/handler-metadata.ts`
- `packages/server/src/handler-metadata.test.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `docs/api/README.md`
- `scripts/check-api-docs.mjs`
- `build-protocol/tasks/T-0009b-handler-metadata/TASK.md`
- `build-protocol/work-logs/T-0009b.md`
- `build-protocol/reviews/T-0009b-handler-metadata.md`

## Tests Run

- RED: `corepack pnpm test packages/server/src/handler-metadata.test.ts`
  failed because `defineEntityHandlers` was not a function.
- GREEN: `corepack pnpm test packages/server/src/handler-metadata.test.ts`
  passed after adding the first explicit handler metadata implementation.
- RED: `corepack pnpm test packages/server/src/handler-metadata.test.ts`
  failed because missing prototype methods were not rejected.
- GREEN: `corepack pnpm test packages/server/src/handler-metadata.test.ts`
  passed after adding `HandlerMetadataError` and prototype method validation.
- RED: `corepack pnpm test packages/server/src/index.test.ts packages/server/src/handler-metadata.test.ts`
  failed because the root export expectation still described the old server
  runtime surface.
- GREEN: `corepack pnpm test packages/server/src/index.test.ts packages/server/src/handler-metadata.test.ts`
  passed after updating the root export expectation.
- `corepack pnpm typecheck:build` passed.
- `corepack pnpm lint` initially failed on test placeholder methods and
  unbound builder destructuring; passed after test cleanup.
- `corepack pnpm typecheck:tooling` passed.
- `corepack pnpm docs:check` passed with the known TypeDoc invalid remote
  source-link warning and confirmed 27 expected server exports.
- `corepack pnpm test packages/server/src/index.test.ts packages/server/src/handler-metadata.test.ts`
  passed after formatting.
- `CI=true corepack pnpm verify` passed.
- Round 1 RED: `corepack pnpm test packages/server/src/handler-metadata.test.ts`
  failed because accessor properties, inherited built-ins, and `constructor`
  were accepted as handler method names.
- Round 1 GREEN: `corepack pnpm test packages/server/src/handler-metadata.test.ts`
  passed after switching handler method validation to own property descriptor
  inspection.
- Round 1 final: `CI=true corepack pnpm verify` passed after the review fixes.
- Follow-up RED: `corepack pnpm test packages/server/src/handler-metadata.test.ts`
  failed because the accessor regression did not yet require the runtime error
  to describe normal class methods.
- Follow-up GREEN: `corepack pnpm test packages/server/src/handler-metadata.test.ts`
  passed after aligning the error message, TypeDoc comments, public docs, and
  test evidence with the own-prototype-data-method runtime contract.
- Follow-up final: `CI=true corepack pnpm verify` passed after the log/API
  contract fixes.

## Coverage Result

- Final `CI=true corepack pnpm verify` coverage: statements 99.44%, branches
  93.54%, functions 100%, lines 99.43%.
- Round 1 `CI=true corepack pnpm verify` coverage: statements 99.44%, branches
  93.7%, functions 100%, lines 99.43%.
- Follow-up `CI=true corepack pnpm verify` coverage: statements 99.44%,
  branches 93.7%, functions 100%, lines 99.43%.

## Documentation And Public API Impact

| Area                             | Impact                                                                     |
| -------------------------------- | -------------------------------------------------------------------------- |
| Package README impact            | Added explicit registration example and non-scope notes.                   |
| TypeDoc/API docs impact          | Added handler metadata exports and normal-class-method contract notes.     |
| Public API additions/removals    | Added handler metadata contracts, builder, and registration error.         |
| Framework `USER_GUIDE.md` impact | Added explicit handler metadata workflow and method-shape constraints.     |
| Example `USER_GUIDE.md` impact   | N/A for this slice; to-do example is not implemented yet.                  |
| API examples                     | Expected in server README and API docs overview.                           |
| Compatibility notes              | Expected: explicit registration is the stable target for later decorators. |

## Security Impact

| Area                    | Impact                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Dependencies            | No new dependencies expected.                                                         |
| Secrets and credentials | N/A; no secret handling.                                                              |
| IPC                     | N/A; no bus/transport in scope.                                                       |
| Validation              | Registration metadata only; single-message and transition validation remain separate. |
| Tenant boundaries       | N/A in this slice.                                                                    |
| `Any`/deserialization   | Handler schemas are descriptor references only; no payload unpacking.                 |
| Logging                 | No payload logging or handler invocation.                                             |

## Verification

- `corepack pnpm install --offline` failed because
  `@bufbuild/protoc-gen-es@2.12.1` was missing from the local pnpm store.
- `corepack pnpm install` passed with the existing lockfile and hydrated the
  worktree dependency metadata.
- Baseline `CI=true corepack pnpm verify` passed on `2026-06-29 00:41 WEST`:
  10 test files / 65 tests passed; coverage statements 99.41%, branches 94.11%,
  functions 100%, lines 99.39%; docs/API check confirmed 100 proto exports, 28
  core exports, 11 server exports, and 26 storage exports; proto
  lint/generate/check-generated passed; known non-blocking TypeDoc
  invalid-origin source-link warning remains.
- Implementation `CI=true corepack pnpm verify` passed on
  `2026-06-29 00:53 WEST`: 11 test files / 67 tests passed; coverage statements
  99.44%, branches 93.54%, functions 100%, lines 99.43%; docs/API check
  confirmed 100 proto exports, 28 core exports, 27 server exports, and 26
  storage exports; proto lint/generate/check-generated passed; the known
  TypeDoc invalid-origin source-link warning remains.
- Round 1 fix `CI=true corepack pnpm verify` passed on
  `2026-06-29 11:58 WEST`: 11 test files / 70 tests passed; coverage statements
  99.44%, branches 93.7%, functions 100%, lines 99.43%; docs/API check
  confirmed 100 proto exports, 28 core exports, 27 server exports, and 26
  storage exports; proto lint/generate/check-generated passed; the known
  TypeDoc invalid-origin source-link warning remains.
- Follow-up fix `CI=true corepack pnpm verify` passed on
  `2026-06-29 12:12 WEST`: 11 test files / 70 tests passed; coverage statements
  99.44%, branches 93.7%, functions 100%, lines 99.43%; docs/API check
  confirmed 100 proto exports, 28 core exports, 27 server exports, and 26
  storage exports; proto lint/generate/check-generated passed; the known
  TypeDoc invalid-origin source-link warning remains.

## Open Risks And Follow-Up Routing

| Risk/Follow-Up                                            | Owner                   | Linked Task/Decision | Disposition                                                 | Next Review Point           |
| --------------------------------------------------------- | ----------------------- | -------------------- | ----------------------------------------------------------- | --------------------------- |
| Explicit API could accidentally imply runtime invocation. | Author/reviewers        | T-0009b              | Keep metadata-only wording and tests.                       | Maintainability/docs review |
| Type-level method-name API could become too clever.       | TypeScript/API reviewer | T-0009b              | Prefer useful generic checks over opaque conditional types. | TypeScript/API review       |
| Decorator adapter needs parity later.                     | T-0009c                 | D-0035               | Explicit API is the target metadata shape.                  | T-0009c setup               |
| Registry validation is a follow-up unless required.       | T-0009b.3               | Splitter output      | Defer caller-owned registry/lookups to next slice.          | T-0009b.3                   |

## Review Rounds

- Authoring sub-agent dispatched on `2026-06-29 00:43 WEST` with ownership of
  the first T-0009b slice: handler metadata contract plus explicit
  registration API.
- Authoring sub-agent finished implementation verification on
  `2026-06-29 00:53 WEST`; round-1 reviewers inspected
  `d200447..28d8e419918c14ac1d54079bc912931ce8b23bd9`.
- Round-1 fixes were committed as
  `195112ab968b4560c5efab1c557a56ba59a0182b`; follow-up reviewers inspected
  `28d8e419918c14ac1d54079bc912931ce8b23bd9..195112ab968b4560c5efab1c557a56ba59a0182b`.
- Follow-up log/API contract fixes were committed as
  `b6c8251a7404c974b073615b1a2aa888444bdac4`.
- Durable-log correction checkpoint was committed as
  `6b514ac2f2f44af40358bf66135097740befef69`.
- Next review point is follow-up re-review using an explicit package/range
  supplied by the orchestrator; record the upper bound only after package
  creation.

## Integration Result

Not integrated by this authoring sub-agent; orchestrator owns integration after
follow-up re-review.
