# Authentication gateway contracts

`@spine-event-engine/auth` supplies provider-neutral building blocks for an
application gateway. It authenticates a request, authorizes it, resolves a
trusted actor context, and forwards approved Spine traffic. Bounded contexts do
not perform those routines themselves.

> **Experimental prerelease.** Use the exact snapshot below; prerelease import
> paths and contracts can change.

## Install and prerequisites

```bash
pnpm add @spine-event-engine/auth@2.0.0-snapshot.3
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
- [Browser authentication and extension guide](https://github.com/SpineEventEngine/spine-ts/blob/main/docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Native server package](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/server/README.md)
