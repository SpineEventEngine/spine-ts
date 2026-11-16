# Message Board app reference

This reference records the Message Board app contract. Beginners should start
with the [Message Board app README](README.md).

## Assembly

`MessageBoardApplication` uses `ComposedBoardApplication` in every startup mode.
Both Bounded Context builders are added to one `Application` with an explicitly
configured `ServerEnvironment`. Application build prepares their shared reads
before either Bounded Context starts processing work. The native Server uses
`setApplication()` and registers `ReadBoardStats` and Server read filters.

Each Bounded Context has a distinct logical subscription storage group. Startup
prepares that group, including when a registry is supplied by the caller.
`create(environment, options)` returns the Application, both Bounded Contexts,
and the Server builder. A caller using this lower-level method closes every
started endpoint before closing the Application.

`start()` returns a host whose `close()` stops the browser and native listeners,
then closes the Application. `run()` also installs process shutdown handling.
Deployment methods receive storage, Delivery, and logging explicitly through
`BoardApplicationFacilities`. Standalone gateways and coordinators do not build
an Application or configure a ServerEnvironment.

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
