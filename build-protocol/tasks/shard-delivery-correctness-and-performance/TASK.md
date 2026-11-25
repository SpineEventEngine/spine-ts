# Shard delivery correctness and performance

High-risk implementation on `shard-delivery-correctness-and-performance`, from official master `569dd58c0`. This task changes serialized contracts, library entry points, session and inbox concurrency, and server topology. Scope is Spine TS. The application replicas have identical code and settings and share the required stores.

## Requirements and acceptance

1. Ship a TS-specific `ShardObservingService.ObserveAll(Empty)` in `spine/delivery/message_delivery.proto`. The streamed response contains only the required shard index. Document the complete notification contract on the method itself. Register before discovering existing free shards with pending rows; omit held and completed-only shards; remain silent while idle; recheck on release or expiry; repeat unclaimed work after a configurable interval (10 seconds by default). Additional writes cannot postpone the reminder. Reconnect discovers current work. The notice grants no session. Preserve the Admin wire descriptor.
2. Port per-shard ordered and pending indexes and exact stored counts from JVM Delivery issues 70 and 71, preserving TS page continuation, existing global capacity limits, and atomic batch rejection. After the Admin acknowledgement, replay known shards. Send the first eligible change immediately, coalesce later changes independently per shard using the approved JVM default of 25 milliseconds, and suppress consecutive identical states. Preserve the existing five-second opportunistic retention policy.
3. Recover uncertain pickup with a stable run ID; differentiate busy and no work; require live session handles and changing record revisions for managed renewal/release. Server-driven 60-second default expiry and renewal at one third of the lifetime. Retain Protobuf time precision. Guard worker acknowledgement and both deletion paths with session and wire-exact row identity. Do not couple delivery with Entity persistence.
4. Replace the supervisor with built-in all-shard observation or an application-selected custom observer through normal environment startup. Independent same-config nodes may run distinct shards concurrently without a default cap. Offer per-node concurrency only for built-in server observation. Join simultaneous same-shard local calls. Preserve monitor actions, cancellation, and orderly shutdown. Publish the new higher-level run result and shared newest-pending inbox operation. On normal completion release before checking the pending row, remove the local run before invoking the custom observer, and log callback failures without retry. Test new-node startup and equal-configuration replicas, stale notices, and missed notifications.
5. Keep one server process by default. Offer one public gRPC parent with a fixed number of homogeneous child processes and private gRPC endpoints. Route the full shard identity by index modulo child count. Fan out global calls, preserve global limits including uncertain writes, and provide fresh subscriptions to each public subscriber. Restart a lost child in its original slot, keep healthy slots serving and discard old handles and obsolete stream responses.
6. Update maintained applications, docs, wire and behavior tests, and operator settings. Use targeted mechanical checks and relevant specialist reviews, followed by release verification, versioning and final security review. No JVM changes and no migration or compatibility shims.

## Reference and execution

The application-side comparison used core-jvm Delivery.java, DeliveryMonitor.java and ShardObserver.java at f2bdce55. Server and remote adapter comparisons used Delivery v0.24.0 ShardInbox.kt, ShardUpdateSender.kt, DeliveryShardRegistry.java, ShardService.java and WorkRegistry.java. Preserve normal post-release observation independently of application notification strategy. Node's child-process and the repository's existing gRPC, Protobuf and clock implementations are the starting points.

Implementation sequence and decisions:

- Use separate work and Admin publishers. The work publisher registers before discovery and checks availability again before sending. The low-level reader must accept an indefinitely silent stream and preserve transport status. Automatic expiry is completed with managed sessions.
- Managed pickup requires pending work and returns a grant, contention, or no work. Recover a lost pickup reply using the same attempt identity. Use a fresh identity for each independent run. A deliberate low-level pickup can take an empty shard and returns a session handle. Ordinary renewal and single-session release require that handle for every session. A worker-only release cannot clear any session, and generic pickup cannot recover a managed handle. Finish in-flight renewal before releasing. Check cancellation at mutation admission.
- Track exact encoded inbox rows or revisions through decoding. Page ordering uses receive time, version and UTF-8 message ID. Admin counts stored rows, including retained completions. Replay known states and suppress identical consecutive states per shard.
- An application's nodes use the same configuration. A joining node must discover existing free work through its own subscription, even through a multi-process parent. A custom observer receives an inbox row after a successful write or after a normal run finds a late pending row. An exception during processing still releases the session. Distinguish lookup failure from callback failure.
- Add child-process capacity settlement before enabling distributed writes. Reserve global capacity across slots, account for uncertain outcomes, and settle using a barrier ordered after the original mutation. Aggregate global results only when all required slots responded.

## Application work stream

Each subscriber receives the free shards with pending work when it connects.
The server checks again before sending a queued notice. If a worker has taken
the shard or the last pending row was removed, the subscriber skips that notice.
Closing the stream detaches the subscriber and its cancellation listener.

The gRPC method documents when a notice repeats, how pickup stops reminders,
and how release, expiry, and reconnect make existing work visible. The Admin
stream has its own snapshot and update rules.

## Indexed storage and Admin

Page reads and newest-pending lookups now use the selected shard. The same local
two-row page measurement with 8 and 4,008 total rows took about 19 and 297
microseconds before indexing, and 20 and 17 after indexing. A regression test
also verifies the read without a scan of the global message map.

Admin replays 150 known shards with a concurrent write in a regression test.
The application now uses a dedicated work stream. Its gRPC tests cover a
disconnect and confirm that completed-only shards stay idle.

## Managed sessions

The TS client and embedded or standalone server use the typed session service.
The server compares the revision seen at request entry with the revision at
mutation time. Session identity lasts across renewals. Automatic expiry uses
a monotonic clock. Explicit inactivity release and public reports use full
Protobuf timestamps. A separate successful-pickup sample follows JVM timing.

Recovery uses the original run ID, deadline and cancellation. Tests cover lost
pickup replies, release while renewal is in flight, explicit and automatic
expiry, malformed handles and cancellation while waiting to retry. Guarded worker operations and heartbeat tests cover processing that
outlasts the original session.

## Guarded remote processing

The server checks a worker's session and the original inbox row in the same
mutation for acknowledgement, duplicate removal, and expired-row cleanup.
A real client/server drain exercises the guarded path. Tests cover replacements
that differ only by nanoseconds or unknown fields, preserving the first
acknowledgement deadline, and a three-minute handler under a 60-second session.
An uncertain guarded operation identifies its row for inspection.

A run uses a fresh worker UUID. If the configured node name and UUID together
would exceed the existing wire limit, the client uses a stable digest of the
node name on the wire. The application still uses its configured node name.

## Application observation

The built-in observer starts on each application node and uses the work
stream. A three-process test holds two shards on two nodes configured for
one delivery each. A third, identically configured node starts and picks up
work that was already waiting, before the reminder. The default configuration
allows simultaneous runs of different shards.

An application can install a custom observer with either storage option. A
normal pass releases the shard, then reads the newest pending row for the
callback. Tests with PostgreSQL and MySQL cover a separate process writing
immediately before and immediately after release.

## Delivery server processes

The default server runs in one Node.js process. With two or more children, a
public parent sends each shard to a fixed child. Each application's work
subscription discovers available shards across those children. A failed
child loses its in-memory rows and sessions. The parent restores the slot
and continues serving healthy shards. The private capacity service accounts
for changes across all slots, including writes whose replies were lost.

Real-process tests cover child loss and replacement, traffic to a healthy
slot, separate public subscribers, and an identical application node joining
a deployment with busy peers. The executable can select this mode through
`DELIVERY_PROCESS_COUNT`.
