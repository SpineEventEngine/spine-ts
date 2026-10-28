# @spine-event-engine/storage-datastore reference

This reference is for coding agents configuring the Google Cloud Datastore adapter.

## Public entry point

Import `DatastoreStorageFactory`, `DatastoreStorageFactoryBuilder`,
`RecordLayout`, `CreateRecordStorage`, `CreateEntityStorage`,
`PrepareDatastoreRecordStorage`, `PrepareDatastoreEntityStorage`,
`NamespaceConverter`, `DefaultNamespaceConverter`, `DatastoreIdColumn`,
`DatastoreColumnMapping`, and `DatastoreQueryLimitError` from
`@spine-event-engine/storage-datastore`.
Create a factory with `DatastoreStorageFactory.newBuilder().setClient(client)`.
The adapter never closes that client.

`build()` is offline. `checkConnection()` runs one read-only exact-key,
keys-only query against shared `__namespace__` metadata and remembers a
successful result. It retries failures and drains admitted checks on close.
An empty result is valid for an unused namespace. The diagnostic needs
`datastore.namespaces.get` and `datastore.namespaces.list`; it does not prove
ordinary Entity read/write permissions, deployed composite indexes, or every
query shape. The caller-supplied client remains open.

The builder is mutable until `build()` and the built factory receives a
snapshot. The last registration for the same identity wins. Record resolution
uses this precedence:

1. an exact source-plus-record creator;
2. a record-only creator;
3. an exact source-plus-record layout;
4. a record-only layout; and
5. the default kind.

`setNamespaceConverter(...)` replaces complete `TenantId`/native namespace
conversion. `setStringifierRegistry(...)` supplies reversible mappings for
message-valued IDs and ordinary message columns. The stringifier registry is
snapshotted by `build()`; a custom namespace converter is retained and must
remain behaviorally immutable for the factory lifetime. `organizeRecords(...)`
changes a kind. `useRecordStorage(...)` replaces a record-family provider.
`Identifiers` select the key representation, and the same configured
stringifier maps a message-valued ID or declared column on write, direct lookup,
filter, ordering continuation, and read. `RecordQuery<I>` statically types IDs
only. Datastore maps filter values through its record column mapping at runtime;
its sort-property mapping is the requested field name. Callers do not construct
a provider string or infer shared filter/sort-name validation.
`useEntityStorage(...)` replaces the complete coherent Entity handle, including
its commit capability. Custom providers receive the storage context, record or
Entity contract, and caller-supplied client, but not the built-in converter or
stringifier registry; they must provide equivalent tenant, ID, and column mapping.
For model preparation, the existing `StoragePreparations` provider port checks
declarative current, enabled history, and surviving Agent audit families without
opening storage handles or writing records. Native `create` and `check` establish
the same narrow kind, namespace, ID, and column compatibility plus metadata-read
facts; missing kinds are valid. Applications must deploy the required indexes,
including the three Agent audit indexes. A selected custom creator requires an
optional trailing preparation callback on `useRecordStorage(...)` or
`useEntityStorage(...)`; preparation rejects before invoking a creator when that
callback is absent. Custom callbacks receive the declarative input, caller client,
and `create` or read-only `check` mode, and must establish matching guarantees.
The callback and creator must share application-managed readiness: after a
successful `check`, later ordinary use must not auto-create the checked
structures. A `create` callback verifies its result. Each callback cleans up
resources it partially acquires if preparation fails.
The built-in Entity provider writes its record families independently; custom
record creators do not join a combined Entity transaction.
Custom Entity bundles return a `Promise<void>` from `close()` and provide synchronous
`closeIdle()` for internal assembly rollback. Their close fences new commits immediately,
waits for admitted work, and releases every resource acquired by the custom creator.
The factory tracks each bundle as one disposal unit and awaits its close before
closing the native tenant catalog.

## Physical layout

Every record family uses the source Proto full name as its default kind. A
grouped family uses `<group>_<record-simple-name>`. A layout registration can
replace only the kind. Rows contain unindexed Protobuf `bytes` and the declared
indexed columns. Current Entity rows declare `archived`, `deleted`, and Entity
`version` in addition to model `(column)` fields; Entity `version` is not a
provider revision. No scope, ID copy, storage revision, schema fingerprint,
marker, or compatibility entity is stored. The Bounded Context name is
diagnostic only.

Single tenancy preserves the caller client's configured/default namespace.
Multitenancy converts the complete generated `TenantId` to a native namespace.
The default converter supports the reversible JVM `D<domain>` and `V<value>`
forms. It rejects email tenants because JVM's `E` conversion replaces `@` with
`-at-` and is not injective. Email tenants require one reversible custom
converter installed in both TS and JVM. Catalog admission rejects empty,
non-round-tripping, or colliding converter results before provider work. The
key contains only the resolved kind and mapped record ID. Message IDs use
compact Proto JSON or their
registered custom stringifier; `string`, `int32`, and `int64` IDs use their
direct text form as the key name. `bytes` and `__key__` are reserved. Blank
kinds, kinds or key names over 1,500 UTF-8 bytes, unsupported values, non-finite
numbers, and integers outside their declared/provider range fail before an
RPC. Stored `bytes` remain authoritative; declared properties are rematerialized
after decoding.

