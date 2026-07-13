# T-0037e2 Architecture Resolution

Status: Accepted; Slice 1 assigned

## Resolution Summary

Keep reusable generation stop inside the existing `EnvironmentAttachments`
lifecycle module and its existing serial gate. Add one package-internal initial
entry, `serverEnvironmentAccess.stopDelivery(environment)`, and one continuation,
`serverEnvironmentAccess.retryDeliveryStop(environment)`. The continuation is
not a second stop entry: it can only resume the one retained private
`GenerationStop` operation and cannot select or call a different generation.

`GenerationStop` is a private, environment-owned operation record. Its identity,
candidate, checkpoints, buffered readiness, failures, and racing-attach waiters
never leave the module. No caller-visible retry token or public declaration is
added. An in-flight duplicate stop shares the same attempt promise. After an
incomplete rejection, ordinary stop refuses with explicit-retry-required
behavior; only `retryDeliveryStop()` advances the retained operation. After a
completed replacement-safe transition, the retained blocker is cleared, so a
later explicit stop is a genuinely new operation over the fresh generation.

This is the smallest deep interface: callers can request a stop or continue its
one failed operation, while route closure, old retirement, candidate ownership,
scope capture/transfer, publication, admission, error ordering, and attach
waiting remain local to `EnvironmentAttachments`.

## Existing Modules And Required Changes

- `EnvironmentAttachments` remains the sole owner of lifecycle serialization,
  generation publication, registration cardinality, handle validation, and all
  stop/retry admission. It owns the private `GenerationStop` record.
- `DeliveryGeneration` remains the owner of one generation's worker,
  coordinator, runtime owners, registration states, readiness destinations,
  delivery records, and overlap domains. It gains private preparation/transfer
  behavior for an unpublished candidate; no parallel coordinator is created.
- `EnvironmentDeliveryRecords` remains the only mapping from canonical scopes
  to registration/generation/shared parked obligations. A narrow non-consuming
  transition capture may expose configured and retained scopes to its owning
  `DeliveryGeneration`; no second cause or record ledger is introduced.
- `RegistrationReadiness` remains the stable route object already installed by
  T-0037d. Do not call `DeliveryReadiness.transition()` a second time. Extend the
  registration-local route with an internal transition mode that closes direct
  candidate admission, buffers canonical readiness, prepares one candidate
  destination per descriptor route, and opens that prepared destination only in
  phase 4.
- One private `RegistrationBinding` indirection keeps the existing claim and
  attachment-handle objects stable while their lifecycle target changes. The
  binding holds the committed generation plus an optional transition owner.
  Existing T-0037e1 `WeakMap` handle identity and detach operation state remain
  authoritative; no handle is replaced or structurally widened.
- `DeliveryRunCoordinator.retire()` remains the sole authoritative old-instance
  primitive. T-0037e2 invokes it through `DeliveryGeneration`; it does not copy
  or change the primitive's stop/quiescence/report/retire state machine.

No separate production file is required merely to name the state machine.
Keep `GenerationStop` and `RegistrationBinding` private in
`environment-attachment.ts` unless implementation size demonstrates a deep
module with a smaller interface than local private state. Do not extract a
callback-heavy phase runner.

## Exact Ownership By Phase

