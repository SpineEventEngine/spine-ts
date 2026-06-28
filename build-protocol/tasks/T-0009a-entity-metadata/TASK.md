# T-0009a: Descriptor Option Surface And Entity Metadata

Status: Implementation in progress
Start: `2026-06-28 22:48 WEST`
End: Pending
Setup baseline commit: `dd4a365`
Task log path: `build-protocol/tasks/T-0009a-entity-metadata/TASK.md`
Branch: `task/T-0009a-entity-metadata`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009a-entity-metadata`
Authoring sub-agent: `019f103e-52ca-7722-88f0-49c49b017dbf` (Dalton)
Reviewer sub-agents: Pending
Implementation baseline commit: `5b41111`
Final branch checkpoint before integration: Pending
Main integration merge commit: Pending

## Objective

Add the first `@spine-ts/server` entity metadata layer that reads descriptor
options from Protobuf-ES schemas and exposes deterministic metadata for later
handler registration, transaction validation, and repository assembly.

## Roadmap Context

The requirements splitter `019f1035-107b-7431-b95b-6454f95303e7` recommended
the `T-0009` sequence:

1. `T-0009a Descriptor Option Surface And Entity Metadata Extractor`
2. `T-0009b Handler Metadata Contract And Explicit Registration API`
3. `T-0009c TypeScript 5+ Decorator Adapter And Fallback Parity`
4. `T-0009d Transaction Kernel And Transition Validation`
5. `T-0009e Concrete OOP Entity Base Classes With Capability Segregation`
6. `T-0009f Repository Seams And Bounded-Context Registration Skeleton`

First non-blocked task: `T-0009a`.

## Required Inputs To Read

- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/PROTOBUF_CONTRACT.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/DECISION_LOG.md`
- `packages/proto/src/index.ts`
- `packages/server/src/index.ts`
- `packages/server/src/index.test.ts`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `docs/api/README.md`
- `spine-jvm-docs/spine-entities-repositories-and-state.md`
- `spine-jvm-docs/spine-routing-dispatch-and-delivery.md`

## Skill Use

- `subagent-driven-development`: required by the autonomous build protocol.
- `using-git-worktrees`: required for isolated branch/worktree execution.
- `domain-modeling`: applies to entity metadata and Spine terminology.
- `architecture-decision-records`: applies to D-0034 and any follow-up
  decisions.
- `typescript-advanced-types`: applies to schema/generic metadata types.
- `javascript-testing-patterns` and `test-driven-development`: apply to Vitest
  RED/GREEN coverage.
- `api-design-principles`: applies to the public metadata API shape.
- `cqrs-implementation`: applies to entity visibility/column metadata and
  read/write segregation.
- `requesting-code-review`, `receiving-code-review`, and
  `verification-before-completion`: required by the review loop and final gates.

## Scope

- Add narrow curated `@spine-ts/proto` exports for the generated Spine option
  descriptors and enum/message types needed by server entity metadata.
- Replace the metadata-only `@spine-ts/server` skeleton with public
  TypeScript APIs for descriptor-derived entity metadata.
- Extract entity kind and visibility from `(entity)`.
- Apply Spine visibility defaults in a deterministic way.
- Expose first-field routing hints from descriptor field order without
  implementing route execution.
- Expose fields marked `(column) = true`.
- Expose fields marked `(set_once) = true`.
- Expose semantic tags from message `(is)` and file `(every_is)` options in a
  deterministic order.
- Provide clear errors for non-entity schemas where entity metadata is required
  and for invalid/unsupported metadata combinations discovered in this slice.
- Add focused Vitest coverage using generated descriptors or local test
  fixtures that exercise option extraction, defaults, ordering, and error
  behavior.
- Update package README, user guide, architecture docs, API docs, and API docs
  export checks for new public exports.
- Preserve full verification: `CI=true corepack pnpm verify`.

## Out Of Scope

- Handler decorators.
- Explicit handler registration.
- Entity transactions and `(set_once)` enforcement.
- Repository, aggregate, projection, or process-manager base classes.
- Storage reads/writes.
- Bounded context assembly.
- Command/event/query/subscription buses.
- Inbox/outbox delivery.
- ZeroMQ or transport abstractions.
- gRPC services.
- To-do example behavior.

## Constraints

- Preserve the curated export policy in `@spine-ts/proto`; do not use broad
  generated re-exports.
- Keep generic registry/type URL behavior in `@spine-ts/core`; keep
  entity-specific metadata in `@spine-ts/server`.
- Do not add runtime dependencies without recording a decision and checking
  current package options.
- Avoid import-time global registration side effects.
- Keep APIs OOP/library-friendly and TypeDoc-documented.
- Preserve strict read-side/write-side segregation in metadata names and docs.
- Do not log or expose payload contents, tokens, auth data, or sensitive local
  data.

## Review Requirements

After each implementation or fix commit, run the required reviewer sub-agents:

- maintainability/style;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

Feed reviewer comments back to the authoring sub-agent and repeat until all
reviewers report no comments.

## Verification Plan

- RED focused server/proto metadata tests before implementation.
- GREEN focused tests after implementation.
- `corepack pnpm typecheck`.
- `node scripts/check-api-docs.mjs` or `corepack pnpm docs:check` after public
  exports change.
- `CI=true corepack pnpm verify` before review handoff and before integration.

## Durable State

- Setup started from `main` commit `dd4a365` after T-0008a integration
  completion.
- Setup committed on `main` as `3194b90`.
- Branch/worktree created from setup commit `3194b90` on
  `2026-06-28 22:49 WEST`.
- Initial baseline command `CI=true corepack pnpm verify` could not start
  because the new worktree lacked pnpm dependency-state metadata. The
  orchestrator ran `corepack pnpm install --offline`, which reused the existing
  local pnpm cache and made no dependency selection changes.
- Baseline verification passed on `2026-06-28 22:56 WEST` with
  `CI=true corepack pnpm verify`: node check, typecheck, lint, format, tests,
  coverage, docs/API check, proto lint/generate, and generated-output
  cleanliness all passed. Vitest ran 9 test files / 55 tests. Coverage:
  statements 99.63%, branches 93.5%, functions 100%, lines 99.61%. Docs/API
  check confirmed 85 proto exports, 28 core exports, and 26 storage exports.
- Branch setup/baseline logs committed as `5b41111` on
  `2026-06-28 22:57 WEST`.
- Implementation sub-agent `019f103e-52ca-7722-88f0-49c49b017dbf` (Dalton)
  was spawned on `2026-06-28 22:58 WEST` with ownership of T-0009a code,
  tests, docs, API checks, durable logs, verification, and implementation
  commit.
- D-0034 records that entity metadata belongs in `@spine-ts/server` and
  `@spine-ts/proto` should add only narrow curated option exports.
- No blocking questions known.
- Next step: await implementation result, then run the required five-reviewer
  loop.
