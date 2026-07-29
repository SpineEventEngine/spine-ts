# B4 — Native forwarding and bounded relay

Status: Architecture boundary

## Classification

High-risk. B4 changes public transport contracts, server-stream lifecycle,
concurrency, cancellation, resource ownership, and gateway trust-boundary
behavior.

## Human-Imposed Requirements Ledger

- Spine JVM is static read-only reference material only. Do not build, test,
  generate, resolve dependencies for, launch, or otherwise execute the Spine
  JVM project.
- Spine TS and JVM backends must eventually be served through the same
  standalone auth gateway, but Wave 4 JVM evidence remains static
  source/descriptor compatibility only.
- The backend receives a trusted `ActorContext` and does not perform
  authentication or authorization.
- Commands are never retried.
- Subscribe, Activate, and Cancel are independently authenticated and
  authorized.
- Subscriptions provide no completeness guarantee; update gaps, duplicates,
  and reordering remain possible.
- Relay message-count and byte bounds are independent. Crossing either bound
  aborts both sides.
- Browser disconnect, session expiry, explicit cancellation, or backend error
  aborts native work.
- Cleanup is bounded and idempotent; no native call, timer, queued payload, or
  backend subscription is retained after terminal cleanup.
- Use the smallest idiomatic TypeScript design that preserves feature parity;
  do not invent speculative transport abstractions.
- No Redis, Hazelcast, publication, React, Chat, Envoy, concrete sessions, or
  provider work belongs in B4.

## Frozen inputs

- B2 `UnaryGateway` owns bounded decode/authentication/authorization/context
  rewrite and exposes a transport-neutral unary forwarding seam.
- B3 `SubscriptionGateway` owns independent security decisions, opaque
  backend binding, per-binding ordering, finite operation deadlines, mandatory
  compensation, and terminal cleanup.
- Native shared services are `CommandService.Post`, `QueryService.Read`,
  `SubscriptionService.Subscribe`, `SubscriptionService.Activate`, and
  `SubscriptionService.Cancel`.
- `SubscriptionService.Activate` is server-streaming. B3 currently models its
  authorized backend effect as `Promise<void>`, so B4 must freeze a minimal
  update-relay seam without exposing backend subscription bytes publicly.

## Required architecture answer

Specify the smallest B3-compatible API change and module layout that:

1. forwards unary Post/Read to an injected native Connect/gRPC transport;
2. creates, activates, cancels, and disposes native backend subscriptions;
3. relays activation updates to the authorized public stream;
4. applies independent finite message-count and byte bounds;
5. stops backend reads when downstream cannot accept within those bounds;
6. propagates disconnect, expiry, cancellation, overflow, backend error, and
   gateway close in both directions;
7. performs bounded, idempotent backend cancellation/disposal exactly once;
8. preserves B3 opaque binding ownership and its already-reviewed race rules;
9. keeps credentials and non-allowlisted transport facts out of backend calls;
10. can serve a Spine TS or Spine JVM backend through the same shared service
    descriptors without running JVM code.

Define exact public/internal contracts, default finite limits, error mapping,
ownership/state transitions, and a behavior-first RED/GREEN test matrix.

## Verification and review

Implementation must use TDD, focused auth tests/typecheck/API/docs checks, then
the full TypeScript repository gate. Relevant specialist concerns are
style/maintainability, TypeScript/API docs, documentation, and
performance/reliability. Security remains part of the final Wave 4 gate.

## Frozen architecture decision

- `SubscriptionUpdateWire` owns copied serialized public-update bytes.
  `SubscriptionUpdateSink` is asynchronous, so producer progress follows
  downstream admission.
- `SubscriptionCreator.activate` receives the public-update sink while its
  returned `Promise<void>` remains the complete backend stream lifetime.
- The native public Activate adapter wraps `SubscriptionGateway`; it must not
  wrap or invoke `SubscriptionCreator` directly, because doing so would bypass
  B3 authentication, authorization, ownership, and state transitions.
- The injected native backend implements B2 unary forwarding and B3
  subscribe/activate/cancel/dispose through shared service descriptors and an
  injected Connect `Transport`. It receives no browser credential or
  non-allowlisted transport facts.
- Relay defaults are 64 buffered messages and 1,048,576 buffered bytes. Each
  explicit value must be a positive safe integer. Undefined partial values use
  the defaults.
- Count overflow is checked before byte overflow. Both map to Connect
  `ResourceExhausted`, with deterministic messages that identify the
  overflowing dimension, limit, and observed value.
- The relay copies each serialized update, preserves FIFO order, and owns only
  buffer/waiter termination. B3 remains the sole owner of backend
  cancellation/disposal. Disconnect, expiry, explicit Cancel, overflow,
  backend error, normal completion, iterator `return()`/`throw()`, and gateway
  close converge through one idempotent terminal transition.
- Use installed `@connectrpc/connect` 2.1.2 and the shared generated service
  descriptors. No new transport library is needed.

## Ordered TDD slices

1. RED/GREEN the public-update wire/sink and B3 Activate stream-lifetime seam.
2. RED/GREEN the injected native unary and subscription backend adapter.
3. RED/GREEN relay limits, copied FIFO delivery, graceful drain, and
   count-first/byte-second overflow.
4. RED/GREEN the Connect-facing gateway handlers/status mapping and terminal
   convergence across disconnect, expiry, Cancel, overflow, backend error,
   iterator termination, and close.
5. Update root exports, exact API inventory, package docs, and task evidence;
   run focused and full TypeScript gates.