| Phase                           | Old generation                                                                                                                   | `GenerationStop`                                                                                                                             | Candidate                                                                                                                    | Claims and handles                                                                                                                    | Racing attach                                                                                                                    |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Before stop                     | Owns workers, coordinator, registrations, routes, records, and endpoints.                                                        | Absent.                                                                                                                                      | Absent.                                                                                                                      | Stable bindings commit to old generation.                                                                                             | An attach admitted first joins old generation.                                                                                   |
| Admission closure and capture   | Still owns runtime state until replacement safety is proved.                                                                     | Owns survivor list, binding transition claims, closed readiness gates, canonical scope union, and route/transfer checkpoints.                | Absent.                                                                                                                      | Objects stay live; committed generation view remains old and lifecycle mutation is serialized behind the stop.                        | An attach ordered after stop becomes an unclaimed waiter; it performs no descriptor or worker work.                              |
| Unsafe stop/quiescence failure  | Retained, admission-closed, stopped as far as completed, but not replacement-safe; retains every endpoint dependency.            | Retained with readiness buffer and completed closure/stop checkpoints.                                                                       | Absent.                                                                                                                      | Still committed to old generation and owned by the retained transition.                                                               | Waits for external retry; it neither rejects for retirement-in-progress nor creates a generation.                                |
| Replacement-safe old retirement | Permanently inert; may retain only inert resources after cleanup failure. It remains the blocked current slot until publication. | Sole live owner of survivor bindings, endpoint dependencies, captured scopes, and any stable old failure.                                    | Absent until construction succeeds.                                                                                          | Identity remains stable; no detach/other lifecycle operation can interleave.                                                          | Continues waiting.                                                                                                               |
| Candidate construction          | Permanently inert.                                                                                                               | Owns the one unpublished candidate immediately after construction succeeds.                                                                  | Owns fresh worker/coordinator/runtime shell and fresh recovery snapshot; is not in the current-generation map.               | Binding has a prepared candidate but still exposes the committed old marker.                                                          | Continues waiting and cannot construct another candidate.                                                                        |
| Phase 1: rebind                 | Permanently inert.                                                                                                               | Advances a per-registration/per-descriptor-route rebind checkpoint and keeps admission closed.                                               | Acquires prepared registration state and route destinations one unit at a time.                                              | Stable route objects point at a prepared candidate destination but remain transition-gated; handles are unchanged.                    | Continues waiting.                                                                                                               |
| Phase 2: transfer               | Permanently inert.                                                                                                               | Advances a separate per-canonical-scope transfer checkpoint and owns any newly buffered dirty scope.                                         | Receives each captured canonical scope into fresh admission and settles every admitted unit before its checkpoint completes. | Still transition-gated.                                                                                                               | Continues waiting.                                                                                                               |
| Phase 3: publish                | Removed from the current slot only after replacement safety.                                                                     | Performs one synchronous commit.                                                                                                             | Becomes the sole current generation.                                                                                         | All stable bindings and the environment generation marker commit to the candidate atomically; handle object identity does not change. | Still has no claim until its serialized admission resumes.                                                                       |
| Phase 4: reopen                 | Inert and unreachable from survivor routes.                                                                                      | Opens every prepared route synchronously, drains the final bounded buffer, awaits transition-admitted candidate work, then resolves waiters. | Owns all survivor routes and later-write admission.                                                                          | Claims/handles now resolve lifecycle work and generation identity to the candidate.                                                   | Resumes normal serialized attach, takes a new claim, and joins the published candidate subject only to ordinary ownership rules. |

Publication is the only point at which the environment's current generation,
claim generation view, handle lifecycle target, and generation map change. A
partially rebound candidate is therefore never discoverable through ordinary
attachment/detach lookup even though the private transition owns it.

## Route Closure And Rebind

At stop admission, create and publish the private `GenerationStop` record before
closing the first route, then synchronously put every surviving
`RegistrationReadiness` into transition mode. This closes old notification
admission without failing the registration and without removing the descriptor's
already-installed `DeliveryReadiness` callback. A successful persisted write
continues to call the same stable registration route; transition mode records its
canonical readiness in `GenerationStop` and performs no old-generation notify.

Fresh recovery snapshots are taken while these gates are closed. A write after a
fresh snapshot and before route rebind therefore lands in the same bounded
transition owner. Phase 1 prepares each `(registration token, descriptor route)`
against the candidate and checkpoints it only after the candidate registration
state and stable route destination are both installed. Completed route units are
not revisited by retry. The route remains closed until phase 4, so rebind cannot
admit candidate work prematurely.

An invalid/unmappable readiness fact fails the current transition attempt
closed. It does not fall back to the old route, publish the candidate, or make
the registration permanently failed. External retry resumes the same candidate
and route checkpoints after the underlying bounded scope set is complete.

## Canonical Scope Capture And Transfer

`GenerationStop` owns one bounded nested map keyed by registration identity,
descriptor object identity, and canonical readiness key. It stores scope facts
and source flags, not notification history or error causes. The categories are:

- configured: `EnvironmentDeliveryRecords.configuredScopes(token)` in stable
  configured order;
- startup: each survivor's existing `GenerationRegistration.startupScopes`;
- buffered: canonical readiness received by transition-gated
  `RegistrationReadiness` from closure until phase 4;
- retained: old coordinator pending scopes plus configured scopes that still
  back unresolved parked registration/generation/shared records.

Capture configured/startup/retained facts before the old retirement callback
consumes generation records. The callback may then use the existing atomic
`EnvironmentDeliveryRecords.retire()` path and reporting semantics; the
transition map is only the survivor recovery input and does not preserve a
second cause ledger.

