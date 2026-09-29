# Orders — Datastore-ready Spine example

This example models ordering work with Aggregates, Process Managers, and
Projections. It runs in memory with one command and can use Google Cloud
Datastore when the application supplies that storage factory.

## 💡 What will you learn?

- ✅ How one bounded context coordinates `Order` and `Sku` Aggregates.
- ✅ How events update ten read-side Projections and two Process Managers.
- ✅ How domain code stays independent of the selected storage provider.
- ✅ How commands, queries, and subscriptions behave under a small local load.

## 🚀 Run it

From the repository root, install dependencies once:

```bash
pnpm install --frozen-lockfile
```

Run the complete in-memory example with ten simulated users:

```bash
SPINE_DATASTORE_ORDERS_LOAD_USERS=10 pnpm --dir examples/orders run load
```

The command generates and builds the required code, starts a loopback server,
runs the scenario, prints one JSON result, and closes the server.

Choose `10`, `100`, or `1000` users by changing
`SPINE_DATASTORE_ORDERS_LOAD_USERS`.

## 🧭 How it works

```mermaid
flowchart LR
  Command[CreateOrder command] --> Order[OrderAggregate]
  Order -->|OrderCreated| Views[Order and sales Projections]
  Order --> Events[(Event storage)]
  Views --> Queries[Queries and subscriptions]
```

The load runner posts `CreateOrder` through the local server. `OrderAggregate`
stores the order state and returns `OrderCreated`; the registered Projections
turn that fact into the fixed read-side topology used by the scenario.

This is the `createOrder()` handler excerpt from
[`OrderAggregate`](src/index.ts); imports and the class declaration are omitted
to focus on the handler.

```text
@Assign createOrder(command: CreateOrder): OrderCreated {
  this.update((draft) =>
    Object.assign(draft, create(OrderSchema, { id: this.id, skuId: command.skuId })),
  );
  return create(OrderCreatedSchema, { id: this.id, skuId: command.skuId });
}
```

`SkuAggregate` follows the same pattern for SKU registration. The example's
many Projections and Process Managers are deliberately a topology exercise,
not a claim that every application needs that many read models.

`OrderSalesManager` shows a reaction that changes state without producing another
signal. Its `@React` handler declares `undefined`, not `void`:

```text
@React onOrderCreated(event: OrderCreated): undefined {
  // Count this order in the Process Manager's state.
  this.update((draft) =>
    Object.assign(
      draft,
      create(OrderSalesManagerSchema, { id: this.id, updates: draft.updates + 1 }),
    ),
  );
  // State changes are saved, but there is no outgoing Event.
  return undefined;
}
```

Use `void` or `Promise<void>` for `@Subscribe` methods instead. A reaction that
sometimes produces a signal can declare its concrete type alongside
`undefined`, for example `OrderCreated | undefined`. An asynchronous reaction
wraps the same result in one `Promise`.

## Cross-context order review

The separate [two-context composition](src/cross-context.ts) keeps the load
demo's fixed topology unchanged. `Catalog` registers `SkuAggregate` and
`SkuCatalogProjection`; `Ordering` registers `OrderAggregate` and the
`OrderReview` Process Manager. Both contexts join one `Server`. When an order
is created, `OrderReview` builds `SkuCatalogQuery.create().byId(event.skuId).build()`
and reads it with `this.select(query).read()`. The generated import supplies the
catalog query and its columns automatically. The Process Manager copies the
current name into its state, and emits `OrderReviewed`.

The catalog projection is eventually consistent. The
[integration test](test/cross-context.test.ts) waits until `SkuRegistered` is
visible there before posting `CreateOrder`; if the record is missing when the
reaction runs, the review captures an empty name. An application needing a
guaranteed name should establish that prerequisite in its workflow.

Run this real command-to-event path from the repository root:

```bash
pnpm proto:generate
pnpm exec tsc -b examples/orders --pretty false
pnpm exec vitest run examples/orders/test/cross-context.test.ts --maxWorkers=1
```

The exported `OrderReviewContexts.create(storageFactory)` returns the
two contexts for adding to a single `Server`; it does not start another load
scenario or change `createDatastoreOrdersContext()`.

