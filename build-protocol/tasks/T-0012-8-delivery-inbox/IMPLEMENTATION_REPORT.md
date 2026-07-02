# Implementation Report: T-0012.8 Delivery And Inbox

Status: round-18 review prep
Branch: `task/T-0012-8-delivery-inbox`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-8-delivery-inbox`
Baseline commit: `de3ccc7`

## Summary

Implemented the first durable delivery slice with small JVM-familiar delivery
types and storage-backed behavior:

- `Delivery`, `Inbox`, `InboxStorage`, `ShardIndex`, `ShardSession`, and
  `ShardedWorkRegistry`;
- durable inbox writes with target inbox identity, original signal identity,
  label, status, shard, received time, ordering version, and optional
  deduplication retention;
- live deduplication by `(signalId, inboxId)` over durable storage through
  small internal guard records rather than record ID;
- storage-backed shard pickup/release with lease expiry replacement semantics
  backed by `RecordStorage.compareAndSet()`;
- explicit inbox ordering by receive time, version, and inbox message UUID, plus
  positive paging via `InboxReadOptions.limit`;
- corruption checks for malformed internal JSON records plus a bounded signal
  payload size before JSON serialization;
- public export, README, and API-doc expectation updates for the new delivery
  surface.

Round-2 fixes completed the remaining correctness and documentation gaps:

- dedup guards now persist through explicit pending/final states so a fresh
  claim is never treated as final before the inbox row is visible;
- retrying writers can safely reclaim orphan pending guards by reusing the
  claimed inbox message identity instead of creating a second live row for the
  same `(signalId, inboxId)`;
- missing-message dedup guards now raise
  `DeliveryStorageCorruptionError` only after the pending/recovery path is
  exhausted and the guard is truly final-but-broken;
- inbox reads now enforce a bounded default page size when no explicit limit is
  supplied;
- `RecordQuery` limit validation now rejects non-integer, non-finite, and
  non-positive values, with regression coverage;
- `RecordStorage.compareAndSet()` is now documented as an atomic
  cross-handle contract for one logical backing store, including conditional
  delete semantics; and
- the server/docs/work-log text now explicitly records the empty local delivery
  proto directory and the delivery-slice exclusions.

## Verification

- focused delivery/storage tests with `pnpm test`:
  `packages/storage/test/memory/in-memory-record-storage.test.ts`,
  `packages/server/test/delivery/inbox.test.ts`,
  `packages/server/test/delivery/sharded-work-registry.test.ts`, and
  `packages/server/test/index.test.ts`
- focused delivery tests with `pnpm test`:
  `packages/server/test/delivery/inbox.test.ts`,
  `packages/server/test/delivery/sharded-work-registry.test.ts`, and
  `packages/server/test/index.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm docs:check`
- `git diff --check`

`pnpm docs:check` passed with the existing TypeDoc warning about an invalid
`origin` remote for source links.

## Round 3 Fix

Round 3 requested a smaller and more trustworthy dedup/storage core. This fix:

- split `InboxStorage.#writeWithDedup()` into smaller private read/claim/recover
  steps while keeping the public storage API unchanged;
- removed the white-box `dedupRecordBlocks()` test dependency and made the
  internal dedup record type non-exported;
- changed pending dedup guards to persist the exact canonical inbox message so
  later writers can finish the same claim idempotently without wall-clock claim
  expiry or timeout-based stealing;
- added a slow-writer race regression that proves a contender cannot replace
  the canonical first claim's metadata, status, version, payload, or message
  identity under one dedup key;
- moved shard lease expiry time sourcing behind constructor-injected clocks
  instead of trusting caller-supplied `pickUp()` timestamps; and
- changed direct `InboxStorage.write()` inbox-row persistence to compare-and-set
  creation, rejecting reuse of an existing message key instead of overwriting
  another row.

## Round 4 Fix

Round 4 requested one security fix. Direct inbox writes now reject mismatched
`InboxMessage.id.shard` and `InboxMessage.shard` values before storage, and
stored inbox records validate that the persisted record key and inbox key match
the parsed message identity and target identity.

Committed as `d0d5e0d` after focused delivery/storage verification passed.

## Round 5 Fix

