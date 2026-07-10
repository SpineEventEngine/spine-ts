# T-0026 Review Log

Status: Round 41 fixes verified; coordinator commit and re-review pending

Task: `T-0026 Transport-Backed Delivery Workers`

Branch: `task/T-0026-transport-backed-delivery-workers`

## Required Review Lanes

| Lane                       | Reviewer | Status |
| -------------------------- | -------- | ------ |
| Code style/maintainability | Raman    | Fixed  |
| Documentation              | Socrates | Fixed  |
| TypeScript/API docs        | James    | Fixed  |
| Security                   | Averroes | Fixed  |
| Performance/reliability    | Beauvoir | Fixed  |

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

### Round 41 Follow-up - `2026-07-10T17:05:00Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..9e831767.diff` from task baseline
  `ca8fb2b3` to current HEAD `9e831767`.
- Code style/maintainability (Raman): [P1] `round-40-fix-report.md` lines 5-6
  have Markdown hard-break trailing spaces, so
  `git diff --check ca8fb2b3..HEAD` fails while the report says the diff check
  passed.
- Documentation (Socrates): [P1] same false verification breadcrumb.
- TypeScript/API docs (James): [P1] same false verification breadcrumb;
  TypeScript/API surface otherwise looks sound.
- Security (Averroes): [P1] the root-exported `DeliveryWorker` accepts an
  arbitrary `onMessage` callback, exposing a raw inbox dispatcher path that can
  bypass the framework replay validation boundary.
- Performance/reliability (Beauvoir): [P1] same range whitespace failure; [P2]
  partial stale-head rescans can degrade to one inbox query per already-seen
  skipped row because seen-row observation does not advance the scan budget.
- Action: fix the range whitespace, repair the public worker callback boundary,
  preserve bounded page behavior during partial stale-head rescans, add focused
  regression coverage, verify, and repeat five-lane re-review.

### Round 41 Fix Implementation - `2026-07-10`

- Removed the `DeliveryWorker`, `DeliveryWorkerOptions`, and `DeliveryWorkerRun`
  root exports. The raw callback boundary is now package-internal; public
  context handoffs continue to replay through validated framework endpoints.
- Removed all public docs/API export-check references to that worker surface.
- Removed the two Markdown hard-break spaces from the Round 40 fix report.
- Added a `limit: 1` partial stale-head regression. Before the production fix,
  one skipped head row disappearing caused 1004 inbox queries. `Delivery` now
  grants its single offset rescan one bounded page allowance for already-seen
  rows while still refusing new rows past the finite scan budget; the regression
  passes with five queries and the moved supported row delivered.
- Verification passed: focused red/green regression; prescribed five-file
  delivery Vitest command with 194 tests; generated typecheck; docs/API check;
  lint; format; and working-tree `git diff --check`. `docs:check` retained only
  the existing invalid-origin TypeDoc source-link warning.
- `git diff --check ca8fb2b3..HEAD` remains red because the repaired whitespace
  is in current committed HEAD. This worker made no commit; coordinator commit
  and a fresh range check are required before re-review.

### Round 40 Follow-up - `2026-07-10T16:48:00Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..faa2d814.diff` from task baseline
  `ca8fb2b3` to current HEAD `faa2d814`.
- TypeScript/API docs (Hooke): clean.
- Security (Halley): clean.
- Code style/maintainability (Anscombe): [P2] review/work logs still describe
  the Round 39 records-only fix as future/pending after commit `faa2d814`.
- Documentation (Carver): [P2] same stale Round 39 status.
- Performance/reliability (Bernoulli): [P1] offset pagination can still skip
  deliverable rows when only part of the skipped head set disappears after
  boundary validation and the stale offset page remains full/non-empty.
- Action: update Round 39 status records and fix the partial-disappearance
  offset race with focused regression coverage before another five-lane
  re-review.

### Round 40 Fix Implementation - `2026-07-10`

- Updated stale Round 39 status records to state that the records-only cleanup
  was verified and committed as `faa2d814` (`Record delivery round 39 review
status`).
- Added a focused full stale-offset-page regression. It removes a complete
  skipped head page after the pre-read boundary validation, leaves a full stale
  offset page of unsupported filler, and proves the shifted supported row is
  delivered in the same `DeliveryLoop.run()`.
- `Delivery.#drainAvailableMessages()` now revalidates an offset boundary after
  reading the page and, on movement, discards the page and performs its one
  bounded head rescan before any page rows are processed.
- Updated the intentional inbox-query count in the bounded-paging test from
  three to four for the post-read boundary validation.
- Verification passed: focused regression red then green; focused delivery
  worker/loop/inbox Vitest with 3 files and 178 tests;
  `typecheck:build:generated`, `docs:check`, `lint`, and `format:check`.
  `docs:check` retained only the existing invalid-origin TypeDoc source-link
  warning.
- No commit was created by this worker. Coordinator commit: `9c51b77a`
  (`Fix delivery stale offset page rescan`).

### Round 39 Follow-up - `2026-07-10T16:40:00Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..7927c4d3.diff` from task baseline
  `ca8fb2b3` to current HEAD `7927c4d3`.
