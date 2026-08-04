# Wave 6: Distributed Delivery And Stand

Status: Approved scope; implementation planned

Planning task: `T-0104`

Baseline: `origin/main@59fb286c`

## Outcome

Wave 6 makes the existing delivery, Stand, and Gateway pieces cooperate across
multiple identical application nodes. One shard owner dispatches an Entity's
Inbox messages. With the built-in durable registry, every node observes the
same Stand subscription definitions; an explicitly selected in-memory registry
remains local. One Gateway listens to every configured application node.
Subscription notices remain best effort; queries remain authoritative.

The prior horizontal-subscription hardening scope is Wave 7. Wave 7 must include
a new Q&A about application redeployment and update behavior.

## Current Gap Matrix

| Area                | Current behavior                                                                                                                              | Wave 6 behavior                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Aggregate commands  | The normal route may invoke the repository directly.                                                                                          | Route to a sharded Inbox and dispatch only under the shard lease.                                                        |
| Process Managers    | Command/event Inbox replay exists, but handoff is local and effectively single-shard.                                                         | Use the configured delivery strategy and the same remote shard pickup path as Aggregates.                                |
| Shard notification  | The delivery client can read Admin snapshots and updates, but the environment supervisor does not turn remote updates into delivery attempts. | Each application node observes the fan-out stream and attempts the reported shard. One lease winner drains it.           |
| Drain behavior      | Bounded delivery runs exist.                                                                                                                  | A shard owner continues finite runs until no deliverable Inbox message remains, then releases the shard.                 |
| Stand updates       | `Stand.update()` writes current state and invokes process-local callbacks.                                                                    | Entity commits publish `EntityStateChanged`; Stand observes the EventBus and creates matching Entity updates.            |
| Event subscriptions | SubscriptionService registers callbacks directly.                                                                                             | Stand observes subscribed events from the EventBus and emits event updates.                                              |
| Stand registry      | Local callback sets plus service-owned inactive/claim/cancel rows.                                                                            | One configurable registry stores subscription definitions for every node; no per-node claim owns a definition.           |
| Cancellation        | Service and Gateway records may retain cancel/retired states.                                                                                 | Stand registry cancellation physically deletes the definition; Gateway stops its streams without waiting for every node. |
| Gateway backend     | One configured backend URL.                                                                                                                   | One logical Gateway fans out native subscription activation to a fixed configured application-node set.                  |
| Example topology    | Simple Message Board and deployment templates.                                                                                                | Add Distributed Message Board with two application nodes, one Gateway, and one simple delivery server.                   |

## Target Message Sequence

1. A client posts a command to application node A.
2. Routing determines the target Entity and shard. The command is stored as an
   Inbox message; the handler is not invoked on the request thread.
3. The delivery server publishes the changed shard index to all application
   nodes through `AdminService.SubscribeToShardUpdates`.
4. Nodes A and B attempt the shard. Exactly one acquires the delivery-server
   shard lease.
5. The owner dispatches deliverable Inbox messages using the existing durable
   Inbox selection contract. It continues until no deliverable message remains,
   including messages added while it was draining. Wave 6 adds no stronger
   cross-node arrival-order guarantee.
6. The Aggregate or Process Manager commits state and emitted events in its
   framework-owned transaction.
7. The EventBus dispatches domain events. A subscribed Projection handles the
   event through its normal delivery path and commits its state.
8. Each committed Entity state publishes `EntityStateChanged` after the commit.
9. The local Stand observes domain/system events. If a durable subscription
   matches, the node emits a native subscription update.
10. The Gateway has active native streams to both nodes. It forwards received
    best-effort notices, including possible duplicates, to the browser. The
    browser re-queries authoritative Entity state.

## Frozen JVM System Event

T-0105 freezes `SpineEventEngine/core-java@461a8281e484c12636d8cf660a1d6c929fbbd7ec`
without building JVM. The source is
`server/src/main/proto/spine/system/server/entity_log_events.proto`.
`EntityStateChanged` has package `spine.system.server`, type URL
`type.spine.io/spine.system.server.EntityStateChanged`, and the exact fields:

