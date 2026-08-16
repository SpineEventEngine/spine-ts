# @spine-event-engine/transport reference

This reference is for agents integrating the public transport contracts.

## Public entry points

`@spine-event-engine/transport` exports the `SignalTransport` contract,
transport topic/routing/subscription/operation types, and immutable helpers
`TransportTopics`, `TransportSubscriptions`, and `TransportOperations`.
`@spine-event-engine/transport/zeromq` exports `ZeroMqConfig` and
`createZeroMqTransport` and `createZeroMqTransportFactory`.

## Topics and subscriptions

`TransportTopics.create()` validates a signal kind and message type URL, then
creates a copy-safe topic with a deterministic routing key.
`TransportSubscriptions.create()` creates an immutable descriptor
for a subscriber and a topic. Its mode is `fan-out` by default or
`competing-consumer` when requested. `TransportOperations.hasKind()` checks an
operation's signal kind.

`SignalTransport.publish()`, `.request()`, `.respond()`, and `.subscribe()`
are asynchronous. A subscription returns a closeable handle. Closing a
transport closes its active handles and rejects new operations.

## ZeroMQ adapter

`ZeroMqConfig.create()` accepts an absolute local `ipcDirectory` and an
optional adapter identity. `createZeroMqTransport()` creates a same-host
adapter from that config. The adapter uses deterministic local IPC endpoint
files and requires the native `zeromq` package. It does not provide a remote
cluster topology, durable delivery, or a cross-machine guarantee.

The adapter accepts optional request and receive timeout settings. Callers must
close handles and the transport during shutdown.

`createZeroMqTransportFactory()` creates the distinct typed integration-message
channel adapter. It exchanges generated `ExternalMessage` Protobuf frames on
private local IPC channels; it does not expose SignalTransport routing,
requests, or subscriptions.

## Integration message channels

The root also exports `TransportFactory`, `MessageChannel`, `Publisher`,
`Subscriber`, `ExternalMessageConsumer`, `ConsumerHandle`, and
`InMemoryTransportFactory`. These typed channels carry only generated
`ExternalMessage` Protobuf frames keyed by generated `ChannelId`; they are
distinct from `SignalTransport` routing and request/respond operations.

`TransportFactory.createPublisher(id)` and `.createSubscriber(id)` create
typed channels. A publisher calls `publish(id, message)`; a subscriber adds
consumers and receives copied frames. Channel, factory, and consumer-handle
close methods are asynchronous; consumer removal and close are idempotent.
Each publisher preserves FIFO order. Publication attempts every currently
discovered subscriber and rejects with an aggregate failure only after those
attempts finish. Subscriber consumers run serially. Close drains accepted work
and reports retained send, receive, consumer, or heartbeat failures. This is
local acceptance, not a remote acknowledgement.

The transport is best effort and has no broker retry, replay, deduplication,
fencing, durable queue, or exactly-once guarantee. Many subscribers can consume
one producer's event; the broker does not elect or enforce a producer.

`InMemoryTransportFactory` is the one-process local/test implementation.
`createZeroMqTransportFactory(ZeroMqConfig.create({ ipcDirectory }))` provides
the same typed channel seam over private same-host IPC for separate Node
processes. Both adapters exchange binary Protobuf frames, never JSON or V8
serialization. Neither adapter provides a cross-machine guarantee.

The ZeroMQ factory uses adapter-private PUSH/PULL endpoints and subscriber
manifests so multiple contexts may publish status and configuration channels.
It creates owner-checked `0700` directories and atomic `0600` manifests, bounds
each manifest to 4096 bytes and discovery to 1024 entries, and rechecks
directory identity before use. Five-second heartbeat age plus process/socket
liveness identifies stale entries. Malformed, oversized, symlink, non-file, or
stale manifests are removed and skipped; valid foreign adapter identities are
ignored rather than deleted. These manifests are discovery metadata, never
event persistence.

The native adapter accepts at most 1 MiB for one complete encoded
`ExternalMessage` frame (including nested `Any` and `Event` payload bytes), on
both publish and receive. This fixed adapter-private resource bound adds no
wire field or nested protocol. A raw undecodable or oversized received frame is
dropped and later frames continue. A consumer failure likewise does not stop
the receive loop, but is retained as a bounded observable failure from close.
