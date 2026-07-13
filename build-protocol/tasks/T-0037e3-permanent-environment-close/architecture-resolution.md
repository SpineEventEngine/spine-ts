# T-0037e3 Architecture Resolution

Status: Architecture review assigned

## Resolution Summary

Keep permanent close inside the existing `EnvironmentAttachments` lifecycle
module and its existing serial gate. `ServerEnvironment.close()` remains the
only public entry and delegates to that environment-owned operation before any
owned facility closes. Add no public close variant, retry method, state query,
option, error type, declaration, or export.

One private `EnvironmentClose` operation record owns permanent-close admission,
the selected zero-registration generation, retirement/slot checkpoints,
already-emitted lifecycle failures, and the current attempt promise. It is a
record local to `environment-attachment.ts`, not a new class or exported seam.
The existing `RetryableCloseGroup` continues to own the ordered facility list
and its successful-index retry checkpoints. `ServerEnvironment` supplies that
one existing group to `EnvironmentAttachments` at construction; it does not
interpret generation state or duplicate close phases.

This is the smallest deep interface: public callers know only
`close(): Promise<void>`, while registration admission, close/attach ordering,
generation retirement, safe slot clearing, record reporting, facility retry,
and error ordering remain package-local.

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
  readiness trigger, generation, or replacement.
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
- selected current generation, if any;
- generation retirement replacement-safe;
- matching generation slot cleared;
- ordered lifecycle failures pending emission or already emitted;
- facilities complete; and
- current attempt promise/status.

The facility group remains the only per-facility completion ledger. Do not copy
its indexes or owned-closeable list into `EnvironmentClose`.

| State              | Registration/trigger admission | Generation and dependencies                           | Facilities                                               | Permitted next action                                           |
| ------------------ | ------------------------------ | ----------------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------- |
| Open               | Open                           | Current slot may be absent or live                    | Open                                                     | Attach/detach/stop or close admission                           |
| Refused            | Unchanged open state           | Unchanged                                             | Unchanged                                                | Caller closes live servers, then calls `close()` again          |
| Closing unsafe     | Permanently closed             | Exact old slot and all endpoint dependencies retained | Unattempted                                              | The same public `close()` retries quiescence                    |
| Closing facilities | Permanently closed             | Proven-quiescent slot cleared                         | Successful facilities closed; failed facilities retained | The same public `close()` retries only failed facilities        |
| Closed             | Permanently closed             | No current slot                                       | Every owned facility closed                              | Repeated `close()` resolves; all attach/trigger attempts reject |

A replacement-safe reporting or inert-retirement failure may make the first
attempt reject after the operation has already reached `Closed`. That failure
is emitted once; a later idempotent `close()` resolves and does not report it
again.

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
3. With zero registrations, refuse any retained T-0037d/e1/e2 operation through
   its existing explicit-retry-required channel. Permanent close does not take
   over failed-start rollback, detach, or reusable-stop state.
4. Otherwise create the private close record and commit permanent admission
   closure before awaiting retirement. That commit is irreversible even if
   quiescence later fails.

The serial admission order is the race linearization point:

- attach admitted first claims a registration; close then sees a live count and
  refuses non-destructively;
- close admitted first sees zero, commits permanent admission, and the queued
  attach later rejects with plain `Error("ServerEnvironment is closed.")`
  before claim, descriptor enumeration, route transition, storage lookup, or
  worker construction;
- quiescence failure does not reopen the environment, so an attach ordered
  after the winning close rejects rather than waiting for close retry.

Duplicate in-flight public close calls share the existing public attempt
promise. After an unsafe or facility rejection, the next `close()` resumes the
retained close record; no `retryClose()` interface is added.

## Authoritative Close Order

After permanent admission wins:

1. If no current generation exists, record retirement/slot phases complete
   without manufacturing a coordinator, generation, registration, or parked
   record.
