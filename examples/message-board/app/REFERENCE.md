# Message Board app reference

This reference records the Message Board app contract. Beginners should start
with the [Message Board app README](README.md).

## Assembly

`MessageBoardApplication.createContext()` builds a single-tenant context with
`InMemoryStorageFactory` by default, generated registry lookup, one Aggregate,
and one Projection. `start()` embeds the server and leaves closing to
the caller. `run()` delegates `SIGINT` and `SIGTERM` shutdown to `Server`.

Browser configuration supplies the Message Board type registry and public access
resolver and clock, `BoardAccessPolicy`, `BoardContextResolver`, exact
Vite origin. Generic listener, CORS, router,
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
cd examples/message-board/app
pnpm proto:compose
pnpm handlers:generate
pnpm exec tsc -b
```

## Domain invariants

Proto validation rejects missing IDs, board, author, text, or posting time before
`postMessage()` runs. Reusing a `MessageId` preserves the first state and throws
the generated `MessageAlreadyPosted` rejection. The Projection indexes board,
author, and posting time for browser queries.
