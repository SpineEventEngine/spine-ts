# Declared physical record indexes

High-risk provider prerequisite between M3 and M4. The complete Human-Imposed
Requirements Ledger in TASK.md and the controlling PROPOSAL govern this slice.
The public-contract addition requires independent review before implementation.

Generic record specifications currently declare queryable columns but cannot
request physical secondary indexes. Auth lookup and expiry queries require
those indexes. This slice adds optional index declarations and exact byte
columns, with existing business declarations and preparation defaults unchanged.

## Minimal common contract

Add `RecordIndex` in `packages/storage/src/record/record-index.ts`, export its
type from the storage root, and add `indexes?: readonly RecordIndex[]` to
`RecordSpecOptions`. Expose a detached immutable `RecordSpec.indexes` array.
The interface is deliberately only a name and ordered columns:

```typescript
/**
 * Declares a complete, non-unique ascending lookup index for one record family.
 */
export interface RecordIndex {
  /**
   * Identifies this requirement within the record specification.
   */
  readonly name: string;

  /**
   * Lists declared column names in index order; `id` selects the storage slot ID.
   */
  readonly columns: readonly string[];
}
```

Required validation: nonblank distinct index names,
nonempty ordered column lists, no repeated component, all names resolve, and no
ambiguity between the special `id` component and a same-named declared column.
Capture index objects and their arrays immutably. Do not add uniqueness,
descending, expression, partial, INCLUDE, prefix, custom collation or index-method
options in this slice.

Add `ColumnTypes.fixedBytes(byteLength): RecordColumnType<Uint8Array>`. It retains
`kind: "scalar"`, `scalar: BYTES`, and carries `byteLength` metadata valid only
for that scalar kind. Validate a positive safe-integer width and reject a stored value of
another width before provider mutation; never pad or truncate. Apply the same
width validation to mapped query values. Existing `ColumnTypes.scalar(BYTES)`
continues to describe unconstrained bytes. The type addition must not change
the meaning or mapping of existing columns.

Map fixed bytes to MySQL `VARBINARY(n)`, PostgreSQL `BYTEA`, and Datastore bytes.
The fixed width is an encoding invariant checked by the framework, not a new
maximum length for email, user ID, provider ID, subject or another domain input.
PostgreSQL BYTEA need not acquire a new SQL CHECK-constraint subsystem. Include
the width in local declaration/readiness signatures even where its SQL type is
unchanged. Unsupported physical index widths fail clearly through declaration
or preparation; do not silently select a prefix.

The two concrete widths required by this task have non-arbitrary sources:
SHA-256 produces 32 bytes; an exact order key uses an eight-byte signed seconds
component and a four-byte nanos component. No configurable maximum input length,
result cap, timeout, retry budget or retention default is introduced.

## Physical preparation

Resolved `MysqlTableSpec` and `PostgresTableSpec` must carry the resolved index
requirements for custom table creators and preparation. An optional index field
can mean an empty list for existing manually supplied specs; canonical resolvers
always supply the actual list. Map logical `id` to `ID` or Datastore `__key__`.
Generate deterministic, table-scoped SQL index names within the engine's actual
identifier constraints. Do not restrict domain values to make names fit.
PostgreSQL index names are schema-scoped: a shared logical name such as `expiry`
cannot be emitted unchanged for every table.

The existing `StoragePreparations.prepareRecord()` call remains the only
preparation seam; no public prepareIndex/ready method is added. Its requirement
now includes the declared indexes. In create mode, verify the table and create
missing indexes, then verify them before marking readiness. In check mode,
missing or incompatible indexes reject without DDL. Existing incompatible
indexes reject in both modes; never drop/rebuild/alter them. Creating a missing
declared index is the accepted missing-structure preparation, not a migration.

Custom providers must not silently inherit support. Add an optional
`supportsRecordIndexes?: boolean` attestation to the provider-only
`StoragePreparation` interface. Capture it at registration, and guard
`prepareRecord` centrally in `StoragePreparations`: a nonempty `spec.indexes`
requires an explicit true attestation, otherwise reject with an unsupported
capability error before invoking the provider. Providers that attest must honor
the selected mode for supported declarations and reject unsupported shapes.
Built-ins explicitly attest. Existing custom providers with index-free specs
retain their behavior. Default/true auth construction thus cannot return after
an older custom preparation implementation simply ignores the new metadata.
False construction does not invoke preparation or this physical-preparation
capability path: its deployment supplies structures, while ordinary local
declaration/query validation and M1's no-preparation capability remain in force.
No probe is used to infer support. This small provider-SPI addition is included
in the preimplementation public-contract review.

