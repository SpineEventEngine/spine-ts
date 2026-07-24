# T-0070 Review Record

Status: Accepted

## Scope

Shared current/state/event-history storage contracts, in-memory behavior,
canonical scope and fingerprint, all-caller `RecordSpec` migration, adapter
conformance fixtures, maintenance/retry/concurrency semantics, and affected
documentation.

## Planned Concern Dispositions

| Concern                          | Status | Reason                                                       |
| -------------------------------- | ------ | ------------------------------------------------------------ |
| Style and maintainability        | Clean  | Final canonical-comparator confirmation is clean.            |
| Documentation completeness       | Clean  | Snippets, inventory, contracts, and deferrals are current.   |
| TypeScript and API compatibility | Clean  | Root/internal surfaces and descriptor contracts are current. |
| Performance and reliability      | Clean  | Identity, ordering, retry, concurrency, and bounds verified. |
| Final security                   | N/A    | No new external trust boundary is planned.                   |

Reviewer assignments and explicit runtime profiles are recorded after
mechanical verification establishes the final changed behavior.

## Pre-review Mechanical Disposition — 2026-07-24

No reviewer is assigned yet. The implementation correction batch is recorded
in `build-protocol/work-logs/T-0070.md`: focused storage tests (9 files / 74
tests), Proto generation, generated typecheck, and docs/API checks pass, but
the full lint run has 29 diagnostics in the new storage implementation/tests
and formatting also flags the changed storage root index. A separate,
unrelated T-0067 security record is already unformatted. The T-0070 task audit
also records acceptance proofs that remain absent from the focused suite.

All reviewer lanes therefore remain pending until the bounded implementation
owner returns one correction batch and deterministic checks are clean.

## Mechanical Gate — 2026-07-24

- Focused storage tests passed 9 files / 91 tests.
- Generated typecheck, full lint, targeted formatting, and `git diff --check`
  passed. Repository-wide formatting has one unrelated pre-existing T-0067
  security-record finding, which T-0070 does not own.
- Native full coverage passed 128 files with 3 skipped and 2,354 tests with 21
  skipped. Global branch coverage is 90.01% (7,439/8,264); statements,
  functions, and lines are also above threshold.
- The implementation is mechanically ready for the complete review wave.

## Review-Wave Assignments — 2026-07-24

| Existing role                      | Reviewer concern                                               | Expected configured profile |
| ---------------------------------- | -------------------------------------------------------------- | --------------------------- |
| `style_maintainability_reviewer`   | Module depth, naming, duplication, test maintainability        | `gpt-5.6-terra`, high       |
| `documentation_reviewer`           | Public storage contract, maintenance, deferral, examples       | `gpt-5.6-luna`, medium      |
| `typescript_api_docs_reviewer`     | Breaking `RecordSpec`, exports, declarations, compatibility    | `gpt-5.6-terra`, high       |
| `performance_reliability_reviewer` | Scope identity, retry, ordering, concurrency, retention, close | `gpt-5.6-terra`, high       |

The selected Desktop surface configures these profiles immutably by existing
role. The dispatch API does not permit model/reasoning overrides for these
fixed reviewer roles, so the role selection is the explicit profile dispatch.
Actual child self-introspection is unavailable; acceptance will record the
immutable role/profile and this metadata limitation. Each reviewer owns a
read-only concern lane, must not spawn children, and must report only confirmed
findings against the T-0070 diff.

## Style and Maintainability Result — 2026-07-24

- Actual runtime metadata: child self-introspection was unavailable; the
  accepted immutable role/profile was `style_maintainability_reviewer`,
  `gpt-5.6-terra`, high reasoning, matching the recorded assignment.
- One P2 finding: canonical UTF-8 length-delimited physical-scope encoding and
  byte-length logic are duplicated between `in-memory-storage-factory.ts` and
  `in-memory-entity-history.ts`. Because this is a frozen durable-identity
  policy which provider adapters must preserve, the implementations can drift.
  Extract one internal canonical-scope helper and consume it from both
  factories.
- All other style, naming, cohesion, and test-maintainability concerns were
  clean. Disposition: correction required in the aggregated batch.

## TypeScript and API Result — 2026-07-24

- Actual runtime metadata: child self-introspection was unavailable; the
  accepted immutable role/profile was `typescript_api_docs_reviewer`,
  `gpt-5.6-terra`, high reasoning, matching the recorded assignment.
