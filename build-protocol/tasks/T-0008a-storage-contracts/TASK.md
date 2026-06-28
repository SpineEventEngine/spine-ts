# T-0008a: Storage Contracts And In-Memory Adapter

Status: Second follow-up fixes complete; pending re-review
Start: `2026-06-28 21:35 WEST`
End: Pending
Setup baseline commit: `db7130e`
Task log path: `build-protocol/tasks/T-0008a-storage-contracts/TASK.md`
Branch: `task/T-0008a-storage-contracts`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0008a-storage-contracts`
Authoring sub-agent: `019f0ff4-becd-7c73-9f34-9120294e9083` (Darwin)
Reviewer sub-agents: Maintainability/style `019f1004-5be9-77c2-9191-4a71a8fea916`;
documentation `019f1004-8374-7f33-a643-13e86daebd3a`; TypeScript/API docs
`019f1004-af48-7563-889e-dde078c55143`; security
`019f1004-de72-7b40-9915-5ecef92ba29e`; performance/reliability
`019f1005-0746-7353-bcda-e6bb1ee956c9`.
Implementation baseline commit: `0a6908e` (handoff), `f1911d7` recorded by setup logs
Final branch checkpoint before integration: Pending second follow-up re-review
Main integration merge commit: Pending

## Objective

Add the first storage foundation in `@spine-ts/storage`: public TypeScript
contracts for record-oriented framework storage and an in-memory adapter suitable
for tests/development. This task must keep storage separate from repositories,
buses, decorators, service APIs, and ZeroMQ transport.

## Required Inputs To Read

- `build-protocol/TECHNICAL_SPEC.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/CODE_QUALITY.md`
- `build-protocol/DECISION_LOG.md`
- `packages/storage/src/index.ts`
- `packages/storage/src/index.test.ts`
- `packages/storage/README.md`
- `docs/USER_GUIDE.md`
- `docs/architecture/README.md`
- `docs/api/README.md`
- Relevant JVM docs under `spine-jvm-docs` if storage semantics need
  clarification.

## Skill Use

- `subagent-driven-development`: required by the autonomous build protocol.
- `using-git-worktrees`: required for isolated branch/worktree execution.
- `event-store-design`: applies because storage must support future aggregate
  event histories and append-like semantics.
- `cqrs-implementation`: applies because storage must preserve read/write
  segregation for future projections and query models.
- `typescript-advanced-types`: applies to generic storage contracts.
- `javascript-testing-patterns` and `test-driven-development`: apply to Vitest
  RED/GREEN coverage for the adapter.
- `architecture-decision-records`: applies to preserving D-0033.
- `requesting-code-review`, `receiving-code-review`, and
  `verification-before-completion`: required by the review loop and final gates.

## Scope

Expected implementation shape:

- Replace the metadata-only storage skeleton with public storage contracts in
  `packages/storage/src/index.ts`.
- Provide an in-memory implementation that is asynchronous and deterministic for
  tests.
- Model storage as record-oriented capabilities suitable for future entity,
  aggregate event, snapshot, projection, delivery, tenant index, and diagnostics
  records.
- Preserve strict read-side/write-side segregation in naming and APIs; do not
  make command-side code depend on read-side projection stores.
- Include optimistic-concurrency or version metadata where needed for a useful
  future repository seam.
- Add focused Vitest tests for empty reads, writes, version conflicts,
  immutability/snapshot behavior, ordered scans or stream reads, and independent
  store instances.
- Update package README, `docs/USER_GUIDE.md`, `docs/architecture/README.md`,
  and `docs/api/README.md` as needed.
- Update API docs checks if new public exports require explicit coverage.
- Preserve full verification: `CI=true corepack pnpm verify`.

## Out Of Scope

- Repository, aggregate, projection, process-manager, or transaction runtime
  implementations.
- `(set_once)` state-transition enforcement beyond documenting that future
  transactions will use storage snapshots/history.
- Command/event bus, delivery worker, inbox/outbox runtime, or async processing.
- ZeroMQ or transport abstractions.
- Production database adapters.
- gRPC service implementation.
- To-do example behavior.

## Constraints

- Storage APIs must be asynchronous even for in-memory implementation.
- Do not log tokens, credentials, auth headers, secret environment variables,
  packed payload bytes, or sensitive payload contents.
- Do not add runtime dependencies without recording a decision and checking
  current package options.
- Keep API names OOP/library-friendly and TypeDoc-documented.
- Do not break existing `@spine-ts/core` and `@spine-ts/proto` APIs or generated
  proto contracts.
- Keep coverage at or above the 90% project gate.

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

- RED focused storage tests before implementation.
- GREEN focused storage tests after implementation.
- `corepack pnpm typecheck`.
- `node scripts/check-api-docs.mjs` or full docs check after public exports.
- `CI=true corepack pnpm verify` before review handoff and before integration.

## Durable State

- Setup logs created on `main` after T-0007b integration commit `db7130e`.
- Branch/worktree created from setup commit
  `d1ff2d96e1e67eeb072d8ac3868ec9fb2c54b475`.
- Baseline verification passed on `2026-06-28 21:37 WEST` with
  `CI=true corepack pnpm verify`: typecheck, lint, format, tests, coverage,
  docs/API check, proto lint/generate, and generated-output cleanliness all
  passed. Vitest ran 9 test files and 41 tests. Coverage: statements 99.44%,
  branches 91.83%, functions 100%, lines 99.44%. TypeDoc emitted the known
  invalid `origin` warning and confirmed 85 proto exports plus 28 core exports.
- Implementation sub-agent `019f0ff4-becd-7c73-9f34-9120294e9083` (Darwin) was
  spawned on `2026-06-28 21:38 WEST` with ownership of the T-0008a storage
  contracts, in-memory adapter, docs/API updates, durable logs, and verification
  evidence.
- Implementation completed on `2026-06-28 21:51 WEST`: replaced the
  metadata-only storage skeleton with async record-oriented storage contracts,
  `StorageVersionConflictError`, and `InMemoryStorageAdapter`; added focused
  Vitest coverage for empty reads, optimistic version conflicts, snapshot
  isolation, stream ordering, scans/deletes, tenant indexes, diagnostics, and
  instance isolation; updated package/user/architecture/API docs and API export
  checks for 25 storage exports.
- RED evidence: `corepack pnpm vitest run packages/storage/src/index.test.ts`
  failed before implementation with 6/6 tests failing because
  `createInMemoryStorageAdapter` and `InMemoryStorageAdapter` were not exported
  by the skeleton.
- GREEN/focused evidence: `corepack pnpm vitest run
packages/storage/src/index.test.ts` passed with 1 file / 9 tests;
  `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm
