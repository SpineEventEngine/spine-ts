# Review Log: T-0012.8 Delivery And Inbox

Status: round 30 fix complete
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

Reviewer sub-agents:

- code style/maintainability:
  `019f223c-1622-7900-a2f6-031345084b11`;
- documentation: `019f223c-4132-79d3-8822-87e3014a36c3`;
- TypeScript/API docs: `019f223c-7266-7402-9bc1-9bd41236652c`;
- security: `019f223c-a49b-7cc1-8417-f128e3cc6418`;
- performance/reliability:
  `019f223c-c6f6-7e53-9027-a4a522a81fd2`.

Result: changes requested.

Findings to address:

- task/report/work logs must mark round-18 package prep as completed.

TypeScript/API docs, security, and performance/reliability lanes were clean.
All five round-18 reviewer sub-agents were closed after their reports were
collected.

### Round 18 Fix

Result: implemented in this worktree and ready for round-19 review.

Fix summary:

- marked round-18 package prep as completed in task/report/work logs.

### Round 19

Diff package:
`.superpowers/sdd/review-round-19-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f223f-9c4d-7d43-911c-f56342959dcd`;
- documentation: `019f223f-d3ee-74b1-b7fe-46d70f344783`;
- TypeScript/API docs: `019f223f-f9de-7432-b7d3-69a250b1a9ad`;
- security: `019f2240-1d6c-74b1-8e99-b6f3c55b83ae`;
- performance/reliability:
  `019f2240-4176-78f1-9248-c8e14a78bba5`.

Result: changes requested.

Findings to address:

- task/report/work logs must mark round-19 package prep and current state as
  completed.

TypeScript/API docs and security lanes were clean. All five round-19 reviewer
sub-agents were closed after their reports were collected.

### Round 19 Fix

Result: implemented in this worktree and ready for round-20 review.

Fix summary:

- marked round-19 package prep and current-state breadcrumbs as completed in
  task/report/work logs.

### Round 20

Diff package:
`.superpowers/sdd/review-round-20-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2244-86de-7b42-a7a9-df8d601b4bc3`;
- documentation: `019f2244-a08f-7c51-a6a4-559109d663fb`;
- TypeScript/API docs: `019f2244-c1ca-7c93-ba52-a5aef75247c9`;
- security: `019f2244-daee-75b0-898b-5152023b6630`;
- performance/reliability:
  `019f2244-fdae-7ca0-88c5-3b48a6ad8a9d`.

Result: changes requested.

Findings to address:

- task/report/work logs must record the round-19 fix and round-20 package prep
  as completed;
- final dedup guard target rows must match the active dedup key;
- final dedup records must validate that their stored key matches their inbox
  and signal identity.

TypeScript/API docs lane was clean. All five round-20 reviewer sub-agents were
closed after their reports were collected.

### Round 20 Fix

Result: implemented in this worktree and ready for round-21 review.

Fix summary:

- added final dedup record key validation;
- added final dedup guard target validation;
- added direct corruption tests for mismatched final guard keys and targets;
- recorded the round-20 reviewer/fix trail across task/report/work logs.

Verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts` passed with 16 tests.

### Round 21

Diff package:
`.superpowers/sdd/review-round-21-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f224a-8894-75c0-890e-bc88dfa20b77`;
- documentation: `019f224a-a294-7172-a836-0bb50c2f6967`;
- TypeScript/API docs: `019f224a-c29f-7343-b94d-25d2748eae29`;
- security: `019f224a-de01-7962-bc8c-cb10741e39e3`;
- performance/reliability:
  `019f224a-f9de-78e3-8044-2f82c6d8bd99`.

Result: changes requested.

Findings to address:

- pending dedup claim serialization must enforce the signal payload cap;
- inbox storage must reject a guard record whose decoded dedup key does not
  match the storage key being read.

Code style/maintainability, documentation, and TypeScript/API docs lanes were
clean. All five round-21 reviewer sub-agents were closed after their reports
were collected.

### Round 21 Fix

Result: implemented in this worktree and ready for round-22 review.

Fix summary:

- enforced the signal payload cap in shared inbox-message serialization used by
  inbox rows and pending dedup claims;
- added decoded guard-key/storage-key validation before reading a final guard
  target row;
- added regression tests for oversized pending dedup claims and wrong storage
  key final guards.

Verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts` passed with 18 tests.

