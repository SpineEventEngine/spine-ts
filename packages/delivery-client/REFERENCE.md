# @spine-event-engine/delivery-client reference

This reference describes the public Node Delivery client API for coding agents.

## Construction and lifecycle

`DeliveryClient.connectTo(origin, options?)` accepts an absolute HTTP(S) origin
with pathname `/`, validates options before opening an owned Connect HTTP/2
session, and returns a client. `usingTransport(transport, options?)` is the
advanced form for a caller-owned Connect transport; closing that client does not
close the supplied transport. `close()` is synchronous and idempotent. It
aborts active reads and observation streams and closes an owned session once.

Options default to page size 100, no read retry, no retry backoff, no observation
reconnect, no reconnect backoff, observation buffer 100, and operation timeout
30000 ms. Page size is 1–1000; retry/reconnect counts are 0–5; backoffs are
0–10000 ms; observation buffers are 1–1000; per-operation timeouts are
1–120000 ms.

Worker `nodeId` and `value` must be non-blank and together at most 128 UTF-8
bytes. Decoded payloads must be Command or Event envelopes. The client rejects
payloads above 1 MiB, RPC request/response bodies above 4 MiB, batches above
100, and pages above 1000.

## Operations and unknown outcomes

`findOne`, `readPage`, `newestPending`, and `shardSnapshot` are safe reads and
can use bounded retries. `writeOne`, `writeMany`, `removeOne`, `removeMany`,
`pickUp`, `release`, and `releaseExpired` are single-attempt mutations. A lost
mutation response raises `DeliveryOutcomeUnknownError`; inspect its
`reconciliation` instruction, read the remote fact, and do not blindly repeat
the mutation.

`readPage` uses the frozen timestamp-only continuation. If a full timestamp
boundary cannot continue without loss, it throws `DeliveryPagingError`.
Protocol-invalid data throws `DeliveryProtocolError`.

## Observation and topology

`observeShardUpdates()` requires one acknowledgement, has a bounded queue, and
reconnects only within configured limits. A slow consumer can receive
`ShardObservationOverflowError`; an unrecoverable stream ends with
`DeliveryShardObservationError`. Observation is a hint: reconcile a known
mutation with `shardSnapshot()` before a later action.

The remote protocol has no renewable fence or worker-conditional release. A
`PICKED` observation does not clear uncertainty; only `NOT_PICKED` invalidates
a stale local session and permits a new pickup. Do not release a stale session.

`RemoteInbox` and `RemoteWorkRegistry` satisfy the server delivery-builder
ports. `RemoteInbox` requires durable, atomically persisted, capacity-bounded
`RemovalQuarantine` records. `ADMITTED` recovery remains fail-closed for an
operator; `REMOVING` recovery reconciles/removes without replaying a callback.
This package does not add authentication, authorization, durability,
exactly-once effects, or a production topology.

## Environment-owned remote delivery

`RemoteDelivery.connectTo({ endpoint, removalQuarantine, clientOptions? })`
creates one lazy `ServerEnvironmentDelivery`. The supplied durable quarantine
transfers to that owner. Its `open()` creates one client plus one remote inbox
and work registry, then completes the client's bounded `shardSnapshot()`
readiness call before publishing those generic ports and its Admin source.
Every attached environment supervisor takes bounded snapshots, consumes later
updates as wake-up hints, and takes a fresh snapshot after a watch failure or
bounded observation overflow before consuming updates again. Durable Inbox rows
and exclusive shard pickup remain authoritative. Concurrent opens share an
attempt. A failed attempt closes only its client, does not close the quarantine,
and a later open creates a fresh client.

Every identically configured node observes and attempts every reported shard.
The remote registry admits exactly one current owner per shard; notifications
are best-effort hints and snapshot recovery is the convergent source after a
stream break or bounded overflow. There is no ordering guarantee across shards.

Environment shutdown closes the client-owned HTTP/2 session, then quarantine.
Concurrent/repeated close calls share work; a failed phase is the only phase
retried. This adds no health route, provider selector, worker, or
delivery-server mode.
