# Review Log: T-0012.8 Delivery And Inbox

Status: round 61 post-commit docs cleanup committed at current HEAD
Previous completed commit: `a647db5`
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

Result: committed as `0235f0b`.

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

### Round 31

Reviewer input: round-31 reviewer results supplied to this fix worker.

Diff package:
`.superpowers/sdd/review-round-31-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f282d-a36a-7e53-ac93-9a88da9082e5` (`CHANGES REQUESTED`, closed);
- documentation:
  `019f282d-a3f3-7392-9c42-cf369fdef7df` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f282d-a466-79c0-a557-3735417a7582` (`CLEAN`, closed);
- security:
  `019f282d-a4db-72c0-aa8b-1bcd64aee2cc` (`CHANGES REQUESTED`, closed); and
- performance/reliability:
  `019f282d-a560-7762-b134-d00a8cbaec60` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- `packages/server/test/delivery/inbox-test-support.ts` was still a broad
  catch-all with a large exported surface and needed to be split by concern or
  have inbox-only doubles localized back into the spec that uses them;
- inbox message-ID text-budget validation was still duplicated between
  `packages/server/src/delivery/inbox-records.ts` and
  `packages/server/src/delivery/inbox-storage.ts`;
- durable task/report/review/work-log entries were stale against the round-31
  package/current state; and
- `InboxStorage.read()` still mapped `RecordStorage.query()` bare rows through
  `readInboxMessage(record)` without validating the actual backend slot, so a
  copied inbox row stored under a second key could be delivered again.

TypeScript/API docs and performance/reliability were clean. Code
style/maintainability, documentation, and security requested changes.

### Round 31 Fix

Result: implemented in this worktree.

Fix summary:

- replaced the catch-all `packages/server/test/delivery/inbox-test-support.ts`
  module with the narrower `inbox-message-fixture.ts` and
  `inbox-record-fixture.ts` helpers, and localized the inbox-only storage
  doubles back into `packages/server/test/delivery/inbox.test.ts`;
- centralized inbox message-ID validation in the exported
  `InboxMessageIdText` object so `inbox-records.ts` and `inbox-storage.ts`
  share one invariant;
- added `RecordStorage.queryEntries()` plus in-memory slot tracking, then used
  the actual queried storage slot in `InboxStorage.read()` to reject copied
  inbox rows stored under another backend key; and
- advanced the durable task/report/review/work-log state to the round-31
  package/current state.

Verification:

- red:
  - focused round-31 copied-row replay regression:

    ```sh
    pnpm test packages/server/test/delivery/inbox.test.ts
    ```

    failed with the expected regression before implementation:
    `rejects a queried inbox row copied under another backend key` resolved
    with two delivered `message-1` rows instead of rejecting the copied slot as
    storage corruption;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`
    passed with 68 tests;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).

### Round 32

Reviewer input: round-32 reviewer results supplied to this fix worker.

Diff package:
`.superpowers/sdd/review-round-32-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2843-0569-7df1-933f-eec1fbd6b628` (`CLEAN`, closed);
- documentation:
  `019f2843-0601-7e22-b480-fb61f64f13f3` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f2843-066c-7ed0-a608-5098760a8ad6` (`CHANGES REQUESTED`, closed);
- security:
  `019f2843-06fe-7bd0-adfb-26c8c82659af` (`CHANGES REQUESTED`, closed); and
- performance/reliability:
  `019f2843-0766-7f11-be63-b8f23e255e2c` (`CHANGES REQUESTED`, closed).

Result: changes requested.

Findings to address:

- durable task/report/review/work-log state was stale against the round-32
  package/current state;
- `Inbox.storage` publicly exposed the lower-level storage seam without
  explicitly documenting that this is an intentional escape hatch;
- `InboxStorage.write()` still raised a raw `Error` when a caller reused one
  inbox message ID with different contents;
- persisted out-of-range inbox/dedup timestamps still produced `Invalid Date`
  and could fail open in read/dedup paths;
- persisted out-of-range shard-session expiry timestamps still produced
  `Invalid Date` and could fail open in shard pickup/release paths;
- the default `RecordStorage.queryRecordEntries()` fallback still reconstructed
  entry IDs from record bodies instead of requiring adapters to report real
  storage-slot identities; and
- duplicate short-circuiting in `InboxStorage.write()` still skipped full
  caller-input validation, so malformed retries could resolve `DUPLICATE`
  instead of rejecting invalid input.

Code style/maintainability was clean. Documentation, TypeScript/API docs,
security, and performance/reliability requested changes.

### Round 32 Fix

Result: implemented in this worktree.

Fix summary:

- documented `Inbox.storage` as the intentional low-level storage escape hatch
  in code comments and `build-protocol/DEVELOPER_API.md`;
- changed direct inbox message-key reuse to raise `InboxMessageError` instead
  of a raw `Error`;
- validated full caller inbox input at the start of `InboxStorage.write()` by
  reusing the inbox/dedup serialization checks before any duplicate
  short-circuit;
- rejected out-of-range stored inbox `whenReceived` / `keepUntil` timestamps
  and shard-session `pickedUpAt` / `expiresAt` timestamps as storage
  corruption instead of materializing `Invalid Date`;
- removed the unsafe `RecordStorage.queryRecordEntries()` fallback so adapters
  must report actual storage-slot identities explicitly; and
- updated the affected storage/delivery regression tests plus the durable
  task/report/review/work-log state for the round-32 package.

Verification:

- red:
  - focused round-32 regressions:

    ```sh
    pnpm test packages/server/test/delivery/inbox.test.ts \
      -t 'rejects direct inbox writes that reuse an existing message key'
    pnpm test packages/server/test/delivery/inbox.test.ts \
      -t 'rejects malformed retries even when a live dedup guard already exists'
    pnpm test packages/server/test/delivery/inbox.test.ts \
      -t 'fails closed when stored inbox timestamps are out of range'
    pnpm test packages/server/test/delivery/inbox.test.ts \
      -t 'fails closed when stored dedup inbox timestamps are out of range'
    pnpm test packages/server/test/delivery/sharded-work-registry.test.ts \
      -t 'fails closed when a stored shard-session expiry time is out of range'
    pnpm test packages/storage/test/memory/in-memory-record-storage.test.ts \
      -t 'rejects query-entry adapters that do not provide slot identities'
    ```

    failed with the expected pre-fix regressions: direct message-key reuse
    still surfaced a raw `Error`, malformed retries still resolved
    `DUPLICATE`, stored out-of-range inbox timestamps still materialized
    `Date { NaN }`, stored out-of-range dedup retention still wrote a fresh
    live row, shard-session expiry corruption still resolved a replacement
    session, and query-entry adapters still silently reused the embedded record
    ID;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).

### Round 33

Reviewer input: round-33 reviewer results supplied to this fix worker.

Diff package:
`.superpowers/sdd/review-round-33-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f285c-d193-7d12-b56e-1d1e8726e320` (`CLEAN`, closed);
- documentation:
  `019f285c-d22b-7703-9785-bd738823aa48` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f285c-d2ae-78e2-90b1-e87b39eebdd5` (`CHANGES REQUESTED`, closed);
- security:
  `019f285c-d325-7f30-a8b1-2e4011efa42c` (`CLEAN`, closed); and
- performance/reliability:
  `019f285c-d3a1-7b92-98dd-e7d23242497c` (`CHANGES REQUESTED`, closed).

Result: changes requested.

Findings to address:

- durable task/report/review/work-log entries were stale against the round-33
  package;
- `DeliveryStorageCorruptionError` was raised from public delivery APIs but was
  not exported or documented beside `InboxMessageError`; and
- final dedup guard reads still accepted corrupt/out-of-range `keepUntilMs`
  instead of failing closed as `DeliveryStorageCorruptionError`.

### Round 33 Fix

Result: implemented in this worktree.

Fix summary:

- exported `DeliveryStorageCorruptionError` from the public server entrypoint
  and documented the delivery error contract beside `InboxMessageError`;
- added the red-first regression for out-of-range final dedup guard
  `keepUntilMs`; and
- validated final dedup `keepUntilMs` in the guard read path so corrupt values
  now fail closed as `DeliveryStorageCorruptionError`.

