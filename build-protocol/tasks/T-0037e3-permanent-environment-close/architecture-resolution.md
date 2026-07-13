# T-0037e3 Architecture Resolution

Status: Derived mirror of TASK.md — Final whole-task Round 2 re-review assigned

## Resolution Summary

Keep permanent admission inside the existing `EnvironmentAttachments` lifecycle
module and its existing serial gate. `ServerEnvironment.close()` remains the
only public entry. Its existing coalesced attempt first awaits one short package-
internal permanent-admission callback and only then invokes its existing
`RetryableCloseGroup` outside `#serial`. Add no public close variant, retry
method, state query, option, error type, declaration, or export.

`EnvironmentAttachments` needs only a permanent-admission flag plus the existing
provisional-stop cancellation state; do not add an `EnvironmentClose` class or
facility ledger. The existing `ServerEnvironment.#close` promise remains the
current public attempt owner. `RetryableCloseGroup` remains the sole ordered
facility and successful-index retry owner. Neither facility ownership nor
facility settlement enters `EnvironmentAttachments`.

This is the smallest deep interface: public callers know only
`close(): Promise<void>`, while registration admission, close/attach/stop
ordering and retained-owner refusal remain package-local to attachment
lifecycle, while facility retry/error ordering remain package-local to the
existing public close implementation.

## Evidence

### Accepted TypeScript Contract

- D-0085's active outcome requires serialized live-registration/retained-owner
  refusal and owner-free zero-registration/no-generation permanent admission.
  Its authoritative stop/await/classify/consume-report/retire order, unsafe-slot
  retention, and cause-once rules remain in the predecessor generation owners.
- D-0086's active outcome assigns only owner-free permanent admission and
  subsequent facility teardown to T-0037e3. T-0037d owns
  failed-start rollback, T-0037e1 owns detach and last-detach retry, T-0037e2
  owns reusable stop and fresh-generation transition, and T-0037f owns server,
  listener, context, and resource integration.
- `DeliveryRunCoordinator.retire()` in
  `packages/server/src/delivery/delivery-run-coordinator.ts` already closes
  admission, stops once, proves quiescence, invokes the caller's classification/
  consumption/report callback, attempts permanent worker retirement, and
  exposes `replacementSafe`. Integrated T-0037d/e1/e2 operations invoke it only
  through `DeliveryGeneration.retire()`; T-0037e3 adds no caller.
- `EnvironmentDeliveryRecords.retire()` is already the sole generation-wide
  selection/consumption path. `ParkedDeliveryObligations.report()` selects only
  unreported representative causes in configured order and marks them reported
  before returning them. No second cause ledger is needed.
- `RetryableCloseGroup` in `packages/server/src/server/retryable-close.ts`
  already attempts every closeable in order, retains only failed indexes for
  retry, skips successful indexes, and flattens nested `AggregateError` causes.
  `ownedEnvironmentCloseables()` already fixes facility order as delivery,
  tracer, transport, then storage.
- Current `ServerEnvironment.close()` directly calls the facility group and
  therefore bypasses `EnvironmentAttachments`. Current attach, detach,
  failed-start retry, and reusable stop already serialize through
  `EnvironmentAttachments.#serial`; only permanent admission/cancellation joins
  that gate. Facility work remains in `ServerEnvironment` after the serialized
  callback resolves.
- T-0037e1 and T-0037e2 architecture records establish the existing safe-slot
  clearing, same-operation retry, original-error-once, and attach ordering
  patterns. Permanent close consumes those patterns but creates no candidate,
  rebind, transfer, publication, or admission reopen.

### Integrated Reachability And Ownership

The integrated T-0037d/e1/e2 state machine has no legal close-owned state that
contains both zero registrations and a current generation:

- successful ordinary last detach retires and clears its generation before a
  later close can enter the serial gate;
- unsafe last detach retains its registration and exact detach owner;
- reusable stop retains every surviving registration and its exact stop owner;
- failed-start rollback removes the failed claim before retirement, so it is
  the sole zero-registration/current-generation state, but T-0037d retains that
  exact generation and is the only legal retry owner until it retires and
  clears the slot.

