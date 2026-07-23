# @spine-ts/delivery-server

`createInMemoryDeliveryServerCore()` provides the frozen simple-server Inbox
and Shard Connect handlers for caller-owned router registration. It has no
listener, Admin, health, configuration, or process lifecycle ownership.

```ts
import { createRouterTransport } from "@connectrpc/connect";
import { InboxService, ShardService } from "@spine-ts/proto/delivery-server";
import { createInMemoryDeliveryServerCore } from "@spine-ts/delivery-server";

const core = createInMemoryDeliveryServerCore({ processingTimeoutMs: 30_000 });
const transport = createRouterTransport((router) => {
  router.service(InboxService, core.inbox);
  router.service(ShardService, core.shards);
});
```

`createRouterTransport()` is useful for in-process registration and tests. A
deployment may register the same handlers with its own Connect router, but the
caller owns the HTTP/2 listener and its startup and shutdown.

State is process-local and is intentionally lost when a new core is created.
Inbox pages are strict (`when_received > since_when`), ordered by full wire
timestamp, version, and UUID, and have a page size from 1 through 1000.
Mutations share a FIFO admission boundary with exactly 100 pending-operation
slots. An abort before admission commits nothing. Admission is the
linearization point: after it, the synchronous mutation commits even when the
caller aborts or the response is lost.

`processingTimeoutMs` is measured in milliseconds. Automatic pickup takeover
uses strict `elapsed > processingTimeoutMs`; zero disables it. Manual expiration
uses inclusive `elapsed >= inactivityPeriod`. Explicit release is
worker-agnostic, so deploy this unauthenticated core only on a trusted network.

## Standalone listener

`DeliveryServer` owns a cleartext HTTP/2 listener with Inbox, Shard, Admin, and
gRPC health services. Its default bind is local-only (`127.0.0.1:8484`):

```ts
import { DeliveryServer } from "@spine-ts/delivery-server";

const server = new DeliveryServer({ port: 0 });
await server.start();
console.log(server.baseUrl);
await server.close();
```

Options override environment values, which override the defaults. Configuration is
read once during construction.

| Option                     | Environment                | Default           |
| -------------------------- | -------------------------- | ----------------- |
| `host`                     | `HOST`                     | `127.0.0.1`       |
| `port`                     | `PORT`                     | `8484`            |
| `maxInboundMessageBytes`   | `MAX_INBOUND_MESSAGE_SIZE` | `4194304` bytes   |
| `processingTimeoutSeconds` | `SHARD_PROCESSING_TIMEOUT` | `0` seconds (off) |

Run `spine-delivery-server` to use the same listener with environment
configuration. An explicit non-loopback host is an unauthenticated cleartext
trusted-network deployment; it must not be exposed to the public Internet.
For example, `HOST=10.0.0.5 spine-delivery-server` binds the configured
trusted-network address and reports `http://10.0.0.5:<port>` after startup.
The executable reports its configured URL only after it is listening and handles
`SIGINT` and `SIGTERM` through the same one-shot shutdown. Embedded callers own
their own process signal policy and should call `close()` themselves. Shutdown is
terminal: it first becomes non-serving, rejects not-yet-admitted mutations,
completes Admin subscriptions, and then closes the listener and its HTTP/2
sessions. State is process-local and lost when the process stops.

This package intentionally provides no durable recovery, Redis/Hazelcast mode,
clustering, TLS, authentication/authorization, public-Internet hardening, CLI
flags, dynamic configuration reload, health `Watch`, administration UI, or live
TypeScript/JVM execution. The bounded Admin stream is machine-facing only.
