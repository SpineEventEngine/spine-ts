# Storage Tenancy Correction Plan

Status: Complete, reviewed, and release-verified under the T-0147 through
T-0150 stacked train. The train remains unmerged pending the explicit stacked
integration step.

## Why this correction exists

Wave 8 introduced two private persistence fields that Spine JVM does not use:

- `_scope`, which combines a Bounded Context name, tenant, source type, and
  storage group into one hidden record discriminator;
- `_revision`, which is stored and incremented by MySQL but is not consulted by
  any compare-and-set or conflict decision.

The same implementation also made the Bounded Context name part of in-memory,
MySQL, and Datastore physical identity, and persisted a synthetic `TenantId`
record family. These choices contradict the target model:

- Bounded Contexts do not partition persisted data. Domain types and configured
  record families provide separation.
- Tenant isolation is provider-specific.
- MySQL selects a tenant-specific database/data source.
- Datastore selects a tenant-specific native namespace.
- Atomicity uses provider transactions, locks, and exact record comparison; it
  does not require a private revision column.

This is a breaking storage-layout correction. It must not be hidden behind a
compatibility facade.

The correction also freezes physical interoperability with Spine JVM. A
message-valued ID or declared query column must have the same provider value in
Spine TS and Spine JVM. Logical equality inside one runtime is insufficient:
JVM must be able to read and query records written by TS, and TS must be able to
read and query records written by JVM.

## JVM evidence

### Datastore

The current JVM Datastore adapter obtains the current tenant through
`TenantFunction`, converts it to a Datastore namespace, and applies that
namespace to keys and queries:

- `core-jvm/server/src/main/java/io/spine/server/tenant/TenantFunction.java`
- `gcloud-2x/datastore/src/main/java/io/spine/server/storage/datastore/tenant/Namespace.java`
- `gcloud-2x/datastore/src/main/java/io/spine/server/storage/datastore/tenant/MultitenantNamespaceSupplier.java`
- `gcloud-2x/datastore/src/main/java/io/spine/server/storage/datastore/DatastoreWrapper.java`
- `gcloud-2x/datastore/src/main/java/io/spine/server/storage/datastore/DsReaderLookup.java`

The stored Datastore entity contains an unindexed serialized `bytes` property
and declared query columns only. Kind selection does not include the Bounded
Context name:

- `gcloud-2x/datastore/src/main/java/io/spine/server/storage/datastore/record/Entities.java`
- `gcloud-2x/datastore/src/main/java/io/spine/server/storage/datastore/record/DsRecordStorage.java`
- `gcloud-2x/datastore/src/main/java/io/spine/server/storage/datastore/Kind.java`

Tenant discovery reads Datastore's native `__namespace__` metadata rather than
storing a `TenantId` record family:

- `gcloud-2x/datastore/src/main/java/io/spine/server/storage/datastore/tenant/NamespaceIndex.java`

### MySQL/JDBC

The current local JVM JDBC 2.x branch has one fixed data source per factory and
does not yet implement tenant routing. It therefore cannot be cited as a
working multitenant implementation. It does establish that table names derive
from the source Protobuf type and that tables contain the ID, serialized bytes,
and declared columns without a Bounded Context discriminator or private
revision column:

- `jdbc-2x/rdbms/src/main/java/io/spine/server/storage/jdbc/JdbcStorageFactory.java`
- `jdbc-2x/rdbms/src/main/java/io/spine/server/storage/jdbc/TableNames.java`
- `jdbc-2x/rdbms/src/main/java/io/spine/server/storage/jdbc/TableSpecs.java`
- `jdbc-2x/rdbms/src/main/java/io/spine/server/storage/jdbc/query/WriteOneQuery.java`
- `jdbc-2x/mysql/src/main/java/io/spine/server/storage/mysql/MySqlUpsertOneQuery.java`

The historical JVM branch `origin/multitenancy-support` at `603a4706` contains
the intended JDBC mechanism: `MultitenantDataSourceSupplier` selects a
`DataSourceWrapper` from a `Map<TenantId, DataSourceWrapper>` through
`TenantFunction`. The human direction for this correction freezes that
provider model for Spine TS: a multitenant MySQL factory routes each tenant to
its own configured database/data source.

## Correct storage identity

