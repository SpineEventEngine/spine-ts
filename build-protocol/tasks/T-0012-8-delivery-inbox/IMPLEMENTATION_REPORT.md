# Implementation Report: T-0012.8 Delivery And Inbox

Status: round-43 fix committed and verified at `4307077`
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

Round-17 fixes marked round-17 package prep as completed and restored exact
focused coverage test paths in the work log. Round-18 review package
`.superpowers/sdd/review-round-18-fce80b2-current.diff` was prepared after
those fixes.

## Round 18 Review

Round 18 found no API, security, or reliability issue. Documentation and code
style/maintainability requested marking round-18 package prep as completed in
task/report/work logs.

Round-18 fixes marked round-18 package prep as completed in task/report/work
logs. Round-19 review package
`.superpowers/sdd/review-round-19-fce80b2-current.diff` was prepared after
those fixes.

## Round 19 Review

Round 19 found no API or security issue. Documentation, code
style/maintainability, and performance/reliability requested marking the
round-19 package-prep and current-state trail as completed in task/report/work
logs.

Round-19 fixes marked round-19 package prep and current-state breadcrumbs as
completed in task/report/work logs. Round-20 review package
`.superpowers/sdd/review-round-20-fce80b2-current.diff` was prepared after
those fixes.

## Round 20 Review

Round 20 found no TypeScript/API docs issue. Documentation and code
style/maintainability requested explicit round-19 fix and round-20 package
prep breadcrumbs. Security requested validating final guard target rows against
the active dedup key. Performance/reliability requested validating final dedup
records against their own guard key.

Round-20 fixes added final dedup guard key/target validation and direct
corruption tests for both cases. Focused inbox verification passed with 16
tests:

`pnpm test packages/server/test/delivery/inbox.test.ts`.

Round-21 review package
`.superpowers/sdd/review-round-21-fce80b2-current.diff` was prepared after
those fixes.

## Round 21 Review

Round 21 found no code style/maintainability, documentation, or TypeScript/API
docs issue. Performance/reliability requested enforcing the signal payload cap
before pending dedup claim serialization. Security requested validating that the
decoded dedup guard key matches the storage key being read.

Round-21 fixes moved payload-size enforcement into shared inbox-message
serialization and added dedup storage-key validation before guard target
lookup. Focused inbox verification passed with 18 tests:

`pnpm test packages/server/test/delivery/inbox.test.ts`.

Round-22 review package
`.superpowers/sdd/review-round-22-fce80b2-current.diff` was prepared after
those fixes.

## Round 22 Partial Review

Round 22 was interrupted after the code style/maintainability reviewer ran.
The reviewer requested renaming the test-only
`WrongStorageKeyGuardFactory` because it exceeded the four-component name
limit. Documentation, TypeScript/API docs, security, and
performance/reliability lanes were not started in that partial round.

Round-22 fix renamed the test-only factory to `StorageKeyMismatchFactory`.
Round-23 review package
`.superpowers/sdd/review-round-23-fce80b2-current.diff` was prepared after the
rename.

## Round 23 Review

Round 23 found no documentation or TypeScript/API docs issue. Maintainability
requested removing the new standalone `readDedupKey()` export and folding that
check into an existing records-module operation. Security and
performance/reliability requested read-side payload-size validation for stored
inbox rows and pending dedup guards.

Round-23 fixes moved storage-key validation into `dedupMessageId()` and added
stored signal payload-size checks before/after base64 decoding. Focused inbox
verification passed with 20 tests:

`pnpm test packages/server/test/delivery/inbox.test.ts`.

Round-24 review package
`.superpowers/sdd/review-round-24-fce80b2-current.diff` was prepared after the
fixes.

## Round 24 Review

Round 24 found no code style/maintainability, documentation, or TypeScript/API
docs issue. Security requested rejecting malformed and non-canonical stored
signal `valueBase64` values before accepting decoded payloads. Performance and
reliability requested keeping pending dedup guards after a durable inbox row
when finalization fails, rejecting oversized inbox/dedup `Any.value` records
before UTF-8 conversion and JSON parsing, and applying the same pre-parse size
guard to shard-session records.

Round-24 fixes added canonical base64 validation for stored inbox and pending
dedup signals, bounded serialized inbox/dedup/shard records before decoding,
and narrowed `InboxStorage` rollback to failures before the inbox row is known
durable. Focused delivery verification passed with 38 tests:

`pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`.

Round-25 review package
`.superpowers/sdd/review-round-25-fce80b2-current.diff` was prepared after the
fixes.

## Round 25 Review

Round 25 found no code style/maintainability or TypeScript/API docs issue.
Documentation requested narrowing the runtime description to the durable inbox
slice and documenting the exported delivery/inbox API surface. Security and
performance/reliability requested write-side 512 KB caps for serialized
inbox/dedup/shard-session records and bounded decoding when a direct inbox
write collides with a preexisting durable row.

Red-first regressions failed before implementation:

- oversized inbox rows:

  ```sh
  npx vitest run packages/server/test/delivery/inbox.test.ts \
    -t 'rejects oversized inbox rows before serializing storage records'
  ```

  failed because no error was thrown;

- oversized dedup rows:

  ```sh
  npx vitest run packages/server/test/delivery/inbox.test.ts \
    -t 'rejects oversized dedup rows before serializing storage records'
  ```

  failed because no error was thrown;

