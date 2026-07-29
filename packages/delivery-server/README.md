# @spine-event-engine/delivery-server

`InMemoryDelivery.create()` provides the in-memory simple-server Inbox
and Shard handlers for caller-owned router registration. This low-level core
has no listener, Admin, health, configuration, or process lifecycle ownership;
the same package also exports the standalone `DeliveryServer` described below.

```ts
import { createRouterTransport } from "@connectrpc/connect";
import { InboxService, ShardService } from "@spine-event-engine/proto/delivery-server";
import { InMemoryDelivery } from "@spine-event-engine/delivery-server";

const core = InMemoryDelivery.create({
  processingTimeoutMs: 30_000,
  maxRetainedMessages: 10_000,
  maxRetainedBytes: 32 * 1024 * 1024,
  maxTrackedShards: 1_000,
});
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
`maxRetainedMessages` and `maxRetainedBytes` accept integers from 1 through
2,147,483,647; `maxTrackedShards` accepts 1 through 1,000. Invalid core options
fail synchronously. Mutations share a FIFO admission boundary with exactly 100 pending-operation
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
import { DeliveryServer } from "@spine-event-engine/delivery-server";

const server = new DeliveryServer({ port: 0 });
await server.start();
console.log(server.baseUrl);
await server.close();
```

Options override environment values, which override the defaults. Configuration is
read once during construction.

| Option                     | Environment                | Default           | Accepted range          |
| -------------------------- | -------------------------- | ----------------- | ----------------------- |
| `host`                     | `HOST`                     | `127.0.0.1`       | non-blank string        |
| `port`                     | `PORT`                     | `8484`            | integer `0..65535`      |
| `maxInboundMessageBytes`   | `MAX_INBOUND_MESSAGE_SIZE` | `4194304` bytes   | integer `1..2147483647` |
| `processingTimeoutSeconds` | `SHARD_PROCESSING_TIMEOUT` | `0` seconds (off) | integer `0..2147483647` |
| `maxRetainedMessages`      | `MAX_RETAINED_MESSAGES`    | `10000`           | integer `1..2147483647` |
| `maxRetainedBytes`         | `MAX_RETAINED_BYTES`       | `33554432` bytes  | integer `1..2147483647` |
| `maxTrackedShards`         | `MAX_TRACKED_SHARDS`       | `1000`            | integer `1..1000`       |

Invalid explicit or environment values fail synchronously in the
`DeliveryServer` constructor, before a listener is created.

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

Inbox admission is atomic: a single message or the complete batch is rejected
with `RESOURCE_EXHAUSTED` before mutation if the finite retained-message,
serialized-byte, or tracked-shard budget would be exceeded. Write and remove
batches contain 1 through 100 messages; every persisted record must be a
canonical client-decodable Command or Event payload (at most 1 MiB) and its
full encoded record must fit the 4 MiB RPC boundary. A requested Inbox page
that exceeds 4 MiB fails with `RESOURCE_EXHAUSTED`; request a smaller page size.
It is never silently shortened. Admin snapshots and one expiration response
contain at most 1,000 shard observations, below the 4 MiB RPC ceiling.
Worker and node IDs together are limited to 128 UTF-8 bytes so an expiration
response remains within that ceiling too.

The machine-facing Admin service first acknowledges an observation, then streams
shard updates through a bounded queue. Health `Check` serves the registered
service names while the listener is serving and returns `NOT_SERVING` for an
unknown name; health `Watch` is intentionally unimplemented.

This package intentionally provides no durable recovery, Redis/Hazelcast mode,
clustering, TLS, authentication/authorization, public-Internet hardening, CLI
flags, dynamic configuration reload, health `Watch`, administration UI, or live
TypeScript/JVM execution. The bounded Admin stream is machine-facing only.