### Round 22

Diff package:
`.superpowers/sdd/review-round-22-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f224f-d012-7121-87f0-2b32415613d0`;
- documentation: not started;
- TypeScript/API docs: not started;
- security: not started;
- performance/reliability: not started.

Result: partial review, changes requested.

Findings to address:

- test-only `WrongStorageKeyGuardFactory` exceeds the four-component name
  limit.

The code style/maintainability reviewer sub-agent was closed after its report
was collected.

### Round 22 Fix

Result: implemented in this worktree and ready for round-23 review.

Fix summary:

- renamed the test-only factory to `StorageKeyMismatchFactory`.

### Round 23

Diff package:
`.superpowers/sdd/review-round-23-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f27ac-9bb0-7a43-950d-a489088ce066`;
- documentation: `019f27ac-bae9-7761-959c-ee7c4f1b3911`;
- TypeScript/API docs: `019f27ac-d6af-73f3-b54e-579614dbed56`;
- security: `019f27ac-f23b-7a20-a2ca-b9595fc929b7`;
- performance/reliability:
  `019f27ad-155d-7852-97ef-049aaaf7a30c`.

Result: changes requested.

Findings to address:

- remove the new standalone `readDedupKey()` export and fold storage-key
  validation into an existing records operation;
- stored inbox rows and pending dedup guards must reject oversized signal
  payloads on read.

Documentation and TypeScript/API docs lanes were clean. All five round-23
reviewer sub-agents were closed after their reports were collected.

### Round 23 Fix

Result: implemented in this worktree and ready for round-24 review.

Fix summary:

- moved dedup storage-key validation into `dedupMessageId()`;
- removed the standalone `readDedupKey()` export;
- added stored signal payload-size checks before/after base64 decoding;
- added regressions for oversized stored inbox and pending dedup payloads.

Verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts` passed with 20 tests.

### Round 24

Diff package:
`.superpowers/sdd/review-round-24-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f27b3-c6d4-7590-9a0c-524da938f1ac`;
- documentation: `019f27b3-ec64-7bc2-b54c-0d5b620948a4`;
- TypeScript/API docs: `019f27b4-0cdf-7b22-8a68-377cbda74e87`;
- security: `019f27b4-2f0b-7ff0-9e3d-140e7ee102c6`;
- performance/reliability:
  `019f27b4-5f90-7291-8972-7d15e2a0b3e3`.

Result: changes requested.

Findings to address:

- stored signal `valueBase64` values must reject malformed and non-canonical
  base64 before accepting decoded payloads;
- pending dedup guards must receive the same malformed/non-canonical
  `valueBase64` coverage;
- `InboxStorage.#claimAndWrite()` must not roll back a pending dedup guard
  after the inbox row is durable;
- inbox and dedup `Any.value` records must reject oversized serialized records
  before UTF-8 conversion and JSON parsing; and
- shard-session `Any.value` records must reject oversized serialized records
  before parsing.

Code style/maintainability, documentation, and TypeScript/API docs lanes were
clean. All five round-24 reviewer sub-agents were closed after their reports
were collected.

### Round 24 Fix

Result: implemented in this worktree and ready for round-25 review.

Fix summary:

- stored inbox and pending dedup signal payloads now reject malformed and
  non-canonical base64;
- inbox, dedup, and shard-session records now check serialized `Any.value`
  size before UTF-8 conversion and JSON parsing;
- `InboxStorage.#claimAndWrite()` now rolls back pending dedup guards only
  when `#ensureInboxRow()` fails before a row is known to be durable; and
- regressions cover malformed base64, oversized serialized records, and
  recovery after dedup finalization throws with a durable inbox row.

Verification:

```sh
pnpm test packages/server/test/delivery/inbox.test.ts \
  packages/server/test/delivery/sharded-work-registry.test.ts
```

Passed with 38 tests.

Round-25 review package:
`.superpowers/sdd/review-round-25-fce80b2-current.diff`.

### Round 25

