# Chat example family

This is the repository's end-to-end Chat example. Start here when you want a
small Spine application with commands, Projection reads, browser delivery, and
an authentication gateway. It is one three-package workspace family, not three
published npm packages:

- `model/` owns `UserId`, Chat Proto messages, commands, events, and rejections.
- `app/` owns the in-memory server, Aggregate, Projection, and application
  registry/handler composition.
- `web/` owns the React fixture built on `client-react` and `client-web`.

The app directly depends on the single `model` package, which provides every
Chat type including `UserId`. `app/src/model-registry.ts` is tracked composed
source. Generated Proto, handler output, and `dist` are ignored build products:
generate them; never edit them. Nothing in this family is published to npm.

## Run it from a fresh checkout

All commands below run from the repository root. Install the locked dependency
graph, then generate the ignored outputs:

```sh
pnpm install --frozen-lockfile
pnpm proto:generate
```

Build exactly the three Chat projects after generation:

```sh
pnpm exec tsc -b \
  examples/chat/model/tsconfig.json \
  examples/chat/app/tsconfig.json \
  examples/chat/web/tsconfig.json
```

Run the focused server and jsdom browser tests:

```sh
pnpm --config.verify-deps-before-run=false exec vitest run \
  examples/chat/app/test \
  examples/chat/web/test/chat-web.test.tsx
```

Run the local browser fixture in Chromium, Firefox, and WebKit:

```sh
pnpm --config.verify-deps-before-run=false --dir examples/chat/web test:browser
```

On a fresh machine, install those browser binaries first:

```sh
pnpm exec playwright install chromium firefox webkit
```

The full browser interoperability topology starts a Chat backend, a native
authentication gateway, and Envoy with local TLS. It needs Docker/Envoy and
the Playwright browsers:

```sh
pnpm exec node examples/chat/web/test/interop/browser/run.mjs
```

The jsdom test exercises the deterministic in-memory request only. The local
Playwright fixture exercises the browser UI. The full command is the only one
that exercises the HTTPS browser-to-Envoy-to-gateway-to-backend route.

## Application and session boundary

`app/` is a library, not a server CLI. A caller creates and closes its runtime:

```ts
const application = new ChatApplication();
const server = await application.start({ host: "127.0.0.1", port: 0 });
try {
  // Use server.baseUrl.
} finally {
  await server.close();
}
```

The app defaults to loopback and an ephemeral port, uses in-memory storage, and
allows at most 1,000 active subscriptions. A host application establishes the
browser session and creates a fresh `ClientRequest` after sign-in. The browser
session object is informational, never a credential; cookie/bearer transport
setup belongs to `client-web`.

The gateway is the trust boundary. It authenticates the request, supplies the
trusted actor, optional tenant, and clock, authorizes the requested room, and
owns subscription activation/cancellation. The browser never reaches the Chat
backend directly. gRPC-Web is the default browser protocol; use binary Connect
only for a separately configured Connect-capable endpoint—clients do not probe
or fall back between them.

## What the browser does

The browser sends `PostMessage` commands, then reads room-filtered
`ChatMessageView` Projection entities with an authoritative Query and
subscribes to the same Projection topic. It does not consume an event stream
or keep an unbounded aggregate message list.

Each browser-generated `MessageId` identifies one message Aggregate. A repeat,
including a concurrent repeat, keeps the first Aggregate and Projection state
and produces no second Projection update. The admitted transport call still
acknowledges `{ kind: "ok" }`; the domain outcome is exactly one stored
`MessageAlreadyPosted` rejection event beside the first normal event.

Subscription deliveries are best-effort notices, not complete history. They
may be duplicated, omitted, or reordered. On reconnect or a possible gap, the
client re-queries the authoritative Projection state; it makes no completeness
promise and cannot recover intermediate history.

For app-specific details, see [app/README.md](app/README.md). For browser
integration, session setup, and Envoy extension requirements, see
[web/README.md](web/README.md) and the
[browser client, authentication, and gateway extension guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md).
