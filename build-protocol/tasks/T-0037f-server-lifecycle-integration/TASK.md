# T-0037f: Server Lifecycle Integration

Status: Candidate; not started

Dependency: T-0037e complete and integrated. Final T-0037 implementation child.

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
- Use T-0037d/e attachment and detach handles; do not reproduce environment,
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

Cleanup continuation depends on the delivery safety boundary. Once quiescence
is proven, reporting errors and failures from permanent cleanup of inert
delivery state do not reactivate delivery, and all later context, resource, and
facility close attempts continue. If quiescence itself fails, endpoint safety
is unknown: the registration's unsafe generation slot and every endpoint-
dependent context, resource, delivery facility, transport, and storage remain
open for an explicit lifecycle retry. Server cleanup must not close beneath
possibly active work. The retry resumes the same server lifecycle operation,
does not duplicate completed admission closure or stop, proves quiescence, and
then completes classification, eligible record consumption/reporting,
permanent retirement/cleanup, safe slot clearing, and deferred server cleanup
exactly once.

## Likely Files

- `packages/server/src/server/server.ts`
- `packages/server/src/server/retryable-close.ts` only for narrowly required
  ordered aggregation support
- Package-internal T-0037d/e access modules only for integration adjustments
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
- Active and earlier parked rejections surface only at their truthful boundary
  and once. After proven quiescence, all remaining close hooks still run after
  reporting or inert cleanup failures; quiescence failure retains unsafe
  endpoint dependencies for explicit retry. A close-path retry resumes the same
  operation, proves quiescence, then classifies, consumes/reports, retires/cleans
  up, clears the safe slot, and resumes remaining server cleanup exactly once,
  without duplicating admission closure or stop.
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
