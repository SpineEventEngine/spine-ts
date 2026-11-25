# @spine-event-engine/delivery-server reference

## Testing entry point

`@spine-event-engine/delivery-server/testing` serves in-process framework
fixtures that need a Delivery assembly. It is not an application root API and
its compatibility boundary is limited to package-test consumers.

This reference describes the public in-memory Delivery server API. Read the
[package guide](README.md) first for the shortest local setup.

## Public entry points

`InMemoryDelivery.create(options)` returns `DeliveryCore` with Connect handler
implementations `inbox` and `shards`. The caller registers these handlers and
provides the network lifecycle. For a listener with work observation, Admin,
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
  0–2147483647; default 0, which disables timeout-based takeover during pickup;
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

## Recovery timers

The application `DeliverySupervisor` scans for pending work every 10 seconds by
default; its `recoveryMs` option retains an explicit override. This scan is
separate from the supervisor's default 60-second stale-session threshold
(`staleMs`) and `ShardedWorkRegistry`'s default 30-second SQL lease (`leaseMs`).
The in-memory Delivery server uses a separate processing timeout: `processingTimeoutSeconds` on the listener, or
`processingTimeoutMs` on `InMemoryDelivery`. Its default is zero, which disables
automatic pickup takeover; applications may configure a positive timeout.
This does not disable the application supervisor's separate release of stale
sessions. A positive server processing timeout alone does not shorten the
supervisor's stale-session threshold.

A scan can encounter a busy shard, an unexpired session, unavailable storage, or
failed processing. Request deadlines, retry delays, and Delivery shutdown bounds also
have separate responsibilities. A 10-second scan interval therefore guarantees
neither delivery within 10 seconds nor worker takeover within 10 seconds.

## Delivery semantics

Mutations pass a FIFO admission boundary with 100 waiting slots. Aborting before
admission commits nothing. Admission is the linearization point: once admitted,
the synchronous mutation can commit even if the caller aborts or loses its
response.

The JVM `InboxService.FindManyInShard` page RPC uses an exclusive timestamp
bound. Reads are live and do not promise a snapshot across pages. Distinct
received timestamps permit continued paging; a full page ending in tied times
is reported as unsafe continuation.
Automatic pickup takeover requires elapsed time
strictly greater than `processingTimeoutMs`; manual expiration accepts elapsed
time greater than or equal to the supplied interval. Release is not
pickup-time-conditional, but the supplied worker must match the current owner;
a stale worker cannot release a newer worker's session. This in-memory server
stores neither attempt history nor a quarantine state.

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
