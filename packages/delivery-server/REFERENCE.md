# @spine-event-engine/delivery-server reference

## Testing entry point

`@spine-event-engine/delivery-server/testing` serves in-process framework
fixtures that need a Delivery assembly. It is not an application root API and
its compatibility boundary is limited to package-test consumers.

This reference describes the public in-memory Delivery server API. Read the
[package guide](README.md) first for the shortest local setup.

## Public entry points

`InMemoryDelivery.create(options)` returns `DeliveryCore` with Connect handler
implementations `inbox`, `shards`, and `observing`.
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
- `processingTimeoutSeconds` / `SHARD_PROCESSING_TIMEOUT` sets the age after which another worker
  can take over on pickup. Zero, the default, disables takeover by age.

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
For a batch containing messages for shard 2 and shard 3, the parent uses the
shard in each inbox ID. With two subprocesses it sends those messages to
subprocesses 0 and 1 respectively. A deletion uses only the inbox ID.
An empty batch succeeds without changing storage.
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

The standalone server accepts `processingTimeoutSeconds`. An embedded
server accepts `processingTimeoutMs`. By default a shard stays assigned
until release. For example, an operator can use JVM's `ReleaseSessions`
to release assignments that have been inactive for at least an hour.
Releasing shard 4 makes a pending Command there visible to subscribers.
If nobody takes it, the server repeats the notice after ten seconds by default.

If the standalone server is configured with a processing timeout of 60
seconds, a competing pickup can take over once **more than** 60 seconds have
passed since the recorded pickup. The work reminder interval applies to a
free shard. It does not set a deadline for a handler.

## Delivery semantics

In a single process, writes run in the order they enter the server's queue.
In a multi-process server, each storage subprocess handles the writes routed
to it in local admission order. Writes handled by different subprocesses can run at the same
time. Canceling a queued write before it starts prevents that write from
changing the inbox. Once it starts, it can finish even if the caller
disconnects before receiving the reply.

Each call to `InboxService.FindManyInShard` reads the current inbox. Its
`sinceWhen` field selects messages received strictly after the supplied time.
An omitted timestamp or an explicit zero starts at the beginning of the shard.
A nonpositive page size produces the JVM service's `UNKNOWN` gRPC status.
Suppose a worker reads two messages per page and three messages have the same
receive time. Using that time as the next lower bound would skip the third
message. The TS worker includes that instant again, asks for a larger page
when needed, and skips the messages it already visited using their inbox
counters and UUIDs. It uses the same RPC for both reads.

`ShardService.PickShard` takes a free shard, including an empty shard.
Repeating pickup with the same worker refreshes the recorded time. If a
different worker asks for the shard while that assignment is current, the
response identifies the worker that already has it.

`ReleaseSession` takes a shard and a worker. For example, if worker East
finishes after worker West has taken over, releasing East's assignment leaves
West in place. The operation returns an empty reply. `ReleaseSessions`
accepts an inactivity period. A period of 500 microseconds includes an
assignment exactly 500 microseconds old and leaves a younger one active.

The Admin `messages` count includes every stored inbox message for the shard.
For example, after the worker acknowledges the only Command, Admin still shows
one message. The work stream stays silent because that message is already delivered.
When the framework removes the retained message during a later drain, the stored
count falls to zero.

A shard that was picked up previously keeps its last pickup time in Admin.
For example, pick up an empty shard and release it. A newly opened dashboard
can still show that shard as free, with zero messages and its last pickup time.
The work stream stays silent because the inbox has no pending messages there.

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