- corrupt preexisting inbox row:

  ```sh
  npx vitest run packages/server/test/delivery/inbox.test.ts \
    -t 'treats an oversized existing inbox row as storage corruption during direct write recovery'
  ```

  failed with `Inbox message "0/1:message-1" already exists.` instead of a
  corruption error; and

- oversized shard-session writes:

  ```sh
  npx vitest run packages/server/test/delivery/sharded-work-registry.test.ts \
    -t 'rejects oversized shard sessions before storing them'
  ```

  failed because the write was accepted.

Round-25 fixes:

- updated `RUNTIME_ARCHITECTURE.md` to describe the current durable inbox
  slice and explicitly defer retry workers, attempt counters, and retained
  delivery error details;
- added a public delivery/inbox API section to `DEVELOPER_API.md` for
  `Delivery`, `Inbox`, `InboxStorage`, `ShardIndex`, `ShardSession`,
  `ShardedWorkRegistry`, and the related options/result types;
- enforced serialized-size caps before returning/storing inbox, dedup, and
  shard-session `Any` records; and
- changed `InboxStorage.#ensureInboxRow()` to decode an existing row through
  bounded `readInboxMessage()` before treating it as a matching collision.

A stricter full touched-file line scan found long touched API/architecture
documentation lines after the round-25 fix. Those docs were reflowed before
the next review package.

Focused delivery verification passed with 42 tests:

`pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`.

Final round-25 verification also passed with:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `git diff --check`
- `git diff --unified=0 -- ... | awk '/^\\+[^+]/ { ... }'` for touched-file
  added-line length checks (no lines over 120 columns)

## Round 26 Review

Round 26 found no code style/maintainability issue. Documentation requested
adding `InboxMessageError` to the public delivery/inbox API docs, and
TypeScript/API docs requested adding `InboxMessageInput`. Security and
performance/reliability requested two trust-boundary fixes and earlier text
bounds: inbox-row and shard-session reads must reject self-consistent records
stored under the wrong slot, dedup guard recovery must reject a wrong-slot
inbox row even when its dedup pair is self-consistent, and oversized
signal/inbox/shard text must fail before building large keys or serialized
JSON.

Red-first regressions failed before implementation:

- focused round-26 delivery regressions:

  ```sh
  pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts
  ```

  failed with seven targeted regressions:
  `rejects oversized signal IDs before building inbox and dedup keys`,
  `rejects oversized inbox target identity before building inbox and dedup keys`,
  `rejects an existing inbox row stored under another message slot during direct write recovery`,
  `rejects a dedup guard whose inbox row matches the dedup key but not the guarded message slot`,
  `rejects oversized shard nodes before building a session record`,
  `rejects a shard session record stored under another shard slot during pickup`,
  and `rejects a shard session record stored under another shard slot during release`.
  The failures were the expected pre-fix outcomes: no error was thrown for the
  oversized signal/target inputs, direct inbox recovery raised
  `Inbox message "0/1:message-1" already exists.`, dedup guard recovery
  returned a duplicate result, shard pickup accepted the oversized node, shard
  pickup returned `undefined` for a wrong-slot session, and shard release
  returned `false` for a wrong-slot session.

## Round 26 Fix

Round-26 fixes kept the delivery slice small while closing the review gaps:

- extended the public delivery/inbox API section in `DEVELOPER_API.md` to
  include `InboxMessageError` and `InboxMessageInput`;
- extended inbox-row and shard-session decoders with optional expected storage
  keys so `InboxStorage.#ensureInboxRow()`, `InboxStorage.#readGuardMessage()`,
  `ShardedWorkRegistry.pickUp()`, and `ShardedWorkRegistry.release()` fail
  closed when a self-consistent record is stored under the wrong slot; and
- added simple early text bounds for inbox message IDs, signal IDs, inbox
  target identity fields, signal type URLs, and shard nodes before building
  large combined keys or serialized JSON, while keeping stored-record reads
  bounded with the same limits.

Focused delivery verification passed with 46 tests:

`pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`.