Diff package:
`.superpowers/sdd/review-round-25-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f27c3-a9b4-7630-9934-6bd2dfdbcd01` (`CLEAN`, closed);
- documentation:
  `019f27c3-aa60-7521-9ab6-83626ba6a618` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f27c3-aacd-77d0-8831-18ff9f7ddefc` (`CLEAN`, closed);
- security:
  `019f27c3-ab50-71f3-8574-602b358aa464` (`CHANGES REQUESTED`, closed); and
- performance/reliability:
  `019f27c3-abe9-7202-901d-da4c61b8a91f` (`CHANGES REQUESTED`, closed).

Result: changes requested.

Findings to address:

- `build-protocol/RUNTIME_ARCHITECTURE.md` overstates the current delivery
  slice by claiming retry workers, attempt counters, and retained error
  details that are still out of scope;
- `build-protocol/DEVELOPER_API.md` omits the public delivery/inbox surface
  exported from `packages/server/src/index.ts`;
- the round-24 focused test command in this review log is awkwardly split and
  should be copyable as one shell block;
- inbox and dedup write paths enforce the 512 KB cap only on reads, not on the
  final serialized write record;
- shard-session writes enforce the 512 KB cap only on reads, not on the final
  serialized session record; and
- `InboxStorage.#ensureInboxRow()` compares raw `Any.value` buffers for an
  existing row instead of routing the collision through bounded inbox-record
  decoding.

Code style/maintainability and TypeScript/API docs were clean. Documentation,
security, and performance/reliability requested changes.

### Round 25 Fix

Result: implemented in this worktree.

Fix summary:

- updated `RUNTIME_ARCHITECTURE.md` to describe the current durable inbox
  slice, including durable inbox rows, pending/final dedup guards, shard
  sessions, async handoff, crash recovery, and corrupt-record rejection, while
  deferring retry workers, attempt counters, and retained error details;
- added a concise `DEVELOPER_API.md` section for `Delivery`, `Inbox`,
  `InboxStorage`, `ShardIndex`, `ShardSession`, `ShardedWorkRegistry`, and the
  related options/result types, while keeping the write/read split explicit;
- rewrote the round-24 focused test command as a fenced shell block;
- added red-first regressions for oversized serialized inbox rows, oversized
  dedup rows, oversized shard-session writes, and corrupt preexisting inbox
  rows during direct-write recovery;
- capped serialized inbox and dedup write records before returning/storing
  `Any`, and capped serialized shard sessions before storing them; and
- changed `InboxStorage.#ensureInboxRow()` to decode an existing row through
  bounded `readInboxMessage()` before deciding whether it matches.

Verification:

- red:
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

    failed with `Inbox message "0/1:message-1" already exists.` instead of
    `DeliveryStorageCorruptionError`; and

  - oversized shard-session writes:

    ```sh
    npx vitest run packages/server/test/delivery/sharded-work-registry.test.ts \
      -t 'rejects oversized shard sessions before storing them'
    ```

    failed because the write was accepted;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
    passed with 42 tests;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`; and
  - `git diff --check`; and
  - `git diff --unified=0 -- ... | awk '/^\\+[^+]/ { ... }'` for touched-file
    added-line length checks (no lines over 120 columns).

### Round 26

Reviewer input: round-26 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- code style/maintainability:
  `019f27d8-809b-7b13-af8d-1004e4b10cdd` (`CLEAN`, closed);
- documentation:
  `019f27d8-810e-7fc2-96d9-12872165f065` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f27d8-81a4-7782-8353-ffced4ea1ebe` (`CHANGES REQUESTED`, closed);
- security:
  `019f27d8-8212-7fd1-8e0c-b08482dd6f56` (`CHANGES REQUESTED`, closed); and
- performance/reliability:
  `019f27d8-8293-7e41-8330-9ca10404ae48` (`CHANGES REQUESTED`, closed).

Result: changes requested.

Findings to address:

- `build-protocol/DEVELOPER_API.md` omits public delivery/inbox types
  `InboxMessageError` and `InboxMessageInput`;
- inbox-row reads by storage slot still trust a self-consistent embedded record
  key instead of the requested storage key in direct existing-row collision and
  dedup guard recovery paths;
