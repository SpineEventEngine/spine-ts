# T-0110 Implementation Brief

## Public Configuration

- Preserve `browser.backend: { baseUrl }` for one remote node.
- Add `browser.backend: { baseUrls }` for an ordered fixed list of 1–32
  canonical, unique HTTP(S) origins.
- Preserve list order for bounded round-robin selection. A reordered list is a
  different topology.
- Combined mode remains one local backend and uses the same internal path.

## Fixed Native Topology

Deepen the existing native Gateway collaborator rather than adding a second
Gateway subsystem.

- Unary forwarding selects one child in round-robin order and invokes it once.
  A failed command or query is returned; it is never retried on another node.
- Subscription creation invokes every child. It retains one finite composite
  opaque envelope only after all children succeed.
- A partial create disposes every successful child with `allSettled` semantics,
  releases capacity, and retains no durable binding.
- Activate, cancel, and dispose decode the composite envelope and invoke every
  child. Cleanup attempts all children even after one fails.
- The composite codec is internal, versioned, length-delimited, bounded to 32
  children, and constrained by the existing total backend-envelope byte limit.
  Backend bytes never enter public results.
- No deduplication history or reconnect loop is introduced. Duplicate updates
  may reach the browser.

## Durable Topology Identity

- Compute a deterministic topology fingerprint from the ordered canonical URL
  list using unambiguous length-delimited input and SHA-256.
- Topology identity is separate from principal ownership fingerprinting.
- Store topology identity with each durable binding and require an exact match
  before activation or cancellation invokes a backend callback.
- Missing, malformed, or different topology identity fails closed. No migration
  compatibility for unpublished durable records is required.
- Bump the internal durable record storage key when its record shape changes.

## Non-Terminal Backend Loss

- Do not modify frozen Spine Protos.
- When one child activation stream ends or fails while another remains active,
  emit one valid `SubscriptionUpdate` for the accepted subscription whose
  existing `response.status` contains a generic error and whose Entity/Event
  update is absent. Do not expose endpoint URLs or credentials.
- `client-web` recognizes this notice, emits lifecycle `gapPossible`, suppresses
  it from the domain update channel, and continues reading healthy child
  streams.
- When all children end, the public stream ends normally and the existing
  reconnect/re-query policy applies. Cancellation prevents reconnect.

## Ownership And Order

One implementation owner works dependency-first:

1. auth subscription topology/composite contracts and RED tests;
2. durable binding identity and recovery/fencing tests;
3. native bounded fan-in and round-robin tests;
4. BrowserServer configuration/wiring and native/browser integration tests;
5. client-web non-terminal lifecycle handling;
6. Message Board environment/manifests and focused deployment tests.

The owner must preserve authentication termination, Actor/Tenant rewriting,
byte wiping, relay bounds, capacity reservations, durable leases, cancellation
single-flight behavior, and the current singular and combined deployments.

## Required Behavior Tests

- 1 and 32 endpoints accepted; 0, 33, duplicate, and noncanonical endpoints
  rejected.
- Unary round robin sends each request exactly once; failure is not retried;
  trusted Actor/Tenant context is unchanged after Gateway rewriting.
- Subscribe/Activate/Cancel reach all children; duplicate updates pass.
- Partial create/activation cleans every child, durable row, reservation, and
  capacity slot.
- Cancel joins concurrent cancel/close and starts no reconnect afterward.
- Matching durable topology recovers; reordered/different/missing topology
  rejects before effects; cross-handle fencing remains intact.
- One child loss emits `gapPossible` while a healthy child continues.
- Existing single-backend, combined, native, browser, and Message Board startup
  behavior remains green.
