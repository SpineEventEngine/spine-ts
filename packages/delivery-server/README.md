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

State is lost on process restart. Admin observation, health, configuration,
CLI/environment parsing, listener creation, and process lifecycle belong to
T-0065 and are intentionally absent here.