Verification:

- red:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `-- --runInBand -t "fails closed when final dedup guard keep-until`
    `timestamps are out of range"`
    failed before the production change because the corrupt guard still
    resolved `WRITTEN`;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).

### Round 34

Reviewer input: round-34 reviewer results supplied to this fix worker.

Diff package:
`.superpowers/sdd/review-round-34-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f286c-6540-7752-9b75-5021569fc77b` (`CHANGES REQUESTED`, closed);
- documentation:
  `019f286c-65cc-7a60-9526-2b0cfa1704d0` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f286c-6651-7701-a884-dd4a3ea7eec2` (`CHANGES REQUESTED`, closed);
- security:
  `019f286c-66bf-7651-b86a-fa08f4fa057c` (`CHANGES REQUESTED`, closed); and
- performance/reliability:
  `019f286c-6750-77f3-b3ba-a071e1b91cca` (`CHANGES REQUESTED`, closed).

Result: changes requested.

Findings to address:

- `RecordStorage` still exposed two protected query-extension points even
  though only `queryRecordEntries()` was a real runtime path, so adapters could
  still compile against the dead hook and fail at runtime;
- `packages/server/src/delivery/inbox-records.ts` still exported
  `InboxMessageIdText` and `validateInboxMessageInput` without a production
  need;
- durable task/report/review/work-log state was stale against the round-34
  package, and the review log needed the round-32/33/34 trail completed;
- `ShardedWorkRegistry.pickUp()` caller validation for blank or oversized
  `node` values still raised `DeliveryStorageCorruptionError` even though the
  public docs reserve that error for corrupt durable storage;
- corrupt persisted inbox composite-key checks could still surface
  `InboxMessageError` by recomputing canonical keys through input-side
  builders; and
- caller-side write validation still surfaced generic `Error` or
  `DeliveryStorageCorruptionError` for oversized inbox payloads or invalid
  caller timestamps instead of `InboxMessageError`.

### Round 34 Fix

Result: implemented in this worktree.

Fix summary:

- removed the dead `queryRecords()` hook and made `queryRecordEntries()` the
  single abstract record-query extension point for storage adapters;
- removed the exported `InboxMessageIdText` / `validateInboxMessageInput`
  helper surface and kept inbox message-ID/key validation local to
  `inbox-records.ts` and `InboxStorage.write()`;
- moved caller-side inbox payload/date/serialized-row validation onto
  `InboxMessageError`, and kept stored inbox/dedup key integrity checks on
  stored-only recomputation paths so corrupt durable rows remain
  `DeliveryStorageCorruptionError`;
- changed shard pickup caller validation for `node` / `now` to throw plain
  `Error` before storage access, and updated the delivery API docs to state
  that boundary explicitly; and
- advanced the durable task/report/review/work-log state to the round-34
  package/current fix.

Verification:

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
    `packages/storage/test/memory/in-memory-record-storage.test.ts`
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).

### Round 35

Reviewer input: round-35 reviewer results supplied to this fix worker.

Diff package:
`.superpowers/sdd/review-round-35-fce80b2-current.diff`.

Reviewer sub-agents:

- code style/maintainability:
  `019f2882-77ae-7550-8c5b-b613968b7a5b` (`CHANGES REQUESTED`, closed);
- documentation:
  `019f2882-7835-7cd1-a460-79721d41a6fc` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f2882-78a6-75b1-b5e6-acb69684af51` (`CLEAN`, closed);
- security:
  `019f2882-7928-70b3-a584-50f01ad07a69` (`CHANGES REQUESTED`, closed); and
- performance/reliability:
  `019f2882-79ae-7961-bb91-282ac6edca39` (`CHANGES REQUESTED`, closed).

Result: changes requested.

Findings to address:

- review-log sections around rounds 28-34 were no longer chronological and the
  review trail needed to be restored without dropping content;
- durable task/report/work-log state stopped at round 34 and needed the
  round-35 package/review/fix breadcrumb;
- fake shard-shaped caller input with invalid `index` / `ofTotal` could still
  be serialized into durable inbox/dedup records, and non-`Uint8Array`
  `Any.value` payloads could still pass through `Buffer.from(...)` coercion;
  and
- the pending dedup fast recovery/finalization path still skipped stored
  inbox-timestamp validation, so corrupt pending guards could be silently
  healed once the guarded inbox row already existed.

TypeScript/API docs was clean. Code style/maintainability, documentation,
security, and performance/reliability requested changes.

### Round 35 Fix

Result: implemented in this worktree.

Fix summary:

- restored chronological review-log ordering for rounds 28-34 and recorded the
  round-35 package/review/fix breadcrumb across the durable task/report/work
  logs;
- re-materialized caller shard input through real `ShardIndex` semantics before
  inbox/final-dedup serialization, so fake shard-shaped objects with invalid
  counts now fail early as `InboxMessageError`;
- required `Any.value` to already be `Uint8Array` before payload-size checks
  or base64 encoding, so invalid caller payload shapes fail as
  `InboxMessageError`; and
- validated stored inbox timestamps during pending dedup message parsing, so
  corrupt pending guards fail closed even when a durable inbox row already
  exists and recovery could otherwise finalize.

Verification:

- red:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    failed before the production change with the expected three regressions:
    corrupt pending guards still resolved `DUPLICATE`, fake shard-shaped caller
    input still serialized inbox/dedup rows, and non-`Uint8Array` signal
    payloads still serialized through `Buffer.from(...)`;
- green:
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`
    `packages/server/test/repository/aggregate-storage.test.ts`
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check`; and
  - `awk 'length($0) > 120 { ... }'` across the full touched-file set (no lines
    over 120 columns).

### Round 36

Reviewer input: round-36 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f2898-e089-7c10-a811-3828aed260f1` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f2898-e006-7a12-b134-b6b513d602ad` (`CHANGES REQUESTED`, closed);
- performance/reliability:
  `019f2898-e215-7293-a09a-2704f1daada7` (`CHANGES REQUESTED`, closed);
- security:
  `019f2898-e189-78d3-9d2c-8a0c892e283c` (`CHANGES REQUESTED`, closed); and
- TypeScript/API docs:
  `019f2898-e114-7c92-91bd-21b24573864f` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- durable task/report/review/work-log entries were still anchored to round 35
  and needed round-36 review/fix breadcrumbs;
- `TenantRecords.query()` was dead after storage query-entry cleanup;
- `ShardedWorkRegistry` should be the primary declaration before supporting
  `ShardSession` if feasible without churn;
- pending dedup recovery reused the inbox-row ensure path, so an expected inbox
  slot with different bytes but the same dedup key surfaced caller-input
  `InboxMessageError` instead of storage-corruption
  `DeliveryStorageCorruptionError`;
- `InboxStorage.write()` validated by serializing caller input, then derived
  keys and persisted records from the live caller object, allowing
  getter-backed objects to drift between calls; and
- `ShardedWorkRegistry.pickUp()` trusted `shard.key()` separately from
  `shard.index` / `shard.ofTotal`, allowing a fake shard object to claim one
  backend slot while persisting another shard.

### Round 36 Fix

Result: implemented in this worktree.

Fix summary:

- added red-first regressions for getter-backed inbox message drift,
  same-key pending recovery conflict error class, and fake shard key/coordinate
  disagreement;
- changed `InboxStorage.write()` to materialize one immutable validated inbox
  snapshot and use that snapshot for dedup keys, pending guards, inbox slots,
  and stored records;
- changed pending recovery conflicts against an expected inbox slot to raise
  `DeliveryStorageCorruptionError`;
- sanitized shard pickup input once through `ShardIndex` construction before
  using storage keys or writing sessions;
- removed dead `TenantRecords.query()`; and
- moved `ShardedWorkRegistry` ahead of `ShardSession`.

Verification:

- red:
  - `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand`
    `-t 'writes one immutable snapshot when caller getters drift after`
    `validation|fails closed when pending dedup recovery finds same-key`
    `conflicting inbox bytes'` failed before production changes because
    getter-backed caller values drifted into storage and same-key recovery
    conflict raised `InboxMessageError`;
  - `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
    `-- --runInBand -t 'sanitizes shard pickup input once when caller key`
    `disagrees with shard coordinates'` failed before production changes
    because fake shard key `0/2` claimed a session while persisting shard
    coordinates `1/2`;
