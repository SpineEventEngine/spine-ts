# T-0034 Implementation Report

Status: Coordinator pre-review payload fix in progress

Implementation worker: `019f52d4-d264-77e0-9469-48ff5950328a`

Branch: `task/T-0034-mark-exhausted-delivery-rows`

Baseline: assignment commit `6cd7e1d0`

Implementation commit: pending this report's non-recursive authoring commit;
the coordinator can identify it from branch `HEAD` and the final worker report.

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
- Exhaustion-time marker failure returns one frozen bounded stack-free fact
  object with `MARK_DELIVERED` and retained exhaustion context, retains no
  attempt, charges one failure, and leaves authoritative `TO_DELIVER`.
- Claim and lease/fence failures preserve the existing retained-attempt stage,
  reason, and failure accounting. Retained-state corruption remains fail
  closed.
- Existing retryable callback cleanup/finalization, one-attempt/one-failure
  sequencing, attempt 100, callback-success `STATUS_UPDATE`, `CATCH_UP`, and
  legacy `IMPORT_EVENT` behavior remain unchanged.

## TDD Evidence

- Success RED: four focused shard, exact-message, accepted-limit, and loop
  tests failed with the old delivered 0 / failed 1 behavior.
- Success GREEN: 2 files, 4 focused tests passed after the shared claim-fenced
  action.
- Marker-failure RED: the forced dedup finalizer failure exposed the raw Error.
- Marker-failure GREEN: 4 focused failure/concurrency/payload tests passed with
  bounded sanitized marker failure.
- Claim/lease RED: both tests showed the previous endpoint attempt as latest.
- Claim/lease GREEN: claim and lease failure tests retained `CLAIM_FAILED` and
  `LEASE_INACTIVE` respectively while remaining capped at 100 attempts.

## Files

- `packages/server/src/delivery/delivery.ts`
- `packages/server/src/delivery/delivery-loop.ts`
- `packages/server/test/delivery/delivery-worker.test.ts`
- `packages/server/test/delivery/delivery-loop.test.ts`
- `packages/server/README.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `build-protocol/DECISION_LOG.md`
- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- T-0034 task, work, review, and implementation-report records.

## Verification

- PASS: delivery worker/loop Vitest, 2 files and 110 tests.
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
