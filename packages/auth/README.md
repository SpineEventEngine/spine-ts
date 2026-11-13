# Authentication gateway contracts

See [storage layout and database preparation](https://github.com/SpineEventEngine/spine-ts/blob/master/docs/STORAGE_LAYOUT.md) for
physical structures, tenant placement, prerequisites, and customization.

`@spine-event-engine/auth` supplies provider-neutral building blocks for an
application gateway. It authenticates a request, authorizes it, resolves a
trusted actor context, and forwards approved Spine traffic. Bounded contexts do
not perform those routines themselves.

> **Experimental prerelease.** Use the exact snapshot below; prerelease import
> paths and contracts can change.

## Install and prerequisites

```bash
pnpm add @spine-event-engine/auth@snapshot
```

Use it in a Node.js application that owns its listener, credential extraction,
authorization rules, actor/tenant resolution, and backend forwarding. Browser
hosting additionally uses `@spine-event-engine/server/browser`; the server root
is native-only and treats auth as an optional peer.

## First success: create and resolve a local session

Omitting a store selects process-local memory for development. Configure a seal
secret and explicit session policy before issuing credentials. A
`PersistentOpaqueSessionStore` can instead share the same atomic sessions across
processes; its asynchronous factory prepares selected structures by default.

```ts
import { OpaqueSessions } from "@spine-event-engine/auth";
import { Time } from "@spine-event-engine/core/time";

const password = process.env.SESSION_SEAL_PASSWORD;
if (!password) throw new Error("Configure SESSION_SEAL_PASSWORD");
const sessions = await OpaqueSessions.create({
  scope: "local-browser",
  password,
  clock: { now: Time.currentTimeMillis },
  ttlMilliseconds: 60 * 60 * 1_000,
});
try {
  const created = await sessions.issue({ id: "local-user" });
  if (created.kind !== "created") throw new Error(`Session creation failed: ${created.reason}`);
  const resolved = await sessions.resolve(created.credential);
  if (resolved === undefined) throw new Error("New local session was not resolvable");
  console.log(resolved.principal.id);
} finally {
  await sessions.close();
}
```

## Share opaque sessions through PostgreSQL

Install `@spine-event-engine/storage-postgres` alongside the auth package. Give
the session family a dedicated storage group. The database and schema must
already exist.

```ts
import { OpaqueSessions, PersistentOpaqueSessionStore } from "@spine-event-engine/auth";
import { Time } from "@spine-event-engine/core/time";
import { StorageGroup } from "@spine-event-engine/storage";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";

const url = process.env.DATABASE_URL;
const password = process.env.SESSION_SEAL_PASSWORD;
if (!url || !password) throw new Error("Configure database and session credentials");
const factory = await PostgresStorageFactory.newBuilder().setOptions({ url }).build();
let store: PersistentOpaqueSessionStore | undefined;
try {
  store = await PersistentOpaqueSessionStore.create({
    storageFactory: factory,
    group: new StorageGroup("auth_sessions"),
  });
  const sessions = await OpaqueSessions.create({
    store,
    scope: "orders-browser",
    password,
    clock: { now: Time.currentTimeMillis },
    ttlMilliseconds: 60 * 60 * 1_000,
  });
  try {
    const issued = await sessions.issue({ id: "user-42" });
    if (issued.kind !== "created") throw new Error(`Session issue failed: ${issued.reason}`);
    // Send issued.credential through the application's credential transport.
  } finally {
    await sessions.close();
  }
} finally {
  try {
    await store?.close();
  } finally {
    await factory.close();
  }
}
```

The strategy leaves an injected store open; close the strategy, store, and
factory in that order. Use the same group and seal policy in each process.

## Signed bearer sessions

`SignedSessions` issues and verifies ES256 bearer tokens with an application
P-256 key pair. Without a revocation source, logout reports expiry-only.
`PersistentTokenRevocations.create` supplies shared scoped revocation through
the selected storage factory and group; pass the resulting store as the
strategy's `revocation`. The store prepares its indexed record family by
default. Its explicit `purgeExpired` method removes records only after their
full inclusive acceptance deadline, including configured clock skew. The
application closes the strategy, store, and factory separately. See the
[signed session reference](REFERENCE.md) for exact retention and maintenance
behavior.

For a real gateway, construct `UnaryGateway` with exactly one admission mode:
`sessions`, or deliberate `publicAccess: true`. It requires a finite request
limit, policy, trusted-context resolver, clock, and forwarder. Every approved
operation is independently admitted and authorized; forwarded data excludes
credentials and untrusted transport headers.

The gateway verifies each Command's actor and tenant against its resolved
identity. It preserves that Command's original creation time and locale so
Events can refer to the exact Command that caused them. Those metadata fields
are supplied by the caller; they are not proof of identity. Queries and
subscription Topics receive the context supplied by the gateway resolver.

## Pass verified reader information to the application node

The gateway also forwards the admitted principal and the `authorityFacts`
returned by `ContextResolver.resolve()`. These facts may contain JSON values,
including role arrays, booleans, and nested objects. They are detached from the
session and resolver result before forwarding. The framework does not copy the
request credential into them or fetch fresh information from an identity provider.
Your resolver decides which facts to supply on each request.

For a browser Gateway connected to an application listener that only trusted
components can reach, set `forwarding: "trusted-network"` on the Gateway and
`services.readerAdmission: "trusted-network"` on the receiving Server. The
Gateway sends the admitted principal and authority facts in internal metadata
without a proof. The receiving listener checks the metadata shape and operation,
then accepts those facts. Network access to that listener is the trust boundary:
a caller that can reach it can assert another principal. ActorContext remains
separate from the admitted reader.

For proof-based forwarding, set `BrowserServerOptions.forwardingProof` and the
receiving Server's `services.readerAdmission.forwarded`. The issuer signs the
service, method, exact request bytes, and reader facts; the verifier checks the
proof and forwarding peer. Use `NativeSubscriptionCreator(transport, {
issuer, maxBytes })` for a manually assembled Gateway, or `{ forwarding:
"trusted-network", maxBytes }` for a restricted listener. The two sending
settings cannot be combined. See [Verified reader forwarding](REFERENCE.md#verified-reader-forwarding).

The default remains identity-free native admission. A receiving Server without
reader admission rejects internal reader metadata. A signed-only listener rejects
unsigned metadata; a trusted-network listener rejects proof-bearing metadata.
The trusted-network listener also admits a native request without either
internal header with an empty reader. Read filters and application policy still
decide what that identity-free request may read. Public Gateway admission does
not invent a principal or authority facts. Subscription Subscribe, Activate,
Cancel, and cleanup retain the admitted reader identity.

## Browser and OIDC extensions

`OidcFlow` is a component flow: the application provides its start, callback,
exchange, identity mapping, and session issuance routes. It does not supply
browser pages, users, permissions, TLS, or a production session database. An application can compose `OidcFlow` with
Google, GitHub, or another verified provider.
Keep provider access, refresh, and ID tokens server-side.

`OidcFlow.start()` is asynchronous: await it before redirecting the browser.
The default transaction and application-grant store is process-local. To share
one login flow across processes, create `PersistentOidcFlowStore` with a
`StorageFactory`, `StorageGroup`, and stable `flowId`, then pass it in
`OidcFlowOptions.store`. The factory prepares both record families by default;
`createMissingStructures: false` skips preparation. Close the flow, then its
injected store and factory when the application shuts down. Call
`purgeExpired(cutoff)` explicitly for expired records; no timer runs it.

The application must send the authorization URL returned by `OidcFlow.start()`
to the browser and supply the actual callback parameters.

For browser-facing hosting, install the server browser entry point and use
`BrowserServer` and `DurableSubscriptionBindings` from
`@spine-event-engine/server/browser`. That boundary requires exact origins,
finite request limits, authorization and trusted-context collaborators, and
durable authenticated bindings when applicable.

## Limits and next steps

The [Fieldnotes application](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/fieldnotes/README.md)
connects a Next.js map interface to a single-tenant Bounded Context. Its two launch
options demonstrate direct Google OIDC and Google sign-in through Firebase Auth.
Both use persistent opaque application sessions stored through the PostgreSQL
storage factory. The application guide follows sign-in through authenticated
Commands, private queries and subscriptions, and logout.

Memory-selected `OpaqueSessions` is process-local; select durable shared storage
for sessions that must survive process restart. Signed-session revocation and
OIDC identity provisioning are application responsibilities. A gateway protects
only traffic that operators route through it; do not expose a backend route
around that boundary.

- [Detailed coding-agent reference](REFERENCE.md)
- [Browser authentication and extension guide](https://github.com/SpineEventEngine/spine-ts/blob/master/docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Native server package](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/server/README.md)