| Field         | Tag | Type                            | Requirement            |
| ------------- | --: | ------------------------------- | ---------------------- |
| `entity`      |   1 | `spine.core.MessageId`          | required               |
| `new_state`   |   2 | `google.protobuf.Any`           | required               |
| `signal_id`   |   3 | repeated `spine.core.MessageId` | required and validated |
| `when`        |   4 | `google.protobuf.Timestamp`     | optional               |
| `new_version` |   5 | `spine.core.Version`            | optional               |
| `old_state`   |   6 | `google.protobuf.Any`           | optional               |

Copy the frozen source and its required `entity_type.proto` dependency through
the existing frozen-Proto manifest rather than recreating a similar TS-only
message. The package root does not re-export this internal system event.

## Subscription Storage

Define an internal Protobuf wire record at
`packages/proto/proto/spine/system/server/stand_subscription.proto`. Runtime
storage/codec ownership remains in the server package. The file uses package
`spine.system.server`, prefix `type.spine.io`, and internal generation only; it
is not re-exported from the public Proto package root. One logical subscription
occupies one row:

```proto
message StandSubscriptionRecord {
  spine.client.Subscription subscription = 1;
  SubscriptionPhase phase = 2;
  google.protobuf.Timestamp created_at = 3;
  google.protobuf.Timestamp pending_until = 4;
  uint64 revision = 5;
}

enum SubscriptionPhase {
  SUBSCRIPTION_PHASE_UNSPECIFIED = 0;
  PENDING = 1;
  ACTIVE = 2;
}
```

The storage key is the subscription ID. `Subscription.topic` is the sole topic
representation; the record does not duplicate it. A provider may index `phase`
and `pending_until` for cleanup. Fifty active
subscriptions therefore produce fifty subscription rows, not fifty ownership
rows plus claims/tombstones. MySQL stores fifty records in one logical record
table; Datastore stores fifty entities in one logical kind.

The registry has a shared atomic capacity counter, following the existing
durable Gateway quota pattern. The default and maximum active/pending definition
count is the current SubscriptionService limit of 100 unless application code
configures a lower positive value. Concurrent create attempts at capacity admit
at most the remaining slots and leak no row or local listener. Each serialized
record is capped at 1,048,576 bytes, matching the current Gateway subscription
request bound. Snapshot size is therefore bounded by the configured definition
count and returned in one complete registry result; cleanup alone is paged.

`PENDING` is written by Subscribe and must become `ACTIVE` through Activate.
Pending rows expire after 30 seconds. Every node runs the same finite,
idempotent cleanup page; revision-aware deletion makes concurrent cleanup safe.
Active rows have no framework TTL. Cancel physically deletes the row and
releases its capacity slot atomically/idempotently.

Every node reads a complete bounded snapshot at startup and every 10 seconds.
T-0109 owns the reconciliation loop and local listener lifecycle; T-0108 only
provides snapshot/persistence/cleanup operations. Reconciliation runs are
serialized. Before attaching a definition from a snapshot, the node revalidates
its ID and revision; a missing or changed row is not attached. A monotonically
increasing local sweep removes listeners absent from the latest completed
snapshot and prevents an older run from applying after a newer run. It never
polls Entity state. Deletion converges after the first completed reconciliation
cycle that begins after deletion; no stricter wall-clock bound is promised.
Gateway cancellation still completes after durable deletion and local stream
stop.

## Registry And Builder Boundary

Introduce one server-internal/public-contract pair:

- Public `StandSubscriptionRegistry` describes create, activate, delete,
  complete bounded snapshot, finite pending cleanup, `persistent`, and close
  behavior. It is exported from `@spine-event-engine/server`.
- The built-in storage-backed registry uses the Bounded Context's configured
  `StorageFactory` and tenant context.
- `BoundedContextBuilder.withSubscriptionRegistry(registry)` accepts a complete
  custom implementation. Entity registration remains `.add(...)`.