The physical identity of a record is:

```text
provider tenant boundary + record family + record ID
```

It is not:

```text
Bounded Context + tenant + record family + record ID + private revision
```

A record family is selected from `RecordSpec` plus its optional
`StorageGroup`, including any explicit provider customization. The Bounded
Context name remains useful for diagnostics and error messages, but it must not
affect a database, namespace, table, kind, key, query predicate, transaction,
lock, cache key, or record-sharing decision.

### Tenant identity

The implementation must stop flattening the generated `TenantId` variants into
ambiguous strings such as `domain:<value>`. `StorageContext` must preserve the
complete `TenantId` message. One internal `TenantBoundary` derives a
collision-free key from the TenantId kind and deterministic Proto bytes; MySQL
lookup, memory slices, EventStore/cache identity, provider catalogs, and
Datastore conversion all consume that same value.

The three generated variants remain distinct even when their significant text
is equal:

```text
domain(example.test) != email(example.test) != value(example.test)
```

The safe default Datastore converter follows JVM's reversible typed namespace
forms: `D<domain>` and `V<value>`. JVM's `E<email>` form replaces `@` with
`-at-`; it is neither reversible nor injective, so TS rejects it by default
instead of risking cross-tenant aliasing. Email tenants require the same custom
injective converter in both runtimes. Conversion must be tested in both
directions. A custom converter must be injective over admitted tenants and
return “not a tenant” for namespaces it does not own. Default/empty TenantIds
are invalid in multitenant mode.

## JVM-compatible ID and column mapping

Spine JVM does not infer storage values from arbitrary JavaScript-like object
shapes. Its storage specification retains the declared Proto field type, and a
provider `ColumnMapping` converts that typed value both when a record is written
and when a query predicate is built. `Identifier` handles the supported ID
types and Any packing, while `Stringifiers` supplies reversible textual forms
for messages where the provider mapping calls for text.

Spine TS must adopt the same separation:

1. `RecordSpec` retains the complete generated ID schema.
2. Every `RecordColumn` retains its generated Proto field descriptor/schema,
   not a free-form value such as `"protobuf"`.
3. A common identifier contract validates, packs, unpacks, and classifies
   supported primitive and message IDs.
4. A reversible stringifier registry provides the JVM-compatible default
   compact Proto JSON form for messages and explicit custom mappings.
5. Each provider owns a typed column mapping. The provider applies the same
   mapping to stored column values, equality/range query operands, ordering,
   and keyset continuation values.
6. Reading performs the corresponding reverse mapping wherever the provider
   value must be reconstructed as a Proto value.

The default physical mappings must match JVM, including:

| Proto value                                     | MySQL/JDBC value          | Datastore value                               |
| ----------------------------------------------- | ------------------------- | --------------------------------------------- |
| `string`                                        | string column             | `StringValue`                                 |
| `int32`/`uint32` and compatible integral values | integer column            | `LongValue`                                   |
| `int64`/`uint64` and compatible integral values | long/integer column       | `LongValue`                                   |
| `bool`                                          | boolean column            | `BooleanValue`                                |
| `bytes`                                         | binary column             | `BlobValue`                                   |
| enum                                            | numeric declaration order | `LongValue` declaration order                 |
| ordinary message                                | compact Proto JSON string | `StringValue` from the registered stringifier |
| `Timestamp`                                     | epoch nanoseconds         | native `TimestampValue`                       |
| `Version`                                       | version number            | `LongValue` version number                    |
| null, where admitted                            | SQL null                  | `NullValue`                                   |

Message-valued record IDs use the JVM provider representation rather than TS's
current private encodings:

- MySQL stores the compact Proto JSON text used by JVM's message ID column;
- Datastore uses the reversible stringifier text as the key name;
- primitive IDs retain their provider-native JVM-compatible scalar forms.

“Compact Proto JSON” means the Protobuf JSON mapping, not `JSON.stringify()` of
an arbitrary JavaScript object. Its field names, enum representation, 64-bit
integer strings, bytes encoding, well-known types, omission/default rules, and
parser behavior must match JVM. Compatibility is accepted only through shared
golden vectors produced and consumed by both runtimes; visually similar JSON is
not sufficient.

This requirement removes the current TS-only formats:

