# @spine-event-engine/auth reference

This reference records the exact public contract of `@spine-event-engine/auth`.
Start with the [authentication overview](README.md) when choosing a gateway shape.

## Purpose and trust boundary

The package supplies provider-neutral gateway building blocks. An application places its gateway in front of a Spine TS or Spine JVM backend, then supplies the listener, credential extraction, identity provider, session storage, authorization rules, actor/tenant resolution, and forwarding implementation. The framework does not enforce a particular proxy, route topology, identity provider, tenant policy, or deployment configuration.

`TransportFacts.from()` exposes only allowlisted request facts. Credentials are passed only to `Authenticator` or `SessionResolver`; they are not included in `IncomingRequest`. `IncomingRequest` is a discriminated union for command, entity query, application query, subscription creation, activation, and cancellation. Command facts can include a decoded message when a `TypeRegistryLookup` knows its packed type; unknown and malformed `Any` values remain type-URL-only facts.

`AuthorizationPolicy.authorize()` is evaluated separately for each incoming request. `ContextResolver.resolve()` returns the trusted actor, optional tenant, timestamp, zone, and language. The caller-provided `ActorContext` must match that resolved actor and tenant, otherwise `UnaryGateway` rejects the request as `context-stale`. Backends may rely on these identity checks only when the deployment routes traffic through an application-selected gateway.

After those checks, Post preserves the original Command's `ActorContext`,
including its creation timestamp, zone, and language. These fields describe the
caller's request; they are not gateway-attested metadata. Preserving them keeps
the Event's complete `past_message` Origin equal to the originating Command's
Origin, as in Spine JVM. Authorization and context resolution receive isolated
request views; changes to those views cannot change the forwarded Command.
Read and subscription Topic requests still receive the resolver's context.

## Dynamic subscription membership

A standalone browser Gateway uses one complete membership owner for commands,
queries, and native subscription streams. A fixed backend list is static
membership input and is not capped; dynamic discovery replaces it with later
complete snapshots. Notices can be duplicated, missing, or lost.
Browser code must treat notices as refresh hints and use Queries as the
authoritative state source. The gateway keeps one native child stream for every
active logical subscription on every current node. Membership changes converge
through one latest-only generation: removed or stale nodes cannot revive their
children, while a zero-node interval retains an existing definition for later
recovery. New subscription creation reports backend unavailability while
membership is empty. The gateway emits one logical activation ACK only after all
required native children attach and acknowledge. Child ACKs from later joins stay internal. A child
failure before readiness cleans up admitted siblings, while generic unary
membership routing remains independent of subscription readiness. Concurrent
Cancel requests for the same trusted context and ID share one bounded attempt;
a failed remote cleanup remains retryable.

## Unary requests

`UnaryGateway` accepts `CommandService.Post`, `QueryService.Read`, `QueryService.Execute`, and
`AuthenticationService.ResolveContext`. Construct both `UnaryGateway` and
`SubscriptionGateway` with exactly one admission mode: a `SessionResolver`, or
`publicAccess: true`. Public access creates no login session and no synthetic
expiry. It is appropriate only when the application deliberately exposes the
Gateway, its authorization policy admits the public principal, and its
`ContextResolver` reconstructs trusted context from request facts. Both modes
also require finite request limits, an authorization function,
`ContextResolver`, clock, and the corresponding forwarding collaborator.

For Post, Read, and Execute, it bounds and decodes bytes, admits the request through the selected mode, authorizes the decoded request, resolves trusted context, checks requested actor/tenant, and forwards exactly once. In authenticated mode, admission resolves the supplied session. In public mode, it uses the public admission marker and no session. The forwarder receives service, method, bytes, detached `reader` facts, and an optional cancellation signal. It does not receive credentials or extra transport facts. It returns `forwarded`, `resolved`, or a rejection reason: `request-too-large`, `unknown-operation`, `malformed-request`, `unauthenticated`, `forbidden`, or `context-stale`. Mapping a rejection to HTTP or gRPC status is the native transport adapter's job.

