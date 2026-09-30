# Orders example reference

This reference is for coding agents and maintainers. Beginners should start
with the [Orders README](README.md).

## Structure and responsibilities

The fixed topology contains two Aggregates (`Order` and `Sku`), ten
Projections, and two Process Managers: fourteen repositories in total.
`createDatastoreOrdersContext` and `startDatastoreOrdersServer` accept a
`StorageFactory` and remain provider-neutral. `startOrdersDatastoreServer` is
the Datastore-specific composition entry point: its caller supplies the `Datastore`
client and the function hands that same client to `DatastoreStorageFactory`.
Domain handlers must not import provider types.

`OrderReview` reads `SkuCatalogQuery` through its Process Manager `select(query)`
method. The generated query import supplies its columns; the read resolves the
handler tenant and can reach `Catalog` because both contexts join one Server.
The separate `OrderCardContext` demonstrates receiving-repository routing.
`SkuRegistered` searches saved `OrderCard` rows by the declared `skuId` column
and uses `OrderCard.needsSkuName()` to select cards requiring an update. Its
route reads only the receiving repository, with the Event's tenant. The focused
test covers multiple matching cards, a nonmatching card, a repeated name with
no handler update, and no matches. Cards created after a SKU registration start
with an empty name until another matching registration; `OrderReview` separately
reads the catalog when an order is reviewed. Neither example changes the fixed
fourteen-repository load topology.

`OrderSalesManager.onOrderCreated` is a state-only `@React` handler with an
explicit `undefined` return. Generated metadata has no returned Event schemas
for this method. The framework must still persist its counter and advance its
Entity version. Other subscribers retain their `void` declarations.

When this example is composed with Datastore, the provider boundary is native:
the complete tenant selects a namespace, the record family selects a kind, and
the record ID selects the key. Persisted bytes remain authoritative; only
Proto-declared `(column)` fields become queryable properties. Bounded Context
names do not add a namespace, kind, key prefix, or other physical partition.

Generated Protobuf and handler files are build outputs. Regenerate them through
the workspace scripts; never edit them directly.

## Load-runner behavior

The runner accepts exactly 10, 100, or 1,000 users. Each user has a unique
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
