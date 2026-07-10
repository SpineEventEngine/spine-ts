# T-0026 Review Log

Status: Round 25 fix verified; re-review pending

Task: `T-0026 Transport-Backed Delivery Workers`

Branch: `task/T-0026-transport-backed-delivery-workers`

## Required Review Lanes

| Lane                       | Reviewer | Status                   |
| -------------------------- | -------- | ------------------------ |
| Code style/maintainability | Hypatia  | Fixed; re-review pending |
| Documentation              | Kuhn     | Fixed; re-review pending |
| TypeScript/API docs        | Arendt   | Fixed; re-review pending |
| Security                   | Pauli    | Fixed; re-review pending |
| Performance/reliability    | Erdos    | Fixed; re-review pending |

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

### Round 25 Follow-up - `2026-07-10T10:58:57Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..71ba68e0.diff` from task baseline
  `ca8fb2b3` to handoff HEAD `71ba68e0`.
- Code style/maintainability (Hypatia): [Important] callback names violate the
  binding `on`/`On` convention. Rename exported `DeliveryEndpoint` and internal
  `renewClaim` / `action` callback names. [Minor] the storage fault-injection
  test override is too large and should be split when touching that area.
- Documentation (Kuhn): [Important] public docs still say endpoint callbacks
  receive `InboxMessage` snapshots rather than narrowed
  `DeliveryEndpointMessage` snapshots, and stale recovery wording implies
  expired per-message ownership is wholly future work instead of reclaimable by
  later claim attempts.
- TypeScript/API docs (Arendt): [Important] public documentation does not match
  the narrowed callback/failure API and should consistently name
  `DeliveryEndpointMessage` plus its three-label supported endpoint union.
- Security (Pauli): [Important] `leaseMs: 1` creates an unsafe renewal cadence.
  Add a shared lower lease-duration bound across delivery and sharded registry
  validation and cover rejected lower values.
- Performance/reliability (Erdos): [Important] scan-budget exhaustion is
  reported as idle and can starve a supported tail row across loop drains;
  claim expiry can be missed when it occurs during the storage read; and
  pre-callback failures can exceed the loop failure budget because they do not
  consume accepted callback budget.
- Action: dispatch one fix worker with the complete findings list. Required
  verification includes focused delivery worker/loop/inbox/sharded-registry
  tests, typecheck, docs check, format check, and `git diff --check`, followed
  by a fresh five-lane re-review.

### Round 25 Fix Worker Start - `2026-07-10`

The fix worker opened `round-25-fix-report.md` with the canonical skill
applicability check and will address every Round 25 finding through focused
red/green delivery regressions before the next review pass.

### Round 25 Fix Implementation - `2026-07-10`

- Added focused red/green coverage for the shared lease floor, delayed claim
  expiry, finite scan continuation, and pre-callback loop failure budget.
- Implemented the `OnDeliveryMessage` rename, independent public snapshot docs,
  shared `1000ms` lease validation, post-read expiry check, and loop-only
  continuation/failure controls.
- Coordinator verification passed after the fix worker returned: focused
  delivery Vitest passed with 4 files and 210 tests; generated build typecheck,
  docs check, format check, and `git diff --check` passed. `docs:check`
  reported only the existing invalid-origin TypeDoc source-link warning.
- Fix commit: `e089963f` (`Fix delivery loop reliability and docs`).

### Round 19 Follow-up - `2026-07-10T08:57:33Z`

- Finding: [Reliability HIGH] `Delivery.drain()` still could not scan past a
  full `maxReadLimit` page of unavailable `TO_DELIVER` rows because record
  storage had no paging cursor/offset and the drain treated the saturated read
  window as exhaustion.
- Fix: added minimal `RecordQuery.offset` support, applied it in in-memory
  storage after deterministic sorting and before `limit`, exposed inbox read
  offset for ordered pages, and changed delivery scanning to advance past rows
  that remain pending/unavailable while stopping only on a short page or the
  accepted-work cap.
- Evidence: the new regression with 1000 claimed unavailable head rows and one
  deliverable tail row failed before the final drain stop-condition fix with no
  endpoint dispatch, then passed after the scan continued beyond a full
  `maxReadLimit` page.
