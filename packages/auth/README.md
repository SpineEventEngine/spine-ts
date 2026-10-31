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

`OpaqueSessions` is a bounded, process-local store for local development or a
single process. This creates a credential, resolves it, and closes the store.

```ts
import { OpaqueSessions } from "@spine-event-engine/auth";

const sessions = new OpaqueSessions({ ttlMilliseconds: 60 * 60 * 1_000, maxSessions: 100 });
try {
  const created = await sessions.create({ id: "local-user" });
  if (created.kind !== "created") throw new Error(`Session creation failed: ${created.reason}`);
  const resolved = await sessions.resolve(created.credential);
  if (resolved === undefined) throw new Error("New local session was not resolvable");
  console.log(resolved.principal.id);
} finally {
  await sessions.close();
}
```

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

The package does not provide HTTP routes, browser pages, users, permissions,
TLS, or a production session database. An application can compose
`OidcFlow` with Google, GitHub, or another verified provider, but it must own
the start, callback, exchange, identity mapping, and session issuance routes.
Keep provider access, refresh, and ID tokens server-side.

For browser-facing hosting, install the server browser entry point and use
`BrowserServer` and `DurableSubscriptionBindings` from
`@spine-event-engine/server/browser`. That boundary requires exact origins,
finite request limits, authorization and trusted-context collaborators, and
durable authenticated bindings when applicable.

## Limits and next steps

`OpaqueSessions` is not shared or durable. Signed-session revocation and OIDC
identity provisioning are application responsibilities. A gateway protects
only traffic that operators route through it; do not expose a backend route
around that boundary.

- [Detailed coding-agent reference](REFERENCE.md)
- [Browser authentication and extension guide](https://github.com/SpineEventEngine/spine-ts/blob/master/docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Native server package](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/server/README.md)
