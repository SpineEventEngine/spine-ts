# Firestore-compatible storage extension

> **Historical and superseded.** This analysis preserves earlier design evidence
> and is not an implementation guide. For the supported adapter behavior, use
> the [current Datastore guide](USER_GUIDE.md#12-develop-with-google-cloud-datastore).

## Reference and scope

The requested compatibility target is the JVM Datastore/Firestore module in
[`SpineEventEngine/gcloud-jvm/datastore`](https://github.com/SpineEventEngine/gcloud-jvm/tree/master/datastore).
The latest available default-branch source was pinned at
`f4ade19d8bf7666447f068607426475cda485afe` on 2026-07-18. The proposal below is
archived design history. Current behavior is summarized here so readers do not
mistake rejected ideas for the supported layout.

## Implemented outcome

Create `@spine-event-engine/storage-datastore`, depending on `@spine-event-engine/storage` and the
official Google Cloud Datastore Node client. It implements `StorageFactory` and
`RecordStorage` without changing the storage package’s public contracts. It
targets Firestore in Datastore mode through the Datastore client API; it does
not support Firestore Native APIs.

Current mapping:

- a Bounded Context name is diagnostic and never changes physical storage;
- the source Proto type selects the default kind, while an optional
  `StorageGroup` selects a separate family;
- a complete multitenant `StorageContext.tenantId` selects a native Datastore
  namespace; a single-tenant context uses the client namespace;
- each record occupies one Datastore entity whose key name uses the declared
  primitive ID or reversible message stringifier;
- the Protobuf binary payload is canonical; declared `RecordColumn` values are
  stored as indexed Datastore properties through the same typed mapping used by
  Query operands;
- `RecordQuery` supports exact ID filters, equality / small-set column filters,
  deterministic declared-column or ID ordering, limits, offsets, and keyset
  continuations. Unsupported value types or query combinations fail before RPC;
- `compareAndSet` uses a Datastore transaction that reads the entity, compares
  canonical payload bytes, then writes or deletes atomically;
- `writeAll` uses bounded Datastore mutation groups and surfaces partial-failure
  uncertainty rather than silently retrying a non-idempotent write;
- `index()` derives logical IDs only from fetched record bodies, preserving the
  existing `RecordStorage` contract;
- factory and storage close states are local guards. Closing does not close an
  injected shared client, matching the JVM factory's non-owning lifecycle.

## Compatibility matrix

| JVM pattern                                                    | TS decision                                                                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DatastoreStorageFactory` is an injected `StorageFactory`      | Applications pass it to `withStorageFactory()` or configure it through `ServerEnvironment.when(EnvironmentType.Production).use(...)`; core packages never import it.                                   |
| Caller supplies `Datastore`; builder exposes provider settings | `DatastoreStorageFactory.newBuilder().setClient(client).build()` accepts a caller-owned client. Authentication, endpoint, project, and client lifecycle stay with the application.                     |
| Namespace conversion isolates tenants                          | `StorageContext.tenantId` selects namespace only for multitenant storage; missing/blank tenant IDs fail before RPC. A configured namespace is a prefix/default, never concatenated into document keys. |
| Record type has a kind/layout and indexed columns              | One flat entity stores authoritative `bytes` and declared properties. Source type and optional `StorageGroup` select the family; `organizeRecords()` may replace the kind.                             |
| Optional transaction setting per record                        | Every TS `compareAndSet` is transactional because the existing port promises cross-handle atomic CAS. Normal reads/writes use direct API calls; no generic transaction API leaks into storage.         |
| Docker/Testcontainers emulator tests                           | The opt-in integration suite requires an already-running Datastore-mode emulator through `DATASTORE_EMULATOR_HOST`; unit tests use a narrow client fake. Current CI integration is not claimed.        |
| Explicit service-account remote client                         | Production uses explicit client options or an injected client; ADC remains a documented client-library option, never an implicit module policy.                                                        |

## Adapter design

### Package and provider boundary

1. Add `packages/storage-datastore` to the pnpm workspace and root TypeScript
   references. Add the official `@google-cloud/datastore` dependency only to
   this package.
2. Export only `DatastoreStorageFactory`, its narrowly typed construction
   options, and documented emulator helpers if tests require them. Do not
   re-export Google client types from `@spine-event-engine/storage`.
3. Add a composition example showing the application selects
   `new DatastoreStorageFactory({ client })` through the existing
   `withStorageFactory()` port and can replace it with
   `InMemoryStorageFactory` without changing handlers, aggregates, or server
   APIs.

### Deterministic entity codec

1. Implement private kind, namespace, key, payload, and column codecs.
2. Encode only supported primitive/indexable column values; reject undefined,
   functions, cyclic values, and unsupported object shapes before RPC. Keep
   payload binary and metadata names private/reserved.
3. Deserialize through the `RecordSpec` schema and reject malformed or
   incompatible entities with redacted errors that include neither payload nor
   credentials.
4. Test codec determinism, tenant separation, key collision resistance,
   column mapping, and malformed-data failures without an emulator.

### `RecordStorage` behavior

1. Implement read, write, delete, and independently opened-handle visibility.
2. Implement query translation, stable tie-breaking by key, continuation
   handling, limits/offsets, IDs, equality filters, and masks through the
   inherited base behavior.
3. Implement transactional CAS, including create-if-absent, exact expected
   payload matching, conditional delete, and concurrent-race tests.
4. Implement bounded `writeAll` with documented group size and deterministic
   input materialization. Do not claim all-or-nothing semantics across groups.

### Emulator and cloud verification

1. Add an opt-in emulator test command that requires `DATASTORE_EMULATOR_HOST`
   pointing at an already-running Firestore emulator in Datastore mode. Each
   scenario uses a unique kind and targeted cleanup so it does not reset or
   delete unrelated shared-emulator data. The repository does not currently
   start the emulator or claim CI integration.
2. Cover CRUD, query/order/continuation/offset, tenant isolation, CAS races, batch
   boundaries, factory/storage closure, bad entities, and index-required query
   documentation.
3. Add a separately named, credential-gated smoke command. It never runs by
   default, requires explicit project/database/client configuration, and
   creates only a unique disposable kind. It cleans up in `finally`.
4. Document emulator limitations: it does not prove production composite
   indexes, transaction limits, or all concurrency/consistency behavior.

### Documentation and verification

1. Document credentials, injected clients, explicit Google options, ADC,
   emulator variables, index deployment, tenant namespace behavior, limits,
   errors, and lifecycle ownership in the package README and user guide.
2. Run focused mechanical checks, all four canonical review concerns, and a
   persistence/security review because this module handles credentials and
   atomic state.
3. Merge only after emulator evidence, type/API docs, generated-clean checks,
   and the full release gate pass. Record any unavailable cloud credentials as
   an explicit limitation, not a passing cloud test.

## Implementer decision boundary

The implementer owns mechanical TypeScript code and tests only. It must not:

- change `StorageFactory`, `RecordStorage`, `RecordQuery`, or server public
  contracts merely to fit Datastore;
- introduce Firestore Native, ORM, repository, global-default, generic
  transaction, or credential singleton APIs;
- decide a new wire format, tenant model, retry policy, or query operator
  beyond the decisions above;
- claim production cloud compatibility from emulator results alone.

## Resolved JVM inspection questions

The JVM adapter uses the Datastore client and provides index definitions for
both Datastore native and Firestore-in-Datastore-mode deployments. It injects a
client, maps tenants to namespaces, stores Protobuf records with indexed
columns, offers per-record transactions/configuration, and tests with a
Docker-backed emulator. Its remote test helper accepts explicit service-account
credentials. TS deliberately starts with the smaller flat-entity adapter while
preserving the same port and configuration principles.

## Resolved outcome

The corrected adapter targets JVM-compatible physical values: native tenant
namespaces, source/group kinds, direct primitive IDs, reversible compact Proto
JSON message IDs, native scalar properties, and the same typed mapping for
writes and queries. Existing experimental layouts still require an offline
migration; the runtime has no dual reader. Index manifests remain
application/deployment assets. Cross-record public transaction APIs, generic
retry policy, and automatic cloud cleanup remain intentionally absent.

## Acceptance criteria for the implementation task

- all existing storage tests pass against the in-memory adapter unchanged;
- Firestore adapter passes record CRUD, query, tenant isolation, continuation/offset,
  uniqueness, CAS race, batch, retry, close, and malformed-record tests;
- emulator tests are repeatable and real-cloud tests are explicitly opt-in;
- no Firestore dependency or adapter type leaks into `@spine-event-engine/storage`;
- package README documents indexes, consistency, limits, credentials, emulator,
  failure semantics, and unsupported query features;
- JVM source mapping and any intentional incompatibilities are recorded in a
  compatibility matrix.
