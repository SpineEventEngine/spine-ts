# @spine-event-engine/storage-datastore reference

This reference is for agents configuring the Google Cloud Datastore adapter.

## Public entry point

Import `DatastoreStorageFactory`, `DatastoreStorageFactoryBuilder`,
`RecordLayout`, `CreateRecordStorage`, `CreateEntityStorage`,
`NamespaceConverter`, `DefaultNamespaceConverter`, `DatastoreIdColumn`,
`DatastoreColumnMapping`, and `DatastoreQueryLimitError` from
`@spine-event-engine/storage-datastore`.
Create a factory with `DatastoreStorageFactory.newBuilder().setClient(client)`.
The adapter never closes that client.

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
stringifier registry; they must provide equivalent tenant, ID, and column mapping. The
built-in Entity provider does not mix custom record creators into one transaction.

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

`keep()` bridges native `__namespace__` metadata lag without storing a tenant
record. Its early-admission cache retains at most 1,000 tenants for at most 60
seconds and removes an entry sooner when native metadata becomes visible. A
full cache fails closed; applications can retry after metadata appears or an
entry expires.

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
flat conjunction, inequality-compatible ordering, limit, and mask. Nested or
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

The internal Entity commit reads current and immutable keys then applies current,
enabled histories, and delivery events in one Datastore transaction. It rejects
more than 25 entity groups, 500 mutations, or its conservative transaction-size
limit before opening the transaction. Current mismatch returns `conflict`.
An already-applied identical retry returns `committed`; divergent immutable
content fails. Only ABORTED provider failures retry, for at most three attempts.

History reads use stable finite keyset pages. State history provides backward,
state-at-time, trim, and truncate behavior; event history provides backward and
truncate behavior. Timestamp comparisons include seconds and nanoseconds.
Long maintenance can commit several bounded chunks, so a later failure leaves
earlier chunks durable and the caller retries the same idempotent operation.

The factory has one tenant catalog. It reads native `__namespace__` metadata,
converts only namespaces recognized by its `NamespaceConverter`, and keeps an early
in-memory cache for newly admitted tenants. `keep()` stores no `TenantId` row or
other discovery record; Datastore exposes native metadata after an application
entity is written in that namespace.

Before deployment to an existing project, run `pnpm --dir
packages/storage-datastore inventory:legacy -- --project <project-id>`. It
enumerates native namespaces and kinds and fails closed on discovery errors,
an old `_scope` property, or a scope-derived key name. Passing the inventory is
a startup prerequisite; the application performs migration offline, with no
dual-layout reads or automatic conflict winner.

## Operations and errors

Malformed payloads fail with a redacted decoding error. Physical Datastore
errors are surfaced without payload data. The emulator suite is required for
provider acceptance; cloud smoke remains credential-gated.

`build()` and storage-handle creation issue no request. Closing the factory is
idempotent and prevents creation of another handle without closing the
caller-supplied client or already-created handles. Each record, Entity, and commit
handle has an independent idempotent lifecycle and rejects work after it is closed.
