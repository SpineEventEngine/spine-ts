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