2. If a current generation exists, invoke `DeliveryGeneration.retire()`.
   Never call `DeliveryRunCoordinator.retire()` directly and never call
   T-0037e2 `stopDelivery()`: the former would duplicate generation ownership,
   while the latter would create a fresh candidate and reopen admission.
3. The existing call path performs T-0037b order: close coordinator admission
   and notification, stop, await quiescence, classify, call
   `EnvironmentDeliveryRecords.retire()` to select/consume/report, then attempt
   permanent worker retirement/cleanup.
4. If `replacementSafe` is false, propagate that unsafe retirement reason and
   stop. Retain the exact generation map entry, registration generation marker,
   descriptors/runtimes, endpoint dependencies, and every owned facility. Run
   no classification/consumption/reporting beyond what the primitive permits,
   no slot clear, and no facility close. Retry re-enters the same coordinator
   retirement checkpoints; completed admission closure and stop are not
   repeated.
5. If `replacementSafe` is true, retain the primitive's ordered failure causes,
   if any, and synchronously clear only the matching zero-registration current
   slot through one validated finally-equivalent path. Delete no different or
   fresh generation.
6. Attempt every owned facility through the existing close group in fixed
   delivery, tracer, transport, storage order, even when reporting, inert
   retirement, or an earlier facility close failed.
7. Mark lifecycle failures emitted and expose the attempt result only after the
   slot-clear and complete facility pass.

Proven quiescence makes report/retirement cleanup failures inert: they cannot
reactivate worker admission or endpoint invocation. Therefore they cannot block
safe slot clearing or later facilities. A quiescence failure is categorically
different and blocks both.

## Error And Cause Semantics

- Unsafe stop/quiescence failure propagates the exact current retirement reason
  and performs no facility aggregation because no later phase is safe.
- `EnvironmentDeliveryRecords.retire()` remains the only cause-selection
  operation. It reports eligible original unreported cause objects once in
  the existing configured record/unit order, marks them reported atomically,
  and consumes all generation records. Already-reported unresolved causes are
  consumed but are not passed to the report callback again.
- Report callback failure and permanent-retirement cleanup failure retain the
  order produced by the T-0037b primitive. They are not retried after
  `replacementSafe`; the close operation checkpoints them as emitted after the
  complete close attempt.
- Facility failures retain existing owned-closeable order. Every owned facility
  receives one attempt in the first safe teardown pass. A successful close is
  never invoked again. A failed facility receives one new attempt per explicit
  later `close()` call until it succeeds; later facilities are attempted on
  every pass in which they remain incomplete.
- After replacement safety, flatten the current primitive causes and the
  current facility group's `AggregateError.errors` into one ordered
  `AggregateError` with the existing message `ServerEnvironment close failed.`
  Lifecycle causes come first; facility causes follow in delivery, tracer,
  transport, storage order. Do not nest aggregate envelopes or add `cause`,
  codes, result objects, or custom error classes.
- Causes/errors already emitted by a completed safe phase are absent from a
  later retry. A retry reports only failures from work actually attempted in
  that retry.

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

> Permanently close this environment after it is no longer in use. Failed close
> attempts may be retried; facilities that already closed successfully are not
> closed again.

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
- A zero-registration/no-generation close permanently rejects later attach and
  internal stop/trigger admission, closes normal facilities, and is idempotent.
- Retained failed-start, detach, or reusable-stop work remains owned by its
  existing explicit retry path; close does not advance it.

Focused tests: public duplicate close, direct private registration refusal,
attach-first and close-first barriers, no-generation close, later attach/stop
rejection, and unchanged existing facility ownership behavior.

Risk: creating permanent state before the serialized live-count check would
make refusal destructive. Mitigation: create `EnvironmentClose` only inside the
zero-registration serial admission step and assert an empty lifecycle/facility
event log on refusal.

Exclusions: current-generation retirement faults, parked causes, facility error
aggregation, server/listener integration, public docs beyond narrow TSDoc.

### Slice 2: Generation Retirement, Slot Safety, And Cause Once-Only

