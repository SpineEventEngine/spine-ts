# B3 Implementation Report — Atomic Subscription Ownership

## Scope delivered

- Added `SubscriptionGateway` for independently authenticated and authorized
  `SubscriptionService.Subscribe`, `Activate`, and `Cancel` requests.
- Added injectable `InMemorySubscriptionBindings`, whose required disposer and private binding hold
  an owned backend-envelope copy, owner fingerprint, serialized-tenant fingerprint,
  expiry, and lifecycle state (`inactive`, `active`, `cancelling`, `closed`).
- Subscribe returns a gateway-generated `Subscription` ID and a freshly rewritten trusted topic;
  the opaque backend envelope is never present in a public result.
- Activate and Cancel serialize their complete backend effects per binding. Cancel retains
  its opaque envelope in `cancelling` state when mandatory backend cleanup
  rejects, then permits an authorized retry; successful cleanup zeroes and
  removes the binding. Store close is terminal.

## TDD evidence

RED was observed for the second correction regressions: post-close creation was
accepted and cancellation ran while activation was still delayed. The green
suite proves source/store/callback byte isolation, one immutable admission
transport snapshot with independently decoded authorization/context views,
stale identity rejection before callbacks, opaque public results, terminal
close, retry-safe rejected cleanup, and both backend-effect orderings.

## Historical initial focused verification (superseded)

```text
pnpm --config.verify-deps-before-run=false exec vitest run packages/auth/test/incoming-request.test.ts packages/auth/test/unary-gateway.test.ts packages/auth/test/subscriptions/index.test.ts
Test Files  3 passed (3)
Tests       33 passed (33)

pnpm --config.verify-deps-before-run=false exec tsc --noEmit -p packages/auth/tsconfig.json
exit 0

pnpm --config.verify-deps-before-run=false docs:check:generated
TypeDoc JSON includes 41 expected @spine-event-engine/auth exports

The final bounded-correction validation passed 3 focused auth files / 33 tests,
`tsc --noEmit -p packages/auth/tsconfig.json`, generated TypeDoc/API checking,
Prettier, and `git diff --check`.
```

## Limits

B3 contains no native gRPC forwarding, stream relay, backpressure, concrete
sessions/OIDC, React, Chat, Envoy, or Spine JVM build/test/generation/dependency
resolution/launch/project execution. B4 may map the deliberately
transport-neutral gateway seam to native stream behavior without exposing the
private backend envelope.

## B3 bounded-correction evidence — 2026-07-28

RED: a new oversize-wire regression reached asynchronous work, and a delayed
Activate prevented a second binding from activating. GREEN: synchronous copied
admission rejects `request-too-large`; coordination is finite per binding;
callbacks and compensation are signal-aware and mandatory; expiry cleanup never
serializes unrelated bindings; close starts all cleanup concurrently, aggregates
failures, and clears store retention. Named raw-wire and envelope contract types
are exported. Fresh final command output is recorded in the work log: 3 auth
files / 33 tests, auth typecheck, formatting, diff hygiene, and a generated
TypeDoc/API inventory containing exactly 41 auth exports. This historical
checkpoint is superseded by the final 36-test/43-export evidence below.

## Final bounded correction — 2026-07-28

The binding callbacks now receive the platform event-capable `AbortSignal`.
Subscribe and every pre-binding compensation race the configured operation
timeout, abort on expiry, clear their timer, and zero gateway-owned callback
copies. The in-memory store leases capacity before asynchronous Subscribe,
releases failed leases, denies a foreign owner before reserving its per-binding
queue slot, rechecks ownership when the slot runs, and serializes expiry behind
already-running work before mandatory disposal. `SubscriptionBindingTransition`
and `SubscriptionCapacityReservation` are public named contracts.

Fresh focused evidence: 3 auth files / 36 tests passed; auth typecheck and the
generated TypeDoc/API inventory passed (43 auth exports); Prettier and diff
hygiene were rerun after this correction. No Spine JVM command was run.

## Targeted final correction — 2026-07-28

