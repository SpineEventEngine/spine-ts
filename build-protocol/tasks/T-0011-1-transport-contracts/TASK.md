# T-0011.1: Transport Contracts, Topics, And Envelope Routing Keys

Status: Complete
Parent task: `T-0011 Transport Foundation`
Start: `2026-06-30 20:45 WEST`
Baseline commit: `7b54d6c`
Task log path: `build-protocol/tasks/T-0011-1-transport-contracts/TASK.md`
Branch: `task/T-0011-1-transport-contracts`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-1-transport-contracts`
Authoring sub-agent: complete
Reviewer sub-agents: complete

## Objective

Define the first adapter-agnostic public contract surface in
`@spine-ts/transport` for local signal transport. The slice should establish
transport-owned topics, subscription descriptors, publish/request operation
contracts, handler callback types, and async close behavior without installing
ZeroMQ or implementing socket, broker, worker, bus, delivery, or server runtime
behavior.

## Acceptance Criteria

- `@spine-ts/transport` exports a small public contract surface for transport
  topics, subscription descriptors, publish/request operations, handler
  callbacks, and async close behavior.
- Topic abstractions are framed in type URLs, signal kinds, and
  transport-owned routing descriptors rather than ZeroMQ socket names,
  multipart frames, or IPC endpoint strings.
- The slice composes with existing core/server signal-envelope work and does
  not invent command/event/query service implementations or repository
  dispatch.
- Tests and docs show that the transport package is still adapter-agnostic and
  single-host ZeroMQ remains a later implementation detail.
- TypeDoc/API docs and export-count checks are updated for any public exports.

## Out Of Scope

- Native dependency installation.
- ZeroMQ socket creation, socket options, multipart frames, or endpoint address
  formats.
- IPC broker processes, worker registration, process supervision, retries, or
  durable delivery.
- Command/event/query/subscription service implementations.
- Handler invocation, repository dispatch, storage lifecycle, read-side
  execution, or gRPC service wiring.

## Applicable Decisions

- D-0007: ZeroMQ is local IPC only and must remain behind an abstraction.
- D-0024: ZeroMQ dependency installation is deferred until a transport adapter
  task.
- D-0054: T-0011 starts with adapter-agnostic transport contracts and defers
  native ZeroMQ installation.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Selected skills for this subtask:

- `subagent-driven-development`: orchestrator/worker/reviewer workflow.
- `using-git-worktrees`: isolated subtask worktree already created.
- `verification-before-completion`: required before task completion.
- `requesting-code-review` and `code-review-excellence`: required review loop.
- `typescript-advanced-types`: applicable for the transport public API shape.
- `nodejs-backend-patterns` and `architecture-patterns`: applicable for
  async close/contracts and avoiding over-engineered runtime boundaries.

Skipped relevant-looking skills:

- `security-threat-model`: not explicitly requested; required security reviewer
  will inspect the subtask.
- `event-store-design`, `projection-patterns`, and `saga-orchestration`: future
  delivery/read-side/runtime concerns, out of scope for this contract slice.

## Verification

- Setup baseline verification passed on `2026-06-30 20:48 WEST`:
  `CI=true corepack pnpm verify` passed with 21 test files / 258 tests,
  coverage 96.45% statements / 90.55% branches / 99.24% functions / 96.39%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, generated proto
  output clean, and generated files clean.

## Review Fix Scope

Current review-fix round must resolve these findings in one coherent patch:

- remove `responseTopic` from `RequestTransportOperation` until a later
  request/reply adapter task defines reply-route policy;
- reject unknown runtime `TransportSignalKind` and
  `TransportSubscriptionMode` values in the topic/subscription factories;
- apply a minimal canonical `messageTypeUrl` format guard that rejects blank or
  malformed values without a `prefix/type.name` separator;
- replace default-locale semantic-tag sorting with deterministic
  locale-independent ordering for routing materialization; and
- update transport API docs/export summaries plus durable logs with the review
  findings and fresh verification evidence.

Review-fix verification passed on `2026-06-30 21:11 WEST`:

- `corepack pnpm vitest run packages/transport/src/index.test.ts`: passed with
  1 file / 5 tests.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm docs:check`: passed with the existing TypeDoc warning that the
  local `origin` remote is not valid for source links.
- `CI=true corepack pnpm verify`: passed with 21 test files / 262 tests,
  coverage 96.49% statements / 90.72% branches / 99.26% functions / 96.44%
  lines, TypeDoc/API export checks, copied proto checksum verification, proto
  lint/generate, and generated-clean checks.
- `git diff --check`: passed.

Security sequencing fix verification passed on `2026-06-30 21:17 WEST`:

- `corepack pnpm vitest run packages/transport/src/index.test.ts`: passed
  with 1 file / 5 tests.
- `corepack pnpm typecheck`: passed.
- `corepack pnpm docs:check`: passed with the existing TypeDoc warning that
  the local `origin` remote is not valid for source links.
- `corepack pnpm prettier --check packages/transport/src/index.ts packages/transport/src/index.test.ts build-protocol/tasks/T-0011-1-transport-contracts/TASK.md build-protocol/tasks/T-0011-1-transport-contracts/IMPLEMENTATION_REPORT.md build-protocol/work-logs/T-0011-1.md build-protocol/reviews/T-0011-1-transport-contracts.md`:
  passed.
- `git diff --check`: passed.

Final security re-review passed on `2026-06-30 21:19 WEST`:

- Security reviewer `019f1a2f-3d51-79e2-967e-01dc736c4f74`: CLEAN.
- No remaining review comments are open in the required lanes.

Final verification passed on `2026-06-30 21:25 WEST`:

- `CI=true corepack pnpm verify`: passed with 21 test files / 262 tests,
  coverage 96.35% statements / 90.43% branches / 99.26% functions / 96.29%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
- TypeDoc emitted the existing invalid-`origin` warning only.
- `corepack pnpm prettier --check build-protocol/tasks/T-0011-1-transport-contracts/TASK.md build-protocol/tasks/T-0011-1-transport-contracts/IMPLEMENTATION_REPORT.md build-protocol/work-logs/T-0011-1.md build-protocol/reviews/T-0011-1-transport-contracts.md`:
  passed.
- `git diff --check`: passed.
