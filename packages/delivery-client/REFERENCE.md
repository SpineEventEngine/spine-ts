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

The client requests 100 inbox messages per page by default. For example, `pageSize: 2000`
requests up to 2,000 messages per call. The wire field is a positive Protobuf
`int32`. Batches may contain any number of distinct messages for the same shard
that fit in one gRPC message.

`connectTo()` accepts `maxInboundMessageBytes` for replies and
`maxOutboundMessageBytes` for requests. Omit them to use the transport's
own message-size range. With `usingTransport()`, configure the supplied
transport directly. Worker and node IDs must contain text.

A call runs until it completes, the caller cancels it, or the connection
ends. To set a deadline, supply `timeoutMs` on the call. Read retries and
Admin reconnects are opt-in. The caller selects the retry count and delay. A read deadline includes the wait before each retry. If a pickup exceeds a configured transport size, the client stops and reports the shard to check. A server may already have granted the pickup before the transport rejected its reply.

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
messages the server stores in each shard. This includes completed messages retained
for duplicate detection. To see whether a worker can try to pick up work, use
`observeAvailableShards()`.

`observeShardUpdates()` opens the Admin stream and checks its acknowledgement.
The client reads another update when its consumer accepts the current one.
For example, a slow dashboard can read an initial replay of 500 shards.
An explicit setup timeout ends at acknowledgement. A later disconnect follows
the caller's reconnect settings.

`pickUpForDelivery()` requests a shard with pending work.
If a managed pickup has an uncertain outcome, the client repeats it using the
same worker and run ID within the original deadline. A grant, a busy shard, an
empty shard, or a definitive error ends the attempt. Repeated transport failures
increase the delay between tries. Closing the client or cancelling the call
also ends a wait between requests. Retry waits count toward the caller’s operation
deadline. The worker measures a granted session’s lifetime from the pickup
request that returned the grant.
`pickUp()` also permits deliberately taking an empty shard.
A successful TS pickup returns a session handle for one worker and shard.
The handle carries a session ID and the lifetime set by the server. Keep that
handle when calling `renew()` or `release()`. If a worker misses the reply to
its managed pickup of shard 4, it can repeat that pickup with the same run ID. While the original session is
live, the server returns the same session ID. After releasing the shard, a new
run receives a fresh session ID. A delayed release from the first run leaves
the second run active. If a renewal reply is lost, the worker stops processing
and can still send a release for its original session. If the server still
has that session, the release frees the shard. If another worker has taken
its place, the release leaves that worker’s session active.

`releaseExpired(inactivityMs)` asks the server to release every session that
has been idle for that long. If the releases succeed but the reply is lost
or exceeds a transport message-size setting, the client throws
`DeliveryOutcomeUnknownError`. For example, a second call can return an empty
list because the first call already released the sessions. A shard snapshot
shows which sessions are active now. It cannot reconstruct the earlier list.

Pickup and release reports expose Protobuf `Timestamp` values in `whenPicked`
and `whenReleased`. Admin observations expose the same precision in
`lastPicked` when populated. A caller can convert a timestamp to a JavaScript
`Date` for display. Keep the original seconds and nanoseconds for comparisons.

## Worker acknowledgement and cleanup

A remote worker sends its current session and the exact inbox message it read when
acknowledging a Command, removing a pending duplicate, or removing an expired
completion. The server checks both in the same operation as the change.

The framework passes the message it read straight to the client. Code using the
public `DeliveryClient` can do the same. For example, after a worker has picked
up a shard, it can pass the result of `await client.findOne(id)`, when present,
to `await client.acknowledgeGuarded(session, message)`. The same read result
works with `removeDuplicateGuarded` and `removeDeliveredGuarded`. Keep that
object. The client retains the original Protobuf data with it, including fields
the current schema cannot interpret.

Suppose a worker reads message 7 and enters its Command handler. Another caller
replaces message 7 before the handler returns. Even a one-nanosecond difference in
the stored timestamp identifies a different message for this check. The server
leaves the replacement intact. If the first acknowledgement succeeded and
only its reply was lost, repeating it for the same message preserves the original
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
delivery policy compares pending messages with
delivered messages in the current page and those acknowledged locally within the five-second retention window, then
removes exact duplicates without treating them as delivered acknowledgements.
The server compares the worker's exact read snapshot within the removal
operation. If a later write replaced the duplicate, the later message survives.

The remote adapter writes a pending message without `keep_until`. A successful
guarded acknowledgement sets the status to `DELIVERED` and records the
server's acknowledgement time plus five seconds in `keep_until`. Before
deleting a completion, the server checks its deadline and that it still
matches the worker's read. A quiet shard can retain a completion past the
deadline until another drain visits it.

## Remote delivery in an environment

`DeliveryBuilder.remote({ endpoint, clientOptions?, notifications? })` creates an unopened `ServerEnvironmentDelivery`. `RemoteDelivery.connectTo()` provides the same remote facility. `open()` constructs the client, Inbox adapter, and work registry before publishing them. It does not ask Admin for a readiness snapshot; an idle work stream cannot delay application startup. Concurrent opens share an attempt. A closed facility cannot reopen.

Built-in notifications open `ShardObservingService.ObserveAll` after endpoints are ready. Every connected application node receives current free shards with pending messages when it connects or reconnects. A disconnected reader reopens with the established increasing reconnect delay, starting at 100 milliseconds and rising to 30 seconds; an unsupported method ends that reader with the original gRPC status. The server repeats an available shard after its configured reminder interval, 10 seconds by default, while it remains free and unclaimed. A write to a busy shard is observed after release or expiry. Admin snapshots and updates report state for administration; they do not trigger application work.

By default, distinct shards can run simultaneously on one node. Remote nodes accept an optional positive `maxConcurrentDeliveries`; the node reserves a place before pickup and drops excess notices. The server's later reminder can offer a still-free shard again. Calls for the same shard on one node share the active delivery attempt. If a second caller cancels its wait or reaches its deadline, that caller receives `stopped`. The first caller can still finish the delivery. Another node may compete for the shard, while the Delivery server grants one live session. The result of `deliverMessagesFrom(shard)` is `completed`, `busy`, `noWork`, or `stopped`; an unrecovered read, processing, release, or post-release lookup error rejects the call. A stream notice is advisory, and only the retained message and current session permit processing.

Remote storage always uses the server work stream. For an inbox in a shared
application database, use `DeliveryBuilder.local({ storageFactory, shardObserver })`.
The observer receives the stored `InboxMessage` after a write. After a normal
delivery pass it also receives the newest pending message if any arrived late.
For example, an observer may publish the shard identity to a cloud queue. Its
consumer calls `environment.delivery.deliverMessagesFrom(shard)`. A callback
failure is logged after the successful write, and the application decides how
to recover its notification.

Environment shutdown cancels the work reader, waits for admitted runs, and closes the client HTTP/2 session. A failure in a close phase remains retryable. A handler effect and Inbox acknowledgement remain separate operations; a lost acknowledgement may cause redelivery after session expiry. Guarded acknowledgements and cleanup require the same live session and exact message snapshot, while a current Entity write can still finish after another worker takes over.

Retained messages in the current page or recent-delivery cache suppress the same
Command or Event ID at the same typed Inbox target until `keep_until`. Remote pagination
uses the JVM timestamp query and remains a bounded live scan.
