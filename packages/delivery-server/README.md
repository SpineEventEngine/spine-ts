# In-memory Spine Delivery server

This package provides the in-memory Delivery server. Use it to develop and test
the local delivery path, or as the deliberately ephemeral delivery component in
the supported examples. Its Inbox rows, leases, and delivered facts disappear
when the process stops.

The [reference](REFERENCE.md) records finite limits, shutdown order, and the
complete protocol contract, including API detail for coding agents.

This is an experimental snapshot package. Use Node 24 or newer; an embedded
server also needs an application-managed Connect listener.

```sh
pnpm add @spine-event-engine/delivery-server@snapshot
```

## 💡 Why use it?

- ✅ Coordinates inbox work and shard ownership between trusted Node processes.
- ✅ Starts as a standalone command or embeds in another Node server.
- ✅ Limits the total number and encoded size of stored inbox rows.
- ✅ Provides administration and gRPC health endpoints for local operations.

## 🚀 Run a local server

Construct a server, start it, and close it during application shutdown. Port
zero asks the operating system for a free local port.

<!-- docs-snippet-path: packages/delivery-server/src/server/delivery-server.ts -->

```ts
import { DeliveryServer } from "@spine-event-engine/delivery-server";

const server = new DeliveryServer({ host: "127.0.0.1", port: 0 });
await server.start();
const url = server.baseUrl;
await server.close();
void url;
```

The `spine-delivery-server` executable runs the same server. It reads
configuration once at startup from explicit options, then environment variables,
then defaults.

| Setting           | Environment variable       | Default     |
| ----------------- | -------------------------- | ----------- |
| Listener host     | `HOST`                     | `127.0.0.1` |
| Listener port     | `PORT`                     | `8484`      |
| Inbound size      | `MAX_INBOUND_MESSAGE_SIZE` | 4 MiB       |
| Session lifetime  | `SHARD_PROCESSING_TIMEOUT` | 60 seconds  |
| Work reminder     | `WORK_REMINDER_SECONDS`    | 10 seconds  |
| Retained messages | `MAX_RETAINED_MESSAGES`    | 10,000      |
| Retained bytes    | `MAX_RETAINED_BYTES`       | 32 MiB      |
| Child processes   | `DELIVERY_PROCESS_COUNT`   | 1           |

Set `processCount: 2` when constructing `DeliveryServer`, or set
`DELIVERY_PROCESS_COUNT=2` for the executable. The public listener stays in the
parent process. It routes shard number `s` to child `s % 2`, while each child
keeps the full shard identity. For example, the parent forwards a write for
shard 3 to subprocess 1. Subprocess 1 writes to its inbox and returns the
result. Each subprocess applies the row and byte settings to the rows it stores.
If a subprocess exits, the parent starts a replacement in the same slot.
The exited process loses its in-memory rows and sessions.

## 🧩 Embed the handlers

Use `InMemoryDelivery.create()` when an application provides the Connect router and
listener itself. Register the inbox, guarded worker mutations, shard, managed-session, and work observation
handlers on the router as shown below. The application manages the network listener and its lifecycle.

An embedded consumer must declare and install direct dependencies on
`@spine-event-engine/delivery-server`, `@connectrpc/connect`, and
`@spine-event-engine/proto`. The service descriptors in this example are
exported from `@spine-event-engine/proto/delivery-server`; do not rely on the
delivery server's transitive dependencies.

<!-- docs-snippet-path: packages/delivery-server/src/core/in-memory-delivery-core.ts -->

```ts
import { createRouterTransport } from "@connectrpc/connect";
import { InMemoryDelivery } from "@spine-event-engine/delivery-server";
import {
  GuardedInboxService,
  InboxService,
  ManagedShardService,
  ShardObservingService,
  ShardService,
} from "@spine-event-engine/proto/delivery-server";

const delivery = InMemoryDelivery.create({
  processingTimeoutMs: 30_000,
  maxRetainedMessages: 10_000,
  maxRetainedBytes: 32 * 1024 * 1024,
});
const transport = createRouterTransport((router) => {
  router.service(InboxService, delivery.inbox);
  router.service(GuardedInboxService, delivery.guarded);
  router.service(ShardService, delivery.shards);
  router.service(ManagedShardService, delivery.managed);
  router.service(ShardObservingService, delivery.observing);
});
void transport;

// During application shutdown, close active work streams and cancel the core's timers.
delivery.close();
```

The example gives a picked-up shard a 30-second session. The default is 60
seconds. The server expires the session if the worker stops renewing it.
If the shard still has pending work, subscribers can immediately try to take it.
The work reminder interval controls how often the server repeats the notice
while the shard is free.

The standalone listener exposes Inbox, Guarded Inbox, Shard, Managed Shard, Shard Observing, Admin, and gRPC health services.
It binds only to the loopback address by default. An explicit non-loopback host
is a caller-selected trusted-network deployment and should not be exposed
directly to the public Internet.

## Work notifications

An application instance can open `ShardObservingService.ObserveAll` on the same
gRPC endpoint as the inbox. Each response identifies a free shard containing at
least one row with status `TO_DELIVER`. Every subscribed instance can receive
the same shard index. The application requests pickup before reading the rows
and running a handler.

Suppose shard 4 of 16 already contains a Command when a second application
instance connects. The server reports shard 4 on that new connection immediately.
When all shards are empty or being processed, the call stays open and silent.

If neither instance takes shard 4, the server sends the index again after the
configured reminder interval, ten seconds by default. Set `workReminderSeconds`
when constructing the server or set `WORK_REMINDER_SECONDS` for the executable. For example, if the first
notice went out at 12:00:00, a second Command written to that shard at 12:00:03
leaves the reminder due at 12:00:10. Pickup stops the reminders. If the worker
releases shard 4 with a Command still waiting, the server reports it again.
A reconnect starts with the shards available at that time.

## ⚠️ In-memory means temporary

State disappears when the process stops, including accepted pending Commands.
Using PostgreSQL or another durable store for application business state does
not persist this server's Inbox. After restart, saved business state can remain
while accepted pending work is lost. Shared Delivery coordinates application
processes but does not make this in-memory server durable.

The server has no durable mode, TLS,
authentication, authorization, configuration reload, health watch stream, or
administration UI. A pending row is not an attempt-history or quarantine
record. Its default loopback listener is for development; a wider listener
belongs only on an application-managed trusted network.

## 🔗 Learn more

- [Delivery client](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/delivery-client/README.md)
- [Server](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/server/README.md)
- [Detailed delivery reference](REFERENCE.md)
