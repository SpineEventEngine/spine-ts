# Spine application server for Node.js

This package runs a Spine bounded context in Node. It assembles entities,
handlers, storage, command/event processing, query-side Projections,
subscriptions, and a local Connect/gRPC-compatible server.

## Route a schema or interface token

Use `.route(Schema, via)` for one message or `.route(Token, via)` for a named
message-interface family. Exact schema routes take priority, then the first
registered matching token, then replacement/default. The [To-Do example](../../examples/todo/USER_GUIDE.md)
uses `TaskEvent`, an assignment token, and an exact `TaskReassigned` route.

For a standalone application, use `await server.run()` to let the framework
close the server on `SIGINT` or `SIGTERM` and permanently close the environment
after the final run-managed server retires. Embedded applications use
`await server.start()` and close the returned server themselves; `start()`
never closes the shared environment. Active caller-managed and run-managed
generations are exclusive, while matching `start()` or `run()` siblings share.
Add the
`browser` option with exact allowed origins and your session, authorization,
and trusted-context collaborators to serve Connect and gRPC-Web without
application listener or CORS code.

For detailed contracts intended for coding agents, see the
[REFERENCE.md documentation for agents](REFERENCE.md).

## 💡 Why use it?

- ✅ Builds bounded contexts with Aggregates, Process Managers, and query-side
  Projections.
- ✅ Validates commands before application handlers run.
- ✅ Exposes Command, Query, and Subscription services over native gRPC.
- ✅ Optionally exposes authenticated Connect and gRPC-Web browser access.
- ✅ Manages readiness, rollback, process signals, and ordered shutdown.

## 🧭 Understand the two event paths

Each domain bounded context has an internal paired System Context. Domain events
go to the domain `EventBus` and are durably appended to the domain `EventStore`.
System events, such as committed entity-state notifications, go only to the
System Context's `EventBus`; they never enter the domain EventStore. By default
system events are forgotten after validation and notification. Call
`persistSystemEvents()` when the application needs a separate optional System
Context event store.

Enable that option while assembling the context, before `build()` or
`buildAsync()`:

```ts
import { BoundedContext } from "@spine-event-engine/server";

const context = BoundedContext.singleTenant("Tasks").persistSystemEvents().build();
await context.close();
```

`Stand` is the read side: it serves queries from current entity state. Exposed
domain-event subscriptions observe domain events on the domain `EventBus`.
Entity subscriptions observe `EntityStateChanged` on the paired System Context
`EventBus` and turn those notifications into updates. A subscription is best
effort, so clients use a query for initial state and recovery after reconnect
or a possible gap.

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

### Keep Stand subscription definitions

Stand subscription definitions use your context storage by default. One
`spine.client.SubscriptionRecord` is stored for each explicit subscription ID.
Pending definitions expire if they are not activated; reconciliation is
best-effort at a ten-second interval, so subscription updates are not complete
delivery and clients re-query after reconnects or gaps.

The storage record exposes the physical columns `status` and
`when_activation_expires`. Cleanup asks the provider for 26 pending records,
ordered by `when_activation_expires` and then ID. It deletes at most 25 expired
records and reports more work only when the observed 26th record is expired.

For an application-specific registry, provide one complete implementation.
The built context closes it.

```ts
import { BoundedContext, type StandSubscriptionRegistry } from "@spine-event-engine/server";

declare const registry: StandSubscriptionRegistry;

const context = BoundedContext.singleTenant("Tasks").withSubscriptionRegistry(registry).build();
```

`InMemorySubscriptionRegistry` is useful in local development and tests. When a
context using it is attached to a production `ServerEnvironment`, it emits one
warning naming the context because definitions disappear on restart; startup
still continues.

### Follow one definition from creation to cleanup

The registry stores a definition first, then makes it active. Applications use
the generated `SubscriptionId` throughout the lifecycle. `get()` and
`snapshot()` return cloned values, so treat them as observations rather than
mutable working objects. Their Protobuf byte arrays remain mutable, but do not
alias stored or caller bytes.

