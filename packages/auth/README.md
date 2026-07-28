# @spine-event-engine/auth

Provider-neutral authentication gateway contracts for Spine services.

This package defines request facts, authentication/session/authorization and
trusted-context seams. `IncomingRequest` has one discriminated member for each
Spine service operation: command, query, subscribe, activate, and cancel.
Transport facts are allowlisted; credentials are supplied only to
`Authenticator` or `SessionResolver` and never become request facts.

The `command` variant of `IncomingRequestInput` may carry an optional Wave 3
`TypeRegistryLookup` for packed-command inspection. Unknown or malformed `Any`
values remain safe type-URL-only facts, so policies do not need application
schemas.

`UnaryGateway` is the bounded B2 transport-neutral pipeline for
`CommandService.Post`, `QueryService.Read`, and
`AuthenticationService.ResolveContext`. It bounds and decodes known request
bytes before session work, authorizes every Post/Read, rejects stale actor or
tenant hints, and replaces a matching caller `ActorContext` with a newly
constructed trusted value. The trusted timestamp is the value returned by the
context resolver, whose injected clock is available during resolution. Every
non-`ActorContext` envelope field, including unknown Protobuf fields, is
preserved byte-equivalently. Its forwarding and rejection seams intentionally do
not select a gRPC status; B4 owns native transport mapping. The forwarded
request never includes a credential and a unary request is forwarded once.

`AuthenticationService.ResolveContext` validates the application session and
returns only informational actor, tenant, and expiry data. It does not invoke a
Spine backend, it is not a credential, and every later request is independently
authenticated and authorized. Concrete session strategies, OIDC providers, and
browser integration remain later Wave 4 slices.

`SubscriptionGateway` is the bounded B3 ownership boundary for the exact
`SubscriptionService.Subscribe`, `Activate`, and `Cancel` RPCs. Its admission
input uses a discriminated raw `subscription-topic` wire only for Subscribe and
a discriminated raw `public-subscription` wire only for Activate/Cancel. The
gateway copies that wire and captures one immutable allowlisted transport
snapshot; authorization and context resolution each receive independent decoded
views. Tenant is optional: it matches only when both contexts omit it or their
serialized-tenant-fingerprints are identical.

Every operation resolves its session and authorizes again. Subscribe returns
only a copied public `Subscription` wire with a generated gateway ID. The raw
`backend-subscription-envelope` is trusted-infrastructure-only: it is copied
into the injected binding store, is never returned from a store transition or a
gateway result, and is supplied only as a fresh copy to the gateway-controlled
backend callback. Application and browser results therefore cannot reveal
backend bytes. Stale actor or tenant hints are rejected before any callback.

Activation and cancellation require the stored owner fingerprint and unexpired
session lifetime. Owner and serialized-tenant-fingerprint checks run before a
queue slot is reserved and again when it runs. Coordination is finite and per
binding: one queued operation is allowed behind a running effect, while
unrelated bindings progress independently. Capacity is leased before backend
Subscribe and released on every failed creation. The defaults bound admission and backend envelopes at 1 MiB,
retained bindings at 100, operations at 30 seconds, and shutdown cleanup at one
second. Overflow rejects deterministically without retaining bytes. The in-memory
reference store requires a disposal callback; expiry detaches each binding and
starts its mandatory disposal without waiting on unrelated IDs. Backend
callbacks and private-envelope `dispose` compensation are mandatory and receive
the standard event-capable `AbortSignal`; callbacks must cooperate with abort
for the timeout and zeroing bound to apply. If cancellation rejects, its private envelope and
cancelling state are retained for an authorized retry; Subscribe creation
failure compensates with `dispose`, reporting an ordered `AggregateError` if
both actions fail. `close()` is terminal, aborts effects, zeroes private
envelopes, clears retention, and reports cleanup failures as an `AggregateError`.
The reference store owns no background timer;
gateway activity lazily purges expiry. B3 has no native gRPC or stream relay:
B4 owns transport mapping and stream lifecycle.
