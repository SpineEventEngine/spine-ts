/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it, vi } from "vitest";

import { InboxService, ShardService } from "@spine-event-engine/proto/delivery-server";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { create } from "@bufbuild/protobuf";
import { DeliveryBuilder, ShardIndex } from "@spine-event-engine/server";
import { InMemoryDelivery } from "@spine-event-engine/delivery-server";
import { DeliveryClient, DeliveryOutcomeUnknownError, RemoteWorkRegistry } from "../src/index.js";
import { RemoteInbox } from "../src/remote/adapters.js";
import { domainMessage } from "./shared-fixtures.js";

describe("in-memory delivery core response loss", () => {
  it("removes a retained duplicate through shared delivery policy and the remote adapter", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => router.service(InboxService, core.inbox)),
    );
    const inbox = new RemoteInbox(client);
    const retained = {
      ...domainMessage("retained"),
      keepUntil: new Date(Date.now() + 60_000),
    };
    const duplicate = {
      ...domainMessage("duplicate"),
      signalId: retained.signalId,
      keepUntil: retained.keepUntil,
    };

    await client.writeOne(retained);
    await expect(inbox.markDelivered(retained)).resolves.toMatchObject({ status: "DELIVERED" });
    await client.writeOne(duplicate);
    const shard = ShardIndex.single();
    const session = { kind: "EXCLUSIVE" as const, shard };
    const onMessage = vi.fn();
    const delivery = new DeliveryBuilder()
      .withContext({ name: "RemoteRetainedDuplicate", multitenant: false })
      .withStorageFactory({} as never)
      .withInbox(inbox)
      .withWorkRegistry({
        sessionKind: "EXCLUSIVE",
        pickUp: () => Promise.resolve(session),
        validateOwnership: () => Promise.resolve(session),
        release: () => Promise.resolve(true),
      })
      .build();

    await expect(delivery.run({ shard, onMessage })).resolves.toEqual({ status: "COMPLETED" });
    expect(onMessage).not.toHaveBeenCalled();
    await expect(client.findOne(duplicate.id)).resolves.toBeUndefined();
  });

  it("delivers after cleaning an expired retained identity through the remote adapter", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => router.service(InboxService, core.inbox)),
    );
    const inbox = new RemoteInbox(client);
    const expired = {
      ...domainMessage("expired"),
      keepUntil: new Date(Date.now() - 60_000),
    };
    const pending = { ...domainMessage("pending"), signalId: expired.signalId };
    await client.writeOne(expired);
    await expect(inbox.markDelivered(expired)).resolves.toMatchObject({ status: "DELIVERED" });
    await client.writeOne(pending);
    expect((await client.findOne(expired.id))?.keepUntil?.getTime()).toBeLessThan(Date.now());
    const shard = ShardIndex.single();
    const session = { kind: "EXCLUSIVE" as const, shard };
    const onMessage = vi.fn();
    const delivery = new DeliveryBuilder()
      .withContext({ name: "RemoteExpiredRetained", multitenant: false })
      .withStorageFactory({} as never)
      .withInbox(inbox)
      .withWorkRegistry({
        sessionKind: "EXCLUSIVE",
        pickUp: () => Promise.resolve(session),
        validateOwnership: () => Promise.resolve(session),
        release: () => Promise.resolve(true),
      })
      .build();

    await expect(delivery.run({ shard, onMessage })).resolves.toEqual({ status: "COMPLETED" });
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: pending.id }));
    await expect(client.findOne(expired.id)).resolves.toBeUndefined();
  });

  it("recognizes a delivered acknowledgement committed before a lost response", async () => {
    const core = InMemoryDelivery.create();
    const normal = DeliveryClient.usingTransport(
      createRouterTransport((router) => router.service(InboxService, core.inbox)),
    );
    const pending = domainMessage("lost-delivered");
    await normal.writeOne(pending);
    const lost = new RemoteInbox(
      DeliveryClient.usingTransport(
        createRouterTransport((router) => {
          router.service(InboxService, {
            ...core.inbox,
            writeOne: async (request, context) => {
              await core.inbox.writeOne(request, context);
              throw new ConnectError("lost", Code.Unavailable);
            },
          });
        }),
      ),
    );

    await expect(lost.markDelivered(pending)).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    await expect(lost.markDelivered(pending)).resolves.toMatchObject({ status: "DELIVERED" });
  });

  it("makes a committed write reconcilable after its response is lost", async () => {
    const core = InMemoryDelivery.create();
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
    const core = InMemoryDelivery.create();
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

  it("retains no client-side marker after a lost pickup outcome", async () => {
    const core = InMemoryDelivery.create();
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
    await expect(
      registry.pickUp(
        ShardIndex.single(),
        create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker-1" }),
      ),
    ).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    await expect(
      registry.pickUp(
        ShardIndex.single(),
        create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker-2" }),
      ),
    ).rejects.toBeInstanceOf(DeliveryOutcomeUnknownError);
    expect(pickups).toBe(2);
  });

  it("proves a lost release committed through a direct subsequent pickup", async () => {
    const core = InMemoryDelivery.create();
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
    const core = InMemoryDelivery.create({ now: () => now });
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
    const core = InMemoryDelivery.create({ now: () => now });
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
    const core = InMemoryDelivery.create({ now: () => now });
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
