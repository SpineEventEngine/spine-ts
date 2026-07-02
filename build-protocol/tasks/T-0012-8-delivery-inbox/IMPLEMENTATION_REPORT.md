# Implementation Report: T-0012.8 Delivery And Inbox

Status: round-6 review prep
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

- `pnpm test packages/storage/test/memory/in-memory-record-storage.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts packages/server/test/index.test.ts`
- `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts packages/server/test/index.test.ts`
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

- `pnpm test packages/storage/test/memory/in-memory-record-storage.test.ts packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts packages/server/test/index.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm docs:check`
- `git diff --check`

`pnpm docs:check` passed with the existing TypeDoc warning about an invalid
`origin` remote for source links.
