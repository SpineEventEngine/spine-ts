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

import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouterTransport } from "@connectrpc/connect";
import { Code, ConnectError } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Time } from "@spine-event-engine/core/time";
import { DeliveryBuilder, ShardIndex } from "@spine-event-engine/server";
import { DeliveryServer } from "@spine-event-engine/delivery-server";
import { InMemoryDelivery } from "@spine-event-engine/delivery-server";
import {
  InboxService,
  ManagedShardService,
  GuardedInboxService,
} from "@spine-event-engine/proto/delivery-server";
import { DeliveryClient, RemoteWorkRegistry } from "../src/index.js";
import { RemoteInbox } from "../src/remote/adapters.js";
import { domainMessage } from "./shared-fixtures.js";

const servers: DeliveryServer[] = [];
const clients: DeliveryClient[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("guarded framework delivery over gRPC", () => {
  it("drains a pending Command through one managed session and guarded acknowledgement", async () => {
    const server = new DeliveryServer({ port: 0 });
    servers.push(server);
    await server.start();
    const client = DeliveryClient.connectTo(server.baseUrl);
    clients.push(client);
    const inbox = new RemoteInbox(client);
    const registry = new RemoteWorkRegistry(client);
    const message = domainMessage("guarded-drain");
    await client.writeOne(message);
    const delivery = new DeliveryBuilder()
      .withContext({ name: "GuardedRemoteDrain", multitenant: false })
      .withStorageFactory({} as never)
      .withInbox(inbox)
      .withWorkRegistry(registry)
      .build();
    const onMessage = vi.fn();
    await expect(delivery.run({ shard: ShardIndex.single(), onMessage })).resolves.toEqual({
      status: "COMPLETED",
    });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect((await client.findOne(message.id))?.status).toBe("DELIVERED");
  });

  it("renews throughout a three-minute handler under the reported 60-second lifetime", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const previous = Time.setProvider({
      currentTime: () => timestampFromDate(new Date(Date.now())),
      monotonicTime: () => Date.now(),
    });
    const core = InMemoryDelivery.create({
      now: () => Time.currentTime(),
      monotonicNow: () => Time.monotonicTime(),
    });
    try {
      const transport = createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(ManagedShardService, core.managed);
        router.service(GuardedInboxService, core.guarded);
      });
      const client = DeliveryClient.usingTransport(transport);
      clients.push(client);
      const message = domainMessage("long-handler");
      await client.writeOne(message);
      const delivery = new DeliveryBuilder()
        .withContext({ name: "GuardedLongHandler", multitenant: false })
        .withStorageFactory({} as never)
        .withInbox(new RemoteInbox(client))
        .withWorkRegistry(new RemoteWorkRegistry(client))
        .build();
      const entered = Promise.withResolvers<undefined>();
      const resume = Promise.withResolvers<undefined>();
      const run = delivery.run({
        shard: ShardIndex.single(),
        onMessage: async () => {
          entered.resolve(undefined);
          await resume.promise;
        },
      });
      await entered.promise;
      await vi.advanceTimersByTimeAsync(180_000);
      expect(
        (
          await client.pickUpForDelivery(ShardIndex.single(), {
            nodeId: "rival",
            value: "run",
          })
        ).kind,
      ).toBe("BUSY");
      resume.resolve(undefined);
      await expect(run).resolves.toEqual({ status: "COMPLETED" });
      expect((await client.findOne(message.id))?.status).toBe("DELIVERED");
    } finally {
      core.close();
      Time.setProvider(previous);
      vi.useRealTimers();
    }
  });

  it("permits takeover after renewal loss while the first handler remains active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    const previous = Time.setProvider({
      currentTime: () => timestampFromDate(new Date(Date.now())),
      monotonicTime: () => Date.now(),
    });
    const core = InMemoryDelivery.create({
      now: () => Time.currentTime(),
      monotonicNow: () => Time.monotonicTime(),
    });
    try {
      let failRenew = false;
      const firstTransport = createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(GuardedInboxService, core.guarded);
        router.service(ManagedShardService, {
          ...core.managed,
          renewShardSession: (request, context) =>
            failRenew
              ? Promise.reject(new ConnectError("disconnected", Code.Unavailable))
              : core.managed.renewShardSession(request, context),
        });
      });
      const nextTransport = createRouterTransport((router) => {
        router.service(InboxService, core.inbox);
        router.service(GuardedInboxService, core.guarded);
        router.service(ManagedShardService, core.managed);
      });
      const firstClient = DeliveryClient.usingTransport(firstTransport);
      const nextClient = DeliveryClient.usingTransport(nextTransport);
      clients.push(firstClient, nextClient);
      const message = domainMessage("takeover-handler");
      await firstClient.writeOne(message);
      const firstDelivery = remoteDelivery(firstClient, "FirstRemoteNode");
      const nextDelivery = remoteDelivery(nextClient, "NextRemoteNode");
      const entered = Promise.withResolvers<undefined>();
      const resume = Promise.withResolvers<undefined>();
      const firstHandler = vi.fn(async () => {
        entered.resolve(undefined);
        await resume.promise;
      });
      const firstRun = firstDelivery.run({ shard: ShardIndex.single(), onMessage: firstHandler });
      await entered.promise;
      failRenew = true;
      await vi.advanceTimersByTimeAsync(61_000);
      const nextHandler = vi.fn();
      await expect(
        nextDelivery.run({ shard: ShardIndex.single(), onMessage: nextHandler }),
      ).resolves.toEqual({ status: "COMPLETED" });
      resume.resolve(undefined);
      await firstRun;
      expect(firstHandler).toHaveBeenCalledOnce();
      expect(nextHandler).toHaveBeenCalledOnce();
      expect((await nextClient.findOne(message.id))?.status).toBe("DELIVERED");
    } finally {
      core.close();
      Time.setProvider(previous);
      vi.useRealTimers();
    }
  });
});

/**
 * Builds a framework delivery using one coherent remote client.
 *
 * @param client Supplies Inbox and session calls.
 * @param name Identifies the test storage Bounded Context.
 * @returns The configured delivery.
 */
function remoteDelivery(client: DeliveryClient, name: string) {
  return new DeliveryBuilder()
    .withContext({ name, multitenant: false })
    .withStorageFactory({} as never)
    .withInbox(new RemoteInbox(client))
    .withWorkRegistry(new RemoteWorkRegistry(client))
    .build();
}
