# Managed shutdown targeted reliability re-review

2026-10-14. Existing `performance_reliability_reviewer`, original explicit `gpt-6-sol` / `medium`, Standard profile retained. Actual runtime model/reasoning metadata remains unavailable; no visible mismatch. Read-only targeted review of the corrected managed paths and supplied evidence. No builds, tests, processes, or production edits. Supplied final focused unit evidence reports 109/109; managed integration reports 7/7. Reported build, affected ESLint, format and diff checks pass; global cleanup/TSDoc failures are in independent paging paths.

## Disposition

- Prior P1 forced child after missed acknowledgement: **resolved for the TERM/KILL and `close-failed` cases**. `managed-server-application.ts:2073-2081` tags the forced failure; `:2035-2039` retains it on the replica; `:1359-1367` carries terminal failures to the coordinator; `:1307-1308` prevents a later successful result. The corrected missing-ACK retry assertion covers the path.
- Prior P2 stalled reconciliation cleanup: **resolved**. `node-coordinator.ts:421-436` starts both kernel `close()` calls without awaiting membership reconciliation, observes rejections, and independently destroys tracked network handles. The new stalled-reconciliation test asserts both calls begin.
- Parent/child clock issue: **resolved on inspected paths**. The default parent clock and child close deadline use `Time.monotonicTime()`; the child clamps duplicate private close messages to its earlier deadline. The wall-clock rollback regression exercises that clamp. The parent still starts one deadline on first close.

## Residual finding

**P1 — A child exit before Delivery-drained can still become a successful retry.** In `packages/server/src/server/managed-server-application.ts:1075-1087`, `#onExit` rejects the current attempt's `drained` deferred and removes the replica. It only records a terminal failure when `replica.closeFailure` already exists, which it does not for an exit that races the first acknowledgement. In `awaitChildClose` at `:2060-2083`, the `exited` observation returns successfully; `#closeReplica` therefore clears `closeFailure` at `:1359-1362`. The first cohort close rejects because `#awaitDeliveryDrains` sees the rejected deferred, but a second close rebuilds its replica list from the now-empty slot at `:1284-1291`, sees no `#terminalChildFailure`, and can resolve. This reports graceful shutdown after an admitted child's drain was never confirmed. Retain the premature-exit failure at `#onExit` or make `awaitChildClose` reject when exit precedes Delivery-drained, and test first close rejection followed by a second pre-deadline close after that exit. Keep relay retry semantics for a still-live child intact.

No other residual reliability finding in the requested correction scope.
