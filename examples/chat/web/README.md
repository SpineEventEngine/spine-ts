# Chat web UI

This React application posts Chat commands and reads room messages through the
real Spine browser client. It contains no fallback data: if the server is down,
the UI reports the failure.

## 💡 What does it demonstrate?

- ✅ A browser-safe Spine client using the React adapter.
- ✅ A command form with stable retry behavior.
- ✅ A room query followed by Projection subscription notices.
- ✅ Re-query after reconnect or a possible update gap.

## 🚀 Start the UI

Start the [Chat server](../app/README.md) first. Then run:

```bash
pnpm --dir examples/chat/web start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). The UI connects to
`http://127.0.0.1:8090` by default. Set `VITE_CHAT_GATEWAY_URL` to another
`http://127.0.0.1:<port>` address when needed.

## 🔄 How updates work

The page posts `PostMessage`, queries `ChatMessageView` entities for room
`general`, and subscribes to the same Projection topic. An update tells the UI
to refresh; it is not a complete message history. Duplicate, reordered, and
missing notices are allowed, so authoritative query results always win.

React-specific `use...` names are hooks from
`@spine-event-engine/client-react`. The framework-neutral browser client keeps
the action verbs `post`, `send`, `createSubscription`, `activate`, and `cancel`.

## 🧪 Run browser tests

```bash
pnpm --config.verify-deps-before-run=false vitest run \
  examples/chat/web/test/chat-web.test.tsx

pnpm --config.verify-deps-before-run=false --dir examples/chat/web test:browser
```

Install Playwright browsers once with
`pnpm exec playwright install chromium firefox webkit`.

## ⚠️ Development session

The visible demo uses a fixed, non-secret bearer for loopback development. A
real host signs the user in, creates a new request scope, and selects gRPC-Web
or Connect explicitly. The session object shown to React is informational and
is never itself a credential.

## 🔗 Learn more

- [Complete Chat example](../README.md)
- [Browser client](../../../packages/client-web/README.md)
- [React adapter](../../../packages/client-react/README.md)
- [Browser authentication guide](../../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Reference for coding agents](REFERENCE.md)