- Finding: [Docs MEDIUM] delivery/loop/worker `limit` comments and curated API
  docs still described delivery `limit` as a page-size knob.
- Fix: delivery `limit` docs now describe the maximum accepted endpoint work per
  drain plus the initial scan window. `InboxReadOptions.limit` remains
  documented as the page-size control for one ordered inbox read.
- Finding: [Style LOW] `drainMessage()`, `#deliverMessage()`, and the
  stateful active-claim factory were still broad and closure-heavy.
- Fix: split exact-message read/result handling and delivery claim/invoke/mark
  helpers, and replaced the active-claim factory closure with a private
  `ActiveClaim` class.
- Verification: focused Vitest for storage offset plus delivery worker/loop
  passed with 3 files and 72 tests.
  `pnpm --config.verify-deps-before-run=false typecheck:build:generated`
  passed (`tsc -b`), refreshing ignored package `dist` output.
  `pnpm --config.verify-deps-before-run=false docs:check` passed with the
  existing invalid-origin TypeDoc warning only.
  `pnpm --config.verify-deps-before-run=false format:check` passed.
  `git diff --check` passed.

### Round 20 Follow-up - `2026-07-10T09:09:57Z`

- Finding: [Security MEDIUM] in-memory storage canonicalized user objects into
  plain `{}` records and recognized internal `bigint`/`bytes` tags with
  property-name checks, letting user keys collide with normalized internal
  representation and affecting ID/filter/CAS matching.
- Finding: [Style LOW] `Delivery.#drainAvailableMessages` remained over the
  local method-length target, and the exported claim-bearing storage access
  object still needs review as an internal-boundary concern.
- Finding: [Docs LOW] delivery `limit` wording should say accepted delivery
  attempts, including endpoint work and fail-closed validation, and the task
  integration result still referenced Round 18.
- Action: dispatch one fix worker for collision-free storage canonicalization
  regressions, small delivery method/doc cleanup, and durable log updates.
- Fix: in-memory storage normalized user objects into null-prototype records
  with `Object.defineProperty`, moved internal bigint/bytes tags to private
  symbols, and keyed normalized values through a custom kind-aware canonical
  encoder so user keys cannot collide with internal representation.
- Fix: extracted `Delivery.#readPendingDeliveryPage()` from the direct drain
  loop, updated curated delivery `limit` docs to include fail-closed
  validation in accepted delivery attempts, and refreshed the task integration
  result to the Round 19 final state with Round 20 verification pending.
- Evidence: the new storage regression for `__proto__`, `constructor`,
  `prototype`, `bigint`, and `bytes` keys failed before the fix with
  `SyntaxError: Cannot convert bigint:a to a BigInt`, then passed after the
  canonicalizer change.
- Verification: required focused storage/delivery Vitest passed with 2 files
  and 56 tests; generated build typecheck passed; docs check passed with only
  the existing invalid-origin TypeDoc warning; format check passed after
  formatting `tenant-records.ts`; `git diff --check` passed.

### Round 21 Follow-up - `2026-07-10T09:24:24Z`

- Finding: [Reliability MEDIUM] `DeliveryLoop.maxFailures` was checked only
  after an entire `Delivery.drain()`, so the default `maxFailures: 1` could
  still run multiple failing endpoint attempts in one drain.
- Finding: [Docs LOW] user and architecture storage summaries omitted
  `RecordQuery.offset`, and the task brief still had one retry sentence without
  the framework-cleanup success qualifier.
- Finding: [Style MEDIUM/LOW] several `InboxStorage` private methods remain
  over the local method-length target, and the internal claim-bearing storage
  access object remains an exported module-level bridge.
- Action: dispatch one fix worker for failure-budget enforcement, docs, and
  scoped inbox-storage method cleanup without broad internal-access churn.
- Fix: `DeliveryLoop` now validates the configured read limit before running
  and passes each `Delivery.drain()` the smaller of the configured
  accepted-work limit and the remaining failure budget, so the loop cannot
  accept more failing attempts than the budget before returning `FAILED`.
