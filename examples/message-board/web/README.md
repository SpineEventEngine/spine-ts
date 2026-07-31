# MessageBoard web UI

This React application posts MessageBoard commands and reads board messages
through the real Spine browser client. It uses owned Shadcn components and
Tailwind CSS. It contains no fallback data: if the server is down, the UI
reports the failure.

## 💡 What does it demonstrate?

- ✅ A browser-safe Spine client using the React adapter.
- ✅ A username input and message textarea with stable retry behavior.
- ✅ Server-authored Proto validation messages displayed beside each field.
- ✅ Oldest-first messages with approximate relative time.
- ✅ A board query followed by Projection subscription notices.
- ✅ Re-query after reconnect or a possible update gap.

## 🚀 Start the UI

Start the [MessageBoard server](../app/README.md) first. Then run:

```bash
pnpm --dir examples/message-board/web start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The UI connects to
`http://127.0.0.1:8090` by default. Set `VITE_MESSAGE_BOARD_GATEWAY_URL` to another
`http://127.0.0.1:<port>` address when needed.

## 🔄 How updates work

The page posts `PostMessage`, queries `BoardMessageView` entities for board
`general`, and subscribes to the same Projection topic. An update tells the UI
to refresh; it is not a complete message history. Duplicate, reordered, and
missing notices are allowed, so authoritative query results always win.

React-specific `use...` names are hooks from
`@spine-event-engine/client-react`. The framework-neutral browser client keeps
the action verbs `post`, `send`, `createSubscription`, `activate`, and `cancel`.

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

The component source lives under `src/components/ui`, so the application owns
and may adapt it. `components.json`, `src/index.css`, and `vite.config.ts`
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

## ⚠️ Development session

The visible demo uses a fixed, non-secret bearer for loopback development. A
real host signs the user in, creates a new request scope, and selects gRPC-Web
or Connect explicitly. The session object shown to React is informational and
is never itself a credential.

## 🔗 Learn more

- [Complete MessageBoard example](../README.md)
- [Browser client](../../../packages/client-web/README.md)
- [React adapter](../../../packages/client-react/README.md)
- [Browser authentication guide](../../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Reference for coding agents](REFERENCE.md)
