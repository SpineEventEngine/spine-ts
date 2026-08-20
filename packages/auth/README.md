# Authentication for Spine applications

Use this package to build an application gateway that authenticates a request,
authorizes it, resolves a trusted actor context, and forwards approved Spine
traffic. Spine bounded contexts do not perform these routines themselves.

For gateway, session, OIDC, subscription, and native-transport details, read
the [reference](REFERENCE.md).

## 💡 Why use it?

- ✅ Keeps credentials outside bounded contexts.
- ✅ Turns a verified session into a trusted actor and optional tenant.
- ✅ Supports bearer sessions, CSRF-protected opaque cookies, and application
  adapters for Google, GitHub, or another OpenID Connect provider.
- ✅ Applies the same authorization boundary to commands, queries, and
  subscriptions.

The [browser client and gateway guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
explains how an application composes these extension points.

## 🚀 Build a unary gateway

Supply application session, authorization, context, and forwarding
collaborators. The gateway replaces a matching caller context with a freshly
resolved trusted `ActorContext`; it never forwards the credential.

```ts
import { type SessionResolver, UnaryGateway } from "@spine-event-engine/auth";

const gateway = new UnaryGateway({
  maxRequestBytes: 1_048_576,
  sessions: applicationSessions,
  authorize: applicationPolicy.authorize,
  contexts: applicationContexts,
  clock: applicationClock,
  forward: applicationBackend.forward,
});

declare const applicationSessions: SessionResolver;
declare const applicationPolicy: {
  authorize: ConstructorParameters<typeof UnaryGateway>[0]["authorize"];
};
declare const applicationContexts: ConstructorParameters<typeof UnaryGateway>[0]["contexts"];
declare const applicationClock: ConstructorParameters<typeof UnaryGateway>[0]["clock"];
declare const applicationBackend: {
  forward: ConstructorParameters<typeof UnaryGateway>[0]["forward"];
};
void gateway;
```

For an intentionally public endpoint, replace `sessions` with
`publicAccess: true`. The two admission modes are mutually exclusive. Public
mode has no login session or synthetic expiry; the application still authorizes
every operation and rebuilds trusted context.

The package gives applications extension points, not a deployment mandate or an
identity-provider configuration. Applications choose their listener, routes,
session persistence, identity provider, authorization rules, and backend.

## 🧪 Use a local session store in development

`OpaqueSessions` is a process-local store. It is useful for a local gateway or
a single process, not for a shared production deployment.

```ts
import { OpaqueSessions } from "@spine-event-engine/auth";

const sessions = new OpaqueSessions({
  ttlMilliseconds: 60 * 60 * 1_000,
  maxSessions: 1_000,
});

await sessions.close();
```

For browser clients, use an application sign-in route and exchange its result
for an application cookie or bearer session. Do not put provider access tokens
in client-side storage.

## 🔐 Configure an external sign-in provider

An application can create a Google or GitHub provider adapter, then give its
verified identity result to an `OidcFlow` and application session issuer. The
[OIDC composition section](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md#external-provider-sign-in)
shows the complete start, callback, and one-time session-exchange flow. These
helpers configure bounded provider calls; they do not create browser routes,
users, permissions, or a session issuer.

```ts
import { createGitHubProvider, createGoogleProvider } from "@spine-event-engine/auth";

const google = await createGoogleProvider({ clientId: "google-client-id" });
const github = createGitHubProvider({
  clientId: "github-client-id",
  clientSecret: "server-only-secret",
});
if (google === undefined) throw new Error("Google provider discovery failed");
void github;
```

## ⚠️ What the package does not do

It does not create sign-in pages, application users, permissions, HTTP routes,
TLS, or a production session database. Applications select those pieces and
deploy the gateway at the appropriate trust boundary.

## 🔗 Learn more

- [Browser authentication and extension guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Server package](../server/README.md)
- [Detailed coding-agent reference](REFERENCE.md)
