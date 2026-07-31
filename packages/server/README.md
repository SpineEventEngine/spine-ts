# Spine application server for Node.js

This package runs a Spine bounded context in Node. It assembles entities,
handlers, storage, command/event processing, queries, subscriptions, and a
local Connect/gRPC-compatible server.

For a standalone application, use `await server.run()` to let the framework
close the server on `SIGINT` or `SIGTERM`. Embedded applications use
`await server.start()` and close the returned server themselves. Add the
`browser` option with exact allowed origins and your session, authorization,
and trusted-context collaborators to serve Connect and gRPC-Web without
application-owned listener or CORS code.

For detailed contracts intended for coding agents, see the
[REFERENCE.md documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Builds bounded contexts with Aggregates, Process Managers, and Projections.
- ✅ Validates commands before application handlers run.
- ✅ Exposes Command, Query, and Subscription services over native gRPC.
- ✅ Optionally exposes authenticated Connect and gRPC-Web browser access.
- ✅ Owns readiness, rollback, process signals, and ordered shutdown.

## 🧱 Build a bounded context

Start with an explicit tenant mode. Register entity classes after their Proto
model and generated handler registry are available.

```ts
// docs-snippet-path: packages/server/test/context/bounded-context.test.ts
import { BoundedContext } from "@spine-event-engine/server";

const context = await BoundedContext.singleTenant("Tasks").buildAsync();
await context.close();
```

Use `withStorageFactory()` to choose storage. Use
`withGeneratedRegistryRoot()` for framework-generated repository assembly, or
register explicitly assembled repositories with `add()`. `buildAsync()` is the
normal choice for an application that uses generated handlers.

An aggregate receives a generated command type in an `@Assign` method. The
generator discovers this method and writes the registry used by `buildAsync()`;
run `spine-proto handlers` after changing it.

```ts
// docs-snippet-path: examples/orders/src/index.ts
import { create } from "@bufbuild/protobuf";
import { Aggregate, Assign } from "@spine-event-engine/server";
import {
  CreateOrderSchema,
  type CreateOrder,
} from "../generated/spine/examples/orders/commands_pb.js";
import { OrderSchema } from "../generated/spine/examples/orders/entities_pb.js";
import {
  OrderCreatedSchema,
  type OrderCreated,
} from "../generated/spine/examples/orders/events_pb.js";

class OrderAggregate extends Aggregate<string, typeof OrderSchema> {
  @Assign createOrder(command: CreateOrder): OrderCreated {
    this.update((draft) =>
      Object.assign(draft, create(OrderSchema, { id: this.id, skuId: command.skuId })),
    );
    return create(OrderCreatedSchema, { id: this.id, skuId: command.skuId });
  }
}
```

## 🚀 Run a standalone server

`Server` exposes the supplied built contexts through the Spine command, query,
and subscription services. Its default host is local-only.

```ts
// docs-snippet-path: packages/server/src/server/server.ts
import { Server, type BoundedContext } from "@spine-event-engine/server";

declare const context: BoundedContext;
const server = new Server({ contexts: [context], port: 0 });
const running = await server.start();
console.log(running.baseUrl);
await running.close();
```

Use `run()` for a standalone process. It installs framework-owned `SIGINT` and
`SIGTERM` shutdown. Use `start()` when another host owns the process lifecycle.

```ts
import { Server, type BoundedContext } from "@spine-event-engine/server";

declare const context: BoundedContext;
const running = await new Server({ contexts: [context], port: 8080 }).run();
console.log(`Spine server ready at ${running.baseUrl}`);
```

### Serve browser clients

Add `browser` configuration to expose Connect and gRPC-Web without writing a
listener, router, CORS middleware, or shutdown coordinator. The application
still supplies its session resolver, authorization policy, and trusted actor
context resolver.

```ts
import { Server, type BoundedContext } from "@spine-event-engine/server";

declare const context: BoundedContext;
declare const sessions: import("@spine-event-engine/auth").SessionResolver;
declare const authorize: import("@spine-event-engine/auth").AuthorizationPolicy["authorize"];
declare const contextResolver: import("@spine-event-engine/auth").ContextResolver;
declare const clock: import("@spine-event-engine/auth").Clock;

const running = await new Server({
  contexts: [context],
  port: 8090,
  browser: {
    origins: ["http://127.0.0.1:5173"],
    sessions,
    authorize,
    contexts: contextResolver,
    clock,
    fingerprint: (principal) => principal.id,
  },
}).run();

void running;
```

The server validates commands before handler code runs. Invalid payloads are
returned as `COMMAND_VALIDATION_ERROR`; invalid state transitions are returned
as `COMMAND_STATE_TRANSITION_VALIDATION_FAILED`. Domain rejections roll back
the entity change and are posted independently as typed rejection events.

## 🔎 Read state and updates

`context.stand()` provides framework-managed current entity state reads and
in-process update subscriptions. `SpineServices` translates the standard query
and subscription service requests for registered state routes.

```ts
// docs-snippet-path: packages/server/test/context/bounded-context.test.ts
import type { BoundedContext } from "@spine-event-engine/server";

declare const context: BoundedContext;
const stand = context.stand();
void stand;
```

Subscriptions and active queues are local-process resources. A client must
re-query after reconnect; this package does not promise cluster-complete
updates, event replay for subscriptions, or exactly-once observation.

## 🌐 Delivery and environment

`DeliveryBuilder` builds a delivery from its inbox, work registry, shard, and
batch choices. `DeliverySupervisor({ source, delivery, onMessage })` receives
the separate public `DeliverySource` used to observe remote shards.
`Environment` resolves the Node deployment profile; the singleton
`ServerEnvironment` exposes the configured storage, transport, optional
delivery/tracing facilities, and their process lifecycle. They do not create a
production transport topology or durable scheduler for you.

## ⚠️ Runtime boundaries

The package is Node-only. It does not choose an identity provider, session
database, production storage, TLS setup, or durable multi-machine delivery.
Subscription updates are notices rather than complete history, so clients
re-query entity state after reconnecting.

## 🔗 Learn more

- [End-user guide](../../docs/USER_GUIDE.md)
- [Authentication](../auth/README.md)
- [Node client](../client-node/README.md)
- [Browser client](../client-web/README.md)
- [MessageBoard application](../../examples/message-board/README.md)
- [Reference for coding agents](REFERENCE.md)
