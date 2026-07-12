# T-0037e: Generation Retirement And Environment Close

Status: Candidate; not started

Dependency: T-0037d complete and integrated.

## Objective

Complete the environment seam with registration detach, explicit generation
stop, ordinary/permanent invocation of the existing authoritative coordinator
retirement primitive, fresh-generation race policy, live-registration close
refusal, and permanent environment/facility close.

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
- Preserve existing public `close()` methods and rejection channels; add no
  public detach, registration, generation, scheduler, or retry option.
- Serialize attach, detach, generation stop, and environment close through the
  same package-internal lifecycle gate from T-0037d.
- Commit no generated artifacts and add no root/public export, signature, or
  option; emitted internal declarations may change. Run API export checks.
  Update existing README/TypeDoc only for behavior independently observable at
  this child's merge point, such as `ServerEnvironment.close()` behavior when
  publicly reachable without server detach. T-0037f alone documents caller-
  owned environment reuse after server detach and the full `Server`/
  `RunningServer` lifecycle.
- Keep generated Protobuf output out of VCS and do not touch the user-owned
  `human-review-1-jul.md`.

## Exact Ownership

This child owns internal detach barriers, non-last versus last-detach record
consumption, explicit generation stop as a lifecycle-gated internal operation,
invoking T-0037b's existing authoritative primitive for explicit stop, ordinary
last detach, and zero-registration permanent close, fresh-generation
attach/detach/close race policy after reusable caller-owned retirement,
`ServerEnvironment.close()` live-registration refusal, permanent admission
close, and ordered owned-facility close after quiescence. It does not implement
another stop/await/retire path or handle failed-start rollback.

Reusable explicit stop leaves registrations live but closes their old-
generation readiness admission and installs one bounded canonical tenant/
configured-scope transition buffer, or equivalent persistence barrier. That
owner covers write readiness after the old route closes through the fresh
recovery snapshot and readiness-route rebind. After retirement, the lifecycle
gate creates exactly one fresh generation, rebinds every surviving registration,
readiness route, and configured/startup obligation scope to it, and transfers
each buffered scope losslessly and exactly once into fresh pending admission
before reopening later-write admission. These post-retirement steps execute
through a `finally`-equivalent path even when T-0037b settles with a stop,
settlement, classification, reporting, or retirement error; T-0037e propagates
the original or combined error once only after the complete rebind. No surviving
scope may remain bound to the retired generation or outside both owners. An
eligible attach racing this rebinding joins the same fresh generation.

One package-internal environment-lifecycle explicit-stop entry point owned here
is the sole explicit-stop caller of T-0037b's primitive. Server integration and
handoff code may use the completed environment seam but cannot call the
primitive directly or introduce another explicit-stop path.

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
  permanently retires old worker/loops in that exact order by invoking the
  T-0037b primitive rather than duplicating it.
- A caller-owned environment can later create exactly one fresh generation;
  stopped worker/loop instances are never reused or overlapped.
- Explicit generation stop is distinct from detach and environment close. Under
  the same lifecycle gate it closes generation admission, invokes T-0037b's
  stop/await/consume/retire primitive, leaves registrations and a caller-owned
  environment reusable. After retirement, every surviving registration,
  readiness route, and configured/startup scope participates in exactly one
  fresh generation before later-write admission reopens. An otherwise eligible
  attach arriving after explicit stop begins waits through complete stop,
  active-work settlement, rejection classification, record
  consumption/reporting, permanent retirement, and survivor rebinding, then
  joins that same fresh generation without reusing or overlapping the retired
  instance. It rejects only if permanent environment close wins or independent
  ownership cardinality refuses the registration.
- A deterministic race test starts reusable explicit stop with existing live
  registrations, races one otherwise eligible attach, and pauses after fresh
  recovery captures its durable snapshot but before survivor readiness routes
  rebind. A supported write then persists in a surviving canonical tenant/
  configured scope. Its readiness enters the bounded transition owner, is
  transferred losslessly and exactly once into fresh pending admission during
  rebind, and is eventually admitted without any unrelated readiness trigger.
  The test also proves no old/new generation overlap, exactly one fresh
  generation, and every survivor and the racing attach bound to it. Only
  permanent close or ownership-cardinality rejection may reject the attach.
- A reporting-rejection test makes T-0037b retire the old generation and settle
  with the reporting error. T-0037e still creates the fresh generation, rebinds
  every surviving registration/readiness/configured/startup scope, and transfers
  transition readiness through its finally-equivalent path before propagating
  the original error exactly once. A later supported write then emits readiness
  and runs in the fresh generation without another stop or recovery trigger.
- A distinct retirement-failure test injects failure from permanent retirement
  after old-generation stop, active-work settlement, and operational-record
  consumption have completed. T-0037e still creates exactly one fresh
  generation; rebinds every surviving registration, readiness route, and
  configured/startup scope to it; and transfers every buffered canonical scope
  into fresh pending admission exactly once. The test proves later readiness is
  admitted by that fresh generation and only then observes the retirement error,
  propagated exactly once.
- Focused internal-access tests prove the T-0037e environment entry point is the
  sole explicit-stop caller and server/handoff code has no direct primitive
  access.
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
- API export and public-leak checks stay green with no new public export,
  signature, or option. Existing README/TypeDoc contracts are updated only for
  `ServerEnvironment.close()` behavior independently observable when this child
  merges, if any, and do not name, describe, or expose package-internal explicit
  generation stop. They do not yet describe caller-owned environment reuse
  after server detach or the full `Server`/`RunningServer` lifecycle; T-0037f
  owns that documentation.

## D-0085 Invariants

- Stop always precedes await and operational-record consumption.
- Durable writes after admission closes remain pending; reuse can recover them
  only through a fresh generation when storage remains available.
- Permanent close promises no recovery after environment-owned storage closes.
- A server-owned environment detaches its exclusive registration before
  permanent close; caller-owned environments remain shareable/reusable.

## Explicit Exclusions

No failed-start rollback or empty-slot replacement for failed attachment,
coordinator retirement implementation, HTTP/2 listener/session change,
context/resource close integration, public detach/registration API, retry
timing, public monitor/health/action surface, topology, adapter, catch-up path,
or T-0036 change belongs here.
