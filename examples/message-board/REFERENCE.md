# Message Board example reference

This reference records Message Board's exact runnable contract. Beginners
should start with the [Message Board README](README.md).

## Package responsibilities

- `model` contains authored Protobuf messages and typed App Query companions.
- `command-handlers` contains `BoardMessageAggregate`; `view-handlers` contains the Message Board and announcement Projections.
- `composed-app` assembles both Bounded Contexts and typed read policies.
- `app` starts that same assembly in local, combined, and managed deployment modes and configures admission.
- `web` renders the real browser readers and posting flow.

Generated Proto, handler output, and `dist/` are ignored outputs and must not be edited.

## Runtime topology

`Server` starts a private native HTTP/2 backend on ephemeral loopback, then a
public Connect/gRPC-Web listener on `127.0.0.1:8090`. The framework manages
routing, exact-origin CORS, subscription bindings, readiness, rollback, signals,
and shutdown. The application supplies `BoardAccessPolicy`,
`BoardContextResolver`, its model registry, and framework `publicAccess`. The
browser never receives the private backend URL.

The local browser origin is exactly `https://127.0.0.1:5173`. Public mode uses no browser credential. Signed mode verifies an operator-issued session before exposing restricted readers; TLS and native endpoint isolation remain deployment responsibilities.

## Domain and client behavior

Each `MessageId` identifies one `BoardMessageAggregate`. `PostMessage` is
validated from its Proto options before the handler runs. A successful handler
stores the Aggregate and emits `MessagePosted`; `BoardViewProjection` creates `BoardMessageView`, while cumulative Projections build lifetime board and announcement statistics from accepted Events.

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
all other lifecycle states are `No live updates`. The status describes the board-view subscription, independently of each post.
The form activates separate outcome subscriptions before sending a Command;
failed activation prevents posting. The message textarea posts on Command+Enter or
Control+Enter, preserves plain Enter for multiline text, and ignores shortcuts
while IME composition is active.

`PostForm` uses `postAndSubscribe` with `MessagePosted` and
`MessageAlreadyPosted`. Its posting acknowledgement is separate from those
outcomes. A first-update timeout displays a waiting notice without resending or
closing observation; late confirmation remains valid. The application cancels
this per-post subscription after handling the outcome or retiring the form.
The board-view Entity subscription keeps delivering updates and has no first-update warning for an idle board. The statistics Entity Topic stays active alongside the board, announcement, and Event Topics over the HTTPS/HTTP2 edge and triggers authoritative `ReadBoardStats` refreshes. The broad Event notification Topic stays continuous.

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