T-0037e3 therefore narrows the conditional “any current generation” branch: a
close-eligible zero-registration admission must also have no current generation.
It never fabricates an orphan generation and never takes over a retained
T-0037d/e1/e2 operation. A zero-registration current generation first receives
the existing failed-start explicit-retry-required refusal; any generation that
has neither registrations nor a recognized retained owner is an invariant
error before permanent admission. No T-0037b primitive call is legal from
permanent close at this integrated boundary. The predecessor operation remains
the sole caller that retires and clears its generation, after which a later
public close performs permanent facility teardown.

### Local Spine JVM Guardrail

Local evidence was inspected before design; no browsing was required.

- `spine-jvm-docs/spine-server-runtime-and-bounded-context.md`, “Environment
  and storage wiring” and “Lifecycle and close behavior”, places shared delivery
  and factories at `ServerEnvironment` and describes environment close as
  permanent facility shutdown.
- `spine-jvm-docs/spine-validation-storage-observability-and-support.md`,
  “ServerEnvironment”, confirms that JVM close touches resolved tracer,
  transport, and storage factories without instantiating unresolved lazy
  facilities.
- Local core-jvm
  `/private/tmp/spine-core-jvm-T0036/server/src/main/java/io/spine/server/ServerEnvironment.java:332`
  exposes only `isOpen()` and idempotent `close()`; lines 344-351 close tracer,
  transport, and storage and then mark the singleton closed. TypeScript keeps
  the familiar permanent environment boundary but preserves its already-
  accepted explicit-instance, async, ownership, aggregation, and retry model
  instead of copying JVM singleton or fail-fast mechanics.
- Local core-jvm `Delivery.java:714-755` and `InboxDeliveries.java:34-83`
  keep delivery target registration/unregistration inside delivery ownership.
  `ShardedWorkRegistry.java:40-71` makes active shard ownership exclusive until
  release. These support refusing close while live target ownership exists and
  proving settlement before dependency teardown; they do not define the
  TypeScript close/attach retry state machine.
- Local core-jvm `DeliveryMonitor.java:123-160` exposes explicit monitor failure
  actions. T-0037e3 does not copy that public monitor/retry surface; accepted
  D-0085/D-0086 package-internal cause reporting remains controlling.

## Canonical Terms

- **Live registration**: a claim currently counted by
  `EnvironmentRegistrations`; queued attach input is not a registration until
  its serialized claim succeeds.
- **Permanent close admission**: the one serialized zero-registration commit
  after which this environment can never accept another registration,
  explicit stop, generation, or replacement. No live readiness route exists at
  this point; a stale synchronous readiness callback remains a no-op.
- **Proven quiescence**: predecessor-owned
  `DeliveryGeneration.replacementSafe === true` after the T-0037b primitive has
  completed stop and settlement. T-0037e3 observes only the resulting absent
  generation; it does not establish this postcondition.
- **Owned facility**: an entry already selected by
  `ownedEnvironmentCloseables()` from the existing ownership options. Close
  does not acquire ownership of caller-owned facilities.
- **Reported cause**: an unresolved parked cause whose representative has
  already crossed the report boundary. Its operational record may remain until
  retirement, but the same cause object is not reportable again.

These terms sharpen the existing D-0085 model. They do not require a new
glossary or decision record.

## Private Ownership And State

`EnvironmentAttachments` owns semantic close state because it already owns the
registration count, current generation slot, and lifecycle serial gate.
`ServerEnvironment.#close` continues to coalesce one public attempt and clears
its promise after rejection so the same public method is the retry entry.
`EnvironmentAttachments` stores only whether permanent admission committed.
`ServerEnvironment.#close` owns attempt coalescing, and its facility group owns
all per-facility completion checkpoints. Do not copy attempt status, facility
indexes, or owned-closeable lists into attachment lifecycle state.

The exact new semantic field is `#permanentlyClosed = false`. Once set, it is
never cleared. `admitPermanentClose()` returns an already-resolved promise
without queueing another serial callback when this field is true; this is the
facility-retry/idempotent-close path, not a second admission attempt.