format:check`, and `corepack pnpm docs:check` passed. Docs check retained the
  known invalid `origin` TypeDoc warning and confirmed 85 proto exports, 28 core
  exports, and 25 storage exports.
- Full verification evidence: `CI=true corepack pnpm verify` passed on
  `2026-06-28 21:53 WEST`: node check, typecheck, lint, format, tests, coverage,
  docs/API check, proto lint/generate, and generated-output cleanliness all
  passed. Vitest ran 9 files / 49 tests. Coverage: statements 99.63%, branches
  93.67%, functions 100%, lines 99.62%.
- Review round 1 was dispatched on `2026-06-28 21:50 WEST` with diff basis
  `baee5ae..f82c2487cbfe99d22596e4bb9ccb2e246ae784d5`.
- Review dispatch log commit `d0d204984ba51675337c6551a2ba0f72b438ef06`
  records round-1 reviewer dispatch state.
- Round-1 findings received on `2026-06-28 22:00 WEST`: P1 clone preservation
  for byte-bearing/framework payloads, P1 store-bound payload generics, P2 empty
  aggregate appends must not retain streams, P2/P3 durable log restart-state
  cleanup, and P3 API landing-page storage export-check wording. Security
  reviewer reported no comments.
- Round-1 RED evidence: after adding regression tests,
  `corepack pnpm vitest run packages/storage/src/index.test.ts` failed with 1
  failing test because byte payloads were corrupted into non-`Uint8Array`
  shapes; `corepack pnpm typecheck` failed because `StorageAdapter`,
  `WriteSideRecordStore`, and `createInMemoryStorageAdapter` were not yet
  payload-generic.
- Round-1 fix committed as `264c4a5fe6a0e4315a5df1cedae2fb436579e9bc` on
  `2026-06-28 22:07 WEST`: `cloneValue()` now uses Node 24
  `structuredClone()`, storage/read-side stores bind payload types at the
  store/adapter level, empty aggregate appends validate expected stream version
  and return `[]` without retaining a stream, and docs describe
  structured-clone-compatible payloads and storage export checks.
- Round-1 GREEN/full evidence: `corepack pnpm vitest run
packages/storage/src/index.test.ts` passed with 1 file / 12 tests; `corepack
pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm format:check`, and
  `corepack pnpm docs:check` passed. `CI=true corepack pnpm verify` passed on
  `2026-06-28 22:07 WEST`: 9 test files / 52 tests, coverage statements 99.62%,
  branches 93.33%, functions 100%, lines 99.6%; docs/API check confirmed 85
  proto exports, 28 core exports, and 25 storage exports; proto
  lint/generate/check-generated passed.
- Follow-up re-review completed at HEAD
  `9613f84517b1b339a299339c83ba827735bbe4fe`: maintainability/style,
  TypeScript/API docs, and performance/reliability reported no comments.
  Remaining findings: Security P2 safe clone failure messages for non-cloneable
  payloads; Documentation P3 top-level README storage status.
- Follow-up RED evidence on `2026-06-28 22:16 WEST`: after adding a focused
  non-cloneable payload regression with a sensitive-looking string in function
  source, `corepack pnpm vitest run packages/storage/src/index.test.ts` failed
  with 1 failing test because the error name was still `DataCloneError`.
- Follow-up fix in progress on `2026-06-28 22:17 WEST`: clone failures are
  wrapped in `StoragePayloadCloneError` with a fixed structured-clone
  compatibility message, API docs/checks include 26 storage exports, and the
  top-level README now states that only production storage adapters/repository
  runtime are deferred while the non-durable in-memory adapter exists.
- Follow-up fix committed as `7b489418c58b2c11171baf70d04db1d009aa5501` on
  `2026-06-28 22:18 WEST`.
- Follow-up GREEN/full evidence: `corepack pnpm vitest run
packages/storage/src/index.test.ts` passed with 1 file / 13 tests; `corepack
pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm format:check`, and
  `corepack pnpm docs:check` passed. `CI=true corepack pnpm verify` passed on
  `2026-06-28 22:18 WEST`: 9 test files / 53 tests, coverage statements 99.62%,
  branches 93.33%, functions 100%, lines 99.61%; docs/API check confirmed 85
  proto exports, 28 core exports, and 26 storage exports; proto
  lint/generate/check-generated passed.
- Second follow-up re-review completed at HEAD
  `fa94e24bb19d6518311dc4470a404ece3853ac31`: maintainability/style,
  TypeScript/API docs, and performance/reliability reported no comments.
  Remaining findings: aggregate event append clone failures must not store
  partial events or skip global positions; diagnostics must clone attributes
  before advancing sequences; the clone error regression must also assert that
  error name/message do not include function-source identifiers, function
  syntax, or native structured-clone text; task/review log status must reflect
  the second follow-up state.
- Second follow-up RED evidence on `2026-06-28 22:31 WEST`: after adding
  focused regressions, `corepack pnpm vitest run
