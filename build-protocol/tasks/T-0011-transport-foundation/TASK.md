# T-0011: Transport Foundation

Status: T-0011.4 Integrated
Start: `2026-06-30 20:32 WEST`
Baseline commit: `194ce9e`
Task log path: `build-protocol/tasks/T-0011-transport-foundation/TASK.md`
Branch: `task/T-0011-transport-foundation`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-transport-foundation`
Requirements splitter:
`2026-06-30 20:40 WEST` splitter session (closed by orchestrator after handoff)
Authoring sub-agents: T-0011.1, T-0011.2, T-0011.3, and T-0011.4 complete; later subtasks pending
Reviewer sub-agents: T-0011.1, T-0011.2, T-0011.3, and T-0011.4 complete; later subtasks pending

## Objective

Introduce the first transport foundation after T-0010 completed the
single-process runtime and metadata readiness slices. The transport work must
support the project requirement for local multi-process Node.js execution over
a bus abstraction, initially backed by ZeroMQ local IPC, while hiding ZeroMQ
details behind package-owned transport APIs.

The task must not implement command/event/query services, handler invocation,
repository dispatch, durable delivery, read-side query execution, storage
lifecycle, process supervision, or a broad server facade unless the splitter
breaks out a narrowly justified subtask and the corresponding logs are updated.

## Governing Requirements

- `build-protocol/TECHNICAL_SPEC.md`: local multi-process execution over an
  abstract bus transport initially backed by ZeroMQ.
- `build-protocol/RUNTIME_ARCHITECTURE.md`: transport contracts deal in signal
  envelopes and type URL topics; socket types and ZeroMQ-specific envelopes must
  not leak into domain, repository, server, or service APIs.
- `build-protocol/BUILD_PROTOCOL.md`: one requirements splitter, one branch and
  worktree per task/subtask, one implementer per subtask, five reviewer lanes,
  durable logs, and sub-agent closure after completion.
- `build-protocol/DECISION_LOG.md`: D-0007 limits ZeroMQ to local IPC and
  defers scaling beyond one host; D-0024 deferred ZeroMQ dependency installation
  until the transport-adapter task; D-0045 requires server-module work to
  inspect task-relevant Spine JVM server code and avoid over-engineering.
- T-0010 left transport, buses, delivery, storage, dispatch, service hosting,
  read-side execution, and process supervision explicitly deferred.

## Initial Codebase State

- `packages/transport` currently exports only `packageSkeleton` metadata.
- `packages/server` now has runtime lifecycle, bounded-context runtime handles,
  write-side intake result types, command registration readiness, and event
  registration readiness.
- No ZeroMQ dependency is installed yet.
- No transport interfaces, bus topic types, broker adapter, or worker process
  lifecycle exist yet.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Session inventory exposed task-relevant skills including
`subagent-driven-development`, `using-git-worktrees`,
`verification-before-completion`, `requesting-code-review`,
`typescript-advanced-types`, `nodejs-backend-patterns`,
`javascript-testing-patterns`, `architecture-decision-records`,
`architecture-patterns`, `codebase-design`, `cqrs-implementation`,
`event-store-design`, and `performance`.

Repo-local expected-skill manifest:
`build-protocol/skills/EXPECTED_SKILLS.md` lists the required workflow skills
and key advisory skills. Selected orchestrator skills already read in this
session:

- `subagent-driven-development`: required for splitter/implementer/reviewer
  delegation and continuous execution.
- `using-git-worktrees`: required for isolated task branches/worktrees.
- `verification-before-completion`: required before completion claims.
- `requesting-code-review` and `code-review-excellence`: required for review
  loop construction and response.
- `typescript-advanced-types`, `nodejs-backend-patterns`, and
  `architecture-patterns`: applicable to transport API shape, Node runtime
  boundaries, and avoiding over-engineered abstractions.

Skipped relevant-looking skills for setup:

- `security-threat-model`, `stride-analysis-patterns`, and
  `threat-mitigation-mapping`: no explicit threat-model request yet; the
  required security reviewer will cover security review for each subtask.
- `performance`: relevant for reviewers, but setup does not yet implement hot
  paths.

## Required Splitter Output

The requirements splitter must:

1. Inspect the transport-related specs and current `packages/transport` code.
2. Investigate current ZeroMQ/Node transport dependency options before any
   dependency choice is made, preferring official package metadata and GitHub
   sources.
3. Produce a staged T-0011 roadmap with small subtasks.
4. Select the first non-blocked implementable subtask.
5. Keep the first subtask small enough to review without creating a full bus,
   service host, broker supervisor, durable delivery engine, or read-side
   execution model.
6. Identify which later subtasks own ZeroMQ adapter installation, IPC smoke
   tests, process lifecycle, retry/delivery behavior, and server/runtime wiring.

## Initial Non-Blocking Research Notes

The orchestrator inspected:

- `packages/transport/src/index.ts` and `packages/transport/src/index.test.ts`;
- `packages/transport/README.md` and `packages/transport/package.json`;
- `build-protocol/TECHNICAL_SPEC.md`;
- `build-protocol/RUNTIME_ARCHITECTURE.md`;
- `build-protocol/DEVELOPER_API.md`;
- `build-protocol/TODO_EXAMPLE_SPEC.md`;
- T-0010 task/report logs and deferred transport notes.

No blocking human question is known at setup time.

## Splitter Result

Requirements splitter completed on `2026-06-30 20:40 WEST`. Blocking
questions: none.

Dependency research evidence:

- Local repo/tooling constraints: root [package.json](/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-transport-foundation/package.json)
  requires Node `>=24.0.0` and pnpm `11.9.0`.
- Official npm metadata via `npm view zeromq version dist-tags repository
homepage description engines os cpu` returned `version = '6.5.0'`,
  `latest = '6.5.0'`, repo `git+https://github.com/zeromq/zeromq.js.git`,
  homepage `http://zeromq.github.io/zeromq.js/`, description
  "Next-generation ZeroMQ bindings for Node.js", and
  `engines = { node: '>= 12' }`.