- raw deterministic Protobuf binary for MySQL message IDs;
- tagged `CanonicalMysqlValues` IDs;
- tagged `CanonicalValue` Datastore key names;
- generic `JSON.stringify()` for message columns;
- any write path or query path that bypasses the same typed mapping.

The serialized record `bytes` remain ordinary deterministic Protobuf binary;
the compatibility change concerns physical IDs, materialized query columns,
and query operands. Table/kind naming and grouping must also match the approved
JVM layout or an explicitly documented cross-runtime name customization.

## Required invariants

1. No production schema, persisted record, key, or query contains `_scope` or
   `_revision`.
2. No Bounded Context name participates in physical storage identity.
3. In MySQL multitenancy, a tenant selects exactly one configured database/data
   source before any table operation.
4. In Datastore multitenancy, a tenant selects exactly one native namespace for
   every key, query, and transaction.
5. Single-tenant MySQL uses its one configured database. Single-tenant
   Datastore uses the caller client's configured/default namespace.
6. Within a tenant boundary, equal family and ID values refer to the same
   physical record even when opened by different Bounded Contexts.
7. Different tenants may use equal family and ID values without collision.
8. A physical record contains the provider key/ID, serialized bytes, and
   declared columns only. Provider-native key metadata is not duplicated as a
   hidden Proto or pseudo-column.
9. Exact compare-and-set remains atomic without `_revision`.
10. Tenant discovery is provider-owned; there is no generic persisted
    `TenantId` record family.
11. Domain, email, and value TenantIds cannot collide, including when an
    application value begins with text such as `domain:` or `email:`.
12. Every stored ID and declared column has one schema-aware provider mapping;
    writes and queries use the identical mapping.
13. JVM and TS golden vectors produce identical MySQL parameter values and
    Datastore key/property values for every supported ID and column type.
14. No private tagged JSON, generic object stringification, or raw message-ID
    binary remains in a provider key or ID column.

## Implementation sequence

### 1. Correct the common storage contract

- Delete `canonical-scope.ts` and every `StorageScopes` use.
- Redefine `StorageContext.name` as diagnostic context only.
- Replace the flattened optional tenant string with the complete generated
  `TenantId`; derive one immutable `TenantBoundary` for provider selection.
- State explicitly that the typed `tenantId` selects a provider tenant boundary
  and that `RecordSpec` plus `StorageGroup` selects the physical family.
- Remove Bounded Context names from memory keys, EventStore snapshots, lock
  names, factory sharing rules, and provider customization identity.
- Add common contract tests proving two contexts share the same tenant/family
  record and two tenants do not.
- Replace string-only `RecordColumn.valueType` with generated Proto field type
  metadata sufficient to distinguish scalar, enum, message, `Timestamp`, and
  `Version` values.
- Add JVM-shaped identifier, stringifier, and provider-column-mapping ports.
  Keep Proto reflection and conversion in storage contracts/adapters rather
  than entity or query business logic.
- Define shared cross-runtime golden fixtures for message and primitive IDs and
  every supported column category.

No replacement scope token, fingerprint, discriminator, or compatibility
alias is permitted.

### 2. Replace generic tenant records with a provider tenant catalog

Replace `TenantIndexes.create({ contextName, storageFactory })` and the direct
`TenantId` `RecordSpec` with a storage-provider capability that can:

- note an admitted tenant when the provider requires it;
- enumerate tenant boundaries available for delivery startup;
- participate in the storage factory's existing lifecycle.

The capability and its resources are factory-owned, not
Bounded-Context-owned. Calling it from two contexts must not create two
catalogs, and closing one Bounded Context must not close a catalog still used
by another. The storage factory closes the catalog with its other resources.

Provider behavior:

- Datastore enumerates native namespaces and converts them to tenant IDs. A
  short-lived in-process cache may avoid metadata lag, matching JVM behavior,
  but it is not persistence.
- MySQL enumerates the configured tenant-to-database/data-source registry.
- Memory enumerates its tenant slices.
- Single-tenant providers return the one unscoped startup boundary.

The catalog represents single tenancy with one explicit internal singleton,
not with a magic string or an empty TenantId. The server translates that
singleton to the existing tenant-free delivery scope only at its boundary.

