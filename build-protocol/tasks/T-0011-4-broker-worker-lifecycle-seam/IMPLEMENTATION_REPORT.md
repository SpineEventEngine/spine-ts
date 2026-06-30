# Implementation Report: T-0011.4 Broker And Worker Lifecycle Seam

Status: Complete; Final Verification Passed
Task log: `build-protocol/tasks/T-0011-4-broker-worker-lifecycle-seam/TASK.md`
Work log: `build-protocol/work-logs/T-0011-4.md`
Review log: `build-protocol/reviews/T-0011-4-broker-worker-lifecycle-seam.md`
Branch: `task/T-0011-4-broker-worker-lifecycle-seam`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-4-broker-worker-lifecycle-seam`

## Summary

T-0011.4 starts from parent T-0011 commit `4ed7db6`, after T-0011.3 added
adapter-private live ZeroMQ local IPC smoke tests. This subtask owns the
adapter-agnostic broker/worker lifecycle seam for local multi-process transport.

Expected implementation shape:

- public transport lifecycle types/helpers for broker and worker participants;
- deterministic tests for identity, registration, readiness, lifecycle state,
  and close semantics;
- docs that keep socket topology, process supervision, delivery/retry,
  handler dispatch, storage, and server runtime wiring deferred.

## Guardrails

- Keep ZeroMQ socket and endpoint details out of public transport exports.
- Do not open sockets or start child processes in this slice.
- Do not introduce runtime dispatch, retries, durable delivery, storage,
  read-side execution, or gRPC wiring.
- Do not touch `@spine-ts/server` without first recording task-relevant Spine
  JVM `core-jvm/server` source evidence.

## Verification

Setup dependency install passed on `2026-06-30 22:53 WEST`:
`corepack pnpm install --frozen-lockfile` passed with the lockfile unchanged,
reused cached packages, installed 197 workspace packages, and ran the approved
`zeromq@6.5.0` install script.

Parent baseline verification passed on `2026-06-30 22:51 WEST` from commit
`4ed7db6`: `CI=true corepack pnpm verify` passed with 23 test files / 268
tests, coverage 96.34% statements / 90.48% branches / 99.27% functions /
96.28% lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26
storage expected exports, copied Spine proto checksum verification, proto
lint/generate, generated proto output clean, and generated files clean. TypeDoc
emitted the existing invalid-`origin` warning only. The command ran with native
IPC access because the merged ZeroMQ smoke test binds `ipc://` endpoints and
the managed sandbox rejects those binds with `EPERM`.

Setup baseline verification passed on `2026-06-30 22:55 WEST`:
`CI=true corepack pnpm verify` passed with 23 test files / 268 tests, coverage
96.34% statements / 90.48% branches / 99.27% functions / 96.28% lines,
TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage expected
exports, copied Spine proto checksum verification, proto lint/generate,
generated proto output clean, and generated files clean. TypeDoc emitted the
existing invalid-`origin` warning only. The command ran with native IPC access
because the merged ZeroMQ smoke test binds `ipc://` endpoints and the managed
sandbox rejects those binds with `EPERM`.

## Open Items

- None for T-0011.4.

## Result

- Added adapter-agnostic broker/worker lifecycle contracts to
  `@spine-ts/transport`: stable participant identities, logical worker roles,
  worker registrations over transport subscriptions, lifecycle/readiness
  snapshots, and runtime-facing async-close participant typing.
- Round 1 review fixes collapsed lifecycle helpers onto canonical participant
  identity input, removed public participant wrapper constructors, tightened
  logical ID validation, re-normalized exported lifecycle value objects from
  semantic fields, sorted worker subscriptions by `descriptorKey`, and
  prevented `ready` worker snapshots without registration evidence.
- Added deterministic tests for lifecycle helpers and validation failures
  without opening sockets or starting processes.
- Updated package/API/architecture docs and durable task logs to describe the
  lifecycle seam and its explicit deferrals.
- Round 1 fix verification completed successfully. Full `verify` again needed a
  native IPC rerun because existing ZeroMQ smoke tests bind `ipc://` endpoints.
- Round 2 re-review tightened canonical participant inputs and rejected
  dotted host/IP-shaped logical IDs, while keeping simple logical IDs such as
  `projection-a`, `projection_worker`, and `worker01` valid.
- Round 2 fix verification completed successfully with the focused transport
  tests, `typecheck`, `docs:check`, and `git diff --check`.
- Round 3 maintainability and security re-review reported clean.
- Final verification found and fixed two lint/type issues in the round 2 fix:
  an always-false worker-kind check and a non-null assertion. Focused lint,
  transport tests, typecheck, and whitespace checks passed after the follow-up.
- Final branch-tip verification passed on `2026-06-30 23:43 WEST`:
  `CI=true corepack pnpm verify` passed with 23 test files / 276 tests,
  coverage 96.60% statements / 91.06% branches / 99.30% functions / 96.54%
  lines, TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage
  / 31 transport expected exports, copied Spine proto checksum verification,
  proto lint/generate, generated proto output clean, and generated files clean.
  TypeDoc emitted the existing invalid-`origin` warning only.
