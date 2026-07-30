# Datastore orders load example

This generated-Protobuf example composes its domain with a caller-provided
`StorageFactory`: `createDatastoreOrdersContext` and
`startDatastoreOrdersServer` are provider-neutral. For Datastore-specific
composition, `startOrdersDatastoreServer` creates the Datastore adapter at the
entrypoint; domain handlers do not depend on provider types.

The fixed topology has two aggregates (`Order` and `Sku`), ten projections, and
two process managers: 14 repositories in total.

Build the workspace first:

```bash
pnpm typecheck:build
```

Run the complete three-file, 11-test example suite:

```bash
pnpm --config.verify-deps-before-run=false exec vitest run examples/datastore-orders/test/proto-module.test.ts examples/datastore-orders/test/topology.test.ts examples/datastore-orders/test/load-runner.test.ts
```

The load script accepts only 10, 100, or 1,000 independent users:

```bash
SPINE_DATASTORE_ORDERS_LOAD_USERS=10 pnpm --filter @spine-event-engine/example-datastore-orders load
SPINE_DATASTORE_ORDERS_LOAD_USERS=100 pnpm --filter @spine-event-engine/example-datastore-orders load
SPINE_DATASTORE_ORDERS_LOAD_USERS=1000 pnpm --filter @spine-event-engine/example-datastore-orders load
```

Each user has a unique command/query/subscription identity and subscription
iterator, but users do not each own an HTTP/2 session. The runner creates at
most 16 shared client sessions and executes users in waves of at most 10.

For a successful user, command acknowledgement and query visibility are timed
from immediately before command submission. Subscription delivery is timed
from the wait for that user's first subscription update. Every RPC receives the
user's `AbortController` signal. A timeout aborts that controller and clears
its timer; cleanup then aborts the user, waits at most 500 ms for
`iterator.return()`, and tolerates the expected cancellation race. After all
users settle, the outer run aborts the shared session pool. It does not issue a
subscription cancellation RPC.

The test and load script start an in-memory loopback server. They demonstrate
the example's local command/query/subscription behavior, not live Datastore
service behavior, emulator validation, a benchmark, or a saturation result.