- TypeScript/API docs (Peirce): clean.
- Security (Gauss): clean.
- Performance/reliability (Tesla): clean.
- Code style/maintainability (Laplace): [P2] review-log status/table still
  showed Round 38 findings pending after commit `7927c4d3`; work-log summary
  still said the Round 38 fix was pending.
- Documentation (Sartre): [P2] same stale Round 38 status; [P3] Round 37
  report's coordinator breadcrumb should name `1403505e`.
- Action: update status/breadcrumb records and rerun format/diff checks before
  another five-lane re-review.

### Round 39 Fix Implementation - `2026-07-10`

- Updated the review-log status/table and work-log summary so Round 38's
  records-only cleanup is no longer marked pending.
- Updated the Round 37 report's coordinator breadcrumb to name `1403505e`
  (`Fix delivery offset boundary race`).
- Verification passed: `format:check` and `git diff --check`.
- Coordinator commit: `faa2d814` (`Record delivery round 39 review status`).

### Round 38 Follow-up - `2026-07-10T16:31:00Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..1403505e.diff` from task baseline
  `ca8fb2b3` to current HEAD `1403505e`.
- TypeScript/API docs (Copernicus): clean.
- Security (Popper): clean.
- Performance/reliability (Jason): clean.
- Code style/maintainability (Planck): [P2] Round 37 report says no commit was
  created even though coordinator commit `1403505e` records the fix.
- Documentation (Ohm): [P2] same Round 37 commit-note issue; [P3] Round 29 and
  Round 30 reports still say coordinator commits are pending even though their
  durable breadcrumbs are known.
- Action: update the commit notes and rerun format/diff checks before another
  five-lane re-review.

### Round 38 Fix Implementation - `2026-07-10`

- Updated Round 37 report/task/work/review records so they say the fix worker
  created no commit and coordinator commit `1403505e`
  (`Fix delivery offset boundary race`) recorded the verified fix.
- Updated Round 29 and Round 30 reports with their resolved coordinator commit
  breadcrumbs: `fd563047` and `8a65e2b6`.
- Verification passed: `format:check` and `git diff --check`.

### Round 37 Follow-up - `2026-07-10T16:15:00Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..e4388fb5.diff` from task baseline
  `ca8fb2b3` to current HEAD `e4388fb5`.
- TypeScript/API docs (Locke): clean.
- Security (Nietzsche): clean.
- Code style/maintainability (Russell): [P2] Round 35 and Round 36 fix reports
  still say coordinator commits are pending even though commits `5c3705e2` and
  `e4388fb5` exist.
- Documentation (Hume): [P2] same stale Round 35/Round 36 commit breadcrumbs;
  [P2] older Round 24/25 durable reclaim wording should be marked as
  superseded by Round 35's no-reclaim contract.
- Performance/reliability (Kant): [P2] moving `TO_DELIVER` pagination can
  still falsely idle if skipped head rows disappear after boundary validation
  but before the offset page read.
- Action: apply one fix for breadcrumbs, historical reclaim wording, and the
  boundary/read race; rerun focused verification; repeat five-lane re-review.

### Round 37 Fix Implementation - `2026-07-10`

- Durable breadcrumb cleanup: Round 35 report/task/work/review records now name
  coordinator commit `5c3705e2` (`Fix delivery claim blocking and offset
rescan`), and Round 36 report/task/work/review records now name coordinator
  commit `e4388fb5` (`Fix delivery review gate cleanup`).
- Historical reclaim cleanup: Round 24/25 task, work, review, and fix-report
  reclaim statements are marked as historical and superseded by Round 35 /
  `5c3705e2`. Current contract: expired and live row claims both block
  competing delivery until future explicit recovery policy exists.
- Reliability fix: added a regression for a skipped head page disappearing
  after pending-boundary validation but before offset-page read. The red run
  returned `IDLE` with `delivered: 0`; after the fix,
  `Delivery.#drainAvailableMessages()` revalidates the boundary after a short
  zero-work offset page and performs one bounded head rescan when it moved.
- Verification passed: focused delivery worker/loop/runtime/inbox/shard-registry
  Vitest passed with 5 files and 224 tests; `typecheck:build:generated`,
  `docs:check`, `lint`, `format:check`, and `git diff --check` passed.
  `docs:check` retained only the existing invalid-origin TypeDoc source-link
  warning. No commit was created, per Round 37 instruction.
- Coordinator verification at `2026-07-10T16:22:00Z` passed the focused
  boundary/read race regression, the focused delivery batch with 5 files and
  224 tests, `typecheck:build:generated`, `docs:check`, `lint`,
  `format:check`, and `git diff --check`.
- Fix commit: `1403505e` (`Fix delivery offset boundary race`).

### Round 36 Follow-up - `2026-07-10T16:05:00Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..5c3705e2.diff` from task baseline
  `ca8fb2b3` to current HEAD `5c3705e2`.
- Documentation (Bohr): clean.
- TypeScript/API docs (Fermat): clean.
- Security (Banach): clean.
- Performance/reliability (Dirac): clean.
- Code style/maintainability (Descartes): [P1] `format:check` fails on
  `round-35-fix-report.md`; [P1] `lint` fails on unused `_claim`
  destructuring in `delivery-loop.test.ts` and `delivery-worker.test.ts`, plus
  a `let delivery` local in `delivery-worker.test.ts` that can be `const`.
- Action: apply one style/lint fix, rerun lint/format and focused checks, then
  repeat five-lane re-review.