Datastore enumeration applies the same converter used for writes. It ignores
native namespaces for which the converter returns “not a tenant,” rejects an
invalid or non-round-tripping conversion, deduplicates equal canonical
TenantIds, and never treats the empty/default namespace as a multitenant
tenant. The safe default `D`/`V` converter requires a Datastore project
dedicated to that Spine application. A shared project requires an
application-specific converter that rejects namespaces owned by other
applications. The same rule applies to an injective custom converter used for
email tenants in both runtimes.

An arbitrary MySQL resolver that cannot enumerate tenants is insufficient for
delivery startup. The first implementation should therefore expose an
immutable list of typed tenant/database entries keyed internally by
`TenantBoundary` (or require a separate enumerable tenant directory alongside a
resolver); it must reject ambiguous configuration. It must not use JavaScript
object identity for generated `TenantId` map keys.

### 3. Correct MySQL

- Change the builder to accept either:
  - one `MysqlStorageOptions` value for single-tenant use; or
  - immutable typed `{ tenantId: TenantId, options: MysqlStorageOptions }`
    entries for multitenant use.
- Validate every URL includes a database and reject blank/duplicate tenant IDs.
- Normalize each server/database identity and reject two tenant entries that
  point to the same physical target, even through textually different URLs.
- Create and own one pool per configured tenant database. Close every pool and
  every handle exactly once, including partial-build failure paths.
- Select the pool/database from `StorageContext` before resolving or executing
  a record operation. Reject a missing tenant, an unexpected tenant in
  single-tenant mode, or an unknown tenant before acquiring a connection.
- Generate tables with primary key `ID` and columns `bytes` plus the declared
  Proto columns. Remove `_scope`, `_revision`, their bindings, predicates,
  schema checks, and test helpers.
- Replace private binary/tagged ID codecs with JVM-compatible native scalar IDs
  and compact Proto JSON message IDs.
- Introduce a MySQL column mapping equivalent to JVM `JdbcColumnMapping`; use
  it for DDL type selection, write parameters, query predicates, ordering, and
  continuation values.
- Keep exact-payload CAS inside the existing transaction and `SELECT ... FOR
UPDATE` path.
- Key advisory locks by the selected physical database, record family, and ID.
  Do not repeat the tenant or Bounded Context in the lock name.
- Ensure table customization applies consistently in every tenant database.

### 4. Correct Datastore

- Add a tenant-to-namespace converter compatible with JVM namespace semantics.
- Construct every record key from namespace, kind, and canonical record ID.
  Remove scope-derived key names and the `_scope` property/filter.
- Replace tagged key-name JSON with the JVM-compatible reversible ID
  stringifier, using compact Proto JSON for default message IDs.
- Apply the namespace to every query and native transaction, including
  reconciliation scans and entity commits.
- Store only unindexed serialized `bytes` plus declared indexed columns.
- Introduce a Datastore column mapping equivalent to JVM `DsColumnMapping`;
  preserve native scalar, blob, timestamp, null, enum, version, and stringified
  message property types, and use it for both writes and query operands.
- Preserve exact-payload CAS inside a native Datastore transaction; do not add
  a replacement revision property.
- Implement provider tenant enumeration through native `__namespace__`
  metadata plus a non-persistent admission cache.
- Expose the same typed forward/reverse namespace converter to key creation,
  admission caching, and namespace enumeration; never parse flattened tenant
  strings in adapter code.
- Revalidate custom kind registrations now that a hidden scope cannot separate
  collisions. Reject incompatible record families mapped to the same kind.

### 5. Correct in-memory storage

- Organize state as tenant boundary, record family, then record ID.
- Remove Bounded Context names from record storage, entity history, EventStore,
  and lock/cache identity.
- Enumerate multitenant startup scopes from the in-memory tenant slices.
- Preserve exact-record CAS semantics.

### 6. Recheck shared server families

- Verify Inbox, shard session, subscription, lease, authentication, entity,
  event, state-history, and event-history families after scope removal.
- Prove that delivery ownership is shared where its IDs are global and tenant
  isolated where its `StorageContext` carries a tenant.
- Prove that the same complete worker and shard fencing behavior survives.
- Remove all server construction and corruption handling for stored `TenantId`
  rows.
- Ensure no new claim, marker, receipt, dedup, scope, revision, or tenant-index
  record is introduced.

