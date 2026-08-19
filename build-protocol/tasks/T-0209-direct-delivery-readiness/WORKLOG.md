# T-0209 Work Log

## 2026-08-19 — planning checkpoint

- Recorded the exact baseline `722a62b4704a5d910db22e7f9934bfd5535a151b`,
  high-risk lifecycle/concurrency classification, binding human requirements,
  owned paths, and T-0210 handoff before product changes.
- Reviewed the frozen T-0203 Delivery disposition and RED 22–28, D-0126,
  existing managed-server lifecycle/tests, and predecessor T-0206/T-0208
  records. No architecture re-plan is authorized or needed.
- Role record: existing `implementer`, explicit `gpt-5.6-terra` / `medium`.
  Runtime telemetry is unavailable. Subagents are prohibited and none were
  used. Accepted explorer record: `codebase explorer`, explicit
  `gpt-5.6-luna` / `low`, read-only/no subagents, telemetry unavailable.
- TDD skill was read completely before product work. The next action is to add
  the first narrow failing readiness/drain behavior test and capture its RED
  output before implementation.

## 2026-08-19 — superseded contract investigation

- `ManagedServerApplicationOptions` currently conveys only `createServer()` and
  opaque optional `synchronize()`. The child can report only an endpoint; it
  does not expose a Delivery facility, a strategy selection, or drain state.
- The existing `ServerEnvironment` can reveal a configured delivery object
  only after child assembly. Its public facility is merely closeable; its
  package-private structural `ServerEnvironmentDelivery` form can show ports
  and optional `source`, but cannot prove remote/shared identity. Existing
  `BoundedContextBuilder` snapshots a strategy and defaults it to one shard,
  losing whether the user explicitly selected it.
- Disposition from the controlling human directive: this is **not** a public
  contract blocker. Delivery and strategy provenance remain the application
  user's concern; runtime must not certify them. `Server.start()`/environment
  attachment already awaits openable Delivery `open()` (including
  `RemoteDelivery` initial snapshot) before `createServer()` resolves, and
  child-only `synchronize()` already installs retained subscriptions before
  READY. Fixtures supply the behavioral configuration and T-0211 will document
  it. Resume test-first implementation through the private lifecycle seam.

## 2026-08-19 — RED/GREEN: private DRAINING admission

- RED command: `pnpm exec vitest run
packages/server/test/server/managed-server-application.test.ts
--testNamePattern "removes a draining child"`. It failed as intended: after
  an authenticated private `draining` frame, Coordinator READY membership still
  contained the child (`1` received; `[]` expected).
- GREEN adds only a bounded `draining` slot/incarnation IPC frame. The child
  emits it before its existing `server.close()` chain; the parent removes that
  exact READY incarnation and marks its exit expected before listener/context
  delivery quiescence proceeds. The same focused command passed 1/1.
- This changes neither public API/wire nor Delivery lease/retry behavior. The
  next TDD cycle will establish real-child close ordering and direct remote
  Delivery readiness evidence.

## 2026-08-19 — focused regression evidence

- The initial full fixture run failed with EPIPE because real managed-child
  fixtures import `packages/server/dist` while the source-only test run had not
  rebuilt it. `pnpm typecheck:build:generated` refreshed the child module.
- The rebuilt run exposed two existing child-close tests which observed only one
  microtask. DRAINING is intentionally asynchronous IPC, so both now await the
  observable close call. This was a fixture timing correction, not a runtime
  retry/policy change.
- Final focused command: `pnpm exec vitest run
packages/server/test/server/managed-server-application.test.ts`; **52/52
  passed**. The temporary Vite threads pool lacks `process.connected`, so the
  process-IPC signal assertion is valid only on the default fork-capable test
  profile used above.

## 2026-08-19 — remote supervisor regression

