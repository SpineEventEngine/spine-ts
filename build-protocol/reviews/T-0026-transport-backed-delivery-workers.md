# T-0026 Review Log

Status: implementation complete; review fixes verified

Task: `T-0026 Transport-Backed Delivery Workers`

Branch: `task/T-0026-transport-backed-delivery-workers`

## Required Review Lanes

| Lane                       | Reviewer                    | Status      |
| -------------------------- | --------------------------- | ----------- |
| Code style/maintainability | Review round                | Complete    |
| Documentation              | Documentation fix sub-agent | Fixed P2/P3 |
| TypeScript/API docs        | Review round                | Complete    |
| Security                   | Review round                | Complete    |
| Performance/reliability    | Reliability fix sub-agent   | Fixed P1    |

## Review Criteria

- Check the Human-Imposed Requirements Ledger in the task brief.
- Check task-relevant JVM inspection evidence before accepting server runtime
  changes.
- Reject over-engineered worker abstractions that are not required for this
  slice.
- Verify no end-user code receives framework `Event` envelopes, manual
  transactions, `@Apply`, schema-bearing decorators, or materialization helpers.
- Verify `IMPORT_EVENT` remains unsupported for new writes and fail-closed for
  legacy rows.

## Rounds

Review findings fixed and verified after implementation commit `94b4c632`.

### Lease Reliability Follow-up - `2026-07-10T04:27:00Z`

- Finding: [P1] `Delivery.drain()` and `drainMessage()` could keep awaiting an
  endpoint callback after their shard lease expired. Another worker could then
  pick up the same shard and invoke the same `TO_DELIVER` row concurrently.
- Fix: `ShardedWorkRegistry.renew()` now extends only the current storage-backed
  session ID/node with compare-and-set fencing. Active delivery drains start a
  small lease keeper, check that ownership has not been lost before endpoint
  invocation and before marking delivered, and still release the session in
  `finally`.
- Evidence: focused `delivery-worker.test.ts` regression failed before the fix
  with worker B returning `DRAINED`/`delivered: 1` instead of `SKIPPED`, then
  passed after adding session renewal and drain-local keepalive.

### Review Log Follow-up - `2026-07-10T04:27:00Z`

- Finding: [P3] The required review lanes table still listed every lane as
  `Pending` after findings and fixes had been recorded.
- Fix: updated the table to show completed lanes and fixed P1/P2/P3 follow-up
  status.

### Documentation Review Follow-up - `2026-07-10T05:09:03Z`

- Finding: [P2] `packages/server/README.md` still said "Supported delivery
  workers" remain an open production gap, which was stale after T-0026 exported
  and documented `DeliveryWorker` as the supported local closeable wrapper over
  shard delivery loops.
- Fix: narrowed the open-gap wording to process-supervised delivery workers,
  transport-topology workers, scheduler/retry workers, retained attempt
  history, production delivery policy, and catch-up work. The README still
  states that full production supervision and retry policy remain outside this
  slice.

### Reliability Review Follow-up - `2026-07-10T04:14:12Z`

- Finding: [P1] `DeliveryWorker.start()` used fail-fast `Promise.all()` for
  shard loops. If one `DeliveryLoop.run()` rejected while another loop was still
  inside an active drain, the worker cleared `#running` early and later
  `close()` calls no longer waited for that active loop.
- Fix: `DeliveryWorker.start()` now stores a run promise backed by
  `Promise.allSettled()`, so `#running` is cleared only after every shard loop
  fulfills or rejects. Single loop failures preserve the original rejection;
  multiple loop failures reject with one `AggregateError` containing every
  reason.
- Evidence: focused `delivery-worker-runtime.test.ts` failed before the fix on
  early close settlement and missing multi-failure aggregation, then passed
  after the worker settlement change.
