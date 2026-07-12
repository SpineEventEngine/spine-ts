# T-0037f: Server Lifecycle Integration

Status: Candidate; not started

Dependency: T-0037e complete and integrated. Final T-0037 implementation child.

## Objective

Integrate the completed environment lifecycle with `Server.start()` and
`RunningServer.close()` so startup recovery precedes network intake and
delivery quiescence precedes context, resource, transport, and storage teardown.

## Human-Imposed Requirements Ledger

- Implement only this child in its future isolated branch/worktree with one
  author, TDD, focused checks, and all four required review lanes.
- Preserve the existing public `Server`, `RunningServer`, and
  `ServerEnvironment` surface unless a separate accepted decision authorizes a
  change.
- Use T-0037d/e attachment and detach handles; do not reproduce environment,
  coordinator, or parked-record logic in server code.
- Keep generated Protobuf output out of VCS and do not touch
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
- Close order is network intake and sessions; registration detach/quiescence
  while endpoint dependencies remain open; eligible cause aggregation; context
  and resource close; then owned environment facilities.
- Non-last close leaves the shared environment generation and sibling server
  usable. Last close retires the generation; owned-environment close occurs
  only after exclusive detach and context/resource close.
- Active and earlier parked rejections surface only at their truthful boundary
  and once; all remaining close hooks still run after failures.
- Transport or storage never closes beneath an active delivery run, and a
  `PAUSED` outcome cannot start after stop admission.
- Existing host/port/baseUrl, idempotent/retryable close, listener failure,
  context build failure, and shared/owned environment behavior remain covered.

## D-0085 Invariants

- `ServerEnvironment`, not `Server` or handoff code, remains the sole delivery
  run owner.
- Startup recovery precedes network intake; detach/quiescence precedes endpoint
  and facility close.
- Close aggregation includes only eligible still-unreported causes and
  preserves operational cleanup even after an error.
- No public scheduler, monitor, health, retry, registration, or detach surface
  is introduced.

## Explicit Exclusions

No retry delay/backoff/jitter/timer selection, public monitoring/actions,
process supervision, topology/adapters, `CATCH_UP` delivery, legacy
`IMPORT_EVENT` support, generated/example changes, or T-0036 redesign belongs
here.