### Round 36 Fix Implementation - `2026-07-10`

- Formatted `round-35-fix-report.md` and the touched T-0026 logs.
- Replaced ignored `claim` destructuring in delivery test helpers with explicit
  claim-free `InboxMessage` snapshots.
- Changed the moving pending-set regression's delivery local from `let` to
  `const`.
- Verification passed: `lint`, `format:check`, focused delivery Vitest with 5
  files and 223 tests, and `git diff --check`.
- Fix commit: `e4388fb5` (`Fix delivery review gate cleanup`).

### Round 35 Follow-up - `2026-07-10T14:47:00Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..7a5378eb.diff` from task baseline
  `ca8fb2b3` to current HEAD `7a5378eb`.
- TypeScript/API docs (Pascal): clean.
- Documentation (Faraday): [P2] Round 34 verification records should name fix
  commit `7a5378eb` (`Fix delivery tooling typecheck`), and the Round 34 fix
  report still says no commit was created.
- Code style/maintainability (Lovelace): [P1] `format:check` currently fails
  on `round-34-fix-report.md`; apply Prettier formatting before accepting the
  verification record.
- Security (Gibbs): [P1] expired row-claim reclaim can double-invoke endpoint
  callbacks. Treat any existing row claim as unavailable until a future
  abandoned-claim recovery policy can prove recovery is safe.
- Performance/reliability (Dewey): [P2] absolute offset paging can falsely idle
  when skipped head rows disappear during one drain page sequence. Avoid
  reading later pages by an offset that is relative to a moving `TO_DELIVER`
  set.
- Action: dispatch one fix worker for the complete Round 35 batch, with
  focused red/green regressions for the claim and pagination behavior, report
  formatting, durable Round 34 commit trace, verification, and another
  five-lane re-review.

### Round 35 Fix Implementation - `2026-07-10`

- Added focused red regressions before production edits. The expired-claim
  regression failed because `signal-expired-claim` was invoked, and the moving
  pending-set regression failed because `signal-reachable-tail` was skipped
  when the unavailable head rows disappeared between page reads.
- `InboxStorage` now treats any existing row claim as unavailable, including
  expired claims. Abandoned-claim recovery remains a future explicit policy
  because the earlier owner may still be inside `onMessage`.
- `Delivery` now validates the pending boundary before reading an offset page.
  If skipped rows disappeared and the boundary no longer matches, the drain
  resets to the head once and continues inside the same scan budget rather than
  paging or idling past reachable supported work.
- Updated expired-claim and paused-loop tests to use explicit claim recovery
  where recovery is intended, and added a query hook to the delivery storage
  fault fixture for moving pending-set regressions.
- Coordinator refinement moved the pending-boundary check before all offset
  page reads and refreshed public docs plus the `InboxClaim` comment to state
  that expired and live ownership both block competing delivery in this slice.
- Round 34 durable trace now names fix commit `7a5378eb`
  (`Fix delivery tooling typecheck`), and `round-34-fix-report.md` is
  Prettier-formatted.
- Fix-worker verification passed: focused delivery worker/loop/runtime/inbox/
  shard-registry Vitest passed with 5 files and 223 tests;
  `typecheck:build:generated`, `docs:check`, `format:check`, and
  `git diff --check` passed. `docs:check` reported only the existing invalid
  `origin` TypeDoc source-link warning.
- No commit was created by the fix worker, per Round 35 instruction.
  Coordinator commit `5c3705e2` (`Fix delivery claim blocking and offset
rescan`) later recorded this fix.

### Round 27 Follow-up - `2026-07-10T11:55:46Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..599d6bcf.diff` from task baseline
  `ca8fb2b3` to current HEAD `599d6bcf`.
- Code style/maintainability (Einstein): clean; retained the existing
  non-blocking note that `FaultyDeliveryRecordStorage.compareAndSetRecord()` is
  a broad but contained test-only fault-injection helper.
- Performance/reliability (Heisenberg): clean.
- TypeScript/API docs (Hubble): [Minor] `DeliveryEndpointMessage.label`
  references non-exported `DeliveryEndpointLabel`, making the supported
  endpoint-label union less navigable in TypeDoc. Inline the union or export
  and document the label type with API coverage.
- Documentation (Euclid): [Important] broader guides under-specify direct-drain
  accounting: `limit` caps endpoint callbacks, scanning is bounded by
  `maxReadLimit + limit`, and skipped/unsupported rows plus pre-callback
  failures do not consume accepted work or failure budget. Final contract
  correction: skipped/unsupported rows avoid failure-budget consumption;
  pre-callback failures leave `accepted` unchanged but increment `failed` and
  count toward `DeliveryLoop.maxFailures`. [Minor] historical Round 24 notes
  name `DeliveryEndpoint` without saying it was later renamed to
  `OnDeliveryMessage`.
- Security (Cicero): [Important] `Delivery` retains a caller-owned
  `StorageContext` and rereads tenant state across awaited endpoint callbacks,
  so tenant mutation during a drain can split claim/renew/mark/release across
  tenants. [Important] `DeliveryLoop.run()` has finite per-drain scanning but no
  aggregate run/scan bound, so continuous unsupported writes can keep one
  invocation scanning indefinitely.
