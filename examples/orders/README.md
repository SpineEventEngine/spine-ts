# Orders example

Orders demonstrates tenant isolation across a fixed domain topology, a two
Bounded Context order review, and order-card Event routing. The local load
command runs with in-memory storage. Its tenant directory also lives in memory,
so the command does not demonstrate restart persistence.

## Run the in-memory example

From the repository root, install and build the workspace, then run one of the
supported user counts:

```bash
pnpm install --frozen-lockfile
SPINE_ORDERS_LOAD_USERS=10 pnpm --dir examples/orders run load
```

Choose `10`, `100`, or `1000`. The command starts a loopback gRPC server,
distributes actors across Northwind and Contoso, and prints aggregate and
per-tenant command, query, and subscription outcomes. It closes the server,
tenant directory, and storage environment after the run. Each order gets a fresh
run ID, so repeated runs do not reuse order identities.

## Tenant setup and assembly

One bootstrap selects storage and registers only the tenants configured for the
run. Every Orders Bounded Context uses the resulting environment:

```typescript
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { configureOrdersEnvironment, ordersTenants, startOrdersServer } from "./src/index.js";

const setup = await configureOrdersEnvironment({
  storageFactory: new InMemoryStorageFactory(),
  tenants: [ordersTenants.northwind, ordersTenants.contoso],
});
try {
  const server = await startOrdersServer();
  try {
    // Send commands, queries, and subscriptions with a complete TenantId.
  } finally {
    await server.close();
  }
} finally {
  await setup.close();
}
```

`ordersTenants.northwind` and `ordersTenants.contoso` are complete `TenantId`
messages with stable `value` variants. The `PersistentTenantIndex` records
membership separately from storage routing. A missing or unregistered tenant
is rejected; a request never registers a tenant. The storage factory still
selects the provider. The domain handlers do not import provider types.

The main `createOrdersContext()` assembly registers two Aggregates, ten
Projections, and two Process Managers. `OrderAggregate` handles `CreateOrder`
and emits `OrderCreated`. The Projections build queryable summaries, while the
Process Managers track event reactions. The fixed topology remains fourteen
repositories.

## Catalog and Ordering

`OrderReviewContexts.create()` returns separate multitenant `Catalog` and
`Ordering` Bounded Contexts for one server. `Catalog` registers `SkuAggregate`
and `SkuCatalogProjection`. `Ordering` registers `OrderAggregate` and
`OrderReview`. When an order is created, the Process Manager reads the catalog
with `SkuCatalogQuery.create().byId(event.skuId).build()` and captures the
current SKU name in `OrderReview` and `OrderReviewed`. The handler read uses the
original Event tenant. The catalog projection is eventually consistent; if its
row is absent when the reaction runs, the captured name is empty.

## Order-card routing

`OrderCardContext.create()` assembles another multitenant Bounded Context for
a targeted routing demonstration. `OrderCreated` creates a card at the order
ID. `SkuRegistered` queries saved cards by SKU ID within the Event tenant and
updates only cards whose displayed name differs. The test covers multiple
matching cards, another SKU, repeated names, no matches, and matching IDs in
Northwind and Contoso.

## Storage providers

The bootstrap accepts any compatible `StorageFactory`. An application using
Datastore can construct `DatastoreStorageFactory` with its Datastore client and
pass it to `configureOrdersEnvironment`. Provider setup, membership, and
Bounded Context assembly remain separate steps. The local load script uses
memory storage; PostgreSQL launch and restart validation are described after
the runnable PostgreSQL slice is implemented.

For exact API paths, lifecycle notes, and focused verification, see the
[agent reference](REFERENCE.md).
