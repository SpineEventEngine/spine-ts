# T-0009a: Descriptor Option Surface And Entity Metadata

Status: Complete
Start: `2026-06-28 22:48 WEST`
End: `2026-06-29 00:28 WEST`
Setup baseline commit: `dd4a365`
Task log path: `build-protocol/tasks/T-0009a-entity-metadata/TASK.md`
Branch: `task/T-0009a-entity-metadata`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0009a-entity-metadata`
Authoring sub-agent: `019f103e-52ca-7722-88f0-49c49b017dbf` (Dalton)
Reviewer sub-agents: Maintainability/style `019f1056-4f3d-7192-9bec-8094ad784a03`;
documentation `019f1056-4fbe-7eb1-8ef2-dc5c901887b8`; TypeScript/API docs
`019f1056-502b-74f1-8cc5-24587c5ea99d`; security
`019f1056-509e-7853-bafd-246d91c21fa8`; performance/reliability
`019f1056-5133-73c1-9e09-756c7e49b061`.
Implementation baseline commit: `5b41111`
Final branch checkpoint before integration: `d24ef86`
Main integration merge commit: `ec825a4`

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
- Implementation committed as `a12e4f733a118441e076dc8f23ca91e6e0feff62` on
  `2026-06-28 23:23 WEST`. Final implementation verification passed with
  `CI=true corepack pnpm verify`: 9 test files / 62 tests; coverage statements
  99.4%, branches 93.91%, functions 100%, lines 99.38%; docs/API check
  confirmed 100 proto exports, 28 core exports, 11 server exports, and 26
  storage exports.
- Review round 1 dispatched on `2026-06-28 23:25 WEST` with diff package
  `.superpowers/sdd/review-04d79ed..a12e4f7.diff`.
- Round-1 fixes added checked-in server test fixture `.proto` sources under
  `packages/server/test-fixtures/proto/entity-metadata/`, the regeneration
  command `node scripts/generate-server-test-fixtures.mjs` (`--check` for sync
  verification), and column eligibility handling that now ignores aggregate and
  generic entity `(column)` declarations while still validating projection and
  process-manager columns.
- Round-1 fix verification passed on `2026-06-28 23:41 WEST`: focused
  server/generator regressions 2 files / 10 tests, focused proto regressions 1
  file / 6 tests, generator sync check, `corepack pnpm typecheck`,
  `corepack pnpm docs:check`, and full `CI=true corepack pnpm verify` with 10
  test files / 65 tests, coverage statements 99.41%, branches 94.11%,
  functions 100%, lines 99.39%; docs/API check again confirmed 100 proto
  exports, 28 core exports, 11 server exports, and 26 storage exports.
- Round-1 fix committed as `3a1e85150c838f7b03401ccdd0420717fbee7622`.
- Follow-up review dispatched on `2026-06-28 23:43 WEST` with diff package
  `.superpowers/sdd/review-3723eeb..3a1e851.diff`: maintainability/style
  `019f1067-9084-7b32-9965-5f7b209d354b`, documentation
  `019f1067-90ed-79f2-adfb-f82c25bde3ec`, TypeScript/API docs
  `019f1067-9162-75a3-af82-59caf4d38545`, security
  `019f1067-91e3-7fa0-9109-81e59194cf72`, and performance/reliability
  `019f1067-926b-72a3-b256-735fde237f1f`.
- Follow-up review results received: maintainability/style, security, and
  performance/reliability reported clean. Documentation reported one remaining
  stale log-state wording issue, and TypeScript/API docs reported one remaining
  JSDoc wording issue for `EntityMetadata.columns`.
- Final follow-up fix committed as
  `b19a9dcd072a1e233c973e401f35d12f224de1f7`.
- Final follow-up review dispatched on `2026-06-28 23:48 WEST` with diff
  package `.superpowers/sdd/review-3a1e851..b19a9dc.diff`: maintainability/style
  `019f106e-1f92-7d12-905b-99d2da45460a`, documentation
  `019f106e-200e-74d0-adec-fc474169892d`, TypeScript/API docs
  `019f106e-206f-7490-b599-76134ecec087`, security
  `019f106e-210d-7bd2-a828-b88ec1b8e92c`, and performance/reliability
  `019f106e-2182-7d03-9fe5-fd02993e9953`.
- Final follow-up verification evidence for
  `b19a9dcd072a1e233c973e401f35d12f224de1f7` is recorded: focused
  server/generator tests passed (`2` files / `10` tests), `corepack pnpm
