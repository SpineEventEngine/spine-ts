# @spine-event-engine/delivery-server reference

## Testing entry point

`@spine-event-engine/delivery-server/testing` serves in-process framework
fixtures that need a Delivery assembly. It is not an application root API and
its compatibility boundary is limited to package-test consumers.

This reference describes the public in-memory Delivery server API. Read the
[package guide](README.md) first for the shortest local setup.

## Public entry points

`InMemoryDelivery.create(options)` returns `DeliveryCore` with Connect handler
implementations `inbox`, `shards`, `managed`, and `observing`.
Register `observing` for `ShardObservingService` so application nodes can receive work notices.
The caller supplies the network listener. Call `close()` to finish streams and cancel
timers. The standalone `DeliveryServer` also provides the Admin and health services.

`DeliveryServer` is the standalone lifecycle owner. Its constructor validates
and resolves configuration exactly once. `start()` is idempotent and concurrent
calls share one promise. `baseUrl` is available only after successful startup.
`close()` is idempotent, terminal, and shares one promise; it stops service,
rejects unadmitted work, ends Admin and work streams, cancels work reminders,
and closes listener sessions.
Neither a failed start nor a closed instance can be restarted.

The CLI `spine-delivery-server` starts that same server and closes it once on
`SIGINT` or `SIGTERM`. Embedded callers handle signals and call `close()`.

## Configuration and limits

Explicit `DeliveryServerOptions` override the associated environment variables,
which override defaults. Invalid values throw before a listener is created:

- `host` / `HOST`: non-blank text; default `127.0.0.1`;
- `port` / `PORT`: integer 0–65535; default 8484;
- `processCount` / `DELIVERY_PROCESS_COUNT`: positive safe integer; default 1;
- `maxInboundMessageBytes` / `MAX_INBOUND_MESSAGE_SIZE` controls the bytes
  received in one gRPC message. `maxOutboundMessageBytes` /
  `MAX_OUTBOUND_MESSAGE_SIZE` controls the bytes sent. Both accept integers
  from 1 to 4,294,967,295. The default is the upper end of the transport's range.
- `processingTimeoutSeconds` / `SHARD_PROCESSING_TIMEOUT` sets the session
  lifetime. It defaults to 60 seconds.

The in-memory inbox keeps two balanced trees per shard. One orders all stored
messages, the other orders messages waiting for delivery. They use receive
seconds, nanoseconds, version, and inbox UUID. For example, if a worker
acknowledges the newest pending Command, that Command leaves the pending tree
and stays in the full tree until cleanup. Writing a replacement with the same
inbox ID updates its position and status in both collections.

The inbox uses available process memory. A batch of 150 valid inbox messages for
the same shard can be stored in one request. A reader can request a page of
2,000 messages. The configured gRPC size applies to both the public connection
and the connections to storage subprocesses.

With `processCount` greater than one, the public endpoint runs in a parent
process and starts that many homogeneous child processes. Shard number `s`
routes to subprocess `s % processCount`. The public endpoint forwards each
shard-specific gRPC call there. That subprocess handles the read, write,
pickup, renewal, or release and returns its result.
The parent combines Admin snapshots and streams work notices from all healthy
children. When a subprocess exits, it loses its in-memory inbox messages and sessions. Its shards are
temporarily unavailable while its replacement starts. The other subprocess
continues serving its shards.

## Work reminder interval

`workReminderSeconds` configures the interval before the server repeats a
notice for a free shard that still contains pending messages. The executable reads
`WORK_REMINDER_SECONDS`. The default is ten seconds.
The accepted value is a whole number of seconds from 1 through
`Math.floor(Number.MAX_SAFE_INTEGER / 1_000)`.

For example, setting it to 30 gives workers thirty seconds before the server
sends a reminder for the same unclaimed shard. A new subscriber still receives
that shard during initial discovery. Taking the shard stops its reminders.

## Session lifetime and work reminders

The standalone server uses `processingTimeoutSeconds` for session lifetime.
In an embedded core, register `delivery.observing` for `ShardObservingService`. Set `reminderIntervalMs` for repeat notices and `processingTimeoutMs` for the lease. Their defaults are 10 seconds and 60 seconds respectively.
After a successful renewal the worker has another session lifetime to complete
its work or renew again.

Suppose a worker takes shard 4 at noon and immediately loses its connection.
At 12:01 the default session expires. If a Command is still waiting there,
the server offers shard 4 to connected subscribers. If nobody takes it,
subscribers receive the next reminder ten seconds later by default.
A successful pickup by another worker stops those reminders.

## Delivery semantics

In a single process, writes run in the order they enter the server's queue.
In a multi-process server, each storage subprocess handles the writes routed
to it in local admission order. Writes handled by different subprocesses can run at the same
time. Canceling a queued write before it starts prevents that write from
changing the inbox. Once it starts, it can finish even if the caller
disconnects before receiving the reply.

Each call to `InboxService.FindManyInShard` reads the current inbox. Its
`sinceWhen` field selects messages received strictly after the supplied time.
Suppose a worker reads two messages per page and three messages have the same
receive time. Using that time as the next lower bound would skip the third
message. The TS worker includes that instant again, asks for a larger page
when needed, and skips the messages it already visited using their inbox
counters and UUIDs. It uses the same RPC for both reads.

A session expires when elapsed time reaches its lifetime. Explicit inactivity
release also includes sessions exactly at the requested age. For example, a
request specifying 500 microseconds leaves a 499-microsecond session active.

A raw pickup can open a session on an empty shard. The process serving that
shard keeps a session record and an expiry timer until release or expiry.
Each additional live session consumes memory even when the inbox contains
zero messages. Queued writes also use memory while they wait for execution.

Ordinary renewal and release use the shard, worker, and session ID from the
grant. A release from a previous pickup leaves the newer session active, even
when both pickups used the same worker ID. The server records the pickup time
and samples the clock again for a successful pickup reply, following JVM
Delivery. The reported times can therefore differ slightly. The session ID
identifies the pickup across those clock readings and subsequent renewals.

The Admin `messages` count includes every stored inbox message for the shard.
For example, after the worker acknowledges the only Command, Admin still shows
one message. The work stream stays silent because that message is already delivered.
When the framework removes the retained message during a later drain, the stored
count falls to zero.

An Admin subscription sends its acknowledgement, the current state of known
shards, and subsequent changes. Changes within 25 milliseconds can be combined
for the same shard. Changes to a different shard have their own interval.
Removing the final message from a free shard sends its empty state to the dashboard.

Health `Check` reports registered names while the listener serves;
unknown names are `NOT_SERVING`. Health `Watch` is not implemented.

## Security and topology limits

All state is process-local and lost at restart. The server provides no durable
recovery, cluster coordination, Redis/Hazelcast mode, TLS, authentication,
authorization, public-Internet hardening, CLI flags, or configuration reload.
An application may choose a non-loopback bind or a proxy, but those deployment
controls remain its responsibility.

A dashboard that pauses can still see the latest state for every changed shard. While an update is waiting to be read, a newer state for the same shard replaces it. For example, if the inbox count changes from one to two to three before the dashboard reads the update, it receives three.
