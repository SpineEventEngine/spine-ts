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

The single-process observing endpoint and its low-level client are implemented. The indexed inbox and stored-row Admin reporting are implemented. Typed sessions, server expiry and same-run pickup recovery are implemented. Worker mutations now require the managed session and exact read row. Current milestone: framework/application observation. Pending milestones: child-process topology, combined verification and release review.

Milestone 1 review corrections: queued work notices are removed when a shard becomes held or empty, and availability is checked again before sending. Closed or already-aborted streams end without registering a subscriber; shutdown detaches active abort listeners. The low-level client detaches its caller listener and active read immediately on abort, including while paused after a response. Tests use a packed To-do `CreateTask` Command and typed task target. Focused server and client observation tests, package typecheck, ESLint, TSDoc, and cleanup checks pass. Automatic session expiry remains in the managed-sessions milestone.


## Indexed storage and Admin

Page reads and newest-pending lookups now use the selected shard. The same local
two-row page measurement with 8 and 4,008 total rows took about 19 and 297
microseconds before indexing, and 20 and 17 after indexing. A regression test
also verifies the read without a scan of the global message map.

Admin replays 150 known shards with a concurrent write in a regression test.
The old application supervisor still assumes the Admin count means pending
work. Replace that scheduling path and exercise stream interruption directly
in the two affected client scenarios before release.


## Managed sessions

The TS client and embedded or standalone server use the typed session service.
The server compares the revision seen at request entry with the revision at
mutation time. Session identity lasts across renewals. Automatic expiry uses
a monotonic clock. Explicit inactivity release and public reports use full
Protobuf timestamps. A separate successful-pickup sample follows JVM timing.

Recovery uses the original run ID, deadline and cancellation. Tests cover lost
pickup replies, release while renewal is in flight, explicit and automatic
expiry, malformed handles and cancellation while waiting to retry. Worker-side
renewal through a long-running handler and guarded writes remain part of the
following milestone.


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