Final round-26 verification also passed with:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `git diff --check`
- `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
  over 120 columns)

## Round 27 Review

Round 27 found no documentation or TypeScript/API docs issue. Code
style/maintainability requested removing four one-off corrupt-guard
`StorageFactory` subclasses in `inbox.test.ts` and reusing the existing
parameterized corrupt-guard fixture instead. Security requested accepting valid
empty signal payloads whose `Any.value` base64 encodes to the empty string.
Performance/reliability requested accepting valid signal payloads whose base64
text exceeds the generic `16 KiB` text cap but remains within the
`256 KiB` signal payload limit.

Red-first regressions failed before implementation:

- focused round-27 inbox regressions:

  ```sh
  pnpm test packages/server/test/delivery/inbox.test.ts
  ```

  failed with the expected two regressions before implementation:
  `writes and reads back an empty signal payload` failed with
  `Inbox signal payload must be a non-empty string.`, and
  `writes and reads back a signal payload larger than the generic text cap`
  failed with
  `Inbox signal payload exceeds 16384 bytes and cannot be stored.`

## Round 27 Fix

Round-27 fixes stayed small and local to the durable inbox read path:

- replaced the single-use corrupt-guard test factories with direct
  `CorruptGuardFactory` setup in `inbox.test.ts`, which also removes the
  five-component `WrongMessageSlotGuardFactory` name from the suite;
- added two clear round-trip regressions for empty signal payloads and
  non-empty `20 KiB` signal payloads that exceed the generic text cap but stay
  within the signal payload byte limit; and
- added one private stored-signal base64 validator in `inbox-records.ts` so
  stored signal payloads accept the empty string, keep malformed/non-canonical
  payload rejection in `decodeSignalPayload()`, and apply a text cap derived
  from `maxSignalPayloadBytes` instead of the generic `16 KiB` stored-text cap.

Verification for the round-27 fix passed with:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
- `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `git diff --check`
- `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
  over 120 columns)

## Round 28 Review

Round 28 found no code style/maintainability or TypeScript/API docs issue.
Documentation requested advancing the durable task/report/work-log state to the
actual round-28 review package
`.superpowers/sdd/review-round-28-fce80b2-current.diff`. Security requested
strict UTF-8 validation before `JSON.parse()` for persisted inbox, dedup, and
shard-session records. Performance/reliability requested rolling back a stale
pending dedup guard when recovery races with a conflicting inbox-row create,
while preserving the earlier rule not to roll back after the inbox row is
already durable and the failure is only dedup finalization.

Red-first regressions failed before implementation:

- focused round-28 UTF-8 and recovery regressions:

  ```sh
  pnpm exec vitest run packages/server/test/delivery/inbox.test.ts \
    -t 'fails closed when stored inbox records contain invalid UTF-8'
  pnpm exec vitest run packages/server/test/delivery/inbox.test.ts \
    -t 'fails closed when pending dedup guards contain invalid UTF-8'
  pnpm exec vitest run packages/server/test/delivery/inbox.test.ts \
    -t 'rolls back a pending dedup guard when recovery finds a conflicting inbox row'
  pnpm exec vitest run packages/server/test/delivery/sharded-work-registry.test.ts \
    -t 'fails closed when stored shard sessions contain invalid UTF-8'
  ```

  failed with the expected four regressions before implementation:
  the stored inbox row was read back with a replacement-character signal type
  URL instead of rejecting, the pending dedup guard write recovered and
  returned `WRITTEN` instead of rejecting, the retry after a recovery conflict
  stayed trapped behind the stale pending guard, and shard pickup returned
  `undefined` for the invalid UTF-8 stored session instead of rejecting.

## Round 28 Fix

Round-28 fixes stayed small and local to delivery record decoding and pending
claim recovery:

- added strict UTF-8 decoding immediately before `JSON.parse()` in
  `inbox-records.ts` and `sharded-work-registry.ts`, surfacing invalid bytes as
  `DeliveryStorageCorruptionError` instead of lossy replacement-character JSON;
- added focused regressions for invalid UTF-8 persisted inbox rows, pending
  dedup guards, and shard-session rows; and
- rolled back a stale pending dedup guard only when
  `InboxStorage.#recoverPendingClaim()` fails before the guarded inbox row is
  known durable, leaving the existing finalization-only retry behavior intact.

Verification for the round-28 fix passed with:

- `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `git diff --check`
- `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
  over 120 columns)

## Round 29 Review

Round 29 found no code style/maintainability issue. Documentation requested
advancing the durable task/report/review/work-log state to the actual round-29
review package `.superpowers/sdd/review-round-29-fce80b2-current.diff`.
TypeScript/API docs requested clarifying that `Inbox` and `InboxStorage` are
low-level delivery storage primitives in this slice rather than
application-facing read-side facades, while still preserving the strict
application/service/domain write/read split. Security requested two fixes:
pending-guard recovery must not delete the canonical guard after a
conflicting/corrupt inbox-row recovery path, and oversized stringified inbox
`version` values must be rejected before inbox/dedup record materialization.
Performance/reliability repeated the pending-guard fail-open issue and required
explicit retry coverage.

Red-first regressions failed before implementation:

- focused round-29 guard/version regressions:

  ```sh
  pnpm exec vitest run packages/server/test/delivery/inbox.test.ts \
    -t 'fails closed when pending dedup recovery finds a conflicting inbox row'
  pnpm exec vitest run packages/server/test/delivery/inbox.test.ts \
    -t 'rejects oversized versions before building inbox or dedup records'
  ```

  failed with the expected two regressions before implementation: the retry
  after conflicting pending-guard recovery resolved `WRITTEN` with a new
  `message-2` live row, and the oversized `version` serializer path did not
  throw at all.

## Round 29 Fix

Round-29 fixes stayed small and local to delivery inbox storage and record
serialization:

- clarified `DEVELOPER_API.md` so `Inbox` / `InboxStorage` remain low-level
  delivery storage primitives rather than application-facing query facades,
  while preserving the higher-level write/read split wording;
- kept pending dedup recovery fail-closed by retaining the canonical pending
  guard when recovery hits a conflicting/corrupt inbox row, so retries surface
  the conflict/corruption instead of replaying under a new message ID;
- added focused retry coverage proving the second retry now fails closed with a
  retained-guard corruption/conflict result; and
- rejected oversized stringified inbox `version` values before building inbox
  or pending dedup records.

Verification for the round-29 fix passed with:

- `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `git diff --check`
- `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
  over 120 columns)

## Round 30 Review

Round 30 found no TypeScript/API docs issue. Code style/maintainability
requested splitting the `readStoredDedupRecord()`,
`parseStoredInboxMessage()`, and `readStoredSession()` hotspots into smaller
semantic helpers and moving corruption/recovery support out of the monolithic
`inbox.test.ts`. Documentation requested narrowing
`RUNTIME_ARCHITECTURE.md` so this slice is described as storage-level delivery
primitives plus async handoff, not integrated CommandBus/EventBus recording,
and advancing the durable task/report/review/work-log state to the round-30
package `.superpowers/sdd/review-round-30-fce80b2-current.diff`. Security
requested explicit post-composition caps for `inboxKey()` and
`dedupGuardKey()` so escaped composites cannot exceed the `64 KiB` read
invariant after passing per-field limits. Performance/reliability requested an
explicit pending-dedup aggregate budget and early rejection instead of the
generic serialized-record overflow.

Red-first regressions failed before implementation:

- focused round-30 record-limit regressions:

  ```sh
  pnpm test packages/server/test/delivery/inbox-records.test.ts
  ```

  failed with the expected three regressions before implementation: composed
  inbox keys and dedup keys with individually valid escaped fields serialized
  without throwing, and an oversized pending dedup claim failed only with the
  generic `Inbox dedup record exceeds 524288 bytes and cannot be stored.`
  error instead of an explicit aggregate-budget rejection.

## Round 30 Fix

Round-30 fixes stayed local to delivery record parsing, write-time validation,
test organization, and durable docs:

- split `readStoredDedupRecord()`, `parseStoredInboxMessage()`, and
  `readStoredSession()` into small local read/validate/build helpers while
  keeping the public delivery surface unchanged;
- moved shared inbox corruption/recovery doubles and payload builders into
  `packages/server/test/delivery/inbox-test-support.ts` and added the focused
  `packages/server/test/delivery/inbox-records.test.ts` regression file;
- narrowed `RUNTIME_ARCHITECTURE.md` so this slice is described as the durable
  storage-level delivery primitive and async handoff model, not integrated bus
  recording;
- added explicit post-composition `64 KiB` caps for `inboxKey()` and
  `dedupGuardKey()` so write-time validation matches the read-side invariant;
  and
- added an explicit `Inbox pending dedup claim exceeds 524288 bytes aggregate budget.`
  rejection before generic record packing.

Verification for the round-30 fix passed with:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `git diff --check`
- `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
  over 120 columns)

## Round 31 Review

Round 31 found no TypeScript/API docs or performance/reliability issue. Code
style/maintainability requested splitting or localizing the broad
`packages/server/test/delivery/inbox-test-support.ts` support surface.
Documentation requested advancing the durable task/report/review/work-log
state to the round-31 package
`.superpowers/sdd/review-round-31-fce80b2-current.diff`. Security requested
that `InboxStorage.read()` validate the actual storage slot for queried inbox
rows so a copied backend row cannot be delivered again, and maintainability
also requested centralizing the duplicated inbox message-ID text-budget
validation between `inbox-records.ts` and `inbox-storage.ts`.

Red-first regressions failed before implementation:

- focused round-31 copied-row replay regression:

  ```sh
  pnpm test packages/server/test/delivery/inbox.test.ts
  ```

  failed with the expected copied-row replay regression before
  implementation: `rejects a queried inbox row copied under another backend
key` resolved with two delivered `message-1` rows instead of rejecting the
  second backend slot as storage corruption.

## Round 31 Fix

Round-31 fixes stayed local to record-storage querying, inbox-key validation,
test organization, and durable logs:

- added `RecordStorage.queryEntries()` and in-memory slot tracking so query
  callers can see the actual backend slot ID instead of only the record's
  embedded ID;
- changed `InboxStorage.read()` to validate each queried inbox row against its
  real storage slot, which now rejects copied inbox rows stored under another
  backend key;
- centralized inbox message-ID validation in the small exported
  `InboxMessageIdText` object and removed the duplicate
  `InboxStorage.#requireMessageId()` path; and
- localized inbox-only storage doubles back into
  `packages/server/test/delivery/inbox.test.ts`, replaced the catch-all
  `inbox-test-support.ts` module with the narrower
  `inbox-message-fixture.ts` and `inbox-record-fixture.ts` helpers, and
  updated the durable task/report/review/work-log state to the round-31
  package/current state.

Verification for the round-31 fix passed with:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `git diff --check`
- `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
  over 120 columns)

## Round 32 Review

Round 32 found no maintainability issue. Documentation requested updating the
durable task/report/review/work-log state for the round-32 package and current
fix. TypeScript/API docs requested either hiding `Inbox.storage` or documenting
it as an intentional low-level escape hatch, and requested that same
message-ID/different-content direct writes surface a public invalid-input error
type instead of a raw `Error`. Security requested rejecting out-of-range stored
inbox/dedup timestamps and shard-session expiry timestamps as storage
corruption instead of materializing `Invalid Date`. Performance/reliability
requested the same fail-closed timestamp behavior, removing the
`queryRecordEntries()` ID-from-record fallback, and validating malformed retry
inputs before duplicate short-circuiting.

Red-first regressions failed before implementation:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `-t 'rejects direct inbox writes that reuse an existing message key'`
- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `-t 'rejects malformed retries even when a live dedup guard already exists'`
- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `-t 'fails closed when stored inbox timestamps are out of range'`
- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `-t 'fails closed when stored dedup inbox timestamps are out of range'`
- `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  `-t 'fails closed when a stored shard-session expiry time is out of range'`
- `pnpm test packages/storage/test/memory/in-memory-record-storage.test.ts`
  `-t 'rejects query-entry adapters that do not provide slot identities'`