- Fix: user and architecture docs now describe non-negative
  `RecordQuery.offset` support and state that offsets are applied after sorting
  and before limits. The task brief retry sentence now includes the
  framework-owned cleanup success qualifier.
- Fix: split `InboxStorage.#handleStoredGuardMessage()` into private
  guard-finalization and row-repair helpers. `inboxStorageAccess` remains
  unchanged because reducing that exported bridge would require broader
  delivery worker/test call-site churn rather than a scoped method-length
  cleanup.
- Evidence: the new two-row failure-budget regression failed before the fix
  with attempts `["signal-fails-1", "signal-fails-2"]`, then passed after the
  loop capped the drain to the remaining failure budget.
- Verification: required delivery-loop/inbox Vitest passed with 2 files and
  119 tests; generated build typecheck passed; docs check passed with only the
  existing invalid-origin TypeDoc warning; format check passed; diff whitespace
  check passed.

### Round 22 Follow-up - `2026-07-10T09:39:00Z`

- Finding: [Security MEDIUM] unsupported worker labels such as `CATCH_UP`
  stayed public-writeable and were fail-closed as delivery failures, so a
  single `CATCH_UP` row could consume the default loop failure budget and block
  supported rows in the same shard.
- Finding: [Style MEDIUM/LOW] `build-protocol/RUNTIME_ARCHITECTURE.md` still
  exposed row-claim internals; several `InboxStorage` private methods remain
  over the method-length target.
- Finding: [API P3] `packages/server/README.md` omitted
  `RecordQuery.offset` from `queryVersioned()` docs.
- Action: dispatch one fix worker for non-starving unsupported-label handling,
  public architecture wording, server README offset docs, and scoped
  inbox-storage cleanup.
- Fix: `Delivery.drain()` and `drainMessage()` now skip worker-unsupported
  public labels before row acceptance, storage-claiming, or callback
  invocation. Unsupported rows remain pending for future catch-up handling and
  are paged past like unavailable rows, so they do not consume failure budget
  or block supported rows behind them.
- Fix: rewrote the runtime architecture delivery summary with public concepts:
  shard lease fencing, rows unavailable to the active worker, public
  `InboxMessage` snapshots, endpoint callback cleanup failures, and deferred
  stale-row recovery. The server README now documents non-negative
  `RecordQuery.offset` for `queryVersioned()`, applied after sorting and
  before limits.
- Fix: split `InboxStorage.#claimAndWrite()` rollback handling into
  `#rollbackPendingGuard()`. Broader internal-access redesign remains out of
  scope for this scoped method-length cleanup.
- Evidence: the focused `CATCH_UP` regression failed before the fix with
  `accepted: 2` and `failed: 1`, then passed after unsupported labels were
  skipped before acceptance.
- Verification: required delivery Vitest passed with 3 files and 159 tests;
  generated build typecheck passed; docs check passed with only the existing
  invalid-origin TypeDoc warning; format check passed; diff whitespace check
  passed.

### Round 23 Follow-up - `2026-07-10T10:08:00Z`

- Finding: [API/Docs MEDIUM] endpoint callbacks still received a snapshot that
  shared mutable nested state with the internal claimed CAS row, and stale docs
  still described unsupported labels as failure-budget consumers.
- Finding: [Performance MEDIUM] the temporary skipped-row scan budget needed to
  stay finite while still allowing one full storage page of skipped rows before
  accepted endpoint work.
- Fix: `Delivery.drain()` now exposes a cloned public callback snapshot,
  bounds skipped-row scanning to storage read cap plus accepted-work limit, and
  keeps valid worker-unsupported labels pending and skipped rather than failed.
- Evidence: focused delivery regressions covered callback mutation privacy,
  skipped-row scan progression, and finite scan budget; they failed before the
  final adjustments and passed after the fixes.
- Verification: see
  `build-protocol/tasks/T-0026-transport-backed-delivery-workers/round-23-fix-report.md`.
  Required delivery Vitest, generated build typecheck, docs check, format
  check, and `git diff --check` all passed. `docs:check` reported only the
  existing invalid-origin TypeDoc warning.

### Round 24 Follow-up - `2026-07-10T11:22:00Z`

