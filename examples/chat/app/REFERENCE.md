# Chat app reference

This reference is for coding agents and maintainers. Beginners should start
with the [Chat app README](README.md).

## Assembly

`ChatApplication.createContext()` builds a single-tenant context with
`InMemoryStorageFactory` by default, generated registry lookup, one Aggregate,
and one Projection. `start()` embeds the server and leaves close ownership to
the caller. `run()` delegates `SIGINT` and `SIGTERM` shutdown to `Server`.

Browser configuration supplies the Chat type registry, `LocalChatSession`
resolver and clock, `ChatAuthorizationPolicy`, `ChatContextResolver`, exact
Vite origin, and stable principal fingerprint. Generic listener, CORS, router,
subscription-binding, rollback, and lifecycle modules must remain in the
framework rather than returning to this package.

The server defaults to loopback and an ephemeral public port; the local CLI
selects 8090. The native backend remains on an internal ephemeral loopback
port. The service permits at most 1,000 active subscriptions.

## Generated code

`spine-proto compose` writes `src/model-registry.ts` from `spine-proto.json`.
`spine-proto handlers` writes
`generated/handler/generated-handler-registry.ts` from decorated classes.
Both are generated outputs.

```bash
cd examples/chat/app
pnpm proto:compose
pnpm handlers:generate
pnpm exec tsc -b
```

## Domain invariants

Proto validation rejects missing IDs, room, author, text, or posting time before
`postMessage()` runs. Reusing a `MessageId` preserves the first state and throws
the generated `MessageAlreadyPosted` rejection. The Projection indexes room,
author, and posting time for browser queries.
