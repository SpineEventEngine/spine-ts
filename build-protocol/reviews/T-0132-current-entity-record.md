# T-0132 Review Log

Status: Clean

## Planned Concerns

- Style/maintainability: existing reviewer at `gpt-5.6-terra` / `high`.
- Documentation: immutable existing reviewer at `gpt-5.6-luna` / `medium`.
- TypeScript/API docs: existing reviewer at `gpt-5.6-terra` / `high`.
- Performance/reliability: existing reviewer at `gpt-5.6-terra` / `high`.

The implementation owner is the existing implementer role explicitly selected
at `gpt-5.6-terra` / `medium`. Actual runtime metadata will be recorded when the
surface exposes it; otherwise immutable configured role/profile and that
limitation are recorded honestly.

## Review Wave One

- Style/maintainability: existing reviewer, explicit `gpt-5.6-terra` / `high`.
  Found P1 leaked scanner helpers and Stand ID override; P2 schema-blind caches
  and duplicated scanner/Stand spec policy.
- Documentation: existing immutable documentation reviewer,
  `gpt-5.6-luna` / `medium`. The Desktop follow-up surface has no explicit model
  override field and no independent runtime introspection; configured role
  metadata is the available evidence. Found P2 undocumented leaked scanner
  helpers; no broad README/REFERENCE change is required before T-0143.
- TypeScript/API docs: existing reviewer, explicit `gpt-5.6-terra` / `high`.
  Found P1 leaked scanner helpers, packed Process Manager prior state, and
  inherited class metadata; P2 overly broad scanner input and missing internal
  storage-key TSDoc.
- Performance/reliability: existing reviewer, explicit
  `gpt-5.6-terra` / `high`. Found P1 state-derived rather than authoritative
  Entity ID and P2 missing corrupt/frozen record coverage.
- The surface exposes immutable configured roles/profiles but no separate
  runtime self-introspection; no visible mismatch was observed in any lane.

Disposition: one consolidated correction batch returns to the existing T-0132
implementer context at explicit `gpt-5.6-terra` / `medium`. Re-review is
required for style, TypeScript/API, and performance/reliability. Documentation
will be satisfied deterministically by hiding the leaked helpers; no prose
claim remains affected.

## Correction Re-review Dispatch

- Style/maintainability: existing reviewer concern, explicitly dispatched as
  `gpt-5.6-terra` / `high` against the complete corrected T-0132 diff.
- TypeScript/API docs: existing reviewer, explicitly redispatched as
  `gpt-5.6-terra` / `high` against the resolved public-contract findings.
- Performance/reliability: existing reviewer, explicitly redispatched as
  `gpt-5.6-terra` / `high` against authoritative-ID, cache, corruption, and
  coverage corrections.

The desktop surface exposes each immutable configured reviewer profile but no
independent runtime self-introspection. That limitation must be recorded with
the returned result; any visible profile mismatch is rejected.

## Correction Re-review Results

- Style/maintainability: clean. All prior findings are resolved.
- TypeScript/API docs: P1. Projection state-change publication still supplied
  packed `EntityRecord.state` as the old Projection state. All prior API
  findings are otherwise resolved.
- Performance/reliability: P1. `EntityRecords.pack` and restoration reduced the
  complete `core.Version` message to its number, dropping timestamp metadata
  and making a later full-envelope CAS conflict with JVM-written records.
- The reliability P2 coverage note is superseded by the orchestrator's later
  canonical run: 380/419 branches (90.69%) passed the configured gate.

Disposition: the two P1 findings form one final batch for the existing
`implementer`, explicitly dispatched as `gpt-5.6-terra` / `medium`. It owns
only Projection prior-state unpacking and lossless full-Version persistence,
with focused round-trip/CAS tests. Style remains closed; API and reliability
require focused re-review after correction.

## Final Batch Rejection

- Projection old-state unpacking is corrected.
- Full-Version preservation is incomplete: `Stand.#readCurrent()` still
  returns only a `bigint`, so repository load reconstructs its expected CAS
  envelope without the persisted timestamp. The added converter round-trip
  test does not exercise the required repository read-modify-write CAS path.
- The same existing `implementer`, explicitly `gpt-5.6-terra` / `medium`, is
  redispatched to preserve the complete Version through the repository-only
  Stand seam and add the required non-default-timestamp CAS regression.

## Final Focused Re-review Dispatch

- TypeScript/API docs: existing reviewer, explicitly `gpt-5.6-terra` / `high`,
  checks Projection old-state and the internal Version seam.
- Performance/reliability: existing reviewer, explicitly
  `gpt-5.6-terra` / `high`, checks full-Version CAS preservation and the final
  accepted coverage evidence.

The configured reviewer profiles are available; independent runtime-model
introspection remains unavailable and must be reported honestly.

## Final Disposition

- Style/maintainability: clean after correction re-review.
- Documentation: clean by deterministic disposition after the leaked public
  helpers were hidden; broad package prose remains assigned to T-0143.
- TypeScript/API docs: clean after final focused re-review.
- Performance/reliability: clean after final focused re-review.
- Security: not applicable. T-0132 changes internal Entity persistence and
  query materialization without introducing a trust boundary, credential,
  network listener, or authorization decision.

All returned P1/P2 findings are resolved. Canonical verification passes 116
focused tests and 90.86% changed-source branch coverage. The only remaining
server build errors are the exact ten downstream RecordSpec consumers assigned
to later Wave 8 tasks; the integration train intentionally remains unmerged
until those consumers are migrated.