Round 5 requested public documentation for the shard invariant and a clearer
caller-side error. The exported `InboxMessageId` / `InboxMessage` comments and
API overview now state that `InboxMessage.id.shard` must match
`InboxMessage.shard`, and direct write mismatch now raises a plain invariant
error before any durable record is decoded.

Committed as `05f2ca7` after focused delivery and docs verification passed.

## Round 6 Fix

Round 6 requested preserving the public `InboxStorage.write()` error contract.
Direct write shard mismatch now keeps using `DeliveryStorageCorruptionError`,
while the exported API docs still state the shard invariant.

Committed as `d8cfb5b` after focused delivery verification passed.

## Round 7 Fix

Round 7 requested a stable public error contract that does not classify caller
input as storage corruption. `InboxMessageError` now represents invalid
caller-supplied inbox messages. Direct write shard mismatch uses this error,
and the regression test asserts the exported class.

Committed as `e7f7b05` after focused delivery and API docs verification passed.

## Round 8 Fix

Round 8 requested consistent early validation of the shard invariant. Direct
`InboxStorage.write()` now validates `InboxMessage.id.shard` against
`InboxMessage.shard` before opening storage or reading dedup state, and
serialization reuses the same validation.

Committed as `65e5c72` after focused delivery verification passed.

## Round 9 Fix

Round 9 requested keeping the shard-invariant helper private while preserving
serializer-local protection. The invariant is now checked directly at the start
of `InboxStorage.write()` and privately inside the shared inbox message
serializer used by inbox and dedup records.

Committed as `1d4db77` after focused verification passed.

## Round 10 Fix

Round 10 found that final dedup record serialization could still bypass the
private shard-invariant check. `writeDedupRecord()` now validates the same
message invariant before encoding final dedup rows, and tests directly cover
both dedup claim and final dedup serializers with mismatched shard identities.

Implemented after focused delivery/index tests, typecheck, lint, docs check,
format check, and diff hygiene passed.

Committed as `d419fd8` and prepared for round-11 review.

## Round 11 Review

Round 11 found no code, API, security, or reliability issue. The documentation
lane requested that the review package include the log update recording commit
`d419fd8` and the round-11 package. That update was already committed as
`7076ac1`, but the round-11 package stopped at `d419fd8`. Round 12 uses a
stable package name and includes the review-prep log commit.

## Round 12 Review

Round 12 found no code, API, security, or reliability issue. The documentation
lane requested one durable-log correction: the Round 10 Fix entry in the review
log must explicitly say the fix was committed as `d419fd8`. The Round 13
package `.superpowers/sdd/review-round-13-fce80b2-current.diff` includes that
correction.

## Round 13 Review

Round 13 found no code, API, security, or reliability issue. The documentation
lane requested one durable-report correction: the Round 12 Review note in this
report should explicitly name the round-13 package path. The Round 14 package
includes that correction.

## Round 14 Review

Round 14 completed cleanly across code style/maintainability, documentation,
TypeScript/API docs, security, and performance/reliability. No reviewer
requested changes.

## Final Verification Attempt

Escalated `pnpm verify` passed all `39` test files and `364` tests, then
stopped at the coverage gate because global branch coverage was `88.04%`
against the required `90%`. The follow-up is focused test coverage for real
delivery/storage validation branches, not a threshold change.

## Coverage Fix

Added focused test-only coverage for the remaining delivery/storage branches:

- `packages/server/test/delivery/shard-index.test.ts` now covers invalid shard
  index/count validation plus `single()` and `key()`;
- `packages/server/test/delivery/sharded-work-registry.test.ts` now covers
  invalid `leaseMs`, release false paths, corrupt stored shard-session records,
  multitenant shard context behavior, default clock usage, and compare-and-set
  retry paths for pickup and release; and
- `packages/storage/test/record/record-spec.test.ts` now covers clone-method
  use plus stable fallback errors for unclonable values and invalid record
  clone fallback.

Verification for the coverage fix passed after main-agent cleanup with:

- focused coverage tests with `pnpm test`:
  `packages/server/test/delivery/shard-index.test.ts`,
  `packages/server/test/delivery/sharded-work-registry.test.ts`, and
  `packages/storage/test/record/record-spec.test.ts`;
