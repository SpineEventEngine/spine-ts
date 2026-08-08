# Orders example reference

This reference is for coding agents and maintainers. Beginners should start
with the [Orders README](README.md).

## Structure and ownership

The fixed topology contains two Aggregates (`Order` and `Sku`), ten
Projections, and two Process Managers: fourteen repositories in total.
`createDatastoreOrdersContext` and `startDatastoreOrdersServer` accept a
`StorageFactory` and remain provider-neutral. `startOrdersDatastoreServer` is
the Datastore-specific composition entry point: its caller owns the `Datastore`
client and the function hands that same client to `DatastoreStorageFactory`.
Domain handlers must not import provider types.

Generated Protobuf and handler files are build outputs. Regenerate them through
the workspace scripts; never edit them directly.

## Load-runner behavior

The runner accepts exactly 10, 100, or 1,000 users. Each user owns a unique
command/query/subscription identity and iterator. At most 16 HTTP/2 client
sessions are shared, and users run in waves of at most 10.

Command acknowledgement and query visibility are measured from command
submission. Subscription delivery is measured from the first update wait.
Each user has an `AbortController`; timeout aborts its RPCs and clears the
timer. Cleanup waits at most 500 ms for `iterator.return()` and tolerates the
expected cancellation race. The outer run finally aborts the shared session
pool. It does not send a SubscriptionService cancellation RPC.

## Verification

```bash
pnpm --config.verify-deps-before-run=false exec vitest run \
  examples/orders/test/proto-module.test.ts \
  examples/orders/test/topology.test.ts \
  examples/orders/test/load-runner.test.ts
```

The load and test commands use an in-memory loopback server. They do not prove
Datastore emulator behavior, cloud credentials, indexes, quotas, or production
consistency.
