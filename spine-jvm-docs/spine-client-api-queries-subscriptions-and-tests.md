# Spine Client API, Queries, Subscriptions, and Tests

Navigation: [README](README.md) | Previous: [Routing, dispatch, and delivery](spine-routing-dispatch-and-delivery.md) | Next: [Validation, storage, observability, and support](spine-validation-storage-observability-and-support.md) | Related: [Domain model and signals](spine-domain-model-and-signals.md), [Server runtime and bounded context](spine-server-runtime-and-bounded-context.md)

This document specifies the developer-facing client/query/subscription/testing surface that a future TypeScript/Node.js Spine SDK should provide. Source truth is Spine `core-jvm` version `2.0.0-SNAPSHOT.381`, with examples used only to validate application shape.

## Source Anchors

- Wire services: `/private/tmp/spine-research/core-jvm/client/src/main/proto/spine/client/command_service.proto`, `query_service.proto`, `subscription_service.proto`.
- Query and subscription wire types: `/private/tmp/spine-research/core-jvm/client/src/main/proto/spine/client/query.proto`, `filters.proto`, `subscription.proto`.
- Client facade and request DSL: `/private/tmp/spine-research/core-jvm/client/src/main/java/io/spine/client/Client.java`, `ClientRequest.java`, `ActorRequestFactory.java`, `CommandRequest.java`, `SubscribingRequest.java`, `SubscriptionRequest.java`, `EventSubscriptionRequest.java`.
- Query/topic/filter construction: `/private/tmp/spine-research/core-jvm/client/src/main/java/io/spine/client/QueryFactory.java`, `QueryBuilder.java`, `TopicFactory.java`, `TopicBuilder.java`, `TargetBuilder.java`, `Filters.java`, `EntityQueryToProto.java`.
- Consumers and update translation: `/private/tmp/spine-research/core-jvm/client/src/main/java/io/spine/client/StateConsumer.java`, `EventConsumer.java`, `Consumers.java`, `SubscriptionObserver.java`, `Subscriptions.java`.
- Test fixtures: `/private/tmp/spine-research/core-jvm/server-testlib/src/main/java/io/spine/testing/server/blackbox/BlackBox.java`, `ContextAwareTest.java`, `SubscriptionFixture.java`, `ClientFactory.java`; `/private/tmp/spine-research/core-jvm/client-testlib/src/main/java/io/spine/testing/client/TestActorRequestFactory.java`.
- Examples: `/private/tmp/spine-research/example-server-quickstart/client/src/main/java/io/spine/tasks/client/ClientApp.java`; `/private/tmp/spine-research/example-todo-list/client/java/src/main/java/io/spine/examples/todolist/client/TodoClientImpl.java`; `/private/tmp/spine-research/example-todo-list/client/angular/src/app/task-service/task.service.ts`.

## Wire Contract

The SDK should expose three service clients over a shared transport/channel:

- `CommandService.Post(Command) -> Ack`: posts one command and returns an acknowledgement. `Ack.status` reuses the same status shape as `Response.Status`: OK, ERROR, or REJECTION. ERROR is an immediate technical failure; REJECTION is an immediate post-time business refusal. Later asynchronous business rejections are delivered as rejection events/results after an OK ack. Transport errors are separate gRPC/client errors. Source: `command_service.proto`.
- `QueryService.Read(Query) -> QueryResponse`: sends one `Query` to the read side and receives entity states with versions. Source: `query_service.proto`, `query.proto`.
- `SubscriptionService`: `Subscribe(Topic) -> Subscription`, then `Activate(Subscription) -> stream SubscriptionUpdate`, then `Cancel(Subscription) -> Response`. Creating and activating are separate protocol steps. Source: `subscription_service.proto`.

Important wire identifiers:

- `QueryId.value` is documented as `q-...`, but `QueryFactory.newQueryId()` currently formats `query-...`; a TS implementation should not parse semantics from the prefix.
- `TopicId.value` uses `t-...`; `SubscriptionId.value` uses `s-...`.
- `Target.type` is the type URL of an entity state or event message.
- `Target.criterion` is either `include_all = true` or `filters`.
- Query responses contain repeated `EntityStateWithVersion { Any state, Version version }`.
- Subscription updates contain either `entity_updates` or `event_updates`. Entity updates contain `id` plus either `state` or `no_longer_matching`.

## Client and Request Factory

The top-level client is responsible for transport lifecycle, tenant configuration, default error handlers, and request creation. `Client` supports host/port, existing channel, and in-process channels in JVM (`Client.connectTo`, `Client.usingChannel`, `Client.inProcess`). For TypeScript/Node:

- Provide `Client.connect({ host, port, transport })` and `Client.usingTransport(transport)` equivalents.
- Support `forTenant(tenantId)` on client construction for multitenant apps.
- Support default guest actor ID, currently `"guest"` in `Client.DEFAULT_GUEST_ID`.
- Expose `client.asGuest()` and `client.onBehalfOf(userId)` returning a per-actor request scope.
- Close/shutdown should cancel active subscriptions before closing transport, matching `Client.close()` and `Subscriptions.cancelAll()`.
- Provide request-scoped and client-default handlers for streaming/transport errors and server-side response errors, matching `ClientRequestBase.onStreamingError()` and `onServerError()`.

`ActorRequestFactory` is the factory for low-level request messages:

- Input: actor `UserId`, optional `TenantId`, optional `ZoneId`.
- It creates `ActorContext` with actor, timestamp, zone ID, and tenant when present.
- It creates `CommandFactory`, `QueryFactory`, and `TopicFactory`.
- It can be reconstructed from an existing `ActorContext`.

TypeScript implication: treat the actor request factory as a pure context-bearing object. It should be usable independently of network transport for tests and for constructing raw `Command`, `Query`, and `Topic` messages.

## Commands

`CommandFactory.create(commandMessage)` validates the command message, packs it into `Any`, assigns a generated `CommandId`, and attaches `CommandContext` built from the current actor context. It also supports a target entity version. Source: `CommandFactory.java`.

Developer API:

```ts
client.onBehalfOf(user)
  .command(createTask)
  .observe(TaskCreated, event => ...)
  .onStreamingError(error => ...)
  .onConsumingError((consumer, error) => ...)
  .post();

client.onBehalfOf(user)
  .command(createTask)
  .postAndForget();
```

Required behavior:

- `postAndForget()` posts only the command and must reject/throw if event observers were registered.
- `post()` requires at least one observed event type. It subscribes to expected event types before posting the command.
- Event subscriptions created by `post()` are filtered by command origin. `EventsAfterCommand` builds topics where `Event.context.past_message` equals `command.asMessageOrigin()`.
- If `CommandService.Post` returns immediate ERROR, event subscriptions created for this command are cancelled and the server error handler is called.
- If `CommandService.Post` returns immediate REJECTION, event subscriptions created for this command are also cancelled, but the immediate-rejection handler is called with the rejection event. This is distinct from a later asynchronous rejection event produced after an OK ack.
- The client does not know how many events a command should emit; returned subscriptions must be cancelled by user code or when the client closes.

Examples confirm two common styles:

- Quickstart posts a command, observes `TaskCreated`, waits, cancels subscriptions, then queries state. Source: `example-server-quickstart/.../ClientApp.java`.
- Todo client posts commands with `postAndForget()` and relies on projection subscriptions elsewhere. Source: `example-todo-list/client/java/.../TodoClientImpl.java`.

## Queries

There are two query construction paths in `core-jvm`:

- Low-level `QueryFactory` and `QueryBuilder` build proto `Query` messages.
- Higher-level `io.spine.query.EntityQuery` is transformed to proto by `EntityQueryToProto` and executed via `ClientRequest.run(EntityQuery)`.

For TypeScript, expose one coherent API while preserving wire expressiveness:

```ts
const tasks = await client.onBehalfOf(user)
  .select(TaskView)
  .byId(taskId)
  .where(eq(TaskView.Column.status, TaskStatus.OPEN))
  .withMask("id", "description", "status")
  .orderBy("description", "ASCENDING")
  .limit(20)
  .run();
```

