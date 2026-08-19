# Transport

`@spine-event-engine/transport` provides process-local typed message channels
for IntegrationBroker external-message exchange.

Use `InMemoryTransportFactory` for local and test environments. The package
exports `TransportFactory`, `MessageChannel`, `Publisher`, `Subscriber`,
and `ConsumerHandle`; channels carry generated `ExternalMessage` values and
canonical target type URLs.

For lifecycle and channel semantics, see the
[REFERENCE documentation for agents](REFERENCE.md).
