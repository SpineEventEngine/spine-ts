# Transport reference

The transport package exposes the process-local message-channel SPI used by
`IntegrationBroker`: `TransportFactory`, `MessageChannel`, `Publisher`,
`Subscriber`, `ConsumerHandle`, and `InMemoryTransportFactory`.

Publishers and subscribers are keyed by a canonical generated type URL. The
in-memory factory fans each external message out to local consumers and closes
its channels idempotently.

`TransportFactory.initialize()` is required before bounded-context channels are
assembled. It validates factory configuration and awaits shared resources that
can be established without a channel ID. Concurrent environment setup calls
share one attempt; close fences new work and waits for admitted initialization.
The in-memory implementation checks that the factory is open without creating
channels or consumers. Successful initialization means the factory is ready to
attempt real channel creation. It does not certify future channel existence,
permissions, or network operations; each real channel is opened and checked
when requested. A provider with no channel-independent network resource may
validate locally, but must not skip shared connection work it can perform now.
