# @spine-event-engine/delivery-client reference

This reference gives the exact public Node Delivery client contract. Read the
[package guide](README.md) first for the local-to-remote delivery path.

## Construction and lifecycle

`DeliveryClient.connectTo(origin, options?)` accepts an absolute HTTP(S) origin
with pathname `/`, validates options before opening a Connect HTTP/2
session, and returns a client. `usingTransport(transport, options?)` is the
advanced form for a Connect transport supplied by the caller; closing that client does not
close the supplied transport. `close()` is synchronous and idempotent. It
aborts active reads and observation streams and closes its session once.

Options default to page size 100, no read retry, no retry backoff, no observation
reconnect, no reconnect backoff, observation buffer 100, and operation timeout
30000 ms. Page size is 1–1000; retry/reconnect counts are 0–5; backoffs are
0–10000 ms; observation buffers are 1–1000; finite-operation and observation-setup timeouts are
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

`readPage` calls the existing JVM `InboxService.FindManyInShard` RPC.
`sinceWhen` is its exclusive timestamp lower bound. Invalid local offsets or
unsafe page continuation raise `DeliveryPagingError`; malformed responses raise
`DeliveryProtocolError`. Inbox read results expose `whenReceived` as a Protobuf
`Timestamp` with seconds and nanoseconds. Single and batch writes and removals
also preserve that timestamp.

## Observation and topology

`observeAvailableShards({ signal })` opens one call to
`ShardObservingService.ObserveAll`. Each item identifies a free shard with
pending work. The server may send that index again while the work is waiting.
Idle streams have no first-response deadline. To stop reading, abort the signal
or close the client. If the connection fails, the caller receives the gRPC
error. Opening another call discovers current work again.

On the TS server, an Admin snapshot and Admin updates report how many inbox
rows the server stores in each shard. This includes completed rows retained
for duplicate detection. To see whether a worker can try to pick up work, use
`observeAvailableShards()`.

`observeShardUpdates()` requires one acknowledgement, has a bounded queue, and
reconnects only within configured limits. A slow consumer can receive
`ShardObservationOverflowError`; an unrecoverable stream ends with
`DeliveryShardObservationError`. Its setup timeout never limits an acknowledged active stream. Observation is a hint: reconcile a known
mutation with `shardSnapshot()` before a later action.

`pickUpForDelivery()` requests a shard with pending work.
If a managed pickup has an uncertain outcome, the client repeats it using the
same worker and run ID within the original deadline. A grant, a busy shard, an
empty shard, or a definitive error ends the attempt. Repeated transport failures
increase the delay between tries. Closing the client or cancelling the call
also ends a wait between requests.
`pickUp()` also permits deliberately taking an empty shard.
A successful TS pickup returns a session handle for one worker and shard.
The handle carries a session ID and the lifetime set by the server. Keep that
handle when calling `renew()` or `release()`. If a worker misses the reply to
its managed pickup of shard 4, it can repeat that pickup with the same run ID. While the original session is
live, the server returns the same session ID. After releasing the shard, a new
run receives a fresh session ID. A delayed release from the first run leaves
the second run active.

Pickup and release reports expose Protobuf `Timestamp` values in `whenPicked`
and `whenReleased`. Admin observations expose the same precision in
`lastPicked` when populated. A caller can convert a timestamp to a JavaScript
`Date` for display. Keep the original seconds and nanoseconds for comparisons.

## Worker acknowledgement and cleanup

A remote worker sends its current session and the exact inbox row it read when
acknowledging a Command, removing a pending duplicate, or removing an expired
completion. The server checks both in the same operation as the change.

When calling the remote inbox adapter directly, pass the object returned by a
read. The client keeps the original Protobuf row with that object, including
fields unknown to the application. Reconstructing a row from its TypeScript
properties loses that evidence, so the client rejects such a mutation.

Suppose a worker reads row 7 and enters its Command handler. Another caller
replaces row 7 before the handler returns. Even a one-nanosecond difference in
the stored timestamp identifies a different row for this check. The server
leaves the replacement intact. If the first acknowledgement succeeded and
only its reply was lost, repeating it for the same row preserves the original
retention deadline.

Workers renew while handlers run. With the default 60-second session, a
healthy worker renews every 20 seconds. If its connection fails, the server
can grant the shard to another worker after expiry. An Entity write already
sent by the first handler may still complete. A handler that calls an external
system needs to account for a repeated Command.

Each delivery read requests one bounded logical shard page. Status filtering
advances through bounded raw pages by their last received timestamp within one
total read deadline, including pages containing only excluded statuses. The
caller's `AbortSignal` also covers that complete multi-page collection, including
later pages. The read is live: inserts behind the timestamp position require a later fresh
scan. The server
delivery policy compares pending rows with
delivered rows in the logical page and its bounded recent-delivery cache, then
removes exact duplicates without treating them as delivered acknowledgements.
The server compares the worker's exact read snapshot within the removal
operation. If a later write replaced the duplicate, the later row survives.

Remote reception writes a pending row without `keep_until`. A successful
guarded acknowledgement sets the status to `DELIVERED` and records the
server's acknowledgement time plus five seconds in `keep_until`. Before
deleting a completion, the server checks its deadline and that it still
matches the worker's read. A quiet shard can retain a completion past the
deadline until another drain visits it.

## Remote delivery in an environment

`RemoteDelivery.connectTo({ endpoint, clientOptions? })` creates one lazy
`ServerEnvironmentDelivery`. Its `open()` creates one client plus one remote
inbox and work registry, then completes the client's bounded `shardSnapshot()`
readiness call before publishing those generic ports and its Admin source.
Every attached environment supervisor takes bounded snapshots, consumes later
updates as wake-up hints, and takes a fresh snapshot after a watch failure or
bounded observation overflow before consuming updates again. Durable Inbox rows
and exclusive shard pickup remain authoritative. Concurrent opens share an
attempt. A failed attempt closes only its client, and a later open creates a
fresh client.

Every identically configured node observes and attempts every reported shard.
The remote registry admits exactly one current owner per shard; notifications
are best-effort hints and snapshot recovery is the convergent source after a
stream break or bounded overflow. The winning owner repeats finite drains until
no deliverable Inbox row remains, including rows arriving during an active
drain, before release. There is no ordering guarantee across shards. The
immediate pre-commit ownership probe fences a detected stale owner, but cannot
make remote ownership and Entity storage one linearizable distributed
transaction.

Environment shutdown closes the client's HTTP/2 session. Concurrent/repeated
close calls share work; a failed phase is the only phase retried. This adds no
health route, provider selector, worker, or
delivery-server mode.

Retained rows in the current page or recent-delivery cache suppress the same
signal ID at the same typed Inbox target until `keep_until`. Remote pagination
uses the JVM timestamp query and remains a bounded live scan.