ResolveContext returns informational trusted actor and tenant facts in both modes. In authenticated mode, it validates the current session and also returns its expiry. In public mode, it resolves context for the framework-owned public principal and omits `expiresAt` because no session exists. It neither authorizes a business request nor creates a reusable credential. Later requests are independently admitted and authorized.

### Verified reader forwarding

`reader.principal` contains the admitted application principal's ID and string
attributes. `reader.authorityFacts` comes from `AuthorizedRequestContext.authorityFacts`
and accepts finite JSON values, including nested objects and arrays. The gateway
copies these values for the invocation. Public admission omits both fields even
if a context resolver supplies facts for the public admission marker.
The existing `ContextResolver` remains the replacement point for obtaining
application-specific authority information; there is no provider polling or
promise that its information remains current after resolution.

`NativeSubscriptionCreator(transport, { issuer, maxBytes })` uses the configured
issuer to forward that reader with each native operation. `BrowserServerOptions.forwardingProof`
configures the same issuer in browser composition. Its `issue(bytes)` method
returns a transport-safe proof. The application node's corresponding
`services.readerAdmission.forwarded.verify(bytes, proof, peer)` verifies the
forwarding peer and the assertion. The signed bytes bind the service, method,
canonical request, and reader facts; an Activate proof cannot authorize Cancel.
Internal metadata received from a caller is not accepted without that verifier.

An authenticated native forwarding call without an issuer fails rather than
discarding its reader identity. Configure both issuer and verifier for authenticated
browser forwarding. These are TS forwarding ports; merely sending
their metadata to a JVM backend does not add verified-reader support there.
Custom forwarding implementations must establish the equivalent trust at their
receiving boundary. Credentials and provider tokens are not forwarding fields.

## Sessions and sign-in

`OpaqueSessions.create` requires an application scope, iron-session password
configuration, trusted clock, and positive lifetime. `issue` seals a random
stable reference and generation before atomic absent insertion. `resolve`
checks the current stored generation and exact deadline without renewal.
The authenticated application deadline is authoritative: any grace period in
iron-session's seal validation cannot extend it. Rotation seals before
compare-and-set. An old unexpired seal can revoke the current generation, but
an expired seal cannot resolve or revoke.

Omitting the store selects process-local memory. `PersistentOpaqueSessionStore.create`
accepts a common storage factory and group; it prepares the indexed session
family before returning by default. `createMissingStructures: false` opens a
non-preparing handle for already prepared structures. The strategy leaves an
injected store open, so the application closes the strategy, store, and factory
separately. Explicit `purgeExpired(cutoff, signal)` traverses finite indexed
pages with conditional removal in the persistent store; process-local memory
scans its own records. If a row changes during conditional removal, the pass
finishes that expiry group and returns its removed count. The changed row and
other eligible rows in later groups can remain for another explicit purge.
Storage errors and cancellation reject, possibly after partial removal. No
timer calls maintenance automatically.

For cancellation after a confirmed insertion or replacement, the strategy
attempts conditional compensation and returns no credential. A storage error
that does not confirm whether a commit occurred cannot safely authorize removal:
another session may already occupy the same stable reference. The operation
fails without returning a credential, but a committed row may require later
explicit maintenance. This is a best-effort cleanup guarantee.

`SignedSessions` issues and verifies ES256 application bearer tokens using jose.
Without a `SignedTokenRevocation` source, logout is expiry-only. For shared
revocation, create `PersistentTokenRevocations` with a storage factory, group,
issuer, and audience, then inject it as `revocation`. Its asynchronous factory
prepares the indexed record family by default; `createMissingStructures: false`
opens a non-preparing handle with no physical schema checks or DDL at creation
or during later operations. If structures are missing, ordinary storage
operations fail. Close the strategy, revocation store, and shared
factory separately. The strategy passes the full inclusive acceptance deadline,
including clock skew, to the store. Reads ignore records after that deadline
even before maintenance. Explicit `purgeExpired(cutoff, signal)` removes only
records strictly before a cutoff no later than the store's trusted clock. It
uses scoped indexed pages and conditional deletion; a concurrent change can
leave eligible rows for a later invocation. No automatic cleanup runs.

