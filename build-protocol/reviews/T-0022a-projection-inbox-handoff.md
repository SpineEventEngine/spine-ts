# Review Log: T-0022a Projection Inbox Handoff

Status: second re-review fixes implemented

Scope: live projection subscriber durable inbox handoff.

## Required Lanes

| Lane                       | Reviewer    | Status                     | Notes                                                                                                                                                            |
| -------------------------- | ----------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code style/maintainability | first round | fix implemented            | Replaced ad-hoc `normalizeAny()` with a generated `AnySchema` binary round-trip; introduced `RepositoryEventSubscribers` alias near `RepositoryCommandAssignee`. |
| Documentation completeness | first round | fix implemented            | Updated runtime architecture to state live projection subscribers use durable local inbox handoff while other event endpoint kinds remain deferred.              |
| TypeScript/API docs        | first round | no blocking finding logged | API wording now names the local 30-second retention window for live projection handoff dedup.                                                                    |
| Security                   | first round | fix implemented            | Clarified dedup as a local retention-window boundary, not permanent idempotence.                                                                                 |
| Performance/reliability    | first round | fix implemented            | Added exact-row local handoff replay so unrelated pending rows are not invoked and unrelated failures do not affect the received row.                            |

## First-Round Fix Pass

- Added `Delivery.drainMessage()` for framework-owned exact-row replay under the shard lease.
- Switched local projection and process-manager handoffs from broad shard drain to exact-message drain.
- Added mixed-backlog regressions for projection and process-manager handoffs, covering unrelated same-label targets plus opposite-label rows remaining pending.
- Updated the stale process-manager scheduled-row test to assert isolation instead of broad shard draining.

## Second Re-Review Fix Pass

- Added a `Delivery.drainMessage()` guard that rejects mismatched
  `message.id.shard` and `message.shard` snapshots before shard pickup.
- Introduced `DeliveryMessageDrainOptions` for exact-message drains so ignored
  `limit` options are no longer part of that API.
- Added focused delivery regression/type coverage for the mismatched-shard
  guard and exact-message options shape.
- Updated API/developer docs and export checks for `DeliveryMessageDrainOptions`.
