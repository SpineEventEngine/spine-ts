# T-0026 Review Log

Status: implementation complete; review fixes verified

Task: `T-0026 Transport-Backed Delivery Workers`

Branch: `task/T-0026-transport-backed-delivery-workers`

## Required Review Lanes

| Lane                       | Reviewer                    | Status       |
| -------------------------- | --------------------------- | ------------ |
| Code style/maintainability | Review round                | Fixed MEDIUM |
| Documentation              | Documentation fix sub-agent | Fixed MEDIUM |
| TypeScript/API docs        | Review round                | Complete     |
| Security                   | Review round                | Fixed MEDIUM |
| Performance/reliability    | Reliability fix sub-agent   | Fixed P1     |

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

### Round 10 Follow-up - `2026-07-10T06:41:50Z`

- Finding: [Security MEDIUM] public `InboxStorage.write()` and public
  `markDelivered()` rejected visible top-level `claim` fields but still passed
  the caller object into serialization. A Proxy could hide `claim` from
  `Reflect.has()` while returning internal claim metadata from `get`.
- Fix: public inbox write/mark paths now build a new claim-free `InboxMessage`
  snapshot from the explicit public fields before serialization. Visible
  top-level `claim` remains rejected; hidden Proxy claim metadata is ignored and
  never reaches durable inbox or dedup records.
- Evidence: added Proxy regressions for public `InboxStorage.write()` and
  public `markDelivered()`. They failed before the fix because hidden claim
  metadata prevented public delivery marking, then passed after snapshotting.
- Finding: [API P1] public `DeliveryRun.claimed` and
  `DeliveryLoopRun.claimed` exposed claim mechanics in user-facing stats.
- Fix: renamed the public stat to `accepted` across delivery runs, loop
  aggregation, local handoff checks, tests, and public API docs. Internal
  claim-bearing worker code keeps claim terminology only for implementation
  fencing.
- Finding: [API P2] `ShardSession.shard` TypeDoc said "Shard claimed by this
  session."
- Fix: reworded it to "Shard held by this session."
- Finding: [Reliability HIGH/MEDIUM] `ShardedWorkRegistry.renew()` and
  `release()` captured `now` before awaited storage reads, allowing delayed
  reads or event-loop pauses to renew or release sessions that had expired by
  the time ownership was checked and CASed.
- Fix: both paths refresh the clock after reading and decoding the current
  stored session, before expiry checks and CAS decisions.
- Evidence: added delayed-read/clock-advance regressions for renew and release.
  They failed before the fix by renewing/releasing expired sessions, then
  passed after refreshing the clock. The existing row-renewal race test was
  adjusted to advance fake time to the renewal interval while staying inside
  the shard lease, preserving its intended inbox-renewal coverage.
- Verification: requested Vitest passed with 8 files and 226 tests;
  `typecheck:build:generated`, `docs:check`, `format:check`, and
  `git diff --check` passed. `docs:check` reported only the existing TypeDoc
  invalid-origin warning.

### Round 9 Follow-up - `2026-07-10T06:21:29Z`

- Finding: [MEDIUM] `inbox-storage.ts` exposed the row-claim worker internals as
  several exported standalone helpers.
- Fix: replaced those helpers with one grouped `@internal`
  `inboxStorageAccess` object/interface containing `claim`, `renew`,
  `markDelivered`, and `clear`. Delivery internals and storage-focused tests now
  import that grouped object directly from `inbox-storage.ts`; the package
  barrel still exports only public `InboxStorage` and `InboxStorageOptions`.
- Finding: [MEDIUM] public `InboxStorage.write()` and public marker paths could
  serialize a caller-supplied object that included optional internal `claim`
  metadata.
- Fix: public write and mark paths now reject snapshots containing a `claim`
  property before serialization. Internal claim-bearing serialization remains
  available only through `inboxStorageAccess` for worker CAS flows.
- Evidence: added regressions proving low-level public write and public
  `markDelivered()` reject injected claim metadata and leave the row state
  unchanged. Focused preflight Vitest passed with 3 files and 148 tests.
- Docs: public user-guide delivery sections now describe lease-fenced local
  drains, skipped unavailable rows, public `InboxMessage` snapshots, and
  future abandoned-row recovery without claim mechanics. `DeliveryLoopRun`
  TypeDoc avoids "rows claimed"; package README deferred wording is narrowed to
  transport topology, broker/process supervision, retained attempt history, and
  production retry policy; Developer API now documents
  `Delivery.drainMessage(message, { node, onMessage })` exact-row/no-limit
  semantics.