- green:
  - the same focused commands passed after production changes;
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

### Round 37

Reviewer input: round-37 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- code style/maintainability:
  reviewer lane closed with changes requested;
- documentation:
  reviewer lane closed with changes requested;
- TypeScript/API docs:
  reviewer lane closed with changes requested;
- security:
  reviewer lane closed with changes requested; and
- performance/reliability:
  reviewer lane closed with changes requested.

Result: changes requested.

Findings addressed by commit `4a97dd9`:

- work-log state was stale after commit `c0c319b`;
- the implementation report tail had non-chronological material;
- exported `ShardIndex` and `ShardSession` constructor-parameter properties
  needed public TSDoc;
- getter-backed signal payloads could pass validation with a small payload and
  persist a later larger payload; and
- invalid shard pickup input opened storage before validation.

### Round 37 Fix

Result: committed as `4a97dd9`.

Fix summary:

- captured optional inbox signals once before validation/serialization and
  enforced the signal payload cap inside `packSignal()`;
- validated shard pickup input before opening storage;
- added TSDoc for exported shard constructor properties;
- restored implementation-report chronology; and
- advanced durable task/report/work-log state through round 37.

### Round 38

Reviewer input: round-38 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- TypeScript/API docs:
  `019f28b8-47bf-7c43-954e-9f3fbcd9e2ee` (`CHANGES REQUESTED`, closed);
- documentation:
  `019f28b8-1b73-7312-bdd6-5cad1862b9bd` (`CHANGES REQUESTED`, closed);
- security:
  `019f28b8-7550-7a22-85b9-0d9a47698d30` (`CHANGES REQUESTED`, closed);
- performance/reliability:
  `019f28b8-a328-77f0-b90d-9324b3f4c7ee` (`CHANGES REQUESTED`, closed); and
- code style/maintainability:
  `019f28b7-e29e-7b82-b5d8-5d7fae29d7bf` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- `DeliveryStorageCorruptionError` was exported and documented in
  `DEVELOPER_API.md` but missing from `scripts/check-api-docs.mjs` and
  `docs/api/README.md`;
- durable task/report/review/work logs were not current through committed
  round 37;
- inbox-record serialization still re-read mutable caller fields after
  validation, and public `version` / `Date` inputs were used before explicit
  type checks; and
- final dedup guard status/retention validation did not participate in
  blocking, so a live final guard paired with an expired inbox row could be
  replaced.

### Round 38 Fix

Result: committed as `0efeccb`.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `'uses caller getter drift as one inbox input snapshot|rejects structural`
  `caller timestamps as inbox message errors|rejects structural caller`
  `versions before building inbox or dedup records|blocks on a live final`
  `dedup guard even when the inbox row is expired'` failed before production
  changes because structural date/version values were accepted, caller
  `inboxId` drift reached storage, and a live final dedup guard was replaced
  with a new written message.

Fix summary:

- added `DeliveryStorageCorruptionError` to API docs and export expectations;
- refreshed durable state through committed round 37 and current round 38;
- snapshot caller inbox record input once before stored row construction;
- validate public `Date` and `bigint` inputs explicitly as
  `InboxMessageError`; and
- use final dedup guard status/retention fields consistently for blocking.

Verification:

- green:
  - the same focused red-first command passed after production changes;
  - `pnpm test packages/server/test/delivery/inbox.test.ts`
    `packages/server/test/delivery/inbox-records.test.ts`
    `packages/server/test/delivery/sharded-work-registry.test.ts`
    `packages/storage/test/memory/in-memory-record-storage.test.ts`
    `packages/server/test/repository/aggregate-storage.test.ts`;
  - `pnpm typecheck`;
  - `pnpm lint`;
  - `pnpm format:check`;
  - `git diff --check fce80b2..HEAD`; and
  - touched-file line scan with no lines over 120 columns.

### Round 39

Reviewer input: round-39 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f28c7-56b2-7a01-a19a-45a7cd02f6f2` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f28c7-2402-7021-8532-94d1604f9dda` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f28c7-88fa-7eb1-9348-ecdb6147d91d` (`CHANGES REQUESTED`, closed);
- performance/reliability:
  `019f28c7-e92c-7353-a21b-a7bfca18148b` (`CHANGES REQUESTED`, closed); and
- security:
  `019f28c7-b5de-70b3-835e-1610a981cc2e` (`CHANGES REQUESTED`, closed).

Result: changes requested.

Findings to address:

- durable task/report/review/work logs were not current with committed
  round-38 state at `0efeccb`;
- `RecordEntry` is exported from `@spine-ts/storage` but missing from the API
  docs and expected export guard, while still listed as forbidden;
- pending dedup finalization accepted a visible inbox row with the same
  dedup/message key but different canonical bytes; and
- `ShardedWorkRegistry.release()` repeatedly trusted mutable caller session
  fields instead of one canonical shard/id/node snapshot.

### Round 39 Fix

Result: committed as `72df1a4`.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `-- --runInBand -t 'fails closed when pending dedup guard and visible`
  `inbox row bytes differ|uses one canonical release snapshot when caller`
  `session shard drifts'` failed before production changes. The pre-fix inbox
  path resolved `DUPLICATE` from same-key conflicting bytes, and shard release
  returned `false` after caller shard drift.

Fix summary:

- added `RecordEntry` to storage API docs and export expectations, and removed
  it from the forbidden storage TypeDoc list;
- required pending dedup guard finalization to compare the visible inbox row
  bytes with the guard's embedded canonical inbox message; and
- snapshot `ShardedWorkRegistry.release()` session shard/id/node once before
  storage read, validation, and compare-and-set delete.

Focused verification:

- the same focused red-first command passed after production changes.

Final verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` passed with
  `129` tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

`node scripts/check-api-docs.mjs` still emitted the existing invalid `origin`
TypeDoc source-link warning, but exited successfully.

### Round 40

Reviewer input: round-40 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f28d5-7939-7b41-9cfd-4cf60237c8df` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f28d5-4389-7bb2-913c-7bea38014353` (`CHANGES REQUESTED`, closed);
- security:
  `019f28d5-efe7-7d21-8572-0c5dbcff495e` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f28d5-b7f3-72a1-ab3f-fa5e16a3c4ed` (`CLEAN`, closed); and
- performance/reliability:
  `019f28d6-2f90-79b2-a3d4-a74f472f5bea` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- durable task/report/review/work logs were not current with committed
  round-39 state at `72df1a4`;
- `inbox-records.ts` exported unused `dedupMessageId()` with no production or
  test caller;
- `Inbox`, `RecordStorage`, and `TenantRecords` support declarations preceded
  their filename-matching primary declarations; and
- `InboxStorage` trusted invalid `now()` values during dedup retention checks,
  allowing a live delivered dedup guard to be treated as non-blocking.

### Round 40 Fix

Result: implemented in this worktree.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `'rejects invalid storage clocks before live dedup retention decisions'`
  failed before production changes because the duplicate write resolved
  `WRITTEN`.

Fix summary:

- added the invalid-clock regression;
- validated `InboxStorage.now()` before dedup retention decisions and
  pending-guard dedup mutations;
- removed the unused exported `dedupMessageId()` helper;
- moved primary declarations ahead of supporting declarations in
  `inbox.ts`, `record-storage.ts`, and `tenant-records.ts`; and
- refreshed durable logs through the committed round-39 and current round-40
  state.

Focused verification:

- the same focused red-first command passed after production changes.

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

Result: committed as `3a05e4b` after verification.

### Round 41

Reviewer input: round-41 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f28e3-0c57-7ed1-8358-77d730d9060f` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f28e2-d864-75b0-a8a2-86e7a616684f` (`CLEAN`, closed);
- TypeScript/API docs:
  `019f28e3-3f97-7cb3-b26a-18236fc578e3` (`CLEAN`, closed);
- security:
  `019f28e3-6f4b-7b42-a888-009deb44163e` (`CLEAN`, closed); and
- performance/reliability:
  `019f28e3-9d09-7d32-ac8f-8868d0bed58c` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- durable task/report/review/work logs named the round-40 fix only as the
  final task commit or as happening after verification instead of explicitly
  naming committed round-40 fix commit `3a05e4b`.

