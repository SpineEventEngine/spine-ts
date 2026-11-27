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

import {
  InboxService,
  ManagedShardService,
  ShardService,
  type DeliveryShardPickupOutcome,
} from "@spine-event-engine/proto/delivery-server";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";
import { DeliveryBuilder, ShardIndex, type InboxMessage } from "@spine-event-engine/server";
import { InMemoryDelivery } from "@spine-event-engine/delivery-server";
import { DeliveryClient, DeliveryOutcomeUnknownError, RemoteWorkRegistry } from "../src/index.js";
import { RemoteInbox } from "../src/remote/adapters.js";
import { domainMessage } from "./shared-fixtures.js";

describe("in-memory delivery core response loss", () => {
  it("preserves the server deadline when acknowledgement is repeated", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
      }),
    );
    const inbox = new RemoteInbox(client);
    const pending = domainMessage("completion-wire");
    let now = 120_000;
    const previous = Time.setProvider({
      currentTime: () => timestampFromDate(new Date(now)),
    });
    try {
      const received = await inbox.receive(pending);
      expect((await client.findOne(received.id))?.keepUntil).toBeUndefined();
      const registry = new RemoteWorkRegistry(client);
      const session = await registry.pickUp(
        ShardIndex.single(),
        create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" }),
      );
      const read = await client.findOne(received.id);
      if (session === undefined || read === undefined) throw new Error("Expected a live read.");
      const completed = await inbox.markDelivered(read, undefined, session);
      expect(completed?.keepUntil).toEqual(new Date(125_000));
      expect((await client.findOne(received.id))?.keepUntil).toEqual(new Date(125_000));

      now = 130_000;
      expect(await inbox.markDelivered(read, undefined, session)).toEqual(completed);
      expect((await client.findOne(received.id))?.keepUntil).toEqual(new Date(125_000));
    } finally {
      Time.setProvider(previous);
    }
  });

  it("removes a retained duplicate through shared delivery policy and the remote adapter", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
      }),
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
    await client.writeOne({ ...retained, status: "DELIVERED" });
    await client.writeOne(duplicate);
    const shard = ShardIndex.single();
    const onMessage = vi.fn();
    const delivery = new DeliveryBuilder()
      .withContext({ name: "RemoteRetainedDuplicate", multitenant: false })
      .withStorageFactory({} as never)
      .withInbox(inbox)
      .withWorkRegistry(new RemoteWorkRegistry(client))
      .build();

    await expect(delivery.run({ shard, onMessage })).resolves.toEqual({ status: "COMPLETED" });
    expect(onMessage).not.toHaveBeenCalled();
    await expect(client.findOne(duplicate.id)).resolves.toBeUndefined();
  });

  it("delivers after cleaning an expired retained identity through the remote adapter", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
      }),
    );
    const inbox = new RemoteInbox(client);
    const expired = {
      ...domainMessage("expired"),
      keepUntil: new Date(Date.now() - 60_000),
    };
    const pending = { ...domainMessage("pending"), signalId: expired.signalId };
    await client.writeOne({ ...expired, status: "DELIVERED" });
    await client.writeOne(pending);
    expect((await client.findOne(expired.id))?.keepUntil?.getTime()).toBeLessThan(Date.now());
    const shard = ShardIndex.single();
    const onMessage = vi.fn();
    const delivery = new DeliveryBuilder()
      .withContext({ name: "RemoteExpiredRetained", multitenant: false })
      .withStorageFactory({} as never)
      .withInbox(inbox)
      .withWorkRegistry(new RemoteWorkRegistry(client))
      .build();

    await expect(delivery.run({ shard, onMessage })).resolves.toEqual({ status: "COMPLETED" });
    expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({ id: pending.id }));
    await expect(client.findOne(expired.id)).resolves.toBeUndefined();
  });

  it("continues after removing a duplicate at the end of a full remote page", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
      }),
    );
    const inbox = new RemoteInbox(client);
    const first = {
      ...domainMessage("first-duplicate-source"),
      signalId: "shared-signal",
      keepUntil: new Date(Date.now() + 60_000),
    };
    const duplicate = {
      ...domainMessage("duplicate-cursor"),
      signalId: first.signalId,
      whenReceived: timestampFromDate(new Date(2_000)),
    };
    const later = {
      ...domainMessage("after-duplicate"),
      signalId: "other-signal",
      whenReceived: timestampFromDate(new Date(2_000)),
    };
    await client.writeOne(first);
    await client.writeOne(duplicate);
    await client.writeOne(later);
    const shard = ShardIndex.single();
    const onMessage = vi.fn((message: InboxMessage) => {
      void message;
    });
    const delivery = new DeliveryBuilder()
      .withContext({ name: "DuplicateRemoteCursor", multitenant: false })
      .withStorageFactory({} as never)
      .withInbox(inbox)
      .withWorkRegistry(new RemoteWorkRegistry(client))
      .withPageSize(2)
      .build();

    await expect(delivery.run({ shard, onMessage })).resolves.toEqual({ status: "COMPLETED" });
    expect(onMessage.mock.calls.map(([message]) => message.id.value)).toEqual([
      "first-duplicate-source",
      "after-duplicate",
    ]);
    await expect(client.findOne(duplicate.id)).resolves.toBeUndefined();
  });

  it("recognizes a delivered acknowledgement committed before a lost response", async () => {
    const core = InMemoryDelivery.create();
    const normal = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
      }),
    );
    const pending = domainMessage("lost-delivered");
    await normal.writeOne(pending);
    let acknowledgements = 0;
    const lostClient = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, {
          ...core.managed,
          markDelivered: async (request, context) => {
            acknowledgements += 1;
            const result = await core.managed.markDelivered(request, context);
            if (acknowledgements === 1) throw new ConnectError("lost", Code.Unavailable);
            return result;
          },
        });
      }),
    );
    const registry = new RemoteWorkRegistry(lostClient);
    const session = await registry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" }),
    );
    const read = await lostClient.findOne(pending.id);
    if (session === undefined || read === undefined) throw new Error("Expected a live read.");
    const lost = new RemoteInbox(lostClient);
    await expect(lost.markDelivered(read, undefined, session)).rejects.toMatchObject({
      operation: "ACKNOWLEDGE",
      reconciliation: { kind: "FIND_MESSAGE", messageIds: ["0/1:lost-delivered"] },
    });
    await expect(lost.markDelivered(read, undefined, session)).resolves.toMatchObject({
      status: "DELIVERED",
    });
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
    const initial = createRouterTransport((router) => {
      router.service(InboxService, core.inbox);
    });
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

  it("recovers the same managed session after the first pickup reply is lost", async () => {
    const core = InMemoryDelivery.create();
    let pickups = 0;
    let firstSessionId: string | undefined;
    const transport = createRouterTransport((router) => {
      router.service(InboxService, core.inbox);
      router.service(ManagedShardService, {
        ...core.managed,
        pickShardForDelivery: async (request, context) => {
          pickups += 1;
          const result = await core.managed.pickShardForDelivery(request, context);
          if (pickups === 1) {
            const outcome = result as DeliveryShardPickupOutcome;
            if (outcome.result.case === "pickedUp") firstSessionId = outcome.result.value.sessionId;
            throw new ConnectError("lost", Code.Unavailable);
          }
          return result;
        },
      });
    });
    const client = DeliveryClient.usingTransport(transport);
    await client.writeOne(domainMessage("lost-pickup"));
    const registry = new RemoteWorkRegistry(client);
    const session = await registry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker-1" }),
    );
    expect(session).toMatchObject({ kind: "EXCLUSIVE" });
    expect(pickups).toBe(2);
    const recovered = await client.pickUpForDelivery(ShardIndex.single(), {
      nodeId: "node",
      value: "worker-1",
    });
    expect(recovered.kind).toBe("PICKED");
    if (recovered.kind === "PICKED") expect(recovered.session.sessionId).toBe(firstSessionId);
  });

  it("proves a lost release committed through a direct subsequent pickup", async () => {
    const core = InMemoryDelivery.create();
    const normal = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(ShardService, core.shards);
        router.service(ManagedShardService, core.managed);
      }),
    );
    const session = await normal.pickUp(ShardIndex.single(), { nodeId: "node", value: "worker" });
    if (session === undefined) throw new Error("Expected pickup.");
    const lost = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(ManagedShardService, {
          ...core.managed,
          releaseShardSession: async (request, context) => {
            await core.managed.releaseShardSession(request, context);
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
    const core = InMemoryDelivery.create({ now: () => timestampFromDate(new Date(now)) });
    const normal = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(ShardService, core.shards);
        router.service(ManagedShardService, core.managed);
      }),
    );
    await normal.pickUp(ShardIndex.single(), { nodeId: "node", value: "worker" });
    now = 11;
    const lost = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(ManagedShardService, core.managed);
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

  it("releases every inactive session in a large shard group through the public client", async () => {
    let now = 0;
    const ofTotal = 1_201;
    const core = InMemoryDelivery.create({ now: () => timestampFromDate(new Date(now)) });
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(ShardService, core.shards);
        router.service(ManagedShardService, core.managed);
      }),
    );
    try {
      for (let index = 0; index < ofTotal; index++) {
        await client.pickUp(new ShardIndex(index, ofTotal), {
          nodeId: "node",
          value: `worker-${String(index)}`,
        });
      }
      now = 1;
      const released = await client.releaseExpired(1);
      expect(new Set(released.map(({ shard }) => shard.index)).size).toBe(ofTotal);
      await expect(client.releaseExpired(1)).resolves.toEqual([]);
    } finally {
      client.close();
      core.close();
    }
  });

  it("classifies a post-commit transport size rejection as unknown", async () => {
    let now = 0;
    const core = InMemoryDelivery.create({ now: () => timestampFromDate(new Date(now)) });
    const normal = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(ShardService, core.shards);
        router.service(ManagedShardService, core.managed);
      }),
    );
    await normal.pickUp(ShardIndex.single(), { nodeId: "node", value: "worker" });
    now = 1;
    const oversized = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(ManagedShardService, core.managed);
        router.service(ShardService, {
          ...core.shards,
          releaseSessions: async (request, context) => {
            await core.shards.releaseSessions(request, context);
            throw new ConnectError("Configured response size exceeded", Code.ResourceExhausted);
          },
        });
      }),
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
