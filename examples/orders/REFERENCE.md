# Orders example reference

This reference records the current Orders composition and verification
contracts. The [README](README.md) gives launch commands; the
[user guide](USER_GUIDE.md) explains provisioning, results, restart, and
shutdown.

## Bootstrap and providers

`configureOrdersEnvironment({ storageFactory, tenants, membership })` opens a
`PersistentTenantIndex` in the `orders-tenant-directory` group and supplies it
with the selected `StorageFactory` to `ServerEnvironment`. Call it once before
assembling an Orders Bounded Context. `ordersTenants.northwind` and
`ordersTenants.contoso` are complete generated `TenantId` messages with stable
`value` variants. Membership and storage routing are separate. The configured
set must be distinct and match all persisted members; missing, extra, or
unmapped members fail before server startup.

`membership` selects one of three explicit policies:

| Value                | Behavior                                                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `register` (default) | Keep each configured tenant after checking existing membership. The memory runner uses this policy.                                      |
| `seed-if-empty`      | Keep configured tenants only when the directory is empty; otherwise validate the existing set. The durable load runners use this policy. |
| `existing`           | Validate the stored set without calling `keep`. The PostgreSQL restart reader uses this policy.                                          |

The provider constructors are exported from `src/index.ts`:

```typescript
import {
  configureOrdersEnvironment,
  createOrdersPostgresFactory,
  ordersTenants,
  startOrdersServer,
} from "./src/index.js";
import { withOrdersServer } from "./src/orders-launch.js";

const sharedUrl = process.env.ORDERS_SHARED_DATABASE_URL;
const northwindUrl = process.env.ORDERS_NORTHWIND_DATABASE_URL;
const contosoUrl = process.env.ORDERS_CONTOSO_DATABASE_URL;
if (!sharedUrl || !northwindUrl || !contosoUrl)
  throw new Error("Three PostgreSQL database URLs are required.");
const factory = await createOrdersPostgresFactory({
  sharedUrl,
  northwindUrl,
  contosoUrl,
});
const setup = await configureOrdersEnvironment({
  storageFactory: factory,
  tenants: [ordersTenants.northwind, ordersTenants.contoso],
  membership: "seed-if-empty",
});
await withOrdersServer(
  setup,
  () => startOrdersServer(),
  (server) => {
    // Send complete tenant identities with commands, queries, and subscriptions.
    return Promise.resolve(server.baseUrl);
  },
);
```

`createOrdersPostgresFactory()` composes three distinct provisioned database
URLs: shared facilities and directory, Northwind domain records, and Contoso
domain records. It configures the `StringValue`, `TenantId`, and `Tenant`
stringifier types used by stored identifiers. It does not create databases,
accounts, or grants. `createOrdersDatastoreFactory({ projectId })` composes the
Datastore client with the same identifier registry. Datastore selects tenant
namespaces. `DATASTORE_EMULATOR_HOST` chooses the emulator transport when set;
`ORDERS_DATASTORE_PROJECT_ID` or `DATASTORE_PROJECT_ID` supplies the CLI project
ID. `InMemoryStorageFactory` preserves the same assembly and tenant admission
behavior within one process, but neither its tenant directory nor records
survive process exit.

`startOrdersServer({ host, port })` creates the fixed Orders Bounded Context,
calls `ServerEnvironment.createStorageStructures()`, and then starts the gRPC
listener. Structure preparation is limited to supported provider tables,
indexes, or equivalent records inside existing infrastructure. A preparation
failure closes the assembled context and returns a failure before a listener
starts. The runner's `withOrdersServer()` closes the running server before
closing the tenant index and environment. If server drain rejects, storage
remains open; if startup fails before a server exists, setup closes. Failure
aggregation retains the run failure when cleanup also fails.

## Domain assemblies

`createOrdersContext()` registers two Aggregates, ten Projections, and two
Process Managers: fourteen repositories in the load topology. It and the
other Orders factories call `BoundedContext.multitenant` and consume the
configured environment. A request without a registered complete tenant
identity is rejected without a membership write.

`OrderReviewContexts.create()` returns separate Catalog and Ordering Bounded Contexts
that run in the same server process. Run the focused example from the repository root:

```bash
pnpm typecheck:build
pnpm exec vitest run examples/orders/test/cross-context.test.ts -t "copies the catalog name"
```

Catalog handles `RegisterSku` and creates a `SkuCatalog` row. Ordering handles
`CreateOrder`; `OrderReview.onOrderCreated` reads
`SkuCatalogQuery.create().byId(event.skuId).build()` through `select(query)`
under the original Event tenant. It captures the current name in `OrderReview`
and `OrderReviewed`. A missing, eventually consistent catalog row yields an
empty captured name.

`OrderCardContext.create()` is a separate programmatic Event routing example.
`OrderCreated` creates a card at the order ID. `SkuRegistered` selects saved
cards by SKU ID under the original Event tenant and updates cards whose name
changed. Both examples retain tenant identity across Bounded Context and
receiving-repository routes without changing the load topology.

`OrderSalesManager.onOrderCreated` is a state-only `@React` handler. It returns
`undefined` after persisting its counter and emits no Event. Other subscription
handlers return `void`. Generated Protobuf messages represent their domain
roles: `CreateOrder` is a Command, `OrderCreated` is an Event, `Order` is
Aggregate state, and `OrderSummary` is a query/subscription read model.

## Load and recovery

`runOrdersLoad({ baseUrl, users, tenants, visibilityTimeoutMs? })` accepts the
existing `10`, `100`, or `1000` user levels. Users are assigned round robin to
supplied tenant identities. Each user gets fresh order, command, query, and
subscription IDs. The selected tenant is carried through all three gRPC
services. The result includes per-tenant and aggregate counts for acknowledgement, query visibility, and subscription delivery,
latency percentiles, throughput, and classified failures. The existing client
bounds remain at sixteen shared HTTP/2 sessions and waves of ten users, with
the existing visibility deadline and abort behavior.

The shared runtime can recover pending durable Inbox rows after an interrupted
PostgreSQL launch once the killed process's shard lease expires. A new process
cannot take over an unexpired lease; a Command posted during that interval may
receive an error Ack while its Inbox row remains pending. After eligible pickup,
handler completion registers a committed-Event follow-up in the tracked
tenant/shard queue, and shutdown waits for that follow-up. Publication may start
before source Inbox acknowledgement completes. It is one best-effort in-process
attempt. Neither the Orders example nor this runtime adds durable Event
republishing or repairs historical Projection output from an earlier interruption.

## Verification

The ordinary workspace suite contains the memory and loopback gRPC tests under
`examples/orders/test`. Provider tests are registered in
`scripts/test-inventory.mjs` and are excluded from ordinary root/release Vitest
discovery regardless of environment variables. Run them explicitly with the
package commands after configuring their services:

```bash
pnpm --dir examples/orders run test:postgres
pnpm --dir examples/orders run test:datastore
```

The PostgreSQL test uses two separate Node processes: the second validates
stored membership with `membership: "existing"` before `keep` or reseeding and
reads distinct Northwind and Contoso values at the same order ID without an
explicit `environment.createStorageStructures()` call. It also checks changed
membership/routing and unreachable tenant storage before listener startup. The
Datastore emulator test reads distinct values at one ID in the two tenant
namespaces. The provider load commands exercise real command, query, and
subscription services for both tenants. Focused memory tests cover missing and
unknown tenants, cross-context reads, Event routing, and the fixed topology.
