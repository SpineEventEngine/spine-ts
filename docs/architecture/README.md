# Spine TS architecture

Spine TS follows the Spine server model: bounded contexts contain entity,
repository, command-bus, event-bus, and integration responsibilities. A local
Server assembles built contexts with normal generated Connect/gRPC services.

ServerEnvironment is the process-wide facility owner. It selects storage,
schema lookup, optional delivery and tracing facilities, and the process-local
IntegrationBroker channel factory. When not explicitly supplied, that factory
is InMemoryTransportFactory; it is shared by local brokers and closed once
during environment shutdown.

IntegrationBroker exchanges generated ExternalMessage values through typed
message channels. The message-channel SPI is intentionally limited to
publishers, subscribers, consumer handles, canonical target type URLs, and
factory lifecycle. It is separate from ordinary command/query/subscription
services.

Managed complete replicas use Coordinator membership and Gateway fan-out.
Delivery persists its work through provider-owned seams and is drained during
normal server lifecycle operations. Browser and explicit local servers use the
same generated service behavior.