| State              | Attachment/explicit-stop admission | Generation                                          | Facilities                                               | Permitted next action                                        |
| ------------------ | ---------------------------------- | --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| Open               | Open                               | Absent, live, or retained by its existing operation | Open                                                     | Existing lifecycle operation or close admission              |
| Refused            | Unchanged open state               | Unchanged in the same existing owner                | Unchanged                                                | Complete/retry the existing owner, then call `close()` again |
| Closing facilities | Permanently closed                 | Absent                                              | Successful facilities closed; failed facilities retained | The same public `close()` retries only failed facilities     |
| Closed             | Permanently closed                 | Absent                                              | Every owned facility closed                              | Repeated `close()` resolves; attach/explicit stop reject     |

## Serialized Permanent-Admission Phase And Linearization

One package-internal `EnvironmentAttachments.admitPermanentClose()` enters the
same `#serial` chain as attach, detach, failed-start retry, and reusable stop.
Its callback performs only the following bounded in-memory decisions; it never
calls or awaits `RetryableCloseGroup` or any facility.

1. Before queueing, return resolved if `#permanentlyClosed` is already true.
2. In the first admission callback, check exact live-registration count first.
3. If the count is non-zero, reject with one plain `Error` whose fixed message
   is `ServerEnvironment cannot close while it is in use.` Do not commit
   permanent admission; do not close readiness/admission, stop work,
   classify or consume records, clear a slot, or call any facility. The existing
   generation and registrations remain usable.
4. With zero registrations, inspect retained owners before current-generation
   reachability. A retained failed-start rollback receives the existing
   `Environment generation rollback requires an explicit retry.` rejection.
   Permanent close never advances that operation.
5. Inspect eager T-0037e2 `#stop` state. Cancel only when
   `stop.admitted === false && stop.completed === false`; this identifies a
   provisional stop whose serial turn is queued behind this close and which has
   no generation ownership. Add exactly
   `cancelledByClose: Error | undefined` to package-private `GenerationStop`.
   Set it to one plain `Error("ServerEnvironment is closed.")`. Snapshot the
   waiting attachment gates, empty `waiters`, set `waitersReleased`, attach
   `Promise.allSettled()` to their promises as `waiterSettlement`, then mark
   each waiter complete and reject its gate with that same error. This order
   installs rejection observers before settlement. Clear `#stop` only when it
   still identifies this provisional record. The admission callback does
   **not** await `stop.promise` or `waiterSettlement`: the stop's serial turn is
   behind close, and waiting would deadlock or needlessly extend the gate. When
   that queued turn arrives, `#continueStop()` checks the cancellation reason
   before retained-owner or generation work, sets `completed`, awaits only the
   already-observed waiter settlement, and throws that same closed error through
   its existing local gate. The public stop promise therefore rejects
   deterministically and its existing completion handler cannot restore or
   retain `#stop`.
   An unadmitted stop with `completed === true` is different: its stop-first
   no-generation turn already completed and released its waiters into the serial
   queue, but its public promise may remain pending on `waiterSettlement`. Close
   leaves its cancellation reason, waiters, settlement promise, completion
   status, and `#stop` identity unchanged. It does not await that stop promise.
6. Require both the current registration generation marker and generation map
   to be empty. A remaining generation without a recognized retained owner is
   an invariant error before permanent admission, not permission to call
   T-0037b.
7. Set `#permanentlyClosed = true`, closing attachment and explicit-stop
   admission. The commit is irreversible; readiness has no rejectable channel
   and is handled separately below. Return from the callback immediately so its
   promise settles and the swallowed `#serial` tail is released.

The serial admission order is the race linearization point:

- attach admitted first claims a registration; close then sees a live count and
  refuses non-destructively;
- close admitted first sees zero, commits permanent admission, and the queued
  attach later rejects with plain `Error("ServerEnvironment is closed.")`
  before claim, descriptor enumeration, route transition, storage lookup, or
  worker construction;
- close invoked first and `stopDelivery()` invoked second cancels that stop's
  eager provisional record and all of its waiters as specified above. A later
  attach rejects from permanent-close state, not from stale `#stop`, and no
  waiter remains pending. Admission returns without waiting for the behind-it
  stop turn or facility settlement;
- stop whose serial turn runs first either completes its no-generation no-op or
  becomes an admitted T-0037e2 owner. Close observes that completed state or
  refuses the live/retained owner; it never cancels an admitted stop.