- Finding: [Durability MEDIUM] the external work log and review ledger stopped
  at Round 22, so the durable trail no longer matched the verified Round 23
  state.
- Finding: [API MEDIUM] `DeliveryEndpoint` still admitted full `InboxMessage`,
  so public callback/failure typing still allowed `CATCH_UP` even though the
  worker never invokes endpoints for that label.
- Finding: [Reliability MEDIUM] `InboxStorage` claim CAS rejected any existing
  claim, so expired per-message claims stayed pending forever until some other
  cleanup path ran.
- Finding: [Reliability MEDIUM] pre-callback claim/lease failures were still
  counted as accepted endpoint work, letting them consume the accepted-work
  limit before any callback ran.
- Finding: [Performance MEDIUM] direct drains still chose page size from the
  accepted-work limit, so limit `1` plus many skipped rows degenerated toward
  one inbox query per skipped row.
- Fix: appended missing Round 23 and Round 24 durable trail entries, exported
  `DeliveryEndpointMessage`, narrowed `DeliveryEndpoint` and
  `DeliveryFailure.message`, reclaimed expired claims during claim CAS using
  the storage clock, kept pre-callback failures visible without incrementing
  accepted work, and widened page reads to
  `min(inboxStorageAccess.maxReadLimit, remaining scan budget)` while stopping
  on accepted endpoint work.
- Evidence: new regressions covered expired-claim reclaim on a later drain,
  limit-1 pre-callback failure followed by a second-row delivery in the same
  drain, and bounded query count for one full skipped page plus one accepted
  row. Existing delivery-loop coverage was updated so live claims still leave a
  loop idle while expired claims are reclaimable.
- Verification: see
  `build-protocol/tasks/T-0026-transport-backed-delivery-workers/round-24-fix-report.md`.
  Required delivery Vitest passed with 3 files and 165 tests;
  `typecheck:build:generated` passed; `docs:check` passed after updating the
  expected root export list for `DeliveryEndpointMessage`, still with only the
  existing invalid-origin TypeDoc warning; `format:check` passed; `git diff
--check` passed.

### Round 15 Follow-up - `2026-07-10T07:40:04Z`

- Finding: [Docs MEDIUM] `docs/USER_GUIDE.md` and `docs/api/README.md`
  overpromised retry behavior by saying failed rows stay pending for later
  drains without distinguishing endpoint callback failures from delivery
  marking, fencing, fail-closed validation, or lease failures.
- Finding: [API P3] `DeliveryRun.failed`, `DeliveryFailure.error`, and
  `DeliveryLoopRun.failed` TypeDoc comments only named endpoint or
  delivery-marking failures even though direct delivery can also report
  fail-closed validation and lease/fencing failures.
- Finding: [Security MEDIUM] `inbox-records.ts` read internal `claim` metadata
  through `Reflect.get`, so public write/mark input with an inherited or
  proxy-provided optional field could serialize framework-owned claim metadata
  after public claim checks.
- Fix: narrowed the delivery retry docs to endpoint callback failures and
  documented non-callback delivery failures as returned
  `DeliveryRun.failures` / `DeliveryFailure` values without promising immediate
  retry or recovery policy.
- Fix: broadened `DeliveryRun.failed`, `DeliveryFailure.error`, and
  `DeliveryLoopRun.failed` TypeDoc to include endpoint callback,
  fail-closed validation, lease/fencing, and delivery-status update failures
  without exposing internal claim details.
- Fix: `InboxRecords` now reads optional internal `claim` metadata only from an
  own property. The focused regression covers proxy-provided and inherited
  claim metadata staying out of public record snapshots.
- Evidence: the focused inbox regression failed before the fix with the hidden
  claim present on the serialized snapshot, then passed after the own-property
  check.
- Verification: Round 15 requested focused Vitest passed with 2 files and 137
  tests; `typecheck:build:generated`, `docs:check`, `format:check`, and
  `git diff --check` passed. `docs:check` reported only the existing TypeDoc
  invalid-origin warning.

### Round 16 Follow-up - `2026-07-10T07:52:54Z`

