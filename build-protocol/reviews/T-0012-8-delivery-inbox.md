# Review Log: T-0012.8 Delivery And Inbox

Status: round 18 review prep
Branch: `task/T-0012-8-delivery-inbox`
Worktree:
`/Users/armiol/development/experiments/spine-ts/.worktrees/T-0012-8-delivery-inbox`
Baseline commit: `de3ccc7`

## Required Review Lanes

- code style/maintainability;
- documentation;
- TypeScript/API docs;
- security;
- performance/reliability.

## Review Focus

Reviewers must reject:

- direct delivery modes for normal server operation;
- worker loops, retry monitors, conveyor/stations, repository invocation,
  `Stand`, gRPC services, transport retry behavior, or example app work;
- deduplication based only on inbox record ID;
- in-process-only shard locks;
- public standalone helpers without a recorded reason;
- names over the four-component limit; and
- stale task/report/work-log state.

## Review Rounds

### Round 1

Diff package:
`.superpowers/sdd/review-de3ccc7..6d20fb1.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f219d-9453-7920-90c5-90ce84ed815e`;
- documentation: `019f219d-94ec-7c13-ade0-df9ca31e1b72`;
- TypeScript/API docs: `019f219d-9555-7d62-a1bc-158241148e08`;
- security: `019f219d-95d9-7801-9123-58e8e1ce942a`;
- performance/reliability:
  `019f219d-9654-7f52-8a7e-44b1703cf71c`.

Result: changes requested.

Findings to address:

- duplicated process-local promise queues in inbox and shard storage;
- `InboxStorage` carries too many private responsibilities in one file;
- the public `DeliveryStrategy` / `LocalDeliveryStrategy` seam may be too early
  for this slice;
- hand-written public delivery message/status types and internal JSON `Any`
  records are too broad before Spine delivery protos are available;
- API overview omitted `ShardedWorkRegistryOptions`;
- shard pickup and inbox deduplication are not real cross-process
  compare-and-set operations over the current storage API;
- shard reads need an explicit UUID tie-breaker after receive time and version;
- paging/batch delivery must be either implemented or explicitly deferred;
- dedup retention must not trust caller-supplied receive time as the clock;
- malformed internal records and oversized payloads can poison reads or exhaust
  resources; and
- task/work logs must separately record that the local JVM Java delivery sources
  were absent and the local delivery proto directory was present but empty.

All five round-1 reviewer sub-agents were closed after their reports were
collected.

### Round 1 Fix

Fix sub-agent: `019f21a1-64ba-7c52-bcf2-507196104b9b`.

Result: completed and closed after commit `c2553cf`.

Fix summary:

- replaced process-local inbox deduplication and shard lease queues with
  `RecordStorage.compareAndSet()`;
- added in-memory compare-and-set coverage;
- added storage clock based dedup retention, malformed record checks, signal
  payload size checks, explicit message-ID order tie-breaker, and a positive
  read limit;
- narrowed the premature public delivery strategy seam;
- updated API docs and separate JVM Java/proto evidence logs.

Round-2 reviewers must verify this correction rather than assuming it.

### Round 2

Diff package:
`.superpowers/sdd/review-6d20fb1..c2553cf.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f21b4-2d14-7183-be49-a012e0a1cd40`;
- documentation: `019f21b4-2db0-77d3-a01b-4840caff999f`;
- TypeScript/API docs: `019f21b4-2e13-7553-b611-6e098af4d6ab`;
- security: `019f21b4-2ea3-74c0-92ba-e31639390b25`;
- performance/reliability:
  `019f21b4-2f19-7170-9621-5e471985f548`.

Result: changes requested.

Findings to address:

- module-private inbox record helpers are still exported without need;
- missing inbox message for a dedup guard should use the delivery storage
  corruption error type;
- dedup guard writes can still outlive a failed inbox write or be observed
  before the inbox message is visible;