- P1: `RecordSpec.compatibilityFingerprint` omits declared column types and the
  primitive ID kind, allowing incompatible physical layouts to reopen one
  storage key.
- P1: `InMemoryStorageFactory` stores scope bindings per factory instance, so
  compatible independent factories do not share and incompatible independent
  factories do not reject.
- P1: `EntityStorageInput` accepts an arbitrary caller-provided fingerprint
  instead of deriving compatibility from the state/ID/layout contract.
- P1: multitenant entity storage accepts a missing or blank tenant instead of
  rejecting before provider work.
- P1: current entity-record storage clones state but not the ID, so a mutable
  message/object ID can diverge from its canonical map key.
- P2: internal entity key/purpose/current/history port seams are exported from
  the package root even though only maintenance storage types are planned as
  public at this milestone.
- P2: `docs/api/README.md` is stale for the `storageKey` cutover, new types,
  and cross-factory sharing identity. The deterministic API inventory gate
  independently reports the same export-surface mismatch.
- Disposition: all findings require implementation-owner assessment and
  correction in the aggregated batch; affected API and reliability concerns
  must be re-reviewed.

## Performance and Reliability Result — 2026-07-24

- Actual runtime metadata: child self-introspection was unavailable; the
  accepted immutable role/profile was `performance_reliability_reviewer`,
  `gpt-5.6-terra`, high reasoning, matching the recorded assignment.
- P1: current, state-history, and event-history identifiers are retained by
  reference, so caller mutation can corrupt association between canonical map
  keys and returned/filtered row IDs. This confirms and broadens the API
  review's ID-cloning finding.
- P1: entity compatibility is caller-forgeable and does not bind schema or ID
  canonicalization, confirming the API review finding.
- P1: event-history truncate checks close only before selection and can keep
  deleting after close occurs during a settled maintenance chunk.
- P1: trim/truncate materialize complete row collections and deletion order can
  depend on insertion order, violating the frozen bounded, deterministic
  key-chunk maintenance contract.
- Disposition: implement validated identity/schema binding and cloned IDs,
  close-aware event maintenance, bounded stable-order selection/deletion, and
  direct mutation/lifecycle/large-retention proofs in the aggregated batch.
  Reliability and affected API concerns require re-review.

## Documentation Result — 2026-07-24

- Actual runtime metadata: child self-introspection was unavailable; the
  accepted immutable role/profile was `documentation_reviewer`,
  `gpt-5.6-luna`, medium reasoning, matching the recorded assignment.
- P1: `docs/api/README.md` and `scripts/check-api-docs.mjs` omit the T-0070
  storage surface, causing the deterministic API-doc gate to fail.
- P2: the API/user documentation does not fully explain required
  `RecordSpec.storageKey` validation/stability, deterministic compatibility
  fingerprinting, or pre-access mismatch rejection.
- P2: the user guide says histories accept exclusive continuations, but
  exclusivity applies to `startingFromVersion` reads rather than append.
- No other affected storage README/user-guide/task documentation defect was
  found. Disposition: correct all three items in the aggregated batch and
  re-review documentation after the final public surface is settled.

## Aggregated Correction Result — 2026-07-24

- All review findings were addressed in one implementation stream with bounded
  ownership continuations. Child self-introspection was unavailable; every
  accepted implementation turn used the immutable existing `implementer`,
  `gpt-5.6-terra`, medium profile recorded before dispatch.
- Canonical scope encoding is centralized; record backends share across
  independent factories; multitenant scope fails closed; compatibility
  fingerprints require explicit record schema, ID schema/kind, and declared
  column name/type descriptors.
- Entity current/state/event IDs are cloned by an explicit validated codec.
  Event truncation is close-aware. All maintenance uses stable bounded key-only
  batches, a fixed truncate high-water boundary, resumable deletion, and a
  production default batch size of 128 with an internal-only test override.
- End-user root exports contain only the two planned maintenance types. The
  narrow cross-package provider SPI is available and compile-tested at
  `@spine-event-engine/storage/internal/entity-history`.
- API inventory/reference and user/storage documentation now describe the
  final identity, compatibility, maintenance, and exclusive-read behavior.
