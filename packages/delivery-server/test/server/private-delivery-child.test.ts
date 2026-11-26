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

import { create } from "@bufbuild/protobuf";
import { Code, createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { describe, expect, it } from "vitest";
import {
  InboxService,
  ManagedShardService,
  DeliveryShardPickupSchema,
} from "@spine-event-engine/proto/delivery-server";
import { ShardIndexSchema, WorkerIdSchema } from "@spine-event-engine/proto/delivery";

import { domainMessage } from "../core/domain-message.js";
import { DeliveryConfig } from "../../src/server/config.js";
import { PrivateDeliveryChild } from "../../src/server/private-delivery-child.js";

describe("private delivery child", () => {
  it("does not bind after shutdown", async () => {
    const child = new PrivateDeliveryChild({
      credential: "Bearer child",
      configuration: DeliveryConfig.resolve({ port: 0 }),
    });
    expect(() => child.baseUrl).toThrow("has not started");
    await child.close();
    await expect(child.start()).rejects.toThrow("is closed");
  });

  it("authenticates direct Inbox and session calls and enforces local row capacity", async () => {
    const child = new PrivateDeliveryChild({
      credential: "Bearer child",
      configuration: DeliveryConfig.resolve({ port: 0, maxRetainedMessages: 1 }),
    });
    await child.start();
    const sessions = new Http2SessionManager(child.baseUrl);
    const transport = createGrpcTransport({ baseUrl: child.baseUrl, sessionManager: sessions });
    const inbox = createClient(InboxService, transport);
    const managed = createClient(ManagedShardService, transport);
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
    const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" });
    const headers = { headers: { authorization: "Bearer child" } };
    try {
      await expect(inbox.writeOne({ message: domainMessage("one", shard) })).rejects.toMatchObject({
        code: Code.Unauthenticated,
      });
      await inbox.writeOne({ message: domainMessage("one", shard) }, headers);
      const found = await inbox.findOne({ index: shard, uuid: "one" }, headers);
      expect(found.message?.id?.uuid).toBe("one");
      await expect(
        inbox.writeOne({ message: domainMessage("two", shard) }, headers),
      ).rejects.toMatchObject({ code: Code.ResourceExhausted });
      const pickup = await managed.pickShardForDelivery(
        create(DeliveryShardPickupSchema, { shard, worker }),
        headers,
      );
      expect(pickup.result.case).toBe("pickedUp");
    } finally {
      sessions.abort();
      await child.close();
    }
  });
});
