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
authenticated and authorized. Signed sessions, OIDC/provider transactions, and
browser reconnect integration remain later Wave 4 slices.

`OpaqueSessions` is the C1 process-local `SessionResolver`: it produces 32-byte
base64url cookie credentials, retains at most 10,000 sessions for eight hours,
and lazily removes expiry. Its `ttlMilliseconds`, `maxSessions`, and
`collisionAttempts` options are positive safe integers, defaulting to 28,800,000
milliseconds, 10,000 sessions, and three collision attempts. An injected clock
returns safe-integer Unix milliseconds and fails closed when invalid or
throwing; its random callback receives exactly 32 and must return exactly 32
bytes, with failures mapped through the configured collision-attempt bound
(three by default). Creation,
lookup, rotation, and logout are atomic
method-local transitions. Rotation deletes the old credential before returning
the replacement; logout is enumeration-safe and idempotent. Principal identity
and attributes are copied on admission and resolution. `close()` is terminal
and drops all retained records. It does not provide persistence, sharing,
signed tokens, OIDC transactions, or a background cleanup timer.
Invalid or throwing injected clocks fail closed and clear retained sessions;
invalid or throwing randomness is consumed only through the configured
collision-attempt bound and returns an entropy rejection. Expired resolution is
empty, expired rotation rejects, and creation after live capacity is full
rejects without retaining another principal.

`OpaqueSessionCookies` is a framework-neutral browser-boundary helper. It
requires a copied 32-byte-or-larger HMAC secret and canonical non-empty exact
Origins; its owned secret copy is zeroed on close. The distinct valid `__Host-`
cookie-name options default to `__Host-spine-session` and `__Host-spine-csrf`.
It serializes only host-only `Secure` `SameSite=Lax` cookies, with the session
cookie also `HttpOnly`. A present Authorization header takes precedence over
cookies and malformed/duplicate bearer inputs do not fall back. Cookie use
requires one session cookie, one CSRF cookie, one exact Origin, and one
`X-Spine-CSRF`; the HMAC-SHA-256 CSRF values are fixed-length compared in
constant time. The helper rejects duplicate or malformed browser facts and
zeroes its owned mutable secret at terminal close. Callers must install the
serialized strings in their chosen HTTP adapter; this package is not one.
Parsing is finite by default: at most 32 header fields/array values, 16,384
total header characters, and 64 cookie pairs; callers may lower or raise each
with a positive-safe-integer `maxHeaderValues`, `maxHeaderCharacters`, or
`maxCookiePairs` option. Over-limit input rejects as `request-too-large`.

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
gateway activity lazily purges expiry, while an admitted live Activate owns an
expiry timer so it terminates without a later request.

`NativeSubscriptionCreator` maps the B2 unary seam and B3 opaque lifecycle to
the shared Connect descriptors using an injected `Transport`. It forwards no
credential or browser transport facts. `SubscriptionUpdateRelay` is the B4
public stream seam: it copies serialized updates, preserves FIFO order, and
uses independent positive-safe-integer bounds (defaults: 64 messages and
1,048,576 bytes). Count is checked before bytes; either overflow ends the
stream with Connect `ResourceExhausted` and a deterministic message. The
adapter remains behind `SubscriptionGateway`; it does not call
`SubscriptionCreator` from a public handler.

The terminal lifecycle is idempotent. Browser disconnect and handler-context
abort, iterator `return()`/`throw()`, session expiry, explicit Cancel,
overflow, malformed update bytes, backend or gateway error, and gateway close
abort native work, purge relay bytes, and perform bounded B3 cleanup. Natural
native completion starts graceful FIFO drain, but a later disconnect, context
abort, or iterator terminal operation supersedes that drain and purges queued
bytes. After successful cleanup, natural completion, overflow, malformed or
backend failure, explicit Cancel, disconnect, and expiry retain no binding,
native call, timer, backend subscription, waiting consumer, or queued payload.
A failed cleanup deliberately retains only the private binding in its retryable
`cancelling` state for a later authorized Cancel.
