# T-0034 Implementation Report

Status: Round 9 documentation fix verified; re-review pending

Implementation worker: `019f52d4-d264-77e0-9469-48ff5950328a`

Branch: `task/T-0034-mark-exhausted-delivery-rows`

Baseline: assignment commit `6cd7e1d0`

Implementation commits:

- `2ef02898 Implement exhausted delivery outcome`
- `64091ec6 Avoid exhausted attempt payload copies`
- `d8127cca Preserve failed exhaustion claims for cleanup`
- `e1cadf05 Preserve exhausted lease and cleanup failures`

## Result

- Added one shared internal exhaustion action for shard and exact-message
  drains.
- The action claims the exact row, synchronizes the active claim to the live
  shard fence, and finalizes with the existing internal claimed-row
  `markDelivered` path. Public `Inbox.markDelivered()` is not used.
- Successful exhaustion action invokes no callback, retains no attempt,
  reports accepted 0 / delivered 1 / failed 0, and consumes neither endpoint
  limit nor failure budget.
- A competing live claim skips with no mutation, callback, attempt, or failure.
- Exhaustion-time marker failure with successful cleanup returns one frozen,
  bounded, stack-free fact object with `MARK_DELIVERED` and retained exhaustion
  context and retains no attempt. If cleanup also fails, the existing one-
  failure path instead returns a `CLEANUP` result whose `AggregateError`
  contains the mark and cleanup errors and retains its bounded attempt metadata;
  that error is not promised frozen, bounded, or stack-free. Both paths charge
  one failure and leave authoritative `TO_DELIVER`.
- Claim and lease/fence failures preserve the existing retained-attempt stage,
  reason, and failure accounting. Retained-state corruption remains fail
  closed.
- Round 8 preserves `LEASE` staging through the final pre-mark renewal/active
  guards and changes to `STATUS_UPDATE` only immediately before durable
  `ActiveClaim.finalize()` work. A lease expiry after claim synchronization
  retains one capped `LEASE` / `LEASE_INACTIVE` attempt, reports one failure
  without callback or accepted work, and leaves authoritative `TO_DELIVER`.
- Round 8 also preserves the original mark error until cleanup outcome is
  known. Successful cleanup returns the sanitized exhaustion facts; failed
  cleanup returns one `CLEANUP` `AggregateError` containing the original mark
  and cleanup errors while retained attempt storage remains metadata-only.
- Existing retryable callback cleanup/finalization, one-attempt/one-failure
  sequencing, attempt 100, callback-success `STATUS_UPDATE`, `CATCH_UP`, and
  legacy `IMPORT_EVENT` behavior remain unchanged.
- Round 1 deepens `ActiveClaim.finalize()` so durable claim ownership remains
  available for cleanup after thrown or undefined mark results and is cleared
  only after defined success. A thrown exhaustion mark with successful cleanup
  is immediately redrainable; undefined mark plus cleanup failure remains one
  aggregated `CLEANUP` failure, one bounded retained attempt, and one failure-
  budget charge.
- The pre-review payload fix records exhausted claim/lease/cleanup attempts
  from `exhaustedFailureMessage()`, avoiding an otherwise discarded
  `Any.value` clone while preserving endpoint label/status validation and all
  retained attempt/failure semantics.

## TDD Evidence

- Round 8 RED: the deterministic final-lease-window regression left the capped
  summary at the prior `ENDPOINT` attempt, and failed mark cleanup aggregated
  sanitized exhaustion facts instead of the original mark `Error`.
- Round 8 GREEN: both regressions plus existing sanitized mark-failure and
  callback renewal/finalization controls passed after moving the stage signal
  into the mark helper and sanitizing only after successful cleanup.

- Round 1 runtime fix root cause: `ActiveClaim.finalize()` removed its durable
  claim handle before awaiting the mark callback, preventing cleanup after both
  thrown storage failures and undefined CAS results.
- Round 1 RED: thrown mark could not be immediately redrained, and undefined
  mark returned only sanitized status failure instead of aggregated cleanup.
- Round 1 GREEN: both focused tests passed after `ActiveClaim` retained
  ownership until defined durable success.

- Pre-review payload fix: verified that exhausted claim/lease attempt recording
  unnecessarily routed through the payload-copying endpoint snapshot even
  though retained attempts persist metadata only. RED preserved the successful
  exhausted backlog at zero copies, then observed exactly one maximum-payload
  slice on exhausted claim failure.