### 7. Migration boundary

This correction changes physical identity and is not backward compatible with
Wave 8's invented layout.

- Do not silently read both layouts, copy on access, or retain compatibility
  columns.
- Require new/empty MySQL tenant databases and Datastore namespaces for the
  initial corrected release, unless a separate explicit migration tool is
  approved.
- Before a MySQL factory becomes usable, preflight every configured tenant
  database for the legacy columns and compound key. If any target is legacy or
  unreachable, fail the whole build and close every pool opened so far.
- Document that old Datastore scope-derived keys are not visible to the new
  canonical keys and require an application-owned/offline migration.
- Add mandatory pre-deployment inventory commands for MySQL and Datastore. Each
  exits nonzero when legacy MySQL columns/keys or Datastore scope properties and
  scope-derived keys remain. Deployment documentation must make passing this
  gate a prerequisite to starting the corrected runtime.
- If records from multiple old Bounded Context scopes collapse onto the same
  corrected family/ID, stop the offline migration and report every conflicting
  source. The runtime and migration tool must never choose a winner.

## Behavior-first verification

### Common matrix

- Context A writes and Context B reads the same tenant/family/ID.
- Two tenants write equal family/ID values and read different records.
- Different groups for one source remain different families.
- Exact CAS succeeds once and rejects a stale expected record.
- In a synchronized two-writer CAS race, exactly one writer succeeds; the loser
  observes conflict and all transaction/lock resources are released.
- Query columns continue to filter declared Proto values without provider
  metadata predicates.
- Golden MessageId, BoardId, UserId, string, integer, enum, bytes, Timestamp,
  Version, and ordinary-message values encode identically in JVM and TS.
- Equality and range queries map their operands through the exact mapping used
  to materialize the corresponding column.
- A JVM-written fixture can be read and queried by TS, and a TS-written fixture
  can be read and queried by JVM, for both providers.

### MySQL matrix

- Single-tenant factory uses its configured database.
- Multitenant factory routes two tenant IDs to two distinct database URLs.
- Two tenant entries resolving to one normalized server/database are rejected.
- Missing, blank, unknown, and mode-conflicting tenant inputs fail before pool
  acquisition.
- DDL has `PRIMARY KEY (ID)` and no `_scope` or `_revision`.
- Reads, writes, deletes, indexes, and queries contain no hidden scope clause.
- Transaction rollback, exact CAS, entity commit, advisory fencing, connection
  release, and multi-pool close behavior remain correct.
- A synchronized two-connection CAS race has exactly one winner and rolls back
  and releases the loser.
- The same configured table layout is validated independently in each tenant
  database.

### Datastore matrix

- Two tenants produce equal kind/ID keys in different native namespaces.
- Keys and every query/transaction carry the selected namespace.
- Entities contain only `bytes` and declared columns.
- Exact CAS and entity commit remain transactional.
- A synchronized two-transaction CAS race has exactly one winner and leaves no
  transaction open.
- Native namespace discovery supplies delivery startup tenants without a
  `TenantId` kind.
- Single-tenant clients preserve their configured/default namespace.
- Custom kind collisions fail during builder validation.

### Server and delivery matrix

- Startup discovers tenants through the provider catalog.
- Admission updates only provider-native/in-memory catalog state.
- Two Bounded Contexts do not create duplicate tenant persistence.
- Typed value and domain tenants round-trip through default admission and
  startup discovery without collision. Email tenants round-trip when both
  runtimes use the same injective custom converter. Unrelated Datastore
  namespaces are excluded.
- Direct delivery families retain acquisition, renewal, release, takeover,
  stale fencing, acknowledgment recovery, and restart behavior.

## Documentation correction

Review every active README, reference, user guide, API guide, architecture
guide, diagram, example, task record, and release inventory. Beginner-facing
documents should explain:

- a Bounded Context does not create a database, namespace, table, or kind;
- a MySQL tenant maps to a configured database;
- a Datastore tenant maps to a native namespace;
- tables/kinds follow the Proto record family and declared query columns;
- queries filter declared Proto columns inside the already-selected tenant
  boundary;
- `_scope`, `_revision`, and stored tenant-index records do not exist.

Preserve each README's existing look and feel. Mark superseded planning/history
as historical rather than rewriting evidence.