- specifically, stop first in a no-generation environment may mark `completed`,
  release an attach waiter behind a close already queued second, and remain in
  `#stop` until waiter settlement. Close does not cancel it, commits permanent
  admission after the stop turn, and returns from its serial callback. The
  queued attach then rejects from permanent-close state; that settlement lets
  the original stop promise resolve normally and its existing completion
  handler clears `#stop`.

## Serial Release And Public Facility Phase

`ServerEnvironment.close()` composes the two existing owners in one coalesced
public attempt:

1. call and await `EnvironmentAttachments.admitPermanentClose()`;
2. only after that promise settles successfully, call
   `ServerEnvironment.#closeGroup.close()` outside attachment `#serial`;
3. preserve the existing catch that clears `ServerEnvironment.#close` after any
   refusal or facility rejection so explicit later `close()` retries remain the
   only public retry entry.

Duplicate in-flight public calls share `ServerEnvironment.#close`. Once
permanent admission commits, a later attempt observes it as an idempotent
admission success and retries only incomplete facility indexes. A queued
cancelled stop may run concurrently with facility settlement because the close
group promise is not assigned to `EnvironmentAttachments.#serial`. Facility work
may begin before that queued stop turn executes, but cannot delay its execution
or rejection through the serial chain.

## Closed Checks And Readiness Semantics

The internal channels are exact and intentionally different:

- `attach()` checks committed permanent close before consulting provisional
  stop state or queueing work and returns a rejected promise with
  `ServerEnvironment is closed.` No claim or descriptor work occurs.
- `stopDelivery()` and `retryDeliveryStop()` check committed permanent close
  before allocating, finding, or advancing `#stop` and return a rejected promise
  with the same plain error. Close-first/stop-second is the provisional race
  exception handled at serialized close admission because close was queued but
  not yet committed when stop allocated.
- Readiness notification remains synchronous `void`. Permanent close admits
  only after zero registrations and no generation, so no live readiness route
  exists. A stale callback that reaches a previously retired coordinator uses
  the existing `DeliveryRunCoordinator.notify()` rule and no-ops when
  `#accepting` is false. It does not throw, return a rejected promise, create a
  close error, or gain a new public/internal error channel.

## Permanent Facility Close And Errors

After the permanent-admission promise releases `#serial`, no generation or
parked record remains for T-0037e3 to retire, classify, consume, or report. Those
actions completed in the predecessor owner, or close refused that retained
owner. Permanent close therefore invokes neither `DeliveryGeneration.retire()`
nor `DeliveryRunCoordinator.retire()` and creates no quiescence/reporting failure
branch.

The same coalesced public close attempt then invokes the existing close group in
fixed delivery, tracer, transport, storage order. Facility semantics remain:

- Facility failures retain existing owned-closeable order. Every owned facility
  receives one attempt in the first safe teardown pass. A successful close is
  never invoked again. A failed facility receives one new attempt per explicit
  later `close()` call until it succeeds; later facilities are attempted on
  every pass in which they remain incomplete.
- Preserve the existing flat `AggregateError` message
  `ServerEnvironment close failed.` and delivery/tracer/transport/storage cause
  order. Do not add `cause`, codes, result objects, or custom error classes.
- A retry reports only failures from facilities attempted in that retry.

Unreported-versus-reported cause behavior remains proven at the predecessor
retirement interfaces (`EnvironmentDeliveryRecords.retire()` and T-0037d/e1/e2
tests). T-0037e3 adds a deterministic retained-failed-start refusal proving it
does not consume or resurface either kind while T-0037d still owns them.

Quiescence, reporting, and inert-cleanup failures remain on the predecessor
operation promise; permanent close does not combine them with facility errors.
An unsafe predecessor retains its slot, dependencies, and facilities, so close
refuses and attempts no facility. A replacement-safe predecessor clears its
matching slot even when reporting or inert cleanup rejects; a separately queued
or later close then observes the owner-free state and attempts every facility.
This preserves complete teardown without duplicating or reordering the original
cause across operation boundaries.

## Public `ServerEnvironment.close()` Boundary

Preserve the exact public signature and export:

```ts
close(): Promise<void>
```

The public method remains idempotent after complete close and retryable after a
rejection. Its independently observable contract is permanent environment
shutdown, non-destructive refusal while the environment is in use, ordered
owned-facility attempts, and no reuse after permanent admission. Public docs
must use “in use” and “permanently closed”; they must not expose registrations,
generations, coordinators, slots, explicit stop, checkpoints, or retry owners.