packages/storage/src/index.test.ts` failed with 2 failing tests. The aggregate
  retry received `globalPosition: 3` instead of `1`, and the diagnostic retry
  received `diagnostic-2`/sequence `2` instead of `diagnostic-1`/sequence `1`.
- Second follow-up fix completed on `2026-06-28 22:31 WEST`: aggregate
  appends now clone all event payloads before assigning global positions or
  storing records, diagnostics clone attributes before advancing sequence, and
  the safe clone-error regression checks for absence of `leakedSecret`, `() =>`,
  and `could not be cloned` in both error name and message.
- Second follow-up focused GREEN evidence: `corepack pnpm vitest run
packages/storage/src/index.test.ts` passed with 1 file / 15 tests.
- Second follow-up verification evidence on `2026-06-28 22:33 WEST`:
  `corepack pnpm typecheck` passed; `corepack pnpm docs:check` passed with the
  known TypeDoc invalid `origin` warning and confirmed 85 proto exports, 28 core
  exports, and 26 storage exports; `CI=true corepack pnpm verify` passed with 9
  test files / 55 tests, coverage statements 99.63%, branches 93.5%, functions
  100%, lines 99.61%, docs/API check, proto lint/generate, and generated-output
  cleanliness.
- No blocking questions known.
- Next step: commit the second follow-up fix for orchestrator-owned re-review.
