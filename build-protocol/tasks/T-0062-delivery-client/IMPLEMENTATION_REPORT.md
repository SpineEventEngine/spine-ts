# T-0062 Implementation Report

Status: Complete; specialist closure clean and final repository verification passed.

## Final Acceptance — 2026-07-23

- All style, documentation, TypeScript/API, and performance/reliability review
  findings are resolved. Final focused closure reviews are clean.
- Final independent repository verification passed 105 test files and 2,189
  tests; 21 tests in three files remain intentionally skipped.
- Retained global branch coverage is 90.05% (6,837/7,592). Typecheck, lint,
  cleanup enforcement, formatting, exact API inventory, generated/proto drift,
  documentation, and release-readiness checks passed.
- The public package exposes exactly 23 approved symbols and no generated RPC
  implementation types. No coverage threshold, exclusion, or gate was changed.

## Release/reconciliation regression evidence — 2026-07-23

- Added a controlled RemoteWorkRegistry regression, with a held release RPC,
  to prove a valid `NOT_PICKED` reconciliation cannot admit an overlapping
  pickup until that release is confirmed. The overlapping call returns no
  session and sends no RPC; confirmed release permits the next pickup.
- A separate lost release outcome remains quarantined (again with no pickup
  RPC) until a later valid `NOT_PICKED` reconciliation permits a fresh pickup.
  The test asserts exact RPC counts and ordering: 2 while held, 3 after the
  confirmed-release pickup, 4 after the lost release, and 5 after safe
  reconciliation.
- Focused registry/adapter suites passed 18/18; `typecheck:tooling`, generated
  lint/cleanup, and Prettier passed. This correction touches test fixture,
  semantic registry test, and durable records only; no production behavior or
  public contract changed. Runtime metadata is not introspectable on this
  surface; immutable configured profile: existing `implementer`,
  `gpt-5.6-terra` / `medium`, with no visible fallback or mismatch.

## Exact closure correction — 2026-07-23

- Builder validation now compares resolved local defaults as well as supplied
  ports, so one remote `EXCLUSIVE` port cannot be paired silently with its
  local `LEASED` default.
- Remote release quarantines before dispatch. An overlapping pickup makes no
  RPC and returns no session; confirmed release clears quarantine while a
  dropped release response retains it. Existing double-release and empty-map
  behavior remains covered.
- Focused RED→GREEN, non-network package/builder (96), real gRPC (1), three
  TypeScript surfaces, and generated API checks passed. The current canonical
  coverage rerun did not produce `lcov.info`, so exact retained coverage
  acceptance remains open; no coverage policy was changed.

## Final release-state correction — 2026-07-23

- In-flight release and settled unknown-release quarantine are distinct local
  states. A `NOT_PICKED` observation cannot clear a release still awaiting its
  RPC, preventing an overlapping pickup from being released by the old,
  non-worker-conditional wire call.
- After confirmed success, pickup admission resumes. After an unknown outcome,
  the settled quarantine remains fail-closed until a later valid `NOT_PICKED`
  reconciliation. Focused adapter/observation/registry evidence passed 35/35;
  client/registry/adapter evidence passed 43/43; package typecheck, generated
  lint/cleanup, scoped formatting, and diff hygiene passed. Retained canonical
  coverage and final reliability closure remain pending because the sandbox
  denies the real listener/IPC suites; the orchestrator must reproduce coverage
  on an approved loopback-capable surface.

## Current implementation truth

`@spine-ts/delivery-client` is implemented: it provides bounded, validated
Connect/gRPC reads and single-attempt mutations, remote `DeliveryInbox` and
`DeliveryWorkRegistry` adapters, durable caller-owned removal quarantine, and
bounded Admin observation. `DeliveryBuilder` consumes the supplied ports.
There is no remaining server-port or remote-adapter contract blocker.

Public results are detached snapshots, not deeply immutable JavaScript values:
callers may mutate returned `Date` and byte values without changing client
state or later exact-snapshot comparisons. The frozen remote wire has no
renewable remote fence and no worker-conditional release; ambiguous release
therefore remains quarantined and stale sessions never issue a later release.

## Final correction evidence — 2026-07-23

- RED: focused regressions showed a 1,001-item Admin snapshot was accepted, a
  second pending observation `next()` could wait indefinitely, and concurrent
  release calls could both dispatch before the first response.
- GREEN: snapshot/page/release-expired collection counts are bounded alongside
  serialized bytes; pending waiters share the public buffer bound and fail with
  `ShardObservationOverflowError`; release invalidates local ownership
  before its first await, keeps unknown-outcome quarantine, and removes empty
  per-shard session sets.
- GREEN: supplied ports with explicitly different session kinds fail at build
  time; local ports mark `LEASED` and remote ports mark `EXCLUSIVE`.
- Focused suite: 90 tests across delivery-client behavior and builder checks
  passed. Remaining full verification is recorded after this correction batch.

## Historical record

Earlier slice-by-slice reports and deleted test-file names are historical
context only and are intentionally not an inventory of the current tree. The
durable chronological detail is retained in `build-protocol/work-logs/T-0062.md`
and `build-protocol/reviews/T-0062-delivery-client.md`.

## Runtime metadata

Runtime model self-introspection is not exposed. Immutable configured role and
profile: existing `implementer`, `gpt-5.6-terra` / `medium`; no visible fallback
or mismatch occurred.

## Post-Merge Generated-Output Cleanup — 2026-07-23

- RED: the focused cleaner fixture failed because
  `clean-delivery-client-dist.mjs` did not exist.
- GREEN: injected filesystem operations prove the helper removes only the fixed,
  non-configurable `packages/delivery-client/dist` target. The canonical build
  invokes it directly before `tsc -b`; no glob or configurable broad target is
  used, and platform-native path construction preserves Windows compatibility.
- The dead delivery-client root-entrypoint allowlist addition was removed. A
  clean generated build produced only root `index`, `client`, `wire`, and
  `remote` delivery-client outputs; old flat modules and the two superseded
  error names were absent from `dist`.
- Focused style and TypeScript/API closure reviews are clean. Final full
  verification passed 106 files/2,190 tests, global branch coverage
  6,837/7,592 (90.05%), and all type/lint/cleanup/format/docs/proto/release gates.
