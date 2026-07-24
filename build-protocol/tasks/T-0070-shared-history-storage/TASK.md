# T-0070: Shared Entity-Record and History-Storage Foundation

Status: Complete

## Objective

Freeze and implement the shared storage contracts and in-memory conformance
foundation for current entity records, state history, and diagnostic event
history. This milestone creates the reviewed adapter boundary; repository
execution paths remain unchanged until T-0071.

## Classification

High-risk. T-0070 changes a root-exported storage contract, defines durable
record identity and ordering, adds public maintenance storage types, and
creates a serialized/provider contract that Datastore and RDBMS adapters will
implement in parallel only after this task is frozen, reviewed, committed, and
pushed.

## Human-Imposed Requirements Ledger

- Implement behavioral/conceptual Spine JVM parity with idiomatic TypeScript;
  do not copy JVM internals or invent over-engineered abstractions.
- Use `@spine-event-engine/*` for every package/import.
- State history applies to Aggregate, Projection, and Process Manager; it is
  opt-in and off by default at repository level.
- Aggregate event history is unconditional; Process Manager event history is
  opt-in; Projection event history is absent; rejection events are excluded.
- History is entity/repository behavior, not a remote client API.
- Reads are asynchronous, immutable, and newest first.
- Retention is application-managed with `trim`/`truncate`; no unlimited scan
  option and no new generic cursor API.
- Persisted layouts may change without migration compatibility.
- Freeze the shared contract before parallel Datastore/RDBMS work.
- Preserve unrelated files and never modify `human-review-1-jul.md`.
- Use the canonical autonomous build protocol, explicit child model metadata,
  existing roles, isolated worktrees, and one owner for overlapping files.
- Push origin immediately after every commit.

## Frozen Contracts

The authoritative behavior is
`build-protocol/planning/WAVE_2_JVM_PARITY_PLAN.md`, especially “Shared
latest-state records,” “History APIs and configuration,” and T-0070.

The implementation owner must freeze and implement:

- required validated `RecordSpec.storageKey`;
- deterministic compatibility fingerprint;
- canonical physical scope from context, tenant, and storage key;
- one internal latest-state `EntityRecord` representation/port for all entity
  kinds;
- state-history and diagnostic event-history record/storage ports;
- exact row identity, ordering, continuation, retry, retention, close, and
  tenant semantics;
- in-memory implementation and reusable adapter conformance fixtures.

Every existing `RecordSpec` caller is migrated atomically in this task. No
optional/default key is allowed.

## Acceptance Criteria

- Equivalent compatible specs with the same canonical scope share data across
  independent storage handles/factories; incompatible fingerprints reject
  before row access.
- Context, tenant, entity state type, and record purpose cannot collide.
- Current records preserve state, canonical ID, version, and lifecycle.
- Current, state-history, and event-history rows cannot collide.
- State row keys, event IDs, producer correlation, total ordering,
  exclusive-version continuation, immutable identical retry, divergent retry
  rejection, and `stateAt` ordering match the plan.
- `EntityStateHistoryStorage<I, S>` exposes async `trim` and `truncate`;
  `EntityEventStorage<I>` exposes async `truncate` only.
- Maintenance is internally bounded, idempotently resumable, safe against
  concurrent append according to the plan, and close-aware without a public
  cursor.
- In-memory conformance proves large histories, short reads, complete cache
  groups where relevant to the storage seam, tuple non-collision, fingerprint
  mismatch, retry/failure stages, retention, concurrency, and close.
- No Aggregate snapshot/reconstruction change, repository cutover, query DSL
  rename, provider adapter implementation, remote API, compatibility alias, or
  data migration is included.

## Test-First Slices

1. Required `storageKey`, canonical scope/fingerprint, equivalent-handle
   sharing, mismatch rejection, and all-caller migration.
2. Shared current `EntityRecord` contract and in-memory current-record
   conformance.
3. State-history identity, ordering, `stateAt`, continuation, retry, trim, and
   truncate.
4. Event-history producer correlation, ordering, continuation, immutable retry,
   and truncate.