- Existing real-process remote suite passed **5/5**: `pnpm exec vitest run
packages/delivery-client/test/remote-supervisor-grpc.integration.test.ts`.
  It reuses the accepted Delivery Server topology for direct Admin fan-out,
  exclusive fencing, snapshot recovery, and observation overflow.
- It is not counted as the required managed complete-replica acceptance: its
  child fixture assembles `ServerEnvironment` directly. RED 27–28 still need a
  managed-replica fixture with retained subscription behavior.

## 2026-08-19 — joined managed remote fixture RED

- Added a real parent plus two managed-child fixture against a real
  `DeliveryServer`. Each child configures `RemoteDelivery`, explicitly selects
  `UniformAcrossAllShards.forNumber(2)` in application assembly, and waits for
  remote open/snapshot in child-only synchronization before READY. IPC reports
  only slot/PID readiness facts.
- RED command: `pnpm exec vitest run
packages/server/test/server/managed-remote-delivery-readiness.integration.test.ts`.
  It reaches both READY members, then fails only on the unimplemented joined
  drain/relay observation: `ready.finalRelayAfterDrain` is `undefined`, where
  the acceptance requires `true`. Earlier module-resolution failures were
  corrected before accepting this RED.

## 2026-08-19 — deterministic active-Delivery gate fixture checkpoint

- Added, but deliberately did not yet wire, `GatedDeliveryListener` inside the
  joined managed integration test. It composes production `DeliveryAssembly`
  handlers through a real cleartext HTTP/2 `connectNodeAdapter` listener,
  registers Inbox/Shard/Admin services, binds an ephemeral loopback port, and
  closes tracked HTTP/2 sessions.
- After `arm()`, its one wrapped `Inbox.findManyInShard` reports `entered` and
  waits for explicit test-local `release()` before delegating. This is a real
  remote Delivery worker gate; it neither forwards application payloads over
  IPC nor changes production Delivery APIs.
- Focused tooling passed: `pnpm exec tsc --noEmit -p packages/server/tsconfig.json`
  and `pnpm exec eslint packages/server/test/server/managed-remote-delivery-readiness.integration.test.ts`.
  The next step wires the listener into the joined test and captures the
  lifecycle RED deterministically.

## 2026-08-19 — RED/GREEN: gated joined drain relay

- Wired the real production-assembled `GatedDeliveryListener` into the joined
  fixture. After the initial normal Todo projection update, the test arms the
  `findManyInShard` gate, posts a normal `RenameTask`, waits for the real
  remote worker to enter, and then requests managed drain. A new public
  `CommandService` call through the Coordinator receives `UNAVAILABLE` while
  the work is held. Releasing the gate permits the native `TaskList` update;
  the test observes it before the managed drain completion and stream close.
- The first gate run was green, but focused lifecycle regression revealed the
  initial close ordering waited on asynchronous unary reconciliation before
  issuing child-close IPC. This delayed immediate admission removal and broke
  failure timing tests. The correction starts `beginDrain()` (whose unary
  snapshot changes synchronously) and all active/retired child quiescence
  attempts in the same turn; it closes the Coordinator/subscription kernel
  only after every attempt settles successfully. A failed child settlement
  leaves that owner open and resets the close promise for retry. Multiple child
  failures aggregate; one preserves the prior error identity.
- Fresh real-process runs: the joined test passed **3/3** sequentially. Focused
  regression command passed **120/120** across managed lifecycle,
  NodeCoordinator, and durable subscription bindings. Server typecheck and
  focused ESLint passed. The result uses no test-forwarded Delivery signal or
  payload IPC.

## 2026-08-19 — exact retained-subscription handshake

- The replacement RED exposed a real ordering gap: a managed child could open
  Delivery and report READY before the Coordinator-created child subscription
  had completed `SpineServices.#activateRecord()`. The correction is private
  lifecycle IPC, not a public protocol or Delivery policy.
