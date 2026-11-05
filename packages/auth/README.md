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

For a browser gateway, supply the issuer through
`BrowserServerOptions.forwardingProof`. When assembling a native gateway,
configure `NativeSubscriptionCreator(transport, { issuer, maxBytes })`; a custom
unary forwarder must produce the same operation-bound proof. See
[Verified reader forwarding](REFERENCE.md#verified-reader-forwarding) for the forwarding adapters.

In either setup, configure `ServerOptions.services.readerAdmission.forwarded`
on the receiving application node. The issuer produces a proof for the service,
method, request bytes, and reader facts. The verifier checks that proof and the
forwarding peer. Both are replaceable application adapters. A header name, actor
ID, or loopback connection does not establish a verified reader.

Authenticated forwarding requires an issuer. Deliberate `publicAccess: true`
forwards no principal or authority facts; the gateway's public admission marker
does not become a user identity. See the [server reference](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/server/REFERENCE.md#native-reader-admission)
for direct native authentication and managed forwarding configuration.

## Browser and OIDC extensions

`OidcFlow` is a component flow: the application provides its start, callback,
exchange, identity mapping, and session issuance routes. The optional
`BetterAuthIntegration` below exposes exact native authentication routes.
Neither component supplies browser pages, users, permissions, TLS, or a
production session database. An application can compose `OidcFlow` with
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

For browser-facing hosting, install the server browser entry point and use
`BrowserServer` and `DurableSubscriptionBindings` from
`@spine-event-engine/server/browser`. That boundary requires exact origins,
finite request limits, authorization and trusted-context collaborators, and
durable authenticated bindings when applicable.

## Selected Better Auth persistence

Install the exact optional `better-auth` peer when using
`@spine-event-engine/auth/better-auth`. The selected store persists native
Session and Verification records, and optionally provisioned User and Account
records, through Spine storage. Its factory prepares only selected structures
by default; an explicit `createMissingStructures: false` skips physical checks
and DDL at creation and later operations. For durable persistence, the application
supplies an existing database and a provider-valid storage group. This example
uses process-local memory; use a durable storage provider to preserve records
across restarts. The following configuration-only example initializes and
closes the integration; it does not start a browser listener.

```ts
import {
  BetterAuthIntegration,
  PersistentBetterAuthStore,
} from "@spine-event-engine/auth/better-auth";
import { Time } from "@spine-event-engine/core/time";
import { InMemoryStorageFactory, StorageGroup } from "@spine-event-engine/storage";

const factory = new InMemoryStorageFactory();
const store = await PersistentBetterAuthStore.create({
  storageFactory: factory,
  group: new StorageGroup("orders_better_auth"),
  models: ["user", "account", "session", "verification"],
});
try {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (secret === undefined) throw new Error("BETTER_AUTH_SECRET is required.");
  const auth = await BetterAuthIntegration.create({
    store,
    routePolicy: { maxRequestBytes: 8_192, timeoutMs: 5_000 },
    options: {
      baseURL: "https://app.example.test",
      basePath: "/auth",
      secret,
      trustedOrigins: ["https://app.example.test"],
      emailAndPassword: { enabled: true, disableSignUp: true },
      account: { accountLinking: { enabled: false } },
      session: { cookieCache: { enabled: false } },
    },
    onPrincipal: async (user) => ({ id: user.id }),
  });
  try {
    await store.purgeExpired(Time.currentTime());
  } finally {
    await auth.close();
  }
} finally {
  await store.close();
  await factory.close();
}
```

Provision complete Users and prelinked Accounts before accepting password
traffic. The integration exposes exact browser routes, verified session reads,
and credential metadata. For a listener, pass `auth.routes` as
`BrowserServerOptions.authRoutes`, `auth.sessions` as `sessions`, and
`auth.credentials` as `credentials`, alongside the host's origin, clock,
authorization, and context collaborators. The host applies the selected route
bounds. See [browser hosting](../server/REFERENCE.md#browser-hosting) for the
maintained host contract and required options.
See the [auth reference](REFERENCE.md#selected-better-auth-records) for the
provisioning and query profile.

## Limits and next steps

Memory-selected `OpaqueSessions` is process-local; select durable shared storage
for sessions that must survive process restart. Signed-session revocation and
OIDC identity provisioning are application responsibilities. A gateway protects
only traffic that operators route through it; do not expose a backend route
around that boundary.

- [Detailed coding-agent reference](REFERENCE.md)
- [Browser authentication and extension guide](https://github.com/SpineEventEngine/spine-ts/blob/master/docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Native server package](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/server/README.md)