```ts
import { create } from "@bufbuild/protobuf";
import { InMemorySubscriptionRegistry } from "@spine-event-engine/server";
import { SubscriptionIdSchema, SubscriptionSchema } from "@spine-event-engine/proto/client";

const registry = new InMemorySubscriptionRegistry();
const id = create(SubscriptionIdSchema, { value: "daily-report" });
const definition = create(SubscriptionSchema, {
  id,
  topic: { id: { value: "reports.daily" } },
});

await registry.create(definition); // pending for up to 30 seconds
await registry.activate(id); // active definitions do not expire
const current = await registry.get(id); // one isolated snapshot
const all = await registry.snapshot(); // complete, identifier-sorted copies
if (current !== undefined) await registry.delete(id);
await registry.cleanup(); // removes at most 25 expired pending entries
await registry.close();

void all;
```

The built-in durable registry requires record storage with atomic
compare-and-set. Context construction fails fast when the selected storage
provider cannot supply that capability; it never silently falls back to memory.

Provider configuration for `SubscriptionRecord` applies to these definitions.
For example, a MySQL factory can assign `SubscriptionRecordSchema` to a chosen
table, and a Datastore factory can provide storage for that same schema. The
registry uses the configured provider when the context is built.

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

Use `run()` for a standalone process. It installs framework `SIGINT` and
`SIGTERM` shutdown; siblings share its generation, and a failed final close is
retryable by a later signal or `close()`. Use `start()` when another host handles
the process lifecycle; it shares only caller-managed siblings and never closes
the environment.

```ts
import { Server, type BoundedContext } from "@spine-event-engine/server";

declare const context: BoundedContext;
const running = await new Server({ contexts: [context], port: 8080 }).run();
console.log(`Spine server ready at ${running.baseUrl}`);
```

## Delivery and subscriptions

An `@Assign` command for an Aggregate or Process Manager first persists in that
Entity's Inbox. Local intake can then directly drain the persisted work in the
current request path. With an attached `ServerEnvironment`, delivery workers
replay admitted Inbox work through the same path. In shared remote delivery,
every matching node may attempt a shard, while one active lease owner performs
one bounded drain page; later drains can have a different lease owner. A page
bound does not cap all pending work: the owner may take later pages until the
delivery policy releases the shard. Events and later Process Manager commands
use the same path. See [REFERENCE.md](REFERENCE.md) for operational delivery
details.

Domain-event subscriptions observe exposed domain events on the domain
`EventBus`. Entity subscriptions observe committed `EntityStateChanged`
notifications on the paired System Context `EventBus`. Stand's default registry
uses the application's `StorageFactory`; a builder may supply another
implementation. A definition is pending for at most 30 seconds, active
definitions have no framework TTL, and cancellation physically deletes the
definition. Nodes reconcile their local listeners from a complete
snapshot every 10 seconds. Active streams and queues are process-local.

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
`DurableSubscriptionBindings`. The external backend remains under caller control.

Use `browser.backend.baseUrls` for non-empty unique origins. Unary calls use
round-robin without retry; native streams fan out best-effort, so clients
re-query authoritative state after duplicate updates or a generic loss notice.

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
  cleanup: async () => undefined,
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
    bindings,
  },
}).run();

