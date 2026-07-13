# T-0037e3 Architecture Resolution

Status: Architecture fix re-review assigned

## Resolution Summary

Keep permanent close inside the existing `EnvironmentAttachments` lifecycle
module and its existing serial gate. `ServerEnvironment.close()` remains the
only public entry and delegates to that environment-owned operation before any
owned facility closes. Add no public close variant, retry method, state query,
option, error type, declaration, or export.

One private `EnvironmentClose` operation record owns only permanent-close
admission and the current facility-close attempt. It is a record local to
`environment-attachment.ts`, not a new class or exported seam. The existing
`RetryableCloseGroup` continues to own the ordered facility list and its
successful-index retry checkpoints. `ServerEnvironment` supplies that one
existing group to `EnvironmentAttachments` at construction; it does not
interpret generation state or duplicate close phases.

This is the smallest deep interface: public callers know only
`close(): Promise<void>`, while registration admission, close/attach/stop
ordering, retained-owner refusal, facility retry, and error ordering remain
package-local.

## Evidence

### Accepted TypeScript Contract

- D-0085 in `build-protocol/DECISION_LOG.md` requires a serialized live-
  registration refusal, permanent zero-registration admission closure, the
  authoritative stop/await/classify/consume-report/retire order, unsafe-slot
  retention, and exact-once facility teardown on retry.
- D-0086 assigns only permanent environment close to T-0037e3. T-0037d owns
  failed-start rollback, T-0037e1 owns detach and last-detach retry, T-0037e2
  owns reusable stop and fresh-generation transition, and T-0037f owns server,
  listener, context, and resource integration.
- `DeliveryRunCoordinator.retire()` in
  `packages/server/src/delivery/delivery-run-coordinator.ts` already closes
  admission, stops once, proves quiescence, invokes the caller's classification/
  consumption/report callback, attempts permanent worker retirement, and
  exposes `replacementSafe`. T-0037e3 must invoke it only through the existing
  `DeliveryGeneration.retire()` owner in
  `packages/server/src/server/environment-attachment.ts`.
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
  `EnvironmentAttachments.#serial`; permanent close must join that gate rather
  than add a second lock or promise queue.
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
- **Proven quiescence**: `DeliveryGeneration.replacementSafe === true` after the
  T-0037b primitive has completed stop and settlement. A stopped flag without
  this postcondition is not sufficient.
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
its promise after rejection so the same public method is the retry entry. It is
not the semantic state owner.

The private operation needs only these checkpoints:

- permanent admission committed;
- facilities complete; and
- current attempt promise/status.

The facility group remains the only per-facility completion ledger. Do not copy
its indexes or owned-closeable list into `EnvironmentClose`.

| State              | Attachment/explicit-stop admission | Generation                                          | Facilities                                               | Permitted next action                                        |
| ------------------ | ---------------------------------- | --------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ |
| Open               | Open                               | Absent, live, or retained by its existing operation | Open                                                     | Existing lifecycle operation or close admission              |
| Refused            | Unchanged open state               | Unchanged in the same existing owner                | Unchanged                                                | Complete/retry the existing owner, then call `close()` again |
| Closing facilities | Permanently closed                 | Absent                                              | Successful facilities closed; failed facilities retained | The same public `close()` retries only failed facilities     |
| Closed             | Permanently closed                 | Absent                                              | Every owned facility closed                              | Repeated `close()` resolves; attach/explicit stop reject     |

## Serialized Admission And Close/Attach Linearization

`EnvironmentAttachments.close()` enters the same `#serial` chain as attach,
detach, failed-start retry, and reusable stop. It performs no facility work
before serialized admission.

1. At admission, check exact live-registration count first.
2. If the count is non-zero, reject with one plain `Error` whose fixed message
   is `ServerEnvironment cannot close while it is in use.` Do not create or
   retain `EnvironmentClose`; do not close readiness/admission, stop work,
   classify or consume records, clear a slot, or call any facility. The existing
   generation and registrations remain usable.
3. With zero registrations, inspect retained owners before current-generation
   reachability. A retained failed-start rollback receives the existing
   `Environment generation rollback requires an explicit retry.` rejection.
   Permanent close never advances that operation.
4. Distinguish an eager T-0037e2 `#stop` with `admitted === false` from an
   admitted or retained stop. Because its queue position is after this close,
   it has no generation ownership. Add exactly
   `cancelledByClose: Error | undefined` to package-private `GenerationStop`.
   Set it to one plain `Error("ServerEnvironment is closed.")`. Snapshot the
   waiting attachment gates, empty `waiters`, set `waitersReleased`, attach
   `Promise.allSettled()` to their promises as `waiterSettlement`, then mark
   each waiter complete and reject its gate with that same error. This order
   installs rejection observers before settlement. Clear `#stop` only when it
   still identifies this provisional record. Do **not** await `stop.promise`
   from close: its serial turn is behind close and doing so would deadlock
   admission. When that queued turn arrives, `#continueStop()` checks the
   cancellation reason before retained-owner or generation work, sets
   `completed`, awaits only the waiter settlement, and throws that same closed
   error through its existing local gate. The public stop promise therefore
   rejects deterministically and its existing completion handler cannot restore
   or retain `#stop`.