- Mechanical evidence: generated typecheck; storage suite 10 files / 98 tests;
  full generated lint; targeted formatting; `git diff --check`; generated API
  docs; release readiness; and an AST audit of 473 TypeScript files all pass.
  The audit found no missing column descriptors, no primitive spec missing
  `idKind`, and no `"unknown"` descriptor.
- All four affected concerns require one focused re-review. A fresh native
  global coverage run precedes that wave because the corrections changed
  durable identity and maintenance behavior.

## Affected-Lane Re-review Assignments — 2026-07-24

- Native full coverage is clean after replacing hidden global in-memory state
  with explicit `InMemoryStorageBackend` ownership: 129 files / 2,364 tests,
  90.02% branches.
- Re-review uses the same immutable existing profiles:
  `style_maintainability_reviewer` (`gpt-5.6-terra`, high),
  `typescript_api_docs_reviewer` (`gpt-5.6-terra`, high),
  `performance_reliability_reviewer` (`gpt-5.6-terra`, high), and
  `documentation_reviewer` (`gpt-5.6-luna`, medium).
- The fixed-role dispatch surface does not accept profile overrides; role
  selection is the explicit configured-profile dispatch. Child
  self-introspection remains unavailable. Review is read-only and limited to
  the corrected concerns plus regressions caused by those corrections.

## Style Re-review Result — 2026-07-24

- Actual self-introspection was unavailable; accepted immutable profile:
  `style_maintainability_reviewer`, `gpt-5.6-terra`, high reasoning.
- Prior canonical-scope duplication is resolved.
- P1: record backend binding calls canonical scope with tenant exclusion, so
  incompatible layouts in distinct tenant scopes can collide contrary to the
  frozen context/tenant/storage-key identity.
- P1: the exported internal provider subpath omits the reusable entity storage
  conformance SPI, preventing Datastore/RDBMS adapters from importing the
  required shared fixture through the package export map.
- P1: event-history truncate lacks the fixed high-water boundary now used by
  state history, so a concurrent eligible later-key event can be deleted by
  the active invocation.
- P2: `docs/USER_GUIDE.md` and `packages/storage/README.md` still contain
  `RecordSpec`/`RecordColumn` snippets without the now-required `idKind` and/or
  `valueType`.
- Disposition: one bounded correction batch; style, affected reliability/API,
  and documentation concerns require final focused re-review.

## API Re-review Result — 2026-07-24

- Actual self-introspection was unavailable; accepted immutable profile:
  `typescript_api_docs_reviewer`, `gpt-5.6-terra`, high reasoning.
- Complete fingerprint inputs/callers, explicit backend ownership,
  root/internal export separation, codec binding/cloning, and export-map
  declarations are resolved.
- P1: the official user-guide/storage README snippets omit required primitive
  `idKind` and/or `RecordColumn.valueType`, and API prose does not state the
  descriptor requirement explicitly. This confirms the style re-review
  documentation finding.
- Static export-map inspection passed. Direct package import was unavailable in
  the isolated reviewer environment; the orchestrator's generated build and
  internal provider compile fixture remain the mechanical evidence.

## Reliability Re-review Result — 2026-07-24

- Actual self-introspection was unavailable; accepted immutable profile:
  `performance_reliability_reviewer`, `gpt-5.6-terra`, high reasoning.
- Explicit backend-token isolation/sharing, backend-scoped binding, ID cloning,
  schema/layout fingerprinting, post-chunk close, and removal of global
  database leakage are resolved.
- P1: event truncate rescans live records without a fixed high-water key, so a
  concurrently appended eligible later-key event can be removed by the active
  invocation.
- P1: state `trim` calls the full `recordsFor()` materialization/sort before
  chunk deletion, leaving the prior large-history bounded-memory finding open.
- P1: identical event retry comparison omits canonical entity correlation, so
  the same event ID/content can be retried for a different entity without
  deterministic rejection.
- Disposition: correct all three with deferred multi-chunk/high-water,
  bounded-selection, and divergent-correlation tests; reliability requires one
  final focused re-review.

## Documentation Re-review Result — 2026-07-24

- Actual self-introspection was unavailable; accepted immutable profile:
  `documentation_reviewer`, `gpt-5.6-luna`, medium reasoning.
- Storage README opening prose still claims implicit same-factory/spec sharing,
  contradicting explicit `InMemoryStorageBackend` ownership later in the file.