### Round 41 Fix

Result: committed as `e55c26f`.

Fix summary:

- named `3a05e4b` explicitly in the current committed round-40 state; and
- recorded the round-41 documentation-only fix trail.

### Round 42

Reviewer input: round-42 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f28e9-9453-7653-8fed-10e021dbe699` (`CHANGES REQUESTED`, closed);
- performance/reliability:
  `019f28ea-2ec9-7b91-9994-94ceeb0d4064` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f28e9-5da3-7c32-a1ba-e75ac4a8a9e7` (`CLEAN`, closed);
- TypeScript/API docs:
  `019f28e9-d018-7243-854c-b6dd735c5b86` (`CLEAN`, closed); and
- security:
  `019f28e9-ff05-71b0-bb10-7d0a36e326a1` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- durable logs still described the round-41 documentation fix as ready to
  commit even though it was already committed as `e55c26f`; and
- corrupt final dedup guards could allow duplicate writes when their
  status/retention metadata disagreed with the visible inbox row.

### Round 42 Fix

Result: implemented in this worktree.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `'fails closed when final dedup guard metadata differs from the visible`
  `inbox row'` failed before production changes because the retry resolved
  `WRITTEN` for `message-2`.

Fix summary:

- final dedup guard reads now require guard status/retention metadata to match
  the visible inbox row before dedup blocking or replacement decisions; and
- durable task/report/review/work logs now record committed round-41 state.

Focused verification:

- the same focused red-first command passed after production changes.

### Round 43

Reviewer input: round-43 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f28f3-24b2-7a22-87c7-15adabd06948` (`CHANGES REQUESTED`, closed);
- maintainability:
  `019f28f2-ec65-7291-b507-a6d06266c538` (`CHANGES REQUESTED`, closed);
- security:
  `019f28f3-8db6-75e1-bef9-930ca1cb9d25` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f28e9-5da3-7c32-a1ba-e75ac4a8a9e7` (`CLEAN`, closed);
- TypeScript/API docs:
  `019f28f3-587a-71e1-b181-1798ee23ca6d` (`CLEAN`, closed); and
- performance/reliability:
  `019f28f3-bef5-7473-9be3-57f55497e288` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- durable logs still described round 42 as current-worktree state even though
  it was committed as `0235f0b`; and
- proxy-backed caller `Uint8Array` payloads and `Date` timestamps could leak
  raw `TypeError` instead of `InboxMessageError` through public inbox writes.

### Round 43 Fix

Result: committed as `4307077` after controller verification.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `proxy-backed` failed before production changes because both proxy
  regressions observed raw `TypeError` instead of `InboxMessageError`.

Fix summary:

- caller byte validation now snapshots valid `Uint8Array` inputs through
  `Buffer.from()` and wraps proxy trap failures as `InboxMessageError`;
- caller timestamp validation now wraps `Date.getTime()` proxy trap failures as
  `InboxMessageError`; and
- durable task/report/review/work logs now record committed round-42 state and
  this round-43 fix trail.

Focused verification:

- the same focused proxy-backed command passed after production changes.

### Post-Round 43 Durable Log Fix

Result: docs/protocol-log only.

Fix summary:

- durable task/report/review/work logs now name `4307077` as the committed and
  verified round-43 fix instead of describing round 43 as handoff state; and
- durable logs record that docs-only log-maintenance commits cannot contain
  their own final hash. Name completed feature/fix commits once known; identify
  the current log-maintenance commit by package HEAD or `git log`.

Result: committed as `bc1f3a5`.

### Round 44

Reviewer input: round-44 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f2901-74bd-7fc0-a09b-33fe9dd41650` (`CHANGES REQUESTED`, closed);
- performance/reliability:
  `019f2902-0b2c-7e03-874c-a13b9e795a62` (`CHANGES REQUESTED`, closed);
- security:
  `019f2901-d9e1-7002-8e98-c386c9f0a3b5` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f2901-3b25-7851-9570-f484b3534dbe` (`CLEAN`, closed); and
- TypeScript/API docs:
  `019f2901-aa96-7873-82fd-05343ce71ff3` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- work-log current state still said the next step was committing the
  post-round-43 durable-log fix, even though package HEAD `bc1f3a5` already
  contained that fix;
- corrupt stored inbox/dedup/shard-session shard coordinates could escape as
  plain `Error`; and
- corrupt stored inbox/dedup/shard-session `Any` envelopes could escape as raw
  `TypeError` or generic storage clone errors instead of
  `DeliveryStorageCorruptionError`.

### Round 44 Fix

Result: committed as `641a47a`.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `-- --runInBand -t 'classifies corrupt stored inbox Any envelopes|`
  `classifies corrupt stored inbox shard coordinates|classifies corrupt`
  `stored dedup Any envelopes|classifies corrupt stored dedup shard`
  `coordinates|classifies corrupt stored shard-session Any envelopes|`
  `classifies corrupt stored shard-session coordinates'` failed before
  production changes because the paths surfaced raw `TypeError`, plain
  `Error`, or a generic storage clone error instead of
  `DeliveryStorageCorruptionError`.

Fix summary:

- stored inbox and dedup parsers validate `Any.value` before size/UTF-8 reads;
- stored inbox and dedup shard-coordinate construction failures now wrap as
  `DeliveryStorageCorruptionError`;
- shard-session reads classify malformed durable session `Any` rows and
  invalid durable session coordinates as `DeliveryStorageCorruptionError`; and
- durable logs now name committed post-round-43 log state `bc1f3a5`.

Focused verification:

- the same focused red-first command passed after production changes.

### Round 45

Reviewer input: round-45 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f2910-0b92-7fd1-b5ba-3fe1fa39eda8` (`CHANGES REQUESTED`, closed);
- security:
  `019f2910-778c-7ae3-a078-f2ebe22af3af` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f290f-c65d-7ae3-a856-a854ef2177b9` (`CLEAN`, closed);
- TypeScript/API docs:
  `019f2910-4447-7530-8d15-1d62b83dad53` (`CLEAN`, closed); and
- performance/reliability:
  `019f2910-c1f4-7d11-8ed2-04a7eec78ebc` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- developer API text used present-tense delivery-worker wording for inbox
  consumption even though this slice excludes worker loops;
- stored inbox/dedup/session `Any.typeUrl` accessor failures could escape as
  raw errors before durable corruption wrapping; and
- caller signal `typeUrl` accessor failures could escape as raw errors before
  public inbox input wrapping.

### Round 45 Fix

Result: implemented in this current commit. Because a commit cannot pre-record
its own final hash, identify the committed round-45 fix by package HEAD or
`git log`.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts` failed before
  production changes because the four new accessor regressions observed raw
  `Error: type URL getter failed` instead of `InboxMessageError` or
  `DeliveryStorageCorruptionError`.

Fix summary:

- stored inbox/dedup/session envelope type URL reads now use private wrappers
  that preserve `DeliveryStorageCorruptionError`;
- caller signal type URL reads now use a private wrapper that preserves
  `InboxMessageError`; and
- developer API wording now says framework delivery code can read durable rows
  by shard and a future delivery worker can consume them.

Focused verification:

- the same focused delivery command passed after production changes with
  `93` tests.

Final verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` passed with
  `133` tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

`node scripts/check-api-docs.mjs` still emitted the existing invalid `origin`
TypeDoc source-link warning, but exited successfully.

Result: committed as `e93d165`.

### Round 46

Reviewer input: round-46 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f2920-562c-7940-ae5a-b94169d32fc7` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f291f-c882-7132-b450-39dd93beb339` (`CHANGES REQUESTED`, closed);
- performance/reliability:
  `019f2921-042f-7313-a5ce-13234d0450aa` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f2920-9814-7b22-be9b-df781353453f` (`CLEAN`, closed); and
- security:
  `019f2920-ca32-7773-8036-a4881030d286` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- root README still described delivery/Inbox as deferred, even though the first
  durable delivery/inbox slice now exists;
- durable logs still said the next step was committing round 45, even though
  package HEAD was `e93d165`;
- `inbox-records.ts` exported standalone inbox/dedup record helper functions
  without a recorded exception; and
- final verification did not record
  `packages/server/test/delivery/shard-index.test.ts`.

### Round 46 Fix

Result: committed as `cd2b13b`.

Fix summary:

- README status now records the first durable delivery/inbox slice while
  keeping worker loops and delivery execution deferred;
- exported record helpers are grouped behind `InboxRecords` and
  `DedupRecords`; and
- durable task/report/review/work logs now name committed round-45 state
  `e93d165` and record this round-46 fix trail.

Final verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` passed with
  `135` tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

