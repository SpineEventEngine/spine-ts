# MessageBoard web reference

This reference is for coding agents and maintainers. Beginners should start
with the [MessageBoard web README](README.md).

## Composition

`MessageBoardApp` receives an application-owned browser session and
`ClientRequest`. Production hosts may supply gRPC-Web or Connect through
`client-web`; the visible local entry uses the real Connect gateway. Blank
username and message values are submitted to the server so its Proto validation
messages can be shown, but the server does not accept them.

The gateway URL defaults to `http://127.0.0.1:8090` and accepts only an
`http://127.0.0.1` URL with a port from 1 through 65535. The Vite origin is
`http://127.0.0.1:5173`.

## UI and recovery behavior

The host creates a fresh request only after sign-in. Late sign-in completions
after unmount are ignored. Command transport failures and resolved `error` or
`rejection` outcomes preserve the generated message ID and raw field values for
one single-flight retry. Blank values are sent to the server for validation.

Board state comes from an authoritative Query. A `resynchronization` delivery
already contains authoritative state. Raw updates and `gapPossible` notices
coalesce into at most one active refresh and one follow-up. A later normal
refresh supersedes recovered state. Intermediate history is not reconstructed.

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
[Envoy reference](../../../interop/envoy/README.md) for their own certificates,
gateway address, and network policy.
