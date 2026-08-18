# T-0208 work log

## 2026-08-18 — Final reliability correction ownership

- Existing `implementer` ownership continues with explicit `gpt-5.6-terra` /
  `medium`; telemetry is unavailable and no subagents are permitted.
- P1-A reconnect ownership and P1-B bounded cleanup tombstones are pushed in
  `9bb4a7078`. A second real HTTP/2 client now proves Coordinator Cancel ends
  the active public iterator and native activation.
- The same real HTTP/2 fixture now proves an immediate reconnect survives a
  held aborted native activation completion, and that the fixed 100-envelope
  merged-stream bound aborts a stalled native upstream without deadlock.
- T-0209 retains Delivery admission; this task does not claim its Delivery
  event acceptance.

## 2026-08-18 — Final correction evidence

- Sole owner remains the existing `implementer`, explicitly configured
  `gpt-5.6-terra` / `medium`; no subagents ran and runtime telemetry is
  unavailable on this surface.
- Accepted reliability corrections: activation reconnect ownership, bounded
  single-attempt child-cleanup tombstones, second-client Cancel, held native
  reconnect, and existing-bound overflow upstream abort. Managed registry tests
  capture stderr and always await termination; recovery closes owner before
  Coordinator in `finally`.
- Final focused runtime matrix passed **247/247**. Scoped V8 evidence over the
  changed runtime sources passed **120/120**, with **96.42% lines** (729/756)
  and **90.72% branches** (411/453).
- Server/deployment/tooling typechecks, scoped ESLint, cleanup, TSDoc,
  copyright, logging containment, docs API/audience/snippets, formatting, and
  diff checks passed. A stale untracked Proto workflow quarantine claim from a
  dead process was removed exactly; serial docs checks then completed.
- T-0209 remains the explicit Delivery-admission/event handoff; no T-0208
  completion claim includes it.

## 2026-08-18 — Correction ownership transfer

- Correction ownership transferred to the existing `implementer`, explicitly
  configured `gpt-5.6-terra` / `medium`; runtime telemetry is unavailable on
  this surface. The prior owner is idle/completed; this owner is the sole
  writer in `/tmp/spine-ts-t0208` on `codex/t0208-subscription-fanout`.
- No subagents may run. The inherited head is pushed as `53a41bce3` and the
  worktree was clean at transfer.
- Accepted correction batch: managed-registry matrix/lifecycle proofs,
  cleanup-safe fixture ownership, managed-option TSDoc, reader documentation,
  review dispositions, and the confirmed reliability extension that bounds
  retry cleanup and makes `close()` retry retained failed child cleanup.
- Next: establish RED coverage for the bounded retry/terminal close behavior,
  then make the smallest kernel correction before completing the remaining
  tests and documentation.

## 2026-08-18 — Correction convergence

- RED proved both an activation-disconnect poison (the second activation did
  not relay) and an unbounded retained-child retry (close timed out). The
  kernel now separates child lifetime from activation lifetime, retries every
  retained pair through one bounded disposal helper, and continues close
  cleanup after individual definition failures. A late member also proves it
  synchronizes and activates under the existing owner while a concurrent
  second owner remains rejected.
- The managed registry matrix is explicit: opaque handles expose no registry
  facts; an actual default persistent Server and a structural custom registry
  with `persistent: false` both exit before READY; only an actual
  `InMemorySubscriptionRegistry` reports READY and closes cleanly. The forked
  fixture imports `dist`; `pnpm typecheck:build:generated` was required before
  the custom structural-registry proof and left no tracked generator outputs.
- Focused evidence: membership kernel 37/37; managed application 51/51;
  package/deployment no-emit typechecks pass. Next: run the correction
  preflight and record final reviewer dispositions before affected re-review.

## 2026-08-18 — Framing and TDD lock

- Read `AGENTS.md`, `BUILD_PROTOCOL.md`, the accepted T-0203 plan and human
  ledger, and T-0205–T-0207 task/work/review records before editing product
  code. The plan assigns RED 12–21 to this high-risk slice.
- The sole implementation owner is the existing `implementer`, configured
  explicitly `gpt-5.6-terra` / `medium`; runtime telemetry is unavailable and
  no subagents may run.
- Fully read the `test-driven-development` skill. Runtime changes will be made
  only after a focused behavior test is observed failing for the missing
  Coordinator subscription behavior.
