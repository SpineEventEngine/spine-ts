# Datastore adapter design and verification

## Purpose

This guide records the supported behavior of
`@spine-event-engine/storage-datastore`, informed by a JVM comparison at
`gcloud-jvm` commit `f4ade19d8bf7666447f068607426475cda485afe`, and the
query, identity, emulator, documentation, and example-coverage work. The
package remains Firestore in Datastore mode only.

## Scope separation

The adapter package is the production deliverable. The Orders app is
a test-oriented application that proves generic storage composition and gRPC
load behavior; it is not itself an adapter behavior. Its load runner follows
the same cancellation and cleanup rules as other local examples.

## Supported behavior

1. **Finite query materialization.** The adapter translates ID/column filters and order
   to Datastore, always fetches with a fixed `maxClientSideScan + 1` sentinel,
   and performs typed continuation, deterministic ID tie-breaking, offset, and
   requested-limit reconciliation once locally. A sentinel response throws
   `DatastoreQueryLimitError` without a partial result. There is no unlimited
   setting or new generic cursor API.
2. **Indexed bigint.** The adapter accepts only exact signed 64-bit Datastore
   integers (`-2^63` through `2^63 - 1`) for indexed bigint values and rejects
   out-of-range values before any RPC.
3. **Example cancellation.** The Orders load runner passes a per-user abort
   signal to every RPC and bounds cleanup of subscription iterators.

## Non-negotiable corrections

### A. Canonical storage-slot identity

Replace `JSON.stringify()` as the Datastore key/name and `$spine.id` codec.
Adopt one canonical, reversible identifier normalization aligned with the
existing in-memory `RecordStorage` behavior. It must:

- preserve primitive values, `bigint`, `undefined`, arrays, objects, and
  copied storage slots without collisions;
- be independent of object insertion order where the generic port treats IDs
  as equal;
- use the caller-provided storage slot, never an identifier extracted from the
  record payload;
- encode the same value for Datastore keys, persisted metadata, ID lookups,
  query ID filters, continuations, and returned `RecordEntry.id` values.

Tests: bigint and undefined-bearing IDs, object-order/collision cases,
copied-slot CAS write/read/query behavior, and cross-handle retrieval.

JVM reference: `DsEntitySpec.keyOf()` delegates identity to record layout;
`RecordId.ofEntityId()` uses Spine `Stringifiers`, not JSON serialization.

### B. Correct query translation and value semantics

Translate `RecordQuery.ids` and `filters: [{ column: "id", ... }]` using the
same Datastore key codec. Never send a raw logical ID to `__key__`.

Replace string coercion in equality, ordering, continuation comparison, and
filter matching with a type-preserving comparison strategy. Numeric values
must sort numerically; `bigint` must either be supported consistently through
the Datastore mapping or rejected before RPC everywhere.

Tests: scalar/list ID filters, structured IDs, numeric `2` versus `10`,
boolean/null behavior, bigint behavior, ascending/descending ties, and
continuations.

JVM reference: ID lookups build Datastore `Key` objects in `DsLookupByIds`;
`DsEntityComparator` compares native typed Datastore values.

### C. Bounded query execution

The query policy is implemented with a positive finite
`maxClientSideScan` configuration, defaulting to `1000`. ID constraints become
Datastore key filters; supported column equality filters and requested order
become provider filters and orders. The provider request always has the fixed
limit `maxClientSideScan + 1`, independent of the caller's requested result
limit.

The adapter then performs typed continuation comparison, deterministic ID
tie-breaking, offset, and requested-limit slicing exactly once locally. A
response containing the sentinel row proves the finite budget was exhausted;
the adapter throws `DatastoreQueryLimitError` and exposes no partial page. An
application can configure a larger finite budget or issue a narrower query,
but cannot select an implicit unlimited scan or provider cursor through the
generic storage contract.

### D. CAS and lifecycle hardening

Retain transactional compare-and-set and add failure-path tests: create,
replace, delete, stale expected value, copied slot, commit failure, rollback
failure, and no payload/credential leakage in errors. Verify factory and
storage close behavior remains local and does not close an injected client.

### E. Emulator-first adapter verification

Expand the Datastore-mode emulator suite to cover:

- CRUD, canonical IDs, copied slots, and tenant namespaces;
- scalar/list ID filters, typed column filters, typed order, limits, offsets,
  and continuations;
- scan-budget enforcement and provider-side page bounds;
- CAS races and transactional failure handling where emulator behavior allows;
- `writeAll` boundary/partial-failure semantics, malformed entities, factory
  and storage closure, and index-required query documentation.

The credential-gated cloud smoke remains separate and is not counted as passed
without explicit project credentials.

JVM reference: its `@EmulatorTest` suite covers record storage, indexes,
tenant namespaces, transactions, aggregate storage, and delivery behavior.

### F. TypeScript API documentation

Add `packages/storage-datastore/src/index.ts` to TypeDoc entry points and API
checks. Document all public adapter construction options, ownership rules,
credentials/ADC, emulator variables, namespace isolation, indexed-column and
index-deployment requirements, supported query semantics, scan limits, CAS,
batch partial failures, and close behavior.

This is not a comparison with JVM documentation. JVM was consulted only as a
behavioral reference. The TypeScript package requires its own complete,
validated TypeDoc and user-facing documentation.

### G. Orders example load runner

The load runner is not Datastore persistence code. It is an
acceptance/performance specimen, so its resource handling affects whether that
specimen can be trusted.

Every command, query, and subscription
RPC receives a per-user abort signal; timeout aborts the underlying request,
not merely the awaiting promise. Transport-observed tests prove timed-out unary
calls leave no active work in the shared HTTP/2 pool. The runner source is
directly instrumented, and the obsolete broad source exclusions were removed.
This example concern remains separate from adapter persistence correctness.

## Verification

The adapter is exercised through focused codec, query, transaction, lifecycle,
and emulator tests. The emulator checks Firestore in Datastore mode, while a
credential-gated cloud smoke check remains separate because it needs explicit
project credentials. TypeDoc/API checks and the package README document the
public construction, ownership, and failure contracts.
