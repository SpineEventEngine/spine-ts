# MessageBoard — A complete Spine TS web application

MessageBoard is the easiest place to see a complete Spine TS web application.
You can enter a username and message in React, send a real Spine command, and
see the saved message appear on the board.

## 💡 What will you learn?

- ✅ How a Proto model is shared by a Node server and browser UI.
- ✅ How an Aggregate accepts a command and a Projection builds the message board view.
- ✅ How the framework serves Connect and gRPC-Web without application-owned
  listener, router, CORS, or signal-handling code.
- ✅ How authentication policy stays outside the bounded context.
- ✅ How a React client re-reads current state after a possible subscription gap.
- ✅ How Proto validation messages travel from the server to the form.
- ✅ How Shadcn components produce an accessible, responsive interface.

## 📦 Application map

```text
message-board/
├── model/    # MessageBoard messages, commands, events, and rejections
├── app/      # Bounded context, domain handlers, policy, and server
├── web/      # React UI and browser client
└── README.md # You are here
```

These are private workspace packages. Generated model and handler files are
build outputs. Build them once before starting the local processes.

## 🐳 Build local images

`pnpm images:build:local` creates three local-only, unpublished images. Node is
PID 1 in each image and handles `SIGTERM`/`SIGINT`. Production application and
combined commands require `HOST`, `PORT`, `DATASTORE_PROJECT_ID`, and
`SPINE_IPC_DIRECTORY`; combined also needs `BROWSER_ORIGIN`. The gateway also
requires `BACKEND_URL`, and both browser modes require
`SUBSCRIPTION_REGISTRY_NAMESPACE`. Datastore remains application-selected;
gateway registry storage is a separate durable concern.

See the [container image guide](deploy/container/README.md) for the fixed tags,
runtime commands, complete environment table, shutdown behavior, and limits.

## 🚀 Run MessageBoard locally

Install dependencies once from the repository root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck:build
```

Start the server in one terminal:

```bash
pnpm --dir examples/message-board/app start
```

Start the React UI in another terminal:

```bash
pnpm --dir examples/message-board/web start
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173), enter a username and a
message, and post it to board `general`. In the message textarea, Command+Enter
on macOS or Control+Enter elsewhere posts while plain Enter adds a line. Stop
either process with `Ctrl-C`.

Leave either field empty to see the validation text declared in
[`commands.proto`](model/proto/spine/examples/messageboard/commands.proto). The
browser does not keep a second copy of those rules; it displays the structured
validation response returned by the server.

## 🧭 Follow one message

1. The browser creates `PostMessage` and sends it through the authenticated
   browser endpoint.
2. `BoardMessageAggregate` stores one message and emits `MessagePosted`.
3. `BoardViewProjection` creates the board’s visible message row, including the
   display username and posting time.
4. The browser queries rows from oldest to newest and treats subscription updates as hints to
   refresh that state.

The interface shows approximate ages such as `just now` and `3 hours ago`.
When two rows share the same timestamp, the message identifier provides a
stable tie-break so a refresh cannot shuffle them.

The `Updating live` badge appears only while the subscription is connected.
Otherwise, `No live updates` accurately describes the subscription without
blocking posts or their authoritative refresh.

The browser starts one logical board subscription. Its initial `Activate` is
expected; a later `Activate` is a reconnect after the previous stream ended.
Each accepted server subscription receives one `Cancel` when it is replaced or
when the page closes. The browser console narrates these lifecycle changes,
server update hints, and command outcomes for local learning and diagnosis.

MessageBoard messages are entities, not domain-event subscriptions. Reusing a
`MessageId` leaves the first message unchanged and records the generated
`MessageAlreadyPosted` rejection.

## 🧪 Run the tests

```bash
pnpm --config.verify-deps-before-run=false exec vitest run \
  examples/message-board/app/test \
  examples/message-board/web/test/message-board.test.tsx

pnpm --config.verify-deps-before-run=false --dir examples/message-board/web test:browser
```

The browser suite requires Playwright browsers. Install them once with
`pnpm exec playwright install chromium firefox webkit`.

## ⚠️ Local authentication and delivery

The demo uses in-memory storage and a fixed, non-secret local identity for
`ada`. It is not a production sign-in flow. Subscription notices can be
duplicated, reordered, or missed; after reconnecting, the UI re-queries the
authoritative Projection state.

## 🔗 Learn more

- [MessageBoard server](app/README.md)
- [MessageBoard model](model/README.md)
- [MessageBoard web UI](web/README.md)
- [browser client, authentication, and gateway extension guide](../../docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
- [Reference for coding agents](REFERENCE.md)
