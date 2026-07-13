# T-0037f: Server Lifecycle Integration

Status: Slice 1 review assigned

Started: `2026-07-13T17:10:59Z`

Baseline commit: `fac6aaad`

Branch: `task/T-0037f-server-lifecycle-integration`

Worktree: `.worktrees/T-0037f-server-lifecycle-integration`

Dependency: T-0037e3 complete and integrated. Final T-0037 implementation child.

This `Status` header is canonical for T-0037f. Its work/review logs are derived
mirrors and must agree before review.

## Architecture Assignment

- Existing role: requirements splitter, explicit expected `gpt-5.6-sol` /
  `high`, no subagents. This milestone changes public server lifecycle
  semantics and integrates concurrency/idempotency boundaries, so selective
  deep planning is required before implementation.
- Documentation-only ownership: this TASK, a new architecture-resolution file,
  `build-protocol/work-logs/T-0037f.md`, and
  `build-protocol/reviews/T-0037f-server-lifecycle-integration.md`. Production,
  tests, public exports, commits, pushes, merge, generated output, and
  `human-review-1-jul.md` are excluded.
- Required output: reconcile the detailed accepted ledger with actual current
  server/environment code, relevant Spine JVM `core-jvm/server` evidence, and
  D-0085/D-0086; produce the smallest coherent TDD slices, explicit ownership,
  focused gates, risk assumptions, and unchanged public-contract boundary.

## Objective

Integrate the completed environment lifecycle with `Server.start()` and
`RunningServer.close()` so startup recovery precedes network intake and
delivery quiescence precedes context, resource, transport, and storage teardown.

## Human-Imposed Requirements Ledger

- Continue autonomously until this child is complete or a real blocker occurs;
  keep the implementation/review package small and limited to this child.
- Implement only this child in its own future branch/worktree with one author
  using TDD.
- Do not assign duplicate authors or reviewers for the same role, and close
  every participating author/reviewer agent after its role completes.
- Every implementation and review role must perform and durably record the
  canonical skill-applicability check from `BUILD_PROTOCOL.md` before its work.
- Apply the Human Review Reset: prefer the smallest JVM-familiar concepts,
  replace or delete wrong abstractions instead of preserving them, and invent
  no abstraction without corresponding Spine JVM evidence.
- Before server-module implementation, inspect and record the relevant Spine
  JVM `core-jvm/server` notes and source as required by `BUILD_PROTOCOL.md`.
- Run lightweight docs/status lint before review.
- Run all four independent review lanes until clean; defer security review to
  final project readiness.
- Use focused inner-loop tests/checks; run full `pnpm verify` only at final child
  acceptance and again after merge.
- Treat superseded history as non-actionable unless an active record claims it.
- Preserve the existing public `Server`, `RunningServer`, and
  `ServerEnvironment` surface.
- Use T-0037d/e1/e2/e3 attachment and lifecycle handles; do not reproduce environment,
  coordinator, or parked-record logic in server code.
- Commit no generated artifacts and add no root/public export, signature, or
  option; emitted internal declarations may change. Update existing README and
  TypeDoc lifecycle contracts for caller-owned environment reuse after server
  detach and the full observable startup/close lifecycle; run API export checks.
- README and TypeDoc must describe only observable `Server`, `RunningServer`,
  and `ServerEnvironment` behavior; they must not name or describe the package-
  internal explicit generation-stop operation.
- Keep generated Protobuf output out of VCS and do not touch the user-owned
  `human-review-1-jul.md`.

## Current Fact

`Server.start()` currently builds contexts and opens the listener without a
delivery attachment. `RunningHttp2Server.close()` stops network intake/sessions
and then closes a flat ordered group of contexts, resources, and optionally the
environment. There is no registration detach barrier between those phases.

## Exact Ownership

This child alone owns server orchestration: attach built contexts to the
environment and await startup recovery before `listen`, carry the internal
registration handle in the running server, stop network intake/sessions before
detach, keep contexts/endpoints open through delivery quiescence and eligible
error consumption, then close contexts/resources, and finally close an owned
environment's facilities. It also owns failed-listener and failed-start
aggregation across these ordered phases.

