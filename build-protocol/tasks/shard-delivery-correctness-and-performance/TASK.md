# Shard delivery correctness and performance

High-risk implementation on `shard-delivery-correctness-and-performance`, from official master `569dd58c0`. This task changes serialized contracts, library entry points, session and inbox concurrency, and server topology. Scope is Spine TS. The application replicas have identical code and settings and share the required stores.

## Requirements and acceptance

1. Ship a TS-specific `ShardObservingService.ObserveAll(Empty)` in `spine/delivery/message_delivery.proto`. The streamed response contains only the required shard index. Document the complete notification contract on the method itself. Register before discovering existing free shards with pending rows; omit held and completed-only shards; remain silent while idle; recheck on release or expiry; repeat unclaimed work after a configurable interval (10 seconds by default). Additional writes cannot postpone the reminder. Reconnect discovers current work. The notice grants no session. Preserve the Admin wire descriptor.
2. Port per-shard ordered and pending indexes and exact stored counts from JVM Delivery issues 70 and 71, preserving TS page continuation, atomic batch rejection. Admin and expiration replies return the complete list or fail if its encoded size exceeds the configured gRPC transport size. After the Admin acknowledgement, replay known shards. Send the first eligible change immediately, coalesce later changes independently per shard using the approved JVM default of 25 milliseconds, and suppress consecutive identical states. Preserve the existing five-second opportunistic retention policy.
3. Recover uncertain pickup with a stable run ID; differentiate busy and no work; require live session handles and changing record revisions for managed renewal/release. Server-driven 60-second default expiry and renewal at one third of the lifetime. Retain Protobuf time precision. Guard worker acknowledgement and both deletion paths with session and wire-exact row identity. Do not couple delivery with Entity persistence.
4. Replace the supervisor with built-in all-shard observation for remote storage or an application-selected custom observer for application-managed storage through normal environment startup. Independent same-config nodes may run distinct shards concurrently without a default cap. Offer per-node concurrency only for built-in server observation. Join simultaneous same-shard local calls. Preserve monitor actions, cancellation, and orderly shutdown. Publish the new higher-level run result and shared newest-pending inbox operation. On normal completion release before checking the pending row, remove the local run before invoking the custom observer, and log callback failures without retry. Test new-node startup and equal-configuration replicas, stale notices, and missed notifications.
5. Keep one server process by default. Offer one public gRPC parent with a fixed number of homogeneous child processes and private gRPC endpoints. Route the full shard identity by index modulo child count. Each subprocess applies shard operations directly. Fan out global calls and provide fresh subscriptions to each public subscriber. Restart a lost child in its original slot, keep healthy slots serving and discard old handles and obsolete stream responses.
6. Update maintained applications, docs, wire and behavior tests, and operator settings. Use targeted mechanical checks and relevant specialist reviews, followed by release verification, versioning and final security review. No JVM changes and no migration or compatibility shims.

## Approved corrections

- Application code posts a Command or Event through its bus. Only framework code writes the resulting inbox message. Remove raw inbox writing from the application Delivery API.
- Store each independently received signal with a new inbox ID in one create-or-update operation. An explicit write using an existing inbox ID replaces the previous message. Remove the write outcome classification, pre-read, and same-signal sharing between overlapping writes, including batch writes. Two callers may still join the same active shard delivery.
- A remote inbox requires the server work stream. The optional per-node concurrency setting applies to that configuration. A custom observer runs only with application-managed storage.
- Maintain balanced trees for all stored and pending messages in each in-memory server shard. Order by receive seconds, nanoseconds, version and UTF-8 inbox UUID. Replacing one stored ID updates its position and pending status.
- Follow core-jvm `DoubleDispatchGuard` at `6d349cb86` for Aggregates and Process Managers. If enabled, examine the typed cause of the configured number of recent emitted Events, including earlier committed outputs from the same batch. Match a Command or Event before invoking its handler and report the corresponding duplicate dispatch outcome. Process Managers need their Event journal enabled.
- Keep the Agent’s optional duplicate memory local to its process. Inbox acknowledgement remains independent of the handler’s business effect.

## Reference and execution

