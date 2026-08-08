# T-0135: Datastore Record Layout

Status: Architecture complete; implementation in progress

## Objective

Replaces shared Datastore kinds and compatibility metadata with one JVM-familiar
kind per record family. Adds the approved builder, layout, and provider-creator
customization while preserving finite query pushdown and generated Entity
current/state/event history contracts from the stacked storage train.

## Classification

High-risk because this task changes a durable provider layout, public builder
and callback contracts, Entity commit behavior, and emulator/live persistence
semantics.

## Baseline And Ownership

- Baseline: reviewed and pushed T-0134 commit `824d81d2`.
- Branch: `task/T-0135-datastore-layout`.
- Worktree: `.worktrees/T-0135-datastore-layout`.
- Ownership: `packages/storage-datastore/**`, package documentation, emulator
  fixtures, bounded cloud fixtures, and narrow task/review/work records.
- No MySQL, server, deployment, example, JVM, or unrelated storage edits.

## Frozen Human Requirements

- Default kind is the source Proto full name. Entity and non-Entity families
  are separate.
- Declared `(column)` values are stored as native Datastore properties and used
  for provider-side filtering and ordering.
- `DatastoreStorageFactory.newBuilder()` returns exported
  `DatastoreStorageFactoryBuilder` with `setClient(client)`, record-only and
  grouped `organizeRecords(...)` overloads, `useRecordStorage(...)`,
  `useEntityStorage(...)`, and synchronous `build()`.
- Export `RecordLayout`, `CreateRecordStorage`, and `CreateEntityStorage`.
- Exact source-plus-record creator wins over record-only creator. Exact grouped
  layout then wins over record-only layout and the JVM default.
- Remove shared/canonical kinds, compatibility metadata, old-layout readers,
  and fallback scans presented as pushdown. No migration compatibility is
  required.

## Architecture Assignment

- Existing requirements-splitter role, explicitly dispatched at
  `gpt-5.6-sol` / `high`.
- It must freeze exact generic callback inputs/return types, kind identity and
  key rules, Entity current/history/Event Store layouts, transaction and retry
  semantics, query pushdown/finite overflow behavior, customization precedence,
  and emulator/live acceptance before the first RED test.
- The desktop surface exposes no independent runtime-model introspection; the
  immutable configured role/profile is accepted unless a mismatch or fallback
  is visible.

## Implementation Assignment

- One existing `implementer` owns all overlapping
  `packages/storage-datastore/**` production, test, and package-documentation
  files across the six ordered slices.
- The assignment is explicitly dispatched as `gpt-5.6-terra` / `medium`.
- No subagents, JVM work, unrelated provider edits, compatibility aliases, or
  task completion claims are permitted. The owner uses focused RED/GREEN tests
  and returns only after the complete package implementation and cheap preflight
  converge, or a genuine external blocker is demonstrated.

## Required Review And Verification

- Review concerns: style/maintainability, TypeScript/API docs,
  performance/reliability, and documentation.
- Security is N/A unless implementation introduces a trust, credential, or
  deployment boundary.
- Verification: package/emulator-focused coverage-enabled `verify:task`; bounded
  live checks only when credentials are available. Unavailable cloud credentials
  never replace emulator coverage.

## Frozen Public Contract

The first RED compile test must freeze these declarations exactly. `Message`,
`GenMessage`, `Datastore`, `StorageContext`, `RecordSpec`, `RecordStorage`, and
`EntityStorageInput` are the existing imported types with those names.

```ts
export interface RecordLayout {
  readonly kind: string;
}

export interface DatastoreEntityStorageHandle<I, S extends Message> {
  readonly current: EntityRecordStorage<I>;
  readonly states: EntityStateHistoryPort<I, S>;
  readonly events: EntityEventHistoryPort<I>;
  readonly commits: EntityCommitStorage;

  isOpen(): boolean;
  close(): void;
}

export type CreateRecordStorage<R extends Message = Message> = <I>(
  context: StorageContext,
  recordSpec: RecordSpec<I, R>,
  client: Datastore,
  maxClientSideScan: number,
) => RecordStorage<I, R>;

export type CreateEntityStorage<S extends Message = Message> = <I>(
  input: EntityStorageInput<I, S>,
  client: Datastore,
) => DatastoreEntityStorageHandle<I, S>;

export interface DatastoreStorageFactoryBuilder {
  setClient(client: Datastore): this;

  organizeRecords<R extends Message>(recordType: GenMessage<R>, layout: RecordLayout): this;

  organizeRecords<S extends Message, R extends Message>(
    sourceType: GenMessage<S>,
    recordType: GenMessage<R>,
    layout: RecordLayout,
  ): this;

  useRecordStorage<R extends Message>(
    recordType: GenMessage<R>,
    creator: CreateRecordStorage<R>,
  ): this;

  useRecordStorage<S extends Message, R extends Message>(
    sourceType: GenMessage<S>,
    recordType: GenMessage<R>,
    creator: CreateRecordStorage<R>,
  ): this;

  useEntityStorage<S extends Message>(
    sourceType: GenMessage<S>,
    creator: CreateEntityStorage<S>,
  ): this;

  build(): DatastoreStorageFactory;
}

export class DatastoreStorageFactory extends StorageFactory {
  static newBuilder(): DatastoreStorageFactoryBuilder;
}
```