- Action: dispatch one fix worker for the complete Round 27 batch with TDD red
  evidence for the behavior bugs, docs/API-log cleanup for the documentation
  findings, focused verification, and another five-lane re-review.

### Round 27 Fix Implementation - `2026-07-10`

- Added focused red regressions before production code:
  `delivery-worker.test.ts` failed because a multitenant context flip during an
  awaited callback changed drain follow-up storage to another tenant, and
  `delivery-loop.test.ts` failed because skipped-only drains kept repeating
  until the test seam threw.
- Delivery drains now snapshot and validate one immutable storage context at
  drain start, then use that snapshot for shard pickup/renew/release plus inbox
  reads, claims, dedup updates, cleanup, and delivery marking throughout the
  drain.
- `DeliveryLoop.run()` now returns `PAUSED` after two saturated skipped-only
  drains, preserving the scan offset for a later `run()` instead of letting one
  invocation keep scanning unsupported rows indefinitely.
- Public docs now state the direct-drain accounting contract in the broader
  package, architecture, user, and API guides. `DeliveryEndpointMessage.label`
  now inlines its supported-label union for clearer TypeDoc output. Historical
  Round 24 notes now mention the later `OnDeliveryMessage` rename.
- Fix-worker verification passed: focused delivery/API Vitest passed with 5
  files and 222 tests; `typecheck:build:generated`, `docs:check`,
  `format:check`, and `git diff --check` passed. `docs:check` reported only the
  existing invalid-origin TypeDoc source-link warning.
- Fix commit: `770981ea` (`Fix delivery drain tenant scope and loop bounds`).

### Round 28 Follow-up - `2026-07-10T12:22:12Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..0dd1bfdf.diff` from task baseline
  `ca8fb2b3` to current HEAD `0dd1bfdf`.
- TypeScript/API docs (Meitner): [Important] `DeliveryWorkerRun.status` hides a
  paused shard when another shard is skipped because `workerStatus()` checks
  `SKIPPED` before `PAUSED`; preserve the resumable `PAUSED` signal in worker
  aggregation and add type/runtime coverage.
- Code style/maintainability (Helmholtz): [Important] `deliveryAccess.drain()`
  silently falls back to public `Delivery.drain()` for non-owned instances,
  unlike the repo's other access helpers, and the paused-loop test uses such a
  fake so it does not exercise loop-only controls. [Important] the
  delivery-worker fault-injection harness has grown into one broad mutable test
  fixture and should be split by concern or moved to a dedicated fixture module.
  [Minor] `maxDeliveryLoopLimit` duplicates `inboxStorageAccess.maxReadLimit`.
- Documentation (Chandrasekhar): [Important] Round 27 docs incorrectly say
  pre-callback failures do not consume loop failure budget; they do not
  increment `accepted`, but they do increment `failed` and count toward
  `DeliveryLoop.maxFailures`. [Important] docs blur fail-closed legacy
  corruption into returned `DeliveryRun.failures`; malformed/deprecated stored
  rows such as legacy `IMPORT_EVENT` fail read/drain outright with
  `DeliveryStorageCorruptionError`.
- Security (Noether): [Important] same-event-loop shard/claim renewal can be
  starved by CPU-bound or synchronous endpoint callbacks; this may require
  explicit trust-boundary adjudication because JavaScript cannot preempt a
  blocking callback in the same process. [Important] `workerStatus()` hides
  `PAUSED` behind `SKIPPED`, overlapping Meitner's finding.
- Performance/reliability (Archimedes): [Important] the `PAUSED` resume path
  persists a raw absolute `scanOffset`; if earlier skipped rows disappear
  between runs, a resumed run can skip a now-reachable supported row. Use a
  stable cursor or reset when the cursor no longer matches the pending set, and
  add a regression.
- Action: dispatch one fix worker for the complete Round 28 batch. The worker
  must update durable logs, use focused red evidence for behavior fixes, and
  either implement or explicitly adjudicate the same-event-loop callback renewal
  finding with code/docs evidence.

### Round 28 Fix Implementation - `2026-07-10`

- Added focused red regressions before production edits: the paused-loop resume
  regression idled with `delivered: 0` after earlier skipped rows disappeared,
  the internal access regression called the fake public `drain()` instead of
  failing fast, and mixed loop outcomes hid `PAUSED` behind `SKIPPED`.
- Replaced raw paused-loop offset reuse with an internal pending-boundary
  resume cursor recorded on `DeliveryRun` metadata and validated against the
  current pending set before reuse. When the boundary no longer matches, the
  loop safely resets and rescans from the head instead of skipping shifted
  supported rows.
- `DeliveryWorker` aggregation now preserves `PAUSED` over `SKIPPED`.
  `deliveryAccess.drain()` now throws for non-owned instances and exposes
  package-local owned-instance helpers used by runtime/loop tests.
- Split the delivery-worker storage fault fixture into dedicated
  `delivery-storage-fault-fixture.ts` helpers and removed the duplicate
  loop read-cap constant in favor of `inboxStorageAccess.maxReadLimit`.
- Broader docs now state the correct accounting contract: skipped unsupported
  rows do not consume failure budget; pre-callback claim/validation/lease/
  cleanup/status-update failures do count toward `failed` /
  `DeliveryLoop.maxFailures` while leaving `accepted` unchanged. Legacy stored
  `IMPORT_EVENT` rows are documented as `DeliveryStorageCorruptionError`
  aborts before any `DeliveryRun` is returned.
