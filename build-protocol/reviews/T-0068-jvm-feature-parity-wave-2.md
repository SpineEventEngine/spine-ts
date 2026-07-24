# T-0068 Review Record

Status: Clean

## Scope

The Wave 2 parity matrix, architecture seams, milestone split, acceptance
criteria, ownership, and verification cadence. No production code is in this
planning packet.

## Canonical Concern Dispositions

| Concern                          | Status  | Reason                                                                  |
| -------------------------------- | ------- | ----------------------------------------------------------------------- |
| Style and maintainability        | N/A     | Internal planning prose does not create a production structure.         |
| Documentation completeness       | N/A     | End-user documentation is an implementation deliverable, not this plan. |
| TypeScript and API compatibility | Pending | Required for breaking package, entity, history, and Query contracts.    |
| Performance and reliability      | Pending | Required for persistence, caching, batching, retention, and guards.     |
| Final security                   | N/A     | Deferred to Wave 2 closure unless planning exposes a security boundary. |

## Planned Reviewer Profiles

- Existing `typescript_api_docs_reviewer`.
  - Bounded concern: public TypeScript contracts, package scope, entity/history
    API shape, Query terminology, declaration compatibility, and milestone
    ordering.
  - Expected model: `gpt-5.6-terra`.
  - Expected reasoning: `high`.
  - Dispatch fields must be explicit.
- Existing `performance_reliability_reviewer`.
  - Bounded concern: durable storage identity, ordering, batching, partial
    failure, cache/retention behavior, guard semantics, adapter parallelization,
    and verification cadence.
  - Expected model: `gpt-5.6-terra`.
  - Expected reasoning: `high`.
  - Dispatch fields must be explicit.

Both assignments will be read-only and collected before one aggregated
planning correction batch. Runtime metadata or the immutable configured
profile plus introspection limitation will be recorded before acceptance.

## First Review Wave

Both reviewers completed. Runtime self-introspection was unavailable for both;
their immutable configured roles and explicitly dispatched
`gpt-5.6-terra` / `high` fields are accepted because no mismatch or fallback
was visible.

### TypeScript/API findings

1. **Blocking:** define the required/optional status, validation, derivation,
   collision behavior, and all-caller migration ownership of
   `RecordSpec.storageKey`.
2. **Blocking:** freeze exact protected history and public maintenance
   declarations, absent-state behavior, returned shapes, immutability, and
   return types.
3. **Important:** include the public `./codegen` subpath, generated helper,
   templates/imports, declarations, and generator binary in the Projection to
   Entity terminology cutover.

### Performance/reliability findings

1. **P1:** define a canonical physical scope, compatibility collision checks,
   and non-collision conformance across context, tenant, state type, and
   purpose.
2. **P1:** freeze history row identity, total ordering, continuation, and
   idempotent retry behavior across every partial-failure stage.
3. **P1:** define the guard's concurrency and failure/retry guarantee.
4. **P1:** define bounded, resumable maintenance, concurrency behavior, and
   close semantics.

## Correction Dispositions

- All API findings are accepted and corrected in the frozen plan.
- Reliability findings 1, 2, and 4 are accepted and corrected with exact
  scope/fingerprint validation, idempotent row keys and total ordering,
  provider-internal bounded maintenance, and failure/concurrency/close tests.
- Reliability finding 3 is corrected by explicitly preserving the JVM
  guarantee: the double-dispatch guard is a bounded best-effort history check,
  not a durable claim or cross-machine exactly-once primitive. The plan now
  specifies same-instance behavior, cross-machine races, partial-failure retry
  outcomes, and tests/documentation that prevent a stronger claim.

Both lanes are materially affected and require one focused re-review after the
corrected packet passes its mechanical gate.

## First Focused Re-review

Both reviewers completed. Their existing roles and explicitly dispatched
`gpt-5.6-terra` / `high` profiles are accepted; runtime self-introspection
remained unavailable and no mismatch or fallback was visible.

The API reviewer cleared the storage-key and Entity-codegen corrections, then
identified:

1. **Blocking:** `Readonly<T>` required explicit freezing of each returned
   cloned message, not only its container.
2. **Important:** maintenance declarations had to show separately that state
   history exposes `trim` plus `truncate`, while event storage exposes only
   `truncate`.

The reliability reviewer cleared the JVM best-effort guard boundary and bounded
maintenance, then identified:

1. **P1:** compatibility fingerprints needed durable cross-process/provider
   enforcement rather than a factory-local registry.
2. **P1:** event history needed exact entity correlation, total ordering,
   continuation behavior, and immutable identical/divergent retry semantics.

All four findings are accepted. The final correction batch now freezes
top-level element and array freezing, per-storage maintenance declarations,
provider-persisted fingerprint metadata, event producer correlation and total
ordering, JVM-style version continuation with deterministic group re-read, and
compare/no-op versus divergent-key failure on retry. Both affected lanes
receive one final narrow confirmation.

## Final Confirmation

- TypeScript/API: **Clean.** The reviewer confirmed element/container
  immutability, per-storage maintenance declarations, required canonical
  `storageKey`, and the complete Entity codegen/binary terminology cutover.
- Performance/reliability: **Clean.** The reviewer confirmed provider-durable
  fingerprint binding, correlated deterministic event history, JVM-style
  version continuation/group re-read, immutable retry behavior, best-effort
  guard boundaries, and bounded resumable maintenance.
- Both final assignments explicitly dispatched their existing roles with
  `gpt-5.6-terra` / `high`. Runtime self-introspection was unavailable; the
  immutable configured profiles are accepted because no mismatch or fallback
  was visible.

Canonical concern dispositions:

| Concern                          | Final status | Disposition                                                         |
| -------------------------------- | ------------ | ------------------------------------------------------------------- |
| Style and maintainability        | N/A          | Planning prose only; implementation structure is reviewed per task. |
| Documentation completeness       | N/A          | End-user documentation is a T-0072 implementation deliverable.      |
| TypeScript and API compatibility | Clean        | Final focused confirmation found no unresolved finding.             |
| Performance and reliability      | Clean        | Final focused confirmation found no unresolved P1/P2 finding.       |
| Final security                   | N/A          | No new trust boundary in planning; required at Wave 2 closure.      |
