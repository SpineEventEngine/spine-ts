# @spine-event-engine/delivery-server reference

## Testing entry point

`@spine-event-engine/delivery-server/testing` serves in-process framework
fixtures that need a Delivery assembly. It is not an application root API and
its compatibility boundary is limited to package-test consumers.

This reference describes the public in-memory Delivery server API. Read the
[package guide](README.md) first for the shortest local setup.

## Public entry points

`InMemoryDelivery.create(options)` returns `DeliveryCore` with Connect handler
implementations `inbox`, `shards`, and `managed`. The caller registers these handlers and
provides the network lifecycle. Call `close()` on the core during shutdown to
cancel session timers. For a listener with work observation, Admin,
and health, start a `DeliveryServer`.

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
- `maxInboundMessageBytes` / `MAX_INBOUND_MESSAGE_SIZE`: integer 1–2147483647;
  default 4194304;
- `processingTimeoutSeconds` / `SHARD_PROCESSING_TIMEOUT`: integer
  seconds of inactivity before the server expires a session, default 60;
- retained message/byte limits: integer 1–2147483647; defaults 10000 and
  33554432;
- tracked shards: integer 1–1000; default 1000.

The core accepts pages of 1–1000 messages, mutation batches of 1–100 messages,
payloads no larger than 1 MiB, and request/response bodies no larger than 4
MiB. Capacity is finite: an operation that would exceed retained messages,
bytes, or shards fails atomically with `RESOURCE_EXHAUSTED`; it is not partially
accepted or silently shortened.

## Work reminder interval

`workReminderSeconds` configures the interval before the server repeats a
notice for a free shard that still contains pending rows. The executable reads
`WORK_REMINDER_SECONDS`. The default is ten seconds.
The accepted value is a whole number of seconds from 1 through
`Math.floor(Number.MAX_SAFE_INTEGER / 1_000)`.

For example, setting it to 30 gives workers thirty seconds before the server
sends a reminder for the same unclaimed shard. A new subscriber still receives
that shard during initial discovery. Taking the shard stops its reminders.

## Session lifetime and work reminders

The standalone server uses `processingTimeoutSeconds` for session lifetime.
In an embedded core, set `processingTimeoutMs`. The default is 60 seconds.
After a successful renewal the worker has another session lifetime to complete
its work or renew again.

Suppose a worker takes shard 4 at noon and immediately loses its connection.
At 12:01 the default session expires. If a Command is still waiting there,
the server offers shard 4 to connected subscribers. If nobody takes it,
subscribers receive the next reminder ten seconds later by default.
A successful pickup by another worker stops those reminders.

## Delivery semantics

Mutations pass a FIFO admission boundary with 100 waiting slots. Aborting before
admission commits nothing. Admission is the linearization point: once admitted,
the synchronous mutation can commit even if the caller aborts or loses its
response.

The JVM `InboxService.FindManyInShard` page RPC uses an exclusive timestamp
bound. Reads are live and do not promise a snapshot across pages. Distinct
received timestamps permit continued paging; a full page ending in tied times
is reported as unsafe continuation.
A session expires when elapsed time reaches its lifetime. Explicit inactivity
release also includes sessions exactly at the requested age. For example, a
request specifying 500 microseconds leaves a 499-microsecond session active.

Ordinary renewal and release use the shard, worker, and session ID from the
grant. A release from a previous pickup leaves the newer session active, even
when both pickups used the same worker ID. The server records the pickup time
and samples the clock again for a successful pickup reply, following JVM
Delivery. The reported times can therefore differ slightly. The session ID
identifies the pickup across those clock readings and subsequent renewals.

The Admin `messages` count includes every stored inbox row for the shard.
For example, after the worker acknowledges the only Command, Admin still shows
one row. The work stream stays silent because that row is already delivered.
When the framework removes the retained row during a later drain, the stored
count falls to zero.

An Admin subscription sends its acknowledgement, the current state of known
shards, and subsequent changes. Changes within 25 milliseconds can be combined
for the same shard. Changes to a different shard have their own interval.
Removing the final row from a free shard sends its empty state to the dashboard.

Health `Check` reports registered names while the listener serves;
unknown names are `NOT_SERVING`. Health `Watch` is not implemented.

## Security and topology limits

All state is process-local and lost at restart. The server provides no durable
recovery, cluster coordination, Redis/Hazelcast mode, TLS, authentication,
authorization, public-Internet hardening, CLI flags, or configuration reload.
An application may choose a non-loopback bind or a proxy, but those deployment
controls remain its responsibility.