Required query fields:

- `Query.id`: generated per request.
- `Query.target`: built from type URL and either include-all, ID filter, field filters, or both.
- `Query.context`: actor context.
- `Query.format`: optional field mask, repeated ordering clauses, optional limit.

Query builder behavior:

- Selecting only a type yields `Target.include_all = true`.
- `byId(...)` sets `Target.filters.id_filter`. Empty ID iterable means no ID criterion in builder-style APIs; `QueryFactory.byIdsWithMask()` rejects an empty ID set.
- `where(filter...)` with simple filters combines them into one `CompositeFilter` with `ALL`.
- `where(composite...)` keeps composite groups; groups are effectively ANDed by server-side matching.
- `withMask(...)` builds a protobuf `FieldMask`.
- `orderBy(column, direction)` accepts only `ASCENDING` or `DESCENDING`.
- `limit(n)` requires `n > 0` and requires an order clause when building.
- `ResponseFormat.order_by` is repeated in proto, but `QueryBuilder` stores only one ordering directive. `EntityQueryToProto` loops over sort clauses but calls `builder.orderBy(...)`, which overwrites previous calls, so current high-level behavior appears to preserve only the last sort directive.

Response handling:

- `QueryResponseMixin.states(type)` unpacks each `Any` into typed entity states.
- `QueryResponseMixin.versions()` returns entity versions aligned by result index.
- A TS SDK should offer both `run(): Promise<S[]>` for ergonomic use and `readRaw(query): Promise<QueryResponse>` for callers needing versions/status.

## Targets, Filters, Columns, and Ordering

Wire filter model is in `filters.proto`:

- `Filter.field_path`: `base.FieldPath`.
- `Filter.value`: packed `Any`.
- `Filter.operator`: `EQUAL`, `GREATER_THAN`, `LESS_THAN`, `GREATER_OR_EQUAL`, `LESS_OR_EQUAL`.
- `CompositeFilter.operator`: `ALL` or `EITHER`, with nested composite filters allowed by proto.
- `IdFilter.id`: repeated packed IDs.

Entity queries are column-based:

- For entity state targets, filter fields must be top-level fields marked with the `(column)` proto option. `FilteringField.checkFieldOfEntityState()` rejects nested columns and non-column fields.
- Lifecycle pseudo-columns exist for `archived`, `deleted`, and `version`: `ArchivedColumn`, `DeletedColumn`, `VersionColumn`.
- Deprecated `QueryFilter` targets `EntityColumn`; 2.0 guidance points users toward `io.spine.query.EntityQuery`.

Event subscriptions are field-based:

- Event filters may target event message fields or event context fields.
- Context filters are encoded with the `context.` prefix, built by `Filters.createContextFilter()`.
- `FilteringField.checkFieldOfEvent()` validates either event message field presence or `EventContext` field presence.

Filter helper API to expose:

- `eq`, `gt`, `lt`, `ge`, `le`.
- `all(first, ...rest)` for conjunction.
- `either(first, ...rest)` for disjunction.
- Typed wrappers for entity-state filters and event filters when generated field metadata is available.

Ordering comparison support:

- Equality supports any packable value.
- Ordering comparisons support protobuf `Timestamp`, Spine `Version`, comparable numbers, and strings. Source: `Filters.checkSupportedOrderingComparisonType()`.

