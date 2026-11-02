# Message Board web UI

This React application posts Message Board commands and reads the board’s
query-side Projection through the real Spine browser client. It uses project
Shadcn components and Tailwind CSS. It contains no fallback data: if the server
is down, the UI reports the failure.

## 💡 What does it demonstrate?

- ✅ A browser-safe Spine client using the React adapter.
- ✅ A username input and message textarea with stable retry behavior and a
  Command+Enter or Control+Enter post shortcut.
- ✅ Server-authored Proto validation messages displayed beside each field.
- ✅ Oldest-first messages with approximate relative time.
- ✅ A board query followed by complete Projection update payloads.
- ✅ Local updates for normal payloads and authoritative recovery when needed.
- ✅ Lifetime board and announcement statistics through typed `ReadBoardStats`, with a recoverable statistics Topic.
- ✅ Public or signed sessions, board selection, and the latest permitted MessagePosted notification.
- ✅ One board-view live-status badge: `Updating live` only for a connected subscription,
  otherwise `No live updates`.

## Posting and continuing updates

The [posting form](src/post-form.tsx) uses `postAndSubscribe` to select `MessagePosted`
and `MessageAlreadyPosted` before sending `PostMessage`. It distinguishes
acceptance from the later outcome. If the first update is late, it shows a
waiting notice and continues listening; it does not resend the Command.
Activation failure prevents the Command from being posted.

The form cancels its per-post subscription after handling the outcome or leaving
the page. The board's Entity subscription has a different lifetime: it keeps
receiving successive Projection updates while the page is open. An idle board
is normal, so it does not have a first-update warning. These are independent
subscriptions, and the local single-process UI needs no shared Delivery server.

## 🚀 Start the UI

Create and trust a local certificate as shown in the [Message Board README](../README.md), then start the full local application and HTTPS/HTTP2 browser edge:

```bash
examples/message-board/scripts/start-local-single-process.sh
```

For UI development with an already running local Gateway, configure the same-origin edge explicitly before starting Vite:

```bash
MESSAGE_BOARD_TLS_KEY_FILE="$PWD/examples/message-board/web/.local/localhost-key.pem" \
MESSAGE_BOARD_TLS_CERT_FILE="$PWD/examples/message-board/web/.local/localhost-cert.pem" \
MESSAGE_BOARD_INTERNAL_GATEWAY_URL=http://127.0.0.1:8090 \
VITE_MESSAGE_BOARD_GATEWAY_URL=https://127.0.0.1:5173 \
pnpm --dir examples/message-board/web start
```

Vite fails at startup if any of these serving settings are absent. Its production build does not require local TLS files.

## 🔄 How updates work

The page posts `PostMessage`, queries the `BoardMessageView` read-side
Projection for the selected board, and subscribes to the same Projection topic.
A normal complete entity payload is validated and applied to the local oldest-
first rows without another query. The page queries only for its initial state,
after reconnect, a possible gap, a malformed payload, or a successful post
while live updates are disconnected. Duplicate, reordered, and missing delivery
are still possible, so those recovery queries remain authoritative.

The Message label describes the keyboard shortcut. In the textarea, press
Command+Enter on macOS or Control+Enter on other platforms to post; plain Enter
remains a new line. The shortcut does not post while an input method editor is
composing text.

The live-status badge only says `Updating live` when the subscription lifecycle
is exactly connected. It otherwise says `No live updates`. A disconnected board-view subscription does not itself prevent posting. Each
post activates its separate outcome subscription first; if that activation
fails, the form reports the error without sending the Command.

React-specific `use...` names are hooks from
`@spine-event-engine/client-react`. The framework-neutral browser client keeps
the action verbs `post`, `postAndSubscribe`, `send`, `createSubscription`, `activate`, and `cancel`.

Open the browser console while learning locally to see structured messages for
activation, connection, reconnects, received server updates, command sending,
and command results. They include the board, subscription target, complete
local command/outcome, and received server update so a beginner can inspect the
flow; they never include request metadata. Treat the
local console like other local diagnostics because commands and updates may
contain user-visible message text. The board view has one continuing logical subscription. Each post also activates
its selected outcome subscriptions; these extra activations are expected.
Cancellation releases them when their application-selected lifetime ends.

## ✅ Validation belongs to the server

`PostMessage` declares both required fields and their messages in Proto:

```proto
string username = 4 [
  (required) = true,
  (if_missing).error_msg = "Enter a username."
];

string text = 5 [
  (required) = true,
  (if_missing).error_msg = "Enter a message."
];
```

The form uses `noValidate` deliberately. Empty values reach Spine, and the UI
unpacks the server's `ValidationError` details. Applications can change the
Proto messages without changing a client-side validation table.

## 🎨 Shadcn components

The component source lives under `src/components/ui`, so the application can
adapt it. `components.json`, `src/index.css`, and `vite.config.ts`
provide the normal Shadcn/Tailwind setup. Only the Button, Card, Input, Label,
Textarea, Alert, and Avatar components used by this page are included.

## 🧪 Run browser tests

```bash
pnpm --config.verify-deps-before-run=false vitest run \
  examples/message-board/web/test/message-board.test.tsx

pnpm --config.verify-deps-before-run=false --dir examples/message-board/web test:browser
```

Install Playwright browsers once with
`pnpm exec playwright install chromium firefox webkit`.

## Reader admission and lifetime statistics

Public mode has no credential and hides author display names. Set `VITE_MESSAGE_BOARD_AUTH_MODE=signed` when the Gateway uses signed sessions. The UI accepts an issued bearer credential and validates it with the existing `AuthenticationService.resolveContext` RPC before opening readers. It never asks the reader to choose a role. On sign-out or account switch, pending sessions and subscriptions are closed, and late completions cannot replace the active reader. The UI never renders contributor ID arrays.

`ReadBoardStats` returns lifetime message and distinct domain-author-ID counts and the first accepted Event time for the selected board and announcements. A statistics Entity Topic refreshes this typed App Query after projection changes. The HTTPS edge multiplexes this Topic with the board, announcement, and broad Event subscriptions, including per-post outcomes. The broad `MessagePosted` notification stream stays continuous. A statistics Topic failure is visible while the last successful query result remains visible.

## 🔗 Learn more

- [Complete Message Board example](../README.md)
- [Browser client](../../../packages/client-web/README.md)
- [React adapter](../../../packages/client-react/README.md)
- [Detailed coding-agent reference](REFERENCE.md)