The pre-fix outcomes matched the review findings: direct message-key reuse
raised a raw `Error`, malformed retries resolved `DUPLICATE`, stored
out-of-range inbox timestamps read back as `Date { NaN }`, corrupt dedup
retention allowed a fresh live write, corrupt shard expiry resolved a
replacement session, and a query-only adapter still fabricated entry IDs from
record bodies.

## Round 32 Fix

Round-32 fixes stayed local to delivery storage validation, shard timestamp
validation, record-storage query identity, API docs, and durable logs:

- `Inbox.storage` remains public, but it is now explicitly documented in code
  and `build-protocol/DEVELOPER_API.md` as an intentional low-level escape
  hatch for storage-focused tests and integrations;
- `InboxStorage.write()` now validates the full caller input up front by
  reusing the inbox/dedup serialization checks before any duplicate
  short-circuit, and direct message-key reuse now raises `InboxMessageError`;
- stored inbox `whenReceived` / `keepUntil` timestamps and shard-session
  `pickedUpAt` / `expiresAt` timestamps are validated after `Date`
  construction and now fail closed as `DeliveryStorageCorruptionError`;
- the default `RecordStorage.queryRecordEntries()` implementation now fails
  clearly so adapters must provide real storage-slot identities; and
- the affected delivery/storage tests and durable task/report/review/work-log
  state now reflect the round-32 package and fixes.

Verification for the round-32 fix passed with:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `git diff --check`
- `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
  over 120 columns)

## Round 33 Review

Round 33 found no maintainability or security issue. Documentation requested
advancing the durable task/report/review/work-log state to the round-33
package. TypeScript/API docs requested exporting and documenting
`DeliveryStorageCorruptionError` as part of the public delivery error
contract. Performance/reliability requested a red-first regression plus
fail-closed validation for out-of-range final dedup guard `keepUntilMs`.

## Round 33 Fix

Round-33 fixes stayed local to the delivery error contract, final dedup guard
validation, and durable logs:

- exported `DeliveryStorageCorruptionError` from `packages/server/src/index.ts`
  and documented the public delivery error contract in
  `build-protocol/DEVELOPER_API.md`, `inbox.ts`, and
  `delivery-storage-error.ts`;
- added the focused regression
  `fails closed when final dedup guard keep-until timestamps are out of range`
  before the production edit and confirmed the pre-fix failure resolved
  `WRITTEN` instead of rejecting corrupt storage; and
- validated final dedup `keepUntilMs` through the same `Date`-range check used
  by stored inbox timestamps so corrupt/out-of-range values now fail closed as
  `DeliveryStorageCorruptionError`.

Verification for the round-33 fix passed with:

- red:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `-- --runInBand -t "fails closed when final dedup guard keep-until`
    `timestamps are out of range"`
    failed before the production change because the corrupt final dedup guard
    still resolved `WRITTEN`;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).

## Round 34 Review

Round 34 found stale durable review/task/report/work-log state again, one dead
record-storage adapter hook, an over-broad exported inbox-helper surface,
public shard pickup caller validation that still used
`DeliveryStorageCorruptionError`, and two error-boundary problems: caller-side
inbox payload/date validation still surfaced generic or corruption errors, and
stored inbox composite-key integrity checks could still leak
`InboxMessageError` by recomputing canonical keys through input-side builders.

Red-first regressions failed before implementation:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`

The pre-fix failures matched the review findings: oversized inbox payloads
still raised generic `Error`, invalid caller timestamps still raised
`DeliveryStorageCorruptionError`, corrupt stored inbox composite-key checks
leaked `InboxMessageError`, and invalid shard pickup node/clock inputs still
raised `DeliveryStorageCorruptionError`.

## Round 34 Fix

Round-34 fixes stayed local to the storage query seam, inbox-record
validation/helpers, shard pickup input validation, and durable logs:

- `RecordStorage` now has a single abstract query-extension point:
  `queryRecordEntries()`. The dead `queryRecords()` hook is removed, and the
  in-memory adapter plus local test doubles now implement real slot-entry
  queries directly;
- removed the exported `InboxMessageIdText` and `validateInboxMessageInput`
  helpers. `InboxStorage.write()` now performs caller-input preflight by
  serializing the inbox and pending-dedup rows up front, while
  `inbox-records.ts` keeps the message-ID/key helpers local;
- caller-side inbox payload, serialized-row, label/status, and timestamp
  validation now surfaces `InboxMessageError`, while stored inbox/dedup key
  integrity checks use stored-only key recomputation so corrupt durable rows
  remain `DeliveryStorageCorruptionError`; and
- shard pickup validates caller `node` and `now` values with plain `Error`
  before any storage read/write, matching the documented storage-corruption
  boundary and keeping durable logs current through round 34.

Verification for the round-34 fix passed with:

- red:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    failed before the production change with the expected five wrong-class
    regressions across inbox caller validation, stored composite-key
    corruption, and shard pickup caller validation;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).

## Round 35 Review

Round 35 found one durable-log ordering issue, one missing round-35
breadcrumb, and two storage hardening gaps. The review requested restoring the
chronological round-28-through-34 review trail, recording the round-35
package/review/fix state across the durable task/report/work logs, rejecting
fake shard-shaped caller input plus non-`Uint8Array` signal payloads before
serialization, and failing closed when a pending dedup guard embeds invalid
inbox timestamps even if the guarded inbox row already exists and recovery
could otherwise finalize.

Red-first regressions failed before implementation:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`

