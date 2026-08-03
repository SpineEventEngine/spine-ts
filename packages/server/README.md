# Spine application server for Node.js

This package runs a Spine bounded context in Node. It assembles entities,
handlers, storage, command/event processing, query-side Projections,
subscriptions, and a local Connect/gRPC-compatible server.

For a standalone application, use `await server.run()` to let the framework
close the server on `SIGINT` or `SIGTERM` and permanently close the environment
after the final run-managed server retires. Embedded applications use
`await server.start()` and close the returned server themselves; `start()`
never closes the shared environment. Active caller-managed and run-managed
generations are exclusive, while matching `start()` or `run()` siblings share.
Add the
`browser` option with exact allowed origins and your session, authorization,
and trusted-context collaborators to serve Connect and gRPC-Web without
application-owned listener or CORS code.

For detailed contracts intended for coding agents, see the
[REFERENCE.md documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Builds bounded contexts with Aggregates, Process Managers, and query-side
  Projections.
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
const running = await server.run();
console.log(running.baseUrl);
```

Use `run()` for a standalone process. It installs framework-owned `SIGINT` and
`SIGTERM` shutdown; siblings share its generation, and a failed final close is
retryable by a later signal or `close()`. Use `start()` when another host owns
the process lifecycle; it shares only caller-managed siblings and never closes
the environment.

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

For a separately hosted TS or JVM backend, set `browser.backend.baseUrl` to its
canonical HTTP(S) origin. The gateway keeps `ResolveContext` local and forwards
the five application RPCs only after the same authentication, authorization,
and trusted-context rewrite. Every standalone mode requires explicit
subscription bindings: local development and tests may explicitly supply an
in-memory binding, while production also needs a type registry and named
`DurableSubscriptionBindings`. The external backend remains caller-owned.

Applications may add only explicit OAuth-style callbacks with `authRoutes`.
Each route uses an exact `GET`/`POST` path, per-route origins, a safe body limit,
and a finite timeout. This is not a general HTTP router; use it for bounded
identity exchanges and validate OAuth state in the application handler.
The host admits at most 64 active auth requests by default (or the configured
positive `maxActiveAuthRequests`); excess requests receive 503 before a handler
runs. A route timeout covers request intake, handler work, and response
transfer. Auth response bodies are bounded by `writeMaxBytes`; an overflow
returns 413 without copying application headers.

```ts
import {
  DurableSubscriptionBindings,
  Server,
  type BoundedContext,
} from "@spine-event-engine/server";

declare const context: BoundedContext;
declare const sessions: import("@spine-event-engine/auth").SessionResolver;
declare const authorize: import("@spine-event-engine/auth").AuthorizationPolicy["authorize"];
declare const contextResolver: import("@spine-event-engine/auth").ContextResolver;
declare const clock: import("@spine-event-engine/auth").Clock;
declare const registryStorage: import("@spine-event-engine/storage").StorageFactory;

const bindings = new DurableSubscriptionBindings({
  storageFactory: registryStorage,
  namespace: "my-app",
  nextId: () => crypto.randomUUID(),
  dispose: async () => undefined,
  leaseMs: 60_000,
  cleanupBatchSize: 100,
  recordLimit: 10_000,
  maxRecordBytes: 1_048_576,
});

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
    bindings,
  },
}).run();

void running;
```

In production, browser access needs bindings that declare the durable
capability. `DurableSubscriptionBindings` is the supplied implementation;
compatible bindings can be used by later standalone hosting as well. Startup
rejects missing or volatile bindings before opening a listener. The registry
uses the storage factory that your application supplies and closes only its own
handle, so you can use a separate factory from application-data storage or
intentionally share one. Its namespace separates applications sharing a
provider. `leaseMs` is milliseconds; `cleanupBatchSize`, `recordLimit`, and
`maxRecordBytes` are positive safe integers. Combined browser mode may omit
bindings to use an in-memory registry; standalone mode must always supply them
explicitly.

Every durable reservation has its final public ID before the backend subscribe
operation begins. Registries using the same namespace coordinate that finite
capacity, so the limit applies across gateway processes rather than to each
process separately. An activation uses a finite lease and fence. Before each
backend effect and each forwarded update, a durable binding checks that it
still owns its lease. A lost lease suppresses later effects and updates, and
the local controller is aborted when a renewal observes the loss. It cannot
later complete as owner.
Cancellation can be retried after an uncertain backend result. Expired records
are cleaned in bounded batches when requests call the registry; applications
may also call `purgeExpired(nowMs)` from their own maintenance loop. A cleaner
renews its fenced lease immediately before each disposal callback, so another
registry cannot take over while that callback is still running. This is
coordination only: it does not recover a live stream or promise replay,
exactly-once updates, ordering, or cluster-complete notifications.

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

An openable `ServerEnvironmentDelivery` is opened before the first environment
attachment is admitted, then supplies its inbox and work-registry ports to both
the existing finite and supervisor delivery paths; a close-only local delivery
remains supported. The environment stops attachments before closing delivery,
transport, tracing, and storage in that order. Use `RemoteDelivery` from
`@spine-event-engine/delivery-client` when an application selects a remote
delivery endpoint and durable removal quarantine.

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
- [Message Board application](../../examples/message-board/README.md)
- [Reference for coding agents](REFERENCE.md)
