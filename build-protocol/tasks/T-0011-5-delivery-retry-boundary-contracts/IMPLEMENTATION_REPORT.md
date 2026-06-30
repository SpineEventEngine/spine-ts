# Implementation Report: T-0011.5 Delivery And Retry Boundary Contracts

Status: Setup; Baseline Verification Passed
Task log:
`build-protocol/tasks/T-0011-5-delivery-retry-boundary-contracts/TASK.md`
Work log: `build-protocol/work-logs/T-0011-5.md`
Review log: `build-protocol/reviews/T-0011-5-delivery-retry-boundary-contracts.md`
Branch: `task/T-0011-5-delivery-retry-boundary-contracts`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0011-5-delivery-retry-boundary-contracts`

## Summary

T-0011.5 starts from parent T-0011 commit `bc028bc`, after T-0011.4 added
adapter-agnostic broker/worker lifecycle contracts. This subtask owns the
transport-adjacent delivery and retry boundary contracts only.

Expected implementation shape:

- public transport delivery status/result/failure classification types and
  helpers;
- deterministic tests for immutable value construction, retry eligibility, and
  failure redaction;
- docs that keep durable inbox/outbox storage, retry scheduling, handler
  dispatch, process supervision, and server runtime wiring deferred.

## Guardrails

- Keep ZeroMQ socket and endpoint details out of public transport exports.
- Do not open sockets or start child processes in this slice.
- Do not implement durable delivery, retry loops, storage records, repository
  dispatch, handler invocation, read-side execution, or gRPC wiring.
- Do not touch `@spine-ts/server` without first recording task-relevant Spine
  JVM `core-jvm/server` source evidence.

## Verification

Setup dependency install on `2026-06-30 23:52 WEST`: sandboxed
`corepack pnpm install --frozen-lockfile` was interrupted after npm registry
`ENOTFOUND` retries while populating the fresh worktree. Escalated
`corepack pnpm install --frozen-lockfile` passed with the lockfile unchanged,
reused 197 packages, and ran the approved `zeromq@6.5.0` install script.

Setup baseline verification passed on `2026-06-30 23:55 WEST`:
`CI=true corepack pnpm verify` passed with 23 test files / 276 tests, coverage
96.60% statements / 91.06% branches / 99.30% functions / 96.54% lines,
TypeDoc/API checks with 100 proto / 28 core / 124 server / 26 storage / 31
transport expected exports, copied Spine proto checksum verification, proto
lint/generate, generated proto output clean, and generated files clean. TypeDoc
emitted the existing invalid-`origin` warning only. The command ran with native
IPC access because the inherited ZeroMQ smoke tests bind `ipc://` endpoints and
the managed sandbox rejects those binds with `EPERM`.

## Open Items

- Spawn the implementation sub-agent after baseline verification is recorded.