5. Bounded maintenance, concurrent append, failure resumption, close, and
   reusable adapter conformance exports.

Each slice starts with a failing behavior test. Mechanical checks precede one
complete specialist review wave.

## Ownership

- Existing role: `implementer`.
- Ownership: `packages/storage/**`, the minimum shared Proto/core types needed
  for the internal entity record, every existing `RecordSpec` caller required
  by the breaking constructor change, conformance fixtures, and affected
  storage documentation.
- Excluded ownership: repository execution cutover and provider-specific
  Datastore/RDBMS implementation.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit in dispatch. The owner may not commit, push,
  merge, or spawn children.

## Skill Application

`event-store-design` applies to immutable diagnostic event-journal identity,
correlation, ordering, and idempotent writes. It does not turn Aggregate
history back into an event-sourcing/reconstruction store; the Wave 2 plan's
latest-state model remains authoritative.

## Review and Verification

- Style/maintainability: required.
- Documentation: required for public storage contracts and maintenance.
- TypeScript/API: required for `RecordSpec`, public storage declarations, and
  adapter conformance seams.
- Performance/reliability: required for persistence identity, concurrency,
  retry, bounded retention, and close behavior.
- Final security: N/A unless a new trust boundary appears.

Run focused storage checks after every slice, then build, lint, configured
formatting, full tests, docs/API, release readiness, generated-output checks,
and the change-sensitive coverage gate before review.

## 2026-07-24 Closure Audit

| Acceptance item                                                     | Audit result                | Evidence / remaining work                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compatible scope sharing and incompatible pre-access rejection      | Evidenced                   | Focused independent-handle behavior test proves compatible sharing and incompatible fingerprint rejection before any existing row can be read.                                                                                                                                   |
| Context, tenant, state type, and purpose isolation                  | Evidenced                   | Focused tuple-collision and tenant-isolation behavior test proves length-delimited context/tenant/key isolation; current, state-history, and event-history scopes are directly non-colliding.                                                                                    |
| One current record with ID, state, version, lifecycle               | Evidenced                   | `EntityRecord` and the independent-handle current-record behavior test cover the shared shape and clone/read path.                                                                                                                                                               |
| Current/state/event physical non-collision                          | Evidenced                   | Direct scope/purpose tests and separate backend maps prove that current, state-history, and event-history rows cannot collide.                                                                                                                                                   |
| State/event identity, ordering, continuation, retry, temporal reads | Evidenced at storage seam   | Focused tests cover newest-first states, `stateAt` creation-time/version ties, exclusive continuation, identical/divergent retries, large and short reads, and canonical UTF-8 event-ID ties. Repository cache groups are T-0071 behavior, not a T-0070 storage adapter concern. |
| Public maintenance declarations                                     | Evidenced                   | `EntityStateHistoryStorage` exposes async `trim`/`truncate`; `EntityEventStorage` exposes async `truncate`.                                                                                                                                                                      |
| Bounded/resumable/concurrent/close maintenance                      | Evidenced at in-memory seam | Deterministic resume after completed state trim/truncate and event-truncate chunks, close-during-chunk, trim/append, and truncate/append tests pass. Provider-native paging/bounds remain future adapter conformance.                                                            |
| In-memory and reusable adapter conformance                          | Evidenced at storage seam   | In-memory focused suite passes 10 files / 108 tests and runs the framework-agnostic provider fixture through the internal package subpath. It covers clone isolation, large state reads, continuation, temporal reads, and event ties; repository cache groups remain T-0071.    |
| Excluded repository/reconstruction/remote/migration work            | Evidenced by diff audit     | No repository execution cutover, provider implementation, remote history API, compatibility alias, migration, or event-based reconstruction was added. T-0071 owns repository configuration and protected entity history.                                                        |

The documentation accurately describes only the implemented storage seam and
its T-0071 deferral. All specialist lanes are clean. Final native coverage
passes 129 files / 2,371 tests at 90.08% branches; T-0070 is complete and ready
for commit, push, integration, and post-merge verification.