If TSDoc changes in this child, limit it to wording equivalent to:

> Permanently close this environment after it is no longer in use. If the
> environment is in use, close rejects non-destructively and performs no owned-
> facility teardown. Once close admission succeeds, the environment is
> permanently closed and cannot be reused. Failed facility-close attempts may be
> retried; facilities that already closed successfully are not closed again.

If this TSDoc ships, the same implementation slice must add semantically
matching wording to `packages/server/README.md`: in-use close rejects
non-destructively and performs no owned-facility teardown. Do not add README/
user-guide lifecycle claims that depend on server detach; T-0037f owns that
observable integration and documentation. No generated TypeDoc artifact is
committed.

## Implementation Slices

One existing `gpt-5.6-terra` / `medium` implementer should own the slices in
order with no overlapping writer. Each slice uses focused deterministic TDD,
the narrowest mechanical checks, and all four canonical review dispositions
before the next slice consumes it.

### Slice 1: Permanent Admission, Refusal, And Race

Ownership:

- `packages/server/src/server/environment-attachment.ts`
- `packages/server/src/server/server-environment.ts`
- new focused `packages/server/test/server/environment-close.test.ts`
- T-0037e3 task/work/review records

Acceptance:

- Public `ServerEnvironment.close()` coalesces one attempt that first awaits the
  package-internal permanent-admission promise and then invokes its existing
  facility group outside `#serial`, preserving duplicate-call promise identity.
- One live registration causes the exact plain in-use refusal before any
  readiness, worker, record, slot, or facility event; registration readiness
  and the current generation remain usable afterward.
- Deterministic gate-controlled races prove attach-first refusal and close-first
  permanent attach rejection. The losing attach performs no claim, descriptor,
  transition, storage, or worker work.
- A zero-registration/no-generation close permanently rejects later attach,
  `stopDelivery()`, and `retryDeliveryStop()`, closes normal facilities, and is
  idempotent. Stale `void` readiness is a no-op, not a rejection.
- A deterministic close-first/stop-second race proves the eager unadmitted stop
  is marked cancelled only while not completed, every provisional attach waiter
  rejects, admission does not await the behind-it stop or waiter-settlement
  promise, the queued stop turn rejects through its existing gate without
  lifecycle action, `#stop` remains clear, and a later attach deterministically
  rejects from permanent-close state.
- With the first owned facility held by a deterministic deferred promise, the
  cancelled stop and waiter settle while public close remains pending. This
  proves the permanent-admission callback released `#serial` before facility
  work. Releasing the facility then completes close.
- A deterministic stop-first/no-generation race creates one attach waiter and
  invokes close second. The stop turn marks `completed` and releases the waiter
  behind close; close leaves the completed `#stop` unchanged and commits after
  that turn; the queued attach rejects from permanent state; waiter settlement
  resolves the stop promise normally and the existing handler clears `#stop`.

Focused tests: public duplicate close, direct private registration refusal,
attach-first and close-first barriers, close-first/provisional-stop-second plus
waiter cleanup, deferred-facility/cancelled-stop settlement ordering,
stop-first/no-generation/completed-waiter/close-second ordering, no-generation
close, exact later attach/stop/retry-stop closed checks, stale-readiness no-op,
and unchanged existing facility ownership behavior.

Risk: creating permanent state before the serialized live-count check would
make refusal destructive; placing facility work in the callback would starve
queued lifecycle turns. Mitigation: set only the permanent-admission flag inside
the zero-registration/no-generation callback, explicitly cancel only an
unadmitted and not-completed later stop, return before close-group invocation,
and assert empty lifecycle/facility events on refusal, cancelled-stop settlement
while a facility is deferred, and normal completed stop-first settlement.

Exclusions: current-generation retirement, parked-cause consumption, facility
error retry, server/listener integration, public docs beyond narrow TSDoc.

### Slice 2: Retained-Owner Refusal And Reachability Proof

Ownership:

- `packages/server/src/server/environment-attachment.ts`
- `packages/server/test/server/environment-close.test.ts`
- existing focused regressions in
  `packages/server/test/server/environment-delivery-records.test.ts` and
  `packages/server/test/delivery/delivery-run-coordinator.test.ts` only when a
  missing inherited assertion is demonstrated