The pre-fix failures matched the review findings: a pending dedup guard with
an out-of-range embedded inbox timestamp still resolved `DUPLICATE` once the
inbox row existed, fake shard-shaped caller input still serialized inbox and
dedup records, and a non-`Uint8Array` `Any.value` still passed through
`Buffer.from(...)` coercion.

## Round 35 Fix

Round-35 fixes stayed local to inbox-record parsing/serialization, the focused
delivery tests, and the durable logs:

- inbox-record writes now re-materialize caller shard input through real
  `ShardIndex` semantics before serializing stored shard keys or counts, so
  fake shard-shaped objects with invalid `index` / `ofTotal` fail early as
  `InboxMessageError`;
- inbox-record writes now require `Any.value` to already be a `Uint8Array`
  before payload-size checks or `Buffer.from(...)` base64 encoding, so invalid
  caller payload shapes fail as `InboxMessageError`;
- stored inbox timestamps now use the stored-date range validator during
  pending dedup message parsing, so corrupt pending guards fail closed even on
  the fast path where a durable inbox row already exists; and
- the review log is back in chronological order around rounds 28-34, with the
  round-35 package/review/fix breadcrumb recorded across task/report/work
  logs.

Verification for the round-35 fix passed with:

- red:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    failed before the production change with the expected three regressions
    across pending-guard timestamp corruption, fake shard-shaped caller input,
    and non-`Uint8Array` signal payload caller input;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`;
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`
    `packages/server/test/repository/aggregate-storage.test.ts`;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).

## Round 36 Review

Round 36 found stale durable task/report/review/work-log breadcrumbs, one dead
in-memory record query wrapper, a declaration-order nit in the shard registry,
and three storage hardening gaps. The review requested removing
`TenantRecords.query()`, placing `ShardedWorkRegistry` before supporting
`ShardSession`, treating same-dedup-key pending recovery conflicts as
`DeliveryStorageCorruptionError`, snapshotting caller inbox messages once
before deriving storage keys or payloads, and sanitizing shard pickup input
once before using a slot key or persisted shard record.

Red-first regressions failed before implementation:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `-- --runInBand -t 'writes one immutable snapshot when caller getters drift`
  `after validation|fails closed when pending dedup recovery finds same-key`
  `conflicting inbox bytes'`
- `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  `-- --runInBand -t 'sanitizes shard pickup input once when caller key`
  `disagrees with shard coordinates'`

The pre-fix failures matched the review findings: getter-backed caller
messages drifted to `message-2` / `projection-2` / `signal-2` after validation,
same-key pending recovery conflicts raised `InboxMessageError`, and fake shard
keys claimed slot `0/2` while persisting shard coordinates `1/2`.

## Round 36 Fix

Round-36 fixes stayed local to inbox storage, shard registry, in-memory tenant
records, focused delivery tests, and durable logs:

- `InboxStorage.write()` now builds one validated immutable snapshot from the
  initial inbox record and uses that snapshot for dedup keys, pending guards,
  inbox slot keys, and persisted payloads;
- pending dedup recovery calls the inbox-row ensure path with a storage
  corruption boundary, so same-key different inbox bytes fail closed as
  `DeliveryStorageCorruptionError`;
- `ShardedWorkRegistry.pickUp()` sanitizes caller shard input into one
  `ShardIndex` and uses it for both the backend slot and persisted session;
- the dead `TenantRecords.query()` wrapper is removed; and
- the shard registry file now presents the primary registry declaration before
  supporting `ShardSession`.

Verification for the round-36 fix passed with:

- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand`
    `-t 'writes one immutable snapshot when caller getters drift after`
    `validation|fails closed when pending dedup recovery finds same-key`
    `conflicting inbox bytes'`;
  - `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
    `-- --runInBand -t 'sanitizes shard pickup input once when caller key`
    `disagrees with shard coordinates'`;
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`
    `packages/server/test/repository/aggregate-storage.test.ts`;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check fce80b2..HEAD`; and
  - `awk 'length($0) > 120 { ... }'` across the touched files (no lines over
    120 columns).

## Round 37 Review

Round 37 found stale durable work-log state, non-chronological implementation
report tail material, missing TSDoc on exported constructor-parameter
properties, and two validation-before-persistence issues. The review requested
adding public parameter docs for `ShardIndex` and `ShardSession`, validating
shard pickup caller input before opening storage, and preventing getter-backed
signals from passing a small validated payload but persisting a larger payload.

Red-first regressions failed before implementation:

