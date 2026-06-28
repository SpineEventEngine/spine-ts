# T-0007b: Core Envelope Construction Helpers

Status: Integrated into `main`
Start: `2026-06-28 20:45 WEST`
End: `2026-06-28 21:30 WEST`
Setup baseline commit: `c313086`
Task log path: `build-protocol/tasks/T-0007b-envelope-construction/TASK.md`
Branch: `task/T-0007b-envelope-construction`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0007b-envelope-construction`
Authoring sub-agent: `019f0fc3-b699-76c2-a02f-a174936c045d` (Bacon)
Reviewer sub-agents: Maintainability/style `019f0fcc-6b78-71a3-a363-688a5be1d662`;
documentation `019f0fcc-a511-78b0-a79a-eb2f4740ab52`; TypeScript/API docs
`019f0fcc-d16b-7c31-8a02-81a07c880947`; security
`019f0fcc-fa19-7632-9b24-e2f678ad60c6`; performance/reliability
`019f0fcd-2d90-7481-963d-7571d880095d`.
Implementation baseline commit: `57fc257`
Final branch checkpoint before integration:
`9be22957fb2ce59169ca36ee4ee921ba40346581`
Main integration merge commit: `4656a1e077d983bf8832a936905d38b6c20f7beb`

## Branch Setup

Created `task/T-0007b-envelope-construction` from setup commit
`66cd115bf4adbd34db0a3718ff6bd36dfbf8a074` in isolated worktree
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0007b-envelope-construction`.
Baseline verification is next before implementation handoff.

## Baseline Verification

Baseline verification passed on `2026-06-28 20:43 WEST` with
`CI=true corepack pnpm verify`: typecheck, lint, format, tests, coverage,
docs/API check, proto lint/generate, and generated-output cleanliness all
passed. Vitest ran 9 test files and 35 tests. Coverage: statements 99.41%,
branches 90.9%, functions 100%, lines 99.41%. TypeDoc emitted the known invalid
`origin` warning and confirmed 85 proto exports plus 21 core exports.

## Implementation Handoff

Implementation sub-agent `019f0fc3-b699-76c2-a02f-a174936c045d` (Bacon) was
spawned on `2026-06-28 20:44 WEST` with ownership of the T-0007b helper slice,
TDD/logging requirements, and explicit scope exclusions for buses, storage,
transport, entity transactions, and runtime ID/context factories.

## Review Rounds

Round 1 dispatched on `2026-06-28 20:55 WEST` against review basis
`7d80347...2fe6850be59a78e6331b0b8cd84fa8fb0641b281`.

| Role                    | Reviewer ID                            | Status            |
| ----------------------- | -------------------------------------- | ----------------- |
| Maintainability/style   | `019f0fcc-6b78-71a3-a363-688a5be1d662` | Comments resolved |
| Documentation           | `019f0fcc-a511-78b0-a79a-eb2f4740ab52` | Comments resolved |
| TypeScript/API docs     | `019f0fcc-d16b-7c31-8a02-81a07c880947` | Comments resolved |
| Security                | `019f0fcc-fa19-7632-9b24-e2f678ad60c6` | No comments       |
| Performance/reliability | `019f0fcd-2d90-7481-963d-7571d880095d` | Comments resolved |

Final log-fix re-review of
`8097a93a1074837b21586e83df3b0a66bdda99f4..77f9c2d4a94b5f7b9336c410d47ec847143e5231`
reported no comments in all five required reviewer roles. Branch checkpoint
`9be22957fb2ce59169ca36ee4ee921ba40346581` passed
`CI=true corepack pnpm verify` before integration.

## Integration

Merged into `main` as `4656a1e077d983bf8832a936905d38b6c20f7beb` on
`2026-06-28 21:30 WEST`. Post-merge `CI=true corepack pnpm verify` passed with
9 test files / 41 tests, coverage 99.44% statements / 91.83% branches / 100%
functions / 99.44% lines, docs/API check confirming 85 proto exports and 28
core exports, proto lint/generate, and generated-output cleanliness.

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

Implementation sub-agent skill gate recorded on `2026-06-28 20:47 WEST`:

- `implement` applies to scoped delivery and final commit.
- `test-driven-development` applies to focused RED/GREEN helper tests.
- `verification-before-completion` applies to focused, docs/API, and full
  verification evidence before handoff.
- `architecture-decision-records` applies to preserving D-0030 through D-0032;
  no new ADR is needed for this implementation because the accepted decision is
  already D-0032.
- `typescript-advanced-types` applies to the generic public helper inputs.
- `javascript-testing-patterns` applies to the focused Vitest unit tests.
- `codebase-design` applies to keeping Spine-aware `Any` packing as a deep core
  module interface rather than scattering type URL policy.
- `receiving-code-review` applies to evaluating existing review/task constraints
  before changing code.

Round-1 fix context recorded on `2026-06-28 21:00 WEST`:

- Implementation commit under review:
  `2fe6850be59a78e6331b0b8cd84fa8fb0641b281`.
- Round-1 review basis:
  `7d80347...2fe6850be59a78e6331b0b8cd84fa8fb0641b281`.
- Dispatch-log commit `dfdf21e` is preserved on the branch.
- Findings under focused fix: stale durable logs, API landing page omission,
  test packing-policy duplication, unknown-field retention during packing,
  unsafe malformed `Any` unpacking, and mutable caller-supplied ID/context
  references in generated envelopes.
- The focused fix has been re-reviewed. Only final lightweight log-fix
  re-review/final verification remains pending.

Round-1 focused fix follow-up recorded on `2026-06-28 21:13 WEST`:

- Focused fix commit:
  `0353f8a2f877d082ea9d51bf8b09b5c9af55bdbf`.
- Log-only follow-up commit reviewed in the final lightweight pass:
  `8097a93a1074837b21586e83df3b0a66bdda99f4`.
- Final log-fix commit reviewed after the final lightweight pass:
  `77f9c2d4a94b5f7b9336c410d47ec847143e5231`.
- Follow-up re-review reports were clean for maintainability, security,
  TypeScript/API docs, documentation/API landing page, and runtime reliability
  helper behavior.
- Remaining follow-up finding is log-only stale restart state in this task log,
  the work log, and the review log.
- The final log-fix re-review reported no comments in maintainability/style,
  documentation, TypeScript/API docs, security, and performance/reliability.
- Branch verification and orchestrator-owned integration remain pending; round 1
  is not closed by this note.

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
