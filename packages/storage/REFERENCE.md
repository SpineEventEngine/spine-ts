# @spine-event-engine/storage reference

This reference is for agents working with the Spine TS storage contract.

## Public entry point

Import public types from `@spine-event-engine/storage`. The entry point exports
`StorageFactory`, `RecordStorage`, `RecordSpec`, `RecordSpecOptions`, `RecordColumn`, `RecordQuery`,
`StorageGroup`, `ColumnTypes`, `ColumnMappings`, the exported
column-mapping contracts, `InMemoryStorageFactory`,
`InMemoryStorageBackend`, event-store types, normalized query policy/evaluator
types, and entity history interfaces.

## Provider SPI

Storage-adapter implementers import the complete provider-only contract set from
`@spine-event-engine/storage/provider`: Event Store record access, Entity
history and Entity commit contracts, query values, tenant boundaries/catalogs,
and delivery-cleanup handles. The storage root intentionally does not export
these provider seams; application code uses its root storage contracts instead.

The provider entry point also exports `AgentHistoryStorage`,
`AgentHistoryStorageFactories`, `AgentHistoryKeys`, and
`AgentHistoryConformance`. Calling `AgentHistoryStorageFactories.create()` to
open a handle fails if the supplied factory has not registered the capability.
Agent repository registration requires this capability. Opening the actual
tenant handle also checks the selected provider before accepting Agent work.
Agent history's append-only entries
retain the original conversation record or Event envelope,
ID, and occurrence time. The full, conversation, System, and domain views use
separate indexes. Conversation reads require a `ConversationId`. The complete
order is occurrence seconds and nanoseconds descending, then conversation,
System, domain, then unsigned UTF-8 record ID ascending. `AgentHistoryKeys`
derives a sortable index value from that order; it is not a record identity.

Provider reads use an optional complete ordering-key boundary and positive
count and byte limits. The byte limit counts the sum of serialized
`AgentHistoryEntry` wrapper lengths, excluding provider framing. A page reports
whether older entries remain; if the first entry exceeds the byte limit, the
read rejects. Limits never remove stored entries. Identical repeated appends
are accepted, while different content with the same category and record ID
is rejected. `AgentHistoryConformance` runs reusable view, order, paging,
scope, and retention checks for adapter implementations. The memory provider
retains entries across handles sharing a backend during the process lifetime;
it does not provide restart durability.
The PostgreSQL, MySQL, and Datastore providers store complete entries in one
tenant-scoped `agent_history` record family with native full, category, and
conversation ordering indexes. Each derives a bounded physical record ID from
the full state type, Agent key, category, and original record ID, then checks
immutable payload equality on repeated appends. Their provider references
specify physical index and payload constraints.

## Tenant catalog paging

Storage adapters implement `TenantCatalog.page({ count, signal, after? })` from
the provider entry point. `count` is a positive safe integer up to 127 and bounds
native candidates examined, including candidates filtered out as unrelated
namespaces. `signal` accepts a native `AbortSignal`; `TenantCatalogSignal`
describes the required members without requiring DOM declarations in storage
consumers. `TenantCatalogReads.require()` performs common request validation.

A `TenantCatalogPage` returns complete `boundaries`, `hasMore`, and an opaque
`after` continuation when more candidates remain. Pass that continuation to the
same catalog instance. Forged or cross-catalog continuations are rejected; the
cursor is an in-process value, not a durable domain record. An empty page can
still have more candidates. Continue until `hasMore` is false, rather than
stopping at the first empty page. Repeating a valid continuation may repeat the
page. A fresh sweep starts without a continuation.

Memory pages use an admission-time index and capture its length for that sweep;
PostgreSQL and MySQL page their configured tenant collections. Datastore pages
its bounded early-admission cache and then native namespace metadata using a
query limit and native cursor. A tenant can appear in both phases. Existing
Agent claims prevent that duplicate discovery from running the same accepted
invocation concurrently. An empty native `MORE_RESULTS_AFTER_LIMIT` tail that repeats its cursor ends
that sweep; other continuing pages must advance. Datastore limits each page wait to five
seconds and destroys its query stream on cancellation or timeout.

Catalogs check cancellation before starting work and before returning a result.
Paging is a finite traversal, not an atomic catalog snapshot: a concurrent
admission can appear in the current or next sweep. Agent recovery uses this
paged contract; the separate `all()` operation remains available for existing
callers that require the complete catalog.

## Agent execution storage

`AgentExecutionStorageFactories` opens the provider-only execution handle for an
Agent repository and tenant. `supports()` checks factory registration without
opening a tenant. It does not replace the provider checks made when admitting
work. Application code configures a storage factory; it does not claim or poll
these records directly.

The handle's `capacity` reports encoded execution, per-instance and history-record
limits plus a transaction payload limit where the provider enforces one.
`AgentExecutionSizes` measures the full internal Protobuf wrappers, including
scope and metadata. The runtime must allow for the bounded response and complete
record overhead before dispatch; a payload limit is not a history retention rule.

`admit()` stores the original signal, typed recipient and selected handlers once.
`claim()` permits one execution at a time for an Agent instance. `renew()`,
`update()`, `complete()` and `markDelivered()` check the current claim token.
Updates also compare the exact previously read record. Completion compares the
initial Entity Version and stores the Entity changes, mandatory histories, model
preferences and original outgoing signals in one provider operation. This includes
handlers that change no state or produce only a Command.

Pending queries read one pending invocation per Agent instance from an index. A page
carries its original time cutoff and the provider-observed continuation, so the
caller can continue even when another execution claims a returned invocation.
These internal pages are separate from application history pages. Eligibility
and claim expiry use Spine `Time`; original Inbox order determines which signal
runs next within an instance.

Each saved output can receive one delivery plan before transport begins. The
plan and original envelope cannot be replaced. `markDelivered()` requires that
plan and a current claim. The framework's internal EventStore retry operation
accepts an identical existing envelope; ordinary public EventStore append still
rejects duplicate IDs. Delivery retries must still visit every saved recipient.
These records do not make downstream application callbacks execute exactly once.

The memory implementation coordinates changes only within a shared in-process
backend. PostgreSQL, transactional MySQL and Datastore use native transactions.
Database query, index and payload requirements are documented in each provider's
reference. No execution-storage operation trims the Agent's history.

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
`all` and `either`; declared-column ordering; and positive limits.
Datastore admits only IDs, equality, one provider-legal inequality column, flat
`all`, compatible ordering, and limits. Both reject unsupported shapes
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
and [MySQL reference](../storage-mysql/REFERENCE.md) or [PostgreSQL reference](../storage-postgres/REFERENCE.md) before relying on shutdown
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

The provider SPI's Entity commit accepts the next current record and associated
enabled history and delivery events, without an expected previous record.
`commit()` returns `Promise<void>`: success resolves without a value and storage
errors reject. There is no Entity conflict result. This changes the published
`storage/provider` types for custom adapters; application APIs and persisted
record layouts are unchanged.

The in-memory provider prepares only the affected records before applying them
together. Saving one Entity does not copy other Entities or whole history/Event
Store collections. Automatic Entity versions, immutable-record checks and
unrelated Inbox conditional updates remain. Other providers document their
transaction and partial-write guarantees separately.