- The Coordinator records the actual child `SubscriptionId` returned by its
  normal `Subscribe` call before opening child `Activate`. The managed child
  reports `subscription-installed` only after the existing local activation
  path attaches its consumer. The parent accepts only exact
  slot/incarnation/ID acknowledgement, then admits Delivery and receives READY.
- The real two-child Todo fixture holds the replacement's initial Delivery
  snapshot, proves the survivor still publishes a normal subscription update,
  releases the snapshot, and observes another normal update after replacement
  join. It passed **3/3** fresh runs. SIGTERM teardown now performs normal
  managed close, avoiding child/port leakage.

## 2026-08-19 — deterministic convergence and coverage

- Systematic lifecycle bisection found two child-mode tests which set
  `process.connected = true` but did not replace `process.disconnect`. Their
  cleanup disconnected Vitest's own fork IPC. Both now stub and restore the
  method; the complete lifecycle file passes **53/53** and leaves no managed
  child process.
- The established EnvironmentDeliveryWorker suite found a real ordering
  regression: an unnecessary await in the ordinary non-managed start path
  allowed stop to overtake group start. The managed-child queue already owns
  deferred admission, so the redundant promise/await was removed. The suite
  passes **84/84** without unhandled rejections; real managed RED 27–28 pass
  **2/2** standalone.
- Added direct module-interface proof for replacement subscription waiters,
  including stale, duplicate, missing-ID, unknown-ID, cancellation, exact
  acknowledgement, and final activation behavior. Server source typecheck and
  the focused test pass.
- The six-file focused behavior matrix passes **130/130**. Exact changed-range
  LCOV from clean process-isolated runs is **139/150 executable lines (92.67%)**
  and **92/100 branches (92.00%)**, with no coverage exclusions.
- Final post-format verification passed **243/243** focused tests, then the
  fixed-port real managed RED 27–28 suite passed **2/2** alone. Generated and
  tooling typechecks plus every deterministic cheap-preflight policy,
  documentation, Proto, formatting, and release-readiness check passed. The
  task is review-ready; release verification remains correctly deferred until
  specialist convergence.

## 2026-08-19 — specialist review dispatch

- Performance/reliability: existing `performance_reliability_reviewer`,
  explicitly dispatched as `gpt-5.6-terra` / `high`, no subagents; runtime
  telemetry unavailable unless the review surface reports otherwise.
- TypeScript/API documentation: existing `typescript_api_docs_reviewer`,
  explicitly dispatched as `gpt-5.6-terra` / `high`, no subagents; runtime
  telemetry unavailable unless the review surface reports otherwise.
- Style/maintainability: existing `style_maintainability_reviewer`, explicitly
  dispatched as `gpt-5.6-terra` / `high`, no subagents; runtime telemetry
  unavailable unless the review surface reports otherwise.
- Documentation completeness will be dispatched through the existing
  `documentation_reviewer` at `gpt-5.6-luna` / `medium` when a review slot is
  available. These are one concern-specific wave against `e374fe494`; no
  reviewer owns edits.

## 2026-08-19 — consolidated specialist correction

- Style/maintainability found that the real managed fixture constructed, but
  did not apply, its two-shard strategy. The Todo context assembly now accepts
  the application-owned `DeliveryStrategy`, the fixture applies it, and no
  strategy identity/provenance mechanism was added. The stale plan wording
  requiring runtime strategy validation was removed.
- TypeScript/API review found inaccurate readiness TSDoc and missing registry
  ownership text. `synchronize()` now documents child prerequisites followed
  by parent activation and final READY; the Todo option documents that its
  context owns and closes the supplied registry.
- Reliability found two lifecycle gaps. Subscription waiters are now created
  only when the normal child `Activate` call begins, so an inactive logical
  subscription cannot block replacement. Graceful child close now reports
  exact `draining`, `closed`, and `close-failed` outcomes. The existing bounded
  TERM/KILL fallback remains only for a child that never acknowledges drain;
  an acknowledged child may finish legitimate Delivery work without a new
  timeout policy, and close failure remains observable/retryable.
