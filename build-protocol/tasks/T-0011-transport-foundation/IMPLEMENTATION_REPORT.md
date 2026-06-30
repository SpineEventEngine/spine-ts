# Implementation Report: T-0011 Transport Foundation

Status: T-0011.4 Integrated
Task log: `build-protocol/tasks/T-0011-transport-foundation/TASK.md`
Work log: `build-protocol/work-logs/T-0011.md`
Review log: `build-protocol/reviews/T-0011-transport-foundation.md`
Branch: `task/T-0011-transport-foundation`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-transport-foundation`

## Summary

T-0011 starts from verified `main` commit `194ce9e`, after T-0010 was merged
and verified. The task owns the first transport foundation for local
multi-process Node.js execution. The splitter must decide the smallest safe
subtask before implementation starts.

Requirements splitter completed on `2026-06-30 20:40 WEST` with no blocking
questions. The recommended first slice is `T-0011.1 Transport Contracts,
Topics, And Envelope Routing Keys`, followed by later subtasks for ZeroMQ
adapter installation, IPC smoke tests, broker/worker lifecycle, delivery/retry
boundaries, server/runtime wiring, and docs closure.

`T-0011.1` was integrated into this parent branch by merge commit `6c86ad1` on
`2026-06-30 21:28 WEST`. The integrated slice adds the adapter-agnostic
`@spine-ts/transport` contract surface for immutable topics, subscriptions,
routing descriptors, publish/request operation contracts, handler callback
types, transport handles, and async close behavior. It intentionally does not
install ZeroMQ or implement socket, broker, worker, retry, server dispatch, or
read-side behavior.

`T-0011.2` was integrated into this parent branch by merge commit `e9d14c3` on
`2026-06-30 22:01 WEST`. The integrated slice pins exact `zeromq@6.5.0` for
`@spine-ts/transport`, records explicit pnpm native build approval, adds an
adapter-private local IPC configuration helper and tests, and documents the
native/local IPC constraints without exporting ZeroMQ through the public
transport API.

`T-0011.3` was integrated into this parent branch by merge commit `6f5c53c` on
`2026-06-30 22:48 WEST`. The integrated slice adds adapter-private live ZeroMQ
local IPC smoke tests for publish/subscribe and request/reply flows, records
managed-sandbox `ipc://` / `EPERM` behavior, and keeps broker, worker,
delivery/retry, and server runtime wiring deferred to later subtasks.

`T-0011.4` was integrated into this parent branch by merge commit `78e3b0a` on
`2026-06-30 23:46 WEST`. The integrated slice adds contract-level broker and
worker lifecycle snapshots, participant identities, worker registrations,
readiness states, and validation helpers for local transport orchestration. It
keeps process supervision, concrete broker topology, IPC readiness probes,
delivery/retry behavior, handler dispatch, storage lifecycle, and server
runtime wiring deferred to later subtasks.

## Scope Guardrails

- Hide ZeroMQ behind a transport abstraction.
- Treat ZeroMQ as local IPC only.
- Do not leak socket types, socket options, or ZeroMQ envelope details into
  domain, repository, server, or public service APIs.
- Do not create command/event/query services, full buses, handler invocation,
  repository dispatch, storage lifecycle, durable delivery, process
  supervision, or read-side execution in the first slice unless explicitly split
  into later tasks.

## Verification

- The fresh worktree required `corepack pnpm install --frozen-lockfile`; the
  sandboxed install failed with npm registry `ENOTFOUND`, and the escalated
  frozen install passed with the lockfile unchanged.
- Setup baseline verification passed on `2026-06-30 20:36 WEST`:
  `CI=true corepack pnpm verify` passed with 21 test files / 258 tests,
  coverage 96.45% statements / 90.55% branches / 99.24% functions / 96.39%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  expected exports, copied Spine proto checksum verification, generated proto
  output clean, and generated files clean.
- Parent verification after integrating T-0011.1 passed on
  `2026-06-30 21:28 WEST`: `CI=true corepack pnpm verify` passed with 21 test
  files / 262 tests, coverage 96.35% statements / 90.43% branches / 99.26%
  functions / 96.29% lines, TypeDoc/API checks with 100 proto / 28 core / 124
  server / 26 storage expected exports, copied Spine proto checksum
  verification, proto lint/generate, generated proto output clean, and
  generated files clean. TypeDoc emitted the existing invalid-`origin` warning
  only.
