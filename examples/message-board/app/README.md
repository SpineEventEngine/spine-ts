# Message Board server application

This package starts the composed Message Board and announcements Bounded Contexts in every maintained mode. The framework handles network and process plumbing; the example configures public or signed admission.

## 💡 What is here?

- ✅ `BoardMessageAggregate` guards write-side consistency for one posted
  message.
- ✅ `BoardViewProjection` and `BoardStatisticsProjection` build Message Board views; the announcements Bounded Context builds its own view.
- ✅ Bounded Context and Server read filters protect restricted rows, statistics, Events, and author names.
- ✅ `MessageBoardApplication` builds one Application containing both Bounded Contexts and starts the framework server.
- ✅ Framework validation rejects missing usernames and messages before a
  handler runs.

## 🚀 Start the server

From the repository root:

```bash
pnpm typecheck:build
pnpm --dir examples/message-board/app start
```

This workspace command uses the explicit local in-memory entrypoint. With its
default ports, it prints `MessageBoard local server ready at http://127.0.0.1:8090`
after the public browser listener is ready. Stop it with `Ctrl-C`.

A minimal sketch using the default ports is:

<!-- docs-snippet-path: examples/message-board/app/src/local-application-server.ts -->

```ts
import { MessageBoardApplication } from "./index.js";

const server = await new MessageBoardApplication().run({
  port: 8090,
  webOrigin: "https://127.0.0.1:5173",
});
console.log(`MessageBoard local server ready at ${server.baseUrl}`);
```

The [actual local entrypoint](src/local-application-server.ts) validates
`MESSAGE_BOARD_LOCAL_PORT` (default `8090`, including `0` for an available
port) and `MESSAGE_BOARD_WEB_PORT` (default `5173`). It passes the selected web
port as `webOrigin`, so the allowed browser origin follows the UI when that
port changes. Point the UI at the selected local server port as well.

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

## Admission modes

`MESSAGE_BOARD_AUTH_MODE=public` uses the demonstration actor resolver. `signed` requires `MESSAGE_BOARD_SESSION_ISSUER`, `MESSAGE_BOARD_SESSION_AUDIENCE`, `MESSAGE_BOARD_SESSION_KEY_ID`, `MESSAGE_BOARD_SESSION_PRIVATE_KEY_PEM`, and `MESSAGE_BOARD_READER_PROOF_KEY_BASE64`. Keep these values in protected server configuration. The offline [`issue-board-session`](src/issue-board-session.ts) entrypoint issues a signed credential after the operator supplies a principal and restricted-read grant. The UI accepts the credential, calls `AuthenticationService.resolveContext`, and displays the verified principal; it offers no role selector.

Signed Gateway admission derives `canReadRestricted` from the verified principal and sends an operation-bound HMAC assertion to the application node. Native direct Query and subscription readers require the same verified admission. The native endpoint remains private/trusted; this example does not claim that every native Command RPC authenticates a bearer. The HMAC key minimum of 32 decoded bytes is the SHA-256 security-strength choice; a SHA-256 digest encodes as 43 base64url characters. These are cryptographic format requirements, not queue or request-size limits.

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
| [`multi-process-coordinator.ts`](src/multi-process-coordinator.ts) | Configures the production model registry and starts the managed Coordinator and child replicas.        |
| [`multi-process-replica.ts`](src/multi-process-replica.ts)         | Builds and synchronizes one complete replica with shared Delivery.                                     |
| [`deployment-config.ts`](src/deployment-config.ts)                 | Validates the environment and assembles facilities shared by those entrypoints.                        |
| [`index.ts`](src/index.ts)                                         | Exports the reusable complete application assembly.                                                    |

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
explicit static fixture. Application data uses
application Datastore storage. Public browser subscription state is local to the
Gateway process, so a Gateway restart makes the browser reconnect, query the
current board, and resume live updates.
The public mode has no browser credential. Signed mode uses the protected configuration above.
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
