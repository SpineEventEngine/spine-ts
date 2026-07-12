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

Ordinary last detach clears the stopped, proven-quiescent, permanently retired
current-generation slot through a finally-equivalent path before propagating a
reporting error or inert permanent-cleanup error. A later eligible attach can
therefore create one fresh generation without reusing or overlapping the old
instance. If quiescence cannot be established, the slot remains current and
unsafe, replacement is prohibited, and endpoint-dependent resources remain
open for an explicit lifecycle retry. That retry resumes the same stopped,
admission-closed lifecycle operation without repeating stop, proves quiescence,
then classifies, consumes/reports eligible records, permanently retires/cleans
up, and clears the slot exactly once before a later fresh attachment is allowed.

Reusable explicit stop leaves registrations live but closes their old-
generation readiness admission and installs one bounded canonical tenant/
configured-scope transition buffer, or equivalent persistence barrier. That
owner covers write readiness after the old route closes through the fresh
recovery snapshot and readiness-route rebind. After retirement, the explicit-
stop transition creates exactly one fresh candidate even when no attach races,
rebinds every surviving registration, readiness route, and configured/startup
obligation scope to it, transfers each buffered scope losslessly and exactly
once into fresh pending admission, publishes the candidate, and only then
reopens later-write admission. T-0037b preserves close-admission/stop,
await, classify, consume/report, then permanent-retirement/cleanup order. When
it returns a replacement-safe stopped/quiescent postcondition with a reporting
or cleanup error, these post-retirement steps still complete before T-0037e
propagates the original or combined error once. Cleanup failure may leak inert
resources but cannot reactivate the old instance. If fresh construction, route
rebind, or buffered transfer itself fails, the old generation remains admission-
closed, stopped, and quiescent after retirement/cleanup was attempted; no partial
fresh generation is published; later-write admission remains closed; and the
bounded transition owner retains every not-yet-transferred canonical scope.
Construction failure before a candidate exists may construct one on retry. Once
construction succeeds, the bounded transition owner solely owns that one
constructed-but-unpublished candidate across route-rebind or transfer failure.
Admission remains closed, and every bounded candidate startup/recovery unit
already admitted must settle before the transition error returns, so no
candidate endpoint invocation continues after propagation. T-0037e preserves
and aggregates the transition error truthfully and does not self-loop. Only a
later external lifecycle/readiness retry may resume that same retained candidate,
never construct a second candidate, complete exact-once survivor/readiness route
rebind first, then exact-once retained-scope transfer into fresh pending
admission, publish it, and finally reopen later-write admission. No surviving
scope may return to the old generation or fall outside the transition owner. An
eligible attach racing this transition waits for and joins the same transition-
owned fresh candidate.

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
- A deterministic non-last detach failure/retry case proves the retry resumes
  only the departing registration's unfinished cleanup and eligible reporting
  exactly once after its work barrier, while retaining its endpoint dependencies
  until safe. It never stops or retires the shared generation or clears its slot.
  Throughout failure and retry, sibling generation identity, readiness, pending work,
  endpoints, contexts/resources, and facilities remain intact and usable;
  newly orphaned generation records follow the existing parked-versus-eligible
  partition.
- Last detach closes trigger/notification admission, calls worker stop, awaits
  active work, classifies rejection, reports/consumes eligible records, and
  permanently retires old worker/loops in that exact order by invoking the
  T-0037b primitive rather than duplicating it. Once quiescence is proven, it
  clears the retired current-generation slot through a finally-equivalent path
  before propagating reporting or inert permanent-cleanup errors. If quiescence
  fails, it retains the unsafe slot and endpoint-dependent resources for
  explicit retry.
- A caller-owned environment can later create exactly one fresh generation;
  stopped worker/loop instances are never reused or overlapped.
- Separate ordinary-last-detach tests inject a reporting error and a permanent-
  cleanup error after proven quiescence. Each proves the retired current slot is
  cleared before that error propagates, then performs a later fresh attach and
  proves exactly one fresh generation with no old/new overlap. A distinct
  quiescence-failure test proves the unsafe current slot is retained and the
  later attach cannot replace it. It also retries that same last-detach operation,
  proves quiescence, performs classification, eligible record consumption/
  reporting, and permanent retirement/cleanup exactly once, clears the slot only
  after safety is proven, and then permits exactly one later fresh attach without
  overlap. The failed attempt consumes/reports/retires nothing and tears down no
  endpoint dependency; retry does not duplicate admission closure or stop.
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
  configured scope. Its readiness enters the bounded transition owner. The test
  first completes survivor/readiness-route rebind, then transfers buffered and
  retained scopes losslessly and exactly once into fresh pending admission,
  then publishes the candidate, and only then reopens later-write admission.
  Per-unit progress remains separately auditable for rebind and transfer, and
  the write is eventually admitted without any unrelated readiness trigger.
  The test also proves no old/new generation overlap, exactly one fresh
  generation, and every survivor and the racing attach bound to it. Only
  permanent close or ownership-cardinality rejection may reject the attach.
