import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { InboxService, ShardService } from "@spine-ts/proto/delivery-server";
import { ShardIndex } from "@spine-ts/server";
import { createInMemoryDeliveryServerCore } from "../../delivery-server/src/index.js";
import { DeliveryClient, DeliveryOutcomeUnknownError, RemoteWorkRegistry } from "../src/index.js";
import { domainMessage } from "./shared-fixtures.js";

describe("in-memory delivery core response loss", () => {
  it("makes a committed write reconcilable after its response is lost", async () => {
    const core = createInMemoryDeliveryServerCore();
    const transport = createRouterTransport((router) => {
      router.service(InboxService, {
        ...core.inbox,
        writeOne: async (request, context) => {
          await core.inbox.writeOne(request, context);
          throw new ConnectError("lost", Code.Unavailable);
        },
      });
    });
    const client = DeliveryClient.usingTransport(transport);
    const message = domainMessage();
    await expect(client.writeOne(message)).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    await expect(client.findOne(message.id)).resolves.toMatchObject({ id: message.id });
  });

  it("makes a committed removal observable after its response is lost", async () => {
    const core = createInMemoryDeliveryServerCore();
    const initial = createRouterTransport((router) => router.service(InboxService, core.inbox));
    const message = domainMessage("remove");
    await DeliveryClient.usingTransport(initial).writeOne(message);
    const transport = createRouterTransport((router) => {
      router.service(InboxService, {
        ...core.inbox,
        removeOne: async (request, context) => {
          await core.inbox.removeOne(request, context);
          throw new ConnectError("lost", Code.Unavailable);
        },
      });
    });
    const client = DeliveryClient.usingTransport(transport);
    await expect(client.removeOne(message)).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    await expect(client.findOne(message.id)).resolves.toBeUndefined();
  });

  it("quarantines a lost pickup outcome without issuing another pickup", async () => {
    const core = createInMemoryDeliveryServerCore();
    let pickups = 0;
    const transport = createRouterTransport((router) => {
      router.service(ShardService, {
        ...core.shards,
        pickShard: async (request, context) => {
          pickups += 1;
          await core.shards.pickShard(request, context);
          throw new ConnectError("lost", Code.Unavailable);
        },
      });
    });
    const registry = new RemoteWorkRegistry(DeliveryClient.usingTransport(transport));
    await expect(registry.pickUp(ShardIndex.single(), "node")).rejects.toBeInstanceOf(
      DeliveryOutcomeUnknownError,
    );
    await expect(registry.pickUp(ShardIndex.single(), "node")).resolves.toBeUndefined();
    expect(pickups).toBe(1);
  });

  it("proves a lost release committed through a direct subsequent pickup", async () => {
    const core = createInMemoryDeliveryServerCore();
    const normal = DeliveryClient.usingTransport(
      createRouterTransport((router) => router.service(ShardService, core.shards)),
    );
    const session = await normal.pickUp(ShardIndex.single(), { nodeId: "node", value: "worker" });
    if (session === undefined) throw new Error("Expected pickup.");
    const lost = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(ShardService, {
          ...core.shards,
          releaseSession: async (request, context) => {
            await core.shards.releaseSession(request, context);
            throw new ConnectError("lost", Code.Unavailable);
          },
        });
      }),
    );
    await expect(lost.release(session)).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    await expect(
      normal.pickUp(ShardIndex.single(), { nodeId: "node", value: "next" }),
    ).resolves.toBeDefined();
  });

  it("proves a lost expiration release committed through a direct pickup", async () => {
    let now = 10;
    const core = createInMemoryDeliveryServerCore({ now: () => now });
    const normal = DeliveryClient.usingTransport(
      createRouterTransport((router) => router.service(ShardService, core.shards)),
    );
    await normal.pickUp(ShardIndex.single(), { nodeId: "node", value: "worker" });
    now = 11;
    const lost = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(ShardService, {
          ...core.shards,
          releaseSessions: async (request, context) => {
            await core.shards.releaseSessions(request, context);
            throw new ConnectError("lost", Code.Unavailable);
          },
        });
      }),
    );
    await expect(lost.releaseExpired(1)).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    await expect(
      normal.pickUp(ShardIndex.single(), { nodeId: "node", value: "next" }),
    ).resolves.toBeDefined();
  });

  it("observes 101 committed expired shard sessions", async () => {
    let now = 0;
    const core = createInMemoryDeliveryServerCore({ now: () => now });
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => router.service(ShardService, core.shards)),
    );
    for (let index = 0; index < 101; index += 1) {
      await client.pickUp(new ShardIndex(index, 101), {
        nodeId: "node",
        value: `worker-${String(index)}`,
      });
    }
    now = 1;
    await expect(client.releaseExpired(1)).resolves.toHaveLength(101);
  });

  it("classifies an oversized post-commit expiration response as unknown", async () => {
    let now = 0;
    const core = createInMemoryDeliveryServerCore({ now: () => now });
    const normal = DeliveryClient.usingTransport(
      createRouterTransport((router) => router.service(ShardService, core.shards)),
    );
    await normal.pickUp(ShardIndex.single(), { nodeId: "node", value: "worker" });
    now = 1;
    const oversized = DeliveryClient.usingTransport(
      createRouterTransport((router) =>
        router.service(ShardService, {
          ...core.shards,
          releaseSessions: async (request, context) => {
            const response = await core.shards.releaseSessions(request, context);
            const first = response.shard?.[0];
            if (first?.worker !== undefined) first.worker.value = "x".repeat(4_200_000);
            return response;
          },
        }),
      ),
    );
    await expect(oversized.releaseExpired(1)).rejects.toMatchObject({
      operation: "RELEASE_EXPIRED",
      reconciliation: { kind: "OBSERVE_SHARD", scope: "ALL_SHARDS" },
    });
    await expect(
      normal.pickUp(ShardIndex.single(), { nodeId: "node", value: "next" }),
    ).resolves.toBeDefined();
  });
});