`SessionResolver.resolve(credential, lifetime?)` accepts an optional operation
signal. Omitting it performs one validation without a retained monitor. With
one, standard opaque and signed strategies register by stable authenticated
identity before the authoritative storage or revocation read and return
`ResolvedSession.invalidated`. Local logout, the captured resolved deadline,
or strategy close aborts that signal. The supplied operation ending releases
the listener and expiry timer. Opaque rotation does not extend an existing
operation's captured deadline; signed token verification skew and durable
revocation retention do not extend it either. The Gateway links invalidation
to its backend cancellation and suppresses late updates. Logout errors remain
visible even when local forwarding has stopped. Another process receives no
local abort signal and must validate against shared durable state separately.
`OpaqueSessionCookies` binds its CSRF value to the complete sealed credential,
parses Cookie fields with cookie 2.0.1 after duplicate checks, and emits separate
secure `__Host-` session and CSRF `Set-Cookie` fields. Pass the actual issued
deadline to `issue`; `persistent: true` gives both cookies that deadline while
the default keeps them as browser-session cookies. `sameSite` accepts `lax`,
`strict`, or `none`; the session cookie remains `HttpOnly` and the CSRF cookie
remains readable by the browser.

```ts
import { OpaqueSessionCookies, type OpaqueSessions } from "@spine-event-engine/auth";

declare const sessions: OpaqueSessions;
const cookies = new OpaqueSessionCookies({
  csrfSecret: crypto.getRandomValues(new Uint8Array(32)),
  origins: ["https://app.example"],
  sameSite: "strict",
  persistent: true,
});
const issued = await sessions.issue({ id: "example-user" });
if (issued.kind === "created") {
  const setCookieFields = cookies.issue(issued.credential.value, issued.session.expiresAt);
  // Append each field separately to the HTTP response.
  void setCookieFields;
}
```

After rotation, call `issue` again with the new sealed value and its deadline;
`clear()` emits matching host-only removal fields. `read` distinguishes missing
credentials from terminal rejection so browser hosting does not fall back to a
different reader after invalid input.
Neither strategy provisions users nor grants permissions.

`OidcFlow` is a bounded authorization-code and PKCE transaction manager. It works with `createGoogleProvider`, `createGitHubProvider`, or a discovered or configured OIDC provider. Applications expose start/callback/exchange endpoints, perform HTTP routing, map verified external identity through `IdentityMapping`, and issue an application session through `ApplicationSessionIssuer`. Provider access, refresh, and ID tokens remain sensitive server-side material; do not return them to browser application code.

`OidcFlow.start()` awaits transaction persistence before returning an
authorization URL. Callback binding and expiry are validated before the
transaction is atomically consumed; provider exchange and identity mapping
follow consumption. Browser PKCE proof and grant expiry are validated before
the grant is consumed; application session issuance follows consumption. A
trusted clock check after each confirmed consumption stops the next external
step if the record reached expiry while storage was pending. A
failed external step does not restore a consumed record. Independent flow
instances select the same one-use records through their configured store.
The optional second `AbortSignal` on start, callback, and exchange carries host
request cancellation. Ordinary abort rejects with that reason; a distinct
session issuer failure rejects the pending exchange or, after an abort or
timeout has returned, is reported by `close()`. Close waits for admitted work
and the original provider, mapping, and issuer promises to settle. A consumed
transaction or grant is never restored after cancellation.

The default `OidcFlow` store is process-local. `PersistentOidcFlowStore.create()`
selects two record families from the supplied `StorageFactory` and `StorageGroup`;
`flowId` qualifies state, grants, and indexed expiry queries. Preparation of
both families completes by default. `createMissingStructures: false` returns
non-preparing handles that do not probe for structures later. `OidcFlow.close()`
drains admitted work and closes only its default memory store. Close an injected
store and its factory separately. `purgeExpired(cutoff)` is explicit and uses a
flow-scoped exact expiry index in persistent storage. A concurrent row change
can leave eligible records for a later invocation. Cancellation or storage
failure rejects with partial progress possible. A known confirmed late insert
is conditionally removed after close; if another writer has replaced that
record, the replacement remains. An ambiguous thrown storage result cannot be
rolled back safely and may need later explicit maintenance.

