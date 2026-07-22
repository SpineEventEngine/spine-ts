# T-0057 Projection Query Review

Status: Reviewed — all required concerns accepted

Baseline: `eb810f48`

## Required Concerns

- TypeScript/API: schema-column-value-operator typing, compile-negative
  contracts, frozen Protobuf compilation, stable public declarations, and
  Projection-only targeting.
- Documentation: current compile-covered DSL, result, adapter, limitation, and
  error examples with no premature T-0058 client-facade claims.
- Style/maintainability: one normalized policy/conversion path, no duplicated
  adapter policy, minimal public surface, parameterized SQL, and clear module
  ownership.
- Performance/reliability: bounded predicate traversal/materialization,
  deterministic repeated ordering and ID tie-breaks, tenant isolation,
  cancellation/cleanup, Datastore overflow, and provider conformance.
- Security: initially N/A because the QueryService trust boundary already
  exists and this packet should tighten its validation; reopen if implementation
  creates a new input, credential, dynamic-SQL, or network boundary. T-0067
  retains final Wave 1 security ownership.

## Specialist Assignment Gate

- Existing `typescript_api_docs_reviewer`: explicit
  `gpt-5.6-terra` / `high`.
- Existing `documentation_reviewer`: immutable
  `gpt-5.6-luna` / `medium`.
- Existing `style_maintainability_reviewer`: explicit
  `gpt-5.6-terra` / `high`.
- Existing `performance_reliability_reviewer`: explicit
  `gpt-5.6-terra` / `high`.
- Reviewers are read-only, return P0-P3 or `CLEAN`, and may not spawn children.
  Actual runtime metadata is recorded when exposed; otherwise the immutable
  configured profile and limitation are recorded.

## Human Requirements Reference

Review against the complete ledger in
`build-protocol/tasks/T-0057-projection-query/TASK.md`, the T-0057 packet in
`build-protocol/planning/WAVE_1_JVM_PARITY_PLAN.md`, and T-0052's accepted
single-policy/provider-conformance correction.

## Review Wave Metadata

- TypeScript/API: existing `typescript_api_docs_reviewer`, configured
  `gpt-5.6-terra` / `high`; runtime self-introspection unavailable.
- Documentation: existing immutable `documentation_reviewer`, configured
  `gpt-5.6-luna` / `medium`; runtime self-introspection unavailable.
- Performance/reliability: existing `performance_reliability_reviewer`,
  configured `gpt-5.6-terra` / `high`; runtime self-introspection
  unavailable.
- Style/maintainability: Desktop capacity required the repository-aware
  read-only CLI fallback. It dispatched only the existing
  `style_maintainability_reviewer` at `gpt-5.6-terra` / `high`; runtime
  self-introspection unavailable. Its Sol/medium parent only dispatched and
  relayed the configured role.

## Review Wave Dispositions

- TypeScript/API: two P2 accepted. Public predicates are not parameterized by
  the selected Projection's column union, so foreign-Projection predicates
  compile; the client README does not identify its consumer import
  substitutions.
- Documentation: two P2 accepted. Public examples claim ID/all-five-operator
  support without demonstrating the ID and helper surface; result documentation
  does not show unpacking the returned state `Any`.
- Performance/reliability: two P1 and two P2 accepted. The default 1,000-row
  bound is applied after full materialization; Datastore pushdown omits the
  30-ID and inequality/first-sort constraints; client predicate compilation is
  recursively unbounded/cycle-prone; and server wide-composite validation
  allocates children before checking the remaining budget.
- Style/maintainability: three P1 accepted. `fixed32` uses a signed wrapper;
  server numeric validation does not require the descriptor's exact wrapper
  type URL; and the ledger-required shared three-provider result conformance
  fixture is absent.
- Security: remains N/A only because the accepted corrections tighten the
  existing QueryService boundary and parameterized provider paths rather than
  add a new trust boundary. T-0067 retains final Wave 1 security ownership.

## Accepted Correction Batch

1. Parameterize public predicates/groups by the selected builder's column union
   and add foreign-Projection compile-negative coverage.
2. Make README consumer substitutions explicit; add compile-covered ID and all
   comparison-helper documentation plus an actual response-state `Any`
   unpacking example.
3. Enforce the default/zero-wire 1,000 candidate bound before unbounded
   materialization, including system-column plans, with overflow/candidate-count
   evidence rather than response slicing alone.
4. Gate Datastore pushdown on whole-plan legality: at most 30 IDs and the
   inequality property as the first order; otherwise use the finite fallback.
5. Replace recursive client predicate validation/compilation with bounded
   cycle-safe iterative work aligned with T-0056 policy, covering cyclic,
   over-depth, and over-wide inputs.
6. Reserve/check the server composite budget before child enqueue/traversal and
   prove wide malformed input rejects before storage/proportional work.