- Pre-review payload GREEN: the same extended test observed zero payload slices
  for both successful exhaustion and exhausted claim-failure retention, while
  preserving bounded `CLAIM_FAILED` attempt facts.

- Success RED: four focused shard, exact-message, accepted-limit, and loop
  tests failed with the old delivered 0 / failed 1 behavior.
- Success GREEN: 2 files, 4 focused tests passed after the shared claim-fenced
  action.
- Marker-failure RED: the forced dedup finalizer failure exposed the raw Error.
- Marker-failure GREEN: 4 focused failure/concurrency/payload tests passed with
  bounded sanitized marker facts when cleanup succeeds and the existing
  aggregate when cleanup also fails.
- Claim/lease RED: both tests showed the previous endpoint attempt as latest.
- Claim/lease GREEN: claim and lease failure tests retained `CLAIM_FAILED` and
  `LEASE_INACTIVE` respectively while remaining capped at 100 attempts.

## Files

- `packages/server/src/delivery/delivery.ts`
- `packages/server/src/delivery/delivery-loop.ts`
- `packages/server/src/delivery/delivery-worker.ts`
- `packages/server/test/delivery/delivery-worker.test.ts`
- `packages/server/test/delivery/delivery-loop.test.ts`
- `packages/server/test/delivery/delivery-storage-fault-fixture.ts`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- T-0034 task, work, review, and implementation-report records.

## Verification

- PASS: Round 9 docs-only `docs:check`, `format:check`, `git diff --check`,
  status/untracked, targeted D-0084 successful/failed-cleanup wording, exact
  `e1cadf05` commit locator, four-header alignment, ledger
  uniqueness/currentness, active-worker, and exact five-file changed-scope
  checks. No tests, standalone typechecks, or full `pnpm verify` ran, as
  directed. Fresh four-lane re-review remains pending.
- PASS: Round 8 focused RED reproduced both P2s; focused GREEN passed 4
  regressions/controls, and full delivery worker/loop Vitest passed 2 files and
  112 tests.
- PASS: Round 8 `typecheck:build:generated`, `typecheck:tooling`, focused ESLint
  over changed runtime/tests, `docs:check`, `format:check`, `git diff --check`,
  status/untracked, stale/current stage/error wording, four-header alignment,
  ledger/status, active-worker, and exact 12-file changed-scope checks. Full
  `pnpm verify` was not run, as directed. Fresh four-lane re-review remains
  pending.
- PASS: Round 7 docs/TypeDoc `docs:check`, both typechecks, focused delivery
  source ESLint, `format:check`, `git diff --check`, status/untracked,
  stale/current claim searches, four-header alignment, ledger/status,
  active-worker, and exact 11-file changed-scope checks. No runtime tests or
  full `pnpm verify` ran, as directed. Fresh four-lane re-review remains
  pending.
- PASS: Round 6 docs-only `docs:check`, `format:check`, `git diff --check`,
  status/untracked, four-header alignment, targeted D-0084 stale/current
  wording, commit-ledger/status, active-worker, and five-file changed-scope
  checks. Fresh four-lane re-review remains pending.
- PASS: Round 4 log-only `docs:check`, `format:check`, `git diff --check`,
  status/untracked, four-header alignment, commit-ledger uniqueness/currentness,
  active-worker, and four-file changed-scope checks.
- PASS: Round 3 log-only `docs:check`, `format:check`, `git diff --check`,
  status/untracked, exact commit-subject reconciliation, report file inventory,
  changed-scope, and active-ledger/status checks.
- PASS: delivery worker/loop Vitest, 2 files and 111 tests.
- PASS: focused maximum-payload success/claim-failure regression, 1 test.
- PASS: `typecheck:build:generated`.
- PASS: `typecheck:tooling`.
- PASS: focused ESLint over changed delivery runtime/tests.
- PASS: `docs:check`; 0 TypeDoc errors, one known invalid-`origin` warning, and
  expected export counts for all six packages.
- PASS: `format:check` after the final report/status update.
- PASS: `git diff --check` and untracked-output check after the final
  report/status update.
- NOT RUN: full `pnpm verify`, per explicit task direction.

Independent review and final full verification remain coordinator-owned.
