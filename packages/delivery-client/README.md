# Client for the Spine Delivery server

Use this Node client when an application node must coordinate delivery work with
a Delivery server on a trusted network. Start with the local server while
developing; use the same client to connect separate application nodes to a
remote Delivery server.

The [reference](REFERENCE.md) records the complete protocol, retry, and limit
contract, including API detail for coding agents.

This is an experimental snapshot package. Use Node 24 or newer and a reachable
Delivery server on a trusted network.

```sh
pnpm add @spine-event-engine/delivery-client@snapshot
```

## 💡 Why use it?

- ✅ Connects a Node process to a local or remote Delivery server.
- ✅ Reads inbox work and current shard assignments.
- ✅ Observes later shard changes without polling.
- ✅ Adapts remote inbox and shard services to `DeliveryBuilder`.

## 🚀 Connect and read

Connect to an absolute HTTP(S) origin whose path is `/`. The client manages this
connection and `close()` ends its active reads and streams.

<!-- docs-snippet-path: packages/delivery-client/src/client/client.ts -->

```ts
import { DeliveryClient } from "@spine-event-engine/delivery-client";

const client = DeliveryClient.connectTo("http://127.0.0.1:8484", { pageSize: 100 });
const shards = await client.shardSnapshot();
client.close();
void shards;
```

Read operations can use the configured retry policy. If a managed pickup reply
is lost, `pickUpForDelivery()` retries with the same worker and run ID within
the original deadline. For a lost inbox write reply, read the affected row to
learn whether the write succeeded before deciding what to do next.
Inbox receipts and `sinceWhen` page anchors use Protobuf `Timestamp` values,
preserving seconds and nanoseconds. `readPage` calls the JVM
`InboxService.FindManyInShard` RPC with an exclusive timestamp bound.

<!-- docs-snippet-path: packages/delivery-client/src/client/client.ts -->

```ts
import { DeliveryOutcomeUnknownError } from "@spine-event-engine/delivery-client";

try {
  // await client.writeOne(message);
} catch (error) {
  if (error instanceof DeliveryOutcomeUnknownError) {
    // Read the fact named by error.reconciliation; do not repeat the mutation.
  }
}
```

## Shards with pending work

Open `observeAvailableShards()` to receive a shard index whenever the Delivery
server has a free shard with pending work. A newly connected client also learns
about work already waiting. An idle call can stay silent indefinitely.

<!-- docs-snippet-path: packages/delivery-client/src/client/client.ts -->

```ts
import { DeliveryClient } from "@spine-event-engine/delivery-client";

declare const client: DeliveryClient;
declare const shutdown: AbortSignal;

for await (const shard of client.observeAvailableShards({ signal: shutdown })) {
  console.log("Work is waiting in shard", shard.index, "of", shard.ofTotal);
}
```

This low-level call opens one stream. Starting a fresh call after a disconnect
discovers the free shards again. Several clients can receive the same index, so
a worker must still request pickup before processing a row.

## 👀 Shard state for Admin

For a live Admin view, read updates as soon as the stream opens. It sends
the known shards first and keeps sending changes. For a one-time report,
use `shardSnapshot()` separately. The stream reads at the pace of its consumer.

<!-- docs-snippet-path: packages/delivery-client/src/client/client.ts -->

```ts
import { DeliveryClient, type RemoteShardObservation } from "@spine-event-engine/delivery-client";

declare const client: DeliveryClient;
declare const shutdown: AbortSignal;
declare function showLive(rows: ReadonlyMap<string, RemoteShardObservation>, stale: boolean): void;

async function showAdmin(): Promise<void> {
  const live = new Map<string, RemoteShardObservation>();
  showLive(live, true);
  const updates = client.observeShardUpdates({ signal: shutdown, timeoutMs: 5_000 });
  try {
    for await (const update of updates) {
      const key = `${update.shard.index}/${update.shard.ofTotal}`;
      live.set(key, update);
      showLive(live, false);
    }
  } catch (error) {
    showLive(live, true);
    throw error;
  } finally {
    updates.cancel();
  }
}

void showAdmin();
```

Call `showAdmin()` again after a failure to build a fresh live view. The client
defaults to no hidden Admin reconnects, so a failed stream reaches the caller.
Here `timeoutMs` bounds setup through the first acknowledgement only; it never
ends an acknowledged observation stream. Keep the snapshot and live view
separate so a slower snapshot response cannot overwrite a newer live update.