- Verification: requested Vitest passed with 8 files and 222 tests;
  `typecheck:build:generated`, `docs:check`, `format:check`, and
  `git diff --check` passed. `docs:check` reported only the existing TypeDoc
  invalid-origin warning.

### Round 8 Follow-up - `2026-07-10T06:05:12Z`

- Finding: [HIGH] active row-claim renewal could race final delivery marking.
  A renewal could update the active internal snapshot and durable row between
  callback completion and the final marker CAS, causing delivery to report
  failure after the endpoint already ran and making the row immediately
  retryable.
- Fix: active row-claim renewal, failure clearing, and final marking now share a
  local serialization point. After a callback returns, delivery waits for any
  in-flight shard renewal, marks delivered from the latest active internal
  snapshot, and preserves the durable claim if final marking still fails after
  a successful callback.
- Evidence: added a regression in `delivery-worker.test.ts` that blocks renewal
  until the endpoint returns. It failed before the fix with `delivered: 0` and
  `failed: 1`, then passed after renewal/mark serialization.
- Finding: [P1/P2] public TypeDoc-facing comments and curated API docs exposed
  row-claim mechanics.
- Fix: rewrote public `Delivery.drain()` / `drainMessage()` JSDoc,
  `docs/api/README.md`, and `build-protocol/DEVELOPER_API.md` to describe
  lease-fenced shard draining, supported worker labels, skipped unavailable
  rows, and `DeliveryRun` stats without row-claim internals.
- Finding: [MEDIUM] `BoundedContext` stored local inbox fields by concrete
  classes.
- Fix: added narrow internal `PmInbox` and `PrjInbox` interfaces that combine
  the public inbox contracts with `register(...)`; concrete local inbox classes
  remain construction details.
- Docs: `InboxClaim.expiresAt` now says local/direct workers do not
  auto-reclaim expired claims. Internal architecture docs state any existing
  durable claim is skipped, including expired or abandoned claims, and stale
  recovery remains future production policy. The package README keeps the
  public-facing delivery summary at the lease-fenced worker-contract level.
- Verification: requested Vitest batch passed with 8 files and 220 tests;
  `typecheck:build:generated`, `docs:check`, `format:check`, and
  `git diff --check` passed. `docs:check` reported only the existing TypeDoc
  invalid-origin warning.

### Round 7 Follow-up - `2026-07-10T05:48:00Z`

- Finding: [HIGH] Expired row claims were treated as reclaimable, so a late or
  missed renewal could let a second local/direct worker invoke the same endpoint
  while the original callback was still in flight.
- Fix: `InboxStorage.claim` now skips rows with any durable row claim, expired
  or live. Successful owners still mark delivered from the claimed snapshot;
  failed attempts clear only the unchanged claim. Abandoned/stale claim recovery
  remains future production retry/supervision policy.
- Evidence: added regression in `delivery-worker.test.ts` proving an
  expired-claimed row is read but not claimed or dispatched by a competing
  drain.
- Finding: [MEDIUM] `DeliveryLoop` used `processed` rows as proof of progress,
  so a page containing only already-claimed rows could be redrained tightly.
- Fix: added `claimed` counts to `DeliveryRun` and `DeliveryLoopRun`, and made
  the loop stop `IDLE` when a drain has no claimed, delivered, or failed rows.
- Evidence: added regression in `delivery-loop.test.ts` proving already-claimed
  pending rows stop after one idle drain with no endpoint invocation.
- Finding: [MEDIUM] Public inbox/drain/loop limits were not bounded at the
  storage query boundary.
- Fix: `InboxStorage.read` validates limits as positive safe integers at or
  below a fixed `1000` bound before opening/querying inbox storage; public
  drain and loop limits flow through that same storage boundary.
- Evidence: added regressions for zero, negative, fractional, non-finite, and
  above-bound limits, plus public drain/loop above-bound cases.
- Finding: [MEDIUM] Stored `CATCH_UP` labels were valid rows but direct delivery
  could still invoke callbacks for them.
- Fix: direct delivery now fail-closes after acquiring its row claim but before
  endpoint invocation unless the label is `HANDLE_COMMAND`,
  `UPDATE_SUBSCRIBER`, or `REACT_UPON_EVENT`.