- `pnpm test packages/server/test/delivery/inbox-records.test.ts`
  `-- --runInBand -t 'rejects signal payloads that grow after validation'`
- `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  `-- --runInBand -t 'rejects invalid pickup inputs before opening shard`
  `storage'`

The pre-fix failures matched the review findings: inbox-record serialization
could read a larger signal payload after validation, and invalid pickup input
opened shard storage before failing validation.

## Round 37 Fix

Round-37 fixes stay local to inbox-record serialization, shard pickup, API
docs, focused tests, and durable logs:

- inbox-record writes now capture the optional signal once before validation
  and serialization, so getter-backed payload drift cannot substitute a later
  oversized payload after validation;
- `packSignal()` also enforces the signal payload cap at the serialization
  boundary;
- `ShardedWorkRegistry.pickUp()` validates shard, node, and the first clock
  value before opening storage, then refreshes the clock on compare-and-set
  retries;
- exported `ShardIndex` and `ShardSession` constructor-parameter properties
  now have TSDoc; and
- the implementation report's old Round 1/2/3 material is restored to
  chronological order before the Round 3 fix trail.

Verification for the round-37 fix passed with:

- red:
  - `pnpm test packages/server/test/delivery/inbox-records.test.ts`
    `-- --runInBand -t 'rejects signal payloads that grow after validation'`
    failed before the production change because no error was thrown;
  - `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
    `-- --runInBand -t 'rejects invalid pickup inputs before opening shard`
    `storage'` failed before the production change with two storage opens;
- green:
  - `pnpm test packages/server/test/delivery/inbox-records.test.ts`
    `-- --runInBand -t 'captures one signal payload before validation and`
    `serialization'`;
  - `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
    `-- --runInBand -t 'rejects invalid pickup inputs before opening shard`
    `storage'`;
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`
    `packages/server/test/repository/aggregate-storage.test.ts`;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check fce80b2..HEAD`; and
  - `awk 'length($0) > 120 { ... }'` across the touched files (no lines over
    120 columns).

## Round 38 Review

Round 38 found one API-doc export-list drift, stale durable round-37 state,
two public input validation gaps, one mutable caller-field snapshot gap, and
one final dedup guard blocking gap. The review requested adding
`DeliveryStorageCorruptionError` to the generated API-doc expectation and
public delivery export list, recording committed round-37 state across durable
logs, validating public `version` and `Date` inputs before using
`toString()` / `getTime()`, keeping mutable/getter caller inbox fields from
creating internally inconsistent rows, and honoring live final dedup guard
status/retention even if the referenced inbox row is expired.

Red-first regressions failed before implementation:

- `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `'uses caller getter drift as one inbox input snapshot|rejects structural`
  `caller timestamps as inbox message errors|rejects structural caller`
  `versions before building inbox or dedup records|blocks on a live final`
  `dedup guard even when the inbox row is expired'`

The pre-fix failures matched the review findings: structural caller timestamps
and versions were accepted, caller `inboxId` getter drift changed the stored
target identity, and a final dedup guard with live status was ignored because
the referenced inbox row was expired.

## Round 38 Fix

Round-38 fixes stayed scoped to API docs, inbox record/input validation, final
dedup blocking semantics, focused tests, and durable logs:

- added `DeliveryStorageCorruptionError` to the API-doc export expectation and
  concise public delivery export list;
- recorded committed round-37 state and current round-38 state across durable
  task/report/review/work logs;
- changed inbox-record writes to build one caller input snapshot for message
  identity, inbox identity, status, timestamps, version, and optional signal
  before deriving stored inbox/dedup rows;
- changed public inbox date validation to require real `Date` instances and
  public version validation to require `bigint`; and
- changed final dedup guard handling to use the guard's own status/retention
  fields for blocking while still returning the referenced inbox row.

Verification for the round-38 fix passed with:

- green:
  - the same focused red-first regression command;
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`
    `packages/server/test/repository/aggregate-storage.test.ts`;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check fce80b2..HEAD`; and
  - `awk 'length($0) > 120 { ... }'` across the touched files (no lines over
    120 columns).

Committed as `0efeccb`.

## Round 39 Review

Round 39 found stale durable round-38 state, one public storage API-doc drift,
and two storage hardening gaps. The review requested recording commit
`0efeccb` and the round-39 fix state across durable task/report/review/work
logs, adding `RecordEntry` to the public storage export docs and guard,
checking pending dedup guard bytes against the visible inbox row before
finalizing, and snapshotting shard-release session input once through
canonical shard/id/node validation.

## Round 39 Fix

Round-39 fixes stay local to API docs, inbox storage, shard registry release,
focused delivery tests, and durable logs:

- added `RecordEntry` to the public storage export list and removed it from
  the forbidden storage TypeDoc names;
- added a red-first regression for pending dedup guards whose visible inbox
  row has the same dedup/message key but different canonical bytes;
- changed pending dedup finalization to fail closed with
  `DeliveryStorageCorruptionError` unless the visible inbox row bytes match
  the pending guard's embedded canonical message;
- added a red-first regression for caller shard drift during shard-session
  release; and
- changed `ShardedWorkRegistry.release()` to snapshot and validate session
  shard/id/node once before storage reads, validation, and compare-and-set
  delete.

Verification for the round-39 fix so far:

- red:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `-- --runInBand -t 'fails closed when pending dedup guard and visible`
    `inbox row bytes differ|uses one canonical release snapshot when caller`
    `session shard drifts'` failed before production changes because the
    pending guard path returned `DUPLICATE` from conflicting bytes and
    shard release returned `false` after caller session shard drift;
- green:
  - the same focused red-first command passed after production changes.
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`
    `packages/server/test/repository/aggregate-storage.test.ts` passed with
    `119` tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

Committed as `72df1a4`.

## Round 40 Review

Round 40 found stale durable round-39 state, one unused exported helper, three
declaration-order nits, and one invalid-clock dedup retention bug. The review
requested recording commit `72df1a4` and the round-40 fix state across durable
task/report/review/work logs, removing the unused exported `dedupMessageId()`,
moving primary declarations before support declarations in inbox/storage files,
and validating `InboxStorage.now()` before dedup decisions/mutations so invalid
clocks receive plain public-error treatment and cannot let duplicate live
delivered messages through.

The TypeScript/API docs and reliability lanes were clean.

## Round 40 Fix

Round-40 fixes stay local to durable logs, inbox storage, inbox record exports,
declaration ordering, and focused inbox tests:

- added a red-first regression for invalid `InboxStorage.now()` allowing a
  duplicate write while a delivered dedup guard is still live;
- validated the injected inbox storage clock before dedup retention decisions
  and before pending-guard recovery/finalization can mutate dedup state;
- removed the unused exported `dedupMessageId()` helper; and
- moved the primary `Inbox`, `RecordStorage`, and `TenantRecords`
  declarations before their supporting declarations.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `'rejects invalid storage clocks before live dedup retention decisions'`
  failed before production changes because the second write resolved
  `WRITTEN` instead of rejecting the invalid storage clock.

Focused verification:

- the same focused red-first command passed after production changes.

Final verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` passed with
  `121` tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

`node scripts/check-api-docs.mjs` still emitted the existing invalid `origin`
TypeDoc source-link warning, but exited successfully.

Final verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` passed with
  `120` tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

`node scripts/check-api-docs.mjs` still emitted the existing invalid `origin`
TypeDoc source-link warning, but exited successfully.

Committed as `3a05e4b` after verification.

## Round 41 Review

Round 41 found no code style/maintainability, TypeScript/API docs, security,
or performance/reliability issue. Documentation requested one durable-log
precision fix: the current round-40 state must explicitly name committed
round-40 fix commit `3a05e4b` instead of referring only to the final task
commit or verification timing.

## Round 41 Fix

Round-41 fixes are documentation-only:

- name `3a05e4b` as the committed round-40 fix commit in task, report, review,
  and work logs; and
- record this round-41 docs-only review/fix trail in the durable logs.

Committed as `e55c26f`.

## Round 42 Review

Round 42 found one documentation state issue and one performance/reliability
dedup hardening issue. Documentation requested durable logs record committed
round-41 state at `e55c26f` and the current round-42 pass. Reliability found
that corrupt final dedup guards could unblock a retry when their
status/retention metadata disagreed with the visible inbox row.

Code style/maintainability, TypeScript/API docs, and security lanes were
clean.

## Round 42 Fix

Round-42 fixes stay local to inbox storage, focused inbox tests, and durable
logs:

- added a red-first regression for a final guard that says `DELIVERED` with no
  retention while the visible inbox row remains `TO_DELIVER`;
- changed final dedup guard reads to fail closed with
  `DeliveryStorageCorruptionError` unless guard status/retention metadata
  matches the visible inbox row; and
- refreshed task/report/review/work logs through committed round 41.

Committed as `0235f0b`.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `'fails closed when final dedup guard metadata differs from the visible`
  `inbox row'` failed before production changes because the retry resolved
  `WRITTEN` for a second inbox row.

Focused verification:

- the same focused red-first command passed after production changes.

## Round 43 Review

Round 43 found one durable-log state issue and one security input-validation
issue. Documentation and maintainability requested that durable logs record
the committed round-42 fix at `0235f0b` instead of describing it as only
current-worktree state. Security found that proxy-backed caller signal payloads
and timestamps could leak raw `TypeError` through `Inbox.receive()` and
`InboxStorage.write()`.

Code style/maintainability was otherwise clean, and the TypeScript/API docs and
performance/reliability lanes were clean.

## Round 43 Fix

Round-43 fixes stay local to caller-input validation, focused inbox tests, and
durable logs:

- added red-first regressions for proxy-backed `Uint8Array` signal payloads
  through `Inbox.receive()` and proxy-backed `Date` receive times through
  `InboxStorage.write()`;
- changed caller byte and timestamp validation to wrap proxy trap failures as
  `InboxMessageError` before storage writes; and
- refreshed task/report/review/work logs for committed round 42 and this
  round-43 handoff state.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `proxy-backed` failed before production changes because both tests observed
  raw `TypeError` instead of `InboxMessageError`.

Focused verification:

- the same focused proxy-backed command passed after production changes.

Final state:

- Round-43 fixes were committed as `4307077` after controller verification.
- This post-round-43 durable-log pass exists only to replace stale handoff
  wording with the known committed state and to record the log-maintenance
  self-reference rule. This commit's own hash is intentionally not embedded in
  the commit; identify it by package HEAD or `git log`.