T-0037d owns the caller-owned failed-start rollback state machine and its same-
operation retry. T-0037f owns the deferred server-level cleanup continuation
around that seam for both caller-owned and server-owned startup failures, while
respecting which environment and facilities the server may close.

Cleanup continuation depends on the delivery safety boundary. For a generation-
ending operation, once quiescence is proven, reporting errors and failures from
permanent cleanup of inert delivery state do not reactivate delivery, and all
later context, resource, and facility close attempts continue. If generation
quiescence itself fails, endpoint safety is unknown: the registration's unsafe
generation slot and every endpoint-dependent context, resource, delivery
facility, transport, and storage remain open for an explicit lifecycle retry.
Server cleanup must not close beneath possibly active work. For a last detach or
generation-ending startup cleanup, the retry resumes the same server lifecycle
operation, does not duplicate
completed admission closure or stop, proves quiescence, and then completes
classification, eligible record consumption/reporting, permanent retirement/
cleanup, safe slot clearing, and deferred server cleanup exactly once. A non-
last detach retry instead retains the departing registration's endpoint
dependencies and, after its work barrier, resumes only cleanup and eligible
reporting; it never stops or retires the shared generation or clears its slot.

## Likely Files

- `packages/server/src/server/server.ts`
- `packages/server/src/server/retryable-close.ts` only for narrowly required
  ordered aggregation support
- Package-internal T-0037d/e1/e2/e3 access modules only for integration adjustments
- Focused server startup, failed-start, shutdown, sharing, and race tests
- This task's future durable task/work/review records and final current
  architecture reconciliation

## TDD Acceptance

- Listener open is not attempted until contexts are built, attachment/readiness
  is installed, and the attaching registration's finite startup recovery
  settles successfully.
- Startup rejection attributable to that registration prevents listener intake
  and aggregates context/resource/registration cleanup failures through the
  existing failed-start model without closing a shared caller-owned environment.
- When caller-owned startup failure rollback cannot establish quiescence, a
  deterministic integration test proves that no listener opens, every endpoint-
  dependent context and resource remains open, and the caller-owned environment
  and its facilities remain open. Explicit retry of that same server cleanup
  invokes and resumes T-0037d's retained failed-start rollback without
  duplicating admission closure or stop, proves quiescence, completes every
  remaining rollback phase and safe generation-slot clearing exactly once, and
  closes each deferred server-owned context and resource exactly once. It never
  closes the caller-owned environment or its facilities. The test then uses
  that environment for one later eligible fresh attachment and server, proving
  one fresh generation and no old/new overlap. This caller-owned continuation
  is distinct from the server-owned environment case below.
- When startup fails with a server-owned environment, no listener is opened;
  registration rollback and generation quiescence are attempted first while
  endpoint dependencies remain open. After proven quiescence, every context and
  resource close is attempted, then permanent environment/facility close is
  attempted in D-0085 order; reporting or inert permanent-cleanup errors are
  aggregated without skipping those later phases. If quiescence fails, the
  unsafe generation slot and endpoint-dependent contexts/resources/facilities
  are retained for explicit retry instead of being closed beneath possibly
  active work. A deterministic retry of that same startup-cleanup operation does
  not duplicate completed admission closure or stop; it proves quiescence, then
  performs classification, eligible record consumption/reporting, permanent
  retirement/cleanup, slot clearing, and every remaining context/resource/
  environment/facility cleanup exactly once. The first attempt consumes,
  reports, and retires nothing and closes no endpoint dependency.
- Close order is network intake and sessions; registration detach/quiescence
  while endpoint dependencies remain open; eligible cause aggregation; context
  and resource close; then owned environment facilities.
- Non-last close leaves the shared environment generation and sibling server
  usable. Last close retires the generation; owned-environment close occurs
  only after exclusive detach and context/resource close.
- A deterministic non-last close failure/retry case proves only the departing
  registration's cleanup and eligible reporting resume exactly once. The shared
  generation is never stopped or retired and its slot is never cleared. Sibling
  generation identity, readiness, pending work, endpoints, contexts/resources,
  and facilities remain intact and usable throughout failure and retry, while
  newly orphaned generation records obey the existing parked/eligible
  partition.
