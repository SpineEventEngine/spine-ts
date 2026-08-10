# Spine Entity, Repository, and State Model

Navigation: [README](README.md) | Previous: [Server runtime and bounded context](spine-server-runtime-and-bounded-context.md) | Next: [Routing, dispatch, and delivery](spine-routing-dispatch-and-delivery.md) | Related: [Domain model and signals](spine-domain-model-and-signals.md), [Validation and support](spine-validation-storage-observability-and-support.md)

This document describes the developer-facing entity and repository model in Spine 2.0.x, based on the JVM implementation. It is a functional specification for a future TypeScript/Node.js implementation, not a Java API guide.

## Source Map

Primary sources:

- Entity base types: `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Entity.java`, `AbstractEntity.java`, `TransactionalEntity.java`, `Transaction.java`, `WithLifecycle.java`.
- Entity records and lifecycle proto: `/private/tmp/spine-research/core-jvm/server/src/main/proto/spine/server/entity/entity.proto`.
- State marker interfaces: `/private/tmp/spine-research/base/base/src/main/kotlin/io/spine/base/EntityState.kt`.
- Entity options and columns: `/private/tmp/spine-research/base/base/src/main/proto/spine/options.proto`, `/private/tmp/spine-research/base/base/src/main/java/io/spine/query/EntityColumn.java`.
- Repositories and storage: `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/entity/Repository.java`, `RecordBasedRepository.java`, `DefaultRecordBasedRepository.java`, `QueryableRepository.java`, `RepositoryCache.java`, `storage/EntityRecordStorage.java`.
- Aggregate model: `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/aggregate/Aggregate.java`, `AggregateRepository.java`, `AggregateStorage.java`, `AggregateEventStorage.java`, `UncommittedHistory.java`, `ReadOperation.java`; proto in `/private/tmp/spine-research/core-jvm/server/src/main/proto/spine/server/aggregate/aggregate.proto`.
- Projection model: `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/projection/Projection.java`, `ProjectionRepository.java`, `ProjectionTransaction.java`.
- Process manager model: `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/procman/ProcessManager.java`, `ProcessManagerRepository.java`, `PmTransaction.java`.
- Default repository factory: `/private/tmp/spine-research/core-jvm/server/src/main/java/io/spine/server/DefaultRepository.java`.
- Client/read model query protos and builders: `/private/tmp/spine-research/core-jvm/client/src/main/proto/spine/client/query.proto`, `filters.proto`, and `/private/tmp/spine-research/core-jvm/client/src/main/java/io/spine/client/QueryFactory.java`, `QueryBuilder.java`.

## Entity State

An entity state is a Protobuf message marked with the `(entity)` option. The first field of the state message is the entity ID by convention. Generated JVM state classes implement one of the state marker interfaces:

- `EntityState<I>` for generic entities.
- `AggregateState<I>` for `(entity).kind = AGGREGATE`.
- `ProjectionState<I>` / `ViewState<I>` for `(entity).kind = PROJECTION` / `VIEW`.
- `ProcessManagerState<I>` for `(entity).kind = PROCESS_MANAGER`.

Sources: `EntityState.kt`; `options.proto` `EntityOption.Kind`.

The `(entity).visibility` option controls read-side exposure. Defaults differ by kind: projections default to full query/subscription visibility; aggregates, process managers, and generic entities default to no query visibility. Sources: `options.proto` `EntityOption.Visibility`; `AggregateStorage.enableStateQuerying()` usage in `AggregateRepository.configureQuerying()`.

Queryable columns are state fields marked with `(column) = true`. Spine stores column values separately from the serialized record so queries can filter/order efficiently. Projection and process manager state columns are always eligible. For TypeScript, aggregate state columns are eligible only when aggregate visibility explicitly enables querying (`QUERY` or `FULL`); otherwise generated query metadata omits them and runtime query validation rejects their use. Sources: `options.proto` column option; `AggregateStorage.java`; `SpecScanner.java`; `EntityRecordColumn.java`.

### TypeScript Implications