- Adjudication: same-event-loop renewal remains a trust-boundary limitation.
  Code evidence is unchanged: renewal is timer-driven (`keepShardLease()`), and
  callbacks run inline in `#invokeEndpoint()` on the same event loop, so a
  CPU-bound synchronous callback can still starve renewal because JavaScript
  cannot preempt it. The docs now say this plainly instead of implying timer
  renewal protects blocked in-process callbacks.
- Fix commit: `0c622787` (`Fix delivery loop resume and worker status`).

### Round 29 Follow-up - `2026-07-10T12:53:31Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..5e17283b.diff` from task baseline
  `ca8fb2b3` to current HEAD `5e17283b`.
- TypeScript/API docs (Mendel): clean.
- Security (Carson): clean.
- Documentation (Pasteur): [Medium] historical Round 27 summaries in
  `round-27-fix-report.md` and `work-logs/T-0026.md` still say pre-callback
  failures do not consume loop failure budget. Add an explicit correction that
  only skipped unsupported rows avoid failure-budget consumption; pre-callback
  failures increment `failed`/`DeliveryLoop.maxFailures` while leaving
  `accepted` unchanged.
- Code style/maintainability (Confucius): [Important] the `PAUSED`/resume path
  is still implicit because `DeliveryLoop` infers skipped-scan exhaustion from
  public counters and fetches the resume cursor through `DeliveryRun` WeakMap
  metadata. Return an explicit package-local internal drain result instead.
  [Important] the new delivery-storage fault fixture is still one broad mutable
  protocol; expose scenario-focused helpers or narrower plans so tests do not
  couple to ambient fixture state.
- Performance/reliability (Schrodinger): [High] mixed success/failure drains
  can preserve a cursor past a failed pending row and later return `IDLE` while
  that row remains retryable. Clear resume state after any failed run or prevent
  cursors from advancing past failed rows, and add a regression for
  `maxFailures: 2` with a failed row followed by a successful row.
- Action: dispatch one fix worker for the complete Round 29 batch with focused
  red evidence for the mixed fail/success starvation case, explicit internal
  drain result refactoring, fixture helper cleanup, docs corrections, and
  focused verification before another five-lane re-review.

### Round 29 Fix Implementation - `2026-07-10`

- Added the required red regression first:
  `pnpm --config.verify-deps-before-run=false exec vitest run
packages/server/test/delivery/delivery-loop.test.ts -t "retries a failed
head row before going idle after a later success"` failed before production
  edits because the loop attempted only `["signal-fails",
"signal-succeeds"]` and then returned idle.
- `Delivery` now owns an explicit package-local `DeliveryDrainOutcome`
  contract for loop-only state. Each drain returns
  `{ run, resumeCursor, exhaustedSkippedScan }` and reports skipped-scan
  exhaustion directly instead of hiding resume state in public counters or
  metadata. Failed drain outcomes omit the resume cursor, so `DeliveryLoop`
  cannot persist cursor state past retryable failed rows.
- The delivery storage fault fixture is now a coherent probe-based helper
  module. Delivery worker tests arm scenario-focused helpers such as
  `blockInboxClaimOnce()`, `throwInboxClearOnce()`, and
  `skipDedupFinalizeOnce({ armed: false })` instead of mutating one ambient
  plan object.
- Historical docs were corrected: `round-27-fix-report.md` and the work log now
  say only skipped unsupported rows avoid failure-budget consumption; pre-
  callback claim/validation/lease/cleanup/status-update failures still
  increment `failed` / `DeliveryLoop.maxFailures` while leaving `accepted`
  unchanged.
- Fix-worker verification passed:
  `delivery-worker.test.ts`, `delivery-loop.test.ts`,
  `delivery-worker-runtime.test.ts`, `inbox.test.ts`,
  `sharded-work-registry.test.ts`, and `index.test.ts` passed with 230 tests;
  `typecheck:build:generated`, `docs:check`, `format:check`, and
  `git diff --check` passed. `docs:check` reported only the existing invalid
  `origin` source-link warning.
- Coordinator verification at `2026-07-10T13:14:12Z` passed the same focused
  delivery/API Vitest batch with 6 files and 230 tests, plus
  `typecheck:build:generated`, `docs:check`, `format:check`, and
  `git diff --check`. `docs:check` retained only the existing invalid `origin`
  source-link warning.
- Fix commit: `fd563047` (`Fix delivery drain resume outcome`).

### Round 30 Follow-up - `2026-07-10T13:20:32Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..fd563047.diff` from task baseline
  `ca8fb2b3` to current HEAD `fd563047`.
- Documentation (Avicenna): clean.
- Security (Lagrange): clean.
- Performance/reliability (Newton): clean.
- TypeScript/API docs (Harvey): [Minor]
  `DeliveryWorkerOptions.maxFailures` documents that failures stop a worker
  loop but omits the default and cap that callers see through `DeliveryLoop`:
  default `1`, capped at `1000`. Mirror the `DeliveryLoopOptions.maxFailures`
  wording in `delivery-worker.ts`.
