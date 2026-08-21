# @spine-event-engine/delivery-server reference

## Testing entry point

`@spine-event-engine/delivery-server/testing` serves in-process framework
fixtures that need a Delivery assembly. It is not an application root API and
its compatibility boundary is limited to package-test consumers.

This reference describes the public in-memory Delivery server API. Read the
[package guide](README.md) first for the shortest local setup.

## Public entry points

`InMemoryDelivery.create(options)` returns `DeliveryCore` with Connect handler
implementations `inbox` and `shards`. It does not open a listener or install
Admin/health handlers. The caller registers these handlers and provides the
network lifecycle.

`DeliveryServer` is the standalone lifecycle owner. Its constructor validates
and resolves configuration exactly once. `start()` is idempotent and concurrent
calls share one promise. `baseUrl` is available only after successful startup.
`close()` is idempotent, terminal, and shares one promise; it stops service,
rejects unadmitted work, completes Admin streams, and closes listener sessions.
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
  0–2147483647; default 0, which disables automatic takeover;
- retained message/byte limits: integer 1–2147483647; defaults 10000 and
  33554432;
- tracked shards: integer 1–1000; default 1000.

The core accepts pages of 1–1000 messages, mutation batches of 1–100 messages,
payloads no larger than 1 MiB, and request/response bodies no larger than 4
MiB. Capacity is finite: an operation that would exceed retained messages,
bytes, or shards fails atomically with `RESOURCE_EXHAUSTED`; it is not partially
accepted or silently shortened.

## Delivery semantics

Mutations pass a FIFO admission boundary with 100 waiting slots. Aborting before
admission commits nothing. Admission is the linearization point: once admitted,
the synchronous mutation can commit even if the caller aborts or loses its
response.

Inbox pages are strict after the supplied timestamp and ordered by full wire
timestamp, version, and UUID. Automatic pickup takeover requires elapsed time
strictly greater than `processingTimeoutMs`; manual expiration accepts elapsed
time greater than or equal to the supplied interval. Release is not
pickup-time-conditional, but the supplied worker must match the current owner;
a stale worker cannot release a newer worker's session. This in-memory server
stores neither attempt history nor a quarantine state.

Admin observation acknowledges first and then streams updates through a bounded
queue. Health `Check` reports registered names while the listener serves;
unknown names are `NOT_SERVING`. Health `Watch` is not implemented.

## Security and topology limits

All state is process-local and lost at restart. The server provides no durable
recovery, cluster coordination, Redis/Hazelcast mode, TLS, authentication,
authorization, public-Internet hardening, CLI flags, or configuration reload.
An application may choose a non-loopback bind or a proxy, but those deployment
controls remain its responsibility.