- Active and earlier parked rejections surface only at their truthful boundary
  and once. After proven quiescence, all remaining close hooks still run after
  reporting or inert cleanup failures; quiescence failure retains unsafe
  endpoint dependencies for explicit retry. Only a last-detach or generation-
  ending close-path retry proves quiescence, then classifies, consumes/reports,
  retires/cleans up, clears the safe slot, and resumes remaining server cleanup
  exactly once without duplicating admission closure or stop. Non-last retry
  follows the registration-scoped rule above.
- Transport or storage never closes beneath an active delivery run, and a
  `PAUSED` outcome cannot start after stop admission.
- Existing host/port/baseUrl, idempotent/retryable close, listener failure,
  context build failure, and shared/owned environment behavior remain covered.
- Existing README/TypeDoc contracts describe startup recovery rejection,
  failed-start cleanup aggregation, running-server close order/errors, and
  caller-owned environment reuse after server detach across the observable
  `Server`, `RunningServer`, and `ServerEnvironment` lifecycle. They do so
  without naming or describing package-internal explicit generation stop and
  without adding a public export, signature, or option; focused public-leak and
  API export checks remain green.

## D-0085 Invariants

- `ServerEnvironment`, not `Server` or handoff code, remains the sole delivery
  run owner.
- Startup recovery precedes network intake; detach/quiescence precedes endpoint
  and facility close.
- Close aggregation includes only eligible still-unreported causes and
  preserves later cleanup after post-quiescence reporting or inert cleanup
  errors, while quiescence failure prohibits endpoint-dependent teardown.
- No public scheduler, monitor, health, retry, registration, or detach surface
  is introduced.

## Explicit Exclusions

No retry delay/backoff/jitter/timer selection, public monitoring/actions,
process supervision, topology/adapters, `CATCH_UP` delivery, legacy
`IMPORT_EVENT` support, committed generated artifacts, example changes, or
T-0036 redesign belongs here.

## Architecture Handback

The accepted ledger remains authoritative and is resolved in
`architecture-resolution.md` against integrated source, tests, D-0085/D-0086,
current architecture/API docs, and relevant Spine JVM notes/source.

### Current-Code Reconciliation

- `Server.start()` still has no environment attachment. It builds contexts,
  creates services/HTTP/2 state, and opens the listener directly.
- `RunningHttp2Server.close()` still owns a flat network-then-closeables flow
  and carries no `EnvironmentAttachmentHandle`.
- T-0037d/e1/e2/e3 are integrated behind `serverEnvironmentAccess`: attach and
  startup recovery, failed-start retry, detach/retry, reusable stop, and
  permanent close must be orchestrated, not reimplemented.
- `boundedContextAccess.delivery(context)` already provides the exact built-
  context descriptor required by attach, including actual storage, tenants,
  endpoints, replay, transition, and readiness.
- `RetryableCloseGroup` already owns ordered all-hook attempts and successful-
  index retry. It remains the context/resource/environment cleanup owner.

### Demonstrated Integration Block And Resolution

The current detach access returns only `Promise<void>`, although a rejection
may occur either before endpoint safety or after quiescence/barrier during
reporting or inert cleanup. T-0037f cannot satisfy both “retain every endpoint
dependency while unsafe” and “continue later closes after safe errors” from
that promise alone.

Add only package-internal read-only observations of existing lifecycle state:

- whether T-0037d still retains failed-start rollback after a rejected attach;
  and
- whether one exact attachment handle has crossed its non-last selected-owner
  quiescence/barrier or last-detach replacement-safe checkpoint.

No query advances lifecycle state or enters the public/root surface. Do not
classify safety by arbitrary error type/message and do not copy lifecycle
checkpoints into `Server`.

### Fixed Existing-Method Retry Semantics

A failed start that cannot finish cleanup retains the actual built contexts,
resources, optional listener/session state, and optional attachment handle in
one server-private cleanup record. A later call to that same existing
`Server.start()` retries only the retained cleanup. It does not build, attach,
or listen and cannot return a fake running server. When cleanup succeeds, it
rejects one cause-less plain cleanup-completed error and clears the retry
record; it never re-surfaces the original startup or already reported delivery
cause. A newly assembled server may later reuse a caller-owned environment with
fresh contexts. A server-owned environment is permanently closed.