The exported abort contract is now the actual Node/browser platform
`AbortSignal`, not a reduced local declaration. Gateway close owns pending
pre-binding Subscribe controllers and capacity leases: it aborts and releases
them before terminally closing the retained binding store. The final focused
regression holds a Subscribe callback, closes the gateway, and observes the
abort event. The earlier 33-test/41-export checkpoint is historical and
superseded.

Fresh focused evidence: 3 auth files / 37 tests passed; auth typecheck,
generated TypeDoc/API inventory (43 exports), Prettier, and diff hygiene passed.
No Spine JVM command was run.

## Final interleaving evidence — 2026-07-28

The final gateway-level matrix proves synchronous admission snapshots; stale
Actor and tenant rejection for Activate/Cancel; foreign owner/tenant denial
without queue consumption; Subscribe and compensation timeout, abort, and
lease release; true cancel-first ordering; expiry across active and queued
work; and close across active effects and bounded cleanup.

Fresh focused evidence: 3 auth files / 45 tests passed; auth typecheck and the
generated TypeDoc/API inventory passed (43 auth exports); Prettier and diff
hygiene passed. No Spine JVM command was run.

## Last targeted correction — 2026-07-28

Gateway close now settles a pending public Subscribe handle: the shared,
gateway-owned controller races both the operation timeout and its abort event.
It is also passed to pre-binding compensation, ensuring close controls the
whole pre-binding lifetime. The focused test holds Subscribe, closes the
gateway, observes the abort event, and observes the handle rejection. The
former forwarding-only gateway wrapper was removed.

## Final B3 regression evidence — 2026-07-28

The final gateway-level matrix proves synchronous copied wire and transport
admission while security awaits; stale Actor/Tenant Activate and Cancel denial
without backend callbacks; foreign owner and tenant Cancel denial without
consuming the single pending slot; timeout abort and lease release for hung
Subscribe and compensation; a cancel-first admission race; ordered
expiry-versus-active/queued settlement; and close-driven abort, bounded cleanup,
and zero retained bindings. `withTimeout()` also rejects a controller that was
already aborted before listener registration.

The exact final verification evidence is recorded in the durable work log below
this report's prior historical checkpoints. No Spine JVM command was run.

## Terminal-race correction — 2026-07-28

The initial 33-test/41-export evidence block above is historical and superseded
by the later 45-test/43-export checkpoint. A just-completed pre-binding
Subscribe now remains gateway-tracked through binding creation, so close aborts
its original controller and releases its reservation. If that close makes
creation fail, mandatory private-envelope disposal receives a fresh live
controller bounded by `shutdownTimeoutMs`; a timed-out compensation releases a
capacity-one lease for a subsequent successful Subscribe. Fresh verification:
three focused auth files / 47 tests, auth typecheck, generated TypeDoc/API
checking, Prettier, and diff hygiene passed. No Spine JVM command ran.

## Terminal-race reliability P2 closure — 2026-07-28

The strengthened close-raced compensation regression holds mandatory disposal
after Subscribe completes but before retention. The fresh compensation signal
starts live, aborts at `shutdownTimeoutMs`, settles the public handle, releases
the capacity-one reservation, and leaves no retained binding. Existing runtime
behavior satisfied this test; no production change was required. Fresh focused
verification passed: 3 auth files / 47 tests, auth typecheck, generated
TypeDoc/API checking, Prettier, and diff hygiene. No Spine JVM command ran.

## Coverage test expansion — 2026-07-28

Four behavior tests cover gateway terminal/routing/security failures, optional
trusted context and present transport facts, store input rejection, and public
capacity-error mapping. They raise focused `subscriptions/index.ts` branches
from 77.43% to 88.71% (+22 branches), which is exactly 8,659/9,621 = 90.00%
when applied to the preceding unrestricted total. No production behavior,
threshold, or ignore configuration changed. The local unrestricted rerun
completed without a final coverage summary or LCOV artifact; its exact global
post-change figure awaits coordinator confirmation.
