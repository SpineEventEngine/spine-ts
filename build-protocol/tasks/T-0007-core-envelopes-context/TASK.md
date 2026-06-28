# T-0007: Core Envelopes And Context

Status: Baseline verified; implementation handoff pending
Start: `2026-06-28 19:35 WEST`
End: Pending
Setup baseline commit: `f380744`
Task log path: `build-protocol/tasks/T-0007-core-envelopes-context/TASK.md`
Branch: `task/T-0007a-core-signal-proto-intake`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0007a-core-signal-proto-intake`
Authoring sub-agent: Pending
Reviewer sub-agents: Pending
Implementation baseline commit: `d62fe14`
Final branch HEAD: Pending

## Objective

Add the first Spine core signal envelope and context surface needed by the
runtime: command/event envelopes, actor/tenant/user/version context messages,
and the TypeScript helpers needed to pack domain messages into those envelopes
without leaking ad hoc type URL handling.

## Required Inputs Read

- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/tasks/T-0004-proto-intake/TASK.md`
- `build-protocol/tasks/T-0005-metadata-type-registry/TASK.md`
- `build-protocol/tasks/T-0006-validation-facade/TASK.md`
- `spine-jvm-docs/spine-domain-model-and-signals.md`
- Current `packages/core` and `packages/proto` source.
- Upstream/local Spine proto files under `/private/tmp/spine-research` and
  local extracted include proto copies for missing transitive base protos.

## Requirements Splitter Output

Existing roadmap selected this sequence after T-0006:

1. `T-0007 Core Envelopes And Context`
2. `T-0008 Storage Foundation`
3. `T-0009 Entity And Handler Model`
4. `T-0010 Single-Process Async Runtime`
5. `T-0011 Read Side And Todo Thin Slice`

Blocking questions: none known at task setup.

First non-blocked implementable slice: `T-0007a Core Signal Proto Intake`.

Rationale:

- `proto/` currently contains only `spine/options.proto`,
  `spine/base/field_path.proto`, `spine/string/template_string.proto`, and
  `spine/validation/validation_error.proto`.
- `Command`, `Event`, `ActorContext`, `TenantId`, `UserId`, `Version`,
  diagnostics, and enrichment are canonical Spine Protobuf contracts and must be
  copied verbatim before reliable TS envelope helpers can be built.
- `command.proto` and `event.proto` depend on transitive support protos:
  `actor_context.proto`, `tenant_id.proto`, `user_id.proto`, `version.proto`,
  `diagnostics.proto`, `enrichment.proto`, `spine/time/time.proto`,
  `spine/ui/language.proto`, `spine/net/internet_domain.proto`, and
  `spine/net/email_address.proto`.

## T-0007a Scope

In scope:

- Copy the minimal transitive Spine proto set for command/event envelopes and
  actor/tenant/version context into `proto/spine/...` without rewriting message
  definitions.
- Extend `proto/spine-sources.json` with pinned provenance and checksums for the
  copied files.
- Regenerate Protobuf-ES output with Buf.
- Curate `@spine-ts/proto` root exports for the new generated schemas/types and
  file descriptors.
- Register the new core signal schemas in the default `@spine-ts/core` registry.
- Add focused tests for generated exports, source verification, registry type
  URLs, and basic `Any`-relevant envelope schemas.
- Update package docs, API docs checks, architecture notes, and user guide
  references as needed.

Out of scope for T-0007a:

- High-level command/event factory APIs.
- Runtime command bus, event bus, storage, delivery, entity transactions, and
  `(set_once)` transaction enforcement.
- gRPC service implementations.
- ZeroMQ transport.

## Skill Applicability

Selected skills for setup/orchestration:

- `subagent-driven-development`
- `using-git-worktrees`
- `requesting-code-review`
- `verification-before-completion`
- `architecture-decision-records`
- `monorepo-management`
- `typescript-advanced-types`
- `javascript-testing-patterns`
- `codebase-design`

The implementation sub-agent must run its own skill gate before edits and
record selected skills in this log.

## Documentation And Public API Impact

| Area                             | Impact                                                                 |
| -------------------------------- | ---------------------------------------------------------------------- |
| Package README impact            | `packages/proto` and `packages/core` must document signal proto scope. |
| TypeDoc/API docs impact          | API export checks must include new curated proto/core exports.         |
| Public API additions/removals    | New generated schema/type/file exports; no runtime helper API yet.     |
| Framework `USER_GUIDE.md` impact | Mention that canonical command/event contracts are available.          |
| Example `USER_GUIDE.md` impact   | N/A for this slice.                                                    |
| Architecture notes               | Record proto-first envelope foundation and deferred helper layer.      |

## Security Impact

| Area                    | Impact                                                                    |
| ----------------------- | ------------------------------------------------------------------------- |
| Dependencies            | No new package dependency expected.                                       |
| Secrets and credentials | No secrets expected; logs must avoid local credentials or auth headers.   |
| IPC                     | N/A. No transport work in this slice.                                     |
| Validation              | Generated message validation remains through T-0006 facade.               |
| Tenant boundaries       | Tenant context contracts are copied; enforcement is deferred.             |
| `Any`/deserialization   | Must preserve type URLs and avoid ad hoc unpacking in this proto slice.   |
| Logging                 | Do not log payload contents while testing envelopes or generated schemas. |

## Verification Plan

- Baseline `CI=true corepack pnpm verify` before implementation handoff.
- Focused proto source verification, Buf lint/generate, generated cleanliness.
- Focused package tests for proto exports and core registry entries.
- Full `CI=true corepack pnpm verify` before review handoff.
- Five reviewer roles after implementation and after each fix round until clean.

## Baseline Verification

Baseline verification passed on `2026-06-28 19:47 WEST` with
`CI=true corepack pnpm verify`: typecheck, lint, format, tests, coverage,
docs/API check, proto lint/generate, and generated-output cleanliness all
passed. Vitest ran 9 test files and 33 tests. Coverage: statements 99.19%,
branches 90.9%, functions 100%, lines 99.19%. TypeDoc emitted the known invalid
`origin` warning and confirmed 13 proto exports plus 21 core exports.

## Review Rounds

Pending.

## Integration Result

Pending.