The application-side comparison used core-jvm Delivery.java, DeliveryMonitor.java and ShardObserver.java at f2bdce55. Server and remote adapter comparisons used Delivery v0.24.0 ShardInbox.kt, ShardUpdateSender.kt, DeliveryShardRegistry.java, ShardService.java and WorkRegistry.java. Check for late work on normal release in both notification modes. The Delivery server checks its pending index and offers a free shard to built-in observers. With a custom observer, the framework reads the newest pending inbox row and passes it to the callback. Node's child-process and the repository's existing gRPC, Protobuf and clock implementations are the starting points.

Implementation sequence and decisions:

- Use separate work and Admin publishers. The work publisher registers before discovery and checks availability again before sending. The low-level reader must accept an indefinitely silent stream and preserve transport status. Automatic expiry is completed with managed sessions.
- Managed pickup requires pending work and returns a grant, contention, or no work. Recover a lost pickup reply using the same attempt identity. Use a fresh identity for each independent run. A deliberate low-level pickup can take an empty shard and returns a session handle. Ordinary renewal and single-session release require that handle for every session. A worker-only release cannot clear any session, and generic pickup cannot recover a managed handle. Finish in-flight renewal before releasing. Check cancellation at mutation admission.
- Track exact encoded inbox rows or revisions through decoding. Page ordering uses receive time, version and UTF-8 message ID. Admin counts stored rows, including retained completions. Replay known states and suppress identical consecutive states per shard.
- An application's nodes use the same configuration. A joining node must discover existing free work through its own subscription, even through a multi-process parent. A custom observer receives an inbox row after a successful write or after a normal run finds a late pending row. An exception during processing still releases the session. Distinguish lookup failure from callback failure.
- The public endpoint forwards the original gRPC operation to the subprocess for that shard. The subprocess applies it and returns the result. Aggregate global results only when all required slots respond.

## Application work stream

Each subscriber receives the free shards with pending work when it connects.
The server checks again before sending a queued notice. If a worker has taken
the shard or the last pending row was removed, the subscriber skips that notice.
Closing the stream detaches the subscriber and its cancellation listener.

The gRPC method documents when a notice repeats, how pickup stops reminders,
and how release, expiry, and reconnect make existing work visible. The Admin
stream has its own snapshot and update rules.

## Indexed storage and Admin

Each shard keeps one balanced tree for all its inbox messages and one for its
pending messages. The full message ID selects the stored message directly.
A page scan can start after the caller's timestamp, and the pending tree
provides the newest pending message for a single shard. The Admin count
includes both pending and retained delivered messages.

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

A run uses the configured node name and a fresh worker UUID. Pickup recovery uses the same worker ID for that run.

## Application observation

The built-in observer starts on each application node and uses the work
stream. A three-process test holds two shards on two nodes configured for
one delivery each. A third, identically configured node starts and picks up
work that was already waiting, before the reminder. The default configuration
allows simultaneous runs of different shards.

An application can install a custom observer with application-managed storage. Remote inbox storage requires the Delivery server’s work stream. A
normal pass releases the shard, then reads the newest pending row for the
callback. Tests with PostgreSQL and MySQL cover a separate process writing
immediately before and immediately after release.

## Delivery server processes

The default server runs in one Node.js process. With two or more children, a
public parent sends each shard to a fixed child. Each application's work
subscription discovers available shards across those children. A failed
child loses its in-memory rows and sessions. The parent restores the slot
and continues serving healthy shards. Each subprocess runs the same inbox and shard services as the single-process
server. A caller can cancel a write before it starts. If the write finishes
and its reply is lost, the caller may have to check the inbox to learn the result.

Real-process tests cover child loss and replacement, traffic to a healthy
slot, separate public subscribers, and an identical application node joining
a deployment with busy peers. The executable can select this mode through
`DELIVERY_PROCESS_COUNT`.

## Delivery resource limits

Inbox storage, same-shard batch writes, and Admin updates use the available memory. The transport enforces its configured inbound and outbound message sizes. The wire page size uses a positive Protobuf int32. Applications may set operation deadlines, retries, and built-in delivery concurrency explicitly.
