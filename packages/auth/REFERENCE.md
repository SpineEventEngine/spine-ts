# @spine-event-engine/auth reference

This reference records the exact public contract of `@spine-event-engine/auth`.
Start with the [authentication overview](README.md) when choosing a gateway shape.

## Purpose and trust boundary

The package supplies provider-neutral gateway building blocks. An application places its gateway in front of a Spine TS or Spine JVM backend, then supplies the listener, credential extraction, identity provider, session storage, authorization rules, actor/tenant resolution, and forwarding implementation. The framework does not enforce a particular proxy, route topology, identity provider, tenant policy, or deployment configuration.

`TransportFacts.from()` exposes only allowlisted request facts. Credentials are passed only to `Authenticator` or `SessionResolver`; they are not included in `IncomingRequest`. `IncomingRequest` is a discriminated union for command, query, subscription creation, activation, and cancellation. Command facts can include a decoded message when a `TypeRegistryLookup` knows its packed type; unknown and malformed `Any` values remain type-URL-only facts.

`AuthorizationPolicy.authorize()` is evaluated separately for each incoming request. `ContextResolver.resolve()` returns the trusted actor, optional tenant, timestamp, zone, and language. The caller-provided `ActorContext` must match that resolved actor and tenant, otherwise `UnaryGateway` rejects the request as `context-stale`. Backends can trust the forwarded, gateway-replaced context only when the deployment routes traffic through an application-selected gateway.

## Dynamic subscription membership

A standalone browser Gateway uses one complete membership owner for commands,
queries, and native subscription streams. A fixed backend list is static
membership input and is not capped; dynamic discovery replaces it with later
complete snapshots. Notices can be duplicated, missing, or lost.
Browser code must treat notices as refresh hints and use Queries as the
authoritative state source. The owner keeps one native child stream for every
active logical subscription on every current node. Membership changes converge
through one latest-only generation owner: removed or stale nodes cannot revive
their children, while a zero-node interval retains an existing definition for
later recovery. New subscription creation reports backend unavailability while
membership is empty.

## Unary requests

`UnaryGateway` accepts `CommandService.Post`, `QueryService.Read`, and
`AuthenticationService.ResolveContext`. Construct both `UnaryGateway` and
`SubscriptionGateway` with exactly one admission mode: a `SessionResolver`, or
`publicAccess: true`. Public access creates no login session and no synthetic
expiry. It is appropriate only when the application deliberately exposes the
Gateway and its authorization policy reconstructs trusted context from request
facts. Both modes also require finite request limits, an authorization function,
`ContextResolver`, clock, and the corresponding forwarding collaborator.

For Post and Read, it bounds and decodes bytes, admits the request through the selected mode, authorizes the decoded request, resolves trusted context, checks requested actor/tenant, and forwards exactly once. In authenticated mode, admission resolves the supplied session. In public mode, it uses the framework-owned public principal and no session. The forwarder receives only service, method, bytes, and optional cancellation signal. It does not receive credentials or extra transport facts. It returns `forwarded`, `resolved`, or a rejection reason: `request-too-large`, `unknown-operation`, `malformed-request`, `unauthenticated`, `forbidden`, or `context-stale`. Mapping a rejection to HTTP or gRPC status is the native transport adapter's job.

ResolveContext returns informational trusted actor and tenant facts in both modes. In authenticated mode, it validates the current session and also returns its expiry. In public mode, it resolves context for the framework-owned public principal and omits `expiresAt` because no session exists. It neither authorizes a business request nor creates a reusable credential. Later requests are independently admitted and authorized.

## Sessions and sign-in

`OpaqueSessions` implements a bounded, process-local `SessionResolver` with random cookie credentials. Defaults are an eight-hour lifetime, 10,000 retained sessions, and three identifier attempts. It lazily removes expired entries and is terminal after `close()`. It suits local development and the supported single-Gateway shape; choose an application session strategy that meets that gateway's restart and revocation requirements.

`SignedSessions` provides signed application session tokens. Local signature validation can delay revocation; shared revocation requires an explicit `SignedTokenRevocation` implementation. `OpaqueSessionCookies` supplies strict cookie parsing and serialization helpers. Neither strategy provisions users nor grants permissions.

`OidcFlow` is a bounded authorization-code and PKCE transaction manager. It works with `createGoogleProvider`, `createGitHubProvider`, or a discovered or configured OIDC provider. Applications expose start/callback/exchange endpoints, perform HTTP routing, map verified external identity through `IdentityMapping`, and issue an application session through `ApplicationSessionIssuer`. Provider access, refresh, and ID tokens remain sensitive server-side material; do not return them to browser application code.

## Subscription and native adapters

`SubscriptionGateway` and `InMemorySubscriptionBindings` compose subscription creation, activation, cancellation, and relaying at the gateway boundary. The Gateway accepts a logical `SubscriptionCoordinator`; native `SubscriptionCreator` instances remain a per-node implementation seam. This is an intentional replacement of the former public native-creator input, with no compatibility adapter because Spine TS has no deployed users. In-memory bindings are local to one process and have finite operation limits; they do not provide cross-machine propagation. `createNativeGatewayServices`, `NativeSubscriptionCreator`, and `SubscriptionUpdateRelay` adapt these public contracts to the native service layer. They do not make a deployment secure by themselves: applications choose how their listener accepts only gateway-routed traffic.

`DurableSubscriptionBindings` in the Server package retains one approved
`GatewayAuthenticatedSubscription` per public Subscription. The retained Topic
includes the trusted Actor and Tenant, so Activate and Cancel compare that pair
with the newly resolved request context. It is single-Gateway persistence, not
cross-process quota, reservation, lease, fence, or fingerprint coordination.

Subscription creation has two stages. `Subscribe` stores a definition and
returns its ID; `Activate` must arrive within the framework's bounded activation
handshake. If activation never arrives, the incomplete definition is cancelled.
Once activated, a healthy stream has no framework time-to-live. It ends only
when the caller cancels or disconnects, the backend ends the stream, or the
Gateway shuts down.

Authenticated durable definitions use the real session expiry stored with the
definition. Expiry maintenance first stops an active binding, waits for its
serialized work, cancels the backend subscription once, and then deletes the
stored record. Concurrent maintenance callers join the same purge operation.
Public mode has no session expiry and does not use that durable authenticated
record; its process-local definitions disappear when the Gateway process ends.
Neither mode stores a replayable history of emitted updates, so a reconnecting
browser queries authoritative state before subscribing again.

## Errors, lifecycle, and extension

Public callbacks may reject; applications decide how their native listener maps those failures. Values handed to request collaborators are defensive gateway facts, while applications remain responsible for mutable state and cleanup. Always give gateway operations a finite request limit and make credential, provider, session, and forwarding adapters cancellation-aware.

Read the [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md) for composition examples and deployment guidance.

# Dynamic unary discovery

`DynamicUnaryForwarder` accepts complete current application-node snapshots. It serializes reconciliation, retains only the latest pending snapshot during churn, starts clients in bounded batches, disposes departed clients, and round-robins commands and queries across the resulting set. A dispatched unary request is never retried. Empty membership reports backend unavailability until a later snapshot restores clients.

Dynamic subscriptions use the same reconciliation owner. Durable bindings retain
the logical subscription definition and trusted Actor/Tenant facts only; native streams are
ephemeral per-node work. Nodes may be added, removed, or re-added without
changing a durable definition. Notifications are best effort, may duplicate,
and browser clients reconnect and re-query authoritative state after loss.

Closing the forwarder aborts in-flight client creation, waits for that work to settle, and cleans up current clients. Failed cleanup remains retryable on a later close.
