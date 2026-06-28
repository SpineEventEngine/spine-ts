# T-0007b: Core Envelope Construction Helpers

Status: Setup complete; branch/worktree pending
Start: `2026-06-28 20:45 WEST`
End: Pending
Setup baseline commit: `c313086`
Task log path: `build-protocol/tasks/T-0007b-envelope-construction/TASK.md`
Branch: Pending
Worktree: Pending
Authoring sub-agent: Pending
Reviewer sub-agents: Pending
Implementation baseline commit: Pending
Final branch checkpoint before integration: Pending
Main integration merge commit: Pending

## Objective

Add the first typed `@spine-ts/core` helpers that pack Protobuf-ES domain
messages into Spine `Command` and `Event` envelopes while preserving Spine type
URLs and keeping bus, storage, delivery, and ID-generation runtime concerns out
of scope.

## Required Inputs Read

- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0007-core-envelopes-context/TASK.md`
- `spine-jvm-docs/spine-domain-model-and-signals.md`
- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`
- `proto/spine/core/command.proto`
- `proto/spine/core/event.proto`
- `packages/core/src/index.ts`
- `packages/core/src/index.test.ts`
- `packages/proto/src/index.ts`
- `packages/proto/src/generated/spine/core/command_pb.ts`
- `packages/proto/src/generated/spine/core/event_pb.ts`
- Buf Protobuf-ES runtime declarations for `toBinary()`, `AnySchema`, and WKT
  `anyPack()`/`anyUnpack()`.

## Requirements Splitter Output

Existing roadmap after T-0007a:

1. `T-0007b Core Envelope Construction Helpers`
2. `T-0008 Storage Foundation`
3. `T-0009 Entity And Handler Model`
4. `T-0010 Single-Process Async Runtime`
5. `T-0011 Read Side And Todo Thin Slice`

Blocking questions: none known at setup.

Rationale:

- T-0007a copied and generated canonical `spine.core.Command`,
  `spine.core.Event`, `CommandContext`, `EventContext`, IDs, actor/tenant/user,
  diagnostics, enrichment, and version contracts.
- The next non-blocked step is to stop callers from hand-building
  `google.protobuf.Any` payloads and type URLs.
- Runtime buses and storage should consume canonical envelopes later, so this
  task must land before transport/runtime work.

## Scope

In scope:

- Add Spine-aware `Any` packing in `@spine-ts/core` using generated schemas,
  `deriveTypeUrl()`, and Protobuf-ES binary serialization.
- Add typed helpers for packing an already-built domain message into generated
  `Command` and `Event` envelope messages.
- Require caller-supplied generated IDs and contexts. Do not generate UUIDs,
  timestamps, actor context, tenant context, versions, or producer IDs in this
  slice.
- Validate enclosed domain messages through the T-0006 validation facade before
  packing by default.
- Preserve type-safety with schema/message generics and generated
  `@spine-ts/proto` message types.
- Add focused Vitest tests with RED/GREEN evidence for `Any` type URLs,
  binary payloads, envelope fields, validation failures, and public export
  documentation.
- Update TypeDoc/API checks, `packages/core` docs, framework user guide, and
  architecture notes.

Out of scope:

- Runtime command/event buses.
- Command acknowledgement, result subscriptions, delivery records, retries, or
  broker behavior.
- Entity transactions and `(set_once)` enforcement beyond using the existing
  validation facade for single-message payload validation.
- Domain command/event ID generation policy.
- Actor/tenant context factories.
- Event producer/version/origin policy beyond accepting caller-supplied
  generated `EventContext`.
- ZeroMQ transport or storage adapters.

## Skill Applicability

Selected skills for setup/orchestration:

- `subagent-driven-development`
- `using-git-worktrees`
- `requesting-code-review`
- `code-review-excellence`
- `receiving-code-review`
- `verification-before-completion`
- `architecture-decision-records`
- `test-driven-development`
- `typescript-advanced-types`
- `javascript-testing-patterns`
- `codebase-design`

Implementation sub-agent must run its own skill gate before edits and record
selected skills in this log.

## Public API Shape

Expected public `@spine-ts/core` additions:

- `packAny(schema, message, options?)` or equivalent name selected by the
  implementation agent if tests/docs make a stronger local naming case.
- `unpackAny(any, schema)` or equivalent helper if needed to prove round-trip
  behavior without exposing ad hoc type URL parsing to callers.
- `packCommand({ id, message, schema, context, ... })`.
- `packEvent({ id, message, schema, context, ... })`.
- Typed option/input/result aliases needed to make the helper surface clear.

Non-negotiable API behavior:

- Packed `Any.typeUrl` must use `deriveTypeUrl(schema)` and therefore Spine
  `type.spine.io/...` prefixes when the schema file declares the option.
- Do not use Buf `anyPack()` directly for Spine payload packing because it
  currently emits `type.googleapis.com/...`.
- Do not log or include packed payload bytes in error messages.
- Do not expose mutable process-wide registry writes.

## Documentation And Public API Impact

| Area                             | Impact                                                                  |
| -------------------------------- | ----------------------------------------------------------------------- |
| Package README impact            | `packages/core` must document Spine-aware `Any` and envelope helpers.   |
| TypeDoc/API docs impact          | API export checks must include new helper functions and public aliases. |
| Public API additions/removals    | New core helper functions/types only; no proto export changes expected. |
| Framework `USER_GUIDE.md` impact | Show packing a domain command/event into Spine envelopes.               |
| Example `USER_GUIDE.md` impact   | N/A for this slice.                                                     |
| Architecture notes               | Record core envelope helper seam and deferred runtime policies.         |

## Security Impact

| Area                    | Impact                                                                 |
| ----------------------- | ---------------------------------------------------------------------- |
| Dependencies            | No new dependency expected.                                            |
| Secrets and credentials | No secrets expected.                                                   |
| Payload privacy         | Tests/docs must not log or stringify packed payload bytes.             |
| Validation              | Payload validation uses T-0006 facade before packing by default.       |
| Tenant boundaries       | Tenant context may be present in supplied context; no enforcement yet. |
| IPC                     | N/A.                                                                   |

## Verification Plan

- Baseline `CI=true corepack pnpm verify` before implementation handoff.
- TDD focused tests in `packages/core/src/index.test.ts`.
- Focused typecheck/test runs after implementation.
- `node scripts/check-api-docs.mjs` or full docs check after API changes.
- Full `CI=true corepack pnpm verify` before review handoff.
- Five reviewer roles after implementation and each fix round until clean:
  maintainability/style, documentation, TypeScript/API docs, security, and
  performance/reliability.