The read-only `commits` capability is required on the return type of
`CreateEntityStorage`: the factory delegates both ordinary Entity access and
`EntityCommitStorageFactories` creation to the same selected provider handle,
so a custom Entity creator cannot put reads and commits in different layouts.
Closing the internal commit handle closes the selected Entity handle exactly
once.

`DatastoreStorageFactory.create()`, the public constructor,
`DatastoreStorageFactoryInput`, `DatastoreStorageOptions`, and the
`maxClientSideScan` construction option are removed without aliases. The
builder requires one caller-owned client and `build()` rejects its absence
synchronously. The adapter's finite reconciliation bound is the fixed positive
integer `1_000`; every selected record creator receives exactly that number.
Builder setters replace the registration for the same identity, so the last
call wins. `build()` snapshots registrations; later builder changes cannot
alter a built factory.

## Registration And Layout Resolution

Record-only registrations use one type key. For an ungrouped record family the
key is `RecordSpec.sourceType.typeName`; for a grouped family the record-only
fallback key is `RecordSpec.recordType.typeName`. A three-argument registration
is exact only when `StorageGroup.name === sourceType.typeName` and the stored
record type also matches. This mirrors the accepted MySQL contract and lets a
state-type registration address its current records, state history, and event
history without putting the group into `RecordSpec`.

Resolution is deterministic:

1. A source-plus-record `CreateRecordStorage` registration.
2. A record-only `CreateRecordStorage` registration.
3. A source-plus-record `RecordLayout` registration.
4. A record-only `RecordLayout` registration.
5. The default layout.

A selected creator replaces layout resolution and receives the original
`StorageContext`, the already selected `RecordSpec`, the exact builder client,
and `1_000`. A record-only creator intentionally applies to every matching
stored record type. The closure owns any extra distinction it needs. For
default Entity persistence, layouts are honored but record creators are not
mixed into the built-in transaction coordinator; `useEntityStorage()` is the
single coherent replacement hook for an Entity source and wins over all record
layout/creator registrations for that Entity handle.

An ungrouped default kind is exactly `RecordSpec.sourceType.typeName`. A grouped
default kind is `${StorageGroup.name}_${simple RecordSpec.recordType name}`;
dots in the group name remain intact. Thus a state type `example.Task` resolves
to these four default families:

| Family                        | Group          | Kind                        |
| ----------------------------- | -------------- | --------------------------- |
| current Entity                | none           | `example.Task`              |
| retained state history        | `example.Task` | `example.Task_EntityRecord` |
| retained Entity event history | `example.Task` | `example.Task_Event`        |
| Bounded Context Event Store   | none           | `spine.core.Event`          |

The final Event type name is taken from `EventSchema.typeName`; the table uses
`spine.core.Event` only as the currently generated literal. A custom layout
replaces only the kind. Blank kinds and kinds over 1,500 UTF-8 bytes fail before
client activity. Two different explicit registration identities may not claim
the same custom kind, while all families deliberately covered by one
record-only registration share that registration identity and remain separated
by their physical scope. There is no stored layout registry or compatibility
probe.

## Physical Keys, Properties, And `StorageGroup`

Each record is one flat Datastore entity in the tenant namespace. A
single-tenant context uses the client's configured/default namespace; a
multitenant context requires a non-blank `tenantId` and uses it as the
namespace. The entity key has the resolved kind and a collision-free canonical
name containing the context name, tenancy tag, `RecordSpec.sourceType`, the
explicit group-or-ungrouped tag, and the canonical record ID. The key is not a
digest, prefix, truncation, surrogate, or legacy alias. Oversized 1,500-byte key
names fail before RPC.

The entity has only these physical properties:

- `_scope`: the same canonical context/source/group tuple, indexed and included
  in every non-key query;
- `bytes`: the deterministic Protobuf binary for `recordType`, unindexed; and
- one indexed property named exactly after each declared `RecordColumn`.

There is no stored ID copy, column-type marker, schema/layout fingerprint,
metadata entity, revision property, or old-layout pointer. `_scope`, `bytes`,
and `__key__` are reserved and collide with no declared column. Entity current
columns are the generated spec's `archived`, `deleted`, `version`, and declared
state columns. State history stores `entity_id`, `created`, and `version`.
Entity event history stores `entity_id`, `created`, and `version`. Event Store
stores `created` and `type`.

