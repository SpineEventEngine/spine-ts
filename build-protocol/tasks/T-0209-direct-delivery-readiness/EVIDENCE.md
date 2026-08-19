# T-0209 Evidence

## Planning evidence

- Baseline: `origin/main@722a62b4704a5d910db22e7f9934bfd5535a151b`.
- Frozen authority: D-0126 and
  `build-protocol/planning/T-0203_COMPLETE_REPLICA_DEPLOYMENT_PLAN.md`, in
  particular Delivery wiring disposition, readiness/drain contract, RED 22–28,
  T-0209 ownership, exclusions, and frozen replacement policy.
- Current implementation evidence: `RemoteDelivery.source` and
  `DeliverySupervisor` implement existing remote snapshot/update, reconnect,
  fencing and active/pending-idle mechanics. `ManagedServerApplication.child()`
  currently gates READY only through optional `synchronize()`.

## Planned RED/GREEN evidence

| RED | Behavior to prove | Evidence status |
| --- | --- | --- |
| 22 | Each READY real managed child observes Delivery directly | pending |
| 23–25 | Existing lease/fencing remains exclusive; cross-node work and drain do not strand work | pending/reuse existing suites |
| 26 | Admin failure/overflow takes a fresh snapshot | pending/reuse existing supervisor suite |
| 27 | DRAINING denies new work, completes active fenced work, relays final update before close | pending |
| 28 | Replacement cannot receive unary/Delivery admission before Delivery snapshot and retained subscriptions | pending |

No test-forwarder or direct fake notification will be recorded as complete-replica acceptance.

## Superseded provenance investigation

`ManagedServerApplicationOptions` has `createServer` and optional opaque
`synchronize` only. `ServerEnvironment.delivery` is a generic closeable, and
its internal openable form establishes ports/source only after assembly.
`BoundedContextBuilder` defaults and snapshots its strategy. Therefore the
current contracts cannot distinguish an explicitly configured remote/shared
facility or explicit strategy selection from the default/local alternatives.
The controlling disposition is that this distinction must not be certified by
runtime. Fixture application assembly configures it; existing `Server.start()`
already waits for openable Delivery readiness, and managed `synchronize()`
remains the retained-subscription readiness gate.

## RED/GREEN evidence: DRAINING admission

- RED: focused managed-server test failed with a DRAINING child still present
  in `readyMembers()`.
- GREEN: the same command passed **1/1** after private child-to-parent
  `draining` notification removes the exact READY incarnation before existing
  server close/delivery settlement. No payload is sent over IPC.
- Regression: after `pnpm typecheck:build:generated` refreshed fixtures that
  import `packages/server/dist`, the full focused managed lifecycle suite
  passed **52/52** using the default process-capable Vitest profile.

## Existing direct remote Delivery regression

`pnpm exec vitest run packages/delivery-client/test/remote-supervisor-grpc.integration.test.ts`
passed **5/5** with a real Delivery Server and two separate application
processes. It proves direct remote Admin fan-out, exclusive fenced commit,
restart snapshot recovery, and tiny-buffer overflow recovery. This is retained
RED 22–26 regression evidence only: its children are environment assemblies,
not `ManagedServerApplication` replicas, so it does not close RED 27–28.

## Joined managed remote fixture RED

The new integration fixture starts one managed parent with **two** real child
replicas against a real `DeliveryServer`; children configure `RemoteDelivery`,
select a two-shard strategy during assembly, and await child-only
synchronization before READY. Its focused test confirms two READY members and
then intentionally fails `finalRelayAfterDrain === true`: received
`undefined`. This is valid RED evidence for the still-missing joined
subscription/drain observation, not acceptance credit.

## Deterministic gated Delivery fixture

`GatedDeliveryListener` is a test-local copy of the production listener
composition only: production `DeliveryAssembly.create()` handlers are mounted
as Inbox/Shard/Admin services behind `connectNodeAdapter` on an ephemeral
loopback HTTP/2 listener. It tracks and closes HTTP/2 sessions. Its gate wraps
only `Inbox.findManyInShard`, allowing the test to establish genuine active
remote Delivery work before starting managed drain; no signal/update crosses
test IPC. It passed package typecheck and ESLint before wiring.
