# T-0187 Discovery Findings

## Baseline And Governance

- `origin/main` resolves exactly to
  `7b8a631ecb33210e5da4da9ffa2d8eb8aa59d497` after `git fetch --prune origin`.
- The primary checkout is dirty, 1,945 commits behind, and contains the
  protected untracked agentic-review folder. No primary-checkout file was
  changed.
- The isolated branch/worktree is clean and based directly on the verified
  remote commit.
- Wave 12 is high-risk under the persistence, concurrency, lifecycle, public
  contract, and cross-subsystem criteria in `BUILD_PROTOCOL.md`.

## Accepted Constraints Already Established

- D-0104 makes subscriptions best-effort notifications but does not permit a
  healthy stream to terminate after ordinary updates.
- D-0103 requires the universal browser path to use gRPC-Web and requires real
  browser tests.
- D-0105 places protocol-aware authentication and browser forwarding in the
  Gateway.
- D-0098 selects direct private `mysql2` prepared/bound-parameter execution and
  live MySQL 8.4 evidence via explicit `SPINE_TS_MYSQL_URL`.
- D-0111 requires the same typed provider mapping for stored values and query
  operands and preserves provider-native tenant containment.
- D-0085 makes `ServerEnvironment` the sole lifecycle owner for bounded
  delivery work and requires current ownership/fencing before protected
  operations.
- `RUNTIME_ARCHITECTURE.md` currently states delivered Inbox rows are the
  deduplication fact and does not define finite delivered-row retention.

## C-01: Sustained Browser Subscription

- The current real-browser acceptance in
  `examples/message-board/web/test/interop/browser/browser.spec.mjs` consumes
  only one update. The subscribing page also performs the writes, so it does
  not prove that a passive viewer survives successive updates from another
  actor.
- `browser/entry.ts` calls `updates.next()` once, performs writes until that
  promise resolves, and then cancels the iterator, client, and session in a
  `finally` block. `topology.test.mjs` has the same one-update shape on its
  native Node path.
- The interop harness is the supported production-shaped topology: Message
  Board backend, native Connect transport, `NativeSubscriptionCreator`,
  `DynamicUnaryForwarder`, `DynamicSubscriptionCreator`,
  `SubscriptionGateway`, native Gateway services, Envoy, and browser
  gRPC-Web. Its counters expose subscribe, activate, active-stream, update,
  cancel, and disposal boundaries.
- The browser `TopicSubscription` owns activation, update consumption,
  reconnect/re-query, termination, and cancellation. Native
  `SpineServices.#activate()` owns the server iterator lifetime. Stand's
  `SubscriptionRuntime` owns native subscription attachments and observer
  notification; `SubscriptionDelivery` closes when its bounded queue
  overflows or the runtime unsubscribes.
- The Gateway path has two additional lifecycle boundaries:
  `DynamicSubscriptionCreator.activateDefinition()` keeps an activation alive
  until abort, while `#activateChild()` removes a child when the native client
  activation returns; `SubscriptionGateway.#activate()` delegates through
  `InMemorySubscriptionBindings`, and the native Gateway relay closes when the
  Gateway handler completes.
- No boundary is yet identified as the defect. The failing-before test must
  distinguish native production from Gateway forwarding before changing
  runtime code.

## X-01: MySQL Query-Plan Execution

- `RecordStorage.queryPlanEntries()` validates against provider capabilities,
  calls `queryPlanRecordEntries()`, enforces a candidate bound, then applies
  `StorageQueryEvaluator` in Node.
- The default `queryCapabilities()` advertises no comparisons or features.
  The default `queryPlanRecordEntries()` ignores the admitted plan and calls
  `queryRecordEntries({})`, which can read the whole storage group.
- `MysqlRecordStorage` overrides neither method. Consequently comparison and
  feature plans reject, while admitted equality-only plans can silently fetch
  an entire storage group and filter in Node.
- MySQL already has a separate parameterized `querySql(RecordQuery)` path for
  IDs, equality filters, sort, continuation, offset, and limit. The normalized
  query-plan production path does not use it.
- Datastore has explicit capabilities and a provider pushdown planner;
  in-memory execution advertises full capabilities but evaluates locally.
  Datastore must join shared conformance only for the overlap it truly admits.
- Existing MySQL entity commit-contract tests monkey-patch or stub
  `queryPlanEntries()`, including the exact production method requiring proof.
  These tests therefore cannot count as provider-backed execution evidence.