- a `DELIVERED` message without retention can make a new guard non-blocking
  before the inbox row exists;
- `RecordStorage.compareAndSet()` must document atomic behavior across storage
  handles for the same backing store;
- inbox reads need a hard default limit or required limit;
- query limit validation must reject `NaN`, non-integer, and infinite values;
- the work log must separately record that the local delivery proto directory
  was present but empty;
- the package README needs the explicit delivery-slice exclusions;
- API docs should use public `whenReceived`/receive-time naming rather than the
  internal `receivedAt` column name; and
- storage API docs must document the public `compareAndSet()` contract.

All five round-2 reviewer sub-agents were closed after their reports were
collected.

### Round 2 Fix

Fix sub-agent: `019f21b9-2997-7a90-b8d5-527656d7354a`.

Result: completed and closed after commit `59a6530`.

Fix summary:

- split inbox dedup guards into pending and final internal states;
- reuses the claimed inbox message identity when reclaiming expired pending
  guards;
- finalizes guards only after the inbox row is visible;
- bounds inbox reads with a default page size;
- tightens `RecordQuery` limit validation;
- documents `RecordStorage.compareAndSet()` as an atomic cross-handle storage
  contract;
- narrows unneeded inbox-record helper exports; and
- updates delivery/storage docs and durable logs for the scope exclusions and
  empty local delivery proto directory.

Round-3 reviewers must verify this correction rather than assuming it.

### Round 3

Diff package:
`.superpowers/sdd/review-d33b311..59a6530.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f21cd-879f-7e61-89d4-28d924dcee7d`;
- documentation: `019f21cd-8844-7321-a9f6-1a5d1636c002`;
- TypeScript/API docs: `019f21cd-88bf-7861-8b1c-b581bc593774`;
- security: `019f21cd-8929-7030-a73e-2969595b3a95`;
- performance/reliability:
  `019f21cd-89c0-7672-a6cd-e79577de1c9a`.

Result: changes requested.

Findings to address:

- `InboxStorage.#writeWithDedup()` is too large for the core correctness path
  and should be split into small private steps;
- `StoredDedupRecord` and `dedupRecordBlocks()` still expose internal storage
  details without a production need;
- task/work logs still described round-3 package preparation as pending after
  the package was already created;
- the implementation report's verification list omitted the storage regression
  test for shared storage changes;
- pending-guard recovery must not use a hard-coded local wall-clock timeout to
  steal another writer's claim;
- tests must cover slow writer or skewed contender behavior;
- `ShardedWorkRegistry.pickUp()` must not trust a public caller-supplied time
  to decide lease expiry; and
- direct `InboxStorage.write()` must not allow caller-controlled message IDs to
  overwrite unrelated inbox rows.

The TypeScript/API docs lane was clean. All five round-3 reviewer sub-agents
were closed after their reports were collected.

### Round 3 Fix

Fix sub-agent: `019f21d3-10da-7fb0-8e58-c088eb615ff3`.

Result: completed and closed after commit `76e9132`.

Fix summary:

- split the main inbox dedup write path into smaller read/claim/recover/finalize
  methods;
- removed the white-box dedup helper test import and kept the internal dedup
  record type private to the module;
- replaced wall-clock pending-claim stealing with canonical pending-message
  persistence and idempotent completion of the same claimed inbox row;
- added a slow-writer race regression plus direct inbox message-key reuse
  protection coverage;
- moved shard lease expiry to constructor-injected clocks instead of a public
  `pickUp()` time parameter; and
- refreshed the durable task/report/work-log state for round-4 review prep.

Round-4 reviewers must verify this correction rather than assuming it.

### Round 4

Diff package:
`.superpowers/sdd/review-60c5412..76e9132.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f21e5-cc37-7b92-af08-8a7158b7f237`;
- documentation: `019f21e5-cce5-7bd1-908d-8ae59e299bc4`;
- TypeScript/API docs: `019f21e5-cd56-7003-ade0-d1514ad42f21`;
- security: `019f21e5-cdd5-7f10-bbfe-240b3ed0da83`;
- performance/reliability:
  `019f21e5-ce6a-7df2-be80-75fc92cae581`.