- Current T-0207 has truthful-but-unsupported `subscribe`, `activate`, and
  `dispose` member-client callbacks. The T-0205 internal kernel already owns
  bounded creation, retained in-memory definitions, immediate child rewriting,
  awaited update sinks, activation cancellation, compensation, and cleanup.
- Next: add the narrowest real HTTP/2 Coordinator subscription RED and record
  its exact output before replacing the unsupported adapters.

## 2026-08-18 — Authorized membership-admission correction

- The orchestrator supplied a demonstrated T-0205 handoff defect: a connected
  joining member was inserted into the kernel's forwardable set before retained
  child synchronization completed. Ownership was widened only to the internal
  deployment kernel and its focused test, as authorized; no new protocol or
  readiness concept was introduced.
- RED: after a current member retained `logical`, a joining member's delayed
  child `Subscribe` allowed its second unary forward. The exact focused command
  failed: `expected 'joining' to be 'current'` at
  `membership-kernel.test.ts:86` (29 passing, 1 failing).
- GREEN: member records now remain ineligible until the current retained
  definition synchronization succeeds. `forward()` selects eligible members
  only; failed child creation leaves the joining member ineligible. A later
  reconcile retries the existing child synchronization path. Existing members
  retain their unary eligibility, preserving Gateway compatibility.
- Focused kernel proof is green: `pnpm exec vitest run
packages/deployment/test/membership-kernel.test.ts` — 31/31 tests passed.
- Next: commit and push this green checkpoint, then add the Coordinator
  `SubscriptionService` HTTP/2 RED.

## 2026-08-18 — Coordinator subscribe RED/GREEN

- The first direct test invocation could not resolve the previously cleaned
  generated Proto package. Frozen generation/build restored the baseline; the
  ten usual generated manifest/stamp byproducts were restored before product
  work continued.
- RED: real HTTP/2 `SubscriptionService.Subscribe` through the Coordinator
  failed with `ConnectError: [unimplemented] HTTP 404` at
  `node-coordinator.test.ts:101` (17 passing, 1 failing), proving the existing
  unary-only listener did not register the route.
- GREEN: the Coordinator registers only the existing generated
  `SubscriptionService`; it makes an ephemeral Coordinator logical definition,
  delegates child `Subscribe`, `Activate`, and `Cancel` to ordinary HTTP/2
  child endpoints, rewrites only immediate child IDs, and uses the shared
  kernel for bounded envelopes, compensation, cancellation, and cleanup.
  Its private async queue awaits the update consumer before admitting the next
  queued update, preserving relay backpressure. No IPC payload or public wire
  form was added.
- `pnpm exec tsc -p packages/server/tsconfig.json --noEmit` and
  `pnpm exec vitest run packages/server/test/server/node-coordinator.test.ts`
  pass; the latter has 18/18 real HTTP/2 tests.
- Next: commit and push this green checkpoint, then add activation/cancellation
  and late-member RED cases.

## 2026-08-18 — Checkpoint correction

- Verified the three checkpoint findings against the existing subscription
  service and kernel. The generated service's `Subscribe(Topic)` does not carry
  a parent subscription ID downstream, so child-definition identity is an
  internal kernel collision fence rather than a new wire observable.
- RED: the real Coordinator subscribe proof changed to require the established
  `s-<UUID>` form. It failed exactly with `expected
'9dd73ec2-fbd5-4311-ad69-7fe602cb11f2' to match
/^s-[0-9a-f-]{36}$/u` at `node-coordinator.test.ts:107`.
- GREEN: Coordinator logical IDs now use `s-${randomUUID()}`; immediate child
  definitions use `slot-incarnation`, preventing replacement collisions. The
  merged update queue is capped at the existing server subscription delivery
  limit (100); overflow closes the relay and releases pending producers rather
  than retaining unbounded update envelopes.
- Focused real HTTP/2 proof is green: 19/19 `node-coordinator` tests; server
  no-emit typecheck also passes. Next: commit and push the correction before
  continuing cancellation and membership tests.

## 2026-08-18 — Cancel response correction

- RED: Coordinator `Cancel` returned an empty default `Response`; the real
  HTTP/2 assertion failed `expected undefined to be 'ok'` at
  `node-coordinator.test.ts:110`.
- GREEN: after cancelling every immediate child, the Coordinator returns the
  same explicit `Response.status.ok` shape as `SpineServices.Cancel`.
