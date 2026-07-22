# Firestore-compatible storage extension

Status: implementation plan accepted for execution

## Reference and scope

The requested compatibility target is the JVM Datastore/Firestore module in
[`SpineEventEngine/gcloud-jvm/datastore`](https://github.com/SpineEventEngine/gcloud-jvm/tree/master/datastore).
The latest available default-branch source was pinned at
`f4ade19d8bf7666447f068607426475cda485afe` on 2026-07-18. This document is
the decision-complete implementation contract derived from that source and the
current TS storage port.

## Proposed module

Create `@spine-ts/storage-datastore`, depending on `@spine-ts/storage` and the
official Google Cloud Datastore Node client. It implements `StorageFactory` and
`RecordStorage` without changing the storage package’s public contracts. It
targets Firestore in Datastore mode through the Datastore client API; it does
not support Firestore Native APIs.

Mapping proposal:

- bounded-context name becomes a validated Datastore kind prefix; each
  `RecordSpec` contributes a stable record-type suffix;
- a multitenant `StorageContext.tenantId` becomes the Datastore namespace;
  a single-tenant context uses the configured default namespace;
- each record occupies one Datastore entity whose key name is a canonical,
  reversible encoding of the storage slot identifier;
- the Protobuf binary payload is canonical; declared `RecordColumn` values are
  stored as indexed Datastore properties, with reserved metadata property names
  isolated from user columns;
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

| JVM pattern                                                    | TS decision                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DatastoreStorageFactory` is an injected `StorageFactory`      | Historical T-0046 proposal: apps could pass it to `withStorageFactory()` or the then-proposed `ServerEnvironment.production()`. The current T-0055 API instead configures `ServerEnvironment.when(EnvironmentType.Production).use(...)`; core packages never import it. |
| Caller supplies `Datastore`; builder exposes provider settings | Primary constructor accepts an injected Node `Datastore` client. `DatastoreStorageFactory.create(options)` creates a client from explicit Google client options, including project, credentials, key file, endpoint, and namespace settings.                            |
| Namespace conversion isolates tenants                          | `StorageContext.tenantId` selects namespace only for multitenant storage; missing/blank tenant IDs fail before RPC. A configured namespace is a prefix/default, never concatenated into document keys.                                                                  |
| Record type has a kind/layout and indexed columns              | One flat entity per record in the first release. Kind naming and metadata are private adapter details. `RecordSpec` columns map to indexed properties; no entity-group/custom-layout API is added until a TS port requires it.                                          |
| Optional transaction setting per record                        | Every TS `compareAndSet` is transactional because the existing port promises cross-handle atomic CAS. Normal reads/writes use direct API calls; no generic transaction API leaks into storage.                                                                          |
| Docker/Testcontainers emulator tests                           | The opt-in integration suite requires an already-running Datastore-mode emulator through `DATASTORE_EMULATOR_HOST`; unit tests use a narrow client fake. Current CI integration is not claimed.                                                                         |
| Explicit service-account remote client                         | Production uses explicit client options or an injected client; ADC remains a documented client-library option, never an implicit module policy.                                                                                                                         |

## Detailed implementation plan

### Phase 1 — package and provider boundary

1. Add `packages/storage-datastore` to the pnpm workspace and root TypeScript
   references. Add the official `@google-cloud/datastore` dependency only to
   this package.
2. Export only `DatastoreStorageFactory`, its narrowly typed construction
   options, and documented emulator helpers if tests require them. Do not
   re-export Google client types from `@spine-ts/storage`.
3. Add a composition example showing the application selects
   `new DatastoreStorageFactory({ client })` through the existing
   `withStorageFactory()` port and can replace it with
   `InMemoryStorageFactory` without changing handlers, aggregates, or server
   APIs.

### Phase 2 — deterministic entity codec

1. Implement private kind, namespace, key, payload, and column codecs.
2. Encode only supported primitive/indexable column values; reject undefined,
   functions, cyclic values, and unsupported object shapes before RPC. Keep
   payload binary and metadata names private/reserved.
3. Deserialize through the `RecordSpec` schema and reject malformed or
   incompatible entities with redacted errors that include neither payload nor
   credentials.
4. Test codec determinism, tenant separation, key collision resistance,
   column mapping, and malformed-data failures without an emulator.

### Phase 3 — `RecordStorage` behavior

1. Implement read, write, delete, and independently opened-handle visibility.
2. Implement query translation, stable tie-breaking by key, continuation
   handling, limits/offsets, IDs, equality filters, and masks through the
   inherited base behavior.
3. Implement transactional CAS, including create-if-absent, exact expected
   payload matching, conditional delete, and concurrent-race tests.
4. Implement bounded `writeAll` with documented group size and deterministic
   input materialization. Do not claim all-or-nothing semantics across groups.

### Phase 4 — emulator and cloud verification

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

### Phase 5 — docs, review, and release evidence

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

## Deferred decisions

This is behaviorally compatible, not wire-compatible with JVM storage entities:
the two runtimes may share Datastore only after a separately approved migration
contract. Index manifests remain application/deployment assets; generation from
`RecordSpec` is deferred. Cross-record transaction APIs, retry policy, and
automatic cloud cleanup are intentionally absent. Payloads, credential values,
and full entity paths are redacted from thrown adapter errors.

## Acceptance criteria for the implementation task

- all existing storage tests pass against the in-memory adapter unchanged;
- Firestore adapter passes record CRUD, query, tenant isolation, continuation/offset,
  uniqueness, CAS race, batch, retry, close, and malformed-record tests;
- emulator tests are repeatable and real-cloud tests are explicitly opt-in;
- no Firestore dependency or adapter type leaks into `@spine-ts/storage`;
- package README documents indexes, consistency, limits, credentials, emulator,
  failure semantics, and unsupported query features;
- JVM source mapping and any intentional incompatibilities are recorded in a
  compatibility matrix.
