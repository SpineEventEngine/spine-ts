# Message Board web reference

This reference records the Message Board web contract. Beginners should start
with the [Message Board web README](README.md).

## Composition

`MessageBoardApp` receives its actor display name and `ClientRequest`.
Production hosts may supply gRPC-Web or Connect through
`client-web`; the visible local entry uses the real Connect gateway. Blank
username and message values are submitted to the server so its Proto validation
messages can be shown, but the server does not accept them.

The local browser Gateway URL is the HTTPS Vite origin, normally
`https://127.0.0.1:5173`. Vite requires certificate/key files, the internal
HTTP Gateway URL, and the same-origin browser URL when serving. The browser
client accepts an explicit HTTP or HTTPS URL with a port from 1 through 65535;
the maintained local launcher uses HTTPS so concurrent streams negotiate HTTP/2.

## UI and recovery behavior

The host creates one request scope for public mode or one verified bearer session per signed reader. Board selection and account switches replace the reader generation; late validation and query completions cannot overwrite the current reader. The form uses
`postAndSubscribe` for `PostMessage`, selecting `MessagePosted` and
`MessageAlreadyPosted`. It reports admission separately from the observed
outcome and keeps listening after a first-update timeout. It does not repost
on timeout. Blank values still reach the server for validation.

Each post receives its updates separately and is canceled separately. Component
retirement aborts setup/posting and cancels the handle; stale generations cannot
change the UI. After an outcome is handled, the form cancels that per-post
subscription. The board-view and broad MessagePosted Event subscriptions continue independently. The statistics Entity Topic stays active alongside per-post outcome streams over the HTTPS/HTTP2 edge and reconciles each update with a typed App Query. Failed
cleanup remains retryable through the client.

Board state starts with an authoritative Query. A normal complete update is
validated, identity-checked, board-checked, and applied locally in oldest-first
order. A `resynchronization` delivery already contains authoritative state.
Malformed updates, `gapPossible`, and disconnected post success coalesce into
at most one active refresh and one follow-up. A later normal refresh supersedes
recovered state. Intermediate history is not reconstructed.

The single status badge says `Updating live` only for the exact `connected`
subscription lifecycle state; every other state, including an absent lifecycle,
says `No live updates`. This status describes the board view. A post separately activates its outcome
subscriptions before sending; failed activation prevents that Command from
being sent. The message textarea posts on Command+Enter
or Control+Enter, keeps plain Enter multiline, and ignores shortcuts during IME
composition.

`ReadBoardStats` reports lifetime messages, distinct domain author IDs, and first accepted Event time for the selected board and announcements. Restricted boards and announcements are filtered by verified authority facts; public names are redacted and contributor IDs never leave the Server.

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
