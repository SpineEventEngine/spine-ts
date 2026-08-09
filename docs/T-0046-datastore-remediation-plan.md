# Datastore adapter design and verification

> **Historical and superseded.** This document preserves an earlier correction
> record. Its generic canonical-ID proposal was replaced by the Spine JVM
> `Identifiers`/`Stringifiers` mapping and native Datastore tenant namespaces.
> Use the [current Datastore guide](USER_GUIDE.md#12-develop-with-google-cloud-datastore)
> for supported behavior.

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

### A. Typed storage-slot identity

The final correction follows Spine JVM. A `RecordSpec` declares the ID type.
Primitive IDs use their supported native representation; generated message IDs
use a reversible `Stringifier`, compact Proto JSON by default. The same mapping
is used for Datastore keys, direct lookups, query ID filters, continuations, and
returned `RecordEntry.id` values. Unsupported arbitrary JavaScript values such
as `undefined`, arrays, and untyped objects are rejected.

Tests cover primitive and generated-message IDs, custom stringifiers,
write/query symmetry, copied storage slots, and cross-handle retrieval.

### B. Correct query translation and value semantics

Translate `RecordQuery.ids` with the declared ID mapping and `(column)` filters
with each column's declared mapping. Never compare a generated message value by
JavaScript object identity or by ad hoc `JSON.stringify()`. Equality, ordering,
and continuation values use the same provider representation that was written.

Tests cover scalar/list ID filters, generated-message columns, numeric order,
ascending/descending ties, and continuations.

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

- CRUD, typed IDs, copied slots, and tenant namespaces;
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
