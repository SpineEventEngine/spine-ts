# Message Board server application

This package turns the Message Board model into a runnable Spine bounded context.
The framework handles the network and process plumbing; the example contains only
Message Board domain code, local session policy, and concise server configuration.

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

```ts
// docs-snippet-path: examples/message-board/app/src/local-entry.ts
import { MessageBoardApplication } from "./index.js";

const server = await new MessageBoardApplication().run({ port: 8090 });
console.log(`MessageBoard local server ready at ${server.baseUrl}`);
```

Use `start()` instead of `run()` when another host handles process signals:

```ts
// docs-snippet-path: examples/message-board/app/src/local-entry.ts
import { MessageBoardApplication } from "./index.js";

const server = await new MessageBoardApplication().start({ port: 0 });
try {
  console.log(server.baseUrl);
} finally {
  await server.close();
}
```

## 🔐 Authentication boundary

The local command uses a fixed eight-hour in-memory session for `ada` and admits
only board `general`. It avoids routine local session renewal traffic; it is not
a production sign-in policy. The bounded context never reads credentials. The
framework gateway authenticates first, replaces caller-supplied actor and tenant
data with trusted values, then forwards the request.

## 🧪 Test the application

```bash
pnpm proto:generate
pnpm exec vitest run examples/message-board/app/test
```

## ⚠️ Local-only defaults

The production-shaped source files are named for the process they start:

| File                                               | Process role                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [`application-entry.ts`](src/application-entry.ts) | Starts only the Message Board Bounded Context; a separate Gateway is required.                         |
| [`gateway-entry.ts`](src/gateway-entry.ts)         | Starts only the browser-facing Gateway; it contains no Bounded Context and does not run Delivery work. |
| [`combined-entry.ts`](src/combined-entry.ts)       | Starts the application and Gateway together in one process.                                            |
| [`managed-entry.ts`](src/managed-entry.ts)         | Starts one Coordinator parent and the configured number of complete child replicas.                    |
| [`deployment-config.ts`](src/deployment-config.ts) | Validates the environment and assembles facilities shared by those entrypoints.                        |
| [`index.ts`](src/index.ts)                         | Defines the domain handlers and reusable complete application assembly.                                |

Start with `combined-entry.ts` to see the fewest production-shaped processes.
Read `managed-entry.ts` when learning how one machine uses several CPU cores.

Local commands use in-memory storage, sessions, and subscription bindings.
Prebuilt production commands require `HOST`, `PORT`, `DATASTORE_PROJECT_ID`,
`DELIVERY_SERVER_URL`; managed nodes additionally require `PROCESS_COUNT` and
`DELIVERY_SHARD_COUNT`; browser modes additionally
require `BROWSER_ORIGIN` and `SUBSCRIPTION_REGISTRY_NAMESPACE`, while the
standalone gateway uses `BACKEND_DISCOVERY_SERVICE` and `BACKEND_DISCOVERY_PORT`
in Kubernetes; local Compose alone uses comma-separated `BACKEND_URLS` as an
explicit static fixture and accepts legacy `BACKEND_URL`. A missing registry namespace stops a
browser-mode process before it opens a listener. Application data uses
application Datastore storage; gateway subscription registry storage is
separate. Production browser processes also require the shared
`MESSAGE_BOARD_SESSION_ISSUER`, `MESSAGE_BOARD_SESSION_AUDIENCE`,
`MESSAGE_BOARD_SESSION_KEY_ID`, and `MESSAGE_BOARD_SESSION_PRIVATE_KEY` values.
Each entrypoint constructs one Datastore client from
`DATASTORE_PROJECT_ID` and hands that exact client to the storage factory.
It also gives the storage factory the application's generated Protobuf type
registry. This lets message-valued IDs and `(column)` values inside `Any`
metadata use the same compact JSON representation when they are written and
queried. See the small setup in
[`deployment-config.ts`](src/deployment-config.ts).
Changing signing values per browser-capable replica breaks session validation;
changing the registry namespace splits subscription state.
The [container image guide](../deploy/container/README.md) lists the production
commands, fixed image tags, and runtime values.

## 🔗 Learn more

- [Complete Message Board example](../README.md)
- [Server package](../../../packages/server/README.md)
- [Authentication package](../../../packages/auth/README.md)
- [Detailed coding-agent reference](REFERENCE.md)
