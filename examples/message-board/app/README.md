# Message Board server application

This package turns the Message Board model into a runnable Spine bounded context.
The framework handles the network and process plumbing; the example contains only
Message Board domain code, public-demo admission, and concise server configuration.

## 💡 What is here?

- ✅ `BoardMessageAggregate` guards write-side consistency for one posted
  message.
- ✅ `BoardViewProjection` creates the browser’s query-side board view.
- ✅ `BoardAccessPolicy` protects boards and message authors.
- ✅ `MessageBoardApplication` builds the context and starts the framework server.
- ✅ Framework validation rejects missing usernames and messages before a
  handler runs.

## 🚀 Start the server

From the repository root:

```bash
pnpm typecheck:build
pnpm --dir examples/message-board/app start
```

This workspace command uses the explicit local in-memory entrypoint. It prints
`MessageBoard local server ready at http://127.0.0.1:8090` after the public
browser listener is ready. Stop it with `Ctrl-C`.

The complete entry point is intentionally small:

<!-- docs-snippet-path: examples/message-board/app/src/local-application-server.ts -->

```ts
import { MessageBoardApplication } from "./index.js";

const server = await new MessageBoardApplication().run({ port: 8090 });
console.log(`MessageBoard local server ready at ${server.baseUrl}`);
```

Use `start()` instead of `run()` when another host handles process signals:

<!-- docs-snippet-path: examples/message-board/app/src/local-application-server.ts -->

```ts
import { MessageBoardApplication } from "./index.js";

const server = await new MessageBoardApplication().start({ port: 0 });
try {
  console.log(server.baseUrl);
} finally {
  await server.close();
}
```

## Public demo boundary

The demo creates no browser credential. Its Gateway (from
`@spine-event-engine/server/browser`) admits the public board and
rebuilds the actor context from each decoded request before forwarding it. It
does not copy browser-supplied tenant or other trusted fields.

## 🧪 Test the application

```bash
pnpm proto:generate
pnpm exec vitest run examples/message-board/app/test
```

## Local-only defaults

The production-shaped source files are named for the process they start:

| File                                                               | Process role                                                                                           |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [`application-server.ts`](src/application-server.ts)               | Starts only the Message Board Bounded Context; a separate Gateway is required.                         |
| [`gateway-server.ts`](src/gateway-server.ts)                       | Starts only the browser-facing Gateway; it contains no Bounded Context and does not run Delivery work. |
| [`combined-server.ts`](src/combined-server.ts)                     | Starts the application and Gateway together in one process.                                            |
| [`multi-process-app.ts`](src/multi-process-app.ts)                 | Selects the Coordinator parent or complete replica startup role.                                       |
| [`multi-process-coordinator.ts`](src/multi-process-coordinator.ts) | Owns parent lifecycle and starts the configured child replicas.                                        |
| [`multi-process-replica.ts`](src/multi-process-replica.ts)         | Builds and synchronizes one complete replica with shared Delivery.                                     |
| [`deployment-config.ts`](src/deployment-config.ts)                 | Validates the environment and assembles facilities shared by those entrypoints.                        |
| [`index.ts`](src/index.ts)                                         | Defines the domain handlers and reusable complete application assembly.                                |

Start with `combined-server.ts` to see the fewest production-shaped processes.
Read `multi-process-app.ts` when learning how one machine uses several CPU cores.

Local commands use in-memory application storage. The public browser Gateway
creates its own process-local subscription bindings.
Prebuilt production commands require `HOST`, `PORT`, `DATASTORE_PROJECT_ID`,
`DELIVERY_SERVER_URL`; managed nodes additionally require `PROCESS_COUNT` and
`DELIVERY_SHARD_COUNT`; browser modes additionally
require `BROWSER_ORIGIN`, while the
standalone gateway uses `BACKEND_DISCOVERY_SERVICE` and `BACKEND_DISCOVERY_PORT`
in Kubernetes; local Compose alone uses comma-separated `BACKEND_URLS` as an
explicit static fixture and accepts legacy `BACKEND_URL`. Application data uses
application Datastore storage. Public browser subscription state is local to the
Gateway process, so a Gateway restart makes the browser reconnect, query the
current board, and resume live updates.
The public-demo Gateway has no browser credential configuration.
Each entrypoint constructs one Datastore client from
`DATASTORE_PROJECT_ID` and hands that exact client to the storage factory.
It also gives the storage factory the application's generated Protobuf type
registry. This lets message-valued IDs and `(column)` values inside `Any`
metadata use the same compact JSON representation when they are written and
queried. See the small setup in
[`deployment-config.ts`](src/deployment-config.ts).
The [container image guide](../deploy/container/README.md) lists the production
commands, fixed image tags, and runtime values.

## 🔗 Learn more

- [Complete Message Board example](../README.md)
- [Server package](../../../packages/server/README.md)
- [Detailed coding-agent reference](REFERENCE.md)