- The Bounded Context owns and closes the selected registry.
- An in-memory implementation remains valid and reports `persistent === false`.
  During context attachment, `ServerEnvironment` knows its Environment type and
  emits one WARN-level message per context when production attaches a
  non-persistent registry. It does not fail startup.

T-0108 updates public TSDoc, the server README/reference, and TypeDoc checks for
this extension point; T-0112 later reconciles the wider guides after all runtime
interfaces stabilize.

Do not reuse the Gateway durable binding registry as the Stand registry. The
Gateway registry owns browser-session coordination; the Stand registry owns
native subscription definitions visible to application nodes.

## Gateway Boundary

Replace `BrowserServerOptions.backend` directly with
`BrowserServerOptions.backends`, a non-empty fixed array of at most 32 entries
containing stable `id` and canonical `baseUrl` values. There is no deprecation
cycle because Spine TS has no external users. Combined mode supplies one
implicit loopback entry. Commands and queries select one entry by bounded
round-robin and are not broadcast or automatically retried. Subscription
Subscribe/Activate/Cancel is coordinated across every configured backend:

- create one logical client subscription;
- activate a native stream on every application node using the same durable
  definition;
- merge best-effort updates without retaining deduplication history and notify
  the client when a backend stream is lost;
- cancel by deleting the logical definition and stopping every local stream.

Replace the exported single-backend `SubscriptionCreator` with
`ClusterSubscriptionCreator`. Subscribe chooses one configured backend and
persists its canonical `BackendSubscriptionEnvelope`; because the Stand
definition is shared, Activate sends that same Subscription envelope to each
backend. Runtime stream controllers are keyed by backend ID but are not durable
identities. Existing durable Gateway bindings retain one canonical envelope and
add the fixed backend-set fingerprint needed to reject incompatible restart
configuration. Per-backend operations retain the existing request, lease,
queue, cancellation, and shutdown bounds. Fence late activation/retry results;
after Cancel or close, no backend reconnect may start. Partial activation
failure closes already-started streams and reports the existing gap/lifecycle
notification without retrying a command.

Backend discovery, backend additions/removals, and scaling reconciliation are
Wave 7. Kubernetes/service discovery products are not framework policy.

## Dependency-Ordered Tasks

### T-0105: System Event And Inbox Contracts

Owns the smallest serialized/public foundations: the exactly frozen
`EntityStateChanged` system event, internal Stand subscription record, and
Aggregate/Process Manager Inbox labels needed by later tasks.

- RED: exact pinned file/checksum/type URL/field compatibility, invalid record
  rejection, canonical non-duplicated topic, target/shard preservation, no
  generated output tracked.
- Review: TypeScript/API and reliability required; style/docs as affected.
- Verification: focused Proto/generation tests, generated typecheck, then
  `verify:release` because serialized contracts change.

### T-0106: Unified Entity Inbox Handoff

Routes Aggregate commands and Process Manager `@Assign` commands/events through
the configured delivery strategy and Inbox. Reuses one small Entity delivery
owner rather than parallel Aggregate and Process Manager mechanisms.

- RED: request acknowledgement before dispatch, no direct Aggregate invocation,
  PM command `@Assign`, same-Entity serialization, tenant/shard preservation,
  replay/idempotency, transaction rollback.
- Review: style, API, and reliability.
- Verification: focused repository/context/delivery coverage, then
  `verify:release`.

### T-0107: Remote Shard Fan-Out And Drain

Connects the delivery-client Admin snapshot/update stream to each environment's
delivery supervisor. Every node attempts reported shards; one remote lease owner
drains until empty and releases. Reconnect performs a bounded full shard
snapshot before resuming updates.

- RED: two-node race, one dispatcher, messages arriving during drain, lost
  lease, reconnect snapshot, bounded queue/overflow, close cancellation.
- Review: style, API, and Terra/high reliability.
- Verification: delivery client/server/server-environment integration and real
  two-process gRPC tests, then `verify:release`.

### T-0108: Configurable Durable Stand Registry

