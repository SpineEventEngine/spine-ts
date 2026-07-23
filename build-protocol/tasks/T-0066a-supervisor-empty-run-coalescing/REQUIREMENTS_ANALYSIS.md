# T-0066a Requirements Analysis

Status: accepted.

## Decision

Use the existing package-internal immutable epoch admission as the point-in-time
emptiness proof. Every supervisor-controlled run may suppress empty pickup; the
public manual run remains unchanged.

1. `Delivery.runControlled()` marks the loop as eligible for empty suppression.
2. `DeliveryLoop` performs its existing `TO_DELIVER` epoch admission read.
3. After the existing stop check, an empty controlled epoch returns the normal
   completed result with one zero-valued `IDLE` page, without `pickUp()` or
   `release()`.
4. `onPage` and `onCompleted` retain their behavior; `onStarted` does not run
   because ownership was never acquired.

Likely production ownership is limited to
`packages/server/src/delivery/delivery.ts` and `delivery-loop.ts`, plus focused
delivery tests and task records. No Admin, client, Protobuf, storage, dependency,
or public declaration change is allowed.

## Safety Invariant

Existing supervisor state already carries bounded generations:

- `active` is the current generation;
- `pending` is one dirty successor per shard;
- `rescanRequired` is one bounded global overflow-recovery bit.

The shard stays active while empty admission settles. Notifications during that
read repopulate pending; notifications after settlement start immediately. An
arrival before successor admission makes it non-empty. An arrival during or after
an empty admission becomes a later dirty generation. Watch restart and periodic
recovery remain the eventual-discovery fallback. Close intentionally clears
pending and aborts controlled admission.

Admission failure, paused/skipped/unsupported rows, a non-empty epoch drained by
another process, and cancellation are not classified as empty and retain existing
semantics.

## Required RED/GREEN Matrix

- Watch notification then recovery snapshot, and reverse ordering: two controlled
  admissions but only one pickup/release when the successor is empty.
- Same-shard notification storm remains bounded and does not reacquire for an
  empty successor.
- A row arriving after the first admission, while empty successor admission is in
  flight, and immediately before controlled completion is retained and drained.
- Close during empty admission performs no later pickup.
- Admission failure is not treated as empty and does not spin.
- Controlled empty completion returns `COMPLETED` with one zero `IDLE` page,
  `onPage`/`onCompleted`, and no `onStarted`.
- Public `Delivery.run()` on an empty shard preserves current pickup/release
  behavior.
- Existing distinct-shard concurrency, pending overflow/rescan, watch restart,
  recovery timer, fencing, and non-empty behavior remain green.

## T-0066 Integration Consequence

The accepted 20-frame semantic total is sound after this correction. The fixture
must also add event-driven `NOT_PICKED/0` terminal barriers between ordinary
phases and before final count inspection so legal batching or stream lag cannot
change topology. No arbitrary sleep is needed.

## Review And Verification

- Performance/reliability and style/maintainability are required.
- Documentation and TypeScript/API are N/A if claims/exports stay unchanged.
- Run focused supervisor, run-control, loop, fencing, and environment-delivery
  suites, generated build/tooling checks, touched lint/format/diff checks, then the
  full repository gate.
- After merge, back-merge into T-0066 and require its native topology suite twice.

## Metadata

Existing requirements-splitter role was explicitly dispatched
`gpt-5.6-sol` / `high`. Runtime self-introspection was unavailable; the immutable
configured role/profile is the accepted actual evidence with no visible fallback.
