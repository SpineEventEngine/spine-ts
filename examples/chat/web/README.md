# Browser Chat web UI

Prerequisites: Node 24 LTS or newer and pnpm. Set
`VITE_CHAT_GATEWAY_URL` only to an `http://127.0.0.1` URL with port 1–65535;
it defaults to `http://127.0.0.1:8090`.

From the repository root after `pnpm install --frozen-lockfile`, start the
separate local server with `pnpm --dir examples/chat/app start`, then run:

```sh
pnpm --dir examples/chat/web start
```

The command owns generation/build work, starts Vite on
`http://127.0.0.1:5173`, and renders the real `ChatBrowserApp` against the
loopback Connect gateway at `http://127.0.0.1:8090`. Stop Vite with `Ctrl-C`.
The visible UI has no deterministic transport fallback; its local bearer
is memory-only, non-secret, unlogged, and for the loopback example
only. The deterministic fixture remains test-only.

The local demonstration uses binary Connect directly over loopback HTTP.
The retained Envoy interoperability harness is the separate HTTPS/gRPC-Web
reference; it is not required for this two-process local example.

`@spine-event-engine/example-chat-web` is a deliberately small React browser
application. It composes the public `@spine-event-engine/client-react` hooks and
the application-owned `ClientRequest`; it does not replace the hooks, cache
entities, or model chat messages as events.

The application has two seams. `ChatBrowserApp` receives the hosting application's
session and `ClientRequest`; production hosts can provide a gRPC-Web or Connect
browser request through `client-web`. `browser-fixture.tsx` supplies only a
deterministic in-memory request for local browser acceptance. It is not a
browser transport, authentication provider, or delivery guarantee.

The complete browser/authentication extension contract and its limitations are
in the [browser client and gateway guide](../../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md).

The hosting application owns sign-in and creates a fresh `ClientRequest` only
after it has established its browser session. The supplied session object is a
provider-neutral UI boundary: actor data is informational and is never a
credential. Cookie and bearer session transport setup stays in `client-web`.

For a room, the application posts `PostMessage`, queries `ChatMessageView`
Projection entities with a room filter, and subscribes to that Projection
topic. Subscription delivery is a best-effort hint. A `resynchronization`
delivery is already authoritative and becomes the visible room state without a
second query. Raw updates and `gapPossible` notifications coalesce into at
most one in-flight room refresh and one follow-up. Duplicate, omitted, and
reordered notifications remain possible; intermediate history is not
recovered.

Sign-in failures are visible and retryable; late sign-in completions after
unmount are ignored. Command failures, including resolved Spine `error` and
`rejection` outcomes, retain their generated message ID and exact text for a
single-flight retry. A later normal room refresh supersedes any recovered
state.

## Running the application

Start the separately documented Chat server, then run the web application:

```sh
pnpm --dir examples/chat/app start
pnpm --dir examples/chat/web start
```

Run these commands in separate terminals and open
[http://127.0.0.1:5173](http://127.0.0.1:5173). The page uses the local
development session and the real loopback gateway. A real host passes its own
session and request to `ChatBrowserApp`. The application's `Post`
acknowledgement clears the input. Transport errors and
resolved `error` or `rejection` outcomes retain the same generated command ID
and trimmed text for one retry; blank text never posts a command.

The focused component test is:

```sh
pnpm --config.verify-deps-before-run=false vitest run examples/chat/web/test/chat-web.test.tsx
```

Real-browser acceptance is run with `@playwright/test@1.62.0`:

```sh
pnpm --config.verify-deps-before-run=false --dir examples/chat/web test:browser
```

The configured browser test runs in Chromium, Firefox, and WebKit. A fresh
checkout needs `pnpm install --frozen-lockfile` and
`pnpm exec playwright install chromium firefox webkit` before repeating that
acceptance.

## Real-browser topology

The interoperability harness uses an HTTPS browser route through Envoy to a separate
application gateway, then to the Chat backend. The browser never reaches the
backend directly. The gateway owns authentication context resolution and its
listener lifecycle; Envoy only exposes `ResolveContext`, `Post`, `Read`,
`Subscribe`, `Activate`, and `Cancel` over the public route. Deployment users
can copy the [Envoy reference](../../../interop/envoy/README.md), provide their
TLS certificate/key paths and gateway address, then customize the template for
their own network policy.
