# @spine-event-engine/auth reference

This reference is for agents and other automated tools that need the exact public contract of `@spine-event-engine/auth`.

## Purpose and trust boundary

The package supplies provider-neutral gateway building blocks. An application places its gateway in front of a Spine TS or Spine JVM backend, then supplies the listener, credential extraction, identity provider, session storage, authorization rules, actor/tenant resolution, and forwarding implementation. The framework does not enforce a particular proxy, route topology, identity provider, tenant policy, or deployment configuration.

`TransportFacts.from()` exposes only allowlisted request facts. Credentials are passed only to `Authenticator` or `SessionResolver`; they are not included in `IncomingRequest`. `IncomingRequest` is a discriminated union for command, query, subscription creation, activation, and cancellation. Command facts can include a decoded message when a `TypeRegistryLookup` knows its packed type; unknown and malformed `Any` values remain type-URL-only facts.

`AuthorizationPolicy.authorize()` is evaluated separately for each incoming request. `ContextResolver.resolve()` returns the trusted actor, optional tenant, timestamp, zone, and language. The caller-provided `ActorContext` must match that resolved actor and tenant, otherwise `UnaryGateway` rejects the request as `context-stale`. Backends can trust the forwarded, gateway-replaced context only when the deployment routes traffic through an application-selected gateway.

## Fixed gateway topology

A standalone browser Gateway accepts a fixed list of 1–32 backend origins.
Commands and queries select one backend with bounded round-robin forwarding and
do not retry a failed request. Subscription creation and activation fan out to
the configured nodes; merged notices can be duplicated, missing, or lost.
Browser code must treat notices as refresh hints and use Queries as the
authoritative state source. The list is configured at startup: there is no
dynamic backend discovery or redeployment protocol.

## Unary requests

`UnaryGateway` accepts `CommandService.Post`, `QueryService.Read`, and `AuthenticationService.ResolveContext`. Construct it with a finite `maxRequestBytes`, `SessionResolver`, authorization function, `ContextResolver`, clock, and `UnaryForwarder`.

For Post and Read, it bounds and decodes bytes, resolves a session, authorizes the decoded request, resolves trusted context, checks requested actor/tenant, and forwards exactly once. The forwarder receives only service, method, bytes, and optional cancellation signal. It does not receive credentials or extra transport facts. It returns `forwarded`, `resolved`, or a rejection reason: `request-too-large`, `unknown-operation`, `malformed-request`, `unauthenticated`, `forbidden`, or `context-stale`. Mapping a rejection to HTTP or gRPC status is the native transport adapter's job.

ResolveContext validates the current session and returns informational actor, tenant, and expiry facts. It neither authorizes a business request nor creates a reusable credential. Later requests are independently authenticated and authorized.

## Sessions and sign-in

`OpaqueSessions` implements a bounded, process-local `SessionResolver` with random cookie credentials. Defaults are an eight-hour lifetime, 10,000 retained sessions, and three identifier attempts. It lazily removes expired entries and is terminal after `close()`. Use a durable or shared `SessionResolver` when multiple gateway processes must recognize the same session.

`SignedSessions` provides signed application session tokens. Local signature validation can delay revocation; shared revocation requires an explicit `SignedTokenRevocation` implementation. `OpaqueSessionCookies` supplies strict cookie parsing and serialization helpers. Neither strategy provisions users nor grants permissions.

`OidcFlow` is a bounded authorization-code and PKCE transaction manager. It works with `createGoogleProvider`, `createGitHubProvider`, or a discovered or configured OIDC provider. Applications expose start/callback/exchange endpoints, perform their own HTTP routing, map verified external identity through `IdentityMapping`, and issue their own application session through `ApplicationSessionIssuer`. Provider access, refresh, and ID tokens remain sensitive server-side material; do not return them to browser application code.

## Subscription and native adapters

`SubscriptionGateway` and `InMemorySubscriptionBindings` compose subscription creation, activation, cancellation, and relaying at the gateway boundary. In-memory bindings are local to one process and have finite operation limits; they do not provide cross-machine propagation. `createNativeGatewayServices`, `NativeSubscriptionCreator`, and `SubscriptionUpdateRelay` adapt these public contracts to the native service layer. They do not make a deployment secure by themselves: applications choose how their listener accepts only gateway-routed traffic.

## Errors, ownership, and extension

Public callbacks may reject; applications decide how their native listener maps those failures. Values handed to request collaborators are defensive gateway facts, while applications remain responsible for their own mutable state and cleanup. Always give gateway operations a finite request limit and make credential, provider, session, and forwarding adapters cancellation-aware.

Read the [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md) for composition examples and deployment guidance.