- Evidence: added regression proving a `CATCH_UP` row records a failed run,
  leaves the row pending, clears only its own claim, and never invokes the
  callback.
- Docs: updated architecture and user-guide delivery summaries plus the
  `DeliveryLoop` class comment to describe shard pickup/renew/release CAS,
  durable row-claim fencing, skipped competing/abandoned claims, claim-free
  endpoint snapshots, and future abandoned-claim recovery policy.
- Verification: requested focused Vitest passed with 8 files and 219 tests;
  `typecheck:build:generated`, `docs:check`, `format:check`, and
  `git diff --check` passed. `docs:check` reported only the existing TypeDoc
  invalid-origin warning.

### Round 6 Follow-up - `2026-07-10T05:32:00Z`

- Finding: [P1] the Round 5 per-message claim used the current shard-session
  expiry only when the row was first claimed. Shard keepalive renewed the shard
  session while an endpoint callback was in flight, but did not renew the row
  claim, so another worker could claim the row after the original claim expiry.
- Fix: active delivery now tracks the claimed row snapshot and renews it with a
  compare-and-set to each renewed `ShardSession` expiry. If claim renewal
  returns `undefined` or throws, the lease keeper records lease loss and the
  foreground delivery path fails closed before marking delivered.
- Finding: [HIGH] `Inbox.claim()`, `Inbox.unclaim()`, `InboxMessage.claim`,
  and exported `InboxClaim` exposed framework-owned internals through the
  application-facing API.
- Fix: public `InboxMessage` and `DeliveryEndpoint` are claim-free, and `Inbox`
  no longer exposes claim/unclaim methods. Internal `InboxClaim`,
  `InboxRecordMessage`, and `ClaimedInboxMessage` live in a non-barrel module,
  while package-internal helper functions in `inbox-storage.ts` are not exported
  from `packages/server/src/index.ts`.
- Finding: [P3] `delivery.ts` duplicated claim/invoke/mark/clear logic between
  shard drain and exact-message drain.
- Fix: extracted one private `#deliverMessage()` helper and kept the public
  drain methods focused on shard/page/exact-row flow.
- Finding: [P3] `InboxStorage.#claimSnapshot()` validated claims by building a
  fake full inbox message.
- Fix: replaced that path with the direct internal `InboxClaimRecords`
  snapshot codec.
- Finding: [P2] docs did not describe durable row-claim fencing and claim-free
  endpoint snapshots.
- Fix: updated runtime architecture, developer API, API README source, package
  README, and delivery source comments to document row claim renewal, skipped
  live competing claims, marking from the claimed snapshot, clearing only the
  unchanged claim after failed attempts, and unclaimed `InboxMessage` snapshots
  passed to endpoints.
- Evidence: the new focused regression failed before the fix because a
  competing claim could take the row after the original claim expiry, then
  passed after CAS claim renewal. Required verification passed:
  requested delivery/context/index Vitest batch (7 files, 193 tests),
  `typecheck:build:generated`, `docs:check` with only the existing invalid
  origin TypeDoc warning, `format:check`, and `git diff --check`.

### Round 5 Follow-up - `2026-07-10T06:10:10Z`

- Finding: [P1] `Delivery.drain()` invoked `onMessage` after only a shard
  lease pre-check. A worker that lost or outlived shard ownership could race
  with another drain and duplicate endpoint invocation before stale
  `markDelivered()` fencing took effect.
- Fix: inbox rows now carry a small durable optional claim with shard-session
  id, node, and expiry. `Delivery.drain()` and `drainMessage()` acquire the
  claim through `Inbox`/`InboxStorage` with compare-and-set before invoking the
  endpoint. Competing drains skip rows with a live different claim; successful
  delivery marks with the claimed snapshot; failed attempts best-effort clear
  the unchanged claim. Endpoint callbacks still receive unclaimed message
  snapshots, so the fence remains framework-owned and does not expose framework
  `Event` envelopes or add production retry/supervision/topology.
- Evidence: focused red regression in `delivery-worker.test.ts` failed before
  the fix because `delivery.inbox.claim` was missing, then passed after the
  durable claim CAS. The requested focused delivery/context Vitest batch passed
  after the fix with 182 tests.
