# Spine application server for Node.js

`@spine-event-engine/server` is the native Node.js runtime for a Spine bounded
context. Use it to assemble contexts and expose native Connect/gRPC-compatible
services. Browser hosting is deliberately a separate entry point.

> **Experimental prerelease.** Install an exact snapshot while this API evolves:
> Snapshot releases may remove earlier prerelease import paths.

## Install and prerequisites

```bash
pnpm add @spine-event-engine/server@snapshot
```

Use Node.js in ESM mode. Before adding entities, generate your application
model and handler registry with `@spine-event-engine/proto-tools`. The small
example below has no entity handlers, so it is useful for proving that native
assembly, listener startup, and cleanup work locally.

## First native server

Build one context, start a loopback listener on an ephemeral port, and close
the returned running server. `start()` installs no signal handlers, which makes
this shape appropriate for tests and hosts that own shutdown themselves.

<!-- docs-snippet-path: packages/server/test/server/server-environment.test.ts -->

```ts
import { BoundedContext, Server } from "@spine-event-engine/server";

const context = BoundedContext.singleTenant("Tasks").build();
const running = await new Server({ contexts: [context], port: 0 }).start();
try {
  // Native Command, Query, and Subscription services are now listening.
} finally {
  await running.close();
}
```

Add generated entities with `BoundedContext.add(...)` and use
`buildAsync()` when framework-generated repository discovery is needed. A
context is single-tenant or multitenant by construction; select that mode
before registering application handlers and storage.

## Native lifecycle and routing

`Server.run()` is the standalone process form: it owns `SIGINT`/`SIGTERM`
cleanup. `Server.start()` returns a `RunningServer` for an embedding host to
close. `ManagedServerApplication` is the Node-only complete-replica entrypoint;
it does not infer process or Delivery-shard counts.

Routes are declared by generated message schema or interface token. Exact
schema routes take precedence. Query results from `Stand` are authoritative;
subscriptions are live, best-effort notifications, so clients re-query after a
reconnect or a possible gap. Configure a storage provider for durable
application state and generated repository assembly; in-memory choices are
for local development and tests.

## Entity identifiers

An Entity ID can be a primitive value or a complete generated Protobuf message.
For a message-valued ID, the Entity state message declares that ID message as
its first field. The field is not required to be named `value`: nested and
multiple fields are part of the identity.

```proto
message WorkItemId {
  spine.core.UserId owner = 1;
  int32 sequence = 2;
}

message WorkItem {
  WorkItemId id = 1;
  string title = 2;
}
```

Generated messages can have any declared identifier fields. For example,
`CommandId` is a generated one-field ID with `uuid`, not `value`:

```ts
import { create } from "@bufbuild/protobuf";
import { type MessageId } from "@spine-event-engine/server";
import { CommandIdSchema } from "@spine-event-engine/proto";

const id = create(CommandIdSchema, { uuid: "task-42" });
const entityId: MessageId = id;
```

At routing, the generated ID is checked against the state field's declared
schema and its generated validation rules before durable use. Primitive IDs
continue to work. The only message-to-primitive compatibility behavior is the
exact legacy scalar wrapper (`{ $typeName, value }`); ordinary message IDs are
never reduced to a `value` field.

## Browser gateway migration

The server root has no browser options and does not load auth. To host a
browser-facing Gateway, install the optional auth peer and import the browser
entry point explicitly:

```bash
pnpm add @spine-event-engine/server@snapshot @spine-event-engine/auth@snapshot
```

```ts
import { BrowserServer, DurableSubscriptionBindings } from "@spine-event-engine/server/browser";
```

`BrowserServer.open(...)` composes a browser listener around a caller-managed
native server; `BrowserServer.run(...)` owns a standalone or combined browser
host. Supply exact allowed origins, a session or intentional public admission,
authorization and trusted-context resolvers, finite limits, and backend
forwarding. Authenticated durable bindings are browser-host infrastructure,
not native `Server` state. See the [browser/auth extension guide](https://github.com/SpineEventEngine/spine-ts/blob/master/docs/BROWSER_CLIENT_AUTH_EXTENSION_GUIDE.md)
before exposing a backend to a browser.

## Limits

This package does not create an identity provider, browser session store,
authorization policy, TLS configuration, or deployment topology. It does not
guarantee replay, gap repair, exactly-once subscription effects, or
cluster-complete notification delivery.

## Next steps

- [Detailed coding-agent reference](REFERENCE.md)
- [Authentication gateway](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/auth/README.md)
- [Message Board application](https://github.com/SpineEventEngine/spine-ts/blob/master/examples/message-board/app/README.md)