## Review and release gates

Because this changes public configuration and persisted identity, use one
high-risk implementation owner followed by one complete review wave:

- TypeScript/API: builder shape, StorageContext semantics, provider capability,
  declarations, and breaking-change clarity;
- performance/reliability: pool lifecycle, namespace propagation, transactions,
  CAS, tenant enumeration, and delivery startup;
- style/maintainability: provider separation and removal of compatibility
  seams;
- documentation: JVM-accurate, beginner-readable provider examples;
- security: tenant isolation is a trust boundary, so final security review is
  required.

Before review, run focused tests, changed-package typechecks, changed-file
ESLint, TSDoc, documentation audience/snippet/link checks, Prettier,
`git diff --check`, legacy-symbol scans, and changed-source coverage at or above
90% in every metric. After one aggregated correction batch and targeted
re-review, run one final `verify:release`.

## Proposed implementation tasks

One existing high-risk implementation owner owns the complete T-0147 through
T-0150 train. Provider specialists and reviewers remain read-only until the
normal review wave. The intermediate checkpoints are not independently
releasable tasks and cannot be declared complete, merged to `main`, or used by
examples before T-0150 passes the shared acceptance unit.

1. **T-0147 — Tenant-boundary contract preparation**: introduce and test the
   typed, collision-free `TenantBoundary`, factory-owned tenant-catalog
   capability, schema-aware `RecordColumn`, identifier/stringifier contracts,
   provider column-mapping ports, JVM golden vectors, and provider conformance
   harness. It excludes public/runtime cutover, provider layout changes, and
   deletion of the old seam.
2. **T-0148 — MySQL tenant databases and schema correction**: add enumerable
   tenant-database configuration; route operations and catalog enumeration by
   tenant; adopt JVM-compatible ID and column mappings; route stored and query
   values through one mapping; remove `_scope`/`_revision`; preserve
   transactions and locks.
   This is a non-releasable provider checkpoint and explicitly excludes server
   operability under the new catalog.
3. **T-0149 — Datastore namespaces and key correction**: route keys, queries,
   transactions, and catalog enumeration through native namespaces; adopt
   JVM-compatible ID stringification and native column mappings; route stored
   and query values through one mapping; remove `_scope`; preserve transactional
   CAS. This is a non-releasable provider checkpoint and explicitly excludes
   server operability under the new catalog.
4. **T-0150 — Atomic shared-runtime cutover and release convergence**: change
   memory storage, EventStore/cache identity, and server tenant discovery;
   delete `canonical-scope.ts`, the generic `TenantId` family, and all remaining
   context-derived physical identity in one correction batch. Then converge
   delivery/entity/event/subscription behavior, examples, migration
   diagnostics, active documentation, invention audit, and release verification.

Per-checkpoint acceptance is narrow: T-0147 passes typed-boundary/catalog
contract tests; T-0148 passes the complete MySQL provider and migration
preflight matrix; T-0149 passes the complete Datastore provider, namespace
discovery, and migration inventory matrix. Only T-0150 owns cross-provider
compilation, server operability, deletion scans, examples, full review,
security review, and `verify:release`.

The checkpoint risk ledger is explicit:

- T-0147 risks a new serialized/public tenant identity; declarations and
  collision tests are its primary gate. It also risks an incomplete Proto type
  model or superficially similar JSON; cross-runtime golden vectors are a
  primary gate.
- T-0148 risks cross-tenant database aliasing, partial pool leaks, and accepting
  legacy schemas; normalized-target, lifecycle, and preflight tests are its
  primary gate.
- T-0149 risks missing namespace propagation or admitting another application's
  namespace; key/query/transaction and converter/discovery tests are its primary
  gate.
- T-0150 risks a partial shared-runtime cutover; repository-wide legacy scans,
  cross-provider tests, migration gates, and final security/reliability review
  are its primary gate.

These tasks form a stacked train. T-0147 is additive preparation only; T-0148
and T-0149 make provider-local corrections; T-0150 is the single shared-runtime
cutover that removes the old seam. No adapter may offer both old and new
physical layouts. Do not merge or publish an intermediate layout from this
train as a release, and do not merge to `main` until all providers and shared
runtime agree on the corrected identity contract.