`node scripts/check-api-docs.mjs` still emitted the existing invalid `origin`
TypeDoc source-link warning, but exited successfully.

### Round 47

Reviewer input: round-47 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f292f-b109-7ac1-8160-ebd2d819cc58` (`CHANGES REQUESTED`, closed);
- security:
  `019f2930-2de7-71b0-bd42-b48b10a4ae65` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f292f-6b1c-7f42-9505-b36dc6a56009` (`CLEAN`, closed);
- TypeScript/API docs:
  `019f292f-f3b4-73f1-977e-e14e4ebb276a` (`CLEAN`, closed); and
- performance/reliability:
  `019f2930-688b-7011-8028-da8560b46f38` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- the work log still said the next step was committing the current round-46
  fix, even though package HEAD was `cd2b13b`; and
- `snapshotInboxMessage()` read top-level caller `InboxMessage` properties
  directly before the guarded input snapshot, letting proxy/getter failures
  leak as raw errors from the public write path.

### Round 47 Fix

Result: implemented in this current commit. Because a commit cannot pre-record
its own final hash, identify the committed round-47 fix by package HEAD or
`git log`.

Fix summary:

- added a red-first public write-path regression for a top-level caller field
  getter that previously leaked raw `Error: signal ID getter failed`;
- routed top-level caller inbox message property reads through an
  `InboxMessageError` boundary before validation and serialization; and
- durable task/report/review/work logs now name committed round-46 state
  `cd2b13b` and record this round-47 fix trail.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts` failed before
  production changes with one failing regression.

Focused verification:

- the same focused delivery command passed after production changes with
  `60` tests.

Final verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` passed with
  `136` tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

`node scripts/check-api-docs.mjs` still emitted the existing invalid `origin`
TypeDoc source-link warning, but exited successfully.

### Round 48

Reviewer input: round-48 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f293a-cadf-7790-b2f1-55861a5892a6` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f293b-097a-7a03-83b1-51d732c7634a` (`CHANGES REQUESTED`, closed);
- security:
  `019f293b-4f29-7440-b14f-4e2012c851cf` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f293a-8787-7e31-a8c5-8294e279dbb4` (`CLEAN`, closed); and
- performance/reliability:
  `019f293b-87c5-7a72-9adb-7762f61b22fc` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- durable logs still described round 47 as pending even though package HEAD
  was `da705d4`;
- `packSignal()` read caller-controlled `signal.value` directly, allowing
  getter/proxy failures to escape raw; and
- `Inbox.receive()` spread public input before delegating to storage, allowing
  top-level getter failures to escape raw.

### Round 48 Fix

Result: committed as `d3bdfae`.

Fix summary:

- added red-first regressions for caller signal `value` getter failures and
  public receive input getter failures;
- public receive input is now snapshotted through an `InboxMessageError`
  boundary before storage delegation;
- signal packing now reads caller payload values through the guarded input
  property reader; and
- durable task/report/review/work logs now name committed round-47 state
  `da705d4` and record this round-48 fix trail.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `'signal value accessor|top-level receive input'` failed before production
  changes because both new tests observed raw getter `Error` values instead of
  `InboxMessageError`.

Focused verification:

- the same focused delivery command passed after production changes with
  `62` tests.

Final verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` passed with
  `138` tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

`node scripts/check-api-docs.mjs` still emitted the existing invalid `origin`
TypeDoc source-link warning, but exited successfully.

### Round 49

Reviewer input: round-49 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation:
  `019f2946-4919-7020-b20b-f4b7e88aaa43` (`CHANGES REQUESTED`, closed);
- code style/maintainability:
  `019f2945-ffa9-7bf0-a10f-5715550470f9` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f2946-875d-7033-85ee-a910b6ed86b8` (`CLEAN`, closed);
- security:
  `019f2946-ca77-7872-9444-0d64d82aa6fb` (`CLEAN`, closed); and
- performance/reliability:
  `019f2947-04f8-7d70-999b-9d3ff025487c` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- durable logs still said the next step was to commit round 48 even though
  package HEAD was `d3bdfae`; and
- public `Inbox.receive()` could throw top-level input snapshot failures
  synchronously before returning its documented `Promise<InboxWriteResult>`.

### Round 49 Fix

Result: committed as `855e54e`.

Fix summary:

- changed the top-level `Inbox.receive()` accessor regression to assert the
  returned promise rejects directly;
- made `Inbox.receive()` async so public input snapshot failures reject through
  the returned promise; and
- durable task/report/review/work logs now name committed round-48 state
  `d3bdfae` and record this round-49 fix trail.

Red-first verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts -- --runInBand -t`
  `'rejects top-level receive input accessor failures as inbox message errors'`
  failed before production changes because `Inbox.receive()` threw
  `InboxMessageError` synchronously.

Focused verification:

- the same focused delivery command passed after production changes with
  `62` tests.

Final verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` passed with
  `138` tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

`node scripts/check-api-docs.mjs` still emitted the existing invalid `origin`
TypeDoc source-link warning, but exited successfully.

### Round 50

Reviewer input: round-50 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- code style/maintainability:
  `019f2950-e09e-79d2-af00-c1483bf08a42` (`CHANGES REQUESTED`, closed);
- documentation:
  `019f2951-1f69-7533-b262-f6e0b7c9211a` (`CHANGES REQUESTED`, closed);
- TypeScript/API docs:
  `019f2951-579e-7e11-8578-e20ca3d3871a` (`CLEAN`, closed);
- security:
  `019f2951-9347-7fc2-bb53-7d547f771c1e` (`CLEAN`, closed); and
- performance/reliability:
  `019f2951-c6a9-7350-a06b-e15c703fbcbc` (`CLEAN`, closed).

Result: changes requested.

Findings to address:

- review-log tail placed Round 49 before Round 40;
- `IMPLEMENTATION_REPORT.md` omitted the final round-49 suite/static/API/diff
  verification summary; and
- `inbox-records.ts` placed support declarations/specs before the
  filename-matching primary `InboxRecords` declaration.

### Round 50 Fix

Result: committed as `5a00b30`.

Fix summary:

- restored semantic chronological order for review-log rounds 40 through 49;
- added the missing final round-49 verification summary to the implementation
  report and named committed round-49 state `855e54e`; and
- moved `InboxRecords` before supporting stored-record declarations and
  exported record specs.

Final verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts` passed with
  `138` tests;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

`node scripts/check-api-docs.mjs` still emitted the existing invalid `origin`
TypeDoc source-link warning, but exited successfully.

### Round 51

Reviewer input: round-51 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- security: `round-51-security` (`CHANGES REQUESTED`, supplied); and
- documentation: `round-51-documentation` (`CHANGES REQUESTED`, supplied).

Result: changes requested.

Findings to address:

- durable inbox and dedup reads in `packages/server/src/delivery/inbox-storage.ts`
  let `RecordStorage.queryEntries()` / `read()` clone/materialization failures
  escape as raw storage errors instead of
  `DeliveryStorageCorruptionError`; and
- implementation/report/work-log durable state still reflected committed round
  49 at `855e54e`, and this report tail needed explicit round-51 tracking.

### Round 51 Fix

Result: committed as `dd04528`.

Fix summary:

- added red-first inbox regressions for queried inbox-row clone failure, dedup
  guard clone failure, conflicting inbox-row clone failure, and guarded inbox
  row clone failure;
- wrapped durable inbox/dedup `RecordStorage.queryEntries()` and `read()`
  boundaries behind one private `InboxStorage` helper that translates only
  `"Storage record could not be cloned."` into
  `DeliveryStorageCorruptionError`; and
- refreshed durable task/report/review/work logs for committed round 50 at
  `5a00b30` and this round-51 fix trail.

