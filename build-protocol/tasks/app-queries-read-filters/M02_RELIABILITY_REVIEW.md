# M02 performance and reliability review

Existing `performance_reliability_reviewer` concern, explicit `gpt-6-sol` /
`medium` dispatch recorded in `REVIEW.md`. Runtime model metadata is not exposed
on this surface. Reviewed the M02 diff from `3227be3ac` and the untracked core
module-inventory test. No production files were changed by this reviewer.

## P0–P2 findings

### P2 — Admission callbacks can change validated Command and Event snapshots

Both buses clone caller input on enqueue, then validate the queued message
before invoking the configured admission callback. The callback receives that
same mutable object: `CommandBus.#dispatch()` passes `command` to `onAdmit`
and then `dispatcher.dispatch(command)` (`command-bus.ts:266–269`);
`EventBus.#dispatch()` passes `event` to `onAdmit` and then to
`acceptThenAppend(event, ...)` or `#accept(event, ...)`
(`event-bus.ts:399–428`). The M02 change moved Event validation ahead of
`onAdmit`, making this gap apply to the newly validated Event envelope too.
The current BoundedContext admission callbacks only read tenant context, but
`commandBusAccess.setAdmission()` and `eventBusAccess.setAdmission()` accept
mutable messages and are invoked at these exact boundaries.

A callback that changes `event.id`, `event.context`, or `event.message` after
validation can cause an invalid Event to reach acceptance and persistence.
Likewise, a callback can change a validated Command ID or payload before its
dispatcher receives it. The initial enqueue clone protects against mutation by
the original caller, not this intervening callback. Pass a detached clone to
admission, or otherwise ensure the validated queued message cannot be changed
by admission. Add focused tests where admission deliberately mutates its
argument and assert the accepted/stored/dispatched message remains the
validated snapshot. This retains current admission ordering and tenant checks.

## Other changed-path disposition

The generated-module inventory returns a stable array snapshot and invalidates
it only after an atomic registration. `GeneratedDescriptors.current()` now
rebuilds the descriptor registry and type lookup together from that snapshot;
no partial cache update is visible synchronously. Explicit registry overrides
still take precedence. The new core test and supplied packed-consumer check
cover automatic application `Any` lookup from an ordinary registered module.

Command envelope validation precedes route selection and bus admission;
constraint failures remain error Acks with structured details, while technical
validator errors take the technical Command path. Event validation now precedes
admission and `EventStore.acceptThenAppend()`, with stored/follow-up paths still
checking before delivery. Storage retains its own cloned record and uniqueness
check. No new retry, queue-drain, or shutdown state was introduced in M02.

The supplied frozen verification reports 243 focused tests, generated build and
cheap checks, and a packed consumer passing, with changed statement coverage
96.6% and branch coverage 95.45%. The full global 90% gate remains scheduled
for M14. This reviewer did not rerun the full suite.
