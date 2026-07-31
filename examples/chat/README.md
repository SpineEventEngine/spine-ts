# Chat — A complete Spine TS web application

Chat is the easiest place to see Spine TS from browser to database boundary.
You can post a message in React, send a real Spine command, and read the
resulting Projection through the browser gateway.

## 💡 What will you learn?

- ✅ How a Proto model is shared by a Node server and browser UI.
- ✅ How an Aggregate accepts a command and a Projection builds the chat view.
- ✅ How the framework serves Connect and gRPC-Web without application-owned
  listener, router, CORS, or signal-handling code.
- ✅ How authentication policy stays outside the bounded context.
- ✅ How a React client re-reads current state after a possible subscription gap.

## 📦 Application map

```text
chat/
├── model/    # Chat messages, commands, events, and rejections
├── app/      # Bounded context, domain handlers, policy, and server
├── web/      # React UI and browser client
└── README.md # You are here
```

These are private workspace packages. Generated model and handler files are
build outputs; the startup commands create them when needed.

## 🚀 Run Chat locally

Install dependencies once from the repository root:

```bash
pnpm install --frozen-lockfile
```

Start the server in one terminal:

```bash
pnpm --dir examples/chat/app start
```

Start the React UI in another terminal:

```bash
pnpm --dir examples/chat/web start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173), enter a message, and post
it to room `general`. Stop either process with `Ctrl-C`.

## 🧭 Follow one message

1. The browser creates `PostMessage` and sends it through the authenticated
   browser endpoint.
2. `ChatMessageAggregate` stores one message and emits `MessagePosted`.
3. `ChatMessageViewProjection` creates the room’s visible message row.
4. The browser queries current rows and treats subscription updates as hints to
   refresh that state.

Chat messages are entities, not domain-event subscriptions. Reusing a
`MessageId` leaves the first message unchanged and records the generated
`MessageAlreadyPosted` rejection.

## 🧪 Run the tests

```bash
pnpm --config.verify-deps-before-run=false exec vitest run \
  examples/chat/app/test \
  examples/chat/web/test/chat-web.test.tsx

pnpm --config.verify-deps-before-run=false --dir examples/chat/web test:browser
```

The browser suite requires Playwright browsers. Install them once with
`pnpm exec playwright install chromium firefox webkit`.

## ⚠️ Local authentication and delivery

The demo uses in-memory storage and a fixed, non-secret local identity for
`ada`. It is not a production sign-in flow. Subscription notices can be
duplicated, reordered, or missed; after reconnecting, the UI re-queries the
authoritative Projection state.

## 🔗 Learn more

- [Chat server](app/README.md)
- [Chat model](model/README.md)
- [Chat web UI](web/README.md)
- [browser client, authentication, and gateway extension guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Reference for coding agents](REFERENCE.md)
