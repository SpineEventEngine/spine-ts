# Review Log: T-0022a Projection Inbox Handoff

Status: remaining review findings fixed

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

## Remaining Findings Fix Pass

- Security Important: tightened `Delivery.drainMessage()` so exact-row shard
  equality comes from `index`/`ofTotal`, not a caller-supplied `key()`. The
  method now leases a normalized ID shard, reads by that normalized message ID,
  and checks the leased/session and pending-row shards before replay. Added a
  forged structural shard regression where `key()` lies while `index`/`ofTotal`
  point elsewhere.
- Reliability Important: moved the duplicated exact-row local handoff loop into
  a narrow shared helper. Duplicate `TO_DELIVER` rows that skip exact drain
  because the original local drain owns the shard now poll briefly for that
  exact row to become `DELIVERED`; non-duplicate skipped rows still fail fast.
  Added concurrent duplicate projection coverage and matching process-manager
  coverage for the shared helper path.
- Docs Important: corrected runtime/user/developer/package docs so
  process-manager event reactors are direct local `EventBus` execution and are
  not yet routed through durable inbox storage. README handoff sections now
  mention both process-manager command rows and live projection subscriber rows.
- Minor cleanup: removed the stray README `- and` bullet.
- Cleanup rule: replaced the overlong `assertMessageShardMatchesId` helper name
  with smaller shard-normalization helpers that satisfy semantic-name cleanup.

## Remaining Findings Verification

- `pnpm --config.verify-deps-before-run=false vitest run packages/server/test/delivery/delivery-worker.test.ts packages/server/test/context/projection-handoff.test.ts packages/server/test/context/process-manager-handoff.test.ts`:
  passed; 3 test files, 33 tests.
- `pnpm --config.verify-deps-before-run=false lint:generated`: first
  remaining-findings run failed on two ESLint unsafe-assignment findings in the
  new shard normalizer; after replacing those reads, passed with `tsc -b`,
  ESLint, and cleanup enforcement.
- `pnpm --config.verify-deps-before-run=false docs:check:generated`: passed;
  TypeDoc emitted the existing invalid `origin` remote source-link warning, then
  API export checks passed.
- `pnpm --config.verify-deps-before-run=false format:check`: passed.
- `git diff --check`: passed.
