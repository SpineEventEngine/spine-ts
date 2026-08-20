# Message Board example reference

This reference records Message Board's exact runnable contract. Beginners
should start with the [Message Board README](README.md).

## Package responsibilities

- `model` contains authored Message Board Proto sources, the single `UserId` definition,
  generated Protobuf-ES code, typed rejections, and its `ProtoModule`.
- `app` contains the bounded context, Aggregate, Projection, generated application
  registry and handler registry, public-demo admission, and executable server.
- `web` contains the React view, request scope, query,
  subscription, and visible retry behavior.

Nothing in the family is published. Generated Proto, handler output, and
`dist/` are ignored outputs and must not be edited.

## Runtime topology

`Server` starts a private native HTTP/2 backend on ephemeral loopback, then a
public Connect/gRPC-Web listener on `127.0.0.1:8090`. The framework manages
routing, exact-origin CORS, subscription bindings, readiness, rollback, signals,
and shutdown. The application supplies `BoardAccessPolicy`,
`BoardContextResolver`, its model registry, and framework `publicAccess`. The
browser never receives the private backend URL.

The local browser origin is exactly `http://127.0.0.1:5173`. The example
creates no browser credential; production hosts choose their own admission,
TLS, and network policy.

## Domain and client behavior

Each `MessageId` identifies one `BoardMessageAggregate`. `PostMessage` is
validated from its Proto options before the handler runs. A successful handler
stores the Aggregate and emits `MessagePosted`; `BoardViewProjection`
creates one full-visible `BoardMessageView` with indexed board, author, and
posting time.

Duplicate or concurrent reuse of an ID keeps the first Aggregate and Projection
and publishes one `MessageAlreadyPosted` rejection for the later command. The
transport acknowledgement still represents admission, not the later domain
outcome.

The browser uses a board-filtered Projection Query and Projection subscription.
Gateway remembers what the browser subscribed to, while individual live
notifications are not stored for later playback. Like a doorbell, a change
heard while disconnected is missed: reconnect first queries current board
state, then resumes live updates.

The web UI exposes one lifecycle badge: exact `connected` is `Updating live`;
all other lifecycle states are `No live updates`. The status does not govern
command availability because a post and post-success Query refresh do not rely
on a live subscription. The message textarea posts on Command+Enter or
Control+Enter, preserves plain Enter for multiline text, and ignores shortcuts
while IME composition is active.

## Verification and interoperability

```bash
pnpm proto:generate
pnpm exec tsc -b \
  examples/message-board/model/tsconfig.json \
  examples/message-board/app/tsconfig.json \
  examples/message-board/web/tsconfig.json
pnpm --config.verify-deps-before-run=false exec vitest run \
  examples/message-board/app/test \
  examples/message-board/web/test/message-board.test.tsx
pnpm --config.verify-deps-before-run=false --dir examples/message-board/web test:browser
```

The separate Envoy interoperability topology uses local TLS and needs Docker,
Envoy, and Playwright browsers:

```bash
pnpm exec node examples/message-board/web/test/interop/browser/run.mjs
```

It is the only Message Board command that exercises the HTTPS browser-to-Envoy path.
