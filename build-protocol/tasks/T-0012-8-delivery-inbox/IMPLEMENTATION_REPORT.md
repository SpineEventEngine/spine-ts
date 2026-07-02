# Implementation Report: T-0012.8 Delivery And Inbox

Status: round-2 fixes pending
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

## Verification

- `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts packages/server/test/index.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm docs:check`
- `git diff --check`

`pnpm docs:check` passed with the existing TypeDoc warning about an invalid
`origin` remote for source links.

## Round 2 Review

Round 2 requested fixes across all lanes. The main correction is that
deduplication still used a guard-before-message sequence without an explicit
pending claim or atomic multi-record write. Reviewers also requested clearer
`RecordStorage.compareAndSet()` atomicity documentation, bounded inbox reads,
strict query limit validation, simpler internal exports, consistent delivery
storage corruption errors, and documentation/log updates.

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