SQL checks establish all relevant structure: target table/schema, ordered full
columns, compatible column types, non-uniqueness, ascending direction, native
B-tree access method, matching effective collation/order semantics, absence of
prefix/expression/partial substitutions, and usable/visible/valid/ready state
where the supported engine exposes it. PostgreSQL catalog checking must compare
actual components, not only a permissive `pg_get_indexdef()` substring. Account
for MySQL/MariaDB catalog differences supported by this repository. Harmless
additional non-unique indexes need not be rejected. Preserve existing constraints
on unexpected uniqueness; required lookup indexes never become unique indexes.

Reuse current table coordination: PostgreSQL transaction/advisory lock and
MySQL preparation coordination/duplicate-name recheck. A concurrent duplicate
index creation is successful only after inspecting the resulting complete
definition. Index signatures join the table requirement signature; a changed
definition cannot reuse incompatible prior or pending readiness. Failure leaves
no successful readiness entry, releases acquired resources, and permits retry.

Both true and false persistent factories still open **non-preparing handles**.
Default/true factories explicitly await complete table-and-index preparation.
False factories perform no schema/table/column/index probes or DDL during
construction or any later read, query, CAS, delete or maintenance operation.
Do not add a lazy index hook. False handles neither await another handle's
preparation nor turn ordinary data access into successful readiness evidence.
Pure local declaration checks remain allowed.

Datastore locally validates the declaration/signature and materializes indexed
properties. Its provider does not deploy or inspect cloud composite indexes.
The exact selected shapes use built-in single-property indexes: an expiry-key
range ordered by that same property plus ascending key, and an equality-key
bucket ordered by ascending key with an optional key lower bound. The ascending
key tie-break does not require a custom composite index. Therefore M3A adds no
speculative auth `index.yaml` entries or mandatory deployment step for these
shapes. This is a source-based conclusion from the documented automatic-index
and key-order rules, to be checked against emitted provider queries. Support the
corresponding declaration `[property, id]` (and single property/ID forms);
reject other unsupported declaration shapes locally in this bounded slice.
If a later selected query actually requires a composite index, specify its exact
resolved kind/properties/directions and application deployment requirement before
claiming support. Do not infer cloud readiness from emulator success or invent
an index-admin API or schema probe for either preparation setting.
Memory validates declarations and keeps its existing query semantics; this
amendment does not introduce a new in-memory indexing subsystem.

## Exact queries without a new pagination API

### Equality candidates

In M9, materialize only needed equality keys: email, user reference, and the
selected Account provider/subject pair (or another allowlisted predicate required
by actual pinned native operations). Hash the complete value, or a deterministic
unambiguous length-delimited tuple, with purpose separation. Use the same
normalization on writes and lookups that the selected identity source requires;
do not silently lowercase arbitrary identifiers. Keep complete originals only
in the domain Proto body when raw materialized text serves no selected query.
This also avoids Datastore's indexed-string size limit.

Query `key = digest`, ascending actual slot ID, finite caller-selected page
size, continuing after the last **candidate**, including rejected collisions.
Recheck every original predicate, including extra adapter predicates, on each
decoded record. Continue past collision-only pages; a zero-match page does not
mean exhausted candidates. Apply requested matching-row limits after those
checks. Bulk mutation rechecks the whole predicate after CAS contention.

No digest UNIQUE constraint, no uniqueness assertion from digest equality, no
first-digest-match login, and no collision-bucket materialization. Controlled
provisioning retains its serialized complete-value uniqueness validation. A
digest used by an already-selected canonical point key has separate collision
failure semantics: a different complete identity must fail closed, never
overwrite or authenticate the colliding record. This amendment does not change
those canonical record identities.

### Expiry and stable ID

In M4's small auth-internal storage helper, encode the validated Timestamp as
12 bytes: big-endian signed-int64 seconds with its sign bit flipped, followed
by big-endian unsigned-int32 nanos. Valid Timestamp range/nanos checks remain
domain checks. This is a reversible order encoding, not a hash. It preserves
negative seconds, nanos and the entire Timestamp range without a millisecond
or epoch-nanosecond-int64 truncation. The stored message still has Timestamp.
Use an `expires_order` fixed-bytes column and index `[expires_order, id]` for
every selected expiring family.

