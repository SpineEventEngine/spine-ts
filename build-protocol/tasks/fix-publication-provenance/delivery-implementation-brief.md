# Delivery scan and cleanup: implementation assignment

Continue in the same implementation context after the storage slice is accepted
for integration. Do not start this slice until main dispatches it. You remain
the only runtime/test writer; main edits Markdown docs, task records and Git.
You are not alone: preserve those changes and do not revert other work.

Before starting delivery, finish any storage preflight corrections reported by
main. Every touched production file must pass the existing TSDoc gate; do not
waive failures as preexisting or update a debt baseline. Qualify the provider
commit documentation: transactional providers are atomic, but MyISAM/Aria keep
their documented partial-write behavior. Remove remaining `"committed"` result
assertions in live PostgreSQL/MySQL Entity-commit tests and rename tests that
still claim expected-record conflict rejection. Keep unrelated record CAS tests.

## Requirements

Apply Sections 4–5 of entity-save-delivery-plan.md and its complete human ledger.
The approved plan and no-memory review already resolved the design; no new
architecture or library is needed. Use focused failing tests before code.

Read latest pinned official JVM Delivery.runDelivery/run, InboxPage continuation,
Conveyor duplicate identities, DeliveredMessagesCache and CleanupStation in
/tmp/spine-jvm-storage-review.lEI6Fm/core-jvm (ea3067b137938ac0beb6920c39d11e300976fcc9).

- Continue from each page's last composite cursor even after delivering messages.
  Remember deliveries across a whole scan. Empty or partial final pages end the
  scan; restart only after a scan with successful delivery. Duplicate deletion
  alone does not sustain another scan. A no-progress scan completes normally.
- Preserve equal-time tie handling, cursor deletion, work added behind the cursor,
  cancellation, shard checks, error propagation, blocked targets and direct/remote
  callers. Keep page-local retained identities and existing bounded recent cache.
  No unbounded scan identity set, pending-only query or new persistent dedup index.
- Skip unexpired delivered rows before per-record mutation checks/deletion calls.
  Keep final expiry and shard/exact-record checks for actual deletion.
- Use the same applicable clock for early cleanup and page-local retained-row
  duplicate recognition. Direct Inbox storage already has an injectable clock.
  Cover existing construction/adapters; do not add a public clock service or
  assume a remote server shares a client-injected clock. Authoritative remote
  mutation checks remain remote; document any actual provider-port API change.
  Preserve cleanup eligibility at keepUntil <= now and page protection at > now.
  The bounded recent cache retains its separate existing semantics.

## Focused verification

Test multiple productive pages after retained prefixes and deterministic read
counts; second scans for inserts behind cursor; equal timestamps and removed
cursor; empty/partial pages; duplicates while cached, same-page retained evidence,
fresh instances and cache eviction; failed attempts not recorded as successful
delivery; cancellation/lost shard access; no cleanup attempts for future deadlines;
past/absent/equal deadlines; injected clocks ahead/behind wall time for both
cleanup and duplicate recognition. Reuse domain-correct generated fixtures.

After green focused checks, rerun the same real-delivery measurement without
competing builds. Record all five fresh 1,000-recipient runs and verified states,
plus 100/500 cases. Under one second on every measured 1,000 run is required.
If missed, report measured remaining costs, not an invented redesign; main will
resolve any material scope change. Do not weaken the measured work or add a
flaky wall-clock gate to normal CI. Make the benchmark handler return undefined,
not void, consistent with the allowed reaction signatures.

Run cheap affected formatting, typechecks, focused tests and documentation/cleanup
checks. All touched production classes/methods and type parameters require simple
TSDoc and blank declaration spacing; changed callables stay within 35 lines.
No full verification profile, Docker tests, dependency/version changes, commits,
pushes, children or publication. Main schedules live checks and independent
review after this slice. Use apply_patch, not shell file rewrites.

Write delivery-implementation-report.md beside this brief with changed paths,
red/green commands/results, raw timings, API changes and unresolved concerns.
Return when the slice is ready for main preflight, retaining context for the
single aggregated review-fix batch.