TypeScript implication: generated model metadata should include type URL, field paths, ID type, and column annotations. Aggregate columns are exposed only for aggregate state types whose visibility explicitly enables querying (`QUERY` or `FULL`); otherwise generated query helpers omit them and server-side query validation rejects their use. Without generated metadata, string field paths can work but validation will shift to server/runtime. See the [Generated/Runtime Contract](README.md#generatedruntime-contract).

## Subscriptions

A subscription topic is a query-like target plus actor context and optional field mask:

```ts
const subscription = await client.onBehalfOf(user)
  .subscribeTo(TaskView)
  .byId(taskId)
  .where(EntityStateFilter.eq(TaskView.Field.status, TaskStatus.OPEN))
  .withMask("id", "description", "status")
  .whenNoLongerMatching(TaskId, id => ...)
  .observe(state => ...)
  .post();
```

Entity-state subscriptions:

- Built by `SubscriptionRequest<S>`.
- `where(EntityStateFilter...)` and `where(CompositeEntityStateFilter...)` are typed entry points.
- `observe(consumer)` consumes unpacked entity states.
- `whenNoLongerMatching(idType, consumer)` receives IDs for entities that previously matched but no longer do. Causes include filter mismatch after change, deletion, and archival.
- `SubscriptionObserver` forwards only `EntityStateUpdate.state` to ordinary state observers; `no_longer_matching` is handled by a chained raw update observer.

Event subscriptions:

```ts
const subscription = await client.onBehalfOf(user)
  .subscribeToEvent(TaskCreated)
  .where(EventFilter.eq(EventContext.Field.pastMessage.actorContext.actor, userId))
  .observe((event, context) => ...)
  .post();
```

- Built by `EventSubscriptionRequest<E>`.
- Event observers can consume only message or message plus `EventContext`.
- Event updates deliver full `core.Event`; consumers receive unpacked message and context.

Subscription lifecycle:

- `post()` builds a `Topic`, calls `SubscriptionService.Subscribe(topic)`, activates via `Activate(subscription)`, stores the subscription in `Subscriptions`, and returns the `Subscription`.
- `Subscriptions.cancel(subscription)` asynchronously calls `Cancel`, removes the item on completion, and returns whether it was known active.
- `Client.close()` cancels all active subscriptions before channel shutdown.
- A returned `Subscription` can represent multiple server-side context subscriptions when the service uses unknown-target fallback. Client SDK activation and cancellation must preserve the opaque `SubscriptionId` and route through `SubscriptionService`; they must not infer a single owning context or synthesize per-context subscription IDs.

TypeScript API implications:

- Return a handle with `{ subscription, unsubscribe, closed }`.
- For browser-style APIs, expose observable streams such as `itemAdded`, `itemChanged`, `itemRemoved`, but keep a lower-level `updates` stream for raw `SubscriptionUpdate`.
- Preserve explicit cancellation; do not rely only on garbage collection or process exit.
- Expose separate handlers for transport stream errors and user consumer errors. User consumer errors should not prevent delivery to remaining consumers, matching `Consumers.DeliveringObserver`.

## Testing Surface

The black-box test library treats a bounded context as a system under test and drives it through commands/events while asserting emitted consequences. Source: `BlackBox.java`.

Core fixture creation:

- `BlackBox.from(BoundedContext)` or `BlackBox.from(BoundedContextBuilder)`.
- `BlackBox.singleTenantWith(...)`, `BlackBox.singleTenant(name, ...)`, `BlackBox.multiTenantWith(...)`.
- Components can be repositories or entity classes; more complex setup uses `BoundedContextBuilder`.
- `ContextAwareTest` creates a fresh `BlackBox` before each test and closes it after each test.

Actor and tenancy:

- Default actor is `BlackBox.class.getName()`.
- `withActor(userId)` changes actor for subsequent requests.
- `in(zoneId)` changes actor time zone.
- `withTenant(tenantId)` is required before receive/assert calls in multi-tenant black boxes; single-tenant boxes reject it.
- `TestActorRequestFactory` exposes convenient constructors, command creation with fixed timestamp, and command context creation.

Driving the context:

- `receivesCommand(commandMessage)` and `receivesCommands(...)` post commands to the command bus.
- `receivesEvent(eventMessage)` and `receivesEvents(...)` post events to the event bus.
- `receivesEventsProducedBy(producerId, ...)` sets a producer ID for routing.
- `receivesExternalEvent(...)` posts to the integration path.
- `importsEvent(...)` and `importsEvents(...)` use the import bus.
- Posted setup commands/events are tracked and filtered out from emitted command/event assertions.

Assertions:

- `assertEntity(id, entityClass)` and `assertEntityWithState(id, stateClass)`.
- `assertState(id, stateClass)` and `assertState(id, expectedState)`, comparing expected fields.
- `assertCommands()` and `assertEvents()`.
- `assertEvent(eventClass)` asserts exactly one emitted event of that type and returns a proto assertion.
- `assertQueryResult(query)` runs `QueryService` against the context and returns a query result subject.
- `subscribeTo(topic)` returns `SubscriptionFixture`, which activates the topic and can assert event messages or entity states received.

Test clients:

- `BlackBox.clients().withMatchingTenant()` creates an in-process `Client` configured to the fixture tenant.
- `BlackBox.clients().create(tenant)` creates a tenant-specific client for multi-tenant contexts.
- `ClientFactory` starts an in-process gRPC container with command, query, and subscription services for black-box client tests.

TypeScript testing implications:

- Provide a `BlackBox`-equivalent in-memory/in-process harness once the TS server runtime exists.
- Provide a `TestActorRequestFactory` for deterministic actors, tenant IDs, zones, and timestamps.
- Provide a subscription fixture that captures raw updates and offers typed assertions over entity states and event messages.
- Ensure test harnesses separate setup signals from emitted signals so assertions focus on behavior caused by the action under test.
- If Node does not have in-process gRPC, expose an adapter over an in-memory service registry or start an ephemeral local server with automatic cleanup.

## Example Application Structure

Observed examples follow this structure:

- A domain-specific client/service wraps the generic Spine client.
- Commands are assembled from generated protobuf classes and posted through the generic command API.
- Read models/projections are fetched by `select(...).run()` or equivalent query API.
- UI services fetch initial state, subscribe to projection updates, update local observable state, and unsubscribe on destruction.
- Applications cancel command-result subscriptions after expected events and close the client/channel at shutdown.

The Angular todo example uses an older `spine-web` style with `command(cmd).onOk(...).onError(...).onImmediateRejection(...).post()`, `select(TaskView).run()`, and `subscribeTo(TaskView).post().then(({ itemAdded, itemChanged, itemRemoved, unsubscribe }) => ...)`. A modern TS SDK can preserve this ergonomic shape while mapping it to the 2.0 wire protocol.

## SDK Surface Summary

Recommended TypeScript packages/APIs:

- `Client`: connection, tenant, actor request scopes, close, subscription registry.
- `ActorRequestFactory`: raw command/query/topic factories independent of transport.
- `CommandRequest`: `observe`, `post`, `postAndForget`, error handlers.
- `QueryBuilder`: `select`, `byId`, `where`, `withMask`, `orderBy`, `limit`, `run`, `build`.
- `TopicBuilder`: `subscribeTo`, `subscribeToEvent`, `byId`, `where`, `withMask`, `observe`, `post`.
- `Filters`: `eq`, `gt`, `lt`, `ge`, `le`, `all`, `either`, plus typed field/column helpers from generated code.
- `Subscriptions`: active handle registry, `cancel`, `cancelAll`.
- `BlackBox` test kit: context setup, signal injection, emitted signal assertions, query assertions, subscription fixture, test clients.

## Open Questions and Uncertainties

- `QueryId` prefix documentation says `q-`, but implementation uses `query-`; SDKs should generate opaque IDs and avoid prefix coupling.
- Current `QueryBuilder` appears to retain only one `OrderBy`, despite proto allowing repeated ordering and comments describing multiple directives. Decide whether TS should match current behavior or implement the richer proto contract.
- Examples contain older or transitional APIs such as `select(...).run()` and `spine-web` callbacks. The 2.0 Java source has `ClientRequest.run(EntityQuery)` and low-level factories, so the TS SDK should deliberately choose its public ergonomic layer.
- The exact Node transport choice is unsettled: gRPC, Connect, HTTP/JSON bridge, or browser-compatible streaming each affects subscription APIs and cancellation semantics.
- Generated TypeScript metadata for `(column)`, type URLs, ID types, and field paths is essential for a safe fluent query API; otherwise many validations can only happen server-side.