Ownership:

- `packages/server/src/server/environment-attachment.ts`
- `packages/server/test/server/environment-close.test.ts`
- existing focused regressions in
  `packages/server/test/server/environment-delivery-records.test.ts` and
  `packages/server/test/delivery/delivery-run-coordinator.test.ts` only when a
  missing inherited assertion is demonstrated
- T-0037e3 task/work/review records

Acceptance:

- A current zero-registration generation is retired only through
  `DeliveryGeneration.retire()` in exact stop, await, classify, consume/report,
  permanent-retire order; no reusable-stop candidate or direct coordinator
  caller is introduced.
- Separate stop/await quiescence failures retain the exact slot, generation,
  descriptors/runtimes, endpoint dependencies, and facilities; perform no
  later authoritative phase; and keep permanent admission closed.
- Repeated public close calls coalesce per attempt. Explicit later close retry
  resumes the same primitive, does not duplicate successful admission closure
  or stop, proves quiescence, completes remaining phases once, and clears only
  the matching slot.
- Eligible unreported original causes reach the report callback once in stable
  order. An already-reported unresolved cause is consumed by permanent close
  without callback or propagation. Cause-less parked work is consumed silently.
- A reporting failure and an inert retirement failure each still leave the old
  instance permanently inert and the slot safely cleared before propagation;
  neither failure appears on a later close retry.

Focused tests: stop throw, await rejection, same-operation retry checkpoint
counts, exact event order, slot identity, unreported/reported/cause-less records,
separate report and retire failures, and no old/new generation construction.

Risk: calling the primitive again after replacement safety can repeat a report
or inert cleanup error. Mitigation: checkpoint replacement safety and ordered
primitive causes in `EnvironmentClose`, then clear the generation reference
before any external result is exposed.

Exclusions: facility fault continuation, reusable candidate/rebind/transfer,
ordinary detach, failed-start rollback, server cleanup.

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

- Independent report and inert-retirement failures each precede facility
  failures in one flat `AggregateError`; facility errors remain ordered
  delivery, tracer, transport, storage.
- Every facility is attempted despite earlier safe lifecycle or facility
  failure. Successful facilities close exactly once; failed facilities retry
  once per later `close()` attempt; already-emitted lifecycle errors never
  reappear.
- Quiescence failure attempts no facility. Its successful retry clears the slot
  before the first facility event and closes every owned facility.
- Caller-owned facilities are never closed. Missing/non-closeable existing
  entries preserve current `RetryableCloseGroup` behavior.
- Public/root exports, options, signatures, package `exports`, API manifest,
  README terminology, examples, Protobuf, and generated tracked files remain
  unchanged except a narrowly justified existing `close()` TSDoc refinement.
- Static caller scans prove only `EnvironmentAttachments` reaches
  `DeliveryGeneration.retire()` for permanent close, no direct T-0037b primitive
  call was added, and server/handoff code has no permanent-close shortcut.

Focused tests: all-four-facility failure/continuation, mixed lifecycle/facility
failure order, partial facility success plus retry, all-facility completion
plus earlier lifecycle error then idempotent close, caller-owned exclusion,
public export/API checks, and T-0037d/e1/e2 lifecycle regressions.

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
server/listener/session/context/resource integration; no retry timing, timer,
backoff, jitter, monitor, health, action, scheduler, or topology surface; no
adapter/catch-up/T-0036 change; no public retry/state/registration/generation
API, option, signature, declaration, or export; no README claim about caller-
owned server reuse; no examples, Protobuf, generated artifact, decision rewrite,
or accepted T-0037d/e1/e2 semantic change.

No blocking architecture uncertainty remains. Private field/helper spelling and
test-fixture mechanics may vary, but implementation may not change the owner,
linearization point, phase order, replacement-safety boundary, retry semantics,
facility order, error order, cause-once behavior, or public exclusions without
a newly demonstrated architecture block.
