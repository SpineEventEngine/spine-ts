# T-0011.4: Broker And Worker Lifecycle Seam

Status: Complete
Parent task: `T-0011 Transport Foundation`
Start: `2026-06-30 22:52 WEST`
Baseline commit: `4ed7db6`
Task log path: `build-protocol/tasks/T-0011-4-broker-worker-lifecycle-seam/TASK.md`
Branch: `task/T-0011-4-broker-worker-lifecycle-seam`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-4-broker-worker-lifecycle-seam`
Authoring sub-agent: pending
Reviewer sub-agents: pending

## Objective

Define the smallest adapter-agnostic broker/worker lifecycle seam needed for
local multi-process transport. This slice should describe startup,
registration, readiness, and graceful close boundaries for broker and worker
participants while keeping ZeroMQ socket topology adapter-private and deferring
runtime dispatch, retry/delivery, storage, and server integration.

The task must not start real child processes, supervise workers, implement
handler dispatch, add durable delivery, introduce service hosts, or wire
`@spine-ts/server` runtime behavior.

## Acceptance Criteria

- `@spine-ts/transport` exposes a small public lifecycle contract surface for
  broker and worker participants, including stable participant identities,
  worker registrations, readiness state, lifecycle state, and async close
  semantics.
- The public contract uses transport topics, signal kinds, and logical worker
  roles rather than ZeroMQ sockets, endpoint strings, multipart frames, or
  adapter-specific process details.
- Tests cover deterministic lifecycle/registration helpers and validation
  failures without opening sockets or starting long-lived processes.
- Package, architecture, and API docs explain the broker/worker lifecycle seam
  and explicitly defer process supervision, broker socket topology, retries,
  durable delivery, handler invocation, storage, and server runtime wiring.
- TypeScript, lint, format, docs/API checks, proto workflow, and full
  verification remain green.

## Out Of Scope

- Real broker processes, worker processes, child-process management, readiness
  probes over IPC, or ZeroMQ socket topology.
- Command/event/query/subscription service behavior, repository invocation,
  server runtime wiring, read-side execution, storage lifecycle, or gRPC
  services.
- Delivery retry contracts, durable inbox/outbox storage, acknowledgement
  mapping, or failure classification beyond lifecycle validation.
- Multi-host networking or TCP transport.

## Applicable Decisions

- D-0007: ZeroMQ is local IPC only and must remain behind an abstraction.
- D-0024: native ZeroMQ dependency installation was deferred to adapter work and
  is now pinned by T-0011.2.
- D-0045: server-module work must inspect Spine JVM `core-jvm/server` and avoid
  over-engineering. This subtask is transport-only; if it touches
  `@spine-ts/server`, it must first inspect the corresponding JVM server code
  and record that evidence.
- D-0054: T-0011 starts adapter-agnostic, then pins `zeromq@6`; T-0011.4 owns
  broker/worker lifecycle seams, not server/runtime dispatch or delivery
  retries.

## Skill Applicability

Canonical checklist: `build-protocol/BUILD_PROTOCOL.md#skills-and-tooling`.

Selected skills for this subtask:

- `subagent-driven-development`: required orchestrator/worker/reviewer
  workflow.
- `using-git-worktrees`: isolated subtask worktree created.
- `verification-before-completion`: required before task completion.
- `requesting-code-review` and `code-review-excellence`: required review loop.
- `nodejs-backend-patterns`: applicable to lifecycle, shutdown, and local
  process boundary contracts.
- `javascript-testing-patterns`: applicable for deterministic Vitest coverage.
- `typescript-advanced-types`: applicable for generic transport lifecycle
  contracts without leaking adapter types.

Skipped relevant-looking skills:

- `security-threat-model`: not explicitly requested; the required security
  reviewer will inspect process-boundary and IPC exposure risks.
- `event-store-design`, `projection-patterns`, and `saga-orchestration`: later
  delivery/read-side/runtime concerns, out of scope here.

## Verification

- Setup dependency install passed on `2026-06-30 22:53 WEST`:
  `corepack pnpm install --frozen-lockfile` passed with the lockfile unchanged,
  reused cached packages, installed 197 workspace packages, and ran the
  approved `zeromq@6.5.0` install script.

- Parent baseline verification passed on `2026-06-30 22:51 WEST` from commit
  `4ed7db6`: `CI=true corepack pnpm verify` passed with 23 test files / 268
  tests, coverage 96.34% statements / 90.48% branches / 99.27% functions /
  96.28% lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26
  storage expected exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only. The command ran
  with native IPC access because the merged ZeroMQ smoke test binds
  `ipc://` endpoints and the managed sandbox rejects those binds with `EPERM`.

- Setup baseline verification passed on `2026-06-30 22:55 WEST`:
  `CI=true corepack pnpm verify` passed with 23 test files / 268 tests,
  coverage 96.34% statements / 90.48% branches / 99.27% functions / 96.28%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only. The command ran
  with native IPC access because the merged ZeroMQ smoke test binds
  `ipc://` endpoints and the managed sandbox rejects those binds with `EPERM`.

## Implementation Notes

- Start from existing `packages/transport` contracts and keep additions in the
  transport package unless implementation discovers a recorded reason to do
  otherwise.
- Keep lifecycle helpers deterministic and pure where possible so this slice
  does not require live sockets or child processes.
- `build-protocol/BUILD_PROTOCOL.md` already includes the human-requested
  server-module guardrail: any `@spine-ts/server` code must closely inspect
  Spine JVM `core-jvm/server` and avoid over-invention.
- Implemented seam adds immutable broker/worker participant identities, logical
  worker roles, subscription-backed worker registrations, lifecycle/readiness
  snapshot helpers, and runtime-facing async-close participant typing in
  `packages/transport/src/index.ts`.
- The public API intentionally keeps ZeroMQ endpoints, socket classes,
  multipart frames, process supervision, readiness probes over IPC, retries,
  durable delivery/storage, handler invocation, and server wiring deferred.

## Final Verification

- `corepack pnpm test packages/transport/src/index.test.ts packages/transport/src/zeromq-adapter-config.test.ts`
  passed on `2026-06-30 23:05 WEST` with 2 files and 14 tests passing.
- `corepack pnpm typecheck` passed on `2026-06-30 23:03 WEST`.
- `corepack pnpm docs:check` passed on `2026-06-30 23:03 WEST` with the
  existing invalid-`origin` TypeDoc warning only.
- `git diff --check` passed on `2026-06-30 23:03 WEST`.
- `CI=true corepack pnpm verify` first failed in the managed sandbox on
  `2026-06-30 23:04 WEST` because adapter-private ZeroMQ smoke tests hit
  `Operation not permitted` while binding `ipc://` endpoints.
- `CI=true corepack pnpm verify` passed on `2026-06-30 23:05 WEST` after
  rerunning with native IPC access: 23 test files / 273 tests passed, coverage
  reached 96.60% statements / 90.90% branches / 99.30% functions / 96.54%
  lines, TypeDoc/API checks passed with the existing invalid-`origin` warning
  only, copied-proto checksum verification passed, proto lint/generate passed,
  and generated proto output remained clean.