- Code style/maintainability (Ampere): [P3]
  `delivery-storage-fault-fixture.ts` still opens with exported support and
  protocol types before the scenario API. Move `deliveryStorageFaults()` and
  the named probe helpers to the top of the module, and keep purely internal
  helpers such as the deferred type private where possible so the file reads
  probe-first.
- Action: dispatch one compact fix worker for the complete Round 30 batch,
  then run focused verification and another five-lane re-review.

### Round 30 Fix Implementation - `2026-07-10`

- Updated `DeliveryWorkerOptions.maxFailures` TypeDoc so it mirrors the
  `DeliveryLoopOptions.maxFailures` default/cap wording: default `1`, capped at
  `1000`.
- Reordered `delivery-storage-fault-fixture.ts` so `deliveryStorageFaults()`
  and the named scenario probe helpers appear before internal support/protocol
  types and wrapper classes. Existing public fixture helper names were
  preserved, and the fixture-local `Deferred<T>` helper type is now private.
- Fix-worker verification passed: focused delivery worker/loop/runtime Vitest
  passed with 3 files and 77 tests; `typecheck:build:generated`, `docs:check`,
  final `format:check`, and `git diff --check` passed. `docs:check` reported
  only the existing invalid `origin` source-link warning.
- Coordinator verification at `2026-07-10T13:28:38Z` passed the same focused
  delivery worker/loop/runtime Vitest batch with 3 files and 77 tests, plus
  `typecheck:build:generated`, `docs:check`, `format:check`, and
  `git diff --check`. `docs:check` retained only the existing invalid `origin`
  source-link warning.
- Fix commit: `8a65e2b6` (`Polish delivery worker docs and fault fixture`).

### Round 31 Follow-up - `2026-07-10T13:35:21Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..8a65e2b6.diff` from task baseline
  `ca8fb2b3` to current HEAD `8a65e2b6`.
- Code style/maintainability (Aquinas): clean.
- TypeScript/API docs (McClintock): clean.
- Security (Parfit): clean.
- Documentation (Rawls): [Medium] the Round 27 documentation finding in this
  review log still records the stale phrase that skipped/unsupported rows plus
  pre-callback failures do not consume accepted work or failure budget without
  an inline correction. Qualify that historical finding with the final
  contract: skipped/unsupported rows avoid failure-budget consumption, while
  pre-callback failures leave `accepted` unchanged but increment `failed` and
  count toward `DeliveryLoop.maxFailures`. [Low] Round 30 verification records
  should also tie the fix to commit `8a65e2b6` for the durable trace.
- Performance/reliability (Galileo): [P2] resume cursor validation can still
  report `IDLE` while a reachable supported row remains before the cursor. If
  prefix churn preserves the boundary row at `offset - 1`, the resumed drain
  starts after the cursor and can idle after missing newly reachable work before
  it. Add a regression and either rescan from head before returning `IDLE` after
  a resumed zero-work drain or strengthen validation. [P3] `#resolveDrainCursor`
  reads inbox state before shard pickup, so a live-owned shard can do
  unnecessary storage work or throw boundary corruption before returning the
  expected `SKIPPED`; pick up the shard before resume-cursor validation.
- Action: dispatch one fix worker for the complete Round 31 batch, with red
  reliability evidence, log-only documentation corrections, focused
  verification, and a fresh five-lane re-review.

### Round 31 Fix Implementation - `2026-07-10`

- Added the required red regression first:
  `delivery-loop.test.ts -t "rescans before going idle after a resumed zero-work drain"`
  failed because a resumed run returned `IDLE` with `delivered: 0` after a
  live-claimed supported head row became reachable while the saved boundary row
  remained valid.
- `Delivery.#drain()` now picks up the shard before internal resume-cursor
  validation, so live-owned shards return `SKIPPED` before inbox boundary reads.
- `Delivery.#drainAvailableMessages()` now performs one bounded head rescan
  when a resumed cursor reads zero pending rows after the cursor, preserving
  finite scan behavior while preventing the loop from idling past reachable
  supported work before the cursor.
- The older Round 27 documentation finding in this review log now records the
  final accounting contract: skipped/unsupported rows avoid failure-budget
  consumption; pre-callback failures leave `accepted` unchanged but increment
  `failed` and count toward `DeliveryLoop.maxFailures`.
- Round 30 verification traces in the task, work, and review logs name commit
  `8a65e2b6` (`Polish delivery worker docs and fault fixture`).
- Fix-worker verification passed: focused delivery/API Vitest passed with 6
  files and 232 tests; `typecheck:build:generated`, `docs:check`,
  `format:check`, and `git diff --check` passed. `docs:check` reported only
  the existing invalid `origin` source-link warning.
- Coordinator inspection found the initial rescan fix only covered zero rows
  after the saved cursor. The coordinator extended the regression with a
  skipped tail row after the cursor and tightened resumed-drain finalization to
  rescan the head before any non-exhausted zero-accepted/zero-failed resumed
  finish.
- Coordinator verification at `2026-07-10T13:47:56Z` passed the focused Round
  31 pair with 1 file and 2 tests, the required focused delivery/API Vitest
  batch with 6 files and 232 tests, `typecheck:build:generated`, `docs:check`,
  `format:check`, and `git diff --check`. `docs:check` retained only the
  existing invalid `origin` source-link warning.
