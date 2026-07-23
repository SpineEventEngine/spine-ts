# Delivery client

`@spine-ts/delivery-client` is the Node facade for the frozen JVM delivery-server
gRPC API. It is for trusted networks only: it adds no authentication or
authorization. JVM live-server compatibility testing is deferred to Wave 3.

```ts
import { DeliveryClient } from "@spine-ts/delivery-client";
import { ShardIndex } from "@spine-ts/server";

const client = DeliveryClient.connectTo("http://127.0.0.1:8080", {
  pageSize: 100,
  readRetries: 1,
  retryBackoffMs: 25,
});
const message = await client.findOne({ value: "message-id", shard: ShardIndex.single() });
client.close();
```

`connectTo()` accepts only an absolute HTTP(S) origin whose pathname is `/`, validates its
options before it creates a client-owned HTTP/2
gRPC session. `usingTransport()` is the advanced seam for a caller-owned Connect
`Transport`; closing that client never closes the supplied transport. `close()`
is synchronous and idempotent: it immediately aborts active reads and streams;
an owned HTTP/2 session is aborted once.

Options default to `pageSize: 100`, zero read retries/backoff and observation
reconnect/backoff, and an observation buffer of 100. Page size is 1..1,000;
each retry/reconnect count is 0..5; both backoffs are 0..10,000 ms; the buffer
is 1..1,000 for both queued updates and pending `next()` calls. Per-operation
`timeoutMs` is 1..120,000 ms (30,000 default).

`findOne(id)`, `readPage(shard, { sinceWhen, pageSize })`,
`newestPending(shard)`, and `shardSnapshot()` are safe reads and
may use configured bounded retries. `writeOne`, `writeMany`, `removeOne`,
`removeMany`, `pickUp`, `release`, and `releaseExpired` are single-attempt
mutations. A lost mutation response raises `DeliveryOutcomeUnknownError`:
reconcile writes/removals with `FIND_MESSAGE`, and shard changes with
`OBSERVE_SHARD`; never blindly retry a mutation. All calls accept cancellation
and a bounded deadline.

```ts
import type { InboxMessage } from "@spine-ts/server";

const controller = new AbortController();
async function mutate(message: InboxMessage) {
  await client.writeOne(message, { timeoutMs: 5_000, signal: controller.signal });
  await client.removeOne(message, { timeoutMs: 5_000, signal: controller.signal });
}
const acquired = await client.pickUp(ShardIndex.single(), {
  nodeId: "worker-a",
  value: "worker-a",
});
if (acquired) await client.release(acquired);
await client.releaseExpired(60_000);
```

`RemoteInbox` and `RemoteWorkRegistry` adapt the facade to `DeliveryBuilder`. `RemoteInbox`
requires caller-owned durable, capacity-bounded `RemovalQuarantine` storage: it persists only
an exact ID, phase, and SHA-256 fingerprint before callback admission and before removal.
Recovered `REMOVING` work reconciles/removes without replaying a callback; recovered `ADMITTED`
work remains fail-closed for operator resolution.

```ts
import { DeliveryClient, RemoteInbox, RemoteWorkRegistry } from "@spine-ts/delivery-client";
import { DeliveryBuilder } from "@spine-ts/server";

const client = DeliveryClient.connectTo("http://127.0.0.1:8080");
// Implement this with a caller-owned durable store. It must be capacity-bounded
// and atomically persist only the compact records below; do not use an in-memory
// Map in production, because restart safety is part of the no-replay contract.
declare const durableStore: {
  get(
    id: string,
  ): Promise<{ id: string; phase: "ADMITTED" | "REMOVING"; fingerprint: string } | undefined>;
  putIfCapacityAvailable(
    id: string,
    record: { id: string; phase: "ADMITTED" | "REMOVING"; fingerprint: string },
  ): Promise<void>;
  delete(id: string): Promise<void>;
};
const removalQuarantine = {
  async get(id: string) {
    return durableStore.get(id);
  },
  async put(record: { id: string; phase: "ADMITTED" | "REMOVING"; fingerprint: string }) {
    await durableStore.putIfCapacityAvailable(record.id, record);
  },
  async delete(id: string) {
    await durableStore.delete(id);
  },
};
const delivery = new DeliveryBuilder()
  .withNode("worker-a")
  .withInbox(new RemoteInbox(client, removalQuarantine))
  .withWorkRegistry(new RemoteWorkRegistry(client))
  .build();
```

`readPage()` uses the frozen timestamp-only continuation. If a full timestamp
boundary cannot be continued without loss, it throws `DeliveryPagingError`.
Admin observation requires exactly one ACK, has a bounded buffer, and reconnects
only within configured limits; call `cancel()` when finished.

```ts
import { DeliveryClient } from "@spine-ts/delivery-client";

const client = DeliveryClient.connectTo("http://127.0.0.1:8080");
const snapshot = await client.shardSnapshot();
const updates = client.observeShardUpdates({ timeoutMs: 5_000 });
for await (const update of updates) {
  console.log(snapshot.length, update.shard, update.status);
  updates.cancel();
}
```

For an `OBSERVE_SHARD` reconciliation, call `shardSnapshot()` and pass the
matching observation to `RemoteWorkRegistry.reconcile()` before attempting a
later pickup; observing a shard is not a mutation retry. A `PICKED` observation
never clears uncertainty. Only `NOT_PICKED` invalidates stale local sessions and
permits a fresh pickup. The frozen remote protocol carries no renewable fence
and no worker-conditional release, so a later worker must not release a stale
session.

```ts
import { DeliveryClient, DeliveryOutcomeUnknownError } from "@spine-ts/delivery-client";
import { ShardIndex, type InboxMessage } from "@spine-ts/server";

const client = DeliveryClient.connectTo("http://127.0.0.1:8080");

async function reconcileUnknownWrite(message: InboxMessage) {
  try {
    await client.writeOne(message);
  } catch (error) {
    if (
      error instanceof DeliveryOutcomeUnknownError &&
      error.reconciliation.kind === "FIND_MESSAGE"
    ) {
      const observed = await Promise.all(
        error.reconciliation.messageIds.map((value) =>
          client.findOne({ value, shard: ShardIndex.single() }),
        ),
      );
      // Presence and absence are both reconciliation facts; neither retries the mutation.
      console.log(observed.some((value) => value !== undefined));
    }
  }
}
```

The client accepts decoded payloads only as Command or Event envelopes; any other
payload oneof raises `DeliveryProtocolError`. Results are detached snapshots: callers
may mutate returned `Date` and byte values, but those mutations cannot affect later
results, quarantine exact-snapshot checks, or internal state. It limits decoded payloads to
1 MiB and every serialized unary request/response to 4 MiB. Batches are limited
to 100 messages; pages are limited to 1,000 messages (100 by default).
