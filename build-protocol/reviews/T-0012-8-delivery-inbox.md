# Review Log: T-0012.8 Delivery And Inbox

Status: round 3 review pending
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

Reviewer sub-agents: pending.

Result: pending.
