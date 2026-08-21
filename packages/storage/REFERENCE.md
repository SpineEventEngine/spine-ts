# @spine-event-engine/storage reference

This reference is for agents working with the Spine TS storage contract.

## Public entry point

Import public types from `@spine-event-engine/storage`. The entry point exports
`StorageFactory`, `RecordStorage`, `RecordSpec`, `RecordSpecOptions`, `RecordColumn`, `RecordQuery`,
`RecordMask`, `StorageGroup`, `ColumnTypes`, `ColumnMappings`, the exported
column-mapping contracts, `InMemoryStorageFactory`,
`InMemoryStorageBackend`, event-store types, normalized query policy/evaluator
types, and entity history interfaces.

## Provider SPI

Storage-adapter implementers import the complete provider-only contract set from
`@spine-event-engine/storage/provider`: Event Store record access, Entity
history and atomic commit contracts, query values, tenant boundaries/catalogs,
and delivery-cleanup handles. The storage root intentionally does not export
these provider seams; application code uses its root storage contracts instead.

## Record storage

`StorageFactory.createRecordStorage(context, spec, group?)` returns an
independently closeable `RecordStorage`. A single-tenant context forbids a
tenant ID. A multitenant context requires a complete generated `TenantId`.
The Bounded Context name is diagnostic only. A `RecordSpec` fixes the
source type, stored record type, identity extractor, ID schema or primitive ID
kind, and materialized columns. `sourceType` defaults to `recordType`; Entity
record specifications use the entity state type as their source type.
`RecordSpecOptions` is the public constructor-input contract for those fields.
For generated application records, Proto `(column)` declarations determine the
materialized fields. A field without that declaration remains only in the
authoritative serialized record; providers do not infer columns from every
field in the message.

`StorageGroup` is an optional external physical-family identity. It is not part
of `RecordSpec`: use it only when records with an otherwise compatible layout
must remain distinct. The in-memory provider keys physical identity by backend,
tenant boundary, source type, and either the named group or the explicit
ungrouped value. It keeps different source types and
different groups separate even when they use the same stored record type.
`idType`, `recordType`, `sourceType`, and `columns` are read-only accessors.

`RecordStorage` supports `write`, `writeAll`, `read`, `delete`, `compareAndSet`,
`index`, `query`, `queryEntries`, `queryPlan`, and `queryPlanEntries`. It clones
IDs and messages at its public boundary. `RecordQuery.ids` filters actual
storage slots, while `index()` returns logical IDs extracted from record bodies.
Its `atomicCompareAndSet` capability defaults to `false`. A provider sets it to
`true` only when `compareAndSet()` is atomic across compatible handles; code
that needs that guarantee must reject a handle that does not declare it.

## Query behavior

Record queries validate positive limits, non-negative offsets, and
continuations that match the requested sort fields. Query plans are normalized
and checked against adapter capabilities. If a provider returns more candidates
than a plan's explicit query budget, or the exported
`defaultQueryCandidateLimit` of 10,000 when it is omitted,
`QueryCandidateLimitError` is thrown before
local materialization can return a partial semantic result.
An explicit query budget must be a positive safe integer no greater
than 10,000.

An accepted query budget is distinct from the one-row raw-provider
overflow lookahead used to detect excess: the shared default accepts 10,000
records and can fetch 10,001 raw rows; a provider may declare a lower accepted
ceiling, such as Datastore's 1,000 accepted / 1,001 raw rows.

`StorageQueryPolicy` validates normalized plans and
`StorageQueryEvaluator` applies the portable query semantics. Provider packages
can push down supported ID, declared-column, and sort parts of a plan, but must
preserve these semantics and enforce their documented bounds. `RecordQuery<I>`
statically types IDs only; filter and sort names are strings and filter values
are `unknown`. Each provider documents the runtime mapping and validation it
applies before using those inputs; callers cannot infer shared filter or sort
name validation from the common query shape.

The normalized-plan matrix is intentionally provider-specific. MySQL admits
IDs; equality and the five comparisons on mapped orderable columns; nested
`all` and `either`; declared-column ordering; positive limits; and masks.
Datastore admits only IDs, equality, one provider-legal inequality column, flat
`all`, compatible ordering, limits, and masks. Both reject unsupported shapes
before provider access. Normalized plans never include offset: the existing
`RecordQuery.offset` path is separate. MySQL executes every admitted predicate,
order, and finite bound in contained parameterized SQL; Datastore executes only
that stated overlap. See each provider reference for mappings and index needs.

## Lifecycle

The base `StorageFactory.close()` prevents later record-storage creation. The
in-memory factory follows that behavior and leaves existing record handles open
until each handle closes. `RecordStorage.close()` rejects that handle's later
operations. Datastore follows the base factory behavior. Adapters can define a
stronger shutdown lifecycle: the MySQL factory closes live handles while it
drains its pool. Read the [Datastore reference](../storage-datastore/REFERENCE.md)
and [MySQL reference](../storage-rdbms/REFERENCE.md) before relying on shutdown
behavior. The in-memory backend is ephemeral and process-local. Passing one
`InMemoryStorageBackend` to multiple in-memory factories deliberately shares
its scoped rows.

## Entity storage

The provider SPI supplies the framework's Entity storage
ports. Current Entity state is a generated `spine.server.entity.EntityRecord`.
Retained state history stores generated `EntityStateKey`/`EntityRecord` rows in
a `StorageGroup` named after the Entity state type. Retained diagnostic event
history stores generated `EventId`/`Event` rows in that same state-type-named
group. The framework Event Store is a separate, ungrouped `EventId`/`Event`
record family.

History ports are lazy. When a history is disabled, the in-memory provider does
not open or allocate its grouped records. Current Entity loading always uses
the current record, never retained history. Event history is diagnostic data,
not a source for rebuilding current state.

The provider SPI's Entity commit contract combines one current record with
the nonempty enabled history families and delivery events. For the in-memory
provider only, that operation stages and atomically publishes its touched
families. Its outcomes are `"committed"` and `"conflict"`; it has no receipt or
`"replayed"` outcome. Other providers define and document their atomicity
guarantees.
