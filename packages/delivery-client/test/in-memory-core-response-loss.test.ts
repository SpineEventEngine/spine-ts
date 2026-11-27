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
  WriteMessageSchema,
  ManagedShardService,
  GuardedInboxService,
  ShardService,
  type DeliveryShardPickupOutcome,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageIdSchema,
  InboxMessageSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";
import { clone, create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { TimestampSchema, timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";
import { DeliveryBuilder, ShardIndex, type InboxMessage } from "@spine-event-engine/server";
import { InMemoryDelivery } from "@spine-event-engine/delivery-server";
import { DeliveryClient, DeliveryOutcomeUnknownError, RemoteWorkRegistry } from "../src/index.js";
import { RemoteInbox } from "../src/remote/adapters.js";
import { DeliveryMessageCodec } from "../src/wire/codec.js";
import { domainMessage } from "./shared-fixtures.js";

describe("in-memory delivery core response loss", () => {
  it("retains unknown wire fields and nanos across decoded guarded mutations", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
        router.service(GuardedInboxService, core.guarded);
      }),
    );
    const context = { signal: new AbortController().signal } as never;
    const inbox = new RemoteInbox(client);
    const pending = domainMessage("wire-retained");
    const wire = DeliveryMessageCodec.encode({
      ...pending,
      whenReceived: create(TimestampSchema, { seconds: 10n, nanos: 123_456_789 }),
    });
    const unknown = fromBinary(
      InboxMessageSchema,
      new Uint8Array([...toBinary(InboxMessageSchema, wire), 0x98, 0x06, 0x7b]),
    );
    await core.inbox.writeOne(create(WriteMessageSchema, { message: unknown }), context);
    const registry = new RemoteWorkRegistry(client);
    const session = await registry.pickUp(
      ShardIndex.single(),
      create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" }),
    );
    const read = await client.findOne(pending.id);
    if (session === undefined || read === undefined) throw new Error("Expected a live read.");
    expect(read.whenReceived.nanos).toBe(123_456_789);
    expect((await inbox.markDelivered(read, undefined, session))?.status).toBe("DELIVERED");
    const retained = (
      await core.inbox.findOne(
        create(InboxMessageIdSchema, {
          index: unknown.id?.index,
          uuid: unknown.id?.uuid ?? "",
        }),
        context,
      )
    ).message;
    expect(retained && create(InboxMessageSchema, retained).$unknown).toEqual(unknown.$unknown);

    const duplicate = DeliveryMessageCodec.encode(domainMessage("wire-duplicate"));
    await core.inbox.writeOne(create(WriteMessageSchema, { message: duplicate }), context);
    const readDuplicate = await client.findOne({
      value: "wire-duplicate",
      shard: ShardIndex.single(),
    });
    if (readDuplicate === undefined) throw new Error("Expected pending read.");
    const changedDuplicate = clone(InboxMessageSchema, duplicate);
    if (changedDuplicate.whenReceived === undefined) throw new Error("Expected receive time.");
    changedDuplicate.whenReceived.nanos += 1;
    await core.inbox.writeOne(create(WriteMessageSchema, { message: changedDuplicate }), context);
    expect(await inbox.removeDuplicate(readDuplicate, undefined, session)).toBe(false);

    const expired = DeliveryMessageCodec.encode({
      ...domainMessage("wire-expired"),
      status: "DELIVERED",
      keepUntil: new Date(0),
    });
    await core.inbox.writeOne(create(WriteMessageSchema, { message: expired }), context);
    const readExpired = await client.findOne({ value: "wire-expired", shard: ShardIndex.single() });
    if (readExpired === undefined) throw new Error("Expected delivered read.");
    const changedExpired = fromBinary(
      InboxMessageSchema,
      new Uint8Array([...toBinary(InboxMessageSchema, expired), 0x98, 0x06, 0x7b]),
    );
    await core.inbox.writeOne(create(WriteMessageSchema, { message: changedExpired }), context);
    expect(await inbox.removeDelivered(readExpired, undefined, session)).toBe(false);
    core.close();
  });

  it("persists an application-clock completion through the guarded Inbox service", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
        router.service(GuardedInboxService, core.guarded);
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
        router.service(GuardedInboxService, core.guarded);
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
        router.service(GuardedInboxService, core.guarded);
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

  it("continues a productive full remote page after cleanup removes its final cursor", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
        router.service(GuardedInboxService, core.guarded);
      }),
    );
    const inbox = new RemoteInbox(client);
    const first = {
      ...domainMessage("first"),
      signalId: "first",
      whenReceived: timestampFromDate(new Date(1_000)),
    };
    const expired = {
      ...domainMessage("expired-cursor"),
      signalId: "expired-cursor",
      whenReceived: timestampFromDate(new Date(2_000)),
      keepUntil: new Date(Date.now() - 60_000),
    };
    const later = {
      ...domainMessage("later"),
      signalId: "later",
      whenReceived: timestampFromDate(new Date(2_000)),
    };
    await client.writeOne(first);
    await client.writeOne({ ...expired, status: "DELIVERED" });
    await client.writeOne(later);
    const shard = ShardIndex.single();
    const onMessage = vi.fn((message: InboxMessage) => {
      void message;
    });
    const delivery = new DeliveryBuilder()
      .withContext({ name: "RemovedRemoteCursor", multitenant: false })
      .withStorageFactory({} as never)
      .withInbox(inbox)
      .withWorkRegistry(new RemoteWorkRegistry(client))
      .withPageSize(2)
      .build();

    await expect(delivery.run({ shard, onMessage })).resolves.toEqual({ status: "COMPLETED" });
    expect(onMessage.mock.calls.map(([message]) => message.id.value)).toEqual(["first", "later"]);
    await expect(client.findOne(expired.id)).resolves.toBeUndefined();
  });

  it("keeps a surviving cursor through a fully removed remote page", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
        router.service(GuardedInboxService, core.guarded);
      }),
    );
    const inbox = new RemoteInbox(client);
    const first = {
      ...domainMessage("retained-first"),
      signalId: "retained-first",
      keepUntil: new Date(Date.now() + 60_000),
    };
    await client.writeOne(first);
    for (const index of [1, 2, 3]) {
      const expired = {
        ...domainMessage(`expired-${String(index)}`),
        signalId: `expired-${String(index)}`,
        whenReceived: timestampFromDate(new Date((index + 1) * 1_000)),
        keepUntil: new Date(Date.now() - 60_000),
      };
      await client.writeOne(expired);
      await client.writeOne({ ...expired, status: "DELIVERED" });
    }
    const later = {
      ...domainMessage("after-removed-page"),
      signalId: "after-removed-page",
      whenReceived: timestampFromDate(new Date(5_000)),
    };
    await client.writeOne(later);
    const shard = ShardIndex.single();
    const onMessage = vi.fn((message: InboxMessage) => {
      void message;
    });
    const delivery = new DeliveryBuilder()
      .withContext({ name: "AllRemovedRemotePage", multitenant: false })
      .withStorageFactory({} as never)
      .withInbox(inbox)
      .withWorkRegistry(new RemoteWorkRegistry(client))
      .withPageSize(2)
      .build();

    await expect(delivery.run({ shard, onMessage })).resolves.toEqual({ status: "COMPLETED" });
    expect(onMessage.mock.calls.map(([message]) => message.id.value)).toEqual([
      "retained-first",
      "after-removed-page",
    ]);
  });

  it("starts at the beginning again when the first full page is wholly removed", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
        router.service(GuardedInboxService, core.guarded);
      }),
    );
    const inbox = new RemoteInbox(client);
    for (const index of [1, 2]) {
      const expired = {
        ...domainMessage(`initial-expired-${String(index)}`),
        signalId: `initial-expired-${String(index)}`,
        whenReceived: timestampFromDate(new Date(index * 1_000)),
        keepUntil: new Date(Date.now() - 60_000),
      };
      await client.writeOne(expired);
      await client.writeOne({ ...expired, status: "DELIVERED" });
    }
    const later = {
      ...domainMessage("after-initial-removal"),
      signalId: "after-initial-removal",
      whenReceived: timestampFromDate(new Date(3_000)),
    };
    await client.writeOne(later);
    const shard = ShardIndex.single();
    const onMessage = vi.fn((message: InboxMessage) => {
      void message;
    });
    const delivery = new DeliveryBuilder()
      .withContext({ name: "InitialRemovedRemotePage", multitenant: false })
      .withStorageFactory({} as never)
      .withInbox(inbox)
      .withWorkRegistry(new RemoteWorkRegistry(client))
      .withPageSize(2)
      .build();

    await expect(delivery.run({ shard, onMessage })).resolves.toEqual({ status: "COMPLETED" });
    expect(onMessage.mock.calls.map(([message]) => message.id.value)).toEqual([
      "after-initial-removal",
    ]);
  });

  it("continues after removing a duplicate at the end of a full remote page", async () => {
    const core = InMemoryDelivery.create();
    const client = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
        router.service(GuardedInboxService, core.guarded);
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
        router.service(GuardedInboxService, core.guarded);
      }),
    );
    const pending = domainMessage("lost-delivered");
    await normal.writeOne(pending);
    let acknowledgements = 0;
    const lostClient = DeliveryClient.usingTransport(
      createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
        router.service(GuardedInboxService, {
          ...core.guarded,
          acknowledge: async (request, context) => {
            acknowledgements += 1;
            const result = await core.guarded.acknowledge(request, context);
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

  it.each([
    ["pending duplicate", "removePendingDuplicate", "removeDuplicate"],
    ["expired completion", "removeExpiredDelivered", "removeDelivered"],
  ] as const)(
    "reports the exact message after a committed %s response is lost",
    async (_label, rpc, method) => {
      const core = InMemoryDelivery.create();
      const pending = domainMessage(`lost-${method}`);
      const source =
        method === "removeDelivered"
          ? { ...pending, status: "DELIVERED" as const, keepUntil: new Date(0) }
          : pending;
      const normal = DeliveryClient.usingTransport(
        createRouterTransport((router) => {
          router.service(InboxService, core.inbox);
          router.service(ManagedShardService, core.managed);
          router.service(GuardedInboxService, core.guarded);
        }),
      );
      await normal.writeOne(source);
      if (method === "removeDelivered") await normal.writeOne(domainMessage("work-for-cleanup"));
      const lostClient = DeliveryClient.usingTransport(
        createRouterTransport((router) => {
          router.service(InboxService, core.inbox);
          router.service(ManagedShardService, core.managed);
          router.service(GuardedInboxService, {
            ...core.guarded,
            [rpc]: async (request: never, context: never) => {
              await core.guarded[rpc](request, context);
              throw new ConnectError("lost", Code.Unavailable);
            },
          });
        }),
      );
      const registry = new RemoteWorkRegistry(lostClient);
      const session = await registry.pickUp(
        ShardIndex.single(),
        create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" }),
      );
      const read = await lostClient.findOne(source.id);
      if (session === undefined || read === undefined) throw new Error("Expected a live read.");
      const inbox = new RemoteInbox(lostClient);
      await expect(inbox[method](read, undefined, session)).rejects.toMatchObject({
        operation:
          method === "removeDelivered" ? "REMOVE_DELIVERED_GUARDED" : "REMOVE_DUPLICATE_GUARDED",
        reconciliation: { kind: "FIND_MESSAGE", messageIds: [`0/1:lost-${method}`] },
      });
      await expect(normal.findOne(source.id)).resolves.toBeUndefined();
    },
  );

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
