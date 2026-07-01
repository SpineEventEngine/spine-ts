# Implementation Report: T-0011.5 Delivery And Retry Boundary Contracts

Status: Implemented; Verified; Pending Review
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

Implementation sub-agent added the first transport-only delivery/retry boundary
contracts:

- `TransportDeliveryAttempt*` values over logical subscriptions, worker
  identities, delivery IDs, target IDs, and 1-based attempt numbers;
- `TransportDeliveryFailureClassification*` values with stable failure kind,
  failure code, retry eligibility, and redacted scalar details;
- `TransportDeliveryResult*` values that derive status from outcome plus retry
  eligibility and reject forged statuses/result keys; and
- package/API/architecture docs and API export checks for the new public
  surface.

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

No `@spine-ts/server` files were touched.

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

Implementation RED on `2026-07-01 00:01 WEST`:
`corepack pnpm vitest run packages/transport/src/index.test.ts` failed with 4
failing tests because the new delivery/retry public functions were missing.

Focused GREEN on `2026-07-01 00:03 WEST`:
`corepack pnpm vitest run packages/transport/src/index.test.ts` passed with 1
test file / 17 tests.

Required final verification passed before commit:

- `corepack pnpm typecheck` passed.
- `corepack pnpm docs:check` passed with the existing invalid-`origin` TypeDoc
  warning only and TypeDoc/API counts 100 proto / 28 core / 124 server / 26
  storage / 46 transport exports.
- `git diff --check` passed.
- Privileged branch-tip `CI=true corepack pnpm verify` passed on
  `2026-07-01 00:50 WEST` with 23 test files / 280 tests, coverage 96.04%
  statements / 90.31% branches / 99.33% functions / 95.98% lines, copied Spine
  proto checksum verification, proto lint/generate, and generated-clean all
  passed. Native IPC access was used because inherited ZeroMQ smoke tests bind
  `ipc://` endpoints.

Authoring handoff note: implementation sub-agent
`019f1ac0-673f-76b3-a7f6-58c84f0d3e85` authored the implementation and
recorded focused RED/GREEN evidence, but did not complete its final commit
handoff after verification. The orchestrator closed the still-running agent and
is committing the verified diff to keep the task resumable.

## Open Items

- Round-one review fixes were implemented by the review-fix sub-agent on
  `2026-07-01 02:28 WEST`. The fix keeps failed outcomes in `failed` status
  even when retry eligibility is `eligible`, preserves retry eligibility as
  separate data, rejects unsafe attempt numbers, tightens delivery-result and
  participant identity input typing with compile-time negative tests, and
  replaces failure-detail denylisting with an allowlist of scalar `stage`,
  `attempt`, `retryable`, `reason`, and `code` diagnostics.
- A narrow lint fix on `2026-07-01 02:39 WEST` changed
  `TransportDeliveryResultInputBase` from a `type` alias to an `interface` and
  replaced deprecated `toMatchTypeOf()` usage with `toExtend()` in the
  result-input type assertion.
- Focused lint-fix verification passed before commit: `corepack pnpm lint`;
  `corepack pnpm test packages/transport/src/index.test.ts` with 1 test file /
  17 tests; `corepack pnpm typecheck`; and `git diff --check`.
- Full branch-tip verification passed on `2026-07-01 02:38 WEST` after
  mechanical formatting: `CI=true corepack pnpm verify` passed with 23 test
  files / 280 tests, coverage 96.16% statements / 90.48% branches / 99.33%
  functions / 96.10% lines, TypeDoc/API counts 100 proto / 28 core / 124 server
  / 26 storage / 46 transport exports, copied Spine proto checksum
  verification, proto lint/generate, and generated-clean all passed.
