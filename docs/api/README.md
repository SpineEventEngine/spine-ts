# Spine TS API

Spine TS exposes generated Protobuf messages, normal Connect/gRPC command,
query, and subscription services, and local server assembly.

Server builds bounded contexts, completes environment delivery recovery, and
opens its listener. ServerEnvironment supplies storage, a schema registry,
optional delivery and tracing facilities, and a process-local IntegrationBroker
message-channel factory. The environment owns its default
InMemoryTransportFactory and closes it once.

The transport package is the small integration message-channel SPI:
TransportFactory, MessageChannel, Publisher, Subscriber, ConsumerHandle, and
InMemoryTransportFactory. Channels use canonical generated type URLs and carry
ExternalMessage values for local integration exchange.

Managed replicas use the Coordinator and Gateway subscription fan-out. Delivery
is observed directly through its durable provider seams. These facilities use
the ordinary generated service APIs and do not add a separate public runtime
boundary.