5. Require both the current registration generation marker and generation map
   to be empty. A remaining generation without a recognized retained owner is
   an invariant error before permanent admission, not permission to call
   T-0037b.
6. Create the private close record and commit permanent attachment and explicit-
   stop admission closure. The commit is irreversible; readiness has no
   rejectable channel and is handled separately below.

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
  waiter remains pending. Close does not wait for the behind-it stop turn;
- stop whose serial turn runs first either completes its no-generation no-op or
  becomes an admitted T-0037e2 owner. Close observes that completed state or
  refuses the live/retained owner; it never cancels an admitted stop.

Duplicate in-flight public close calls share the existing public attempt
promise. After a facility rejection, the next `close()` resumes the retained
facility group; no `retryClose()` interface is added.

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

After permanent admission wins, no generation or parked record remains for
T-0037e3 to retire, classify, consume, or report. Those actions completed in
the predecessor owner, or close refused that retained owner. Permanent close
therefore invokes neither `DeliveryGeneration.retire()` nor
`DeliveryRunCoordinator.retire()` and creates no quiescence/reporting failure
branch.

Attempt every owned facility through the existing close group in fixed
delivery, tracer, transport, storage order. Facility semantics remain:

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

> Permanently close this environment after it is no longer in use. Once close
> admission succeeds, the environment is permanently closed and cannot be
> reused. Failed facility-close attempts may be retried; facilities that already
> closed successfully are not closed again.

Do not add README/user-guide lifecycle claims that depend on server detach;
T-0037f owns that observable integration and documentation. No generated
TypeDoc artifact is committed.

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

- Public `ServerEnvironment.close()` delegates to the existing attachment owner
  before its facility group and preserves duplicate-call promise identity.
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
  is marked cancelled with the closed error, every provisional attach waiter
  rejects, close does not await the behind-it stop promise, the queued stop turn
  rejects through its existing gate without lifecycle action, `#stop` remains
  clear, and a later attach deterministically rejects from permanent-close
  state.

Focused tests: public duplicate close, direct private registration refusal,
attach-first and close-first barriers, close-first/provisional-stop-second plus
waiter cleanup, no-generation close, exact later attach/stop/retry-stop closed
checks, stale-readiness no-op, and unchanged existing facility ownership
behavior.

Risk: creating permanent state before the serialized live-count check would
make refusal destructive. Mitigation: create `EnvironmentClose` only inside the
zero-registration/no-generation serial admission step, explicitly cancel only
an unadmitted later stop, and assert an empty lifecycle/facility event log on
refusal.

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
- `packages/server/src/server/environment-attachment.ts`
- `packages/server/src/server/retryable-close.ts` only if focused RED evidence
  proves its existing ordered retry/flattening interface cannot be consumed
  without policy duplication
- `packages/server/test/server/environment-close.test.ts`
- `packages/server/test/server/server.test.ts`
- `packages/server/src/server/server-environment.ts` TSDoc only if needed;
  package README/API prose only for directly observable close behavior
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
  README terminology, examples, Protobuf, and generated tracked files remain
  unchanged except a narrowly justified existing `close()` TSDoc refinement.
- Static caller scans prove only `EnvironmentAttachments` reaches
  permanent facility close, no T-0037b primitive call was added, and server/
  handoff code has no permanent-close shortcut.

Focused tests: all-four-facility failure/continuation, partial facility success
plus retry, all-facility completion then idempotent close, caller-owned
exclusion, public export/API checks, and T-0037d/e1/e2 lifecycle regressions.

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
  identity-safe `#stop` clearing, no close-side wait on the behind-it stop
  promise, and queued-turn rejection with no lifecycle work.
- P2 internal channels: attach, stop, and stop-retry reject through their promise
  channels after permanent admission; synchronous readiness acquires no error
  channel and stale retired-coordinator notification no-ops.
- P2 public docs: the bounded TSDoc text explicitly says the environment is
  “permanently closed.”
- MEDIUM retained states: deterministic tests now cover close during retained
  failed-start, unsafe last detach, and incomplete reusable stop, preserving the
  exact owner, admission, generation/slot, dependencies, facilities, and error
  state until that predecessor operation's existing retry completes.

No blocking architecture uncertainty remains. Other private helper spelling and
test-fixture mechanics may vary, but implementation may not change the named
cancellation checkpoint, owner, linearization point, phase order, replacement-
safety boundary, retry semantics, facility order, error order, cause-once
behavior, or public exclusions without a newly demonstrated architecture block.