### Ordered TDD Slices

1. Recovery-before-listener and normal attach/detach close order.
2. Caller-owned failed-start unsafe retention, cleanup-only retry, cause-once
   behavior, and later fresh server/environment reuse.
3. Server-owned startup plus post-attachment listener-failure cleanup,
   quiescence gating, and owned facility order.
4. Shared non-last running close, selected-owner safety, sibling isolation, and
   registration-scoped retry.
5. Last-detach/owned close, active-work safety, no post-stop `PAUSED` start,
   safe-error continuation, and exact-once retry.
6. Observable README/TSDoc, root-export/API leak closure, compatibility suite,
   and final full verification.

Each slice is a separate review-sized RED/GREEN package. The exact production,
test, documentation ownership, focused commands, acceptance criteria, risk
assumptions, and exclusions are in `architecture-resolution.md`.

### Architecture Acceptance Gate

The splitter assignment explicitly required `gpt-5.6-sol` / `high` and no
subagents. This runtime did not expose independently verifiable actual model
and reasoning metadata. The orchestrator must confirm both actual fields before
accepting this handback; no implementation dispatch should begin before that
gate passes.

### Architecture Acceptance

- `2026-07-13T17:26:43Z`: Desktop runtime metadata confirms requirements
  splitter `019f5c76-8ecc-7de0-a5e2-85cb656545c8` at actual
  `gpt-5.6-sol` / `high`, matching explicit dispatch. It used no subagents and
  is closed.
- Coordinator formatting, status, exact four-file ownership, and diff checks
  pass. After worktree setup, generated build typecheck and all five existing
  server/environment suites pass 5 files / 160 tests with native listener
  access.
- The architecture is accepted. One existing implementer receives Slice 1 only
  at explicit expected `gpt-5.6-terra` / `medium`, no subagents. Later slices
  remain unauthorized until Slice 1 TDD, focused verification, and applicable
  review concerns are clean.

## Slice 1 Implementation Handback

- `2026-07-13T17:37:37Z`: Slice 1 implements only recovery-before-listener and
  normal happy-path shutdown. `Server.start()` now derives the built-context
  descriptors, attaches them with the existing ownership mode, awaits finite
  recovery, and only then creates/listens on HTTP/2. The successful opaque
  attachment handle is retained by the running server.
- Normal close now preserves the required order: network intake/sessions,
  existing attachment detach, contexts/resources, and only then an owned
  environment. Caller-owned environments are excluded from the final close
  group; a repeated successful close stays inert.
- RED/GREEN: the new deterministic integration test first failed twice with
  `Attached startup recovery did not begin.` because the baseline never
  attached contexts. After the minimal server orchestration change, it passes
  recovery hold/release, host/port/base URL compatibility, normal detach/close
  order, caller-owned environment reuse, and repeated-close behavior.
- No Slice 2+ failed-start continuation, endpoint-safety observations, public
  API/options/exports, README, generated, Proto, example, delivery, commit,
  push, or merge change was made. Listener-error cleanup performs only the
  existing normal detach needed to retain the pre-existing listener-failure
  compatibility behavior; retained failed-start retry and unsafe-state logic
  remain later-slice work.

## Slice 1 Coordinator Gate And Review Assignment

- `2026-07-13T17:38:37Z`: Desktop metadata confirms implementer
  `019f5c85-56d7-7251-8231-a18906d8f175` at actual `gpt-5.6-terra` / `medium`,
  matching explicit dispatch. It used no subagents and is closed.
- Coordinator native focused gate passes 5 files / 114 tests, generated build
  typecheck, scoped ESLint, cleanup enforcement, Prettier, `git diff --check`,
  exact eight-file scope/status lint, and public-leak scans.
- Style/maintainability, TypeScript/API docs, and performance/reliability are
  assigned in parallel at explicit Terra High, no subagents. Documentation is
  N/A because Slice 1 changes no observable README/TSDoc claim; Slice 6 owns the
  final lifecycle docs. Security remains deferred to T-0041.