- The real >1.1-second gate exposed that public `RunningServer.close()` closes
  HTTP/2 sessions before environment detachment drains Delivery. A private
  `runningServerAccess.drainDelivery()` step now detaches/drains the existing
  server-owned Delivery attachment while subscription sessions remain open;
  managed close invokes it after unary admission is removed, then performs the
  unchanged public server close. Ordinary `Server.close()` behavior and public
  API are unchanged.
- Documentation review corrections describe current unary/subscription
  topology, the application-owned remote Delivery and strategy setup, and the
  STARTING/SYNCHRONIZING/READY/DRAINING/CLOSED lifecycle in the server README,
  reference, API guide, and deployment plan.

## 2026-08-19 — correction verification

- Systematic fork-pool diagnosis found two simulated-child tests restoring
  Vitest's real `process.disconnect()` before the asynchronous terminal IPC
  step completed. They now await the complete mocked disconnect sequence. The
  full managed lifecycle suite passes **55/55** without worker exit.
- Managed lifecycle, NodeCoordinator, child subscription, durable subscription,
  environment attachment, and server tests pass **337/337**. The real two-process
  managed Delivery suite passes **2/2**, including a final update after work is
  held beyond the former one-second close grace and safe replacement admission.
- Source-mode coverage tests pass **378/378**. Fresh LCOV at
  `/tmp/spine-t0209-cov-final.mUCpeA/lcov.info`, intersected with the exact
  `origin/main...working-tree` production diff, reports **185/194 executable
  lines (95.36%)** and **121/134 branches (90.30%)**, without exclusions.
- Generated and tooling typechecks, affected ESLint, cleanup, TSDoc, copyright,
  logging containment, TypeDoc/API inventory, documentation audience/snippets,
  formatting, release-readiness, and diff whitespace checks pass. The direct
  coverage command's only nonzero condition is the intentionally irrelevant
  whole-large-module threshold; all 378 tests pass and the required exact
  changed-range gate is green.

## 2026-08-19 — final lifecycle and fixture convergence

- Affected reliability re-review found that a child `closed` frame completed
  parent close before the OS process had actually exited. Parent close now
  invokes the existing bounded termination sequence only after `closed`; an
  acknowledged `draining` child still has no active-work deadline. A direct
  fake-child proof holds exit after `closed`, verifies grace/TERM/KILL, and
  preserves shared close completion.
- The first Delivery-server gate paused a response before the application had
  accepted its Inbox page, so it could not prove in-process work. The final
  real-process fixture instead wraps the existing in-memory storage provider
  and pauses the actual `TaskList` projection commit. The wrapper and its
  file markers are test-only; no runtime seam, wire frame, or deployment policy
  was introduced.
- The Todo assembly now accepts the existing `StorageFactory` concept so the
  fixture can select that provider before the Bounded Context is built. A
  black-box proof confirms the selected factory creates Todo storage. The
  application, not the context, remains responsible for closing a potentially
  shared factory.
- The replacement fixture records which child committed the initial projection
  and retires the other child. This proves a healthy shard owner continues
  relaying while its sibling replacement installs the retained subscription;
  it does not incorrectly assume that per-process in-memory entity state is
  shared.
- The complete real two-process suite passed three consecutive fresh runs,
  **2/2** each. The six-file focused server matrix passes **338/338** and the
  Todo storage-option proof passes **1/1**.
- The canonical `verify:task` profile passed every deterministic gate and all
  **382/382** selected tests. Its sole nonzero condition is its known
  whole-module coverage threshold (**56.20%** lines / **41.93%** branches),
  which instruments large unchanged modules. Retained
  `/tmp/spine-t0209-final-lcov.info`, intersected with exact added/modified
  production lines, reports **186/195 lines (95.38%)** and **121/134 branches
  (90.30%)** without exclusions.
