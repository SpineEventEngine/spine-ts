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
- ✅ Bounds retained messages, retained bytes, and tracked shards.
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
| Pickup timeout    | `SHARD_PROCESSING_TIMEOUT` | disabled    |
| Retained messages | `MAX_RETAINED_MESSAGES`    | 10,000      |
| Retained bytes    | `MAX_RETAINED_BYTES`       | 32 MiB      |
| Tracked shards    | `MAX_TRACKED_SHARDS`       | 1,000       |

## 🧩 Embed the handlers

Use `InMemoryDelivery.create()` when an application provides the Connect router and
listener itself. `DeliveryCore.inbox` and `.shards` are the public Connect
handler implementations; register both before creating the transport. The
application still manages the network listener and its lifecycle.

An embedded consumer must declare and install direct dependencies on
`@spine-event-engine/delivery-server`, `@connectrpc/connect`, and
`@spine-event-engine/proto`. The service descriptors in this example are
exported from `@spine-event-engine/proto/delivery-server`; do not rely on the
delivery server's transitive dependencies.

<!-- docs-snippet-path: packages/delivery-server/src/core/in-memory-delivery-core.ts -->

```ts
import { createRouterTransport } from "@connectrpc/connect";
import { InMemoryDelivery } from "@spine-event-engine/delivery-server";
import { InboxService, ShardService } from "@spine-event-engine/proto/delivery-server";

const delivery = InMemoryDelivery.create({
  processingTimeoutMs: 30_000,
  maxRetainedMessages: 10_000,
  maxRetainedBytes: 32 * 1024 * 1024,
  maxTrackedShards: 1_000,
});
const transport = createRouterTransport((router) => {
  router.service(InboxService, delivery.inbox);
  router.service(ShardService, delivery.shards);
});
void transport;
```

The standalone listener exposes Inbox, Shard, Admin, and gRPC health services.
It binds only to the loopback address by default. An explicit non-loopback host
is a caller-selected trusted-network deployment and should not be exposed
directly to the public Internet.

## ⚠️ In-memory means temporary

State disappears when the process stops. The server has no durable mode, TLS,
authentication, authorization, configuration reload, health watch stream, or
administration UI. A pending row is not an attempt-history or quarantine
record. Its default loopback listener is for development; a wider listener
belongs only on an application-managed trusted network.

## 🔗 Learn more

- [Delivery client](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/delivery-client/README.md)
- [Server](https://github.com/SpineEventEngine/spine-ts/blob/main/packages/server/README.md)
- [Detailed delivery reference](REFERENCE.md)
