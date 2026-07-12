# T-0037: Environment Delivery Lifecycle

Status: Split package coordinator-verified; required review pending
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

The invariant map is strict: context descriptors/readiness belong to `a`,
bounded/coalesced worker execution to `b`, bounded operational/cause records to
`c`, attachment/startup/rollback to `d`, retirement/reuse/environment close to
`e`, and network/server ordering to `f`. Retry timing and public policy remain
outside every child.

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
- PENDING: Four required review lanes. No implementation or review completion
  is claimed.
- PASS: Coordinator repeated `docs:check`, `format:check`, `git diff --check`,
  and exact scope/untracked inspection. Docs emitted only the known invalid-
  `origin` warning and retained 205 expected server exports. Lightweight status
  lint corrected completed-step and no-commit attribution wording.
