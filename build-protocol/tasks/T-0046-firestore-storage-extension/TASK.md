# T-0046: Firestore-compatible storage extension

Status: Adapter closure verification in progress; follow-on load-test example pending

## Objective

Implement a separate Firestore-compatible storage package using the analysis in
[`docs/firestore-storage-extension-analysis.md`](../../../docs/firestore-storage-extension-analysis.md)
and the pinned JVM `gcloud-jvm/datastore` source as the compatibility authority.

## Human-Imposed Requirements Ledger

- The adapter package is named `@spine-ts/storage-datastore`, matching the JVM
  module and Cloud Datastore terminology; no `storage-firestore` package is
  introduced.
- Target the Cloud Firestore Datastore-compatible model, not Firestore Native
  mode.
- Inspect and pin the latest JVM `gcloud-jvm/datastore` source before deciding
  TypeScript behavior, configuration, credentials, testing, or portability.
- Produce a detailed, implementation-ready plan before any module code; the
  implementer must execute that plan without making significant architectural
  decisions.
- Preserve the JVM principle that storage is a port: applications can select a
  Datastore adapter or another `StorageFactory` without domain/framework code
  depending on a concrete persistence provider.
- Determine emulator testing and production credential/configuration patterns
  from the JVM module first.
- Do not modify the protected `human-review-1-jul.md`.
- The human approved a minimal provider-neutral `RecordSpec` read-only schema
  accessor, because external storage adapters need the existing Protobuf schema
  to encode and decode records. It must expose no Datastore types or behavior.
- After the adapter is ready, add a separate test-oriented orders/SKUs/sales
  example with exactly 2 aggregates, 2 process managers, 10 projections, and
  independent gRPC performance scenarios at 10, 100, and 1,000 users.

## Planning assignment

- Existing role: `requirements_splitter` acting as the requested
  architect-planner.
- Scope: source-grounded storage-port compatibility analysis and a phased
  implementation plan only; no production implementation.
- Expected model/reasoning: `gpt-5.6-sol` / `high`.
- Acceptance requires explicit dispatch fields and runtime metadata matching
  the expected profile, recorded in the work log before the plan is accepted.

## Required sequence

1. Pin and inspect the JVM module; produce a mapping/compatibility matrix.
2. Confirm the TS storage seam is sufficient without expanding core exports.
3. Design key, tenant, serialization, query, cursor, transaction, CAS, batch,
   retry, and close semantics.
4. Write emulator-first RED tests, implement the adapter, and add opt-in cloud
   verification only if credentials are available.
5. Run canonical docs/API/type/reliability review and record exclusions.

## Accepted implementation contract

`docs/firestore-storage-extension-analysis.md` is the binding plan. It was
written from the pinned JVM source after the architect-planner child did not
return a usable result. Implementation must follow its package boundary,
configuration, namespace, codec, query, CAS, batch, emulator, credential, and
documentation decisions without widening the generic storage port.

## Current implementation boundary

- The human-approved `RecordSpec.schema` accessor is available in the current
  worktree. It is the only generic-storage change authorized for this adapter;
  preserve the existing edit and make no further generic storage or server
  changes without explicit human approval.
- The current owner writes only `packages/storage-datastore/**`,
  `docs/USER_GUIDE.md`, and T-0046 durable task/work/review records. The
  orders/SKUs/sales example begins only after adapter readiness evidence is
  recorded.
- Runtime changes follow behavior-focused TDD: each adapter behavior requires
  focused RED evidence before its minimal implementation and focused GREEN
  evidence after it.

## Non-goals

No replacement of the in-memory adapter, no Firestore-specific APIs in the
generic storage package, no implicit credentials, and no claim of transparent
cross-adapter transaction semantics until proven by tests.
