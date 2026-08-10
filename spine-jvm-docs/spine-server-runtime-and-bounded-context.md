# Spine server runtime and bounded context assembly

Navigation: [README](README.md) | Previous: [Domain model and signals](spine-domain-model-and-signals.md) | Next: [Entities, repositories, and state](spine-entities-repositories-and-state.md) | Related: [Routing, dispatch, and delivery](spine-routing-dispatch-and-delivery.md)

This note specifies the server-side runtime assembly surface of Spine 2.0 for a future TypeScript/Node.js implementation. It treats the Java/Kotlin code as source truth and avoids Java-specific tutorial patterns except where they reveal required behavior.

## Source scope

Primary sources:

- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContext.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/BoundedContextBuilder.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/ContextSpec.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/Server.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/CommandService.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/QueryService.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/SubscriptionService.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/ServerEnvironment.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/storage/StorageFactory.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/integration/IntegrationBroker.java`
- `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/system/server/SystemContext.java`
- `/private/tmp/spine-research/core-jvm/core/src/main/java/io/spine/core/BoundedContextNameMixin.java`
- `/private/tmp/spine-research/core-jvm/core/src/main/proto/spine/core/bounded_context.proto`
- `/private/tmp/spine-research/core-jvm/client/src/main/proto/spine/client/command_service.proto`
- `/private/tmp/spine-research/core-jvm/client/src/main/proto/spine/client/query_service.proto`
- `/private/tmp/spine-research/core-jvm/client/src/main/proto/spine/client/subscription_service.proto`

Supporting examples/tests:

- `/private/tmp/spine-research/example-server-quickstart/server/src/main/java/io/spine/tasks/server/TasksContext.java`
- `/private/tmp/spine-research/example-todo-list/server/src/main/java/io/spine/examples/todolist/server/tasks/TasksContextFactory.java`
- `/private/tmp/spine-research/core-jvm/server/src/test/java/io/spine/server/BoundedContextBuilderTest.java`
- `/private/tmp/spine-research/core-jvm/server/src/test/java/io/spine/server/ServerTest.java`
- `/private/tmp/spine-research/core-jvm/server/src/test/kotlin/io/spine/server/CommandServiceSingleTenancySpec.kt`
- `/private/tmp/spine-research/core-jvm/server/src/test/kotlin/io/spine/server/CommandServiceMultiTenancySpec.kt`

## Core concepts

A server runtime is assembled from one or more bounded contexts. A bounded context is both a domain boundary and a container for the infrastructure needed by the model inside that boundary: command bus, event bus, import bus, integration broker, read-side stand, tenant index, aggregate-root directory, repositories, and a paired system context.

`BoundedContext` is intentionally not an application extension point. The Java constructor permits only the internal `DomainContext` and `SystemContext` subclasses. Application code assembles contexts through `BoundedContext.singleTenant(name)` or `BoundedContext.multitenant(name)`, receiving a `BoundedContextBuilder`.

TypeScript implication: expose `BoundedContext` as a final runtime object, not a subclassing API. Domain customization should happen through repositories, dispatchers, filters, listeners, enrichers, routing, storage/transport factories, and context modules that return builders or built contexts.

## Context names and specs

`BoundedContextName` is a Protobuf message with a required `value` string, declared in `core/src/main/proto/spine/core/bounded_context.proto`. `BoundedContextNames.newName()` rejects null, empty, and blank names, but does not enforce uniqueness.

`ContextSpec` contains:

- `name`: `BoundedContextName`.
- `multitenant`: whether the context requires tenant isolation.
- `storeEvents`: whether the context persists its event log.

Domain specs are created as `ContextSpec.singleTenant(name)` or `ContextSpec.multitenant(name)` and always store domain events. `ContextSpec.toSystem()` derives the paired system-context name using `BoundedContextName.toSystem()`, which appends `_System` to the domain context name. `ContextSpec.notStoringEvents()` is used for system contexts when system event persistence is disabled.

TypeScript implication: define `ContextSpec` as a small immutable value object. Preserve the distinction between domain specs and system specs, and make context name validation part of construction. Uniqueness can be checked by `ServerBuilder` or a runtime registry, because Java does not enforce it at `BoundedContextNames`.

## BoundedContext builder surface

The public assembly entry points are:

- `BoundedContext.singleTenant(name)`.
- `BoundedContext.multitenant(name)`.

`BoundedContextBuilder` supports:

- `add(repository)` and `add(entityClass)` for repositories/default repositories.
- `remove(repository)` and `remove(entityClass)`.
- `addCommandDispatcher(dispatcher)` / `removeCommandDispatcher(dispatcher)`.
- `addEventDispatcher(dispatcher)` / `removeEventDispatcher(dispatcher)`.
- `addAssignee(assignee)` as command dispatcher registration.
- `addCommandFilter(filter)` and `addEventFilter(filter)`.
- `addCommandListener(listener)` and `addEventListener(listener)`.
- `enrichEventsUsing(eventEnricher)`.
- `setTenantIndex(tenantIndex)`.
- `systemSettings()`.
- `setOnBeforeClose(callback)`.
- deprecated `setAggregateRootDirectory(...)`.

When a repository is passed to command/event dispatcher registration, the builder treats it as a repository and adds/removes it through repository registration. Tests in `BoundedContextBuilderTest` confirm this diversion.

Build sequence:

1. Build a system context from `spec.toSystem()`, copying tenancy and optionally disabling system event storage according to `SystemSettings`.
2. Build the domain context with a `SystemClient` created from the system context.
3. Initialize tenant index, command bus, and stand before constructing each context.
4. Initialize the context so the event bus and integration broker are registered with the context, and command-bus observers are wired to the event bus.
5. Register repositories, command dispatchers, and event dispatchers.
6. Register environment delivery dispatchers in the context.

TypeScript implication: the builder should be reusable only with care. Java builders hold mutable registration lists and lazily initialize runtime objects during `build()`. A Node implementation should either document one-shot builders or make `build()` defensive by freezing/copying configuration before constructing runtime objects.

## Runtime parts inside a context

A built context contains:

- `CommandBus`: receives commands and routes them to command dispatchers.
- `EventBus`: receives domestic events and dispatches to event dispatchers, listeners, read side, and integration publishing.
- `ImportBus`: receives events that are explicitly imported into aggregate history.
- `IntegrationBroker`: connects this context to external events from other contexts over the configured transport.
- `Stand`: the read-side access point for queries and subscriptions.
- `TenantIndex`: tracks tenants that have data in the context.
- `VisibilityGuard`: tracks exposed/private entity state types.
- `AggregateRootDirectory`: deprecated aggregate-root lookup facility.
- `SystemClient`: domain access to the paired system context.

`BoundedContext.register(repository)` registers `ContextAware` parts with the context, registers visibility, then calls `repository.onRegistered()`. `Repository.registerWith(context)` opens storage and registers type suppliers with the stand when applicable. Repositories obtain default storage from `ServerEnvironment.instance().storageFactory()`.

Command dispatcher registration:

- Registers `ContextAware` dispatchers.
- Adds command dispatchers to the command bus if they dispatch commands.
- If the dispatcher is also an event dispatcher delegate, it is registered for events too.

Event dispatcher registration:

- Registers domestic event dispatchers with the event bus.
- Registers them with the system read side when they dispatch domestic events.
- Registers external-event dispatchers with the integration broker.
- If the dispatcher is also a command dispatcher delegate, it is registered for commands too.

TypeScript implication: model runtime registration as capability-based. A repository/dispatcher can implement several capabilities (`CommandDispatcher`, `EventDispatcher`, `ExternalEventSubscriber`, `TypeSupplier`, `ContextAware`, `Closeable`). Registration must be idempotent for the same context and reject conflicting context assignment.

## Server assembly and exposed services

`Server` exposes one or more bounded contexts over gRPC. It can be built by:

- `Server.atPort(port)`.
- `Server.inProcess(serverName)`.

`Server.Builder` accepts:

- `add(BoundedContextBuilder)`: adds a context builder; contexts are built lazily when the server builds its service container.
- `include(BindableService)`: adds extra gRPC services alongside Spine services.

Every built server includes:

- `CommandService`
- `QueryService`
- `SubscriptionService`

The generated service contracts are:

- `spine.client.CommandService/Post(core.Command) returns (core.Ack)`.
- `spine.client.QueryService/Read(Query) returns (QueryResponse)`.
- `spine.client.SubscriptionService/Subscribe(Topic) returns (Subscription)`.
- `spine.client.SubscriptionService/Activate(Subscription) returns (stream SubscriptionUpdate)`.
- `spine.client.SubscriptionService/Cancel(Subscription) returns (core.Response)`.

Service routing uses `TypeDictionary`, a map from Protobuf type URL to owning context. Each service builder collects type URLs from the contexts it serves:

- `CommandService`: command classes registered in each context's command bus.
- `QueryService`: state types exposed by each context's stand.
- `SubscriptionService`: exposed state types plus exposed event types from each stand.

`ServiceDelegate` rejects requests whose enclosed message type is internal/unpublished, then finds the owning bounded context by type URL.

TypeScript implication: implement service routing as an immutable type registry created at server/service build time. Avoid scanning model metadata on every request. Because Java's `TypeDictionary.Builder` overwrites duplicate type mappings silently, a TypeScript implementation should decide whether to preserve this behavior or fail fast on duplicate type ownership. See the [Generated/Runtime Contract](README.md#generatedruntime-contract) for routing metadata requirements.

## Command service behavior

`CommandService.post(command)` routes by the enclosed command message type. The selected context receives the command through `context.commandBus().post(command, observer)`.

If no context owns the command type, the service returns an `Ack` with an `UnsupportedCommandException` error. If the command encloses an internal/unpublished message type, it returns an `Ack` with an unpublished-language error rather than throwing a transport-level gRPC error.

Tenancy is enforced by the command bus path:

- In a single-tenant context, a command carrying `TenantId` returns an error ack.
- In a multi-tenant context, a command missing `TenantId` returns an error ack.

TypeScript implication: command intake should validate tenancy before dispatch. The validation result should be represented as a domain `Ack` with error status, not only as thrown exceptions, matching `command_service.proto` semantics.

## Query service behavior

`QueryService.read(query)` routes by `query.targetType()`. The selected context delegates to `context.stand().execute(query, observer)`.

If no context owns the target state type, it reports `UnknownEntityStateTypeException`. Invalid read-side requests are translated to invalid-argument errors.

TypeScript implication: query execution belongs to the read-side stand, not to repositories directly. Keep the service layer as a thin router and error translator.

## Subscription service behavior

`SubscriptionService` has separate delegates for subscription creation, activation, and cancellation.

`Subscribe(Topic)` routes by `topic.target.type`. If the target type is known, it calls `context.stand().subscribe(topic, observer)`. If no context owns the target type, Java creates the subscription in every known context, sorted by context name, logs a warning, returns a single opaque subscription id, and relies on later activation/cancellation fan-out.

`Activate(Subscription)` routes by `subscription.targetType()`. If unknown, it activates in all known contexts. It wraps the client stream observer in `ThreadSafeObserver` and forwards updates through a `SubscriptionCallback`.

`Cancel(Subscription)` routes by `subscription.targetType()`. If unknown, it checks each known context for the subscription id and cancels where found, then summarizes responses to the caller.

TypeScript implication: the subscription service needs shared subscription identity semantics across contexts for the unknown-target fallback. A client-visible `Subscription` may correspond to more than one context-side subscription, so activation and cancellation must route through `SubscriptionService` using the returned opaque id. Node stream implementations must guard concurrent writes to response streams, equivalent to `ThreadSafeObserver`.

## Multitenancy

Tenancy is a context-level attribute in `ContextSpec`. `BoundedContextBuilder.isMultitenant()` drives:

- Command bus multitenant mode.
- Stand multitenant mode.
- Tenant index selection.
- System context tenancy.
- Import bus tenant indexing.

Tenant index behavior:

- Single-tenant contexts use `TenantIndex.singleTenant()`, a constant single-tenant implementation.
- Multi-tenant contexts default to `TenantIndex.defaultMultitenant()`, backed by `DefaultTenantStorage` using the configured storage factory.
- `setTenantIndex()` can override the tenant index; in multitenant mode it must not be null.

`ImportBus.store(events)` extracts tenant id from `event.context.import_context.tenant_id` and records it in the tenant index.

TypeScript implication: make tenant mode a required constructor parameter for buses/read side/storage scoping. Avoid letting repositories infer tenancy ad hoc. A default multitenant tenant-index implementation should be storage-backed and should not require a domain context.

## Context integration

Each bounded context has an `IntegrationBroker`. The broker uses `ServerEnvironment.transportFactory()` to create subscriber and publisher hubs. Contexts communicate only when their brokers share transport.

Broker responsibilities:

- Announce that a bounded context is online.
- Exchange wanted external event configuration with other brokers.
- Register dispatchers interested in external events.
- Publish domestic events requested by other contexts.
- Receive external events from transport and propagate them into the domestic event bus.

Registration of external event dispatchers happens through `BoundedContext.registerEventDispatcher()`: dispatchers that `dispatchesExternalEvents()` are registered with the broker and trigger updated wanted-event notifications.

Important constraint from `IntegrationBroker` docs: an event type may be consumed by many contexts but produced by only one context. Event ownership can change across versions, but not while events are in flight.

TypeScript implication: integration should be transport-adapter based and configured at environment/runtime level. The event-type ownership rule should be modeled in metadata and preferably validated during server/context assembly.

## System context

Every domain context built through `BoundedContextBuilder.build()` receives an internal paired `SystemContext`. The system context monitors, audits, and debugs the domain context's entities and messages. Framework users do not access it directly; domain runtime code uses a `SystemClient`.

`SystemSettings.defaults()`:

- Disables command log.
- Does not persist system events.
- Enables parallel system-event posting in production, disables it in tests.

Configurable system settings:

- `enableCommandLog()` / `disableCommandLog()`.
- `persistEvents()` / `forgetEvents()`.
- `enableParallelPosting()` / `disableParallelPosting()`.
- `useCustomPostingExecutor(executor)` / `useDefaultPostingExecutor()`.

`SystemContext.newInstance()` installs a system event enricher backed by a command log repository, registers command-log repositories if enabled, registers tracing if `ServerEnvironment` has a tracer factory, and then initializes as a bounded context.

System event persistence is controlled by `SystemAwareStorageFactory`: if `ContextSpec.storesEvents()` is false, `createEventStore(context)` returns `EmptyEventStore`; otherwise it delegates to the configured storage factory.

TypeScript implication: implement the system context as an internal bounded context created automatically with the domain context. The public API should expose a narrow `SystemClient`/monitoring surface, not the raw system context object. Use a system-aware storage wrapper or equivalent event-store factory decision.

## Environment and storage wiring

`ServerEnvironment` is a process-wide singleton in Java. It selects runtime facilities by `EnvironmentType`:

- `StorageFactory`
- `TransportFactory`
- `Delivery`
- `TracerFactory`
- `CommandScheduler`
- Deployment type detector
- Node id

Tests default to in-memory storage and in-memory transport. Non-test environments must configure storage and transport before use or `ServerEnvironment` throws. Example applications configure environment first, then create contexts.

`StorageFactory` creates context-scoped storage for:

- record storage
- aggregate storage
- aggregate event storage
- event store
- entity record storage
- mirror migration storage

It also creates environment/shared delivery storage:

- inbox storage
- catch-up storage

Most storage construction receives `ContextSpec` for tenancy and repository policy. The current JVM MySQL and Datastore adapters do not put the Bounded Context name into physical identity: DDD state types distinguish record families, MySQL selects a database per tenant, and Datastore selects a native namespace per tenant. Delivery storage is shared across bounded contexts and receives a `multitenant` flag instead of a context spec. Tenant storage is also special: it uses a storage factory but belongs to a shared tenants area rather than one domain context.

TypeScript implication: prefer an explicit `ServerRuntime` or `ServerEnvironment` object that can be passed into builders, with a default singleton only as a convenience. Storage adapters must take `ContextSpec` on context-local stores and a multitenancy flag on shared delivery stores.

## Lifecycle and close behavior

`BoundedContext.close()`:

1. Runs `onBeforeClose(context)` if configured and the context is open.
2. Closes command bus.
3. Closes event bus.
4. Closes integration broker.
5. Closes stand.
6. Closes import bus.
7. Closes all registered repositories.
8. Removes installed probe, if present.

`DomainContext.close()` additionally closes the paired system context through `system.closeSystemContext()`.

`Repository.close()` closes the underlying storage if open, clears storage, and clears its context reference.

`Server.start()` starts the gRPC container and adds a shutdown hook. `Server.shutdown()` starts orderly transport shutdown, then closes every context, logging and continuing if a context close fails. `Server.shutdownAndWait()` forcefully shuts down the gRPC container and waits; it is marked test-visible.

`ServerEnvironment.close()` closes configured tracer, transport, and storage factories and marks the singleton closed.

TypeScript implication: all runtime parts should implement an idempotent async-capable `close()` contract. Server shutdown should close network listeners first, then contexts, then optionally the configured factories if the server created the environment. State the closing responsibility explicitly so embedding applications are not surprised by shared factory closure.

## Suggested TypeScript assembly API

The following shape preserves Spine's assembly model while fitting Node conventions:

```ts
const runtime = ServerEnvironment.forMode(mode)
  .useStorage(storageFactory)
  .useTransport(transportFactory)
  .useDelivery(delivery);