### Round 52

Reviewer input: round-52 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- security: `round-52-security` (`CHANGES REQUESTED`, supplied);
- maintainability: `round-52-maintainability` (`CHANGES REQUESTED`, supplied);
- TypeScript/API docs: `round-52-typescript-api-docs`
  (`CHANGES REQUESTED`, supplied); and
- documentation: `round-52-documentation` (`CHANGES REQUESTED`, supplied).

Result: changes requested.

Findings to address:

- dedup compare-and-set paths in `packages/server/src/delivery/inbox-storage.ts`
  still let clone/materialization failures escape as raw storage errors during
  pending recovery and dedup re-claim/finalization;
- `#claimAndWrite()` can mask the original inbox-write failure if the rollback
  compare-and-set throws;
- new durable clone-failure test helper names exceeded the four-component
  naming limit;
- `packages/server/test/index.test.ts` omitted
  `DeliveryStorageCorruptionError` from the expected root export snapshot; and
- implementation/report/work-log durable state still reflected round 51 as a
  verified-but-uncommitted current pass instead of committed `dd04528`.

### Round 52 Fix

Result: completed and closed after commit `fdf079e`.

Fix summary:

- added red-first inbox regressions for pending dedup recovery compare-and-set
  clone failure, dedup re-claim compare-and-set clone failure, and rollback
  preserving the original inbox-write error;
- wrapped durable dedup `RecordStorage.compareAndSet()` boundaries behind one
  private `InboxStorage` helper that translates storage clone/materialization
  failures into `DeliveryStorageCorruptionError`;
- preserved the original inbox-write failure when best-effort dedup rollback
  throws;
- shortened the new clone-failure test helper names to `CloneFailFactory`,
  `CloneFailPlan`, and `CloneFailStorage`;
- restored `DeliveryStorageCorruptionError` to the package export snapshot; and
- refreshed durable task/report/review/work logs for committed round 51 at
  `dd04528` and this round-52 fix trail.

Red-first verification:

- `pnpm exec vitest run packages/server/test/delivery/inbox.test.ts -t`
  `'translates queried inbox row clone failures into storage corruption'`
  failed before production changes because the new regression observed raw
  `Error: Storage record could not be cloned.` instead of
  `DeliveryStorageCorruptionError`.

Focused verification:

- `pnpm exec vitest run packages/server/test/delivery/inbox.test.ts -t`
  `'translates queried inbox row clone failures into storage corruption'`
  passed;
- `pnpm exec vitest run packages/server/test/delivery/inbox.test.ts -t`
  `'translates dedup guard clone failures into storage corruption'` passed;
- `pnpm exec vitest run packages/server/test/delivery/inbox.test.ts -t`
  `'translates conflicting inbox row clone failures into storage corruption'`
  passed; and
- `pnpm exec vitest run packages/server/test/delivery/inbox.test.ts -t`
  `'translates guarded inbox row clone failures into storage corruption'`
  passed.

Final verification:

- `pnpm test packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts`;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

`node scripts/check-api-docs.mjs` still emitted the existing invalid `origin`
TypeDoc source-link warning, but exited successfully.

### Round 53

Reviewer input: round-53 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- performance/reliability: `round-53-performance-reliability`
  (`CHANGES REQUESTED`, supplied);
- maintainability: `round-53-maintainability` (`CHANGES REQUESTED`, supplied);
- TypeScript/API docs: `round-53-typescript-api-docs`
  (`CHANGES REQUESTED`, supplied); and
- documentation: `round-53-documentation` (`CHANGES REQUESTED`, supplied).

Result: changes requested.

Findings to address:

- `packages/server/src/delivery/inbox-storage.ts` still has unbounded
  compare-and-set retry loops in `#writeWithDedup()` and `#ensureInboxRow()`,
  so persistent compare-and-set misses can hang `write()` forever;
- `packages/server/src/delivery/sharded-work-registry.ts` still has unbounded
  compare-and-set retry loops in `pickUp()` and `release()`, so persistent
  compare-and-set misses can hang shard coordination forever;
- `InboxStorage.#ensureInboxRow()` still calls raw
  `inboxStorage.compareAndSet()` and lets inbox compare-and-set
  clone/materialization failures escape as raw storage errors instead of
  `DeliveryStorageCorruptionError`; and
- task/report/work-log durable state still reflected round 52 as a
  verified-but-uncommitted current pass instead of committed `fdf079e`.

### Round 53 Fix

Result: completed and closed after commit `c2e67c6`.

Fix summary:

- added red-first inbox regressions for persistent dedup-guard compare-and-set
  misses, persistent inbox-row compare-and-set misses, and inbox-row
  compare-and-set clone-failure classification;
- added red-first shard-registry regressions for persistent shard pickup and
  shard release compare-and-set misses;
- bounded inbox and shard compare-and-set retry loops behind small private
  retry limits so persistent misses fail with explicit exhaustion errors
  instead of looping forever;
- routed `InboxStorage.#ensureInboxRow()` create compare-and-set through the
  existing durable compare-and-set helper so inbox clone/materialization
  failures stay classified as `DeliveryStorageCorruptionError`; and
- refreshed durable task/report/review/work logs for committed round 52 at
  `fdf079e` and this round-53 fix trail.

Red-first verification:

- `perl -e 'alarm shift @ARGV; exec @ARGV' 5 pnpm exec vitest run`
  `packages/server/test/delivery/inbox.test.ts -t`
  `'fails clearly when dedup guard compare-and-set keeps missing'`
  failed before production changes because the regression hung until the
  5-second alarm terminated the process after only the Vitest `RUN` banner;
- `perl -e 'alarm shift @ARGV; exec @ARGV' 5 pnpm exec vitest run`
  `packages/server/test/delivery/inbox.test.ts -t`
  `'fails clearly when inbox row compare-and-set keeps missing'`
  failed before production changes because the regression hung until the
  5-second alarm terminated the process after only the Vitest `RUN` banner;
- `perl -e 'alarm shift @ARGV; exec @ARGV' 5 pnpm exec vitest run`
  `packages/server/test/delivery/sharded-work-registry.test.ts -t`
  `'fails clearly when shard pickup compare-and-set keeps missing'`
  failed before production changes because the regression hung until the
  5-second alarm terminated the process after only the Vitest `RUN` banner;
- `perl -e 'alarm shift @ARGV; exec @ARGV' 5 pnpm exec vitest run`
  `packages/server/test/delivery/sharded-work-registry.test.ts -t`
  `'fails clearly when shard release compare-and-set keeps missing'`
  failed before production changes because the regression hung until the
  5-second alarm terminated the process after only the Vitest `RUN` banner; and
- `pnpm exec vitest run packages/server/test/delivery/inbox.test.ts -t`
  `'classifies inbox compare-and-set clone failures as storage corruption'`
  failed before production changes because the regression observed raw
  `Error: Storage record could not be cloned.` instead of
  `DeliveryStorageCorruptionError`.

Focused verification:

- `pnpm exec vitest run packages/server/test/delivery/inbox.test.ts -t`
  `'fails clearly when dedup guard compare-and-set keeps missing|`
  `fails clearly when inbox row compare-and-set keeps missing|`
  `classifies inbox compare-and-set clone failures as storage corruption'`
  passed after the production change; and
- `pnpm exec vitest run packages/server/test/delivery/sharded-work-registry.test.ts -t`
  `'fails clearly when shard pickup compare-and-set keeps missing|`
  `fails clearly when shard release compare-and-set keeps missing'`
  passed.

### Round 54

Reviewer input: round-54 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- performance/reliability: `round-54-performance-reliability`
  (`CHANGES REQUESTED`, supplied);
- maintainability: `round-54-maintainability` (`CHANGES REQUESTED`, supplied);
- documentation: `round-54-documentation` (`CHANGES REQUESTED`, supplied).

Result: changes requested.

Findings to address:

- `packages/server/src/delivery/inbox-storage.ts` and
  `packages/server/src/delivery/sharded-work-registry.ts` still exposed the
  internal phrase `compare-and-set retry budget exhausted.` in caller-facing
  errors;
