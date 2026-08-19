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
  gates final READY through child synchronization plus the exact local
  retained-subscription installation acknowledgement.

## Planned RED/GREEN evidence

| RED   | Behavior to prove                                                                                       | Evidence status                                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 22    | Each READY child observes Delivery directly                                                             | `remote-supervisor-grpc.integration`: real two environment processes and Delivery Admin fan-out; not managed-replica proof |
| 23    | One process owns/commits fenced shard work                                                              | same suite: real fencing/commit behavior; not managed-replica proof                                                        |
| 24–25 | Cross-process remote work and drain do not strand work                                                  | same suite’s direct remote work/recovery cases; RED 27 additionally proves managed drain’s final active work               |
| 26    | Admin stream failure/overflow receives a fresh snapshot                                                 | same suite: reconnect/snapshot and overflow recovery; not managed-replica proof                                            |
| 27    | DRAINING denies new work, completes active fenced work, relays final update before close                | `managed-remote-delivery-readiness`: real managed parent/two children/Delivery Server, 3 fresh runs                        |
| 28    | Replacement cannot receive unary/Delivery admission before Delivery snapshot and retained subscriptions | same real managed fixture, 3 fresh runs                                                                                    |

No test-forwarder or direct fake notification will be recorded as complete-replica acceptance.

## RED/GREEN: exact child subscription installation before READY

- RED: a replacement could open its real Delivery connection before its normal
  local retained subscription attached, allowing an intervening state update to
  miss that local relay.
- GREEN: private exact-ID lifecycle acknowledgement waits for the ordinary
  `SpineServices.#activateRecord()` attachment. The joined fixture holds the
  real snapshot, observes the survivor update, releases it, then observes a
  later normal update after replacement joins. No public API, Proto, retry,
  configuration, or payload IPC was added.
- Evidence: three fresh real-process runs passed **2/2** each; NodeCoordinator
  **31/31**; hook + managed Delivery **4/4**; server typecheck/build, focused
  ESLint, and Prettier passed.

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

## RED/GREEN: real gated drain relay

The joined fixture now proves the following on normal public paths: a baseline
Todo command produces a native TaskList subscription update; an armed real
`Inbox.findManyInShard` gate holds the next remote Delivery worker after a
normal RenameTask is accepted; managed drain makes a new Coordinator command
return `Code.Unavailable`; releasing the real worker yields the final public
TaskList update before the parent reports drain completion and the iterator
closes. The exact integration test passed **three sequential fresh runs**.

The close implementation invokes private unary `beginDrain()` and all child
quiescence attempts without an asynchronous admission gap. It retains the
Coordinator's subscription owner until all child and retired-child settlements
succeed; a rejection avoids Coordinator close and permits a later retry.
Focused regression evidence: managed lifecycle + NodeCoordinator + durable
subscription bindings passed **120/120**; server typecheck and focused ESLint
passed.

## Final implementation convergence

- The established EnvironmentDeliveryWorker suite exposed an unnecessary
  resolved-Promise await in the non-managed supervisor start path. Removing
  that scheduling turn retained the private managed-child queue while restoring
  ordinary start-before-stop ordering: **84/84** environment attachment tests
  pass without asynchronous errors.
- Two legacy child-mode lifecycle tests simulated a connected child while
  retaining Vitest's real `process.disconnect()`. Production cleanup therefore
  disconnected the test worker. Both fixtures now stub and restore that process
  method; the complete normal fork-pool lifecycle file passes **53/53** without
  worker exit or an orphaned child.
- A direct replacement test proves exact waiter creation, duplicate/stale and
  missing-ID rejection, cancellation cleanup, exact acknowledgement, and
  activation only after the current child subscription is installed.
- The focused behavior matrix passes **130/130** across managed lifecycle,
  child subscription notification, NodeCoordinator, real managed Delivery,
  durable subscription bindings, and direct remote Delivery. The fixed-port
  real managed process test also passes **2/2** in its required standalone run.
- Retained source LCOV is split by process ownership to avoid simulated-child
  global state contaminating ordinary EnvironmentDeliveryWorker tests:
  `/tmp/t0209-main-lcov.T7wRzM/lcov.info` and
  `/tmp/t0209-env-lcov.IHiLIE/lcov.info`. Their exact
  `origin/main...working-tree` changed-range intersection is **139/150 lines
  (92.67%)** and **92/100 branches (92.00%)**, with no exclusions.
- Final post-format behavior evidence is **243/243** across managed lifecycle,
  subscription coordination, SpineServices, durable bindings, and direct
  remote Delivery, followed by the fixed-port real managed process acceptance
  **2/2** in isolation. No Vitest or managed child process remained.
- Cheap preflight passed: generated build, tooling typecheck, changed-file
  ESLint/Prettier, diff check, cleanup, TSDoc, copyright, logging containment,
  TypeDoc/API inventory, documentation audience/snippets, Proto lint/current
  output, and release-readiness.

## Specialist correction evidence

- Inactive subscriptions no longer create replacement waiters; direct
  lifecycle proof admits the replacement without a synthetic activation.
- Active subscriptions wait for the exact child activation acknowledgement.
  Duplicate, stale, missing, cancelled, and retired acknowledgements remain
  bounded to the current slot/incarnation/subscription tuple.
- Child close reports `DRAINING`, then drains the existing server-owned
  Delivery attachment while HTTP/2 subscription sessions remain open. It sends
  `CLOSED` only after normal server close, or `CLOSE_FAILED` on rejection. The
  parent observes the exact outcome and permits retry; unacknowledged children
  retain the pre-existing bounded TERM/KILL fallback.
- Real RED 27 now holds `Inbox.findManyInShard` for more than 1.1 seconds,
  verifies Coordinator unary admission is unavailable, releases Delivery,
  observes the final public TaskList update, and only then observes stream and
  managed close completion. Real RED 28 proves a replacement remains outside
  admission until its remote snapshot and retained subscription are installed.
- Current focused behavior is **337/337** plus real-process **2/2**. Source-mode
  coverage behavior is **378/378**; exact changed production coverage is
  **185/194 lines (95.36%)** and **121/134 branches (90.30%)** from
  `/tmp/spine-t0209-cov-final.mUCpeA/lcov.info`.

## Final residual correction

- Parent close no longer equates a private `closed` acknowledgement with OS
  process exit. It applies the already-established bounded termination path
  after `closed`; active `draining` work remains unbounded until its own
  terminal outcome.
- Real RED 27 pauses the actual application-side `TaskList` Entity commit after
  Delivery invokes the handler. The update is observed before managed close
  completes after a hold longer than 1.1 seconds.
- Real RED 28 retires the non-owner process, proves the healthy shard owner
  continues relaying, and admits the replacement only after its exact retained
  subscription activation.
- Three consecutive fresh real-process runs passed **2/2**. Focused server
  regression is **338/338**; the Todo selected-storage proof is **1/1**.
- Canonical task verification passed all non-coverage gates and **382/382**
  selected tests. Retained `/tmp/spine-t0209-final-lcov.info` gives exact
  changed production coverage of **186/195 lines (95.38%)** and **121/134
  branches (90.30%)**. The verifier's reported failure is limited to applying
  its global 90% threshold to entire unchanged large modules.
