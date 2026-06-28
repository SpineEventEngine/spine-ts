# T-0009b: Handler Metadata Contract And Explicit Registration API

Status: Implementation in progress
Start: `2026-06-29 00:40 WEST`
End: Pending
Baseline commit: `11a6c70`
Task log path: `build-protocol/tasks/T-0009b-handler-metadata/TASK.md`
Branch: `task/T-0009b-handler-metadata`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009b-handler-metadata`
Requirements splitter: `019f1097-55bb-7b73-a9f8-706db486721e` (Kierkegaard the 2nd)
Authoring sub-agent: `019f109d-ce8b-7b42-94d3-cc93b9ead054` (Russell the 2nd)
Reviewer sub-agents: Pending
Branch setup commit: `2b03b6b`
Implementation baseline commit: `b1d158e`
Implementation commit: Pending branch commit
Final branch HEAD: Pending branch commit

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

| Recipient           | Skills/Instructions Passed                     | Notes                                                                            |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| Splitter            | Protocol/spec docs and T-0009a/D-0034 context. | Produced first-slice recommendation with no blockers.                            |
| Authoring sub-agent | Pending.                                       | Must receive TDD, TypeScript, API, ADR, worktree, and verification instructions. |
| Reviewers           | Pending.                                       | Five role prompts must include T-0009b scope/non-scope and diff package.         |

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

- Pending.

## Tests Run

- Pending.

## Coverage Result

- Pending.

## Documentation And Public API Impact

| Area                             | Impact                                                                        |
| -------------------------------- | ----------------------------------------------------------------------------- |
| Package README impact            | Expected: explicit registration examples and non-scope notes.                 |
| TypeDoc/API docs impact          | Expected: new public server exports and `scripts/check-api-docs.mjs` updates. |
| Public API additions/removals    | Expected: handler metadata and explicit registration builders.                |
| Framework `USER_GUIDE.md` impact | Expected: brief user-facing explicit registration workflow.                   |
| Example `USER_GUIDE.md` impact   | N/A for this slice; to-do example is not implemented yet.                     |
| API examples                     | Expected in server README and API docs overview.                              |
| Compatibility notes              | Expected: explicit registration is the stable target for later decorators.    |

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

## Integration Result

Pending.