Result: changes requested.

Findings to address:

- `InboxMessage.id.shard` and `InboxMessage.shard` can diverge on direct
  `InboxStorage.write()` calls. Stored inbox records must reject that mismatch,
  and record parsing must verify the canonical record key and inbox key from the
  parsed fields.

Code style/maintainability, documentation, TypeScript/API docs, and
performance/reliability lanes were clean. All five round-4 reviewer sub-agents
were closed after their reports were collected.

### Round 4 Fix

Result: committed as `d0d5e0d` and ready for round-5 review.

Fix summary:

- direct inbox writes reject mismatched message ID shard/message shard
  identities; and
- stored inbox record parsing validates the canonical record key and inbox key
  from parsed fields before accepting the row.

### Round 5

Diff package:
`.superpowers/sdd/review-f74df5d..d0d5e0d.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f21ed-1fa2-76e1-89f6-6df73f2e4471`;
- documentation: `019f21ed-2039-7113-8018-9fbab18ff665`;
- TypeScript/API docs: `019f21ed-20ba-7060-aadb-79655013c842`;
- security: `019f21ed-212f-7c31-9cd5-951bee66a5b8`;
- performance/reliability:
  `019f21ed-21c8-7e03-a036-ed0e40dc602c`.

Result: changes requested.

Findings to address:

- exported delivery types and API docs must state that `InboxMessage.id.shard`
  must equal `InboxMessage.shard`; and
- direct write shard mismatch should be reported as a caller invariant error,
  not `DeliveryStorageCorruptionError`.

Code style/maintainability and security lanes were clean. Documentation
findings were stale against the already committed round-5 prep state. All five
round-5 reviewer sub-agents were closed after their reports were collected.

### Round 5 Fix

Result: committed as `05f2ca7` and ready for round-6 review.

Fix summary:

- documented that `InboxMessage.id.shard` must match `InboxMessage.shard` on
  the exported interfaces and API overview; and
- changed the direct-write shard mismatch from `DeliveryStorageCorruptionError`
  to a plain caller invariant error.

### Round 6

Diff package:
`.superpowers/sdd/review-f924a17..05f2ca7.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f21f2-cfe0-77a0-8bf4-4c50ee604c77`;
- documentation: `019f21f2-d090-7a40-904a-5781be99470e`;
- TypeScript/API docs: `019f21f2-d10f-71f3-8065-d8dca58d3a85`;
- security: `019f21f2-d18b-76f0-830d-c828ac1191d6`;
- performance/reliability:
  `019f21f2-d217-7701-a3f7-38dc66e6acc6`.

Result: changes requested.

Findings to address:

- changing the public direct-write shard mismatch failure from
  `DeliveryStorageCorruptionError` to plain `Error` changes the observable
  `InboxStorage.write()` error contract. Preserve the exported error contract
  or introduce and document a new one.

Code style/maintainability, documentation, security, and
performance/reliability lanes were clean. All five round-6 reviewer sub-agents
were closed after their reports were collected.

### Round 6 Fix

Result: committed as `d8cfb5b` and ready for round-7 review.

Fix summary:

- restored `DeliveryStorageCorruptionError` for direct write shard mismatches
  to preserve the public `InboxStorage.write()` error contract.

### Round 7

Diff package:
`.superpowers/sdd/review-1879916..d8cfb5b.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f21f7-780c-7010-bff2-88b59ae5194b`;
- documentation: `019f21f7-78a5-7e31-8f46-95a28973ced2`;
- TypeScript/API docs: `019f21f7-7926-7f81-b81b-b7e5bede7e62`;
- security: `019f21f7-79a1-7341-8280-f19c420946b0`;
- performance/reliability:
  `019f21f7-7a1d-7e43-9581-95d0e8b7c540`.

