# @spine-event-engine/storage reference

This reference is for agents working with the Spine TS storage contract.

## Public entry point

Import public types from `@spine-event-engine/storage`. The entry point exports
`StorageFactory`, `RecordStorage`, `RecordSpec`, `RecordColumn`, `RecordQuery`,
`RecordMask`, `InMemoryStorageFactory`, `InMemoryStorageBackend`, event-store
types, normalized query policy/evaluator types, and entity history interfaces.
The `./internal/entity-history` subpath supplies Entity records, ID/layout
inputs, and current/state/event-history ports. The separate
`./internal/entity-commit` subpath supplies atomic commit input/result types,
`EntityCommitStorage`, and `EntityCommitStorageFactories`; both are
framework/provider seams, not application-facing remote APIs.

## Record storage

`StorageFactory.createRecordStorage(context, spec)` returns an independently
closeable `RecordStorage`. A context contains a bounded-context name,
multitenancy flag, and optional tenant ID. A `RecordSpec` fixes the Protobuf
schema, storage key, identity extractor, ID schema or primitive ID kind, and
materialized columns. Generic durable providers key their physical scope by the
backend, context name, tenancy mode, tenant slice, and `RecordSpec.storageKey`;
the schema is codec metadata rather than scope identity. Application and
framework code must reuse a storage key for one logical scope.

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
than a plan's `candidateLimit`, `QueryCandidateLimitError` is thrown before
local materialization can return a partial semantic result.

`StorageQueryPolicy` validates normalized plans and
`StorageQueryEvaluator` applies the portable query semantics. Provider packages
can push down supported parts of a plan, but must preserve these semantics and
enforce their documented bounds.

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

The `internal/entity-history` seam supplies current state plus immutable state
and event history for framework repositories. The separate
`internal/entity-commit` port is the only way repositories combine current
state, retained histories, framework delivery events, and a commit receipt.
Standalone EventStore and history operations stay separate operations; they
are not a substitute transaction boundary.