- shard-session reads by storage slot still trust a self-consistent embedded
  shard key instead of the requested shard slot in `pickUp()` and `release()`;
- inbox dedup recovery accepts an inbox row whose internal key/dedup pair is
  self-consistent but whose message identity does not match the guard target;
  and
- oversized signal/inbox/shard text is bounded only after large combined keys
  or serialized JSON are built.

Code style/maintainability was clean. Documentation, TypeScript/API docs,
security, and performance/reliability requested changes.

### Round 26 Fix

Result: implemented in this worktree.

Fix summary:

- added `InboxMessageError` and `InboxMessageInput` to the concise public
  delivery/inbox API section in `DEVELOPER_API.md`;
- extended inbox-row decoding with an optional expected storage key and used it
  in `InboxStorage.#ensureInboxRow()` and `InboxStorage.#readGuardMessage()` so
  wrong-slot inbox rows fail closed as `DeliveryStorageCorruptionError`;
- extended shard-session decoding with an optional expected storage key and
  used it in `ShardedWorkRegistry.pickUp()` and `ShardedWorkRegistry.release()`
  so wrong-slot session rows fail closed as corruption; and
- added simple early text bounds for inbox message IDs, signal IDs, inbox
  target identity fields, signal type URLs, and shard nodes before building
  large storage keys or serialized JSON, while preserving bounded stored-record
  reads.

Verification:

- red:
  - focused round-26 delivery regressions:

    ```sh
    pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts
    ```

    failed with the expected seven regressions before implementation:
    oversized signal IDs were accepted, oversized inbox target identity was
    accepted, wrong-slot direct inbox recovery raised
    `Inbox message "0/1:message-1" already exists.`, wrong-slot dedup recovery
    returned a duplicate result, oversized shard nodes were accepted, wrong-slot
    shard pickup returned `undefined`, and wrong-slot shard release returned
    `false`;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
    passed with 46 tests.

### Round 27

Reviewer input: round-27 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- code style/maintainability:
  `019f27ee-1170-7113-a1e1-2fe5a939fd0b` (`CHANGES REQUESTED`, closed);
- documentation: `019f27ee-120a-7ea2-a80f-06b3b0cf5209` (`CLEAN`, closed);
- TypeScript/API docs:
  `019f27ee-1276-7cb2-9346-b4850d3eab28` (`CLEAN`, closed);
- security: `019f27ee-1304-7843-9a75-2269e6a1dd7d` (`CHANGES REQUESTED`, closed);
- performance/reliability:
  `019f27ee-1382-7890-a88d-d39b9631b42c` (`CHANGES REQUESTED`, closed).

Result: changes requested.

Findings to address:

- `inbox.test.ts` added four one-off corrupt-guard `StorageFactory`
  subclasses even though the suite already had a parameterized
  `CorruptGuardFactory` / `CorruptGuardStorage` pair that could cover those
  cases, and the test-only `WrongMessageSlotGuardFactory` name exceeded the
  four-component limit;
- valid empty `Any.value` signal payloads serialize to the empty base64 string
  but stored signal reads reject empty strings as corruption; and
- stored signal payload reads still apply the generic `16 KiB` text cap rather
  than the base64-text length implied by the `256 KiB` signal payload limit, so
  valid payloads can write and later fail as corruption.

Documentation and TypeScript/API docs were clean. Code
style/maintainability, security, and performance/reliability requested
changes.

### Round 27 Fix

Result: implemented in this worktree.

Fix summary:

- replaced the one-off corrupt-guard factories in `inbox.test.ts` with direct
  `CorruptGuardFactory` setup and renamed the wrong-slot regression so no test
  helper name exceeds the four-component limit;
- added red-first inbox regressions for empty signal payload round-trips and
  valid `20 KiB` signal payload round-trips; and
- introduced one private stored-signal base64 validator that accepts empty
  base64 strings and uses the `maxSignalPayloadBytes`-derived base64 text cap,
  while leaving malformed/non-canonical/oversized payload rejection in the
  existing decode path.

Verification:

- red:
  - focused round-27 inbox regressions:

    ```sh
    pnpm test packages/server/test/delivery/inbox.test.ts
    ```

    failed with the expected two regressions before implementation:
    `writes and reads back an empty signal payload` failed with
    `Inbox signal payload must be a non-empty string.`, and
    `writes and reads back a signal payload larger than the generic text cap`
    failed with
    `Inbox signal payload exceeds 16384 bytes and cannot be stored.`;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    passed with 34 tests;
  - `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
    passed with 48 tests;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).

### Round 28

Reviewer input: round-28 reviewer results supplied to this fix worker.

Diff package:
`.superpowers/sdd/review-round-28-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f27f9-d19c-7e32-852c-0d982f037a10` (`CLEAN`, closed);
- documentation:
  `019f27f9-d237-7be3-948d-5c03ac000fa2` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f27f9-d2a6-77f0-8084-f43b1fca1955` (`CLEAN`, closed);
- security:
  `019f27f9-d31f-7112-b74b-775747016b3a` (`CHANGES REQUESTED`, closed); and
- performance/reliability:
  `019f27f9-d3ac-74b0-aaed-8274e5c5c0f5` (`CHANGES REQUESTED`, closed).

Result: changes requested.

Findings to address:

- durable task/report/work-log entries were one round behind the actual
  round-28 review package/current state;
- persisted inbox, dedup, and shard-session record bytes still use
  `Buffer.toString("utf8")`, which lossy-decodes invalid UTF-8 before
  `JSON.parse()`; and
- `InboxStorage.#recoverPendingClaim()` leaves a dedup key stuck `PENDING`
  when recovery races with a conflicting inbox-row create, so later retries can
  stay trapped behind the stale guard.

Code style/maintainability and TypeScript/API docs were clean. Documentation,
security, and performance/reliability requested changes.

### Round 28 Fix

Result: implemented in this worktree.

Fix summary:

- advanced `TASK.md`, `IMPLEMENTATION_REPORT.md`, and the durable work log to
  the actual round-28 review package/current state;
- added strict UTF-8 decoding immediately before `JSON.parse()` in the inbox /
  dedup and shard-session record readers so invalid bytes fail closed as
  `DeliveryStorageCorruptionError`; and
- rolled back stale pending dedup guards when
  `InboxStorage.#recoverPendingClaim()` fails before the guarded inbox row is
  durable, while preserving the earlier no-rollback rule for finalization-only
  failures.

Verification:

- red:
  - focused round-28 delivery regressions:

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
    the stored inbox row was accepted with a replacement-character signal type
    URL, the pending dedup guard recovered and returned `WRITTEN`, the
    recovery-conflict retry stayed trapped behind the stale pending guard, and
    shard pickup returned `undefined` for the invalid UTF-8 stored session;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
    passed with 52 tests;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).

### Round 29

Reviewer input: round-29 reviewer results supplied to this fix worker.