`RemoteInbox` and `RemoteWorkRegistry` adapt a client to a server
`DeliveryBuilder`. The authoritative delivery state is the remote Inbox row and
the current shard lease; the client keeps no local removal record. A delivered
row is the deduplication fact, but a handler effect and its acknowledgement are
not one transaction. If an acknowledgement is lost, delivery can happen again
after restart, so make downstream effects idempotent.
Remote delivery reads bounded raw pages. The shared server delivery policy
removes a pending duplicate when its signal ID and typed Inbox target match a
delivered row in that page or a recent delivery during the five-second local deduplication
window. A different target or a newly generated signal ID remains independently
deliverable, even when its payload is equal.

Remote reception writes a pending row without a completion deadline. When the
worker acknowledges it, the Delivery server checks the session and row together
and records a deadline five seconds after that acknowledgement. A matching
repeat preserves the first deadline.

<!-- docs-snippet-path: packages/delivery-client/src/remote/adapters.ts -->

```ts
import {
  DeliveryClient,
  RemoteInbox,
  RemoteWorkRegistry,
} from "@spine-event-engine/delivery-client";
import { DeliveryBuilder } from "@spine-event-engine/server";
import type { StorageFactory } from "@spine-event-engine/storage";

declare const storageFactory: StorageFactory;
const client = DeliveryClient.connectTo("http://127.0.0.1:8484");
const delivery = new DeliveryBuilder()
  .withStorageFactory(storageFactory)
  .withNode("orders-worker")
  .withInbox(new RemoteInbox(client))
  .withWorkRegistry(new RemoteWorkRegistry(client))
  .build();
// When the worker has finished using delivery, close its connection.
client.close();
void delivery;
```

For server assembly, install a remote facility in `ServerEnvironment`. The built-in mode opens `ShardObservingService.ObserveAll` after the application is ready. The stream can stay silent when no shard is available; startup does not wait for its first notice. A new or reconnected node receives a scan of currently free shards with pending rows. The server repeats an unclaimed notice after its configured interval, 10 seconds by default. A further write does not postpone that reminder. Admin snapshots remain available for diagnostics, but Admin updates do not initiate application delivery.

<!-- docs-snippet-path: packages/delivery-client/src/remote/delivery-builder.ts -->

```ts
import { DeliveryBuilder } from "@spine-event-engine/delivery-client";

const delivery = DeliveryBuilder.remote({
  endpoint: "https://delivery.example.test",
  notifications: { kind: "delivery-server", maxConcurrentDeliveries: 2 },
});
void delivery;
```

With no `maxConcurrentDeliveries`, this node can run distinct shards in parallel. Two calls to `environment.delivery.deliverMessagesFrom(shard)` for the same shard join one local attempt and receive its result. Other nodes can try the same shard, but only one current server session can handle it. Notices are advisory: a node can miss one during a disconnect, and reconnect discovery or the server reminder can offer the work again. The Inbox row and session determine whether processing may proceed.

If your application uses an external message queue to notify its nodes, select `notifications: { kind: "custom", shardObserver }`. The observer's `onMessage(message)` receives the complete persisted Inbox row after a write or normal release and may publish its shard to the queue. In this mode the framework opens no `ObserveAll` stream and schedules no fallback attempt if the callback fails. The consumer you register with that queue calls `environment.delivery.deliverMessagesFrom(shard)`. For shared application storage, `DeliveryBuilder.local({ storageFactory, shardObserver })` supplies the same hook; use one shared factory for application and delivery records. A failed observer callback is logged without reversing the write. The application decides how to recover missed queue notifications.

## ⚠️ Design for redelivery

A session renewal permits the worker to continue processing its shard.
If a connection fails after a handler saves its result but before the inbox row
is acknowledged, another worker may invoke that handler again. Keep this case
in mind when a handler calls an external service.

## 🔗 Learn more

- [Delivery server](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/delivery-server/README.md)
- [Server delivery APIs](https://github.com/SpineEventEngine/spine-ts/blob/master/packages/server/README.md#native-lifecycle-and-routing)
- [Detailed delivery reference](REFERENCE.md)