The transition key deliberately excludes the old ephemeral runtime-owner key.
Phase 2 asks the candidate to resolve the same registration/descriptor/readiness
fact to its fresh runtime owner, then admits that candidate scope. Source
categories coalesce into one canonical pending unit. This is transfer, not
route rebind: phase 1 changes the stable readiness destination; phase 2 moves
canonical scope facts into the candidate.

Rebind and transfer progress are separate maps. A transfer checkpoint is written
only after the candidate admission promise settles, so completed candidate work
cannot remain active when a later unit fails. Repeated readiness for the same
scope coalesces in one dirty bit while pending. If readiness arrives after that
scope's current transfer was captured, the buffered unit becomes dirty again and
must be admitted once more before publication; this is new persisted readiness,
not repetition of the completed captured unit, and retains bounded memory.

After the final asynchronous transfer settles, phase 2 rechecks the transition
buffer and then performs phases 3 and 4 synchronously. JavaScript cannot
interleave another readiness callback between that final empty check,
publication, and route reopen. The reopen drains any already captured buffered
unit into candidate admission, and the stop operation awaits all work it
admitted before resolving or propagating an earlier error. No unrelated trigger
is needed.

## Ordered Operation And Retry State

The private operation advances only in this order:

1. create operation identity; close every survivor readiness gate; capture old
   configured/startup/retained scope facts;
2. invoke the old coordinator retirement state machine;
3. after `replacementSafe`, take fresh survivor snapshots and construct one
   candidate;
4. phase 1 rebind with per-route checkpoints;
5. phase 2 transfer with separate per-scope checkpoints and candidate-work
   settlement;
6. phase 3 publish once;
7. phase 4 reopen once, admit final buffered work, and await transition-admitted
   candidate work;
8. release racing-attach waiters, then propagate any retained earlier error.

Construction has an explicit boundary. Fresh snapshot/preflight and worker
factory failure before the operation stores a candidate leave `candidate`
undefined; external retry may repeat preflight and construct one candidate.
Immediately after candidate construction succeeds, store it in `GenerationStop`
before any fallible rebind. Every later rebind/transfer retry must use that same
object.

Rebind or transfer failure leaves the candidate unpublished and every route
closed. Before rejecting the attempt, await all candidate work admitted by the
operation. Retain the operation, candidate, buffers, and both checkpoint maps.
No failure schedules a timer, recursive promise continuation, monitor action, or
background retry. `retryDeliveryStop()` creates one new attempt promise around
the retained operation; simultaneous retry calls share that promise.

The operation retains failures by phase and preserves existing ordering. A
single error keeps its identity; simultaneous distinct errors use ordered
`AggregateError`. An error already returned by an incomplete attempt is marked
observed and is not emitted again after a later successful retry. This bounded
error disposition prevents both lost errors and duplicate propagation without
creating a public error type.

## Old Retirement Outcomes

- Stop or quiescence failure is unsafe. `replacementSafe` is false, no fresh
  snapshot/construction/rebind/transfer/publication/reopen runs, and no old
  records, endpoint dependencies, or slot are removed. External retry re-enters
  the same coordinator retirement state; completed admission closure/stop is not
  duplicated.
- Report failure after quiescence is replacement-safe. The coordinator still
  attempts permanent retirement and becomes inert. Save the report failure,
  complete all four fresh phases, admit and settle buffered candidate work, then
  propagate that same failure once.
- Post-consumption permanent-retirement failure is also replacement-safe and may
  leave only inert resources. Complete the same four fresh phases and candidate
  settlement before propagating the cleanup failure once.
- If reporting and permanent retirement both fail, retain their existing order
  and aggregate them, but still complete replacement first.
- A transition failure after a replacement-safe old failure is aggregated for
  that failed attempt only after candidate work settles. Retry resumes the same
  candidate/checkpoints; it never re-runs old report or retirement.

## Attach Linearization

Keep the existing serial call order as the linearization point.

- An attach whose admission step runs before stop closes readiness completes its
  claim/assembly in the old generation. Stop snapshots it as a survivor and
  rebinds it with every earlier registration.
- An attach ordered after stop performs no claim, descriptor enumeration,
  storage lookup, readiness transition, or worker construction. Its outer
  promise is registered as a waiter and its serial step releases immediately so
  `retryDeliveryStop()` cannot deadlock behind it.
- Unsafe old retirement or partial candidate failure leaves that attach pending,
  not rejected merely because stop is in progress. External retry advances the
  retained operation. On phase-4 completion the waiter is re-admitted once in
  original order and joins the published candidate.
- Independent server-owned/caller-owned cardinality is checked at that eventual
  normal admission and may reject the attach. Permanent close remains T-0037e3.