Result: changes requested.

Findings to address:

- the direct-write shard mismatch regression test must assert the exported
  error contract, not only message text; and
- caller-controlled shard mismatch must not be reported as durable storage
  corruption.

Decision: use a small exported caller-invariant error for invalid inbox message
input. This avoids classifying caller input as storage corruption while giving
the public API a stable error type.

Maintainability, documentation, and performance/reliability lanes were clean.
All five round-7 reviewer sub-agents were closed after their reports were
collected.

### Round 7 Fix

Result: committed as `e7f7b05` and ready for round-8 review.

Fix summary:

- added exported `InboxMessageError` for invalid caller-supplied inbox messages;
- changed direct write shard mismatch to use `InboxMessageError`; and
- tightened the regression test to assert the exported error class.

### Round 8

Diff package:
`.superpowers/sdd/review-8a468ff..e7f7b05.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f21fe-4c71-75b1-8f79-7775753b4cab`;
- documentation: `019f21fe-4d13-78f2-b600-ab2cd0c8ef37`;
- TypeScript/API docs: `019f21fe-4d86-78a1-ac3e-af244691e925`;
- security: `019f21fe-4e01-7da0-91eb-0fc5678649db`;
- performance/reliability:
  `019f21fe-5a9e-7d92-8655-9564301e23e2`.

Result: changes requested.

Findings to address:

- direct writes must validate `InboxMessage.id.shard === InboxMessage.shard`
  before any dedup lookup or duplicate short-circuit, so malformed direct-write
  requests always fail consistently with `InboxMessageError`.

Code style/maintainability, documentation, TypeScript/API docs, and
performance/reliability lanes were clean. All five round-8 reviewer sub-agents
were closed after their reports were collected.

### Round 8 Fix

Result: committed as `65e5c72` and ready for round-9 review.

Fix summary:

- moved inbox message shard-invariant validation before any dedup lookup in
  `InboxStorage.write()`; and
- kept serialization on the same validation helper.

### Round 9

Diff package:
`.superpowers/sdd/review-7ddf9f5..65e5c72.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2203-b465-7b71-8c5a-42ed84b71451`;
- documentation: `019f2203-b506-7542-870c-5186e4454d74`;
- TypeScript/API docs: `019f2203-b55e-7322-aaac-de7b7d679983`;
- security: `019f2203-b5df-70c1-b7c3-75e8f7ae7b2f`;
- performance/reliability:
  `019f2203-b67b-7a80-b504-ed96aa92d37b`.

Result: changes requested.

Findings to address:

- `validateInboxMessage()` should not be exported from `inbox-records` for one
  simple invariant check; and
- dedup serializers must still enforce the shard invariant, so malformed
  messages cannot be serialized into pending/final dedup records.

TypeScript/API docs was clean. Documentation findings were stale against the
already committed round-9 prep state. All five round-9 reviewer sub-agents were
closed after their reports were collected.

### Round 9 Fix

Result: committed as `1d4db77` and ready for round-10 review.

Fix summary:

- removed the exported shard-invariant helper;
- kept the early `InboxStorage.write()` validation local to inbox storage; and
- restored private serializer-local validation for inbox and dedup records.

### Round 10

Diff package:
`.superpowers/sdd/review-b5fa82a..1d4db77.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2208-fb51-7e50-8459-49c13223a139`;
- documentation: `019f2208-fbe4-7d70-95f4-01a28784ced1`;
- TypeScript/API docs: `019f2208-fc78-7b30-9209-24d2181c68a5`;
- security: `019f2208-fceb-7372-8981-8c9a39cdcf35`;
- performance/reliability:
  `019f2208-fd83-72a1-8bd6-387abaaa8281`.

Result: changes requested.

Findings to address:

