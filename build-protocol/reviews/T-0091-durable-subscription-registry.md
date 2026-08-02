# T-0091 Review Record

Status: Wave 1 findings accepted; correction in progress

## Required Concerns

- Style/maintainability: required for the public async contract and new durable
  binding/codec structure.
- Documentation: required for public production configuration, durability, and
  limitation claims.
- TypeScript/API docs: required for binding capabilities, options, exports,
  compatibility, TSDoc, and declaration shape.
- Performance/reliability: required for async reservation, persistence,
  restart, CAS compatibility, finite limits, close, and fail-closed behavior.
- Final security: deferred to the existing T-0089 Wave 5 release gate; no new
  role is introduced. This task must still test private-byte non-disclosure and
  principal/tenant/session ownership.

Expected reviewer models/reasoning are recorded in the task before dispatch.
Actual runtime metadata will be recorded when exposed; otherwise the immutable
configured role/profile and limitation are the acceptance evidence.

## Planned Review Wave

- Existing `style_maintainability_reviewer`, expected
  `gpt-5.6-terra` / high.
- Existing `documentation_reviewer`, expected `gpt-5.6-luna` / medium.
- Existing `typescript_api_docs_reviewer`, expected
  `gpt-5.6-terra` / high.
- Existing `performance_reliability_reviewer`, expected
  `gpt-5.6-terra` / high.

Every dispatch must explicitly supply its recorded model and reasoning. The
complete wave will be collected before one correction batch is accepted.

## Wave 1 Dispatches

The complete implementation endpoint is `4db3628f`.

- Existing `style_maintainability_reviewer`; scope: the binding-contract
  evolution, registry/codec depth, naming, ownership, standalone-function
  discipline, test maintainability, and avoidance of B2 abstractions. Expected
  `gpt-5.6-terra` / high.
- Existing `documentation_reviewer`; scope: server README/reference and API
  audience claims for production configuration, durability, local behavior,
  restart limits, and private data. Expected `gpt-5.6-luna` / medium.
- Existing `typescript_api_docs_reviewer`; scope: public bindings capability,
  options/exports, awaitable compatibility, declarations/TSDoc, storage
  ownership, and later standalone-host reuse. Expected
  `gpt-5.6-terra` / high.
- Existing `performance_reliability_reviewer`; scope: exact-once async
  reservation, persistence/CAS compatibility, byte ownership and limits,
  restart/close, malformed state, production fail-closed timing, and provider
  behavior. Expected `gpt-5.6-terra` / high.

Every dispatch explicitly supplies its expected model and reasoning. Runtime
self-introspection will be recorded when exposed; otherwise the immutable
configured role/profile and limitation are the acceptance evidence.

## Wave 1 Runtime Evidence

- Style/maintainability completed under the explicitly configured existing
  reviewer with `gpt-5.6-terra` / high.
- Documentation completed under the explicitly configured existing reviewer
  with `gpt-5.6-luna` / medium.
- TypeScript/API docs completed under the explicitly configured existing
  reviewer with `gpt-5.6-terra` / high.
- Performance/reliability completed under the explicitly configured existing
  reviewer with `gpt-5.6-terra` / high.

Runtime self-introspection was unavailable in all lanes; the immutable
configured role/profile is the available metadata. No visible mismatch or
fallback occurred, so every result is accepted.

## Wave 1 Accepted Finding Batch

1. Move production durability admission ahead of every native/public listener
   open. Add a `Server` integration regression proving missing or volatile
   bindings reject without reaching listener creation; preserve explicit local
   in-memory acceptance.
2. Introduce the smallest explicit provider capability that proves atomic
   `compareAndSet()` compatibility, reject incompatible registry storage
   during construction/open, and stop misreporting unsupported CAS as an ID
   collision.
3. Preserve absent-versus-unauthorized ownership semantics: a foreign
   principal/tenant/session cancel must be denied, not reported closed/success.
4. Accept only a live reservation owned by the same registry, or recheck
   capacity atomically before creation. Cover forged, released, and
   other-registry reservations so no path bypasses the finite record limit.
5. Replace unbounded namespace materialization for admission and cleanup with
   provider-bounded queries capped by `recordLimit + 1` and the cleanup batch.
   Test provider scan bounds and overfull storage.
6. Persist and validate explicit encoded-byte accounting. Reject accounting
   mismatches and round-trip the frozen field needed by later reconciliation.
7. Require canonical Base64 for stored private payloads and enforce the
   configured record-byte bound in index/extract paths. Tampered payloads must
   fail before any backend callback without exposing private bytes.
8. Document the durability capability contract rather than requiring class
   identity. Present `DurableSubscriptionBindings` as the provided
   implementation while allowing compatible declared capabilities for later
   standalone hosting.
9. Document namespace isolation, units, finite constructor validation, and the
   direct restart limitation: records survive, active streams do not resume,
   updates are not replayed, and neither exactly-once delivery nor global
   ordering is guaranteed.
10. Remove internal Wave/task roadmap wording from public package reference
    documentation.

