# @spine-event-engine/transport reference

This reference is for agents integrating the public transport contracts.

## Public entry points

`@spine-event-engine/transport` exports the `SignalTransport` contract,
transport topic/routing/subscription/operation types, and immutable helpers
`TransportTopics`, `TransportSubscriptions`, and `TransportOperations`.
`@spine-event-engine/transport/zeromq` exports `ZeroMqConfig` and
`createZeroMqTransport`.

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

## Integration message channels

The root also exports TransportFactory, MessageChannel, Publisher, Subscriber, ExternalMessageConsumer, ConsumerHandle, and InMemoryTransportFactory. These typed channels carry only generated ExternalMessage frames keyed by generated ChannelId; they are distinct from SignalTransport routing and request/respond operations. Factory, channel, and consumer-handle close methods are asynchronous and idempotent where removal is required.