void running;
```

In production, browser access requires `DurableSubscriptionBindings`. Startup
rejects missing or in-memory bindings before opening a listener. The registry
uses the storage factory that your application supplies and closes only the
handle, so you can use a separate factory from application-data storage or
intentionally share one. Its namespace separates applications sharing a
provider. Combined browser mode may omit bindings to use an in-memory registry;
standalone mode must always supply them explicitly.

Each durable binding stores one approved `GatewayAuthenticatedSubscription`:
its public ID, complete subscription, and expiry. The stored Topic retains the
trusted Actor and Tenant, so Activate and Cancel must match that context.

- Cancellation cleans up the backend before deleting the record; a failure
  leaves it available for retry.
- Request-time cleanup is finite; a maintenance loop may call
  `purgeExpired(nowMs)`.
- Restart rehydrates unexpired definitions. An expired definition is removed
  only after cleanup succeeds.

This is a single-Gateway persistence model. It has no multi-process
coordination, quotas, reservations, or durable fingerprints. Configure MySQL
with `setTableName(GatewayAuthenticatedSubscriptionSchema, table)` or Datastore
with `useRecordStorage(GatewayAuthenticatedSubscriptionSchema, creator)`.

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
page-size choices. `DeliverySupervisor({ source, delivery, onMessage })` receives
the separate public `DeliverySource` used to observe remote shards.
`Environment` resolves the Node deployment profile; the singleton
`ServerEnvironment` exposes the configured storage, transport, optional
delivery/tracing facilities, and their process lifecycle. They do not create a
production transport topology or durable scheduler for you.

`DeliveryMonitor` is the customizable explicit failure-policy seam. Its hooks
may return a value or a promise; a failed reception defaults to durable
`markDelivered()` and continues independent targets. Applications may instead
select one immediate `repeatDispatching()` action. The monitor adds no attempts,
quarantine, receipts, markers, timers, backoff, dead-letter storage, or
scheduler policy. Each delivery lifetime has an opaque `WorkerId`; graceful
stop waits for admitted work to settle before releasing its shard session.

The default Entity Inbox has one shard. Configure more shards through the public
builder chain:

```ts
import { BoundedContext, UniformAcrossAllShards } from "@spine-event-engine/server";

const context = BoundedContext.singleTenant("Tasks")
  .withDeliveryStrategy(UniformAcrossAllShards.forNumber(3))
  .build();
```

Aggregate commands and Process Manager commands/events
derive a target shard themselves and persist before handler replay. Local delivery
drains in the posting request; after `ServerEnvironment` supplies delivery ports,
posting persists and acknowledges while a worker replays later. Projection delivery
is separate.

An openable `ServerEnvironmentDelivery` is opened before the first environment
attachment is admitted, then supplies its inbox and work-registry ports to both
the existing finite and supervisor delivery paths; a close-only local delivery
remains supported. The environment stops attachments before closing delivery,
transport, tracing, and storage in that order. Use `RemoteDelivery` from
`@spine-event-engine/delivery-client` when an application selects a remote
delivery endpoint with direct authoritative removal.

Shard ownership excludes concurrent delivery within a shard. Pending and
delivered Inbox rows are stored directly, and delivered rows are the
deduplication fact. Handler effects and the delivered-row compare-and-set are
not transactional: a lost acknowledgement can redeliver after restart, so
downstream handling must be idempotent.

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

## Cross-context external events

Every built `BoundedContext` owns one private integration broker. It publishes
domestic events only when another context has requested them, and an imported
event is delivered only to handlers declared with `External<T>`. The marker is
type-only and transparent at runtime:

```ts
// docs-snippet-path: examples/todo/src/index.ts
import { Subscribe, type External } from "@spine-event-engine/server";
import type { TaskCreated } from "../generated/spine/examples/todo/task_events_pb.js";

class TaskProjection {
  @Subscribe
  onImported(event: External<TaskCreated>): void {
    void event;
  }
}
```

`External<T>` must be the direct first receptor parameter. External commands
are invalid; external events, rejections, and supported state subscriptions
are valid. A context publishes only the event types requested by interested
contexts. This requested-only export, plus domestic/external filtering, is the
loop-prevention rule: there is no hop counter, broker Inbox, retry, replay,
deduplication, or producer election. Delivery is best effort; many consumers
may observe one domain producer at a time.

The broker uses `TransportFactory` message channels, not `SignalTransport`.
Local and test contexts use `InMemoryTransportFactory`. Production
`ServerEnvironment` resolution requires `storageFactory`, `transport`,
`transportFactory`, and the complete application `typeRegistry`; production
does not silently fall back to memory or to the core-only registry. See the
[transport reference](../transport/REFERENCE.md) for same-host ZeroMQ setup.

`ThirdPartyContext.singleTenant(name)` or `.multitenant(name)` creates the
public import facade. `emittedEvent(event, actor)` requires a generated event,
preserves the actor tenant policy, and uses the actor timestamp (or fills one
for a `UserId`). An unknown local event schema rejects before publication; a
valid event with no current interested context is a successful no-op. Close the
hidden context when imports are finished.
