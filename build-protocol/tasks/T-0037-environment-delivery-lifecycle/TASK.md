# T-0037: Environment Delivery Lifecycle

Status: Round 5 docs fix active
Started: `2026-07-12T04:15:00Z`
Baseline commit: `0308bc4a`
Branch: `task/T-0037-environment-delivery-lifecycle`
Worktree: `.worktrees/T-0037-environment-delivery-lifecycle`

## Objective

Consume T-0036's package-internal delivery epoch and shard evidence at the one
`ServerEnvironment` lifecycle seam selected by D-0085, while keeping retry
timing, public monitor/scheduler APIs, topology, and adapters deferred.

## Human-Imposed Requirements Ledger

- Continue autonomously until the project is complete or a real blocker occurs.
- Use this isolated feature branch/worktree and required subagents.
- Split the work into smaller coherent slices when that keeps implementation
  and review packages small.
- Do not assign duplicate agents to the same implementation or review role;
  close every participant after its role completes.
- Every implementation and review role must perform and durably record the
  canonical skill-applicability check from `BUILD_PROTOCOL.md` before its work.
- Apply the Human Review Reset: prefer the smallest JVM-familiar concepts,
  replace or delete wrong abstractions instead of preserving them, and invent
  no abstraction without corresponding Spine JVM evidence.
- Read relevant Spine JVM server documentation/source before implementation.
- Use TDD for runtime behavior.
- Run lightweight docs/status lint before review.
- Run code style/maintainability, documentation, TypeScript/API docs, and
  performance/reliability lanes until clean; defer security to final project
  readiness.
- Use focused inner-loop tests and reserve full `pnpm verify` for final gates.
- Ignore superseded history unless current records claim it active.
- Keep generated Protobuf output out of VCS.
- Do not touch `human-review-1-jul.md`.

## Decision Boundary

- D-0085 assigns one package-internal owner at `ServerEnvironment` level.
- T-0037 consumes T-0036 evidence without reopening loop/worker internals.
- Expected lifecycle scope includes attachment/generation cardinality, startup
  recovery, local supported-write readiness, coalescing, parked rejected-cause
  ownership/reporting, and stop/shutdown ordering.
- Retry delay, backoff, jitter, public retry policy, public monitor/action APIs,
  process supervision, topology, adapters, catch-up delivery, and legacy
  `IMPORT_EVENT` support remain excluded.

## Completed Requirements Split

A read-only requirements split examined D-0085 and current server, environment,
context-handoff, and T-0036 internal seams. It found that T-0037 must become six
independently reviewed child slices before runtime code changes.

## Accepted Decomposition

T-0037 is too large for one implementation/review package. It is a sequencing
parent only. Runtime work proceeds through six separately branched, reviewed,
verified, merged, and cleaned child tasks:

1. `T-0037a Context Delivery Attachment Seam`
2. `T-0037b Bounded Generation Run Coordinator`
3. `T-0037c Parked Delivery Obligations`
4. `T-0037d Environment Attachment And Startup`
5. `T-0037e Generation Retirement And Environment Close`
6. `T-0037f Server Lifecycle Integration`

The invariant map is strict: descriptors and synchronous non-throwing per-
successful-row readiness belong to `a`; bounded runs, lossless bounded canonical
tenant/configured-scope coalescing, and the
reusable coordinator-instance stop/await/retire primitive belong to `b`;
bounded operational/cause records belong to `c`; attachment/startup and
failed-start rollback invocation/empty-slot replacement plus the no-overlap
barrier that awaits already-admitted direct exact drain before environment
admission and buffers transition-time persistence until readiness is installed
belong to `d`; ordinary
detach, explicit generation stop, ordinary/permanent-close primitive invocation,
surviving-registration rebinding plus the deterministic wait-through-retirement
fresh-generation attach race, and
environment close belong to `e`; and network/server ordering belongs to `f`.
Retry timing and public policy remain
outside every child. The `d` and `e` callers do not overlap or reopen the
finally-safe primitive.

Each child depends on its predecessor and is Candidate/not started. No child
branch, work log, review log, or implementation claim exists. D-0086 records
this as sequencing of D-0085, not a lifecycle redesign.

## Current Code Facts

- `ServerEnvironment.delivery` is only an optional closeable and has no run,
  registration, notification, generation, or scheduling behavior.
- The three built-context repository handoffs create short-lived,
  tenant-specific `Delivery` instances, durably receive inbox work, and
  immediately exact-drain the received row.
- `TenantIndex.all()` can enumerate recorded multitenant tenants, but no startup
  path currently enumerates them for delivery recovery.
- `boundedContextAccess.storageFactory(context)` returns the factory actually
  retained by the built context, including a builder-specific factory rather
  than necessarily the environment default.