- `writeDedupRecord()` must also enforce the private shard-invariant check; and
- tests should exercise direct dedup serializer bypasses for malformed
  messages.

Documentation and TypeScript/API docs lanes were clean. All five round-10
reviewer sub-agents were closed after their reports were collected.

### Round 10 Fix

Result: committed as `d419fd8` and ready for round-11 review.

Fix summary:

- added the private shard-invariant validation to final dedup record
  serialization; and
- added direct serializer bypass coverage for both dedup claim and final dedup
  records.

### Round 11

Diff package:
`.superpowers/sdd/review-fce80b2..d419fd8.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2210-1490-76e0-aa09-ab06d7555884`;
- documentation: `019f2210-392b-7e12-89e8-1eed6c415767`;
- TypeScript/API docs: `019f2210-5643-7153-8664-696dfdda10ad`;
- security: `019f2210-7bfd-75f3-8f3c-5116d8f1680f`;
- performance/reliability:
  `019f2210-a172-74e2-b4c3-40cf91b0e908`.

Result: changes requested.

Findings to address:

- the round-11 review package stopped at `d419fd8`, so it did not include the
  already committed review-prep log update `7076ac1`.

Code style/maintainability, TypeScript/API docs, security, and
performance/reliability lanes were clean. All five round-11 reviewer
sub-agents were closed after their reports were collected.

### Round 11 Fix

Result: addressed by including the existing review-prep log commit in a new
round-12 package.

Fix summary:

- no production code changed after `d419fd8`; and
- round 12 uses a stable package path that can include the log prep state.

### Round 12

Diff package:
`.superpowers/sdd/review-round-12-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2213-738d-7d20-adf4-85cf676910eb`;
- documentation: `019f2213-9777-7871-b198-90e70abf17b1`;
- TypeScript/API docs: `019f2213-b68b-72f2-abfa-b9e54733d293`;
- security: `019f2213-d57d-7ba0-927d-dad89a63f6bc`;
- performance/reliability:
  `019f2213-f392-7fe2-8e49-336072d35588`.

Result: changes requested.

Findings to address:

- the Round 10 Fix entry in this review log must explicitly record that the
  fix was committed as `d419fd8`.

Code style/maintainability, TypeScript/API docs, security, and
performance/reliability lanes were clean. All five round-12 reviewer
sub-agents were closed after their reports were collected.

### Round 12 Fix

Result: implemented in this worktree and ready for round-13 review.

Fix summary:

- updated the Round 10 Fix entry to record commit `d419fd8`.

### Round 13

Diff package:
`.superpowers/sdd/review-round-13-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2215-fc1e-7cb2-bd1c-ef0ea361960b`;
- documentation: `019f2216-211d-7e83-a9af-00402ac8e8c6`;
- TypeScript/API docs: `019f2216-3e2f-7e21-956f-ea35c1800bf6`;
- security: `019f2216-5d76-7801-b10a-2bbbb5f12b2e`;
- performance/reliability:
  `019f2216-7bb5-7383-b8e5-38cc8f1268f1`.

Result: changes requested.

Findings to address:

- `IMPLEMENTATION_REPORT.md` should explicitly name the round-13 package path
  in the Round 12 Review note.

Code style/maintainability, TypeScript/API docs, security, and
performance/reliability lanes were clean. All five round-13 reviewer
sub-agents were closed after their reports were collected.

### Round 13 Fix

Result: implemented in this worktree and ready for round-14 review.

Fix summary:

- named `.superpowers/sdd/review-round-13-fce80b2-current.diff` in the
  implementation report.

### Round 14

Diff package:
`.superpowers/sdd/review-round-14-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2219-1220-7d91-a31a-b019724cb264`;
- documentation: `019f2219-3692-7be3-a61f-fd1389d5d0fa`;
- TypeScript/API docs: `019f2219-602f-7f01-a55d-30363a2b7025`;
- security: `019f2219-7fb6-7800-84de-55cffc2309f7`;
- performance/reliability:
  `019f2219-9e44-72a1-ba83-62d9ce7b7ef3`.

