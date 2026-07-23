# T-0066 Requirements Analysis

Status: accepted.

## Decision

The current public `DeliveryServer`, `DeliveryClient`, remote Inbox/work-registry
adapters, `DeliveryBuilder`, and `DeliverySupervisor` compose for the requested
TS-to-TS multi-machine proof. No production or public-contract change is planned.

## File Ownership

- `packages/delivery-client/test/e2e/multi-machine-delivery.test.ts`
- `packages/delivery-client/test-fixtures/multi-machine-app.mjs`
- `packages/delivery-client/test/e2e/README.md`
- T-0066 task, work, implementation, and review records.

No `src`, package exports, Protobuf, dependency, lockfile, example, or public-guide
change is permitted unless a focused RED test proves a genuine framework defect.

## Topology

- Vitest parent coordinates one spawned standalone `spine-delivery-server` on an
  ephemeral loopback port with one-second shard processing timeout.
- Two isolated Node application processes each construct, through package-root
  APIs, a `DeliveryClient`, remote Inbox/work registry, `DeliveryBuilder`, one
  shard, node identity, and `DeliverySupervisor` with in-memory local facilities.
- The parent owns generated Admin and health clients over a caller-owned HTTP/2
  session manager.
- Node IPC carries only bounded control and observation frames. Generated command
  payloads always cross public HTTP/2 gRPC delivery APIs.
- The fixture's bounded in-memory quarantine is disposable test support only and
  must be documented as non-production.

## Required Scenario

1. Start Admin observation before application activity and require one initial
   `created` frame with an empty snapshot.
2. Have both children concurrently pick up one shard before supervisors start;
   exactly one session is acquired.
3. Observe `PICKED/0`, explicitly release the winner, and observe `NOT_PICKED/0`.
4. Start both supervisors. Write one generated command through alpha and one
   through beta; each dispatches exactly once on either process.
5. For each ordinary command require Admin updates:
   `NOT_PICKED/1 -> PICKED/1 -> PICKED/0 -> NOT_PICKED/0`.
6. Write a stalling command, hold a deliberate 500 ms sub-expiry quiet window,
   SIGKILL the owning child, and require the survivor to take over only after the
   one-second stale threshold and within five seconds.
7. Require takeover updates:
   `NOT_PICKED/1 -> PICKED/1 -> NOT_PICKED/1 -> PICKED/1 -> PICKED/0 -> NOT_PICKED/0`.
8. Replace the survivor's terminal supervisor with a fresh instance, dispatch one
   final command, and require the ordinary four-update sequence.
9. Require exactly 20 Admin updates after the ACK and a final `NOT_PICKED/0`
   snapshot.
10. Assert overall and known-service `SERVING`, unknown-service `NOT_SERVING`, and
    terminal unavailability after server shutdown. T-0065 remains the deterministic
    proof of the internal shutdown health transition.

Ownership is intentionally nondeterministic. Assertions use cardinality and
distinct process IDs, never a predetermined alpha/beta winner.

## Timing And Cleanup

- IPC acknowledgement: 1 second; readiness/RPC/ordinary dispatch: 2-5 seconds.
- Processing timeout and supervisor stale threshold: 1 second.
- Recovery: 100 ms; watch backoff: 50-200 ms.
- Deliberate pre-takeover quiet window: 500 ms; takeover deadline: 5 seconds.
- Graceful exit: 5 seconds, then bounded SIGTERM and SIGKILL fallbacks.
- Happy path: 30 seconds; cleanup-failure scenario: 15 seconds.
- No arbitrary sleeps except the deliberate sub-threshold quiet window.

Parent cleanup runs in `finally`, preserves the primary failure, aggregates cleanup
failures, and owns children first, Admin stream/session second, and delivery server
last. It accounts for IPC, output streams, abort controllers, HTTP/2 sessions,
supervisor timers/watches, listener port, and fixture quarantine state. A deliberate
post-readiness failure test proves process exit, stream termination, and port reuse.

## Verification And Review

- Run generated-build typecheck.
- Run the focused native suite twice independently for flake evidence.
- Run touched ESLint, Prettier, cleanup, changed-file/public-import scans, and diff
  checks.
- Run the full repository gate.
- Required review lanes: performance/reliability, style/maintainability, and
  documentation. TypeScript/API is N/A if no contract changes. Security remains
  deferred to Wave 1 closure because this is loopback-only fixture code.

## Assignment Metadata

The existing requirements-splitter role was explicitly dispatched as
`gpt-5.6-sol` / `high`. Runtime self-introspection was unavailable; the immutable
configured role/profile is the actual evidence, with no visible fallback or
mismatch.