Reuse the two existing query shapes:

1. Discover the next distinct expiry: normalized `expires_order <= cutoffKey`,
   and, after a completed expiry group, `expires_order > completedKey`; ascending
   expiry order, `limit: 1`, without `exhaustive`. This is an intentional
   one-result operation, not an arbitrary product cap. Ignore which ID wins
   the discovery tie; use only its exact expiry key.
2. Drain that expiry through `queryEntries`: one equality filter on the key,
   ascending `id`, a finite page size, and existing `after` continuation. Read
   every candidate's authoritative Timestamp and conditionally delete only an
   eligible unchanged row. After the tie is exhausted, resume step 1.

Deletion of previous rows cannot break continuation. CAS failure after renewal
cannot delete the renewed row. Cancellation and partial-progress semantics stay
as accepted. Concurrent insertion does not acquire a global snapshot guarantee.
Do not use growing offsets, exhaustive plans, full-family filters or a fixed
maximum number of pages. Reuse the existing accepted batching source; any new
application-configurable maintenance page size requires ordinary API review,
not an invented default.

Two narrow common/provider changes make these shapes real:

- Add unsigned lexicographic byte comparison to `QueryOrdering.compareOrdered`
  and its stable-comparison entrypoint, retaining existing equality. Use it for
  Uint8Array values; do not change string/ID/message ordering. Test `0x02` versus
  `0x10`, prefixes and equal bytes to prevent decimal-string ordering mistakes.
- Extend Datastore's existing ID-keyset fast path to declared, single-valued
  equality filters plus ascending ID, with no offset/IN/OR or other order.
  Push equality, `__key__ > after.id`, order and requested limit into Datastore;
  return this exact provider page without local resort/continuation slicing.
  Validate cursor shape and retain the original unfiltered M2 fast path.
  Exact provider pages bypass the client-side scan-overflow sentinel, including
  a full requested page whose size equals the configured scan limit plus its
  sentinel row. Test that boundary with and without equality filters and then
  continue successfully; a full exact page is not evidence of a client-side scan.
- For indexed non-null fixed-byte equality in PostgreSQL legacy queries, emit
  ordinary `=`; keep null semantics explicitly correct. Inspect EXPLAIN evidence
  to establish the useful index condition. A catalog entry plus a residual-only
  predicate does not satisfy the indexed-lookup requirement.

No new continuation field, provider page public API, generic query rewrite
framework, or mutation transaction API is needed. Fixed-byte range queries use
existing parameter mappings and the non-exhaustive normalized-plan path.

## M3A ordered slices and files

M3A is high-risk because it changes a public storage declaration and preparation
semantics. One existing implementer, explicitly Sol/medium, is responsible for
the overlapping common/provider changes. Sequence after M3 releases any shared
documentation paths; do not edit M3 files concurrently. The orchestrator handles
mechanical evidence and the existing specialist review lanes.

1. **Declaration and value semantics.** Add `record/record-index.ts`; update
   storage `record/record-spec.ts`, `record/column-type.ts`, `record/record-column.ts`
   and `record/column-mapping.ts` as needed for exact-width validation,
   `query/query-execution.ts`, `internal/storage-preparation.ts`, and root exports.
   Update provider preparation registrations for the explicit capability.
   Update memory declaration
   signatures in `memory/in-memory-storage-backend.ts` / factory where actually
   recorded. Acceptance: immutable validated declarations; old specs unchanged;
   correct fixed-byte validation and ordered comparisons; domain-correct generic
   fixtures; unsupported custom preparation fails before its callback, while
   index-free custom preparation and false construction retain their contracts.
   No auth Proto fields or auth production code in this prerequisite.
2. **SQL preparation and query use.** Update MySQL `mysql/table-spec.ts`,
   `mysql/record-storage.ts`, `mysql/storage-factory.ts`; PostgreSQL
   `postgres/table-spec.ts`, `postgres/table-initializer.ts`,
   `postgres/storage-factory.ts`, `postgres/record-storage.ts`. Mapping changes
   stay in the existing `column-mapping.ts` files if central validation is
   insufficient. A small provider `record-indexes.ts` is appropriate if required
   to keep initializer methods short. Acceptance: complete create/check,
   concurrency and signature behavior, useful equality/range query plans,
   unchanged false-handle isolation and business defaults. Do not refactor the
   Agent history subsystem merely to adopt the new declaration.