- Comparison metadata via `npm view zmq version description repository
homepage engines` returned `version = '2.15.3'`, older repo
  `git+ssh://git@github.com/JustinTulloss/zeromq.node.git`, and
  `engines = { node: '>=0.8' }`.
- `npm view zeromq-old version description repository homepage engines` and
  `npm view @aminya/node-zmq version description repository homepage engines`
  both returned `npm error code E404`.
- Official GitHub docs reviewed:
  [zeromq/zeromq.js](https://github.com/zeromq/zeromq.js) and
  [JustinTulloss/zeromq.node](https://github.com/JustinTulloss/zeromq.node).

Research conclusion:

- No blocker prevents proceeding with transport planning.
- The best current dependency target is the official `zeromq` package line,
  pinned in a later adapter subtask rather than installed in the first slice.
- T-0011 should begin with a contract-first slice so public APIs settle before
  native adapter concerns are introduced.

Roadmap:

1. `T-0011.1 Transport Contracts, Topics, And Envelope Routing Keys`: define
   the smallest `@spine-ts/transport` public abstractions for transport-owned
   topics, subscriptions, publish/request contracts, handler signatures, and
   close semantics over existing signal-envelope concepts. No ZeroMQ install,
   sockets, buses, workers, or retries.
2. `T-0011.2 ZeroMQ Adapter Package Wiring And Dependency Pin`: install and
   pin `zeromq@6`, add adapter-private configuration/types, and document native
   runtime constraints without exposing ZeroMQ in public APIs.
3. `T-0011.3 Local IPC Smoke Tests`: add focused publish/subscribe and
   request/reply smoke tests over local IPC endpoints for the adapter, with
   clean test lifecycle and explicit single-host scope.
4. `T-0011.4 Broker And Worker Lifecycle Seam`: define broker/worker startup,
   registration, readiness, and graceful close boundaries needed for local
   multi-process transport, still without server supervision or delivery
   retries.
5. `T-0011.5 Delivery And Retry Boundary Contracts`: add transport-adjacent
   delivery status/result contracts and failure classification boundaries
   without implementing durable inbox/outbox storage or full retry engines.
6. `T-0011.6 Server Runtime Wiring Integration`: connect the server/runtime
   side to transport abstractions for command/event/query/subscription/system
   routing seams while still deferring full handler dispatch and broad facade
   behavior.
7. `T-0011.7 Documentation And Closure`: update package docs, architecture
   notes, compatibility notes, and parent-task verification closure after the
   transport slices land.

First selected non-blocked subtask:
`T-0011.1 Transport Contracts, Topics, And Envelope Routing Keys`.

Acceptance criteria for `T-0011.1`:

- `@spine-ts/transport` exports a small public contract surface for transport
  topics, subscription descriptors, publish/request operations, handler
  callbacks, and async close behavior.
- Topic abstractions are framed in type URLs, signal kinds, and transport-owned
  routing descriptors rather than ZeroMQ socket names or multipart frames.
- The slice composes with existing core/server signal-envelope work and does
  not invent command/event/query service implementations or repository
  dispatch.
- Tests and docs show that the transport package is still adapter-agnostic and
  single-host ZeroMQ remains a later implementation detail.

Out of scope for `T-0011.1`: native dependency installation, socket creation,
IPC addresses, broker processes, worker registration, retries, durable
delivery, server supervisors, gRPC service wiring, handler invocation, or read
side execution.

## Verification

- Setup baseline verification passed on `2026-06-30 20:36 WEST`:
  `CI=true corepack pnpm verify` passed with 21 test files / 258 tests,
  coverage 96.45% statements / 90.55% branches / 99.24% functions / 96.39%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, generated proto
  output clean, and generated files clean.

- T-0011.1 parent integration verification passed on `2026-06-30 21:28 WEST`
  after merge commit `6c86ad1`:
  `CI=true corepack pnpm verify` passed with 21 test files / 262 tests,
  coverage 96.35% statements / 90.43% branches / 99.26% functions / 96.29%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only.

- T-0011.2 parent integration verification passed on `2026-06-30 22:05 WEST`
  after merge commit `e9d14c3`:
  the first `CI=true corepack pnpm verify` attempt stopped at pnpm's
  dependency-state guard because `pnpm-workspace.yaml` changed `allowBuilds`.
  `corepack pnpm install --frozen-lockfile` then passed, added the three
  merged dependency packages, and ran the `zeromq@6.5.0` install script. A
  subsequent `CI=true corepack pnpm verify` passed with 22 test files / 266
  tests, coverage 96.34% statements / 90.48% branches / 99.27% functions /
  96.28% lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26
  storage expected exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only.

- T-0011.3 parent integration verification passed on `2026-06-30 22:48 WEST`
  after merge commit `6f5c53c`:
  `CI=true corepack pnpm verify` passed with 23 test files / 268 tests,
  coverage 96.34% statements / 90.48% branches / 99.27% functions / 96.28%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only. The command ran
  with native IPC access because the merged ZeroMQ smoke test binds
  `ipc://` endpoints and the managed sandbox rejects those binds with `EPERM`.

- T-0011.4 parent integration verification passed on `2026-06-30 23:46 WEST`
  after merge commit `78e3b0a`:
  `CI=true corepack pnpm verify` passed with 23 test files / 276 tests,
  coverage 96.60% statements / 91.06% branches / 99.30% functions / 96.54%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  / 31 transport expected exports, copied Spine proto checksum verification,
  proto lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only. The command ran
  with native IPC access because the merged ZeroMQ smoke test binds
  `ipc://` endpoints and the managed sandbox rejects those binds with `EPERM`.

## Integrated Subtasks

- `T-0011.1 Transport Contracts, Topics, And Envelope Routing Keys`: integrated
  by merge commit `6c86ad1` on `2026-06-30 21:28 WEST`. Required five-lane
  review clean; final subtask verification passed; parent verification passed
  after merge.
- `T-0011.2 ZeroMQ Adapter Package Wiring And Dependency Pin`: integrated by
  merge commit `e9d14c3` on `2026-06-30 22:01 WEST`. Required five-lane review
  clean; final subtask verification passed; parent dependency refresh and
  verification passed after merge.
- `T-0011.3 Local IPC Smoke Tests`: integrated by merge commit `6f5c53c` on
  `2026-06-30 22:48 WEST`. Required five-lane review clean after documentation
  follow-up; final subtask verification passed; parent native IPC verification
  passed after merge.
- `T-0011.4 Broker And Worker Lifecycle Seam`: integrated by merge commit
  `78e3b0a` on `2026-06-30 23:46 WEST`. Required five-lane review clean after
  maintainability, security, and final lint follow-ups; final subtask
  verification passed; parent native IPC verification passed after merge.

## Next Subtask

- `T-0011.5 Delivery And Retry Boundary Contracts`.
