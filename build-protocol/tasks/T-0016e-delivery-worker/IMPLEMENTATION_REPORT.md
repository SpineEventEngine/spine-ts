# T-0016e Implementation Report

Status: REVIEW_FIX_APPLIED

Implementation commit: `0913357` (`Implement delivery shard drain`)
Review-fix commit: this commit (`Fix delivery worker review findings`)

## Summary

- Added `Delivery.drain()` as the small framework-owned direct shard drain.
  It claims one shard, reads `TO_DELIVER` rows in inbox order, invokes one
  supplied callback per row, marks callback successes `DELIVERED`, records
  failures in the returned run result, and releases the shard in `finally`.
- Added the narrow `Inbox.markDelivered()` / `InboxStorage.markDelivered()`
  status update for `TO_DELIVER` to `DELIVERED`. The storage update keeps final
  dedup guard metadata aligned with the inbox row, preserving delivered-row
  deduplication while `keepUntil` is live.
- Added focused delivery tests for shard ownership skip, release after callback
  failure, retry behavior, success status update, delivered-row dedup,
  bounded-run statistics, and idempotent/no-op marker behavior.
- Updated TypeDoc exports, API export guard, package README, developer API,
  runtime architecture, work log, and review log.
- Review-fix pass renamed `DeliveryDrainOptions.deliver` to `onMessage`,
  changed `InboxStorage.markDelivered()` to validate exact message snapshots
  and prepare/repair the dedup guard before advancing the inbox row, and added
  regressions for guard-update failure, forged marker input, and the
  delivered-row/stale-guard duplicate-receive race.
- Review-fix docs now describe durable inbox records, dedup guards, shard
  leases, and the direct local shard drain as implemented, while keeping
  scheduler/catch-up/transport-backed loops and retained attempt history
  deferred.

## Files Changed

- `build-protocol/DEVELOPER_API.md`
- `build-protocol/RUNTIME_ARCHITECTURE.md`
- `build-protocol/reviews/T-0016e-delivery-worker.md`
- `build-protocol/work-logs/T-0016e.md`
- `docs/USER_GUIDE.md`
- `docs/api/README.md`
- `docs/architecture/README.md`
- `packages/server/README.md`
- `packages/server/src/delivery/delivery.ts`
- `packages/server/src/delivery/inbox-storage.ts`
- `packages/server/src/delivery/inbox.ts`
- `packages/server/src/index.ts`
- `packages/server/test/delivery/delivery-worker.test.ts`
- `scripts/check-api-docs.mjs`
- `build-protocol/tasks/T-0016e-delivery-worker/IMPLEMENTATION_REPORT.md`

## Verification

- `corepack pnpm test:generated packages/server/test/delivery/delivery-worker.test.ts`
  - Red before implementation: failed because `Delivery.drain` was missing.
  - Green after implementation: passed with 1 test file and 5 tests.
- `corepack pnpm test:generated packages/server/test/delivery`
  - Passed with 5 test files and 142 tests.
- `corepack pnpm typecheck`
  - Passed.
- `corepack pnpm docs:check`
  - Passed. TypeDoc emitted the existing invalid-`origin` source-link warning.
- `corepack pnpm lint`
  - Passed after replacing an intentionally empty test callback.
- `corepack pnpm format:check`
  - Passed.
- `git diff --check`
  - Passed.
- Sandboxed `corepack pnpm verify`
  - Failed due sandbox listener restrictions: ZeroMQ local IPC tests failed
    with `Operation not permitted`; gRPC service/example tests failed with
    `listen EPERM: operation not permitted 127.0.0.1` and related timeouts.
- Escalated `corepack pnpm test:coverage:generated`
  - Passed with 51 test files and 849 tests. Coverage: 94.87% statements,
    90.02% branches, 97.79% functions, 94.86% lines.
- Escalated `corepack pnpm verify`
  - Passed end to end. Full tests passed with 51 files and 849 tests.
    Coverage passed with 94.87% statements, 90.02% branches, 97.79% functions,
    and 94.86% lines. TypeDoc emitted the existing invalid-`origin` warning;
    API export checks passed with 190 server exports; proto lint passed; and
    generated proto outputs were ignored, untracked, and freshly regenerated.
- Review-fix focused red check:
  `corepack pnpm test:generated packages/server/test/delivery/delivery-worker.test.ts`
  failed before implementation updates with the old callback path, the
  forged-marker same-ID trust failure, and the delivered-row/stale-guard
  corruption path.
- Review-fix focused green check:
  `corepack pnpm test:generated packages/server/test/delivery/delivery-worker.test.ts`
  passed with 1 test file and 12 tests.
- Review-fix focused delivery check:
  `corepack pnpm test:generated packages/server/test/delivery`
  passed with 5 test files and 147 tests.
- Review-fix required checks:
  `corepack pnpm typecheck`, `corepack pnpm lint`,
  `corepack pnpm format:check`, and `corepack pnpm docs:check` passed.
  `docs:check` emitted the existing TypeDoc invalid-`origin` source-link
  warning.
- Review-fix sandboxed `corepack pnpm verify`
  - Failed under local listener/IPC restrictions: ZeroMQ local IPC tests failed
    with `Operation not permitted`, the standalone example failed with
    `listen EPERM: operation not permitted 127.0.0.1`, and real gRPC
    `SpineServices` tests timed out after listener failures.
- Review-fix escalated `corepack pnpm verify`
  - Passed end to end. Full tests passed with 51 files and 854 tests. Coverage
    passed with 94.84% statements, 90.01% branches, 97.80% functions, and
    94.84% lines. TypeDoc emitted the existing invalid-`origin` warning; API
    export checks passed with 190 server exports; proto lint passed; and
    generated proto outputs were ignored, untracked, and freshly regenerated.

## Concerns

- No implementation concerns. Full verification needs listener permissions in
  this environment; the sandboxed failure was reproduced and the same pipeline
  passed under escalation.