Result: clean.

All five round-14 reviewer sub-agents were closed after their reports were
collected. No reviewer requested changes.

### Coverage Fix

Implementation sub-agent:
`019f221e-d165-7cf1-9d01-3182d3829ef2`.

Result: implemented in this worktree and ready for round-15 review.

Fix summary:

- added focused test-only branch coverage for `ShardIndex`,
  `ShardedWorkRegistry`, and `RecordSpec`;
- no production code changed; and
- escalated coverage now passes at the global branch threshold.

The coverage-fix worker was closed after its report was collected.

### Round 15

Diff package:
`.superpowers/sdd/review-round-15-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f222e-10a8-7683-8578-8456afa9d770`;
- documentation: `019f222e-38a3-7f82-ac70-929158665054`;
- TypeScript/API docs: `019f222e-5d9e-7a70-a26d-6f57ca3106c7`;
- security: `019f222e-7dcf-7731-b678-c2d481c74a0f`;
- performance/reliability:
  `019f222e-a94a-77d3-a88c-381627e33b8e`.

Result: changes requested.

Findings to address:

- task/report/work logs must consistently record the round-15 package prep and
  current state; and
- two long command lines in durable logs must be reflowed.

TypeScript/API docs, security, and performance/reliability lanes were clean.
All five round-15 reviewer sub-agents were closed after their reports were
collected.

### Round 15 Fix

Result: implemented in this worktree and ready for round-16 review.

Fix summary:

- recorded round-15 package prep across task, report, and work logs; and
- reflowed long command lines in durable logs.

### Round 16

Diff package:
`.superpowers/sdd/review-round-16-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2233-5d05-7262-8027-e569e8a3f3ad`;
- documentation: `019f2233-87bc-74b3-a04a-036f2d9163c1`;
- TypeScript/API docs: `019f2233-ab98-7962-8f74-5a9d83e16c91`;
- security: `019f2233-ddcb-75f3-8f44-72b64cd16d32`;
- performance/reliability:
  `019f2234-0320-7ec2-b41a-c2ab4a315907`.

Result: changes requested.

Findings to address:

- task and implementation report statuses/package-prep notes must advance to
  the round-16 review-prep state; and
- work-log verification entries must preserve exact focused test file targets.

Code style/maintainability, TypeScript/API docs, and security lanes were clean.
All five round-16 reviewer sub-agents were closed after their reports were
collected.

### Round 16 Fix

Result: implemented in this worktree and ready for round-17 review.

Fix summary:

- advanced task/report statuses and package-prep notes; and
- restored exact focused verification file targets in the work log.

### Round 17

Diff package:
`.superpowers/sdd/review-round-17-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2237-2320-7090-9f5e-e69302d279d8`;
- documentation: `019f2237-4c12-7ff0-beb5-3684254b32a0`;
- TypeScript/API docs: `019f2237-7b2e-7f43-a4e0-b85846282cc6`;
- security: `019f2237-a31c-7363-b076-50756218433b`;
- performance/reliability:
  `019f2237-ca1a-7250-8ed8-d7166e9f6c5f`.

Result: changes requested.

Findings to address:

- task/report/work logs must mark round-17 package prep as completed; and
- work-log focused coverage verification must preserve exact test file targets.

TypeScript/API docs and security lanes were clean. Code style/maintainability
found the same stale wording as documentation. All five round-17 reviewer
sub-agents were closed after their reports were collected.

### Round 17 Fix

Result: implemented in this worktree and ready for round-18 review.

Fix summary:

- marked round-17 package prep as completed in task/report/work logs; and
- restored exact focused coverage test file targets in the work log.

### Round 18

Diff package:
`.superpowers/sdd/review-round-18-fce80b2-current.diff`.

Reviewer sub-agents: pending.

Result: pending.