- Finding: [Docs/API MEDIUM] `packages/server/README.md` and
  `build-protocol/DEVELOPER_API.md` still said failed rows remain
  `TO_DELIVER` for later retry without narrowing that guarantee to endpoint
  callback failures.
- Finding: [Docs LOW] the T-0026 task brief status still said
  `implemented; review pending` after review-fix rounds had verified the
  implementation.
- Finding: [Reliability HIGH] `clearActiveClaim()` suppressed
  `inboxStorageAccess.clear()` failures after endpoint or validation failure.
  A row could therefore stay `TO_DELIVER` but durably claimed, making it
  unavailable to later drains while the result implied a retryable endpoint
  failure.
- Action: dispatch one fix worker with the complete docs/status/reliability
  findings, require a focused regression, then rerun all required review lanes.
- Fix: `Delivery.drain()` and `Delivery.drainMessage()` now report active
  claim-clear failures after endpoint or validation failure through the
  returned `DeliveryRun.failures` / `DeliveryFailure.error` path. The reported
  error is an `AggregateError` containing both the original delivery failure and
  the claim-clear failure, so the result no longer implies the row is simply
  ready for immediate retry when cleanup failed.
- Fix: narrowed `packages/server/README.md` and
  `build-protocol/DEVELOPER_API.md` so later-run retry wording applies only to
  endpoint callback failures after row-claim cleanup succeeds. The docs now
  state fail-closed validation, lease/fencing, status-update, and claim-clear
  failures are reported without an immediate retry or recovery guarantee in
  this slice. Updated the T-0026 task status to the current review-fix state.
- Evidence: the focused claim-clear regression failed before the fix because
  the run reported only `Error: endpoint failed`, then passed after the
  delivery catch path surfaced the claim-clear failure.
- Verification: focused delivery Vitest passed with 1 file and 37 tests;
  `typecheck:build:generated`, `docs:check`, rerun `format:check`, and
  `git diff --check` passed. `docs:check` reported only the existing TypeDoc
  invalid-origin warning. `format:check` caught review/work-log Markdown
  wrapping before the final clean rerun.

### Round 17 Follow-up - `2026-07-10T08:06:46Z`

- Finding: [Style/API/Docs MEDIUM] public package and Developer API docs used
  `active row claim` / `claim-clear failures`, and other public API docs did
  not consistently qualify endpoint callback retry with successful
  framework-owned cleanup.
- Finding: [API P2] the public `DeliveryFailure.error` `AggregateError`
  message exposed the internal phrase `inbox claim clear failed`.
- Finding: [API P3] `DeliveryRun.failed` and `DeliveryLoopRun.failed` TypeDoc
  omitted framework-cleanup failures.
- Finding: [Reliability MEDIUM] cleanup returning `undefined` after endpoint
  failure was ignored, so a row could remain unavailable while the run reported
  only the endpoint failure.
- Finding: [Reliability LOW] `DeliveryLoop.maxFailures` accepted any positive
  safe integer, allowing deterministic failures to repeat for an effectively
  unbounded number of drain runs.
- Action: dispatch one fix worker for claim-free public wording,
  cleanup-result reporting, `maxFailures` bounding, tests, and durable logs.
- Fix: changed the public aggregate cleanup error to
  `Delivery failed and framework cleanup failed.`, updated public docs and
  TypeDoc to include framework cleanup failures without claim terminology, and
  made cleanup returning `undefined` aggregate with the original delivery
  failure.
- Fix: capped `DeliveryLoop.maxFailures` at 1000 during construction and
  documented the bound in the option TypeDoc.
- Evidence: focused regressions failed before the fix on the old public error
  message, ignored cleanup `undefined` result, and missing max-failure bound,
  then the focused delivery Vitest batch passed after the fix with 2 files and
  55 tests.
- Verification: focused delivery Vitest rerun, `typecheck:build:generated`,
  `docs:check`, rerun `format:check`, and `git diff --check` passed.
  `docs:check` reported only the existing invalid-origin TypeDoc warning.
  `format:check` caught `delivery-loop.ts` formatting before the final clean
  rerun.

### Round 18 Follow-up - `2026-07-10T08:21:18Z`