7. Pack `fixed32` as `UInt32Value` and test the maximum range.
8. Validate authored numeric `Any` values by exact descriptor-compatible
   wrapper type URL before decoding, with incompatible-family negatives.
9. Add one shared parameterized provider-conformance fixture proving identical
   supported predicate/order/mask/limit results and pre-provider rejection for
   in-memory, MySQL, and Datastore.

The deduplicated batch returns once to the current implementation context.
Re-review is limited to substantively affected concerns.

## Limited Re-review Metadata And Interim Dispositions

- TypeScript/API: existing `typescript_api_docs_reviewer`, explicitly
  dispatched as `gpt-5.6-terra` / `high`; runtime self-introspection was not
  exposed. The corrected type, FIXED32, wrapper, export, and foreign-schema
  contracts are clean. One P2 remains: the client README names the generated
  export as `TaskListColumns`, but generation exports
  `TaskListColumnDefinition`; the registered column collection is
  consumer-owned.
- Documentation: existing immutable `documentation_reviewer`, explicitly
  dispatched as `gpt-5.6-luna` / `medium`; runtime self-introspection was not
  exposed. CLEAN: substitutions, ID/operator examples, and response `Any`
  unpacking resolve the accepted findings.
- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly dispatched as `gpt-5.6-terra` / `high`; runtime
  self-introspection was not exposed. One P1 remains because explicit positive
  limits still bypass the finite pre-materialization candidate policy on
  in-memory and system-column paths. One P2 remains because 10,001 separate
  top-level `where()` leaves bypass the compiler node bound.
- Style/maintainability: the first limited re-review process visibly ran the
  configured `style_maintainability_reviewer` at `gpt-5.6-terra` / `high`, but
  its terminal result was truncated and the exited session could not be
  recovered. This is not accepted as a durable result. Redispatch uses the
  same existing role, with expected model `gpt-5.6-terra` and expected
  reasoning `high`, both explicit; it is read-only and may not spawn children.

The replacement style/maintainability re-review completed CLEAN. Runtime
metadata was exposed as the required `gpt-5.6-terra` / `high`; the FIXED32
mapping, descriptor-exact scalar validation, shared provider fixture, and their
maintainability consequences are accepted.

## Final Correction Batch

The complete limited re-review wave leaves three deduplicated corrections:

1. Correct the client README to distinguish generated
   `TaskListColumnDefinition` from the consumer-owned registered
   `TaskListColumns` collection.
2. Apply the finite candidate/overflow policy to explicit positive limits as
   well as absent/zero wire limits, with normal and system-column overflow
   tests.
3. Reject more than 10,000 separate top-level `where()` predicates before
   enqueue/allocation, with a 10,001-leaf regression test.

The existing implementation owner is redispatched once with immutable
`implementer`, expected `gpt-5.6-terra` / `medium`, both explicit. Runtime
self-introspection is recorded if exposed; otherwise the configured profile
and limitation are retained. API and performance/reliability are the only
lanes reopened after focused mechanical verification.

The implementation owner completed all three corrections. Its immutable
configured profile was `implementer`, `gpt-5.6-terra` / `medium`; runtime
self-introspection was not exposed. Exact full verification passed with 1,995
tests and 90.01% branch coverage. Final limited re-review dispatches are:

- existing `typescript_api_docs_reviewer`, explicit `gpt-5.6-terra` / `high`,
  limited to the README generated/consumer-owned export correction;
- existing `performance_reliability_reviewer`, explicit `gpt-5.6-terra` /
  `high`, limited to explicit-limit candidate bounding and top-level predicate
  counting.

Both are read-only and may not spawn children. Runtime metadata is recorded
when exposed; otherwise the immutable configured role/profile and limitation
are recorded.

## Final Limited Re-review Dispositions

- TypeScript/API: CLEAN. The README imports generated
  `TaskListColumnDefinition`, registers consumer-owned `TaskListColumns`, and
  matches both the generated companion and repository example. Configured
  `gpt-5.6-terra` / `high`; runtime self-introspection unavailable.
- Documentation: CLEAN from the first limited re-review. Configured immutable
  `gpt-5.6-luna` / `medium`; runtime self-introspection unavailable.
- Style/maintainability: CLEAN from the replacement limited re-review. Actual
  runtime metadata was exposed as `gpt-5.6-terra` / `high`.
- Performance/reliability: CLEAN. The candidate sentinel applies to every
  valid query across ordinary, system-column, in-memory, MySQL, and Datastore
  paths, and the 10,001st top-level predicate rejects before enqueue.
  Configured `gpt-5.6-terra` / `high`; runtime self-introspection unavailable.
- Security: N/A with concrete disposition unchanged: this packet tightens the
  existing QueryService validation and parameterized provider paths and adds
  no trust boundary, credential path, or dynamic SQL. T-0067 retains the final
  Wave 1 security review.

All accepted findings are resolved. Independent orchestrator verification is
the remaining pre-commit gate.
