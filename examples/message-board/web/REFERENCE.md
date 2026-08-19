# Message Board web reference

This reference records the Message Board web contract. Beginners should start
with the [Message Board web README](README.md).

## Composition

`MessageBoardApp` receives its actor display name and `ClientRequest`.
Production hosts may supply gRPC-Web or Connect through
`client-web`; the visible local entry uses the real Connect gateway. Blank
username and message values are submitted to the server so its Proto validation
messages can be shown, but the server does not accept them.

The gateway URL defaults to `http://127.0.0.1:8090` and accepts only an
`http://127.0.0.1` URL with a port from 1 through 65535. The Vite origin is
`http://127.0.0.1:5173`.

## UI and recovery behavior

The host creates one request for the public demo. Command transport failures and resolved `error` or
`rejection` outcomes preserve the generated message ID and raw field values for
one single-flight retry. Blank values are sent to the server for validation.

Board state starts with an authoritative Query. A normal complete update is
validated, identity-checked, board-checked, and applied locally in oldest-first
order. A `resynchronization` delivery already contains authoritative state.
Malformed updates, `gapPossible`, and disconnected post success coalesce into
at most one active refresh and one follow-up. A later normal refresh supersedes
recovered state. Intermediate history is not reconstructed.

The single status badge says `Updating live` only for the exact `connected`
subscription lifecycle state; every other state, including an absent lifecycle,
says `No live updates`. This status does not block posting. Commands and the
post-success authoritative refresh remain usable after the subscription has
exhausted its reconnect attempts. The message textarea posts on Command+Enter
or Control+Enter, keeps plain Enter multiline, and ignores shortcuts during IME
composition.

## Tests and Envoy topology

```bash
pnpm --config.verify-deps-before-run=false vitest run \
  examples/message-board/web/test/message-board.test.tsx
pnpm --config.verify-deps-before-run=false --dir examples/message-board/web test:browser
pnpm exec node examples/message-board/web/test/interop/browser/run.mjs
```

The last command is the separate HTTPS/gRPC-Web interoperability topology. It
uses Envoy, local TLS, and the application gateway; the browser never reaches
the native backend. Deployment users copy and customize the
[Envoy reference](../../../interop/envoy/README.md) for their certificates,
gateway address, and network policy.