- `packages/server/test/delivery/sharded-work-registry.test.ts` was missing
  regression coverage proving thrown non-CAS storage failures from shard
  pickup/release compare-and-set paths propagate immediately instead of being
  retried as contention; and
- task/report/review/work-log durable state still described round 53 as a
  current verified pass instead of committed `c2e67c6`, and the work log still
  pointed at committing already-committed round-53 work.

### Round 54 Fix

Result: committed as `5153077`.

Fix summary:

- replaced the public compare-and-set exhaustion wording with
  `could not be completed due to concurrent changes`;
- updated focused inbox/shard regressions to assert the stable public wording;
- added shard-registry regressions proving thrown compare-and-set storage
  failures propagate immediately and are not retried; and
- refreshed durable task/report/review/work-log state through committed round
  53 at `c2e67c6` and this round-54 fix trail.

Red-first verification:

- `pnpm exec vitest run packages/server/test/delivery/inbox.test.ts -t`
  `'fails clearly when dedup guard compare-and-set keeps missing|`
  `fails clearly when inbox row compare-and-set keeps missing'`
  failed before production changes because the regressions still observed the
  internal `compare-and-set retry budget exhausted` message; and
- `pnpm exec vitest run packages/server/test/delivery/sharded-work-registry.test.ts -t`
  `'fails clearly when shard pickup compare-and-set keeps missing|`
  `fails clearly when shard release compare-and-set keeps missing|`
  `propagates shard pickup compare-and-set failures|`
  `propagates shard release compare-and-set failures'`
  failed before production changes only on the two public-message assertions,
  while the new thrown-failure regressions already passed on the existing
  implementation.

Focused verification:

- `pnpm exec vitest run packages/server/test/delivery/inbox.test.ts -t`
  `'fails clearly when dedup guard compare-and-set keeps missing|`
  `fails clearly when inbox row compare-and-set keeps missing'`
  passed; and
- `pnpm exec vitest run packages/server/test/delivery/sharded-work-registry.test.ts -t`
  `'fails clearly when shard pickup compare-and-set keeps missing|`
  `fails clearly when shard release compare-and-set keeps missing|`
  `propagates shard pickup compare-and-set failures|`
  `propagates shard release compare-and-set failures'`
  passed.

### Round 55

Reviewer input: round-55 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- performance/reliability: `round-55-performance-reliability`
  (`CHANGES REQUESTED`, supplied);
- maintainability: `round-55-maintainability` (`CHANGES REQUESTED`, supplied);
- documentation: `round-55-documentation` (`CHANGES REQUESTED`, supplied).

Result: changes requested.

Findings to address:

- `packages/storage/src/record/record-storage.ts` regressed the `index()`
  contract by returning raw `queryEntries()` slot IDs instead of logical
  record IDs derived from each record;
- `packages/server/src/delivery/delivery.ts` forwarded `DeliveryOptions.now`
  only to `ShardedWorkRegistry`, so inbox dedup expiry/keep-until decisions
  ignored the delivery owner clock;
- `packages/server/src/delivery/sharded-work-registry.ts` classified
  `Storage record could not be cloned.` on read but missed sibling
  `Storage value could not be cloned.`, and shard pickup/release compare-and-set
  clone/materialization failures still leaked raw storage wording instead of
  `DeliveryStorageCorruptionError`; and
- task/report/review/work-log durable state still described round 54 as a
  current verified pass instead of committed `5153077`, and the work log still
  pointed at committing already-committed round-54 work.

### Round 55 Fix

Result: committed as `8cd3cf3`.

Fix summary:

- restored `RecordStorage.index()` to derive logical IDs from each record while
  preserving `queryEntries()` as the raw slot-ID API;
- passed `DeliveryOptions.now` through to `InboxStorage` and updated the
  delivery timing TSDoc;
- classified shard read and compare-and-set clone failures, including
  `Storage value could not be cloned.`, as
  `DeliveryStorageCorruptionError`;
- added focused regressions for logical index IDs, delivery-owner clock inbox
  dedup expiry, shard read clone classification, and shard pickup/release
  compare-and-set clone classification; and
- refreshed durable task/report/review/work-log state through committed round
  54 at `5153077` and this round-55 fix trail.

Red-first verification:

- `pnpm test packages/storage/test/memory/in-memory-record-storage.test.ts`
  failed before production changes because the new index regression still
  returned storage slot key `event-copy` instead of logical record ID
  `event-1`;
- `pnpm test packages/server/test/delivery/inbox.test.ts`
  failed before production changes because the new delivery-owner-clock
  regression still returned `DUPLICATE`; and
- `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  failed before production changes because shard read/pickup/release clone
  failures still surfaced raw storage clone wording.

### Round 56

Reviewer input: round-56 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- maintainability: `round-56-maintainability` (`CHANGES REQUESTED`, supplied);
- documentation: `round-56-documentation` (`CHANGES REQUESTED`, supplied);
- TypeScript/API docs:
  `round-56-typescript-api-docs` (`CHANGES REQUESTED`, supplied);
- security: `round-56-security` (`COMMENTARY ONLY`, supplied).

Result: changes requested.

Findings to address:

- `packages/server/src/delivery/sharded-work-registry.ts` still called
  `value.getTime()` directly in `requireInputTime(...)`, so a non-`Date`
  delivery clock leaked raw wording instead of failing with the stable public
  error `Shard pickup time is invalid.` before storage access;
- `packages/storage/src/record/record-storage.ts` and `docs/api/README.md`
  still needed explicit wording that `index()` returns logical record IDs
  derived from record bodies while `queryEntries()` returns actual storage slot
  IDs; and
- durable task/report/review/work-log state still described round 55 as a
  current verified pass instead of committed `8cd3cf3`, and the work log still
  pointed at committing already-committed round-55 work.

Security review evaluation:

- the suggestion to make `RecordStorage.index()` return storage slot IDs was
  not accepted because local storage tests and docs establish `index()` as the
  logical-ID API and `queryEntries()` as the slot-ID API; and
- the suggestion to sanitize non-clone backend exceptions was not accepted
  because local delivery tests intentionally propagate non-clone backend
  failures while only clone/materialization-style corruption wording is mapped
  to `DeliveryStorageCorruptionError`.

### Round 56 Fix

Result: committed as `d58daa4`.

Fix summary:

- changed shard clock validation to reject non-`Date` values with stable public
  wording before any storage access;
- added a focused regression proving a non-`Date` delivery clock does not open
  storage and fails with `Shard pickup time is invalid.`;
- clarified the storage API docs so `index()` is explicitly the logical-ID API
  and `queryEntries()` is explicitly the storage-slot API; and
- refreshed durable task/report/review/work-log state through committed round
  55 at `8cd3cf3` and this round-56 fix trail.

Red-first verification:

- `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  failed before production changes because the new non-`Date` clock regression
  still surfaced `value.getTime is not a function`.

Focused verification:

- `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  passed after the shard clock validation change; and
- `pnpm test packages/storage/test/memory/in-memory-record-storage.test.ts`
  passed with the logical-ID `index()` / storage-slot `queryEntries()`
  contract intact.

Final verification:

- `pnpm test packages/server/test/index.test.ts`
  `packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts`;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

### Round 57

Reviewer input: round-57 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation: `round-57-documentation` (`CHANGES REQUESTED`, supplied); and
- TypeScript/API docs:
  `round-57-typescript-api-docs` (`CHANGES REQUESTED`, supplied).

Result: changes requested.

Findings to address:

- durable task/report/review/work-log state still described round 56 as a
  current verified pass instead of committed `d58daa4`, and this review-log
  tail still carried a duplicate round-56 focused/final verification block; and
- `packages/storage/src/record/record-storage.ts` still needed adapter-facing
  TSDoc that makes the slot-ID contract explicit: `index()` returns logical
  record IDs derived from stored record bodies, `queryRecordEntries()`
  implementations must return actual storage slot IDs in `RecordEntry.id`, and
  `RecordEntry.record` is the stored record value.

### Round 57 Fix

Result: committed as `e5410c3`.

Fix summary:

- refreshed durable task/report/review/work-log state through committed round
  56 at `d58daa4` and removed the duplicate round-56 verification block from
  this review-log tail;
- clarified `RecordStorage` TSDoc so adapter authors can distinguish logical
  record IDs from storage slot IDs, including the `RecordEntry.id` /
  `RecordEntry.record` contract; and
- regenerated API reference output so the current `DeliveryOptions.now`
  wording and storage slot-ID docs are reflected in generated HTML.

Verification:

- `pnpm docs:check`;
- `node scripts/check-api-docs.mjs`;
- `pnpm format:check`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

`pnpm docs:check` and `node scripts/check-api-docs.mjs` may still emit the
existing invalid `origin` TypeDoc source-link warning, but successful exits are
the expected pass condition.

### Round 58

Reviewer input: round-58 reviewer results supplied to this fix worker.

Reviewer sub-agents:

- documentation: `round-58-documentation` (`CHANGES REQUESTED`, supplied); and
- maintainability:
  `round-58-maintainability` (`CHANGES REQUESTED`, supplied).

Result: changes requested.

Findings to address:

- durable task/report/review/work-log state still described round 57 as a
  current verified pass instead of committed `e5410c3`, and some artifacts
  still pointed at committing already-committed round-57 work;
- `packages/server/src/delivery/inbox-storage.ts` read the storage clock in
  `#handleStoredGuardMessage()` and `#recoverPendingClaim()` before code knew a
  live `keepUntil` comparison was needed, so invalid clocks leaked into
  clock-independent duplicate/recovery paths; and