Diff package:
`.superpowers/sdd/review-round-29-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f280b-f05f-71d1-b4d7-efa46767182d` (`CLEAN`, closed);
- documentation:
  `019f280b-f0db-7891-b6de-5a41df3c040f` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f280b-f19d-7243-829c-027f52e26917` (`CHANGES REQUESTED`, closed);
- security:
  `019f280b-f21a-7a30-bff6-87c8729d42db` (`CHANGES REQUESTED`, closed); and
- performance/reliability:
  `019f280b-f28c-7d93-85a8-e16a1e7c944f` (`CHANGES REQUESTED`, closed).

Result: changes requested.

Findings to address:

- durable task/report/work-log entries were one round behind the actual
  round-29 review package/current state;
- `DEVELOPER_API.md` said `Inbox` both receives and reads while later
  describing a strict write/read split, so the wording needed to frame
  `Inbox` / `InboxStorage` as low-level delivery storage primitives rather than
  application-facing read-side facades;
- deleting a pending guard after recovery encounters a conflicting/corrupt
  inbox row permits replay under a new message ID; and
- inbox record serialization stringifies `version` without an early size check,
  and pending-guard retry behavior after the retained-guard fix was not yet
  covered.

Code style/maintainability was clean. Documentation, TypeScript/API docs,
security, and performance/reliability requested changes.

### Round 29 Fix

Result: implemented in this worktree.

Fix summary:

- advanced `TASK.md`, `IMPLEMENTATION_REPORT.md`, `DEVELOPER_API.md`, and the
  durable work log to the actual round-29 review package/current state;
- clarified that `Inbox` and `InboxStorage` are low-level delivery storage
  primitives in this slice, while preserving strict application/service/domain
  write/read segregation;
- kept pending dedup recovery fail-closed by retaining the canonical pending
  guard when recovery hits a conflicting/corrupt inbox row, so later retries
  surface conflict/corruption instead of writing a new live row under a new
  message ID; and
- rejected oversized stringified inbox `version` values before inbox/dedup
  record materialization and added focused retry/size regressions.

Verification:

- red:
  - focused round-29 guard/version regressions:

    ```sh
    pnpm exec vitest run packages/server/test/delivery/inbox.test.ts \
      -t 'fails closed when pending dedup recovery finds a conflicting inbox row'
    pnpm exec vitest run packages/server/test/delivery/inbox.test.ts \
      -t 'rejects oversized versions before building inbox or dedup records'
    ```

    failed with the expected two regressions before implementation: the retry
    after conflicting pending-guard recovery resolved `WRITTEN` with a new
    `message-2` live row, and oversized `version` values still serialized
    without an early rejection;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
    passed with 53 tests;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).

### Round 30

Reviewer input: round-30 reviewer results supplied to this fix worker.

Diff package:
`.superpowers/sdd/review-round-30-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2819-24ac-7e20-955e-3a3468b6ecb4` (`CHANGES REQUESTED`, closed);
- documentation:
  `019f2819-253c-73a1-ae66-7d59fe2808ec` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f2819-25e1-7f10-99f2-3af8ce1f579a` (`CLEAN`, closed);
- security:
  `019f2819-2659-7562-8369-0c20cf49b0a1` (`CHANGES REQUESTED`, closed); and
- performance/reliability:
  `019f2819-26ea-7eb2-9bce-3bfbfb886e09` (`CHANGES REQUESTED`, closed).

Result: changes requested.

Findings to address:

- `readStoredDedupRecord()`, `parseStoredInboxMessage()`, and
  `readStoredSession()` were still multi-responsibility parser hotspots past
  the method-size target;
- corruption/recovery helpers and scenario support still made
  `packages/server/test/delivery/inbox.test.ts` too monolithic;
- `RUNTIME_ARCHITECTURE.md` still overstated delivery integration by implying
  accepted commands/events can already be recorded before async delivery
  handoff, rather than describing the current standalone `Delivery` / `Inbox`
  / `ShardedWorkRegistry` slice;
- durable task/report/review/work-log state needed round-30 package/current
  state entries;
- write-side composed inbox/dedup keys could still exceed the `64 KiB`
  read-side invariant after escaping; and
- individually valid inputs could still overflow the pending dedup envelope
  without an explicit aggregate-budget rejection.

TypeScript/API docs was clean. Code style/maintainability, documentation,
security, and performance/reliability requested changes.

### Round 30 Fix

Result: implemented in this worktree.

Fix summary:

- split the inbox/dedup and shard-session parser bodies into smaller local
  read/validate/build helpers;
- moved shared inbox corruption/recovery doubles into
  `packages/server/test/delivery/inbox-test-support.ts` and added
  `packages/server/test/delivery/inbox-records.test.ts` for focused record
  limit regressions;
- narrowed `RUNTIME_ARCHITECTURE.md` to storage-level delivery primitives and
  async handoff without claiming CommandBus/EventBus integration;
- added explicit post-composition caps for `inboxKey()` and `dedupGuardKey()`
  to match the `64 KiB` read invariant; and
- added an explicit pending-dedup aggregate-budget rejection before generic
  record packing.

Verification:

- red:
  - focused round-30 record-limit regressions:

    ```sh
    pnpm test packages/server/test/delivery/inbox-records.test.ts
    ```

    failed with the expected three regressions before implementation:
    composed inbox keys and dedup keys still serialized without throwing, and
    the oversized pending dedup claim still failed with the generic
    `Inbox dedup record exceeds 524288 bytes and cannot be stored.` error;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    passed with 56 tests;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).
