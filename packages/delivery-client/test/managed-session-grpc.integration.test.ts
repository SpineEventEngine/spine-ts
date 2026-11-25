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

import { createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { afterEach, describe, expect, it } from "vitest";
import {
  Health,
  ManagedShardService,
  GuardedInboxService,
} from "@spine-event-engine/proto/delivery-server";
import { DeliveryServer } from "@spine-event-engine/delivery-server";
import { ShardIndex } from "@spine-event-engine/server";
import { DeliveryClient } from "../src/index.js";

const servers: DeliveryServer[] = [];
const clients: DeliveryClient[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("typed session gRPC", () => {
  it("registers health and round-trips raw and managed session identity", async () => {
    const server = new DeliveryServer({ port: 0 });
    servers.push(server);
    await server.start();
    const client = DeliveryClient.connectTo(server.baseUrl);
    clients.push(client);
    const sessions = new Http2SessionManager(server.baseUrl);
    const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions });
    try {
      const health = await createClient(Health, transport).check({
        service: ManagedShardService.typeName,
      });
      expect(health.status).toBe(1);
      const guardedHealth = await createClient(Health, transport).check({
        service: GuardedInboxService.typeName,
      });
      expect(guardedHealth.status).toBe(1);
    } finally {
      sessions.abort();
    }
    const shard = ShardIndex.single();
    const worker = { nodeId: "node-a", value: "run-a" };
    expect((await client.pickUpForDelivery(shard, worker)).kind).toBe("NO_WORK");
    const raw = await client.pickUp(shard, worker);
    if (raw === undefined) throw new Error("Expected a raw pickup.");
    expect(raw.sessionId).toBeTruthy();
    expect(raw.lifetime.seconds).toBe(60n);
    const renewed = await client.renew(raw);
    expect(renewed.sessionId).toBe(raw.sessionId);
    await client.release(raw);
    const fresh = await client.pickUp(shard, worker);
    expect(fresh?.sessionId).not.toBe(raw.sessionId);
    await client.release(raw);
    expect(await client.pickUp(shard, { nodeId: "node-b", value: "run-b" })).toBeUndefined();
  });
});
