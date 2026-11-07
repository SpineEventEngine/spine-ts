# Orders example

Orders shows tenant isolation in a fixed event-driven domain: two Aggregates,
ten Projections, and two Process Managers. Every Orders Bounded Context uses
complete Northwind or Contoso `TenantId` messages. The runnable load scenario
posts commands and observes matching queries and subscriptions through a gRPC
server. It reports aggregate and per-tenant outcomes.

## Launch options

Install and build the workspace from the repository root:

```bash
pnpm install --frozen-lockfile
```

Choose one provider and run the example:

| Provider   | Command                                                                    | Preparation                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Memory     | `SPINE_ORDERS_LOAD_USERS=10 pnpm --dir examples/orders run load`           | None; data and membership disappear when the process exits.                                                                                   |
| PostgreSQL | `SPINE_ORDERS_LOAD_USERS=10 pnpm --dir examples/orders run postgres:load`  | Provision three separate databases and set `ORDERS_SHARED_DATABASE_URL`, `ORDERS_NORTHWIND_DATABASE_URL`, and `ORDERS_CONTOSO_DATABASE_URL`.  |
| Datastore  | `SPINE_ORDERS_LOAD_USERS=10 pnpm --dir examples/orders run datastore:load` | Configure a Datastore project with `ORDERS_DATASTORE_PROJECT_ID` or `DATASTORE_PROJECT_ID`. Set `DATASTORE_EMULATOR_HOST` to use an emulator. |

Each command builds the workspace, configures the tenant directory, starts a
loopback gRPC server, runs the load, and closes the server before storage after
a successful drain.
Supported user levels are `10`, `100`, and `1000`. A run creates fresh order
identifiers, so rerunning against durable storage does not overwrite earlier
orders. The result includes command acknowledgements, query visibility,
subscription delivery, latency percentiles, throughput, failures, and counts
for each tenant.

PostgreSQL databases, credentials, and permissions must exist before launch.
`createStorageStructures()` prepares supported tables and indexes inside those
databases; it does not create databases or users. The Datastore project or
emulator must likewise exist before launch. The [user guide](USER_GUIDE.md)
provides setup, restart, and failure handling steps.

## Cross-context order review

`OrderReviewContexts.create()` assembles separate multitenant Catalog and
Ordering Bounded Contexts in the same server process. An order reaction reads
a SKU name from Catalog under the Event tenant. Run the focused behavior test
from the repository root with:

```bash
pnpm typecheck:build
pnpm exec vitest run examples/orders/test/cross-context.test.ts -t "copies the catalog name"
```

## Order-card routing

`OrderCardContext.create()` assembles a multitenant Bounded Context that routes
Events to matching cards under the Event tenant. These are programmatic
demonstrations with focused tests; the load command runs the fixed
fourteen-repository Orders Bounded Context.

The [coding-agent reference](REFERENCE.md) lists assembly, provider, lifecycle, and test
contracts. Missing or unregistered tenant requests fail without adding
membership or writing an order.