const tasks = BoundedContext.singleTenant("Tasks", { runtime })
  .add(TaskAggregate)
  .add(TaskProjectionRepository)
  .addCommandFilter(authzFilter)
  .systemSettings((settings) => settings.disableCommandLog().forgetEvents());

const server = Server.atPort(50051, { runtime }).add(tasks).include(healthService).build();

await server.start();
```

Design constraints:

- The builder should assemble runtime objects; model classes should not directly open storage before context registration.
- Service routing should be built from registered command/state/event type metadata.
- Tenancy should be validated at service/bus boundaries and carried through command/event/query contexts.
- Cross-context integration should depend on shared transport, not direct context references.
- System context creation should be automatic and internal.
- Environment defaults should be convenient for tests but explicit for production.

## Open questions and uncertainties

- Duplicate type ownership: Java's `TypeDictionary.Builder` overwrites duplicate type-url mappings. Should TypeScript preserve this permissive behavior or fail fast during server build?
- Builder reuse: Java builders are mutable and build runtime objects lazily. Should the TypeScript API make builders one-shot to avoid accidental shared state?
- Environment lifecycle: Should `Server.shutdown()` close only contexts and listeners, or also close the environment factories when the server created the environment?
- Subscription unknown-target fallback is preserved for compatibility: subscribe, activate, and cancel fan out across known contexts behind one opaque client-visible subscription id when target ownership is unknown.
