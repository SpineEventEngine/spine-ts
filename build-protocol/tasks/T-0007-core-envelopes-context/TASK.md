# T-0007: Core Envelopes And Context

Status: Implementation committed; round-1 process-log findings fixed pending re-review
Start: `2026-06-28 19:35 WEST`
End: Pending
Setup baseline commit: `f380744`
Task log path: `build-protocol/tasks/T-0007-core-envelopes-context/TASK.md`
Branch: `task/T-0007a-core-signal-proto-intake`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0007a-core-signal-proto-intake`
Authoring sub-agent: T-0007a implementation sub-agent
Reviewer sub-agents: Maintainability/style `019f0faa-6983-7690-9e46-bc50a6d72920`; documentation `019f0faa-6a10-7c91-b914-1a57f2c5f526`; TypeScript/API docs `019f0faa-6a76-7093-bb54-d0239d1646d2`; security `019f0faa-6aed-7230-ba0c-c385f62ba7ce`; performance/reliability `019f0faa-6b97-7ee2-bc36-cbb0500fd302`.
Implementation baseline commit: `9d35f3e`
Implementation commit reviewed in round 1: `6cb1c125290a4514b8b6aec1ba9567499c1dcfa8`
Final branch HEAD: Follow-up process-log fix commit reported by fixer; implementation commit reviewed in round 1 was `6cb1c125290a4514b8b6aec1ba9567499c1dcfa8`.

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

## Implementation Skill Gate

T-0007a implementation sub-agent selected and fully read these supplied skill
files before governed actions:

- `implement`
- `test-driven-development`
- `verification-before-completion`
- `architecture-decision-records`
- `monorepo-management`
- `typescript-advanced-types`
- `javascript-testing-patterns`
- `codebase-design`

Applied scope:

- TDD for focused `@spine-ts/proto` export and `@spine-ts/core` registry tests.
- Verification-before-completion for all passing/complete claims.
- Architecture-decision-records for D-0031 provenance decision.
- Monorepo, TypeScript, testing, and codebase-design guidance for package
  boundaries, curated exports, and registry behavior.

## Implementation Progress

As of `2026-06-28 20:14 WEST`, T-0007a has copied the minimal core signal proto
closure, pinned manifest provenance, generated Protobuf-ES output, added curated
proto exports, and registered the core signal schemas in
`createSpineCoreRegistry()`. Focused red/green tests, proto workflow checks, and
full `CI=true corepack pnpm verify` passed.

## Implementation Self-Review Evidence

Before the required in-session five-reviewer round, the implementer ran two
pre-review checks:

- Standards review: standalone Codex review of the staged diff against
  `build-protocol/PROTOBUF_CONTRACT.md` and package export conventions reported
  no findings.
- Spec review: local staged-diff review against this task log, the work/review
  logs, `DECISION_LOG.md`, and `PROTOBUF_CONTRACT.md` found no missing
  T-0007a requirements, no scope creep beyond the proto-intake slice, and no
  wrong-looking implementation. The attempted external standalone spec reviewer
  was rejected by sandbox escalation policy because it would send private staged
  repository content to an external Codex service.

These checks are implementation self-review evidence only; they do not close the
required five-reviewer round.

## Review Rounds

Round 1 required in-session reviewers:

| Role                    | Reviewer ID                            | Finding                                                               |
| ----------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| Maintainability/style   | `019f0faa-6983-7690-9e46-bc50a6d72920` | Logs pre-close round 1 and contradict the pending reviewed basis.     |
| Documentation           | `019f0faa-6a10-7c91-b914-1a57f2c5f526` | Round 1 was closed before the reviewer loop was represented.          |
| Documentation           | `019f0faa-6a10-7c91-b914-1a57f2c5f526` | Logs still described a pending pre-commit state after committed HEAD. |
| TypeScript/API docs     | `019f0faa-6a76-7093-bb54-d0239d1646d2` | No comments.                                                          |
| Security                | `019f0faa-6aed-7230-ba0c-c385f62ba7ce` | No comments.                                                          |
| Performance/reliability | `019f0faa-6b97-7ee2-bc36-cbb0500fd302` | Work log restart state was stale.                                     |

Disposition: process-log findings are fixed in a follow-up commit. Round 1 must
not be considered cleanly closed until the follow-up commit is re-reviewed.

## Integration Result

Implementation commit `6cb1c125290a4514b8b6aec1ba9567499c1dcfa8` is present on
`task/T-0007a-core-signal-proto-intake`. Full verification passed before that
commit. Current restart state after this log-only follow-up: request re-review
of the process-log fix before closing T-0007a. Do not recommit or alter the
already-committed proto/code implementation unless a later review explicitly
asks for it.