Provider values are selected from `RecordColumn.valueType`: booleans and
strings stay native; `int32`, `int64`, and `bigint` use exact Datastore integer
values; `number` uses a finite Datastore double; bytes use a Datastore blob;
timestamps use a fixed-width, order-preserving native string that retains
seconds and nanos; and `message`/`protobuf` use the existing collision-free
canonical string encoding. `undefined` omits the property and `null` remains
native null. Unsupported, non-finite, out-of-range, or over-1,500-byte indexed
values fail before RPC. Reads decode `bytes` with `recordType` and rematerialize
columns from the decoded record; stored properties exist for provider
filter/order and are never treated as an alternative record payload.

`StorageGroup` never changes `RecordSpec`. It affects exact registration,
default kind, `_scope`, and key identity. Different groups and an ungrouped
family therefore cannot share rows even when a custom record-only layout gives
them the same kind. Disabled histories resolve no layout, invoke no creator,
open no handle, and issue no RPC.

## Entity And Event Layout Behavior

The built-in Entity handle is a thin adapter over the generated record specs:

- current uses the Entity state type as source, generated `EntityRecord` as
  record, no group, and the Entity ID as its Datastore key;
- state history uses `entityStateHistoryRecordSpec(stateSchema)` and its
  generated `EntityStateKey` key;
- diagnostic event history uses
  `entityEventHistoryRecordSpec(stateSchema)` and `EventId`; and
- Event Store remains an independent ungrouped `eventStoreRecordSpec` family.

Current state is loaded only from current `EntityRecord`. Enabled histories are
immutable append families. An absent history key is inserted, identical bytes
are an idempotent no-op, and different bytes at the same key fail. History
reads/maintenance use stable finite keyset pages and provider filters/order;
they do not reintroduce order/cut marker entities. Trim/truncate may commit
several bounded chunks, so completed earlier maintenance chunks remain after a
later failure and an identical retry continues safely.

## Transactions, Atomicity, And Idempotency

`compareAndSet()` reads and conditionally writes/deletes one entity in one
Datastore transaction and remains atomic across compatible handles. The
built-in Entity commit validates every input before RPC, reads every required
current/immutable key before any mutation, then applies current state, enabled
state history, enabled diagnostic history, and Event Store events in one
Datastore transaction. A provider failure rolls the whole unit back; Datastore
has no MySQL-style partial-prefix contract.

Because flat root keys are independent entity groups, one Entity commit is
accepted only when its distinct mutation keys fit both Datastore limits: at
most 25 entity groups and at most 500 mutations. Serialized payload/property
size is preflighted with conservative headroom under the 10 MiB transaction
limit. Limit failures occur before starting a transaction. Empty/duplicate
event IDs, disabled-history rows, mismatched context/source, malformed current
IDs, and divergent immutable collisions also fail before mutations.

The current record comparison has three outcomes:

- current equals `expected`: validate/insert immutable rows and write `next`;
- current equals `next`: validate that every immutable row is identical,
  insert only an absent immutable suffix if encountered, and return
  `"committed"`; or
- current equals neither: mutate nothing and return `"conflict"`.

An identical retry after a lost commit acknowledgement therefore converges to
`"committed"` without a receipt, owner token, claim, or marker. Divergent
immutable content fails. Only provider `ABORTED` conflicts are retried, at most
three total transaction attempts with bounded delay; validation, callback,
permission, malformed-data, and other provider errors are not retried. Every
failed attempt rolls back best-effort before retry/throw. `writeAll()` remains
bounded to provider mutation batches and makes no all-batches atomicity claim.

## Query Pushdown And Finite Overflow

Every query constrains `_scope`. ID equality/finite `IN`, declared-property
comparisons, and order are pushed only when the whole selected conjunction
satisfies Datastore's operator, inequality-column, and first-order rules.
Stable `__key__` order is appended when legal. A limit is pushed only when all
predicates and ordering that affect its result are provider-executed. Masks are
always applied after binary decode.

Nested/`either` predicates or another provider-illegal combination use an
honest finite reconciliation path: push only the legal scope restriction, ask
for `maxClientSideScan + 1`, decode/rematerialize candidates, and run the shared
evaluator locally. Receiving the sentinel throws
`DatastoreQueryLimitError(1_000)` and never returns a partial result. A smaller
explicit `candidateLimit` uses its own `+1` sentinel and preserves the shared
`QueryCandidateLimitError`. Unsupported keyset/continuation combinations fail
before RPC; they are not relabeled as pushdown. There is no unlimited setting,
fallback full scan, provider cursor API, or automatic user-column index.

## Lazy Creation, Lifecycle, And Errors

