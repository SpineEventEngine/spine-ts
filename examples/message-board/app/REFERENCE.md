# Message Board app reference

This reference records the Message Board app contract. Beginners should start
with the [Message Board app README](README.md).

## Assembly

`MessageBoardApplication` uses `ComposedBoardApplication` in every startup mode. It builds the Message Board and announcements Bounded Contexts, registers `ReadBoardMessage` and `ReadBoardStats`, and applies Bounded Context and Server read filters. Each context has a distinct logical subscription storage group; the captured registry group is prepared during startup, including an injected registry. Partial startup closes already-created contexts. `start()` leaves closing to the caller; `run()` handles process signals.

Public admission accepts the demonstration actor without claiming verified identity. Signed admission requires the configured issuer, audience, P-256 private key and key ID, and HMAC proof key. `SignedSessions` supplies the principal and its `canReadRestricted` authority fact. The Gateway forwards a proof bound to each reader operation; direct native Query and subscription readers verify bearer admission. Keep the native endpoint on a trusted internal network. The example does not claim bearer authentication of every native Command RPC.

## Generated code

`spine-proto compose` writes `src/model-registry.ts` from `spine-proto.json`.
`spine-proto handlers` writes
`generated/spine-metadata.ts` and `generated/spine-bootstrap.ts` from decorated classes.
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