`discoverOidcProvider()` uses the exact selected discovery URL, including an
application supplied path and query, and rejects a returned issuer mismatch.
The selected URL does not replace token or JWKS destinations. Authorization
URLs use S256 and replace reserved protocol parameters while retaining other
provider query values. Token exchange uses the configured client authentication
and exact callback URI; the provider returns an identity only after bounded
response parsing and JOSE ID-token verification.

## Subscription and native adapters

`SubscriptionGateway` and `InMemorySubscriptionBindings` compose subscription creation, activation, cancellation, and relaying at the gateway boundary. The Gateway accepts a logical `SubscriptionCoordinator`; native `SubscriptionCreator` instances remain a per-node implementation seam. This is an intentional replacement of the former public native-creator input, with no compatibility adapter because Spine TS has no deployed users. In-memory bindings are local to one process and have finite operation limits; they do not provide cross-machine propagation. `createNativeGatewayServices`, `NativeSubscriptionCreator`, and `SubscriptionUpdateRelay` adapt these public contracts to the native service layer. They do not make a deployment secure by themselves: applications choose how their listener accepts only gateway-routed traffic.

`BackendSubscriptionEnvelope` is opaque to the Gateway. A custom `SubscriptionCreator` or `DynamicUnaryClient` must validate each forwarded update's subscription ID and Topic against the actual Subscription accepted by its backend. The built-in native creator performs this validation; a custom envelope does not imply the backend reused the requested child ID.

`DurableSubscriptionBindings` from `@spine-event-engine/server/browser` retains one approved
`GatewayAuthenticatedSubscription` per public Subscription. The record includes
the stable principal ID, while its Topic retains the trusted Actor and Tenant.
Activate and Cancel check all three against the newly admitted request before
affecting a stream or record. The same principal may reconnect with changed
attributes or authority facts; those facts are not persisted as its identity.
Explicit anonymous admission is distinct from a missing legacy binding. A
missing binding cannot be claimed by the next caller. This remains single-Gateway
persistence, not cross-process quota, reservation, lease, or fingerprint coordination.

Public subscription creation has two stages. `Subscribe` stores a process-local
definition and returns its ID; `Activate` must arrive within the shared
30-second incomplete Subscribe-to-Activate handshake. If activation never
arrives, that public definition is cancelled. Once activated, a healthy public
stream has no framework time-to-live. It ends only when the caller cancels or
disconnects, the backend ends the stream, or the Gateway shuts down.

Authenticated durable definitions instead use the real session-derived expiry
stored with the definition. Expiry maintenance first stops an active binding,
waits for its serialized work, cancels the backend subscription once, and then
deletes the stored record. Concurrent maintenance callers join the same purge
operation. Public mode has no session expiry and does not use that durable
authenticated record; its process-local definitions disappear when the Gateway
process ends. Neither mode stores a replayable history of emitted updates, so a
reconnecting browser queries authoritative state before subscribing again.

## Errors, lifecycle, and extension

Public callbacks may reject; applications decide how their native listener maps those failures. Values handed to request collaborators are defensive gateway facts, while applications remain responsible for mutable state and cleanup. Always give gateway operations a finite request limit and make credential, provider, session, and forwarding adapters cancellation-aware.

Read the [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md) for composition examples and deployment guidance.

# Dynamic unary discovery

`DynamicUnaryForwarder` accepts complete current application-node snapshots. It serializes reconciliation, retains only the latest pending snapshot during churn, starts clients in bounded batches, disposes departed clients, and round-robins commands and queries across the resulting set. A dispatched unary request is never retried. Empty membership reports backend unavailability until a later snapshot restores clients.

Dynamic subscriptions use the same reconciliation process. Durable bindings retain
the logical subscription definition, trusted Actor/Tenant facts, and stable reader
identity; native streams and changing authority facts are per-process data.
Nodes may be added, removed, or re-added without
changing a durable definition. Notifications are best effort, may duplicate,
and browser clients reconnect and re-query authoritative state after loss.

Closing the forwarder aborts in-flight client creation, waits for that work to settle, and cleans up current clients. Failed cleanup remains retryable on a later close.