## Route a catalog Event by saved order cards

The separate [order-card context](src/query-routing.ts) adds a compact Projection
without changing the load topology. `OrderCreated` establishes each card at its
order ID. A later `SkuRegistered` Event names a SKU, but not the orders that use
it. Its route queries the receiving `OrderCard` repository by `skuId`, then calls
an application method on each restored card to skip names already up to date.
A card created after its SKU was registered starts with an empty name until a
later registration arrives. The separate cross-context Process Manager example
reads the catalog when it first reviews an order.

<!-- docs-snippet-path: examples/orders/src/cross-context.ts -->

```ts
import { EventRouting } from "@spine-event-engine/server";
import {
  OrderCreatedSchema,
  SkuRegisteredSchema,
} from "../generated/spine/examples/orders/events_pb.js";
import { OrderCardQuery } from "../generated/spine/examples/orders/order_cards_query.js";
import { OrderCard } from "./query-routing.js";

const routes = EventRouting.create(OrderCard)
  .route(OrderCreatedSchema, (event) => [event.id])
  .route(SkuRegisteredSchema, async (event, _context, repository) => {
    // The generated import supplies columns; the route supplies no tenant manually.
    const query = OrderCardQuery.create().skuId().is(event.id).build();
    const cards = await repository.find(query);
    // find() restores application Entities, including needsSkuName().
    return cards.filter((card) => card.needsSkuName(event.displayName)).map((card) => card.id);
  });
void routes;
```

`repository.findIds(query)` returns IDs, `findStates(query)` returns complete
generated state messages, and `find(query)` returns normal application Entities
with their configured dependencies and methods. Filters select records, not
fields; incoming wire field masks are ignored. The route searches only its
receiving repository under the Event's tenant. By contrast, `OrderReview` can
read the catalog in another context registered with the same `Server`, retaining
the Event tenant and checking target visibility. These are different scopes.

The route reads saved state when it executes. Finding cards neither runs their
handlers nor saves changes, and delivery after the read is not atomic with it.
Inbox replay uses recorded recipients instead of querying again. Command routes
must select exactly one recipient; Event and state routes may select several.
More than 1,000 final distinct recipients cause a warning without losing any.
The [focused test](test/query-routing.test.ts) covers two matching cards, an
unrelated card, a repeated name that needs no update, and a SKU with no matching
card.

`Server.atPort()` returns a builder. Start it after adding both contexts, then
close the running server when the application stops:

<!-- docs-snippet-path: examples/orders/test/cross-context.test.ts -->

```ts
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { Server } from "@spine-event-engine/server";
import { OrderReviewContexts } from "../src/cross-context.js";

// Use in-memory storage for this local example.
const { catalog, orders } = await OrderReviewContexts.create(new InMemoryStorageFactory());
// Register both contexts with the same server builder to enable the catalog read.
const running = await Server.atPort(0).add(catalog).add(orders).start();
// Close the running server during application shutdown.
await running.close();
```

## 🗄️ Try the same model with durable storage

The local scenario deliberately uses memory. Its application assembly accepts
the common `StorageFactory`, so a deployment can provide the Datastore factory
without teaching `OrderAggregate` or its Projections about provider APIs. Start
by declaring `(column)` only for the Order fields that the application will
filter or sort, then deploy the matching Datastore indexes before serving those
queries. The [Datastore guide](../../packages/storage-datastore/README.md)
shows the native namespace, kind, key, bytes, and declared-property layout.

## 🧪 Run the example tests

```bash
pnpm --config.verify-deps-before-run=false exec vitest run \
  examples/orders/test/proto-module.test.ts \
  examples/orders/test/topology.test.ts \
  examples/orders/test/load-runner.test.ts
```

## ⚠️ What this example does not prove

The command uses in-memory storage. It is a learning and load-checking example,
not a production benchmark or a live Datastore test. Cloud credentials,
indexes, quotas, and deployment belong to the application using the Datastore
adapter.

## 🔗 Learn more

- [Datastore storage](../../packages/storage-datastore/README.md)
- [Storage query contract](../../packages/storage/README.md)
- [Server](../../packages/server/README.md)
- [Reference for coding agents](REFERENCE.md)
