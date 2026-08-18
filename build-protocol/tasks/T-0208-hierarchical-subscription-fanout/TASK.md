# T-0208 — Hierarchical subscription fan-out

**Status:** In progress
**Baseline:** `origin/main@b00cb4c21`
**Branch/worktree:** `codex/t0208-subscription-fanout` / `/tmp/spine-ts-t0208`

## Classification and objective

This is **high-risk** runtime work: it composes streaming HTTP/2 operations,
cancellation, bounded backpressure, process membership, durable-restart
rehydration, and storage ownership. It implements the frozen existing
`SubscriptionService` hierarchy only: Gateway remains the sole durable logical
`SubscriptionBindings` owner; the Node Coordinator retains only in-memory
definitions and fans each to every READY complete-replica child.

## Acceptance criteria

1. Subscribe creates one immediate child on every current Coordinator member,
   rewrites only that child ID, and compensates partial creation failures.
2. Activate merges all immediate child streams, awaits the caller sink for
   backpressure, propagates cancellation, bounds child envelopes using existing
   limits, and rewrites relayed updates to the Coordinator logical ID.
3. Cancel removes every immediate child and completes all streams/listeners.
4. Opening and later READY/replacement membership reconcile retained
   definitions and active streams before unary eligibility; no definition is
   sent over parent/child IPC.
5. Gateway integration retains public logical ID semantics through
   Gateway -> Coordinator -> replicas, rehydrates durable definitions after a
   Gateway restart, and leaves no Coordinator/worker durable registry rows.
6. Managed assembly accepts only `InMemorySubscriptionRegistry` native child
   registries and rejects a persistent Stand registry with aggregate cleanup;
   standalone `Server.run()` remains unchanged.

## Frozen boundaries

- No new Proto, service, public topology/configuration, ZeroMQ, generic signal
  transport, payload IPC, manifest/attestation, or DeliveryStrategy identity.
- The existing ready-member notification and ordinary HTTP/2 child endpoint are
  the only coordination seams. T-0209 owns Delivery admission.
- Product ownership is limited to `node-coordinator.ts`,
  `managed-server-application.ts`, the smallest private `server.ts` inspection
  seam if necessary, focused tests/fixtures, necessary Gateway integration
  tests, and these records. Deployment-kernel changes require a demonstrated
  blocking contract defect first.
- RED 17–19 real-process domestic, ThirdParty/external-event, and Delivery
  acceptance remains explicitly owned by T-0210 under the accepted T-0203
  plan. T-0208 retains the hierarchical subscription machinery and its
  Coordinator/Gateway composition proofs only.

## Owner/profile record

- Existing role: `implementer`.
- Configured profile: `gpt-5.6-terra` / `medium`; dispatch fields were explicit.
- Runtime telemetry is unavailable on this surface; the immutable configured
  role/profile is the available evidence.
- Subagents are prohibited.

## Review dispositions planned

- Style/maintainability, TypeScript/API documentation, documentation, and
  performance/reliability are required because this is private runtime behavior
  over an existing public stream contract.
- Security is deferred to final correction convergence: no new wire form or
  external trust boundary is introduced.

## Implementation evidence

- Checkpoints `029acdb8b` through `595e6000f` are pushed to
  `origin/codex/t0208-subscription-fanout`. They implement membership admission
  gating, Coordinator child fan-out/relay/cancel, managed registry rejection,
  and Gateway durable recovery proof without a new public contract.
- Focused real HTTP/2, managed-child, Server lifecycle, and membership-kernel
  suites run 284 assertions. Their changed-source coverage is 93.26% statements,
  90.14% branches, and 94.88% lines. `node-coordinator.ts` is 92.72% branches;
  `server.ts` is retained for its smallest private registry seam, whose changed
  `runningContexts.set` and `runningServerAccess.subscriptionRegistries` paths
  are directly exercised by the Server suite.
- RED 17 (domestic event), RED 18 (ThirdParty/external event), and RED 19
  (Delivery event) are deliberately not claimed here. The accepted T-0203 plan
  assigns their real-process end-to-end proofs, including delivery admission,
  to T-0210. T-0208 supplies the reusable hierarchy/recovery behavior on which
  those tests depend.

## Verification disposition

- Final correction convergence retains the same sole `implementer` profile:
  explicit `gpt-5.6-terra` / `medium`, no subagents, and unavailable runtime
  telemetry. The focused runtime matrix passed 247/247; scoped changed-source
  V8 coverage passed 120/120 with 96.42% lines and 90.72% branches.
- Static/docs evidence is green: server/deployment/tooling typechecks, scoped
  ESLint, cleanup, TSDoc, copyright, logging containment, docs
  API/audience/snippets, format, and diff checks. The only generation claim was
  an untracked stale quarantine artifact for a dead process; it was removed
  exactly before serial documentation checks completed.
- T-0209 remains the explicit Delivery-admission handoff and is not claimed by
  this task.

- The mandatory cheap preflight is clean: changed-file formatting and diff,
  generated build/tooling typechecks, focused regressions, ESLint, cleanup,
  TSDoc, copyright, logging, API/audience/snippet documentation, and release
  readiness all passed.
- Canonical profile: `pnpm verify:task -- --coverage` over the five focused
  Coordinator/managed/Server/kernel suites and the four changed production
  sources. Its terminal LCOV artifact was written at 22:46:31 with 512/568
  branches (90.14%) and 983/1036 executable lines (94.88%).
- Deterministic verification is converged. Required specialist review remains
  the final task gate; this record does not claim review completion.