3. **Datastore path and integrated proof.** Update Datastore
   `datastore/record-storage.ts`, `datastore/storage-factory.ts` signatures and
   only necessary mapping validation. Acceptance: equality/key paging genuinely
   bounded at the provider; declared bytes remain indexed and payload remains
   unindexed; no cloud index administration; generic actual-provider fixture
   proves exact binary range/equality ordering. Retain M2 regression coverage.

Test files: existing storage `test/record/record-spec.test.ts`,
`record-column.test.ts`, `column-mapping.test.ts`, `test/query/query-execution.test.ts`
and memory tests; provider `test/*-table-spec.test.ts`, SQL initializer/factory
and record-storage tests, Datastore factory/record tests. Add focused
`record-indexes.test.ts` files where existing suites would become unwieldy.
Generic provider fixtures must model actual generic records, not auth behavior
selected by names. All authored test Proto messages/fields remain domain-correct.

Narrow API/behavior documentation accompanies these files in affected package
README/REFERENCE and TSDoc. No broad docs rewrite. M4 adds the actual expiry
encoder and store declarations; M5/M6 reuse them. M9 adds equality digest readers
and full-predicate/collision paging acceptance. These remain their existing auth
slices and are not implemented prematurely in M3A.

## Acceptance and risks

- Real SQL catalogs show complete required indexes after omitted/true store
  preparation. Check mode detects missing/wrong order/type/uniqueness/prefix/
  direction/collation/partial or unusable definitions. Same logical index name
  on distinct tables works. Unsupported types fail, never truncate.
- Concurrent independent factories converge only on the same definition.
  Failure/retry, custom table creation, local signature conflicts, and shared
  true/false handles retain M1's failure and close semantics. Trace **all** SQL
  for false construction plus CRUD/CAS/query/maintenance: no metadata or DDL.
- SQL EXPLAIN on a suitably selective fixture identifies the declared lookup
  index and index condition for equality and expiry range, including continued
  pages. Do not assert a database optimizer always chooses an index on tiny
  tables; distinguish index usability from cost-dependent plan selection.
- Actual provider pages prove expiry ties larger than one page, disappearance
  of prior rows, renewal between selection and CAS, concurrent cleanup,
  cancellation, and no materialization proportional to the family. Use the
  same SDK installation as each provider in Datastore fixtures.
- M3A generic provider tests prove binary ranges and equality; M4's actual
  expiry-encoder tests additionally cover negative seconds, second boundaries, neighboring
  nanos within one microsecond, cutoff equality, and full domain Timestamp
  endpoints. Domain validity and storage-key order must agree. Real bytes
  round-trip tests are required; native-Date happy paths are insufficient.
- In M9, deliberately forced equal digests prove that a wrong original email,
  user or provider/subject cannot authenticate, update or delete; collision-only
  pages cannot hide a later exact match. Long complete values and ambiguous
  tuple delimiters remain distinct. No digest uniqueness claim is accepted.
- Datastore deployment docs enumerate only actually required composite indexes
  for resolved kinds. Built-in index support is not described as provisioning
  cloud resources. Deployment failures remain explicit ordinary errors.
- Mechanical preflight precedes one complete relevant review wave. API,
  performance/reliability, style and documentation concerns all apply to M3A;
  final security review stays at release readiness. Preserve the full TASK
  ledger and required coverage. Shared-runtime changes feed the already-required
  converged release gate, not repeated diagnostic full runs.

Principal risks are incomplete catalog verification, stale readiness signatures,
hidden Datastore candidate scans, digest-collision shortcuts, byte-order mistakes,
and accidental native timestamp precision assumptions. Each has a concrete test
above. Actual cloud composite-index deployment is explicitly outside automatic
preparation, as already accepted. Existing provider payload/key capacities still
apply; this amendment creates no new auth input limits or promise of unlimited
physical record sizes.

Excluded: migrations/backfills, automatic repair of incompatible structures,
unique-index semantics, arbitrary auth profile expansion, generic transaction
infrastructure, index administration service, automatic cleanup, new libraries,
auth-specific provider branches, changes to M2/M3 semantics, and GitHub changes.
There is no human blocker. The remaining gate is specification incorporation and
independent review of this bounded public-contract amendment, followed by M3A.
