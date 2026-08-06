# T-0123 Review Record

Status: Second correction batch in progress; not accepted

## Second correction evidence

- Existing implementer: configured `gpt-5.6-terra` / `medium`; independent runtime metadata is unavailable and no visible fallback or mismatch occurred.
- The registry paging and close fixtures now wrap `queryEntries`, the actual production path (`55f795e2`).
- Exact supported Datastore first and continued ascending string-ID pages use requested limits; continued pages add `__key__ >` (`03dd8450`).
- Final correction evidence: registry registration uses the reconstructed record ID for its CAS slot (`f5c8bace`); exact fully pushed Datastore keyset queries retain provider ordering without a second local continuation pass (`4eaf4307`).

## Review Range

- Baseline: `05a5bd85`.
- Implementation endpoint: `a4cafa50`.
- Requirements:
  `build-protocol/tasks/T-0123-leased-node-registry/TASK.md`.

## Required Concern Dispositions

- Style/maintainability: relevant; correction re-review pending.
- Documentation: relevant; correction re-review pending.
- TypeScript/API docs: relevant; correction re-review pending.
- Performance/reliability: relevant; correction re-review pending.
- Dedicated security: N/A for this task. The change adds no authorization,
  trust boundary, network-facing service, or secret contract; the opaque
  registration ID is internal CAS fencing data, not a credential.

## Reviewer Profiles

- Style/maintainability: existing reviewer, explicit `gpt-5.6-terra` / `high`.
- Documentation: existing reviewer, immutable `gpt-5.6-luna` / `medium`.
- TypeScript/API docs: existing reviewer, explicit `gpt-5.6-terra` / `high`.
- Performance/reliability: existing reviewer, explicit `gpt-5.6-terra` /
  `high`.

Actual runtime metadata or its surface limitation will be recorded before any
result is accepted. Review begins only after mechanical preflight passes.

## Complete Review Wave And Corrections

All four relevant lanes used their configured immutable profiles: style,
TypeScript/API docs, and performance/reliability `gpt-5.6-terra` / `high`;
documentation `gpt-5.6-luna` / `medium`. The child surfaces exposed no
independent runtime model/reasoning introspection; configured dispatch and no
visible fallback are the available evidence.

- Pagination and cleanup starvation: deterministic `id`/`after` paging is
  covered by RED/GREEN checkpoints `2c7ee528`/`d83e424b` and
  `13997f0d`/`1aaab0de`.
- Allocation, simultaneous CAS, exact key, and v1 descriptor regressions are
  covered through `7a4b1103`, `d0486a4e`, and `8788015f`.
- Typed record/TLS and close lifecycle corrections are included before this
  review range; API root verification is recorded in `a4cafa50`.
- Datastore hard cutover: only generic kind derivation changed; scope is
  context name, tenancy mode, tenant slice, and storage key. No migration,
  dual path, or legacy behavior exists. Deterministic matrix coverage is 7/7,
  including sharing, isolation, tuple/unicode/tenancy distinctions, byte bound,
  and cross-key CRUD access (`bdf1eddb` through `2b702a2d`).
- Documentation/TSDoc corrections include lifecycle/TLS/reference scope and
  API entrypoint work (`a5300e05`, `d24e14d4`, `a4cafa50`).

External Datastore emulator and MySQL integration remain unrun because
`DATASTORE_EMULATOR_HOST` and `SPINE_TS_MYSQL_URL` are unset. Re-review remains
required for every affected style, documentation, API, and reliability lane.

## Focused Re-review At `19511e06`

All reviewers reported their immutable configured profiles and the lack of
independent runtime self-introspection; no visible mismatch or fallback
occurred.

- Performance/reliability, P1: Datastore does not push the registry's ascending
  record-ID continuation into `__key__ > ...`, and incorrectly retains the
  1001-row client scan cap. The current 1002-row registry test mocks `query()`
  although production calls `queryEntries()`.
- Style/maintainability, P1/P2: paging and close-join doubles override the wrong
  method; the registry leaf also imports `ApplicationNode` through the public
  barrel that re-exports the registry, creating an ESM cycle.
- TypeScript/API docs, P1: structurally spoofed `ApplicationNode` objects can
  bypass constructor validation and persist malformed or noncanonical endpoint
  data. The write path must reconstruct and validate the value.
- Documentation, P2: the beginner README needs a minimal leased-registry
  constructor/register/read/cleanup/close example.

One correction batch returns all findings to the existing implementer. Only
substantively affected concerns reopen after deterministic verification.

## Final Re-review At `667db8e7`

- Style/maintainability: clean; all prior findings resolved.
- Documentation: clean; the beginner workflow and corrected TSDoc resolve the
  prior omission.
- Performance/reliability, P1: a fully pushed Datastore page is still passed
  through raw-string local ordering. JSON-encoded Datastore key order differs
  for valid control-character IDs, so a page-boundary row can be omitted.
- TypeScript/API docs, P1: registration validates one read of a structurally
  typed node but selects the CAS slot with a second read. A volatile `id`
  getter can persist a record under a different physical slot.

The final correction batch must return fully pushed keyset entries without a
second incompatible local continuation/order pass, with a 257+ adversarial-ID
regression, and must use the validated serialized node ID as the CAS slot, with
a volatile-getter regression. API and reliability alone reopen afterward.
