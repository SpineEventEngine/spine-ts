# T-0208 work log

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