- A stop that finishes replacement but rejects with an earlier report/inert
  cleanup error still releases eligible waiters to the fresh candidate before
  propagating the stop error. No waiter can create a second candidate.

Detach and failed-start policies are not redesigned. Their calls remain ordered
by the same serial gate. If they run before stop, the stop snapshots the resulting
live set. If they are ordered after an incomplete stop, they observe explicit
stop-retry-required state; T-0037e2 adds no implicit detach continuation.

## Private/Public Boundary

- Add only `stopDelivery` and `retryDeliveryStop` to the source-private
  `serverEnvironmentAccess` object. They are absent from `packages/server/src/index.ts`,
  package exports, README, TypeDoc public pages, examples, and generated output.
- `GenerationStop`, `RegistrationBinding`, candidate checkpoints, waiters, and
  transition scope facts are private declarations. Do not export them from the
  source module unless a package-internal compile-time seam is unavoidable; in
  all cases they remain absent from the package root and package `exports` map.
- `EnvironmentAttachments`/`DeliveryGeneration` are the only reusable-stop
  callers of `DeliveryRunCoordinator.retire()`. Server, runtime, context handoff,
  and descriptor code cannot invoke the primitive directly.
- Preserve public `ServerEnvironment.close()`, `RunningServer.close()`, and all
  existing signatures/options unchanged. Public documentation must not name the
  explicit-stop operation.

## TDD Implementation Slices

One existing `gpt-5.6-terra` / `medium` implementation owner should own one
slice at a time with no overlapping writer. Each slice receives focused checks
and all four canonical review concerns before the next slice starts.

### Slice 1: Private Stop Foundation And Happy Path

Acceptance:

- `stopDelivery()` is the sole initial entry and sole explicit-stop path to the
  existing coordinator retirement primitive; `retryDeliveryStop()` is only a
  continuation over retained state.
- One normal stop with multiple live registrations closes routes, safely retires
  old generation, creates one candidate without a racing attach, rebinds every
  registration/route, transfers the normal configured/startup union, publishes,
  reopens, and leaves the same handle objects usable against the candidate.
- Claim/handle generation view changes only at publication; old/new workers
  never overlap and there is no current-generation gap visible to lifecycle
  lookup.
- Duplicate in-flight stop calls share one attempt.

Likely files:

- `packages/server/src/server/environment-attachment.ts`
- `packages/server/src/server/server-environment.ts`
- new focused `packages/server/test/server/environment-generation-stop.test.ts`
- T-0037e2 task/work/review records

Focused tests: happy path with two registrations/routes, no-race candidate
creation, handle identity and post-stop detach/use, phase event order, duplicate
stop coalescing, and T-0037d/e1 focused regressions.

Risk: introducing binding indirection can accidentally change T-0037e1 handle,
failed-start, or detach semantics. Mitigation is to keep the existing handle
`WeakMap` authoritative and run those regressions in this first slice.

Exclusions: construction/rebind/transfer fault injection, old retirement
failures, racing attach, permanent close, server integration, public exports.

### Slice 2: Bounded Capture, Checkpoints, And Transition Failure Retry

Acceptance:

- One transition owner captures configured, startup, buffered, and retained
  canonical scopes in stable order without a second cause ledger.
- A write after fresh snapshot and before rebind is buffered, transferred, and
  admitted without another trigger.
- Separate multi-unit rebind and transfer tests fail after one completed unit,
  prove distinct checkpoints, await admitted candidate work before rejection,
  and resume the same candidate without repeating completed units.
- Fresh snapshot/worker construction failure leaves no candidate; explicit retry
  constructs exactly one. Every post-construction failure retains that exact
  unpublished candidate and keeps routes closed.
- No attempt self-loops; simultaneous explicit retries coalesce.

Likely files:

- `packages/server/src/server/environment-attachment.ts`
- `packages/server/src/server/environment-delivery-records.ts`
- `packages/server/test/server/environment-generation-stop.test.ts`
- `packages/server/test/server/environment-delivery-records.test.ts`

Focused tests: four scope provenances with overlap/deduplication, dynamic
write-after-snapshot, construction failure, partial route failure, partial
transfer failure with candidate settlement, same-candidate identity, dirty
scope during transfer, and no publication/admission reopen on failure.

Risk: a simple completed-key set can lose a write arriving after that key was
captured. Mitigation is the bounded dirty-bit rule and a synchronous final
buffer check/publication/reopen commit.