- Focused real HTTP/2 suite remains green at 19/19; server typecheck and
  changed-file formatting pass. Next: push this checkpoint and continue late
  membership/cancellation cleanup proofs.

## 2026-08-18 — Cancellation fan-out proof

- The existing real HTTP/2 Coordinator subscription fixture now records every
  child `Cancel`. One Coordinator cancellation produces one native cancellation
  at each current replica and returns explicit OK; the focused suite remains
  green at 19/19.
- Remaining required proofs are late/replacement membership, managed registry
  validation, Gateway durable rehydrate, and exact changed-source coverage;
  this checkpoint does not claim those complete.

## 2026-08-18 — Late member acceptance

- A real HTTP/2 Coordinator test retains a definition, publishes a late READY
  member, observes native Subscribe at that member, then proves normal unary
  round-robin includes it. The kernel admission gate prevents the joining
  member becoming selectable before the retained definition is installed.
- Focused Coordinator suite: 20/20 passing. Replacement and managed-registry
  paths remain next.

## 2026-08-18 — Managed registry guard

- Added the smallest private `RunningServer` WeakMap inspection seam. A managed
  child inspects framework-owned assembled contexts immediately after
  `createServer()` and rejects persistent Stand subscription registries before
  synchronization or READY. Plain/custom `RunningServer` values remain opaque
  and preserve the existing public contract.
- Rejection closes the created server; if cleanup also fails, it reports an
  ordered `AggregateError`, matching existing startup cleanup behavior.
- Server typecheck is green. Focused managed lifecycle proof and an actual
  persistent/in-memory assembly fixture remain required before acceptance.

## 2026-08-18 — Real managed registry fixture

- RED initially timed out at 20 seconds. Systematic trace found the fixture
  executes `packages/server/dist`, while the new guard had only been checked
  with `--noEmit`; it therefore ran the preceding artifact. No runtime change
  was made for that environmental mismatch.
- After the normal generated build (and restoring the ten volatile generated
  stamp/manifest byproducts), the real child fixture proves a normal `Server`
  with its default persistent registry exits before READY, and the same Server
  with `InMemorySubscriptionRegistry` sends READY then closes cleanly.
- `managed-server-application.test.ts` is green at 49/49. This closes the
  managed-registry acceptance and confirms rejection cleanup does not leave a
  running child.

## 2026-08-18 — Scoped coverage measurement

- The scoped task-verifier build/Proto phase completed without tracked generated
  byproducts. Exact LCOV on the focused suite identifies outstanding branch
  work: `node-coordinator.ts` 166/180 lines and 48/59 branches;
  `managed-server-application.ts` 256/267 lines and 148/165 branches; kernel
  226/233 lines and 169/188 branches.
- The new private `server.ts` inspection seam has only 9/353 whole-file lines
  and 0/160 branches under this focused suite. It is intentionally private but
  still needs a changed-line-compatible coverage disposition before the task
  verifier can be accepted. No verification-pass claim is made.

## 2026-08-18 — Subscription admission error checkpoint

- RED: `SubscriptionService.Subscribe` with no READY replica escaped the
  kernel's membership error as Connect `INTERNAL` (13), while unary calls
  correctly return `UNAVAILABLE` (14).
- GREEN: Coordinator subscription admission now maps the same absent-member
  condition to the established `UNAVAILABLE` response. Focused real HTTP/2
  suite is green at 21/21. This improves the exact availability error branch;
  queue-overflow and close branches remain in the bounded coverage slice.

## 2026-08-18 — Activation cancellation cleanup proof

- A real HTTP/2 activation whose native child waits indefinitely now proves
  client stream abort reaches the child, terminates the public pending read
  with Connect `CANCELED`, and leaves no active native stream. Focused
  Coordinator suite is green at 22/22.
- Exact single-suite LCOV remains 167/181 lines and 48/59 branches. The
  remaining queue-overflow branch requires more than the 100 bounded concurrent
  child relays because each child awaits the sink before reading another update.

## 2026-08-18 — Queue bound and structural-branch convergence

- RED: direct internal queue behavior tests initially failed because the queue
  was not exposed to its focused runtime test (`TypeError: SubscriptionUpdateQueue
is not a constructor`).
- GREEN: the internal queue is now directly testable and proves overflow closes
  terminally, drops stale buffered updates, resolves blocked producers, ignores
  later updates, and directly serves an awaiting consumer. This is the bounded
  behavior used by real HTTP/2 activation.