- T-0037e3 task/work/review records

Acceptance:

- Retained failed-start with zero registrations and a current generation rejects
  close through the existing failed-start explicit-retry-required channel.
  Permanent admission remains open; no close record, generation retirement,
  record selection/reporting, slot clear, facility attempt, or error-state
  mutation occurs. The exact failed-start retry still resumes and clears its
  own generation; a later close then succeeds from no-generation state.
- Unsafe last detach rejects close through the live-registration in-use channel.
  The exact handle, slot, endpoint dependencies, detach retry, and facilities
  are unchanged; no permanent-close state exists. `retryDetach()` remains the
  sole continuation.
- Incomplete admitted reusable stop rejects close through the live-registration
  in-use channel. The exact `GenerationStop`, candidate/checkpoints/buffer,
  registrations, waiters, and facilities are unchanged; no permanent-close
  state exists. `retryDeliveryStop()` remains the sole continuation.
- The static ownership proof establishes that zero registrations plus a current
  generation is legal only while the recognized failed-start owner is present,
  in which case close refuses. A defensive runtime branch treats any otherwise
  orphan generation as an invariant failure before permanent admission. No
  T-0037b caller is added for permanent close.
- Existing deterministic predecessor regressions prove unsafe quiescence keeps
  slot/dependencies/facilities, while replacement-safe reporting or inert
  cleanup failure clears the matching slot. A separately queued or later close
  then attempts all facilities; lifecycle and facility failures stay on their
  respective operation promises.
- Static scans prove permanent close calls neither `DeliveryGeneration.retire()`
  nor `DeliveryRunCoordinator.retire()` and does not alter the accepted callers
  in T-0037d/e1/e2.

Focused tests: retained failed-start close/refusal/retry/later close, unsafe
last-detach close/refusal/retry, incomplete reusable-stop close/refusal/retry,
exact state snapshots before/after each refusal, empty facility event logs,
safe-cleanup-failure followed by complete facility close, and static ownership/
retirement-caller checks. Do not add a test-only production seam to fabricate an
unreachable orphan state.

Risk: treating every zero-registration current generation as close-owned would
steal T-0037d rollback and duplicate retirement. Mitigation: recognized-owner
checks precede the no-generation invariant and permanent admission; tests prove
the predecessor operation remains byte-for-byte/identity-equivalent owner after
refusal.

Exclusions: implementing or changing failed-start rollback, detach, reusable
stop, T-0037b retirement, parked-record semantics, or server cleanup.

### Slice 3: Facility Continuation, Error Order, And Public Closure

Ownership:

- `packages/server/src/server/server-environment.ts`
- `packages/server/src/server/retryable-close.ts` only if focused RED evidence
  proves its existing ordered retry/flattening interface cannot be consumed
  without policy duplication
- `packages/server/test/server/environment-close.test.ts`
- `packages/server/test/server/server.test.ts`
- `packages/server/src/server/server-environment.ts` TSDoc only if needed;
- `packages/server/README.md` matching public in-use refusal/no-teardown wording
  whenever close TSDoc ships; no broader API prose
- T-0037e3 task/work/review records

Acceptance:

- Every facility is attempted despite an earlier facility failure. Facility
  errors remain ordered delivery, tracer, transport, storage in one flat
  `AggregateError`.
- Successful facilities close exactly once; failed facilities retry once per
  later `close()` attempt; successful earlier facility results never reappear.
- Caller-owned facilities are never closed. Missing/non-closeable existing
  entries preserve current `RetryableCloseGroup` behavior.
- Public/root exports, options, signatures, package `exports`, API manifest,
  examples, Protobuf, and generated tracked files remain unchanged. The existing
  `close()` TSDoc explicitly states non-destructive in-use rejection with no
  owned-facility teardown and permanent closure after admission; if it ships,
  the package README carries matching observable wording.
- Static caller scans prove only `EnvironmentAttachments` reaches
  permanent admission, only the coalesced `ServerEnvironment.close()` attempt
  reaches `RetryableCloseGroup` after that promise, no T-0037b primitive call was
  added, and server/handoff code has no permanent-close shortcut.