- Fix commit: `a06e3749` (`Fix delivery resume cursor rescan`).

### Round 32 Follow-up - `2026-07-10T13:54:16Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..a06e3749.diff` from task baseline
  `ca8fb2b3` to current HEAD `a06e3749`.
- TypeScript/API docs (Dalton): clean.
- Security (Ramanujan): clean.
- Performance/reliability (Darwin): clean.
- Code style/maintainability (Leibniz): [P1] the branch fails the repository
  lint gate. `pnpm --config.verify-deps-before-run=false lint:generated`
  reaches ESLint and reports 35 errors on changed T-0026 files, including
  unsafe returns/spreads in delivery worker/status code, throwing `unknown`,
  unused imports in delivery tests/fixtures, and unsafe assignments in memory
  storage. Fix the lint gate before calling the round clean.
- Documentation (Franklin): [P2] Round 31 is not tied to fix commit
  `a06e3749` (`Fix delivery resume cursor rescan`) in the durable task, work,
  review, and Round 31 report records. Add the same fix-commit breadcrumb used
  by earlier rounds.
- Action: reproduce lint output locally, dispatch one fix worker for the
  complete Round 32 batch, rerun lint plus focused verification, and repeat
  five-lane re-review.

### Round 32 Fix Implementation - `2026-07-10`

- Reproduced `pnpm --config.verify-deps-before-run=false lint:generated`
  locally before code edits; it failed with the same 35 ESLint errors reported
  by the coordinator.
- Applied lint-safe cleanup only: removed unused imports/type parameters,
  replaced unnecessary assertions, made claim-stripping helpers build explicit
  claim-free snapshots, normalized non-`Error` lease renewal failures before
  throwing, and tightened memory-storage normalized-value typing.
- Confirmed the Round 31 task, work, review, and Round 31 report records
  already name fix commit `a06e3749` (`Fix delivery resume cursor rescan`) in
  the current Round 32 intake diff.
- Fix-worker verification passed: `lint:generated`; focused delivery/storage
  Vitest batch with 7 files and 248 tests; `typecheck:build:generated`;
  `docs:check`; `format:check`; and `git diff --check`. `docs:check` reported
  only the existing invalid `origin` source-link warning.
- Coordinator verification at `2026-07-10T14:08:41Z` passed
  `lint:generated`, the same focused delivery/storage Vitest batch with 7
  files and 248 tests, `typecheck:build:generated`, `docs:check`,
  `format:check`, and `git diff --check`. `docs:check` retained only the
  existing invalid `origin` source-link warning.
- Fix commit: `a66ab6b5` (`Fix delivery lint gate`).

### Round 33 Follow-up - `2026-07-10T14:16:16Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..a66ab6b5.diff` from task baseline
  `ca8fb2b3` to current HEAD `a66ab6b5`.
- TypeScript/API docs (Hegel): clean.
- Security (Volta): clean.
- Performance/reliability (Lorentz): clean.
- Documentation (Bacon): [P2] Round 32 is not tied to fix commit `a66ab6b5`
  (`Fix delivery lint gate`) in the durable task, work, review, and Round 32
  report records. Add the same fix-commit breadcrumb used by earlier rounds.
- Code style/maintainability (Huygens): [P1] `format:check` fails on the Round
  32 fix report table. Apply Prettier formatting so the reported `format:check`
  pass is true for the current checkout.
- Action: apply one log/format fix for both Round 33 findings, rerun
  `format:check`, `git diff --check`, and focused verification, then repeat
  five-lane re-review.

### Round 33 Fix Implementation - `2026-07-10`

- Added the Round 32 fix-commit breadcrumb:
  `a66ab6b5` (`Fix delivery lint gate`) in the task, work, review, and Round 32
  report records.
- Ran Prettier over the repository; the Round 32 report table is now formatted.
- Verification passed: `format:check`, `git diff --check`, and
  `lint:generated`.
- Fix commit: `8cd57172` (`Record Round 32 fix evidence`).

### Round 34 Follow-up - `2026-07-10T14:24:06Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..8cd57172.diff` from task baseline
  `ca8fb2b3` to current HEAD `8cd57172`.
- TypeScript/API docs (Mill): clean.
- Security (Kierkegaard): clean.
- Performance/reliability (Wegener): clean.
- Documentation (Boyle): [P2] Round 33 trace still appears unresolved and
  lacks its fix-commit breadcrumb. Add commit `8cd57172` (`Record Round 32 fix
evidence`) to the Round 33 task/work/review records and update the current
  status/table away from pending findings.
- Code style/maintainability (Godel): [P1] `typecheck:tooling` fails on the
  changed delivery tests/fixture. Fault helper return annotations erase the
  internal probe capability required by `deliveryStorageFaults(...probes)`;
  there are unsafe generic `Message` to `Any` casts in the fixture; and
  `delivery-loop.test.ts` helper inference is too narrow for the fixture
  `StorageFactory`.
- Action: reproduce `typecheck:tooling`, fix the type errors and Round 33
  commit trace, rerun the focused verification gate, and repeat five-lane
  re-review.

### Round 34 Fix Implementation - `2026-07-10`

- Reproduced `typecheck:tooling` before edits with the 15 expected TypeScript
  errors in delivery loop tests, the delivery storage fault fixture, and
  delivery worker probe call sites.
