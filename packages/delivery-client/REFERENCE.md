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
`sinceWhen` is its exclusive timestamp lower bound. When several messages share a receive time, the worker rereads that time and
compares each message's inbox counter and UUID with the last one it visited.
If a full reply contains only positions already visited, it requests more
messages using the existing RPC. An unsupported offset, or a boundary that
cannot be passed within the RPC's signed int32 page size, raises
`DeliveryPagingError`. A malformed reply raises `DeliveryProtocolError`. Inbox read results expose `whenReceived` as a Protobuf
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

`pickUp(shard, worker)` sends JVM's `ShardService.PickShard`. Suppose
two application nodes receive a notice for shard 3. The first worker to pick
it up can read its inbox. If the other worker tries, the gRPC reply names
the worker already processing it. The TS client returns `undefined` to that
second caller. Between the notice and pickup the shard may have
become empty. The first worker can then release it after reading an empty page.

A repeat pickup by the same worker refreshes the recorded pickup time.
`release(session)` sends the shard and worker to `ShardService.ReleaseSession`.
If shard 3 has since passed to another worker, the server leaves that worker
in place. The RPC returns an empty reply in either case.

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

## Application delivery and inbox storage

Suppose a page from `FindManyInShard` contains three inbox messages for the
same Aggregate. The first carries a new Command. The second carries another
copy of that Command. The third is a completed delivery whose retention
deadline has passed. The application worker processes the page as follows.

1. It calls the Aggregate's handler for the first Command. After success, it
   sets that inbox message's status to `DELIVERED` and calculates its
   retention deadline using the application clock.
2. It recognizes the second copy from the typed Command ID and recipient. It
   sets that inbox message aside for deletion. It also sets aside the expired
   completion. Neither message needs another handler call.
3. The worker sends the changed inbox message to `InboxService.WriteMany`.
   After that write succeeds, it sends the two inbox messages to `InboxService.RemoveMany`.
   It skips a call when its batch is empty. The Delivery server applies the
   writes and deletions it receives.

If the write succeeds and the deletion fails, the first inbox message
remains delivered. The worker reports the deletion error. The second copy
can still be present when another worker reads the shard. The retained
completion gives that worker evidence that the Command was already handled.

If the application stops after the handler succeeds but before the inbox
write reaches the server, the stored Command can still appear pending. A
later worker can deliver it again. Pickup coordinates workers. It does not
combine an Entity write and an inbox write into one database transaction.

## Remote delivery in an environment

`DeliveryBuilder.remote({ endpoint, clientOptions?, notifications? })` creates an unopened `ServerEnvironmentDelivery`. `RemoteDelivery.connectTo()` provides the same remote facility. `open()` constructs the client, Inbox adapter, and work registry before publishing them. It does not ask Admin for a readiness snapshot; an idle work stream cannot delay application startup. Concurrent opens share an attempt. A closed facility cannot reopen.

Built-in notifications open `ShardObservingService.ObserveAll` after endpoints are ready. Every connected application node receives current free shards with pending messages when it connects or reconnects. A disconnected reader reopens with the established increasing reconnect delay, starting at 100 milliseconds and rising to 30 seconds; an unsupported method ends that reader with the original gRPC status. The server repeats an available shard after its configured reminder interval, 10 seconds by default, while it remains free and unclaimed. A write to a busy shard becomes visible to subscribers when a release frees the shard with work still pending. Admin snapshots and updates report state for administration; they do not trigger application work.

By default, distinct shards can run simultaneously on one node. An application can set `maxConcurrentDeliveries` when configuring remote notifications. For example, if the limit is two and the node already has two deliveries in progress, it skips the next notice. The server's later reminder can offer a still-free shard again. Calls for the same shard on one node share the active delivery attempt. If a second caller cancels its wait or reaches its deadline, that caller receives `stopped`. The first caller can still finish the delivery. Another node may compete for the shard, while the Delivery server grants one live session. The result of `deliverMessagesFrom(shard)` is `completed`, `busy`, `noWork`, or `stopped`; an unrecovered read, processing, release, or post-release lookup error rejects the call. A stream notice is advisory, and only the retained message and current session permit processing.

Remote storage always uses the server work stream. For an inbox in a shared
application database, use `DeliveryBuilder.local({ storageFactory, shardObserver })`.
The observer receives the stored `InboxMessage` after a write. After a normal
delivery pass it also receives the newest pending message if any arrived late.
For example, an observer may publish the shard identity to a cloud queue. Its
consumer calls `environment.delivery.deliverMessagesFrom(shard)`. A callback
failure is logged after the successful write, and the application decides how
to recover its notification.

Environment shutdown cancels the work reader, waits for admitted runs, and closes the client HTTP/2 session. A failure in a close phase remains retryable. A handler effect and Inbox acknowledgement remain separate operations; a lost acknowledgement may cause redelivery on a later pickup. An Entity write already in progress can still finish after another worker takes the shard.

Retained messages in the current page or recent-delivery cache suppress the same
Command or Event ID at the same typed Inbox target until `keep_until`. Remote pagination
uses the JVM timestamp query and remains a bounded live scan.
