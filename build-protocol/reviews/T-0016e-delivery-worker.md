# T-0016e Review Log

Status: first-round fixes applied

Scope: Delivery worker integration over existing inbox and shard storage,
focused tests, and public docs.

Implementation basis: `0913357`. The implementation adds the narrow direct
shard drain requested by D-0063 and leaves all required review lanes pending for
the orchestrating thread.

## Required Lanes

| Lane                       | Reviewer sub-agent | Status  | Result |
| -------------------------- | ------------------ | ------- | ------ |
| Code style/maintainability | pending            | Pending |        |
| Documentation completeness | pending            | Pending |        |
| TypeScript/API docs        | pending            | Pending |        |
| Security                   | pending            | Pending |        |
| Performance/reliability    | pending            | Pending |        |

## Implementation Notes

- `Delivery.drain()` claims one shard with `ShardedWorkRegistry`, reads
  `TO_DELIVER` inbox rows in order, invokes one supplied framework callback per
  message, marks callback successes `DELIVERED`, records callback failures in
  the returned run result, and releases the shard in `finally`.
- `InboxStorage.markDelivered()` is the only new status mutation. It keeps the
  inbox row and final dedup guard metadata aligned so delivered rows with live
  retention still block duplicate writes.
- The implementation intentionally does not add schedulers, broad monitors,
  transport APIs, retained attempt history, batch listeners, repository
  invocation, or catch-up behavior.

## Findings

### Round 1

| Lane                              | Severity | Finding                                                                                                                                                                                                                                                                                                       | Fix                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance/reliability, security | High/P1  | `InboxStorage.markDelivered()` advanced the inbox row to `DELIVERED` before validating/updating the dedup guard, so a guard failure could leave the row delivered with stale or missing guard state and make `Delivery.drain()` report a per-message failure after the durable row had already moved forward. | `markDelivered()` now validates the caller snapshot against the stored row, verifies/updates the dedup guard before advancing the inbox row, tolerates retry after a guard-first transient, and repairs the benign delivered-row/stale-guard race during duplicate receive. Added focused regression tests. |
| Security                          | P1       | `markDelivered()` trusted the caller-provided message by inbox message ID only. A forged object with the same ID could mark an unrelated row delivered.                                                                                                                                                       | `markDelivered()` now requires an exact stored-row match for pending rows and only treats already-delivered rows as idempotent when they match the same message apart from the status transition. Mismatches return `undefined`. Added a forged-marker regression test and documented the contract.         |
| TypeScript/API docs               | P2       | `DeliveryDrainOptions.deliver` violated the callback naming rule.                                                                                                                                                                                                                                             | Renamed the public option to `onMessage` and updated tests plus public docs.                                                                                                                                                                                                                                |
| TypeScript/API docs               | P2       | Public API docs and TypeDoc did not describe the new delivery worker surface and marker edge cases.                                                                                                                                                                                                           | Updated `docs/api/README.md`, package/developer docs, and TypeDoc for `Delivery.drain()`, `DeliveryDrainOptions`, `DeliveryEndpoint`, `DeliveryFailure`, `DeliveryRun`, `Inbox.markDelivered()`, and `InboxStorage.markDelivered()`.                                                                        |
| Documentation completeness        | P2       | Public docs still said durable delivery storage was deferred.                                                                                                                                                                                                                                                 | Updated `docs/USER_GUIDE.md` and `docs/architecture/README.md` to state that durable inbox records, dedup guards, shard leases, and the local shard drain exist, while scheduler/catch-up/transport-backed loops and retained attempt history remain deferred.                                              |

## Review Policy

- All lanes must be run by separate sub-agents.
- Each participating sub-agent must be closed after its report is no longer
  needed.
- Any finding must be fed back to an authoring/fix sub-agent and re-reviewed
  until clean before integration.
