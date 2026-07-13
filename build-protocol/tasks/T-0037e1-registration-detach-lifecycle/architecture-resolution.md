# T-0037e1 Architecture Resolution

Status: Accepted for bounded implementation

## Private Surface

Extend only package-private `serverEnvironmentAccess` with handle-qualified
`detach(environment, attachment)` and `retryDetach(environment, attachment)`.
Keep `EnvironmentAttachmentHandle` opaque and validate its object identity and
owning environment. Per-handle detach state lives in a `WeakMap`; no public
registration, detach, retry, generation, or monitor surface is added.

Duplicate detach calls share one in-flight operation. Retry is valid only after
that operation rejects and resumes the retained checkpoints. A failed attach has
no handle and cannot enter ordinary detach. Failed-start retry and detach retry
remain independent state machines and entry points.

## Settlement Foundation

T-0037d stores startup-only parked obligations. Detach must additionally own
notification-driven coordinator settlements without duplicating cause history.

`DeliveryRunCoordinator` gains a private optional settlement observer and a
selected-owner barrier. The observer receives each new or changed settlement
when recorded, including rejected starts; reading a snapshot emits nothing.
Observer invariant failure faults the coordinator and is immediately observed.

The barrier removes selected pending admission, awaits the active turn and its
bounded already-admitted successor, removes selected pending admission again,
and resolves only when retained coordinator work cannot start the selected
owner. It neither closes generation admission nor deletes settled evidence or
sibling state.

One private generation-local `EnvironmentDeliveryRecords` module is the sole
mapping from ephemeral owner/scope identity to registration and generation
obligations. It registers initial and dynamic zero-to-first scopes with
deduplication, observes settlement changes, and consumes detach/retirement
selections through the existing `ParkedDeliveryObligations` table. It does not
create another cause ledger.

Settlement semantics are:

- `REJECTED`: park exact configured obligation and representative cause;
- `PARKED`: retain cause-less operational readiness;
- `IDLE`: consume matching successfully re-evaluated work;
- `STOPPED`: do not claim successful re-evaluation.

Detach selection removes the departing registration's configured ownership,
selects newly wholly orphaned generation records, leaves any sibling/shared
record parked, marks selected representatives reported before returning causes,
and consumes only selected operational records. Report callback failure is
therefore attempted once and never repeated by retry.

## Non-Last Detach

After serialized validation, close only departing readiness and fix last versus
non-last classification once. For non-last detach:

1. stop departing owners;
2. await selected worker settlement;
3. establish selected-owner coordinator barrier;
4. classify/consume departing and newly orphaned records;
5. attempt external reporting once;
6. permanently retire selected workers;
7. remove selected coordinator state;
8. remove registration state.

Before proven quiescence/barrier, failure performs no classification,
reporting, permanent retirement, coordinator deletion, or endpoint teardown.
Retry repeats only incomplete stop/barrier work. After the barrier, reporting
and inert-cleanup failures are accumulated while safe cleanup continues in
report, worker-retirement, coordinator-removal order. A single error keeps its
identity; multiple failures use ordered `AggregateError`.

Sibling generation identity, readiness, pending scopes, workers, endpoints, and
facilities remain usable. A synchronous worker-start invariant that already
terminally faulted the whole coordinator is outside this guarantee: detach
preserves sibling state/endpoints but the generation-wide fault remains until
T-0037e2 replaces the generation. T-0037e1 does not acquire reusable-stop
authority to hide that fault.

## Ordinary Last Detach

Last detach closes readiness and invokes existing `DeliveryRunCoordinator.retire`
exactly once. Its callback consumes/reports all generation records. Preserve
authoritative order: close admission/stop, await quiescence, classify,
consume/report, permanently retire/clean up. If `replacementSafe` is true, a
finally-equivalent path clears the generation map and matching empty
registration slot before propagating reporting or inert-cleanup error.