- Parent verification after integrating T-0011.2 passed on
  `2026-06-30 22:05 WEST`: the first `CI=true corepack pnpm verify` attempt
  stopped at pnpm's dependency-state guard after the merged `allowBuilds`
  change; `corepack pnpm install --frozen-lockfile` passed, added the merged
  `zeromq` dependency packages, and ran the `zeromq@6.5.0` install script; the
  subsequent `CI=true corepack pnpm verify` passed with 22 test files / 266
  tests, coverage 96.34% statements / 90.48% branches / 99.27% functions /
  96.28% lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26
  storage expected exports, copied Spine proto checksum verification, proto
  lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only.
- Parent verification after integrating T-0011.3 passed on
  `2026-06-30 22:48 WEST`: `CI=true corepack pnpm verify` passed with 23 test
  files / 268 tests, coverage 96.34% statements / 90.48% branches / 99.27%
  functions / 96.28% lines, TypeDoc/API checks with 100 proto / 28 core / 124
  server / 26 storage expected exports, copied Spine proto checksum
  verification, proto lint/generate, generated proto output clean, and
  generated files clean. TypeDoc emitted the existing invalid-`origin` warning
  only. The command ran with native IPC access because the merged ZeroMQ smoke
  test binds `ipc://` endpoints and the managed sandbox rejects those binds
  with `EPERM`.
- Parent verification after integrating T-0011.4 passed on
  `2026-06-30 23:46 WEST`: `CI=true corepack pnpm verify` passed with 23 test
  files / 276 tests, coverage 96.60% statements / 91.06% branches / 99.30%
  functions / 96.54% lines, TypeDoc/API checks with 100 proto / 28 core / 124
  server / 26 storage / 31 transport expected exports, copied Spine proto
  checksum verification, proto lint/generate, generated proto output clean,
  and generated files clean. TypeDoc emitted the existing invalid-`origin`
  warning only. The command ran with native IPC access because the merged
  ZeroMQ smoke test binds `ipc://` endpoints and the managed sandbox rejects
  those binds with `EPERM`.

## Splitter Research And Recommendation

- `npm view zeromq version dist-tags repository homepage description engines os
cpu` succeeded in this environment and identified the maintained official
  package line as `zeromq@6.5.0` from `zeromq/zeromq.js`.
- `npm view zmq version description repository homepage engines` returned the
  legacy `zmq@2.15.3` binding line with an older Node engine range and older
  repository lineage.
- `npm view zeromq-old version description repository homepage engines` and
  `npm view @aminya/node-zmq version description repository homepage engines`
  returned npm `E404` responses.
- GitHub project docs reviewed:
  [zeromq/zeromq.js](https://github.com/zeromq/zeromq.js) and
  [JustinTulloss/zeromq.node](https://github.com/JustinTulloss/zeromq.node).

Recommendation: keep the first subtask dependency-free and contract-first;
defer installation to the adapter subtask and plan to pin the official
`zeromq` package there unless new evidence appears when the adapter branch
performs native smoke tests.

## Files Changed

- `build-protocol/tasks/T-0011-transport-foundation/TASK.md`
- `build-protocol/tasks/T-0011-transport-foundation/IMPLEMENTATION_REPORT.md`
- `build-protocol/work-logs/T-0011.md`
- `build-protocol/reviews/T-0011-transport-foundation.md`
- T-0011.1 integration also changed `packages/transport`, package/API docs,
  architecture docs, and transport API export checks. See
  `build-protocol/tasks/T-0011-1-transport-contracts/IMPLEMENTATION_REPORT.md`.
- T-0011.2 integration changed `packages/transport` dependency/configuration
  files, lockfile/workspace build policy, package/API docs, architecture docs,
  and T-0011.2 durable logs. See
  `build-protocol/tasks/T-0011-2-zmq-adapter-package-wiring/IMPLEMENTATION_REPORT.md`.
- T-0011.3 integration changed adapter-private ZeroMQ IPC smoke tests, package
  docs, architecture/API docs, and T-0011.3 durable logs. See
  `build-protocol/tasks/T-0011-3-local-ipc-smoke-tests/IMPLEMENTATION_REPORT.md`.
- T-0011.4 integration changed transport lifecycle contracts/tests, package
  docs, architecture/API docs, transport API export checks, and T-0011.4
  durable logs. See
  `build-protocol/tasks/T-0011-4-broker-worker-lifecycle-seam/IMPLEMENTATION_REPORT.md`.

## Open Items

- `T-0011.5 Delivery And Retry Boundary Contracts` is next.
- Delivery status/result contracts and failure classification boundaries remain
  deferred to T-0011.5.
