# T-0123: Storage-Backed Leased Node Registry

Status: Complete; integrated into `main` at `6a7b510a`

## Objective

Adds a platform-neutral, storage-backed directory of live application nodes to
`@spine-event-engine/deployment`. A later GCE registrar will write leases and
the Gateway will read complete live-node snapshots.

The authoritative slice is T-0123 in
`build-protocol/planning/WAVE_7_SCALING_REDEPLOYMENT_PLAN.md`.

## Classification

High-risk. This task adds a persisted versioned record, atomic ownership
fencing, exact expiry semantics, bounded concurrent cleanup, and lifecycle
closure shared by deployment runtimes.

## Baseline And Isolation

- Baseline: `origin/main@05a5bd85` with T-0122 integrated and post-merge
  verified.
- Branch: `task/T-0123-leased-node-registry`.
- Worktree: `.worktrees/T-0123-leased-node-registry`.
- The dirty primary checkout remains coordination-only and protected.

## Human-Imposed Requirements Ledger

1. Construction requires an explicit `StorageFactory` and an independent,
   operator-supplied logical storage namespace. No domain storage choice is
   implicit.
2. Version-1 logical data contains only stable node ID, canonical endpoint,
   expiry, and opaque per-process registration identity. Its storage key is
   `spine.deployment.ApplicationNodeLease:v1`.
3. Complete reads accept only well-formed version-1 rows with canonical
   endpoints. One malformed or unknown-version row fails the whole snapshot
   without returning a partial result, deleting, or rewriting data.
4. Future incompatible shapes use a new versioned key. No migration,
   dual-read, dual-write, or compatibility shim is added.
5. Register and renew require atomic compare-and-set support, rejected before
   lifecycle work when unavailable.
6. Registration identity fences stale renew and delete after a node ID is
   reused. Conditional delete removes only the caller's registration.
7. Reads omit records whose expiry is less than or equal to the supplied clock
   and return every live row, including more than 32.
8. Expired-row cleanup is finite per pass, idempotent, concurrency-safe, and
   repeatable after scale-to-zero.
9. Storage handles and in-flight operations close deterministically without
   wall-clock sleeps.
10. The registry is a discovery directory, not a domain repository and not the
    Stand subscription registry.
11. GCE metadata, scheduling, DNS, provider layout tuning, infrastructure,
    logging, and migration are out of scope.
12. Every commit is pushed to `origin` immediately; generated Protobuf output
    and protected user files remain untouched.

## Implementation Ownership

- Existing role: implementer.
- Expected model: `gpt-5.6-terra`.
- Expected reasoning: `medium`.
- Both fields must be explicit in dispatch.
- Exclusive production ownership: leased-registry source/tests/docs in
  `packages/deployment/**` and the minimum internal persisted schema source.
- Provider conformance tests may be added without provider layout controls.
- Subagents may not spawn subagents.
- Runtime self-introspection must be recorded if available; otherwise the
  immutable configured role/profile and limitation are recorded honestly.

## RED-First Acceptance Tests

- Two-handle registration collision and replacement fencing.
- Stale renew and conditional delete.
- Exact expiry boundary.
- Exact version-1 encoding and storage key.
- Whole-snapshot malformed/unknown-version failure without mutation.
- Forty-live-row read and namespace isolation.
- Concurrent, finite, repeated cleanup.
- Unsupported atomic storage rejection.
- Deterministic close/cancellation and in-flight operation joining.
- In-memory conformance plus existing Datastore/RDBMS provider paths available
  in the repository.

## Documentation Obligations

Document explicit factory/namespace ownership, logical fields, atomic storage
requirements, expiry versus cleanup, scale-to-zero behavior, complete-read
failure, versioned-key cutover, lifecycle closure, and registry purpose. Every
public export receives complete TSDoc; the internal record is not exported from
the end-user root.

## Review Concerns

- Style/maintainability: relevant.
- Documentation: relevant.
- TypeScript/API docs: relevant, Terra/high.
- Performance/reliability: relevant, Terra/high.
- Dedicated security: disposition after implementation; opaque identity and
  namespace isolation require explicit assessment.

## Verification

- RED/GREEN focused conformance and provider tests.
- Cheap affected-scope preflight before review.
- `pnpm verify:release` after convergence because shared persistence and
  serialized runtime behavior change.

## Review Correction Status

The complete review wave produced deterministic correction work for paging,
cleanup progress, allocation, storage-key isolation, and public documentation.
Corrections through `a4cafa50` are pushed, but final re-review and release
verification remain pending. External provider integration is limited by unset
`DATASTORE_EMULATOR_HOST` and `SPINE_TS_MYSQL_URL`.