- Finding: [Docs/API/Style MEDIUM] `docs/architecture/README.md` still exposed
  row-claim internals and described retry without qualifying successful
  framework cleanup. The task brief scope had the same retry overpromise.
- Finding: [Style LOW] `delivery-loop.ts` placed a supporting constant before
  the primary `DeliveryLoop` declaration, and `requirePositiveSafeIntegerAtMost`
  exceeded the naming component rule.
- Finding: [Style LOW] `inbox-storage.ts` exported standalone
  `requireInboxReadLimit`, violating the grouped-helper preference.
- Finding: [Security MEDIUM] `leaseMs` was only a positive integer, but it is
  used as a Node timer delay. Oversized values can overflow or clamp to `1ms`
  and cause excessive renewal/storage traffic.
- Finding: [Reliability P1] all-unavailable read pages were treated as idle.
  Because `Delivery.drain()` reads a bounded first page, unavailable rows at
  the head of a shard could permanently starve later available rows.
- Action: dispatch one fix worker for claim-free docs, style cleanup, bounded
  lease timing, and bounded scan-through of unavailable pages before the next
  review round.
- Fix: `Delivery.drain()` now uses a bounded growing read window and tracks
  unique rows already observed in the run, so unavailable rows at the head are
  skipped before endpoint invocation while later available rows can still be
  reached without accepting more endpoint work than the configured limit.
- Fix: `leaseMs` is validated as a positive safe integer at most `2147483647`
  before it reaches shard expiry math or delivery renewal timer scheduling.
  `delivery-loop.ts` now keeps supporting constants below the primary class and
  uses the shorter `requireBoundedInteger` helper name. Inbox read-limit
  validation is grouped under the internal `inboxStorageAccess` API instead of
  exporting a standalone helper.
- Fix: architecture and task-brief wording now avoids public row-claim
  mechanics, states unavailable rows are skipped before endpoint invocation,
  names public `InboxMessage` callbacks, qualifies endpoint retry on successful
  framework-owned cleanup, and does not promise immediate recovery for cleanup,
  validation, lease/fencing, or delivery-status failures.
- Evidence: focused regressions failed before the fix because
  `signal-available-tail` was never dispatched behind a claimed head row and
  `leaseMs: 2147483648` was accepted. After the fix, the targeted red tests
  passed, and the focused delivery Vitest batch passed with 4 files and
  199 tests.
- Verification: `typecheck:build:generated` passed (`tsc -b`). `docs:check`
  passed and reported only the existing invalid-origin TypeDoc warning.
  `format:check` initially flagged `delivery-loop.ts`; after formatting that
  file, the final `format:check` passed. `git diff --check` passed.
- Cleanup: removed the exported standalone `requireShardLeaseMs` helper from
  `sharded-work-registry.ts`. Lease validation now stays class-owned inside
  `ShardedWorkRegistry` and `Delivery`, preserving the timer-safe maximum
  without exposing a helper only used by delivery construction.
- Cleanup: split `Delivery.#drainAvailableMessages` by moving per-message
  delivery/accounting into `#tryDrainMessage` and `drainProgress()`, keeping
  the page-scanning method under the 35 LOC style target without changing
  counters or skip behavior.
- Cleanup verification: `typecheck:build:generated`, `format:check`,
  `git diff --check`, and focused delivery Vitest passed on
  `2026-07-10T08:35:29Z`.

### Round 14 Follow-up - `2026-07-10T07:30:12Z`

- Finding: [Docs MEDIUM] `build-protocol/DEVELOPER_API.md` used
  `inspectPendingRows(pending)` in a usage example without defining or
  importing that helper.
- Fix: replaced the helper call with a local `for...of` loop that consumes the
  pending rows inline and logs public message fields, keeping the example
  self-contained.
- Verification: `docs:check`, `format:check`, and `git diff --check` passed.
  `docs:check` reported only the existing TypeDoc invalid-origin warning.

### Round 13 Follow-up - `2026-07-10T07:21:10Z`

- Finding: [Reliability HIGH] `ShardedWorkRegistry.pickUp()` captured `now`
  before the awaited shard read and reused that stale value when deciding
  whether a stored session was still live and when timestamping the replacement
  session. A delayed storage read could therefore miss a lease expiry that
  happened during the read and incorrectly reject the next eligible worker.