- Removed only redundant downstream fallbacks confirmed by existing boundaries:
  `AddressInfo.address` is a string; kernel child definitions passed to the
  adapter have an ID; Coordinator-created native definitions have a Topic. No
  corrupt public input validation was removed.
- Coordinator invariants use descriptive required-value checks rather than
  non-null assertions, so malformed internal definitions fail explicitly while
  the existing definition and Topic boundaries remain enforced.
- Focused Coordinator suite: 24/24. Exact LCOV is **174/183 lines** and
  **51/55 branches (92.73%)**, meeting the changed runtime threshold.

## 2026-08-18 — Joined Gateway durability recovery proof

- Added one real HTTP/2 composition test: `DurableSubscriptionBindings` retains
  the public `s-public` definition; `DynamicSubscriptionCreator` and
  `DynamicUnaryForwarder` send it to a real `NodeCoordinator`; the Coordinator
  fans it to a real child `SubscriptionService`. After orderly Gateway-owner
  and Coordinator replacement, a reopened bindings store recovers that one row
  into the empty replacement Coordinator and current child.
- RED evidence: the first composition run completed its functional assertions
  but failed teardown with exact `Error: backend child cleanup remains
incomplete.` The test's generic parallel cleanup closed the replacement
  Coordinator while the dynamic owner was still issuing its required child
  Cancel. This was a fixture lifecycle race, not a product failure.
- GREEN: the test explicitly closes the dynamic owner before its Coordinator,
  preserving the actual ownership shutdown order. It proves the replacement
  has no child definition before `recoverActive`, then has one after recovery
  (child Subscribe count 1 → 2). The configured storage-factory spy records
  exactly two `spine.auth.gateway` opens, both for
  `GatewayAuthenticatedSubscriptionSchema`; Coordinator and worker fixtures
  receive no storage factory and retain no durable logical row.
- Focused real HTTP/2 Coordinator suite is green at **25/25**. No product API,
  persistence path, or wire contract was added; the existing composed behavior
  satisfies this acceptance slice.

## 2026-08-18 — Converged preflight coverage

- Added only boundary-relevant coverage: an opaque managed handle exposes no
  private Coordinator membership facts, while a framework-owned Server exposes
  its actual registry facts. This exercises the smallest `server.ts` context
  inspection seam used by managed-registry rejection; no browser/topology
  feature or public API was added.
- Combined focused suite (`node-coordinator`, managed application, Server,
  Server lifecycle, membership kernel) is green at **284/284** with **93.26%
  statements, 90.14% branches, and 94.88% lines** across all changed production
  sources. `node-coordinator.ts` remains 92.72% branch coverage.
- Exact `server.ts` changed-range LCOV evidence: `runningContexts.set` line is
  hit 163 times; `runningServerAccess.subscriptionRegistries` is hit 10 times;
  the map path is hit once. This is proportionate evidence for the private
  WeakMap seam even though unrelated historical whole-file branches remain.
- The exact RED 17–19 real-process checks remain deferred to **T-0210** by the
  frozen T-0203 plan: domestic event, ThirdParty/external event, and Delivery
  admission are not represented as T-0208 completion claims.

## 2026-08-18 — Deterministic verification convergence

- Cheap preflight passed: changed-file Prettier/diff, generated build/tooling
  typechecks, 284 focused regressions, ESLint, cleanup/TSDoc/copyright/logging,
  API/audience/snippet documentation, and release readiness.
- One canonical scoped `verify:task --coverage` ran over the five focused
  suites and all four changed production sources. Its terminal LCOV artifact
  was written at 22:46:31 and reports **512/568 branches (90.14%)** and
  **983/1036 lines (94.88%)**; Coordinator remains **51/55 branches**.
- The verifier wrapper yielded its captured stream during the long generated
  build, but its sole process completed and wrote the final coverage artifact;
  no second expensive profile was run. Specialist review is the remaining
  completion gate.

## 2026-08-18 — Review correction: activation ownership

- RED: a second `BackendMembershipKernel.activate()` overwrote the first
  definition update sink and resolved when pre-aborted rather than rejecting;
  exact focused assertion: `promise resolved "undefined" instead of rejecting`.
- GREEN: each definition now owns one activation controller. Concurrent
  activation rejects with `subscription activation is already active`; Cancel
  aborts that controller, its child streams, and the original public wait.