- `packages/storage/src/record/record-storage.ts` routed `query()` through
  `queryEntries()` even though `query()` discards slot IDs.

### Round 58 Fix

Result: committed as `4b40a95`.

Fix summary:

- refreshed durable task/report/review/work-log state through committed round
  57 at `e5410c3`;
- added focused inbox regressions for invalid injected clocks on a live
  `TO_DELIVER` duplicate and on pending-claim recovery with a visible
  `DELIVERED` row that has no `keepUntil`;
- deferred inbox clock reads until live retention comparison actually needs
  `keepUntil`, while preserving invalid-clock failures for retention-dependent
  `DELIVERED` paths; and
- simplified `RecordStorage.query()` to validate and map directly from
  `queryRecordEntries(query)`.

Verification:

- red-first: `pnpm test packages/server/test/delivery/inbox.test.ts` failed
  with the new clock-independence regressions because eager `#dedupNow()`
  calls threw `Inbox storage clock returned an invalid time.`;
- green: `pnpm test packages/server/test/delivery/inbox.test.ts`;
- `pnpm test packages/server/test/delivery/inbox.test.ts packages/storage/test/memory/in-memory-record-storage.test.ts`;
- `pnpm test`
  `packages/server/test/index.test.ts`
  `packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts`;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

## Round 59 Review

Reviewer input: round-59 reviewer results supplied to this fix worker.

Result:

- code style/maintainability: `round-59-maintainability` (`CHANGES REQUESTED`,
  supplied);
- documentation: `round-59-documentation` (`CHANGES REQUESTED`, supplied);
- TypeScript/API docs: `round-59-api-docs` (`CLEAN`, supplied);
- security: `round-59-security` (`CLEAN`, supplied); and
- performance/reliability: `round-59-reliability` (`CLEAN`, supplied).

Findings:

- durable task/report/review/work-log state still described round 58 as a
  current verified pass instead of committed `4b40a95`, and the work log still
  pointed at committing already-committed round-58 work.

## Round 59 Fix

Result: committed as `9c9baf7`.

Fix summary:

- refreshed durable task/report/review/work-log state through committed round
  58 at `4b40a95`; and
- removed stale pending-commit wording for already-committed round 58.

Verification:

- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

## Round 60 Review

Reviewer input: round-60 reviewer results supplied to this fix worker.

Result:

- code style/maintainability: `round-60-maintainability` (`CHANGES REQUESTED`,
  supplied);
- documentation: `round-60-documentation` (`CHANGES REQUESTED`, supplied);
- TypeScript/API docs: `round-60-api-docs` (`CLEAN`, supplied);
- security: `round-60-security` (`CHANGES REQUESTED`, supplied); and
- performance/reliability: `round-60-reliability` (`CLEAN`, supplied).

Findings:

- `packages/server/src/delivery/sharded-work-registry.ts` still leaked raw
  getter/proxy exceptions from `session.shard`, `session.id`, `session.node`,
  and throwing `Date#getTime()` clocks instead of stable invalid-input
  wording;
- `packages/server/src/delivery/inbox-storage.ts` still trusted caller
  `shard.key()` directly during `read()` and could feed a fake key into
  storage filters or leak structural getter failures; and
- `build-protocol/tasks/T-0012-8-delivery-inbox/TASK.md` body tail stopped at
  round-58 verification and omitted the committed round-58 `4b40a95` plus the
  round-59 current-HEAD durable-log refresh trail already reflected elsewhere.

## Round 60 Fix

Result: committed as `dd36ae7`.

Fix summary:

- added focused regressions proving shard release accessor failures and
  throwing pickup clocks fail closed with stable invalid-input wording before
  storage access;
- normalized inbox read shards from coordinates before opening storage or
  building query filters so fake caller `key()` values are ignored; and
- refreshed TASK/report/review/work-log state with the missing round-58/59
  tail bullets and this round-60 fix trail.

Verification:

- red-first:
  `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`
  failed with four regressions exposing the raw clock/accessor exceptions and
  fake shard-key storage filter;
- green:
  `pnpm test packages/server/test/delivery/inbox.test.ts packages/server/test/delivery/sharded-work-registry.test.ts`;
- `pnpm test`
  `packages/server/test/index.test.ts`
  `packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts`;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs`;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

## Round 61 Review

Reviewer input: round-61 reviewer results supplied to this fix worker.

Result:

- security: `round-61-security` (`CHANGES REQUESTED`, supplied);
- TypeScript/API docs: `round-61-api-docs` (`CHANGES REQUESTED`, supplied);
- documentation: `round-61-documentation` (`CHANGES REQUESTED`, supplied).

Findings:

- `packages/server/src/delivery/sharded-work-registry.ts` still let
  `requireInputShard()` rethrow caller getter errors when the raw message
  included the validation label, so `pickUp()` could leak attacker-chosen text
  from `index` or `ofTotal` getters;
- `packages/storage/src/record/record-storage.ts` and `docs/api/README.md`
  needed to explicitly distinguish actual storage slot IDs from logical record
  IDs for `delete(id)`, `read(id)`, `compareAndSet(id, ...)`, `query()`,
  `RecordQuery.ids`, `queryEntries()`, and `index()`; and
- durable logs still used current-HEAD wording for older round-59/60 commits
  and had a non-chronological work-log tail.

## Round 61 Fix

Result: committed as `a647db5`.

Fix summary:

- added the pickup-shard accessor regression and verified it failed red-first
  by leaking `Shard index confidential getter failed`;
- wrapped caller shard property access behind stable invalid-shard wording
  before storage opens;
- clarified storage slot ID versus logical record ID docs without adding API
  facades; and
- promoted round 59 to `9c9baf7`, round 60 to `dd36ae7`, restored work-log
  chronology, and recorded this round-61 trail.

Verification:

- red-first:
  `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`
  failed with the new pickup-shard getter regression;
- green:
  `pnpm test packages/server/test/delivery/sharded-work-registry.test.ts`;
- `pnpm test`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`;
- `pnpm test`
  `packages/server/test/index.test.ts`
  `packages/server/test/delivery/inbox.test.ts`
  `packages/server/test/delivery/inbox-records.test.ts`
  `packages/server/test/delivery/shard-index.test.ts`
  `packages/server/test/delivery/sharded-work-registry.test.ts`
  `packages/storage/test/memory/in-memory-record-storage.test.ts`
  `packages/server/test/repository/aggregate-storage.test.ts`;
- `pnpm typecheck`;
- `pnpm lint`;
- `pnpm format:check`;
- `node scripts/check-api-docs.mjs` passed with the pre-existing invalid
  `origin` TypeDoc source-link warning;
- `git diff --check fce80b2..HEAD`; and
- touched-file line scan with no lines over 120 columns.

Follow-up docs-only cleanup: stale post-commit wording in the round-61 report,
work-log current state, and durable headers is removed in the current package
HEAD.
