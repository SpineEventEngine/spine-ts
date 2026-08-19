# Transport reference

The transport package exposes the process-local message-channel SPI used by
`IntegrationBroker`: `TransportFactory`, `MessageChannel`, `Publisher`,
`Subscriber`, `ConsumerHandle`, and `InMemoryTransportFactory`.

Publishers and subscribers are keyed by a canonical generated type URL. The
in-memory factory fans each external message out to local consumers and closes
its channels idempotently.