`build()`, layout resolution, and built-in handle creation perform no network
request. The first operation opens no metadata binding; it directly addresses
the resolved family. Builder/factory configuration and representability errors
are synchronous and occur before RPC. Creator callback errors propagate as
callback errors. Provider operation errors are surfaced through short sanitized
adapter errors that contain no payload, credential, or complete key value.
Malformed stored payloads use one sanitized decode error.

Factory `close()` is idempotent, rejects future storage creation, and never
closes the caller-owned Datastore client. Already-created record/Entity/commit
handles remain independently owned and usable until their own idempotent
`close()`. A closed handle rejects future work before RPC and does not affect
siblings. In-flight operations settle according to the Datastore client; close
adds no cancellation or client shutdown policy.

## Ordered TDD Slices

1. **Builder and resolver.** RED compile/runtime tests freeze every declaration,
   root export, missing-client failure, last-call-wins behavior, registration
   precedence, kind validation/collision behavior, grouped defaults, and old API
   removals. Ownership: factory, resolver/layout module, root exports, compile
   consumer test. Acceptance: exact declarations compile and callback arguments
   are observed without RPC.
2. **Flat record family.** RED fake-client tests freeze keys, namespaces,
   `_scope`/`bytes`/native properties, CRUD, batch boundaries, atomic CAS,
   canonical size failures, corruption redaction, and group/context/tenant
   isolation. Ownership: record codec/storage and focused unit tests.
   Acceptance: no legacy kind/metadata/type-marker entity is written or read.
3. **Finite queries.** RED fake-client and emulator tests freeze legal
   filter/order/ID/limit pushdown, stable key ordering, index errors, local
   reconciliation, both overflow errors, and rejected continuation shapes.
   Ownership: query translation plus focused record/emulator tests.
   Acceptance: every provider operation is either asserted pushdown or named
   finite reconciliation; no unbounded path exists.
4. **Generated Entity families.** RED tests freeze the four kinds above,
   generated keys/properties, custom layouts, `useEntityStorage()` coherence,
   disabled-history non-creation, backward/state-at/trim/truncate behavior, and
   Event Store isolation. Ownership: Entity adapter and history fixtures.
   Acceptance: current/history/Event Store use only their approved generated
   records and no marker/fingerprint layout.
5. **Atomic Entity commit.** RED transaction tests cover success, current
   conflict, concurrent commits, each injected read/write/commit failure,
   rollback, lost acknowledgement, identical retry, divergent immutable
   collision, disabled histories, and 25-group/500-mutation/size preflight.
   Ownership: commit coordinator and focused fake/emulator tests. Acceptance:
   failure leaves no partial unit and no receipt/claim/owner row.
6. **Lifecycle, documentation, and provider matrix.** RED closure/error tests
   precede README/REFERENCE/TSDoc and physical-inspection fixtures. Acceptance:
   the complete emulator matrix passes; bounded live checks run only with
   explicit credentials and record an honest skip otherwise.

One existing implementer owns all overlapping package production files across
these ordered slices. Do not split concurrent writers inside
`packages/storage-datastore/**`.

## Emulator And Live Acceptance Matrix

The required emulator suite covers physical kind/key/property inspection for
all four generated families; record CRUD/batches; same-key CAS races; context,
group, and tenant separation; native filter/order and stable key paging;
finite reconciliation overflow; enabled/disabled history; retention paging;
Event Store separation; atomic multi-family commit/rollback; concurrent
current conflict; idempotent retry; lifecycle; and sanitized corruption/error
paths. Each test uses a unique context/kind namespace and targeted cleanup; it
must not reset shared emulator data.

The optional live suite is bounded to one unique prefix and targeted cleanup.
When credentials are present it checks a physical record layout, one native
filter/order query, one same-key CAS race, one successful and one rolled-back
multi-family Entity commit, tenant namespace isolation, and a real composite-
index failure/success expectation where configured. Emulator evidence is never
replaced by fake-client or live evidence. Missing optional cloud credentials
are a recorded limitation, not a task failure; unavailable required emulator
execution is a verification blocker, not an architecture question.

## Removals And Exclusions

Delete `record-kind.ts` canonical context-derived kinds, every `$SpineEntity*`
fixed/shared kind, binding metadata/fingerprints, entity roots, history
order/cut/reference/revision markers, stored ID copies, column-type properties,
random commit owners, old-layout readers, and receipt/replay behavior. Delete
tests/docs that assert those artifacts; do not retain deprecated exports or
dual-read/write aliases.

Exclude migration/backfill, Firestore Native API, automatic index generation,
an unlimited scan option, a generic public transaction API, client ownership or
shutdown, schema registries, compatibility hashes, Event-sourced current-state
reconstruction, changes outside `packages/storage-datastore/**`, and JVM
builds/edits. Downstream provider consumers remain later Wave 8 ownership.

## Human Blockers

None. The local pinned JVM research notes and the accepted Wave 8 plan are
sufficient; no unresolved choice requires human authority before RED-first
implementation.
