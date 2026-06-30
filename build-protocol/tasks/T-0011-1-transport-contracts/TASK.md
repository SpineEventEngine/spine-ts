# T-0011.1: Transport Contracts, Topics, And Envelope Routing Keys

Status: Implementation Complete; Review Pending
Parent task: `T-0011 Transport Foundation`
Start: `2026-06-30 20:45 WEST`
Baseline commit: `7b54d6c`
Task log path: `build-protocol/tasks/T-0011-1-transport-contracts/TASK.md`
Branch: `task/T-0011-1-transport-contracts`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-1-transport-contracts`
Authoring sub-agent: complete
Reviewer sub-agents: pending

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
