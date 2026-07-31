# Chat example reference

This reference is for coding agents and maintainers. Beginners should start
with the [Chat README](README.md).

## Package ownership

- `model` owns authored Chat Proto sources, the single `UserId` definition,
  generated Protobuf-ES code, typed rejections, and its `ProtoModule`.
- `app` owns the bounded context, Aggregate, Projection, generated application
  registry and handler registry, local session policy, and executable server.
- `web` owns the React view, browser session selection, request scope, query,
  subscription, and visible retry behavior.

Nothing in the family is published. Generated Proto, handler output, and
`dist/` are ignored outputs and must not be edited.

## Runtime topology

`Server` starts a private native HTTP/2 backend on ephemeral loopback, then an
authenticated public Connect/gRPC-Web listener on `127.0.0.1:8090`. The
framework owns routing, exact-origin CORS, credential extraction, subscription
bindings, readiness, rollback, signals, and shutdown. The application supplies
`ChatAuthorizationPolicy`, `ChatContextResolver`, its model registry, and the
local development session resolver. The browser never receives the private
backend URL.

The local browser origin is exactly `http://127.0.0.1:5173`. Its bearer is a
non-secret fixture. Production hosts must provide their own sign-in, durable
session resolution, authorization data, TLS, and network policy.

## Domain and client behavior

Each `MessageId` identifies one `ChatMessageAggregate`. `PostMessage` is
validated from its Proto options before the handler runs. A successful handler
stores the Aggregate and emits `MessagePosted`; `ChatMessageViewProjection`
creates one full-visible `ChatMessageView` with indexed room, author, and
posting time.

Duplicate or concurrent reuse of an ID keeps the first Aggregate and Projection
and publishes one `MessageAlreadyPosted` rejection for the later command. The
transport acknowledgement still represents admission, not the later domain
outcome.

The browser uses a room-filtered Projection Query and Projection subscription.
Updates are best-effort hints. A gap or reconnect triggers an authoritative
re-query; intermediate history cannot be recovered.

## Verification and interoperability

```bash
pnpm proto:generate
pnpm exec tsc -b \
  examples/chat/model/tsconfig.json \
  examples/chat/app/tsconfig.json \
  examples/chat/web/tsconfig.json
pnpm --config.verify-deps-before-run=false exec vitest run \
  examples/chat/app/test \
  examples/chat/web/test/chat-web.test.tsx
pnpm --config.verify-deps-before-run=false --dir examples/chat/web test:browser
```

The separate Envoy interoperability topology uses local TLS and needs Docker,
Envoy, and Playwright browsers:

```bash
pnpm exec node examples/chat/web/test/interop/browser/run.mjs
```

It is the only Chat command that exercises the HTTPS browser-to-Envoy path.