Unproved quiescence retains the generation slot, endpoint dependencies, and
same detach operation; it performs no later phase. Explicit detach retry resumes
coordinator checkpoints without duplicating completed stop. A later attachment,
not retry, creates one fresh generation after safe clearing.

## Serialization

Move attachment claim and generation capture inside the lifecycle serial gate.
An attach admitted before last-detach retirement joins the current generation,
making detach non-last. Last detach admitted first marks retirement; a later
attach performs no descriptor/route work until it settles, then creates/joins
one fresh generation after safe clearing. Unsafe retirement rejects queued
attachment with detach-retry-required behavior and never retries implicitly.

## TDD Slices

1. Settlement observer, selected-owner barrier, incremental parked ownership,
   repeated rejection bounds, fulfilled re-evaluation, dynamic registration,
   and sibling preservation.
2. Non-last detach ordering, active rejection, orphan selection, cause-less
   operational consumption, retry checkpoints, inert cleanup, sibling use.
3. Last-detach exact order, reporting/cleanup errors, unsafe quiescence retry,
   slot clearing, one later fresh generation.
4. Attach-before/after-stop races, unsafe blocking, foreign/forged/stale/
   duplicate handles, and failed-start/detach retry separation.

Each slice receives focused verification and the four canonical review lanes.
Full `pnpm verify` remains the final child and post-merge gate.

## Evidence And Exclusions

Relevant Spine JVM evidence supports unregisterable inbox callbacks, delivery-
owned targets, network rejection before context closure, and environment-owned
facilities. It does not define a detach retry handle or TS concurrency policy;
D-0085/D-0086 remain authoritative.

Excluded: reusable generation stop, survivor rebind/transfer, permanent close,
facilities, server/listener integration, public lifecycle controls, scheduling,
monitor actions, topology, catch-up, adapters, T-0036 changes, and examples.

## Slice 1 Recorded Outcome

The implementation keeps the coordinator observer synchronous and package
internal so an observer invariant error enters the coordinator's existing fault
path at the recording point. `EnvironmentDeliveryRecords` is the single deep
module mapping generation-local scope identity to the existing parked table;
it extends configured units in first-registration order and exposes later
atomic detach/retire selection-consumption primitives without retaining a
separate cause history. Settlement change equality compares disposition, cause
identity, progress counters, and per-failure message/error identity. The parked
table retains at most one cause per configured unit so exact fulfillment can
deterministically reselect the next configured rejected unit without an
unbounded history.

Round 1 hardening keeps observer invocation synchronous and rejects any returned
thenable with a stable coordinator invariant error while consuming its eventual
rejection. Selected-owner barriers consult retained terminal fault state around
both bounded waits. Parked reporting filters to selected, unreported per-unit
causes before configured-order choice. Atomic record detach reclassifies the
departing registration first, then reports/consumes only newly orphaned
generation units, retaining earlier shared causes for later selection.

## Slice 2 Recorded Outcome

The accepted non-last sequence is implemented behind the package-private
environment access seam. Exact handle identity is environment-owned, and one
`WeakMap` operation retains the original promise/status plus generation-local
detach checkpoints. Readiness closes before selected owners stop; worker
quiescence and the coordinator selected-owner barrier precede any records,
reporting, permanent retirement, or coordinator reclamation.

After the barrier, `EnvironmentDeliveryRecords.detach(token)` is the sole
ownership/cause classification operation. Reporting is marked attempted before
awaiting the external callback, selected worker retirement is likewise a
single inert attempt, and coordinator owner removal is retried until successful.
Only successful coordinator reclamation removes configured owners, overlap
domains, descriptors/runtimes, and registration ownership. This preserves the
shared generation and all sibling state. Terminal coordinator faults remain
terminal; ordinary worker rejection remains settlement evidence.

Ordinary last detach is deliberately rejected before readiness or lifecycle
mutation. Attach/last-detach race policy, authoritative last retirement,
reusable stop, permanent close, facilities/server wiring, and public lifecycle
surface remain assigned to later slices.