- Fix: `pickUp()` still validates the caller clock before opening shard storage,
  then refreshes `now` immediately after `readShardRecord()`/`readSession()` on
  each attempt. The fresh post-read clock now drives both the live-session check
  and `new ShardSession(...)`, matching the existing `renew()` and `release()`
  pattern.
- Evidence: added a delayed-read/clock-advance regression that seeds a live
  stored session, advances the pickup clock across that lease expiry during the
  awaited shard read, and verifies the next worker receives a replacement
  session stamped with the post-read clock. The focused regression failed before
  the fix with `undefined`, then passed after refreshing the pickup clock.
- Verification: requested sharded-registry and delivery-worker Vitest passed
  with 2 files and 78 tests; `typecheck:build:generated`, `docs:check`,
  `format:check`, and `git diff --check` passed. `docs:check` reported only
  the existing TypeDoc invalid-origin warning.

### Round 12 Follow-up - `2026-07-10T07:09:12Z`

- Finding: [Reliability HIGH] after an inbox row was accepted, `Delivery.drain()`
  and `drainMessage()` could invoke the endpoint without first observing an
  in-flight shard renewal or re-checking the shard lease. A slow row acceptance
  could therefore cross lease expiry before endpoint side effects.
- Fix: `Delivery.#deliverMessage()` now awaits any in-flight shard renewal and
  calls `lease.requireActive()` after row acceptance and before endpoint label
  validation or callback invocation. When the re-check fails before the callback,
  the existing cleanup clears the row acceptance and leaves the row pending.
- Evidence: added a focused delayed-acceptance regression that pauses inbox row
  acceptance, advances the delivery clock past shard expiry, and verifies the
  endpoint callback is not invoked and the row remains `TO_DELIVER`.
- Finding: [Docs MEDIUM] the developer API example manually picked up the single
  shard and then called `Delivery.drain()` for the same shard while the manual
  session was still live.
- Fix: updated the example so the low-level pickup/read section releases the
  manual session before the higher-level `Delivery.drain()` and `DeliveryWorker`
  examples.
- Finding: [Docs LOW] public TypeDoc callback comments said `onMessage` was
  invoked once per pending inbox row.
- Fix: reworded callback comments in `delivery.ts`, `delivery-loop.ts`, and
  `delivery-worker.ts` to say the callback is invoked for each available
  supported worker row.
- Verification: requested delivery Vitest passed with 3 files and 152 tests;
  `typecheck:build:generated`, `docs:check`, `format:check`, and
  `git diff --check` passed. `docs:check` reported only the existing TypeDoc
  invalid-origin warning.

### Round 11 Follow-up - `2026-07-10T06:55:21Z`

- Finding: [Security MEDIUM] `Delivery.drain()` picked up and released shard
  storage before validating an invalid or oversized `options.limit`, so a bad
  direct-drain request could mutate shard storage before failing at the inbox read
  boundary.
- Fix: `Delivery.drain()` now validates `options.limit` at method entry with the
  same bounded inbox page-size helper used by inbox reads. The helper keeps the
  positive safe integer and `1000` upper-bound contract in one place.
- Evidence: added a focused regression proving an invalid direct-drain limit
  rejects before any storage open or compare-and-set through the shard registry.
  It failed before the fix with two storage opens, then passed after early
  validation.
- Finding: [API docs MEDIUM] public docs listed `DeliveryLoopRun` but did not
  document its `status`, `runs`, `processed`, `accepted`, `delivered`, `failed`,
  and `failures` fields.
- Fix: updated `docs/api/README.md` and `build-protocol/DEVELOPER_API.md` with
  claim-free prose stating that `DeliveryLoopRun` aggregates `DeliveryRun` counts
  across loop drains and naming each public field.
- Verification: requested Vitest passed with 4 files and 192 tests;
  `typecheck:build:generated`, `docs:check`, `format:check`, and
  `git diff --check` passed. `docs:check` reported only the existing TypeDoc
  invalid-origin warning.

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
