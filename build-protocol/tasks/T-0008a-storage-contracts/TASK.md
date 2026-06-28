# T-0008a: Storage Contracts And In-Memory Adapter

Status: Implementation in progress
Start: `2026-06-28 21:35 WEST`
End: Pending
Setup baseline commit: `db7130e`
Task log path: `build-protocol/tasks/T-0008a-storage-contracts/TASK.md`
Branch: `task/T-0008a-storage-contracts`
Worktree: `/Users/armiol/development/experiments/spine-ts/.worktrees/T-0008a-storage-contracts`
Authoring sub-agent: `019f0ff4-becd-7c73-9f34-9120294e9083` (Darwin)
Reviewer sub-agents: Pending
Implementation baseline commit: `f1911d7`
Final branch checkpoint before integration: Pending
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
- No blocking questions known.
- Next step: wait for implementation commit, then run the required five-role
  review loop.