- Tenant isolation is selected before MySQL table access, and the table is the
  storage-group boundary. Every new statement must retain both boundaries and
  bind user-derived values.
- `NormalizedQueryPlan` currently has no offset member although `RecordQuery`
  does. The capability matrix must state this explicitly; Wave 12 must not
  silently reinterpret or accidentally broaden the normalized public
  contract.

## D-01: Delivered Inbox Retention

- `InboxStorage.markDelivered()` performs an exact pending-to-delivered CAS and
  intentionally leaves the record. There is no Inbox cleanup/delete port or
  lifecycle operation.
- Deduplication scans delivered records by Inbox ID, signal ID, and status.
  A delivered duplicate remains protected while `keepUntil` is absent or is
  later than the current time. The scan is paged but the delivered population
  itself is never reduced.
- Inbox reads are page-limited (default 100, maximum 1,000). Record providers
  expose exact row deletion/CAS paths, including MySQL and Datastore, but Inbox
  does not use them for retention.
- `Delivery.drain()` acquires a shard, validates current ownership before
  dispatch and before `markDelivered()`, then releases the shard. Cleanup must
  remain in this environment-owned lifecycle and validate the same fencing
  before each protected mutation.
- Existing Inbox tests cover delivery and deduplication, not finite retention,
  stale-owner deletion, restart boundaries, or sustained bounded growth.
  Direct record-provider conformance uses a mocked MySQL driver and is not live
  MySQL evidence.
- Current API prose mentions delivered-row retention evaluation even though
  the implementation only evaluates deduplication protection. Documentation
  must follow the stabilized implementation.

## Pinned JVM Comparative Evidence

- The accepted JVM revision is inspected with `git show` from commit
  `461a8281`, leaving the local JVM checkout untouched.
- JVM `CleanupStation` deletes a delivered message when `keepUntil` is absent
  or in the past. Thus `keepUntil` is a deduplication deadline and separately
  determines when a delivered row becomes cleanup-eligible.
- JVM `DeliveryBuilder` defaults the deduplication window to zero and exposes a
  deduplication-window setting; it does not expose a second delivered-row
  retention setting. The least-inventive Wave 12 default is therefore immediate
  eligibility after deduplication protection expires, with no independent
  public retention override unless contrary evidence requires one.
- JVM delivery separates maintenance/catch-up/live/cleanup stations. Spine TS
  must preserve its accepted environment ownership and fencing rather than
  copying that internal structure by name.
- JVM subscription activation is callback/observer based and wraps observers
  for thread safety. It supplies comparative lifecycle evidence, not a direct
  TypeScript implementation prescription.

## Remaining Discovery

- Live MySQL is an explicit opt-in through `SPINE_TS_MYSQL_URL` and
  `SPINE_TS_MYSQL_ADMIN_URL`; `pnpm --filter
@spine-event-engine/storage-rdbms test:mysql` runs the provider script then
  `mysql-integration.test.ts`. Its current query case exercises `RecordQuery`,
  not the normalized plan path.
- Datastore emulator proof requires `DATASTORE_EMULATOR_HOST` and runs through
  `pnpm --filter @spine-event-engine/storage-datastore test:emulator`.
  Emulator and MySQL suites must run sequentially because they own provider,
  generated, and coverage resources.
- MySQL table creation currently defines only the declared primary key; any
  admitted pushdown over native columns needs documented operator index
  expectations rather than a claim that every workload is automatically
  indexed.
- Current architecture/API documentation correctly calls domestic/external
  events and enrichment unimplemented and correctly denies Projection catch-up
  equivalence. Wave 12 must preserve that wording.
- Inbox prose says accepted rows follow their lifecycle but does not define the
  finite cleanup boundary. `InboxStorageOptions.now` inaccurately calls its
  current deduplication-time use a delivered-retention evaluation. Both become
  T-0193 documentation/API ownership after runtime behavior stabilizes.
- Local JVM adapter checkouts are dirty human worktrees. Comparative adapter
  evidence is read from immutable Git objects at exact local revisions
  `cf3b603b89ea71eb555a6ae081bd1043e2a89f22` (JDBC) and
  `219d606bbf403b6a9b331b41cf99616fa2ee0606` (GCloud); no files there are
  mutated and these adapter revisions are supporting, not canonical, evidence.