- Finding: [P2] `ShardedWorkRegistry.release()` could CAS-delete an
  already-expired matching session, unlike `renew()`.
- Fix: `release()` now reads the registry clock, returns `false` when the
  current stored session expires at or before that time, and refreshes the
  clock across CAS retries.
- Evidence: focused red regression in `sharded-work-registry.test.ts` failed
  before the fix because release resolved `true` after expiry, then passed
  after the expiry guard.
- Finding: [P2] internal `ProcessManagerInbox` and `ProjectionInbox` contracts
  did not include their concrete `replay(...)` endpoint even though local
  handoff classes and tests depend on that framework capability.
- Fix: added `replay(...)` to both internal inbox contracts, keeping the names
  short and avoiding concrete-class typing.
- Finding: [P2] API comments and the delivery gap wording could be read as
  contradicting storage-backed pickup/renew/release and caller-started
  `DeliveryLoop`/`DeliveryWorker` loops.
- Fix: updated `ShardedWorkRegistry` and `DeliveryWorker` class docs and
  reworded `build-protocol/DEVELOPER_API.md` to describe no process-wide or
  production scheduler/supervisor beyond caller-started delivery loops.

### Round 4 Follow-up - `2026-07-10T04:53:23Z`

- Finding: [P1] `ShardedWorkRegistry.renew()` could renew an already-expired
  session when the stored session ID and node still matched the caller's
  session. That let a delayed renewal extend ownership after another worker had
  become eligible to pick up the shard.
- Fix: `renew()` now reads the current storage-backed session, confirms
  session ID/node ownership, and returns `undefined` when the current stored
  `expiresAt` is at or before the renewal clock before constructing the next
  session.
- Evidence: focused red regression in `sharded-work-registry.test.ts` failed
  before the fix because delayed renewal returned a renewed `node-a` session,
  then passed after the expiry guard.
- Finding: [P2] `build-protocol/RUNTIME_ARCHITECTURE.md` described shard
  claim/release but did not mention renewal in the delivery-worker section.
- Fix: updated the runtime architecture delivery-worker section to describe
  storage-backed pickup, renewal, and release. It now states renewal is
  framework-owned lease fencing for active drains, not production retry or
  supervision.
- Verification: required focused delivery Vitest, `typecheck:build:generated`,
  `docs:check`, `format:check`, and `git diff --check` all passed on
  `2026-07-10T04:56:04Z`. `docs:check` reported only the existing TypeDoc
  invalid-origin warning.

### Round 3 Follow-up - `2026-07-10T04:42:03Z`

- Finding: [P1] lease activity in `Delivery.drain()` and `drainMessage()` was
  still timer-state-only. If the event loop paused or renewal was delayed past
  `expiresAt`, `requireActive()` could pass before the renewal timer observed
  the loss, allowing an expired owner to mark a row delivered after another
  worker became eligible to pick up the shard.
- Fix: delivery now keeps the configured delivery clock and passes it to the
  lease keeper. `requireActive()` fails once the current session expiry is at
  or before that clock, even if the renewal timer has not run yet. Renewal
  remains framework-owned lease fencing; no production retry or supervisor
  policy was added.
- Evidence: focused red regression in `delivery-worker.test.ts` failed before
  the fix with the expired foreground drain returning `delivered: 1` and
  `failed: 0`, then passed after the time-aware guard.
- Finding: [P3] `ShardedWorkRegistry.renew()` used release-specific helper
  names (`ReleaseSession`, `snapshotReleaseSession`) for a snapshot shared by
  renew and release.
- Fix: renamed the internal snapshot to `SessionClaim` and
  `snapshotSessionClaim`.
- Finding: [P2] curated API docs still described the exported registry seam as
  pickup/release only.
- Fix: updated `docs/api/README.md`, `build-protocol/DEVELOPER_API.md`, and
  `packages/server/README.md` to describe pickup/renew/release and renewal as
  framework-owned lease fencing for active drains.
- Verification: focused delivery Vitest, `typecheck:build:generated`,
  `docs:check`, `format:check`, and `git diff --check` all passed on
  `2026-07-10T04:44:33Z`. `docs:check` reported only the existing TypeDoc
  invalid-origin warning.
- Post-fix local review: compared `HEAD~1...HEAD` after commit because no
  separate Agent tool was exposed in this session. Standards/spec review found
  no additional issues on `2026-07-10T04:46:21Z`.

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