Adds the registry contract, storage-backed and in-memory implementations,
builder configuration, default StorageFactory ownership, bounded complete
snapshot API, 30-second pending cleanup, physical deletion, and production
warning. It does not own local listener reconciliation.

- RED: 50 rows for 50 active subscriptions, atomic cross-node admission at the
  100-definition default capacity, record/snapshot bounds, concurrent cleanup,
  capacity release, delete without tombstone, activate/delete and snapshot/delete
  races, restart recovery, custom implementation ownership, close ordering,
  production warning/no failure.
- Review: all four concerns; persistence/lifecycle at Terra/high.
- Verification: memory/MySQL/Datastore conformance where configured, focused
  context lifecycle tests, then `verify:release`.

### T-0109: EventBus-Driven Stand And SubscriptionService

Makes Stand an EventBus observer. Entity commits publish
`EntityStateChanged`; plain events and Entity changes are matched against the
reconciled registry. SubscriptionService uses the registry rather than local
claim/cancel definitions. This task owns the startup and 10-second serialized
snapshot reconciliation loop, revision revalidation, local sweep, and listener
lifecycle.

- RED: event and Entity subscriptions, Projection updates, Aggregate/Process
  Manager update visibility, tenant/filter matching, duplicate/reordered notice
  tolerance, stale-sweep fencing, delete during snapshot, convergence after a
  post-delete cycle, cancellation convergence, shutdown.
- Review: all four concerns; serialized/reliability concerns at Terra/high.
- Verification: command-event-projection-subscription black-box coverage and
  `verify:release`.

### T-0110: Multi-Node Gateway Fan-In

Adds fixed bounded multi-backend configuration, one-backend round-robin
command/query routing, all-backend subscription activation, merged notices,
backend lifecycle notifications, and cancellation fan-out. Authentication
remains solely at the Gateway. Dynamic discovery is Wave 7.

- RED: two app nodes/one Gateway, 32-backend bound, one request dispatch with no
  command retry, all-node activation, partial activation cleanup, duplicate
  forwarding without retained dedupe state, stream loss notification,
  cancellation/close races, no reconnect after cancellation, binding restart
  with the same fixed backend fingerprint, actor/tenant preservation.
- Review: all four concerns, plus the final security reviewer only if this task
  exposes a new authentication trust boundary.
- Verification: native and browser interoperability plus `verify:release`.

### T-0111: Distributed Message Board And Example Migration

Adds `examples/distributed-message-board/` by reusing the Message Board model and
UI, with two application nodes, standalone Gateway, shared configured storage,
and one in-memory simple delivery server. Updates every example to use the
corrected delivery defaults.

- RED: one command can enter either node, one Aggregate handles it, Projection
  state appears once, browser connected through one Gateway re-queries and sees
  it, deterministic shutdown.
- Review: style, docs, API, and reliability.
- Verification: all example startup commands, real distributed acceptance,
  browser tests, and `verify:release`.

### T-0112: Documentation And Wave Closure

After runtime interfaces stabilize, updates all affected human READMEs,
agent references, user guides, architecture diagrams, API docs, and deployment
templates. It explains shard routing, Inbox dispatch, Stand registry records,
polling/cleanup, one-Gateway topology, best-effort notices, and authoritative
queries without internal wave/task jargon in end-user docs.

- Verification: deterministic docs/API/example command checks, complete
  specialist review wave, final `verify:release`, merge/ref equality, remote
  cleanup, and completion-plan closure.

## Explicit Exclusions

- No Redis or Hazelcast delivery-server modes.
- No durable or highly available delivery server.
- No admin browser UI or TUI.
- No npm publication.
- No JVM source change or JVM build.
- No cluster-complete, exactly-once, ordered, or gap-free subscription promise.
- No Wave 7 redeployment/update or stronger horizontal-subscription semantics.
- No infrastructure-owned application storage choice.

## Autonomous Execution Rule

After T-0104 is reviewed, verified, merged, and pushed, execute T-0105 through
T-0112 in order. Do not request routine approval between tasks. Stop only for a
real blocker under `BUILD_PROTOCOL.md`.
