# T-0212 — Remove ZeroMQ and generic signal routing

**Status:** Verification in progress

**Baseline:** `origin/main@bc65f784856db4040b28f0b0b7ce2c163adc601e`

## Classification

High-risk deletion across runtime, package, dependency, public API, tests, and
documentation. The replacement Coordinator, Gateway subscription fan-out,
direct Delivery observation, and process-local IntegrationBroker paths already
have real acceptance from T-0211 and earlier tasks.

## Accepted outcome

- Remove ZeroMQ source, exports, package dependency, workspace build approval,
  tests, fixtures, docs, and release assumptions.
- Remove the generic `SignalTransport` API, routing topics/descriptors/plans,
  `RuntimeTransportBinding`, `ContextTransport`, `ContextTransportGroup`, and
  their Server/ServerEnvironment lifecycle wiring.
- Remove the Todo parent-bypasses-gRPC fixture and the Wave 13 cross-process
  ZeroMQ IntegrationBroker fixture.
- Preserve the JVM-aligned IntegrationBroker `TransportFactory` and
  `InMemoryTransportFactory` message-channel SPI, including its schema-derived
  type URLs, process-local exchange, lifecycle, and ThirdParty behavior.
- Preserve normal gRPC Command/Query/Subscription services, Buses, browser and
  explicit local `Server`, managed replicas, Coordinator, Gateway durability,
  and direct Delivery observation.
- Introduce no replacement transport, wire contract, compatibility alias, or
  hidden fallback.

## Gates

- RED-30 fails before deletion and passes afterwards: no current runtime,
  export, package, example, or current-documentation reference to the removed
  concepts remains.
- Generated build, tooling typecheck, dependency/lock audit, public API
  inventory, cleanup/TSDoc/docs checks, and affected tests pass.
- Normal Server/Buses, browser/local use, IntegrationBroker in-memory,
  managed Coordinator/subscriptions/Delivery, and provider/example tests remain
  green.
- Changed executable line and branch coverage is at least 90%; pure deletions
  are proved by the zero-reference and retained-behavior gates.
- Relevant specialist review, isolated integration, post-merge verification,
  push, and remote cleanup complete.