- Generate or register metadata for each entity state: kind, visibility, ID field, state type URL, ID type, and column definitions.
- Treat the first Protobuf field as the canonical ID unless a future TS design deliberately introduces a different explicit option.
- Represent state as immutable Protobuf messages or immutable plain objects. State mutation should flow through a scoped transaction builder/draft, not through direct mutation of the entity instance.
- Generate typed query column descriptors for state fields marked `(column)`.
- See the [Generated/Runtime Contract](README.md#generatedruntime-contract) for entity, column, and validation metadata requirements.

## Entity Contract

`Entity<I, S>` exposes:

- `id()`: stable entity identifier.
- `state()`: current Protobuf state.
- `version()`: entity version.
- lifecycle flags: `archived`, `deleted`, and derived `active = !archived && !deleted`.
- `modelClass()`: runtime model metadata.
- `lifecycleFlagsChanged()`: whether lifecycle flags changed since initialization.

Sources: `Entity.java`; `WithLifecycle.java`.

`AbstractEntity` maintains common runtime state: ID, current state, version, lifecycle flags, cached string ID, default state initialization, state validation, and lifecycle checks. State is lazily initialized to the model default if accessed before storage injection. Updating state validates Protobuf constraints before applying it. Sources: `AbstractEntity.java`.

`entity.proto` defines the storage-level entity envelope:

- `EntityRecord.entity_id`: entity ID packed as `Any`.
- `EntityRecord.state`: entity state packed as `Any`.
- `EntityRecord.version`: `core.Version`.
- `EntityRecord.lifecycle_flags`: `LifecycleFlags`.
- `LifecycleFlags.archived`.
- `LifecycleFlags.deleted`.
- `EntityRecordChange.previous_value` and `new_value`.

Source: `server/src/main/proto/spine/server/entity/entity.proto`.

### Lifecycle Flags

Archived and deleted are soft lifecycle flags, not necessarily physical deletion. An entity is inactive if either flag is set. Repositories and storages use the flags for default read filtering, while direct ID reads can still retrieve inactive records.

`AbstractEntity` also has guard methods for preventing modification of archived/deleted entities (`checkNotArchived()`, `checkNotDeleted()`), but the framework does not globally enforce those guards for every handler; entity code must use them where required by the domain. Source: `AbstractEntity.java`.

Lifecycle changes generate system events through `EntityLifecycle`:

- state change: `EntityStateChanged`.
- archive: `EntityArchived`.
- delete flag set: `EntityDeleted` with `marked_as_deleted`.
- unarchive: `EntityUnarchived`.
- restore from deleted: `EntityRestored`.
- physical removal: `EntityDeleted` with `removed_from_storage`.

Sources: `EntityLifecycle.java`; `EntityLifecycleMonitor.java`.

### TypeScript Implications

- Store lifecycle flags beside entity state and version in a single logical entity record.
- Make active/inactive filtering an explicit storage/query behavior, not a UI concern.
- Emit lifecycle diagnostics/events from transaction commit diffs, not from arbitrary setter calls.
- Provide domain-facing helpers like `archive()`, `delete()`, `restore()`, or protected transaction operations, but keep the persisted contract as two booleans for JVM compatibility.

## Transactions and State Builders

`TransactionalEntity` is the base for entities whose state changes only inside a transaction. It exposes a validating state builder only while a transaction is active. Calling the builder outside a transaction fails with a type-specific message.

Sources: `TransactionalEntity.java`; `Transaction.java`.

A `Transaction`:

- captures initial state, version, and lifecycle flags.
- exposes a builder/draft initialized from current state.
- buffers state, version, and lifecycle changes.
- propagates one or more phases, rolling back on errors/rejections/unhandled exceptions.
- increments versions through operation-specific `VersionIncrement`.
- commits by validating and applying state/version/lifecycle changes to the entity.
- emits `EntityRecordChange` to a `TransactionListener`.
- releases itself after commit or rollback.

Source: `Transaction.java`.

The initial transaction builder has an ID convenience: if the entity is still at default state, and the first state field is the required ID field, the transaction initializes that field from the entity ID. Source: `Transaction.toBuilder()`.

Different entity families restrict where the builder is legal:

- Aggregate: only from event appliers. Calling `state()` inside an applier is prohibited because the transaction builder is the up-to-date value during replay/apply. Source: `Aggregate.java`.
- Projection: only from event subscriber methods. Source: `Projection.java`.
- Process manager: from command handlers, event/rejection reactors, or commanding methods. Source: `ProcessManager.java`.

### TypeScript Implications

- Model a transaction as an async-safe unit with a mutable draft and commit/rollback semantics.
- Do not expose state setters publicly. Entity handlers should receive access to a scoped draft/builder.
- In Node.js, isolate transactions per dispatched message/entity ID, preferably using explicit parameters rather than global async-local mutable state except where tenant/context propagation needs it.
- Transaction phases, not handler code, should increment versions.

## Repository Base Model

`Repository<I, E>` is the lifecycle owner for entity instances and their storage. It belongs to one `BoundedContext`, initializes storage lazily, and exposes:

- `create(id)`.
- `store(entity)`.
- `find(id)`.
- `index()`.
- `iterator(filter)`.
- runtime model metadata (`idClass`, entity class, state type URL).
- routing helpers for commands/events/state updates.
- `lifecycleOf(id)` for system lifecycle events.

Sources: `Repository.java`; `BoundedContextBuilder.add(...)`.

`RecordBasedRepository<I, E, S>` stores entities as `EntityRecord`s using `EntityRecordStorage`. It converts entity instances to/from records via `StorageConverter`. It supports:

- `find(id)`: direct storage read; includes inactive records.
- `findActive(id)`: direct read filtered by lifecycle flags.
- `findOrCreate(id)`: load by ID or create default entity.
- bulk store.
- filters/format queries over records.
- `find(EntityQuery)`.
- `findStates(EntityQuery)`.
- migrations for transactional entities, including marking archived/deleted or physically removing records.

Sources: `RecordBasedRepository.java`; `DefaultRecordBasedRepository.java`; `Migration.java`.

`DefaultRecordBasedRepository` uses reflection/model metadata to create entities and a default converter, so concrete repository subclasses usually only customize routing, storage, or dependency injection. Source: `DefaultRecordBasedRepository.java`.

`DefaultRepository.of(Class)` chooses a default repository by entity class:

- `AggregatePart` -> `DefaultAggregatePartRepository` (deprecated API).
- `Aggregate` -> `DefaultAggregateRepository`.
- `ProcessManager` -> `DefaultProcessManagerRepository`.
- `Projection` -> `DefaultProjectionRepository`.

Sources: `DefaultRepository.java`; `BoundedContextBuilder.add(Class<E>)`.

### Storage Boundary

The storage abstraction has two levels:

- `Storage<I, M>`: index, read by ID, write by ID, close/open, multitenancy flag.
- `RecordStorage<I, R>`: record columns, query, field masks, sorting/limits, bulk read/write, physical delete.

Sources: `Storage.java`; `RecordStorage.java`; `RecordSpec.java`.

`EntityRecordStorage` wraps `RecordStorage` for entity records. It always includes lifecycle and version columns, plus state columns discovered from generated state metadata. Its default query behavior is important:

- `index()` returns only active record IDs.
- `readAll()` returns only active records.
- `readAll(query)` adds `archived = false AND deleted = false` if the query has no explicit IDs and no lifecycle column predicates.
- `read(id)` and `readAll(ids)` include active and inactive records.

Source: `EntityRecordStorage.java`.

### Repository Cache

`RepositoryCache` is a per-repository, per-tenant, selected-ID cache used during batched delivery. When a batch starts for an entity ID, reads and writes for that ID are cached. When the batch ends, the cached entity is flushed once to real storage.

Sources: `RepositoryCache.java`; usage in `AggregateRepository`, `ProjectionRepository`, and `ProcessManagerRepository`.

### TypeScript Implications

- Separate repository APIs from storage adapters. Repositories handle domain dispatch, routing, lifecycle, caching, and conversion; storage handles persistence and query execution.
- Implement default active filtering at the storage/query layer so all repository read models behave consistently.
- Keep direct ID reads able to load inactive records, because command/event handlers and migrations may need to inspect or restore them.
- For Node.js, make the repository cache explicit around delivery batches, keyed by tenant + entity ID. Avoid a general unbounded identity map.

## Aggregates

An `Aggregate` is the event-sourced write-side entity. It handles commands and may react to events. Command/reaction methods produce events; event appliers update aggregate state. The aggregate state is restored by replaying produced events, optionally starting from a snapshot.

Sources: `Aggregate.java`; `AggregateRepository.java`.

Aggregate rules:

- State changes happen in `@Apply` event appliers via the transaction builder.
- Command handlers do not mutate state directly; they emit events.
- Calling `state()` inside an applier is prohibited because the builder contains pending changes.
- Every produced event type must have an applier.
- Applied new events receive sequential aggregate versions: if current version is 42 and three events are applied, they become 43, 44, 45.
- Uncommitted events are tracked until stored.

Sources: `Aggregate.java`; `AggregateTransaction.java`; `UncommittedHistory.java`.

### Aggregate Storage and History

Aggregates use `AggregateStorage`, not plain `EntityRecordStorage`, as their primary storage. It stores:

- aggregate events and snapshots in `AggregateEventStorage`.
- latest aggregate state/version/lifecycle in an internal `EntityRecordStorage` side channel.

Source: `AggregateStorage.java`.

The event/snapshot proto model:

- `Snapshot`: packed state, version, timestamp, lifecycle.
- `AggregateEventRecord`: record ID, timestamp, either event or snapshot, aggregate ID.
- `AggregateHistory`: optional snapshot plus events after that snapshot, or full events if no snapshot.
- `AggregateStateRecord`: historical proto describing latest aggregate state records, documented as an eventually consistent read-side record.

Source: `server/src/main/proto/spine/server/aggregate/aggregate.proto`.

Loading an aggregate:

1. `AggregateRepository.find(id)` loads aggregate history from storage.
2. `ReadOperation` reads history backward in batches until it finds a snapshot or reaches the beginning.
3. A new aggregate instance is created.
4. If a snapshot exists, state/version/lifecycle are restored from it.
5. Events are replayed through appliers.
6. The transaction commits.

Sources: `AggregateRepository.load()`, `restore()`, `Aggregate.replay()`, `ReadOperation.java`.

Storing an aggregate:

1. Uncommitted history segments are written.
2. Events are appended; snapshots are written when present.
3. Latest entity state record is written.
4. Uncommitted events are committed/cleared.

Sources: `AggregateRepository.doStore()`, `AggregateStorage.writeAll()`, `Aggregate.commitEvents()`.

Snapshots:

- Default trigger is 100 events.
- Repository subclasses can set a positive snapshot trigger.
- Snapshot trigger changes can make reads suboptimal until a new snapshot is produced.
- Snapshots include lifecycle flags.

Sources: `AggregateRepository.DEFAULT_SNAPSHOT_TRIGGER`, `setSnapshotTrigger()`, `Aggregate.toSnapshot()`.

Aggregate state querying:

- Latest aggregate states are persisted for all aggregates because ID/version/lifecycle are needed for efficient indexes.
- Full state is included only when aggregate visibility enables querying/subscribing.
- Querying aggregate states uses the latest-state side channel and is eventually consistent; it does not replay events on query.
- If querying is not enabled, aggregate state read methods throw.

Sources: `AggregateStorage.writeState()`, `readStates(...)`, `ensureStatesQueryable()`, `AggregateRecords.newStateRecord()`.

### TypeScript Implications

- Treat aggregate event history as the reconstruction source of truth.
- Store a latest-state record separately for indexes, lifecycle, and optional aggregate read model queries.
- Preserve snapshot semantics: snapshot = packed state + version + timestamp + lifecycle.
- Querying aggregates should read latest-state records, not instantiate/replay aggregates per query.
- Use optimistic versioning based on event versions, and ensure event append + latest-state update are atomic enough for the chosen storage.

## Aggregate Parts

`AggregatePart` is a deprecated API for splitting a large business object into parts with the same aggregate ID and separate states/repositories. It allows a part to access another part's state through an `AggregateRoot`. The source warns that this API does not provide invariant isolation and recommends using `ProcessManager` to coordinate multiple aggregates instead.

Sources: `AggregatePart.java`; `AggregatePartRepository.java`; `DefaultAggregatePartRepository.java`.

### TypeScript Implications

- Do not make aggregate parts a core recommended abstraction for a new TypeScript implementation.
- If compatibility is required, implement them as a legacy/convenience layer over aggregate repositories.
- Prefer process managers for cross-aggregate coordination.

## Projections

A `Projection` is a read-side entity built by subscribing to events and projecting them into queryable state. It is a transactional entity stored as `EntityRecord`.

Sources: `Projection.java`; `ProjectionRepository.java`.

Projection behavior:

- Event subscriber methods update projection state through the transaction builder.
- A projection may handle an event without changing state.
- Projection version increments sequentially per applied event, not from aggregate event versions.
- Projection repositories require at least one event subscription.
- Projections are created on demand when a routed event targets an ID with no stored record.
- Projection state is usually query-visible by default because projection entity visibility defaults to full.

Sources: `Projection.java`; `ProjectionTransaction.java`; `ProjectionEndpoint.java`; `ProjectionRepository.java`; `options.proto`.

Projection repositories:

- Extend `EventDispatchingRepository`, so they route events by producer ID or first message field by default.
- Can customize event routing.
- Can subscribe to entity state updates and configure state-update routing.
- Use inbox delivery and `RepositoryCache` for batched event dispatch.
- Support catch-up: rebuild selected/all projections by replaying historical events from the event store since a past timestamp.
- During catch-up, `CatchUpStarted` deletes the target projection state before replaying.

Sources: `EventDispatchingRepository.java`; `ProjectionRepository.java`; `CatchUpEndpoint.java`.

### TypeScript Implications

- Projection state should be stored directly as an entity record and queried by columns.
- Provide event-routing configuration separate from handler registration.
- Support projection rebuild/catch-up as a first-class read-side operation, but keep catch-up lifecycle distinct from normal live event handling.
- Since projection handlers may be idempotent or no-op, store only when transaction state or lifecycle flags changed.

## Process Managers

A `ProcessManager` maintains long-running process state and coordinates steps across aggregates in an eventually consistent way. It can:

- react to events and produce events.
- react to events and emit commands.
- handle commands and produce events.
- substitute/transform commands.
- query other entity states through an injected bounded context/querying client.

Sources: `ProcessManager.java`; `ProcessManagerRepository.java`.

Process manager behavior:

- State changes happen in command handlers, event/rejection reactors, or commanding methods through the transaction builder.
- Versions increment sequentially for each handled command or event.
- Repositories require at least one command handler, event reactor, rejection reactor, or commanding method.
- Event routing default is customized to first message field.
- Command routing default is first command field unless customized.
- Process managers are created on demand when a command/event routes to an ID with no stored record.
- Modified process managers are stored as `EntityRecord`s and can have query columns.

Sources: `PmTransaction.java`; `ProcessManagerRepository.java`; `PmEndpoint.java`; `PmCommandEndpoint.java`; `PmEventEndpoint.java`.

### TypeScript Implications

- Model process managers as durable state machines with command/event endpoints.
- Inject a query/read-model client into process manager execution context rather than letting process managers reach global repositories directly.
- Support command emission as an outcome of event handling and command substitution, with post-commit dispatch semantics.
- Prefer process managers over aggregate parts for coordinating multiple aggregates.

## Queries and Read Model Access

Client query protocol:

- `Query` targets an entity state type and carries filters plus response format.
- `ResponseFormat` contains field mask, ordering, and limit.
- `QueryResponse` returns `EntityStateWithVersion` items.
- `Target` can include all items or filtered items.
- Query filters support ID filters and column filters.
- For entity queries, a simple filter path must name a top-level state field marked `(column)`.

Sources: `client/src/main/proto/spine/client/query.proto`; `client/src/main/proto/spine/client/filters.proto`.

Server-side query model:

- `EntityQuery` is the typed query for entity states.
- It can transform to `RecordQuery`.
- `QueryableRepository.findStates(query)` returns unpacked states.
- `findRecords(...)` returns storage-level `EntityRecord`s.
- Field masks are applied at storage/query result time.
- Ordering and limits are part of response format.

Sources: `base/src/main/java/io/spine/query/EntityQuery.java`; `RecordQuery.java`; `RecordBasedRepository.java`; `QueryableRepository.java`.

Important active-filter rule:

- Querying by filters/all defaults to active records only.
- Querying by explicit IDs includes inactive records unless lifecycle predicates are added elsewhere.
- If a query mentions lifecycle columns (`archived` or `deleted`), storage does not add the default active filter.

Source: `EntityRecordStorage.onlyActive()`.

### TypeScript Implications

- Generate or expose typed query builders over entity state columns.
- Return state plus version from public query APIs.
- Implement field mask, order by column, and limit in storage adapters, with validation that limit requires ordering if following JVM behavior.
- Make lifecycle filtering explicit in query DSL, while keeping JVM-compatible default active filtering for broad queries.
- Support aggregate columns only for aggregate states with query visibility (`QUERY` or `FULL`); otherwise ignore them in generated query APIs and reject direct query usage at runtime.

## System Events and Diagnostics

Repositories and transaction listeners emit system events for operational observability:

- entity creation by kind.
- command target assignment.
- command/event dispatch to handler/subscriber/reactor.
- command handled/rejected.
- entity state changed.
- entity archived/deleted/unarchived/restored.
- entity removed from storage.
- invalid entity state/constraint violation.
- duplicate command/event.
- handler failure.
- routing failure.
- aggregate history corruption.
- migration applied.

Sources: `EntityLifecycle.java`; `EntityLifecycleMonitor.java`; `Repository.onRoutingFailed()`.

### TypeScript Implications

- Keep system events separate from domain events but publish them through the same observability/audit infrastructure.
- Generate lifecycle events from repository/transaction infrastructure, not from application handlers.
- Preserve message IDs that caused a state change; this is central to diagnostics and replay/debugging.

## Minimum TypeScript Architecture Sketch

A Node.js implementation should expose these conceptual building blocks:

- `Entity<I, S>`: ID, state, version, lifecycle flags, model metadata.
- `TransactionalEntity<I, S>`: entity with scoped transaction/draft access.
- `Transaction<I, E, S>`: initial record, draft, lifecycle draft, version strategy, phases, commit/rollback, listener hooks.
- `Repository<I, E>`: context registration, routing, storage, lifecycle, caching.
- `RecordBasedRepository<I, E, S>`: entity-record persistence and query conversion.
- `AggregateRepository`: event history storage, snapshots, latest-state side channel, command/event routing.
- `ProjectionRepository`: event subscription delivery, catch-up, entity-record storage.
- `ProcessManagerRepository`: command/event delivery, command posting, entity-record storage.
- `StorageFactory`: creates entity-record, aggregate-event, aggregate, event-store, inbox/catch-up storages.
- `RepositoryCache`: batch-scoped tenant + ID cache.
- `QueryService`: public entity-state query API returning state + version.

Concurrency and storage notes:

- Dispatch for the same entity ID must be serialized or protected by optimistic concurrency.
- Aggregate event append and latest-state update should be transactionally coordinated where the backend allows it.
- Projection/process-manager updates should be idempotent where possible because delivery systems can retry.
- Multitenancy must be part of storage keys, cache keys, and context propagation.

## Open Questions and Uncertainties

- The JVM implementation uses reflection and generated Java metadata (`EntityClass`, generated `Column` classes, Protobuf builders). The TS implementation needs a concrete metadata source: generated TS descriptors, decorators, explicit registration objects, or build-time codegen.
- Aggregate latest-state storage is described in code as `EntityRecordStorage`, while `aggregate.proto` also defines `AggregateStateRecord`. For TS, decide whether to keep the JVM's current `EntityRecord` side-channel representation or introduce a distinct aggregate-state record schema.
- The exact transaction atomicity requirements vary by storage backend. The spec should define required semantics for event append + state record update before implementing adapters.
- Lifecycle mutator ergonomics need design. The storage contract is clear, but the developer-facing TS API should decide whether flags are modified via protected entity methods, transaction methods, domain helper methods, or migrations only.
- Catch-up needs deeper delivery/event-store documentation before implementation details are locked.
