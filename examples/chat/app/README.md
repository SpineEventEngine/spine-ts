# Chat server application

This package turns the Chat model into a runnable Spine bounded context. The
framework owns the network and process plumbing; the example contains only
Chat domain code, local session policy, and concise server configuration.

## 💡 What is here?

- ✅ `ChatMessageAggregate` stores one posted message.
- ✅ `ChatMessageViewProjection` creates the browser’s room view.
- ✅ `ChatAuthorizationPolicy` protects rooms and message authors.
- ✅ `ChatApplication` builds the context and starts the framework server.

## 🚀 Start the server

From the repository root:

```bash
pnpm --dir examples/chat/app start
```

The command generates and builds the required code, then prints
`Chat local server ready at http://127.0.0.1:8090` after the public browser
listener is ready. Stop it with `Ctrl-C`.

The complete entry point is intentionally small:

```ts
const server = await new ChatApplication().run({ port: 8090 });
console.log(`Chat local server ready at ${server.baseUrl}`);
```

Use `start()` instead of `run()` when another host owns process signals:

```ts
const server = await new ChatApplication().start({ port: 0 });
try {
  console.log(server.baseUrl);
} finally {
  await server.close();
}
```

## 🔐 Authentication boundary

The local command uses a fixed in-memory session for `ada` and admits only room
`general`. The bounded context never reads credentials. The framework gateway
authenticates first, replaces caller-supplied actor and tenant data with trusted
values, then forwards the request.

## 🧪 Test the application

```bash
pnpm proto:generate
pnpm exec vitest run examples/chat/app/test
```

## ⚠️ Local-only defaults

Storage, sessions, and subscription bindings are in memory. Production code
must select durable storage and sessions, real identity integration, TLS, and
network policy.

## 🔗 Learn more

- [Complete Chat example](../README.md)
- [Server package](../../../packages/server/README.md)
- [Authentication package](../../../packages/auth/README.md)
- [Reference for coding agents](REFERENCE.md)
