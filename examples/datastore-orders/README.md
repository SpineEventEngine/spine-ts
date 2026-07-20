# Datastore orders load example

This generated-Protobuf test app composes its domain with a caller-provided
`StorageFactory`. The optional Datastore entrypoint creates the adapter only at
composition; handlers never depend on provider types. Its fixed runtime topology
is two aggregates (`Order`, `Sku`), two process managers, and ten projections.

Build the workspace first:

```bash
pnpm typecheck:build
```

Run one independent-user loopback scenario:

```bash
SPINE_DATASTORE_ORDERS_LOAD_USERS=10 pnpm --filter @spine-ts/example-datastore-orders load
SPINE_DATASTORE_ORDERS_LOAD_USERS=100 pnpm --filter @spine-ts/example-datastore-orders load
SPINE_DATASTORE_ORDERS_LOAD_USERS=1000 pnpm --filter @spine-ts/example-datastore-orders load
```

Each user is an independent asynchronous command/query/subscription actor with
its own subscription iterator. The runner multiplexes those actors over at most
16 HTTP/2 sessions and schedules at most 10 actors concurrently. This lets the
1,000-user scenario measure sustained application traffic rather than local
listener or one-shot queue saturation. Each actor posts an `Order` command,
waits for `OrderSummary` query visibility, consumes a correlated subscription
update, then closes its resources. JSON results report completed
command/query/subscription paths, latency percentiles, failures, and throughput.

The focused topology test runs the real gRPC path and 10-user smoke scenario:

```bash
pnpm vitest run examples/datastore-orders/test/topology.test.ts
```

This is an in-memory local test/load specimen, not Datastore emulator evidence
or a production benchmark. Sandboxes that deny `127.0.0.1` listeners need a
loopback-permitted environment for the real scenarios.