- A companion explicit-stop test with live registrations and no racing attach
  proves the stop transition itself constructs the sole fresh candidate,
  completes rebind, retained-scope transfer, publication, and admission reopen,
  and leaves every surviving registration usable on that generation.
- A distinct deterministic reusable-explicit-stop test injects quiescence
  failure before classification. The failed attempt retains the unsafe current
  generation, all live registrations, the transition owner and readiness
  buffer, and every endpoint dependency. It performs no classification,
  operational-record consumption/reporting, permanent retirement, or fresh-
  generation transition. Explicit retry resumes that same admission-closed,
  stopped operation without duplicating either completed phase, proves
  quiescence, and completes classification, eligible consumption/reporting,
  and permanent retirement/cleanup exactly once. It then rebinds every survivor
  and readiness route exactly once, transfers every retained scope into fresh
  pending admission exactly once, publishes the sole fresh candidate, and only
  then reopens later-write admission. The test proves one fresh generation, no
  old/new overlap, and no duplicated phase across the failed attempt and retry.
- A reporting-rejection test makes T-0037b retire the old generation and settle
  with the reporting error. After fresh recovery captures its snapshot but
  before route rebind, the test persists a supported write in a surviving
  canonical scope and proves the bounded transition buffer is non-empty.
  T-0037e still creates the fresh generation, rebinds every surviving
  registration/readiness/configured/startup scope, and transfers that scope into
  fresh pending admission exactly once before propagating the original error
  exactly once. The buffered write is admitted by the fresh generation without
  another stop or recovery trigger.
- A distinct retirement-failure test injects failure from permanent retirement
  after old-generation stop, active-work settlement, and operational-record
  consumption have completed. After fresh recovery captures its snapshot but
  before route rebind, it persists a supported write in a surviving canonical
  scope and proves the bounded transition buffer is non-empty. T-0037e still
  creates exactly one fresh generation; rebinds every surviving registration,
  readiness route, and configured/startup scope to it; and transfers that scope
  into fresh pending admission exactly once. The test proves the buffered write
  is admitted by that fresh generation and only then observes the retirement
  error, propagated exactly once.
- Separate injected fresh-construction, route-rebind, and buffered-transfer
  failure cases
  prove the old generation stays admission-closed, stopped, and quiescent after
  retirement/cleanup was attempted; no partial fresh generation becomes current;
  later-write admission remains closed; and the canonical transition owner
  retains a non-empty set bounded by current tenant/configured-scope cardinality.
  Construction failure proves no candidate exists and one may be constructed on
  retry. Rebind and transfer cases each use multiple surviving registrations,
  readiness routes, and retained canonical scopes and inject failure only after
  at least one unit of that phase has completed while at least one remains. They
  inject active bounded candidate work, prove the transition owner retains the
  same sole candidate identity plus per-unit completion progress, await all
  already-admitted candidate work before propagating so no endpoint invocation
  continues afterward, and prove no second candidate is constructed. Each
  operation propagates its transition error exactly once, truthfully aggregated
  with an earlier retirement/reporting error when both exist, and performs no
  recursive or background retry. A later external lifecycle/readiness request
  resumes the retained candidate when one exists. It does not repeat completed
  rebind or transfer units; it completes each remaining survivor/readiness route
  rebind exactly once, then each remaining retained-scope transfer into fresh
  pending admission exactly once, publishes exactly one fresh generation, and
  only then reopens later-write admission. The tests prove no owner gap or
  old/new overlap throughout partial progress and retry.
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
- A deterministic zero-registration permanent-close test injects quiescence
  failure after admission closure and stop. The failed close retains the unsafe
  current-generation slot and every endpoint dependency, performs no
  classification, eligible consumption/reporting, permanent retirement, slot
  clearing, or facility teardown, leaves permanent close in progress, and
  prohibits attachment or replacement. Explicit retry resumes that same close
  without duplicating admission closure or stop, proves quiescence, completes
  classification, eligible consumption/reporting, permanent retirement/cleanup,
  and safe slot clearing exactly once, then closes each owned facility exactly
  once and leaves the environment permanently closed. This retry case is
  separate from refusal while any registration remains live.
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
- Endpoint-dependent resources remain open when quiescence is not proven;
  reporting or inert cleanup errors after proven quiescence cannot reactivate
  delivery or prevent finally-equivalent safe slot clearing.
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