Exclusions: quiescence/report/retirement failure policy, attach waiting/races,
public/static boundary checks, permanent close, server integration.

### Slice 3: Retirement Safety And Original-Error Ordering

Acceptance:

- Unsafe stop/quiescence failure retains old generation, registrations,
  transition owner, buffer, endpoint dependencies, and waiters; it runs no
  candidate phase. Retry does not repeat completed closure/stop and finishes
  every remaining step once.
- Separate report-failure and post-consumption retirement-failure tests each
  create a non-empty write-after-snapshot buffer and independently prove:
  rebind -> all-scope transfer -> publication -> reopen -> buffered candidate
  admission/settlement -> original error propagation once.
- Replacement-safe failure never leaves an unpublished candidate or closed
  admission. Combined report/retirement or old/transition errors preserve
  ordered aggregation without repeated old phases.

Likely files:

- `packages/server/src/server/environment-attachment.ts`
- `packages/server/test/server/environment-generation-stop.test.ts`
- focused unchanged-regression coverage from
  `packages/server/test/delivery/delivery-run-coordinator.test.ts`

Focused tests: unsafe stop throw, unsafe await rejection, retry checkpoints,
independent report and retire failures with their own interleaving, combined
failure ordering, candidate-settlement barrier, and stable once-only errors.

Risk: propagating a replacement-safe old error too early can strand live routes;
propagating it twice can misreport one lifecycle boundary. Mitigation is one
stored old result plus the explicit final candidate-settlement tail.

Exclusions: racing attach admission, public exports/docs, permanent close,
facility teardown, server/listener cleanup.

### Slice 4: Attach Race And Internal Boundary

Acceptance:

- Attach admitted before stop becomes a survivor in old generation and is
  rebound with it.
- Eligible attach after stop does no early claim/enumeration/construction,
  remains pending through unsafe or partial failure, and after explicit retry
  joins the sole transition-owned candidate in original order.
- A replacement-safe stop error still releases the waiter to the fresh candidate;
  independent ownership conflict still rejects normally. No waiter deadlocks
  retry or creates a second worker generation.
- Static/focused access checks prove only the environment lifecycle module calls
  the coordinator primitive for explicit stop, no server/handoff caller can do
  so, package/root public exports are unchanged, public docs do not name stop,
  and generated output remains untracked.

Likely files:

- `packages/server/src/server/environment-attachment.ts`
- `packages/server/src/server/server-environment.ts`
- `packages/server/test/server/environment-generation-stop.test.ts`
- task/work/review records and focused static audit commands

Focused tests: attach-before-stop, attach-after-stop success, unsafe retirement
plus waiter plus retry, partial candidate failure plus waiter plus retry,
replacement-safe failure plus waiter, cardinality refusal, one candidate factory
call, and public-leak/source-caller scans.

Risk: awaiting an attach waiter on the lifecycle queue can deadlock the retry
that must release it. Mitigation is a deferred outer attach promise whose serial
step records the waiter and releases immediately; only transition completion
re-admits it once.

Exclusions: changing T-0037e1 detach behavior, permanent environment close,
facility teardown, server/listener integration, public API/docs, retry timing,
monitor/scheduler/health, topology/adapters/catch-up, T-0036, examples.

## Exact Exclusions

No public explicit stop or retry; no root/package export or option; no
registration detach or ordinary last-detach redesign; no failed-start rollback
change; no permanent environment close/refusal; no facility, context, listener,
session, transport, or storage teardown; no server lifecycle integration; no
timer/backoff/jitter/background retry; no monitor/health/action surface; no
topology, adapter, catch-up, or T-0036 change; no public docs, examples,
Protobuf, generated artifact, or accepted D-0085/D-0086/T-0037e1 rewrite.

## Evidence And Remaining Uncertainty

The resolution is grounded in the current T-0037b/d/e1 TypeScript source and
focused tests, accepted D-0085/D-0086 and active architecture/spec/API/quality
records, repository JVM notes, and local core-jvm `ServerEnvironment`,
`Delivery`, `InboxDeliveries`, `ShardedWorkRegistry`, and `DeliveryMonitor`
source. JVM evidence supports environment delivery ownership, explicit target
registration/unregistration, exclusive work settlement, and explicit retry
actions; D-0085/D-0086 govern the TypeScript-only candidate/checkpoint semantics.

No blocking architecture uncertainty remains. The implementation owner may
choose private field/helper spelling and test-fixture mechanics, but may not
change the ownership, ordering, retry, publication, or public-boundary decisions
above without a new demonstrated architecture block.