typecheck` passed, `corepack pnpm docs:check` passed, and `CI=true corepack
pnpm verify` passed after one formatting retry (`10` files / `65` tests;
  coverage statements 99.41%, branches 94.11%, functions 100%, lines 99.39%).
- Final follow-up review results received: TypeScript/API docs
  `019f106e-206f-7490-b599-76134ecec087` and security
  `019f106e-210d-7bd2-a828-b88ec1b8e92c` reported clean. Maintainability/style
  `019f106e-1f92-7d12-905b-99d2da45460a`, documentation
  `019f106e-200e-74d0-adec-fc474169892d`, and performance/reliability
  `019f106e-2182-7d03-9fe5-fd02993e9953` reported stale committed durable-log
  wording in the reviewed scope `3a1e851..b19a9dc`.
- This authoring correction addresses only those stale-log findings while
  preserving the orchestrator's uncommitted dispatch edits already present in
  the worktree.
- Durable-log correction committed as
  `a27ed0aae001f544c64957eb71ef7c39eb3d3cf2` with fresh verification:
  `corepack pnpm prettier --write` on the three durable logs,
  `corepack pnpm prettier --check` on the same files, and
  `corepack pnpm docs:check`.
- Durable-log history polish committed as
  `0b5053e2b11f0a6f53fb74f8541ebca76b2ffbb3` after rerunning
  `corepack pnpm prettier --write` on the durable logs, confirming
  `corepack pnpm prettier --check`, and passing `corepack pnpm docs:check`.
- Handoff de-stale wording committed as
  `ce02f448409889157872b2dc1e2ba927c7653f48`. Verification for that checkpoint
  recorded one initial `corepack pnpm prettier --check` failure on
  `build-protocol/work-logs/T-0009a.md`, then `corepack pnpm prettier --write
build-protocol/work-logs/T-0009a.md`, a passing rerun of
  `corepack pnpm prettier --check`, and a passing `corepack pnpm docs:check`.
- Final one-file re-review package
  `.superpowers/sdd/review-d4f7f7b..5b289a8.diff` reported all five reviewers
  clean: maintainability/style `019f1083-c5ce-76a3-81a5-d07f04aef5f8`,
  documentation `019f1083-ed62-7913-bc94-cc40bfc405bd`, TypeScript/API docs
  `019f1084-0a62-7e33-9037-719f183f5ea7`, security
  `019f1084-2dad-73c3-865c-aef521411eea`, and performance/reliability
  `019f1084-4d97-71c1-a9b2-8780c769d469`.
- Full branch verification with `CI=true corepack pnpm verify` passed on
  `2026-06-29 00:16 WEST` in the T-0009a worktree: 10 test files / 65 tests
  passed; coverage statements 99.41%, branches 94.11%, functions 100%, lines
  99.39%; docs/API check confirmed 100 proto exports, 28 core exports, 11
  server exports, and 26 storage exports; proto lint/generate/check-generated
  passed; known non-blocking TypeDoc invalid-origin source-link warning
  remains.
- D-0034 records that entity metadata belongs in `@spine-ts/server` and
  `@spine-ts/proto` should add only narrow curated option exports.
- Merged into `main` with merge commit `ec825a4` (`Merge T-0009a entity
metadata`) on `2026-06-29 00:18 WEST`.
- Main integration verification with `CI=true corepack pnpm verify` passed on
  `2026-06-29 00:28 WEST`: 10 test files / 65 tests passed; coverage
  statements 99.41%, branches 94.11%, functions 100%, lines 99.39%; docs/API
  check confirmed 100 proto exports, 28 core exports, 11 server exports, and 26
  storage exports; proto lint/generate/check-generated passed; known
  non-blocking TypeDoc invalid-origin source-link warning remains.
- No blocking questions known.
- Next step: select the next non-blocked task under the autonomous build
  protocol.