- `pnpm typecheck`
- `pnpm lint`
- escalated `pnpm test:coverage` (`41` test files / `377` tests, branch
  coverage `90%`)
- `pnpm format:check`
- `git diff --check`

Round-15 review package
`.superpowers/sdd/review-round-15-fce80b2-current.diff` was prepared after
the coverage-fix commit.

## Round 15 Review

Round 15 found no API, security, or reliability issue. Documentation requested
that the task/report/work logs record round-15 package prep consistently, and
maintainability requested reflowing two long command lines.

Round-15 fixes recorded the package-prep breadcrumbs across task/report/work
logs and reflowed the long command lines. Round-16 review package
`.superpowers/sdd/review-round-16-fce80b2-current.diff` was prepared after
those fixes.

## Round 16 Review

Round 16 found no code style, API, or security issue. Documentation requested
that this report and `TASK.md` advance from the round-15 fix state to the
round-16 review-prep state. Performance/reliability requested preserving exact
focused verification file targets in the work log while keeping line lengths
readable.

Round-16 fixes advanced task/report statuses and package-prep notes, and
restored exact focused verification file targets in the work log. Round-17
review package `.superpowers/sdd/review-round-17-fce80b2-current.diff` was
prepared after those fixes.

## Round 17 Review

Round 17 found no API or security issue. Documentation requested marking
round-17 package prep as completed in task/report logs. Performance/reliability
requested exact focused coverage test paths in the work log. Code
style/maintainability found the same stale work-log/package-prep wording as
documentation.

## Round 2 Review

Round 2 requested fixes across all lanes. The main correction is that
deduplication still used a guard-before-message sequence without an explicit
pending claim or atomic multi-record write. Reviewers also requested clearer
`RecordStorage.compareAndSet()` atomicity documentation, bounded inbox reads,
strict query limit validation, simpler internal exports, consistent delivery
storage corruption errors, and documentation/log updates.

## Round 3 Review

Round 3 found that the second fix still needed simplification and stronger
trust boundaries. The main correctness issue is that pending dedup claims used
local wall-clock age to decide that another writer's claim was abandoned. That
can preempt a slow but healthy writer. Reviewers also requested removing
white-box helper exports, splitting the core dedup write method into smaller
steps, removing caller-controlled shard lease time, protecting direct
`InboxStorage.write()` calls from caller-controlled message ID overwrites, and
refreshing stale task/work-log state.

## Round 1 Review

Round 1 requested fixes across all lanes. The main correction is that the
initial implementation over-promised durable cross-process compare-and-set and
deduplication behavior while using process-local promise queues over an
unconditional `RecordStorage.write()` API. Reviewers also requested narrower
public delivery contracts until real Spine delivery protos are available, an
explicit UUID ordering tie-breaker, clearer paging deferral, safer internal
record parsing and payload limits, and more precise JVM source/proto evidence
logging.

This round records both missing local source artifacts separately: the JVM Java
delivery sources were absent from the checked local research tree, and the
local delivery proto directory was present but empty.

## Round 1 Fix

Fix sub-agent `019f21a1-64ba-7c52-bcf2-507196104b9b` completed and was closed
after commit `c2553cf`.

The fix:

- added `RecordStorage.compareAndSet()` with in-memory support;
- moved shard pickup/release and inbox deduplication to storage-level
  compare-and-set instead of process-local queues;
- narrowed the delivery public surface by removing the early delivery strategy
  seam;
- added an explicit inbox ordering tie-breaker, positive read limits, storage
  clock based dedup retention checks, internal record corruption checks, and a
  signal payload cap;
- updated the API docs and the task logs with separate Java/proto research
  evidence.

Verification reported by the fix sub-agent:

- focused delivery/storage tests with `pnpm test`:
  `packages/storage/test/memory/in-memory-record-storage.test.ts`,
  `packages/server/test/delivery/inbox.test.ts`,
  `packages/server/test/delivery/sharded-work-registry.test.ts`, and
  `packages/server/test/index.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm docs:check`
- `git diff --check`

`pnpm docs:check` passed with the existing TypeDoc warning about an invalid
`origin` remote for source links.