- Fixed tooling types without runtime behavior changes: the delivery-loop test
  helper now accepts the `StorageFactory` abstraction it is passed, scenario
  probe helper interfaces preserve the internal `DeliveryStorageFaultProbe`
  capability required by `deliveryStorageFaults(...probes)`, and fixture
  inbox-record inspection uses one explicit `unknown` bridge at the known
  `Any` record boundary.
- Round 33 durable trace now names fix commit `8cd57172` (`Record Round 32 fix
evidence`) in the task, work, review, and Round 33 fix records. The current
  review status/table now records the Round 34 findings as fixed pending
  re-review rather than pending Round 33 findings.
- Fix-worker verification passed: `typecheck:tooling`, `lint:generated`, the
  requested focused delivery/storage Vitest batch with 7 files and 248 tests,
  `docs:check`, `format:check`, and `git diff --check`. `docs:check` reported
  only the existing invalid `origin` source-link warning.
- Coordinator verification at `2026-07-10T14:34:08Z` passed
  `typecheck:tooling`, `lint:generated`, the focused delivery/storage Vitest
  batch with 7 files and 248 tests, `docs:check`, `format:check`, and
  `git diff --check`. `docs:check` retained only the existing invalid `origin`
  source-link warning.

### Round 26 Follow-up - `2026-07-10T11:29:35Z`

- Review package:
  `.superpowers/sdd/review-ca8fb2b3..2caee0d7.diff` from task baseline
  `ca8fb2b3` to current HEAD `2caee0d7`.
- Documentation (Hilbert): clean.
- Security (Linnaeus): clean.
- Code style/maintainability (Aristotle): no blocking findings; retained one
  minor note that `FaultyDeliveryRecordStorage.compareAndSetRecord()` remains a
  broad test-only fault-injection helper.
- TypeScript/API docs (Zeno): [Important] `scanOffset` and `maxFailures` are
  loop-only controls but are exported on public `DeliveryDrainOptions` and
  rendered by TypeDoc. Split public drain options from loop-private controls
  and add API/type coverage that public `Delivery.drain()` options exclude
  both fields.
- Performance/reliability (Euler): [Important] `DeliveryLoop.#drainLimit()`
  reduces the accepted-work cap to the remaining failure budget, so healthy
  backlogs run one shard pickup/read/release per delivered row with default
  `maxFailures: 1`. Preserve the configured accepted-work limit and pass the
  remaining failure budget separately.
- Action: dispatch one fix worker for the API leak and batching regression,
  with focused delivery-loop/API export verification before another five-lane
  re-review.

### Round 26 Fix Implementation - `2026-07-10`

- Split public `DeliveryDrainOptions` from loop-private drain controls behind
  the non-barrel `deliveryAccess` capability.
- Preserved the configured/default accepted-work limit for loop drains while
  passing the remaining failure budget as a separate internal control.
- Added API type coverage proving public drain options exclude `scanOffset` and
  `maxFailures`, and delivery-loop coverage proving multiple successful
  callbacks can complete in one drain before the first failure stops the loop.
- Coordinator verification passed: focused delivery/API Vitest passed with 5
  files and 220 tests; generated build typecheck, docs check, format check,
  and `git diff --check` passed. `docs:check` reported only the existing
  invalid-origin TypeDoc source-link warning.
- Fix commit: `47672dc8` (`Fix delivery drain internal controls`).

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
  expired per-message ownership is wholly future work instead of the
  then-current reclaim-by-later-claim-attempt behavior. Historical correction:
  Round 35 commit `5c3705e2` superseded expired-claim reclaim; expired and live
  row claims both now block competing delivery until future explicit recovery
  policy exists.
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
  cleanup path ran. Historical correction: this finding's reclaim expectation
  was superseded by Round 35 commit `5c3705e2`; the current contract keeps
  expired and live row claims unavailable to competing workers until a future
  explicit recovery policy exists.
- Finding: [Reliability MEDIUM] pre-callback claim/lease failures were still
  counted as accepted endpoint work, letting them consume the accepted-work
  limit before any callback ran.
- Finding: [Performance MEDIUM] direct drains still chose page size from the
  accepted-work limit, so limit `1` plus many skipped rows degenerated toward
  one inbox query per skipped row.
- Fix: appended missing Round 23 and Round 24 durable trail entries, exported
  `DeliveryEndpointMessage`, narrowed `DeliveryEndpoint` and
  `DeliveryFailure.message`, then reclaimed expired claims during claim CAS
  using the storage clock. Historical correction: Round 35 / `5c3705e2`
  superseded that reclaim behavior with no competing delivery for any existing
  row claim. Round 24 also kept pre-callback failures visible without
  incrementing accepted work, and widened page reads to
  `min(inboxStorageAccess.maxReadLimit, remaining scan budget)` while stopping
  on accepted endpoint work.
- Evidence: new regressions covered expired-claim reclaim on a later drain,
  limit-1 pre-callback failure followed by a second-row delivery in the same
  drain, and bounded query count for one full skipped page plus one accepted
  row. Existing delivery-loop coverage was updated so live claims still leave a
  loop idle while expired claims are reclaimable. Historical correction: the
  expired-claim reclaim evidence is retained as Round 24 history only and no
  longer describes current behavior after Round 35 / `5c3705e2`.
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