`contains()` checks the exact native `__namespace__` metadata key without
writing records or scanning the catalog. `keep()` confirms an existing
namespace and rejects a missing one. Applications needing registration before
the first Datastore entity exists supply their own tenant index.

Declared string and boolean columns use native values. Integer columns use
Datastore int values, float/double columns use Datastore double values, bytes
use blobs, enums use their numeric value, Timestamp uses the native timestamp,
Version uses its number, and ordinary messages use the same compact Proto JSON
or custom stringifier as query operands. Null is stored as native null. The
application type registry is required when default Proto JSON expands `Any`.

Entity current records use `EntityRecord`; enabled state history uses grouped
`EntityStateKey`/`EntityRecord`; diagnostic history uses grouped
`EventId`/`Event`; Event Store is a separate ungrouped Event family. Disabled
histories allocate no record handle or Datastore row.

## Queries and commits

Queries run inside the selected native namespace. Normalized plans admit only
IDs (up to Datastore's legal key filter bound), equality, one inequality column,
flat conjunction, inequality-compatible ordering, and limit. Nested or
disjunctive predicates, oversized key sets, and illegal inequality/order shapes
reject before provider access; they never trigger an unfiltered reconciliation
read.
`writeAll()` uses batches of at most 500 mutations and is not atomic across
batches.

Provider-legal ID predicates, declared-property comparisons, and ordering are
pushed only when Datastore can execute the whole selected conjunction. Runtime
descriptor/column validation happens before that decision. An omitted query
budget uses the shared 10,000-record materialization bound, but Datastore's
explicit value cannot exceed 10,000. Datastore's accepted/provider ceiling is
1,000 rows. It may read one overflow-lookahead row
(1,001 raw rows) to reject an oversized scan rather than materializing more
rows. There is no public Datastore cursor API.

This is deliberately the overlap, not MySQL parity: nested or disjunctive
predicates and provider-illegal inequality/order shapes reject before provider
access. Normalized plans have no offset; `RecordQuery.offset` is separate.

The provider Entity commit writes state history, diagnostic Events, delivery
Events, and current state as independent records in that order. A later failure
can leave the completed prefix. It does not compare current state with an
expected previous record. Success resolves without a value. Identical
immutable retries remain accepted; divergent immutable content fails. A
captured prepared input is retried once after an `ABORTED` provider failure,
with the same record bytes, versions, and Event IDs; the application handler
does not run again. Event presence alone does not prove the current record was
written. Separate saves can interleave, including current-state writes.

History reads use stable finite keyset pages. State history provides backward,
state-at-time, trim, and truncate behavior; event history provides backward and
truncate behavior. Timestamp comparisons include seconds and nanoseconds.
Long maintenance can commit several bounded chunks, so a later failure leaves
earlier chunks durable and the caller retries the same idempotent operation.

The provider-only Agent history handle uses the fixed `spine_agent_history`
kind in each complete tenant namespace. Each row retains the original complete
`AgentHistoryEntry` and full state type and Agent key. SHA-256 digests provide
bounded physical IDs and indexed scope/conversation keys; every decoded row is
checked against the complete requested scope and conversation. A digest
collision fails the read. `index.yaml` declares three complete composite
indexes for scope plus full order, scope plus category plus full order, and
scope plus conversation digest plus full order. The order value encodes full
Timestamp seconds/nanoseconds, category, and unsigned UTF-8 record ID. Values
longer than Datastore's 1,500-byte indexed-string limit reject before append;
original scope strings remain unindexed in the payload. Reads use native pages
of at most 128 rows and sum serialized entry bytes. A fetched chunk can be
larger than the returned byte budget.

The factory has one tenant catalog. It reads native `__namespace__` metadata,
converts only namespaces recognized by its `NamespaceConverter`. `keep()`
stores no `TenantId` row or other discovery record; Datastore exposes native
metadata after an application entity is written in that namespace.

Before deployment to an existing project, run `pnpm --dir
packages/storage-datastore inventory:legacy -- --project <project-id>`. It
enumerates native namespaces and kinds and fails closed on discovery errors,
an old `_scope` property, or a scope-derived key name. Passing the inventory is
a startup prerequisite; the application performs migration offline, with no
dual-layout reads or automatic conflict winner.

## Agent live persistence

`AgentHistoryStorage.appendAll()` saves one complete immutable audit group
atomically. The live `EntityCommitStorage.commitAgent()` compares exact Entity
state and model preferences before it writes accepted state, preferences, and
history in one Datastore transaction. A no-op or preference-only turn can leave
the Entity Version unchanged. Typed admission receipts persist separately and
do not make an interrupted Agent handler replayable. Datastore entity, index,
and transaction limits still apply, including the adapter's 9 MiB staged
transaction payload ceiling. No transaction remains open during a model call.

## Operations and errors

Malformed payloads fail with a redacted decoding error. Physical Datastore
errors are surfaced without payload data. The emulator suite is required for
provider acceptance; cloud smoke remains credential-gated.

`build()` and storage-handle creation issue no request. Closing the factory is
idempotent, prevents creation of another handle, and drains tracked Entity bundles
and commit handles. It leaves ordinary independent record handles and the
caller-supplied client open. Each handle rejects work after it is closed.
