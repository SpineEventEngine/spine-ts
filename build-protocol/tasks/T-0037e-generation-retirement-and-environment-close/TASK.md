# T-0037e: Generation Retirement And Environment Close

Status: Candidate; not started

Dependency: T-0037d complete and integrated.

## Objective

Complete the environment seam with registration detach, authoritative
generation stop/retirement/reuse, live-registration close refusal, and
permanent environment/facility close.

## Human-Imposed Requirements Ledger

- Implement only this child in its future isolated branch/worktree with one
  author, TDD, focused checks, and all four required review lanes.
- Preserve existing public `close()` methods and rejection channels; add no
  public detach, registration, generation, scheduler, or retry option.
- Serialize attach, detach, generation stop, and environment close through the
  same package-internal lifecycle gate from T-0037d.
- Keep generated Protobuf output out of VCS and do not touch
  `human-review-1-jul.md`.

## Exact Ownership

This child owns internal detach barriers, non-last versus last-detach record
consumption, the authoritative stop-before-await-before-consume sequence,
permanent generation retirement, fresh generation creation after reusable
caller-owned retirement, `ServerEnvironment.close()` live-registration
refusal, permanent admission close, and ordered owned-facility close after
quiescence.

It supplies internal detach/close operations for T-0037f. It does not own HTTP/2
network or context/resource ordering.

## Likely Files

- `packages/server/src/server/server-environment.ts`
- T-0037d environment lifecycle/generation modules
- `packages/server/src/server/retryable-close.ts` only if existing aggregation
  cannot express the required internal ordering without semantic widening
- Focused server-environment detach, race, reuse, and close tests
- This task's future durable task/work/review records and narrow architecture
  wording

## TDD Acceptance

- Non-last detach closes that registration's readiness, establishes its active
  work barrier, consumes only its records and newly orphaned generation records,
  and leaves sibling work/readiness/records active.
- Last detach closes trigger/notification admission, calls worker stop, awaits
  active work, classifies rejection, reports/consumes eligible records, and
  permanently retires old worker/loops in that exact order.
- A caller-owned environment can later create exactly one fresh generation;
  stopped worker/loop instances are never reused or overlapped.
- Environment close with any live registration rejects before changing
  admission, stopping work, consuming records, or closing facilities; retry
  after all internal detaches may succeed.
- Attach/detach/close races linearize per D-0085: attach either joins before
  stop, waits for complete retirement and joins one fresh generation, or
  rejects after permanent close.
- Zero-registration close permanently rejects later attachments/triggers,
  retires any generation, then closes owned delivery/tracing/transport/storage
  facilities without closing them beneath active work.
- Eligible unreported causes aggregate once through existing retryable-close
  behavior; reported unresolved causes are consumed without resurfacing.

## D-0085 Invariants

- Stop always precedes await and operational-record consumption.
- Durable writes after admission closes remain pending; reuse can recover them
  only through a fresh generation when storage remains available.
- Permanent close promises no recovery after environment-owned storage closes.
- A server-owned environment detaches its exclusive registration before
  permanent close; caller-owned environments remain shareable/reusable.

## Explicit Exclusions

No HTTP/2 listener/session change, context/resource close integration, public
detach/registration API, retry timing, public monitor/health/action surface,
topology, adapter, catch-up path, or T-0036 change belongs here.