Focused tests: all-four-facility failure/continuation, partial facility success
plus retry, all-facility completion then idempotent close, caller-owned
exclusion, matching public TSDoc/README wording, public export/API checks, and
T-0037d/e1/e2 lifecycle regressions.

Risk: rethrowing the facility group's aggregate as one nested cause would break
deterministic error order. Mitigation: reuse `collectCloseError` and preserve the
existing top-level `ServerEnvironment close failed.` envelope.

Exclusions: `RunningServer` ordering, listener/session/context/resource close,
caller-owned server reuse, generated docs output, examples, full lifecycle
documentation, and any new public concept.

## Final Focused Gate

After all slices and reviews, run the focused permanent-close tests plus
T-0037d/e1/e2 attachment, detach, reusable-stop, delivery-record, coordinator,
and existing environment facility regressions; package/root public leak and API
checks; generated/protobuf cleanliness; typecheck, lint, cleanup enforcement,
format, and diff hygiene. Reserve full `pnpm verify` for final child acceptance
and post-merge verification as required by the protocol.

## Exact Exclusions

No detach or ordinary last-detach redesign; no failed-start rollback takeover;
no reusable stop, candidate, rebind, scope transfer, publication, or reopen; no
permanent-close invocation of the T-0037b retirement primitive; no
server/listener/session/context/resource integration; no retry timing, timer,
backoff, jitter, monitor, health, action, scheduler, or topology surface; no
adapter/catch-up/T-0036 change; no public retry/state/registration/generation
API, option, signature, declaration, or export; no README claim about caller-
owned server reuse; no examples, Protobuf, generated artifact, decision rewrite,
or accepted T-0037d/e1/e2 semantic change.

## Architecture Review-Fix Disposition

- HIGH reachability: narrowed permanent admission to the only legal unowned
  state, zero registrations and no generation. Recognized failed-start ownership
  refuses through its existing retry channel; orphan generation is an invariant
  error. Permanent close adds no T-0037b caller.
- P1 provisional stop: defined `cancelledByClose`, waiter rejection/settlement,
  cancellation only for `!admitted && !completed`, identity-safe `#stop`
  clearing, no close-side wait on the behind-it stop promise, queued-turn
  rejection with no lifecycle work, and normal stop-first completed-waiter
  settlement.
- P2 internal channels: attach, stop, and stop-retry reject through their promise
  channels after permanent admission; synchronous readiness acquires no error
  channel and stale retired-coordinator notification no-ops.
- P2 public docs: the bounded TSDoc explicitly says the environment is
  “permanently closed” and that in-use close rejects non-destructively with no
  owned-facility teardown; shipping it requires matching package README wording.
- MEDIUM retained states: deterministic tests now cover close during retained
  failed-start, unsafe last detach, and incomplete reusable stop, preserving the
  exact owner, admission, generation/slot, dependencies, facilities, and error
  state until that predecessor operation's existing retry completes.
- Authority P1: D-0085/D-0086 active outcomes and the runtime/completion-plan
  T-0037e3 sections now supersede the unreachable close-owned retirement branch
  while preserving predecessor ordering and public behavior.
- Serial-phase P1: permanent admission/cancellation returns and releases
  `#serial` before the public attempt invokes `RetryableCloseGroup`; a deferred-
  facility test requires the queued cancelled stop and waiter to settle first.

## Architecture Final-Fix Disposition

- Active authority: the exact D-0085/D-0086 body clauses now remove T-0037e3
  from generation retirement/quiescence ownership and explicitly mark the
  former assignment superseded; active body and outcome clarification agree.
- Stop ownership: close cancellation requires both `admitted === false` and
  `completed === false`. A completed stop-first no-generation operation remains
  owner of waiter settlement, is not cancelled, resolves normally after its
  queued waiter rejects from permanent state, and clears through its existing
  completion handler.
- Public docs: close TSDoc states non-destructive in-use rejection and no owned-
  facility teardown. Shipping that wording requires a semantically matching
  package README update in the same implementation slice.

No blocking architecture uncertainty remains. Other private helper spelling and
test-fixture mechanics may vary, but implementation may not change the named
cancellation checkpoint, owner, linearization point, phase order, replacement-
safety boundary, retry semantics, facility order, error order, cause-once
behavior, or public exclusions without a newly demonstrated architecture block.