- `RunningHttp2Server.close()` stops network intake/sessions and then closes a
  flat group of contexts, resources, and optionally the environment. It has no
  delivery detach barrier.
- T-0036's finite epoch, selective per-shard invocation, and fulfilled/rejected
  evidence remain implemented and unchanged; no run starts automatically.

## JVM Evidence Boundary

Spine JVM evidence is used only for environment-level delivery ownership and
readiness after local durable persistence. T-0037 explicitly rejects copying a
process singleton, per-message threads, immediate repeat callbacks, public
`DeliveryMonitor` actions, a catch-up station, or global storage-factory
copying into built contexts.

`T-0037a` lands first and exposes one package-internal `boundedContextAccess`
descriptor/readiness seam. It must not reopen T-0036 internals or start an
environment worker.

## First-Child Handoff

Start only `T-0037a` after this parent split package passes its required review
and is integrated. Give that child its own branch/worktree and durable
implementation/review records at start time. Its author must first write RED
tests around the built-context descriptor, actual storage factory, tenant
enumeration, and post-persist readiness ordering. The parent branch must not be
used for child runtime work.

## Verification

- PASS: Requirements splitter `019f548a-4e89-7183-867e-c52d97bd6b0b`
  completed read-only and was closed. Coordinator accepted the six-slice
  sequence and `T-0037a` as the first independent child.
- PASS: `pnpm format:check` and `git diff --check` passed. The first
  `pnpm docs:check` exposed only absent fresh-worktree package declarations;
  `pnpm typecheck:build:generated` rebuilt ignored declarations and the fresh
  docs rerun passed with zero errors and the known invalid-`origin` warning.
- PASS: Exact scope is the decision log, runtime architecture, parent
  task/report/work/review records, and six child `TASK.md` files. Each child
  directory contains only its brief; no runtime, tests, examples, generated,
  public API docs, child work logs, or child review logs changed.
- ROUND 1: All four required lanes completed with accepted findings. The docs
  fix package later passed focused verification and was committed as
  `3847e1b6`; Round 2 then reviewed the reconciled `80ef21e2` boundary and found
  the additional accepted batch below. No clean review is claimed.
- PASS: Coordinator repeated `docs:check`, `format:check`, `git diff --check`,
  and exact scope/untracked inspection. Docs emitted only the known invalid-
  `origin` warning and retained 205 expected server exports. Lightweight status
  lint corrected completed-step and no-commit attribution wording.
- PASS: Split package committed as `7ff3d50a`; Round 1 findings and assignment
  were recorded by `9e90a006` and `652db999`, the verified fix was committed as
  `3847e1b6`, and reconciliation through `80ef21e2` formed the Round 2 review
  boundary.
- REVIEW: Round 1 accepted findings: require readiness after each successful
  row persistence including partial batches; define bounded lossless merged
  coalescing across every eligible notified scope; place a reusable authoritative
  coordinator stop/retire primitive before attachment rollback and assign its
  callers without overlap; cover permanent server-owned environment cleanup on
  failed startup; copy every applicable inherited rule into all six child
  ledgers; and correct declaration/public compatibility wording. One docs fix
  batch and fresh all-lane review are required.
- PASS: The Round 1 docs fix batch passed `pnpm docs:check`,
  `pnpm format:check`, `git diff --check`, exact tracked/untracked scope, and
  child-artifact checks. Docs retained 205 expected server exports and only the
  known invalid-`origin` warning. Full `pnpm verify` remains reserved. This is
  historical Round 1 evidence; Round 2 findings supersede its then-pending
  review state.
- ROUND 2: Package `0308bc4a..80ef21e2` was reviewed after assignment commit
  `9e723afe`; accepted findings were recorded by `45f737b4`. The single Round 2
  docs fix worker authored and verified the complete accepted batch. All four
  fresh review lanes remain required; no clean review is claimed.
- PASS: The complete Round 2 docs fix passed lightweight stale-status/ownership/
  public-boundary lint, `pnpm docs:check`, `pnpm format:check`,
  `git diff --check`, exact eleven-file tracked scope, no-untracked inspection,
  and child-only-brief checks. Docs retained 205 expected server exports and only
  the known invalid-`origin` warning. Fresh four-lane review remains required.
- ROUND 3: All four lanes reviewed package `0308bc4a..49b3fb4b` and closed with
  one accepted docs batch. The assigned worker has authored the attachment
  exact-drain barrier, deterministic reusable explicit-stop attach race,
  internal-stop public-doc exclusion, and current-status reconciliation.
  Worker and coordinator verification passed. Round 4 then completed all four
  lanes with accepted findings. The Round 4 fix is authored and passed worker
  verification; coordinator verification remains pending and no clean review is
  claimed.