The same implementation owner receives this one complete batch. Focused TDD
must cover findings 1–7. Re-review will be restricted to concerns materially
changed by the corrections.

## Wave 1 Correction Dispositions

1. Accepted and corrected: `Server` validates production browser durability
   before contexts or either listener open; local in-memory assembly remains
   available.
2. Accepted and corrected: `RecordStorage.atomicCompareAndSet` is the explicit
   provider capability and durable construction rejects `false`.
3. Accepted and corrected: foreign owner cancellation returns `denied`; absent
   and expired records remain `closed`.
4. Accepted and corrected: only an unreleased reservation in the registry's
   own reservation set is trusted; all other input rechecks bounded capacity.
5. Accepted and corrected: admission uses `recordLimit + 1` and expiry uses
   `cleanupBatchSize` through bounded provider queries.
6. Accepted and corrected: canonical encoded-byte accounting is persisted and
   validated before private bytes reach a callback.
7. Accepted and corrected: canonical Base64 and configured byte bounds apply
   to dynamic record-spec extraction and every registry read.
8. Accepted and corrected: public prose describes a declared durable
   capability, with `DurableSubscriptionBindings` as the supplied implementation.
9. Accepted and corrected: package documentation now states namespace,
   units, finite validation, restart, stream, replay, ordering, and
   exactly-once limitations.
10. Accepted and corrected: public reference text no longer names internal
    task or wave roadmap terminology.

Correction verification is recorded in the T-0091 work log. Re-review is
limited to style/maintainability, documentation, TypeScript/API, and
performance/reliability because all four concerns changed substantively.

## Wave 2 Dispatches

The correction endpoint is `503c5074`.

- Existing `style_maintainability_reviewer`; scope: storage capability
  placement/default, revised binding cohesion, bounded-query reuse, ownership
  result shape, and corrected regressions. Expected `gpt-5.6-terra` / high.
- Existing `documentation_reviewer`; scope: corrected capability, namespace,
  units, validation, restart/stream limitation, and roadmap-free prose.
  Expected `gpt-5.6-luna` / medium.
- Existing `typescript_api_docs_reviewer`; scope: new public
  `RecordStorage.atomicCompareAndSet`, declarations/TSDoc/compatibility,
  capability-vs-class contract, and pre-listener Server admission. Expected
  `gpt-5.6-terra` / high.
- Existing `performance_reliability_reviewer`; scope: all seven behavioral
  corrections, especially capability truthfulness, bounded provider work,
  reservation provenance, malformed records, accounting, and race-safe
  fail-closed behavior. Expected `gpt-5.6-terra` / high.

Every dispatch explicitly supplies its expected model and reasoning. Runtime
self-introspection will be recorded if exposed; otherwise the immutable role
profile and limitation remain the acceptance evidence.

## Wave 2 Results

- Style/maintainability: one P1 capability-default defect and two P2 missing
  regression cases under the explicitly configured existing reviewer with
  `gpt-5.6-terra` / high.
- Documentation: one P2 and two P3 public-TSDoc gaps under the explicitly
  configured existing reviewer with `gpt-5.6-luna` / medium.
- TypeScript/API docs: one P1 capability-default defect and one P2 stale TSDoc
  claim under the explicitly configured existing reviewer with
  `gpt-5.6-terra` / high.
- Performance/reliability: four P1 defects and one P2 missing integration
  regression under the explicitly configured existing reviewer with
  `gpt-5.6-terra` / high.

Runtime self-introspection was unavailable in all lanes; the immutable
configured role/profile remains the metadata evidence. No visible mismatch or
fallback occurred, so every result is accepted.

## Final Correction Batch

1. Make atomic CAS capability opt-in. `RecordStorage` defaults false (or is
   abstract), and the proven in-memory, Datastore, and MySQL implementations
   explicitly declare true. Align storage reference/API claims and test that a
   provider which does not opt in is rejected without mutating a normally
   capable handle.
2. Consume a live reservation synchronously before the first `create()` await.
   Add separate forged, released, live-foreign, and concurrent same-token
   tests; one reservation can admit at most one record.
3. Preserve requested finite query limits in Datastore provider pushdown rather
   than replacing them with the generic scan cap. Test the actual provider
   query limit for admission and cleanup, `recordLimit + 1`, and an overfull
   namespace.
4. Validate every bounded admission entry through the configured codec before
   counting it. A seeded malformed, noncanonical, oversized, wrong-key, or
   accounting-mismatched row must make reservation fail closed.
5. Add a full `Server.start()` production regression that proves missing or
   volatile bindings reject before context assembly and listener creation;
   keep the explicit local in-memory case.
6. Correct public TSDoc to require durable-capable bindings rather than class
   identity; document namespace isolation and invalid-constructor rejection;
   and state that records survive process restarts while active streams do not
   resume/replay and have no exactly-once or global-order guarantee.

This is the final specialist finding batch. The same implementation owner must
add focused RED/GREEN evidence and keep changes within the approved B1
boundary. After correction, the orchestrator will directly inspect these exact
regressions and public claims, run deterministic preflight and `verify:release`,
and close the slice without a third broad reviewer wave unless the public
contract changes again.