- Storage README and user-guide snippets omit required `valueType` and/or
  primitive `idKind`.
- The main API-reference storage inventory omits `EntityEventStorage`,
  `EntityStateHistoryStorage`, and `InMemoryStorageBackend`, and repeats the old
  sharing model. Later prose contradicts it.
- API prose documents `storageKey` but not the exactly-one-of
  `idSchema`/primitive `idKind` invariant or required nonblank column
  `valueType`.
- No additional link, continuation, or maintenance documentation defect was
  found. Disposition: correct all items and final focused documentation
  re-review.

## Final Correction and Native Gate — 2026-07-24

- Final corrections include tenant-inclusive lazy per-operation binding,
  framework-agnostic provider conformance export, fixed event-truncate
  high-water selection, bounded state-trim selection, event retry correlation,
  compilable descriptors, consistent backend/API documentation, established
  tenant error wording, and meaningful UTF-8/local-tenant branch proofs.
- Focused storage suite passes 10 files / 107 tests; combined storage/delivery
  verification passes 12 files / 212 tests. Generated typecheck, lint, targeted
  formatting, docs/API inventory, release readiness, and diff checks pass.
- Final native full coverage passes 129 files with 3 skipped and 2,370 tests
  with 21 skipped. Coverage is 94.20% statements (13,890/14,744), 90.07%
  branches (7,513/8,341), 95.13% functions (3,497/3,676), and 94.74% lines
  (13,276/14,013).
- One final confirmation is dispatched to each affected existing reviewer
  under the same immutable configured profiles recorded above. Review is
  limited to the last findings and regressions caused by their corrections.

## Final Confirmation Results — 2026-07-24

- API: clean. Internal provider SPI/package resolution, root maintenance/backend
  surface, descriptor invariants/inventory, backend sharing, and lazy tenant
  signatures are resolved.
- Reliability: clean for the assigned concerns; focused confirmation passed 4
  files / 78 tests.
- Style: all prior findings resolved, but one new P1 canonical-order regression
  is confirmed. Maintenance key paging/high-water uses JavaScript UTF-16
  comparisons while frozen event/key ordering uses canonical UTF-8 bytes. For
  U+E000 versus U+10000 the orders differ, so a concurrent event can cross the
  snapshot boundary and be deleted.
- Actual self-introspection remained unavailable; each accepted result used the
  immutable existing role/profile recorded for its lane.
- Disposition: one comparator-only behavior correction plus a non-ASCII
  high-water regression, then final style/reliability confirmation. Final
  documentation confirmation remains in progress.

## Canonical Comparator Correction and Final Gate — 2026-07-24

- Maintenance cursor, next-key, high-water, and bound comparisons now use the
  same canonical UTF-8 byte comparator as event ordering.
- RED/GREEN proof uses U+E000 and U+10000 across a deferred multi-chunk event
  truncate; the concurrent append was deleted under UTF-16 order and survives
  under canonical byte order. Focused history passes 30 tests; storage passes
  108 tests; typecheck, lint, formatting, and diff checks pass.
- Final native coverage passes 129 files with 3 skipped and 2,371 tests with 21
  skipped. Coverage is 94.21% statements (13,891/14,744), 90.08% branches
  (7,514/8,341), 95.13% functions (3,497/3,676), and 94.74% lines
  (13,277/14,013).
- Final documentation confirmation is clean, including snippet, 33-export API
  inventory, backend sharing, descriptor, history, internal SPI, and T-0071
  deferral claims.
- Only final style and reliability confirmation of the comparator correction
  remains.

## Final Accepted Disposition — 2026-07-24

- Final style confirmation is clean: canonical maintenance comparison is
  consistent and the non-ASCII regression is maintainable.
- Final reliability confirmation is clean: event ordering, truncate
  high-water/paging, and state maintenance use canonical UTF-8 bytes; the
  U+E000/U+10000 regression passes; trim serialization and chunk/close/retry
  behavior remain correct. Focused confirmation passed 30/30 tests.
- Actual child self-introspection was unavailable. Accepted results used the
  immutable configured profiles recorded before dispatch:
  style/API/reliability `gpt-5.6-terra`, high; documentation
  `gpt-5.6-luna`, medium.
- All canonical review concerns are clean. Final security remains N/A because
  T-0070 adds no external trust boundary or credential/transport surface.
