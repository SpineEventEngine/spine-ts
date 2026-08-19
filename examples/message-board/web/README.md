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
- ✅ One live-status badge: `Updating live` only for a connected subscription,
  otherwise `No live updates`.

## 🚀 Start the UI

Start the [Message Board server](../app/README.md) first. Then run:

```bash
pnpm --dir examples/message-board/web start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The UI connects to
`http://127.0.0.1:8090` by default. Set `VITE_MESSAGE_BOARD_GATEWAY_URL` to another
`http://127.0.0.1:<port>` address when needed.

## 🔄 How updates work

The page posts `PostMessage`, queries the `BoardMessageView` read-side
Projection for board `general`, and subscribes to the same Projection topic.
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
is exactly connected. It otherwise says `No live updates`. A disconnected or
exhausted subscription does not prevent commands: posts and their authoritative
refresh are independent client operations.

React-specific `use...` names are hooks from
`@spine-event-engine/client-react`. The framework-neutral browser client keeps
the action verbs `post`, `send`, `createSubscription`, `activate`, and `cancel`.

Open the browser console while learning locally to see structured messages for
activation, connection, reconnects, received server updates, command sending,
and command results. They include the board, subscription target, complete
local command/outcome, and received server update so a beginner can inspect the
flow; they never include request metadata. Treat the
local console like other local diagnostics because commands and updates may
contain user-visible message text. One initial `Activate` belongs to the page's
logical subscription; another means a reconnect. Each accepted server
subscription is cancelled once when it is replaced or the page closes.

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

## Public demo

The visible demo creates no browser credential. It sends the selected actor in each request, and the Gateway rebuilds that actor context before forwarding it. Production hosts choose their own admission policy.

## 🔗 Learn more

- [Complete Message Board example](../README.md)
- [Browser client](../../../packages/client-web/README.md)
- [React adapter](../../../packages/client-react/README.md)
- [Browser authentication guide](../../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Detailed coding-agent reference](REFERENCE.md)
