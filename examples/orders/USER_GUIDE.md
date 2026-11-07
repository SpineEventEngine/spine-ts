# Orders user guide

Orders runs one gRPC server with a persistent tenant directory and two
registered tenants, Northwind and Contoso. The load client sends each user's
complete tenant identity with its command, query, and subscription. It creates
an order, waits for its summary query, and receives its subscription update.
The load result counts those milestones separately for each tenant.

## Storage setup

From the repository root, install the workspace once:

```bash
pnpm install --frozen-lockfile
```

For a disposable local run:

```bash
SPINE_ORDERS_LOAD_USERS=10 pnpm --dir examples/orders run load
```

Memory storage includes the tenant directory. Closing the process removes both
membership and order data. It is useful for trying the API, not for a restart
persistence check.

For PostgreSQL, first provision **three distinct databases** and grant the
application credentials schema and data access in each. One database stores
the tenant directory and shared server facilities; Northwind and Contoso each
have a separate domain database. Supply connection URLs without putting
credentials in source files:

```bash
export ORDERS_SHARED_DATABASE_URL='postgresql://.../orders_shared'
export ORDERS_NORTHWIND_DATABASE_URL='postgresql://.../orders_northwind'
export ORDERS_CONTOSO_DATABASE_URL='postgresql://.../orders_contoso'
SPINE_ORDERS_LOAD_USERS=10 pnpm --dir examples/orders run postgres:load
```

The launch rejects missing, malformed, or duplicate database targets. It reads
existing membership and checks that the configured tenant set matches the
storage routing before it binds the listener. It also prepares structures in
all configured databases before listening, so an unreachable tenant database
fails startup. Structure preparation creates supported tables and indexes
inside provisioned databases; it does not create databases, accounts, or
permissions. The launch never resets existing databases or deletes prior
orders.

For Datastore, configure a project and application credentials, or start a
Datastore-compatible emulator. The emulator host is selected by the provider's
`DATASTORE_EMULATOR_HOST` setting:

```bash
export DATASTORE_PROJECT_ID='orders-local-project'
export DATASTORE_EMULATOR_HOST='127.0.0.1:8081'
SPINE_ORDERS_LOAD_USERS=10 pnpm --dir examples/orders run datastore:load
```

`ORDERS_DATASTORE_PROJECT_ID` can select a project specifically for this
example; otherwise the launch reads `DATASTORE_PROJECT_ID`. The Datastore
factory maps complete tenant identities to separate namespaces. Project or
emulator provisioning is separate from the example's supported storage
structure preparation.

## TypeScript launch composition

The three CLI commands use one bootstrap. This memory example shows the
assembly and closure order; a PostgreSQL or Datastore factory can replace the
memory factory:

```typescript
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { configureOrdersEnvironment, ordersTenants, startOrdersServer } from "./src/index.js";
import { runOrdersLoad } from "./src/load-runner.js";
import { withOrdersServer } from "./src/orders-launch.js";

const tenants = [ordersTenants.northwind, ordersTenants.contoso];
const setup = await configureOrdersEnvironment({
  storageFactory: new InMemoryStorageFactory(),
  tenants,
});
const result = await withOrdersServer(
  setup,
  () => startOrdersServer(),
  (server) => runOrdersLoad({ baseUrl: server.baseUrl, users: 10, tenants }),
);
console.log(result.perTenant);
```

`configureOrdersEnvironment()` explicitly supplies the persistent tenant
index and selected storage factory to the server environment. Bounded Context
factories consume that configuration. Calls to the gRPC services must carry a
complete registered `TenantId`; a request does not change membership.

## Load results

`SPINE_ORDERS_LOAD_USERS` accepts `10`, `100`, or `1000`. The default is `10`.
Users are distributed round robin across Northwind and Contoso. A successful
10-user run reports five users for each tenant and ten command
acknowledgements, ten visible queries, and ten delivered subscription updates.
`failedUsers` and each per-tenant `failedUsers` count should be zero. Latency
percentiles and throughput reflect the current machine and provider.

Every run uses fresh order, command, query, and subscription identifiers.
Repeated PostgreSQL or Datastore runs therefore retain previous data. A missing
or unknown tenant is rejected; requests never register a new tenant.

## Durable restart and provider checks

After provisioning and building, run the explicit infrastructure checks:

```bash
pnpm --dir examples/orders run test:postgres
pnpm --dir examples/orders run test:datastore
```

The PostgreSQL restart test writes the same order ID with different SKU values
in the two tenants, closes its first Node process, then opens a **new Node
process**. The second process validates stored tenant membership and reads both
stored orders with `membership: "existing"` before any `keep` or reseeding and
without an explicit `environment.createStorageStructures()` call on that read
path. Additional checks reject a changed membership/routing set and an
unreachable tenant database before a listener starts. The Datastore emulator
test stores the same order ID under both tenant namespaces and reads the
separate values.

These tests require the provider settings above; they do not run in the
ordinary workspace test suite merely because environment variables exist.
For live query and subscription behavior, the provider load commands exercise
the actual gRPC services for both tenants. The focused memory test also posts
the same complete order ID in both tenants and checks separate query and
subscription responses.

## Shutdown and recovery

The runner closes the running server first, then the tenant index and storage
environment. A failed server drain leaves storage open rather than closing a
factory beneath active work; the command exits with the failure for diagnosis.
If startup fails before a server exists, the configured index and environment
are closed. The application does not reset a database during recovery.

PostgreSQL can resume pending durable Inbox delivery after an interrupted
launch once the previous process's shard lease expires. A new process cannot
take over an unexpired lease; a Command posted during that interval may return
an error Ack even though its Inbox row remains pending. The handler commits
before the best-effort committed-Event callback is
queued. Publication can start before source Inbox acknowledgement finishes;
delivery does not wait for that callback while holding the source shard.
Shutdown waits for registered follow-ups. This is one in-process initial
publication attempt, not a durable Event republishing service. An earlier
interrupted operation may have committed state without all historical
Projection output. Draining old Inbox rows does not imply that historical
output was repaired.

For API details and the other domain demonstrations, see the
[reference](REFERENCE.md).
