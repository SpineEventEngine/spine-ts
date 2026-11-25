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

import { clone, create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import { Time } from "@spine-event-engine/core/time";
import {
  DeliveryShardPickupSchema,
  GuardedInboxService,
  InboxService,
  ManagedShardService,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageSchema,
  InboxMessageStatus,
  ShardIndexSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";
import * as privateProto from "@spine-event-engine/proto/generated/spine/delivery/session/private_delivery_pb.js";
import { describe, expect, it, vi } from "vitest";

import { domainMessage, encodedBytes } from "../core/domain-message.js";
import { CapacityLedger } from "../../src/server/capacity-ledger.js";
import { DeliveryConfig } from "../../src/server/config.js";
import { PrivateCapacityListener } from "../../src/server/private-capacity-listener.js";
import { PrivateDeliveryChild } from "../../src/server/private-delivery-child.js";

describe("private delivery child", () => {
  it("authenticates requests and reserves exact capacity for Inbox writes", async () => {
    const configuration = DeliveryConfig.resolve({ host: "127.0.0.1", port: 0 });
    const ledger = new CapacityLedger(configuration);
    ledger.replace(0, "first");
    const capacity = new PrivateCapacityListener(
      ledger,
      new Map([["Bearer child-capacity", { slot: 0, generation: "first" }]]),
    );
    await capacity.start();
    const child = new PrivateDeliveryChild({
      slot: 0,
      generation: "first",
      credential: "Bearer parent-child",
      capacityCredential: "Bearer child-capacity",
      capacityBaseUrl: capacity.baseUrl,
      configuration,
    });
    await child.start();
    const sessions = new Http2SessionManager(child.baseUrl);
    const client = createClient(
      InboxService,
      createGrpcTransport({
        baseUrl: child.baseUrl,
        sessionManager: sessions,
      }),
    );
    const control = createClient(
      privateProto.PrivateChildService,
      createGrpcTransport({
        baseUrl: child.baseUrl,
        sessionManager: sessions,
      }),
    );
    const managed = createClient(
      ManagedShardService,
      createGrpcTransport({
        baseUrl: child.baseUrl,
        sessionManager: sessions,
      }),
    );
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
    const row = domainMessage("private-write", shard);
    if (row.id === undefined) throw new Error("Inbox fixture identity is missing.");
    try {
      await expect(client.writeOne({ message: row })).rejects.toMatchObject({
        code: Code.Unauthenticated,
      });
      await expect(
        client.writeOne(
          { message: row },
          {
            headers: {
              authorization: "Bearer parent-child",
              "x-spine-capacity-sequence": "1",
            },
          },
        ),
      ).resolves.toBeDefined();
      const found = await client.findOne(
        { index: shard, uuid: row.id.uuid },
        {
          headers: { authorization: "Bearer parent-child" },
        },
      );
      expect(found.message?.id?.uuid).toBe("private-write");
      expect(ledger.usage()).toEqual({ rows: 1, bytes: encodedBytes(row), shards: 1 });
      await expect(
        control.barrier({ slot: 0n, generation: "first", sequence: 2n }),
      ).rejects.toMatchObject({ code: Code.Unauthenticated });
      await control.barrier(
        { slot: 0n, generation: "first", sequence: 2n },
        {
          headers: { authorization: "Bearer parent-child" },
        },
      );
      const otherShard = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
      await expect(
        client.writeMany(
          { shard, message: [row, domainMessage("other", otherShard)] },
          {
            headers: { authorization: "Bearer parent-child", "x-spine-capacity-sequence": "3" },
          },
        ),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      expect(ledger.usage()).toEqual({ rows: 1, bytes: encodedBytes(row), shards: 1 });
      const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" });
      const pickup = await managed.pickShardRaw(
        create(DeliveryShardPickupSchema, {
          shard: otherShard,
          worker,
        }),
        {
          headers: {
            authorization: "Bearer parent-child",
            "x-spine-capacity-sequence": "4",
          },
        },
      );
      expect(pickup.result.case).toBe("pickedUp");
      if (pickup.result.case !== "pickedUp") throw new Error("Raw pickup did not grant a session.");
      expect(ledger.usage().shards).toBe(2);
      await managed.releaseShardSession(pickup.result.value, {
        headers: {
          authorization: "Bearer parent-child",
          "x-spine-capacity-sequence": "5",
        },
      });
      expect(ledger.usage()).toEqual({ rows: 1, bytes: encodedBytes(row), shards: 1 });
    } finally {
      sessions.abort();
      await child.close();
      await capacity.close();
    }
  });

  it("admits a guarded acknowledgement at the exact global byte limit", async () => {
    let when = create(TimestampSchema, { seconds: 100n, nanos: 123 });
    const previous = Time.setProvider({ currentTime: () => when });
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    const row = domainMessage("tight-ack", shard);
    const completed = clone(InboxMessageSchema, row);
    completed.status = InboxMessageStatus.DELIVERED;
    completed.keepUntil = create(TimestampSchema, { seconds: 133n, nanos: 123 });
    const configuration = DeliveryConfig.resolve({
      host: "127.0.0.1",
      port: 0,
      maxRetainedBytes: encodedBytes(completed),
    });
    const ledger = new CapacityLedger(configuration);
    ledger.replace(0, "first");
    const reserve = ledger.reserve.bind(ledger);
    vi.spyOn(ledger, "reserve").mockImplementation((ticket, growth, phase) => {
      reserve(ticket, growth, phase);
      if (ticket.sequence === 3n && phase === 0n)
        when = create(TimestampSchema, { seconds: 128n, nanos: 123 });
    });
    const capacity = new PrivateCapacityListener(
      ledger,
      new Map([["Bearer capacity", { slot: 0, generation: "first" }]]),
    );
    let child: PrivateDeliveryChild | undefined;
    let sessions: Http2SessionManager | undefined;
    try {
      await capacity.start();
      child = new PrivateDeliveryChild({
        slot: 0,
        generation: "first",
        credential: "Bearer child",
        capacityCredential: "Bearer capacity",
        capacityBaseUrl: capacity.baseUrl,
        configuration,
      });
      await child.start();
      sessions = new Http2SessionManager(child.baseUrl);
      const transport = createGrpcTransport({ baseUrl: child.baseUrl, sessionManager: sessions });
      const inbox = createClient(InboxService, transport);
      const managed = createClient(ManagedShardService, transport);
      const guarded = createClient(GuardedInboxService, transport);
      const headers = (sequence: number) => ({
        headers: {
          authorization: "Bearer child",
          "x-spine-capacity-sequence": String(sequence),
        },
      });
      await inbox.writeOne({ message: row }, headers(1));
      const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" });
      const picked = await managed.pickShardForDelivery(
        create(DeliveryShardPickupSchema, {
          shard,
          worker,
        }),
        headers(2),
      );
      if (picked.result.case !== "pickedUp")
        throw new Error("Managed pickup did not grant a session.");
      const result = await guarded.acknowledge(
        {
          session: picked.result.value,
          expected: row,
        },
        headers(3),
      );
      expect(result.matched).toBe(true);
      expect(result.message?.keepUntil).toMatchObject({ seconds: 133n, nanos: 123 });
      expect(ledger.usage()).toEqual({ rows: 1, bytes: encodedBytes(completed), shards: 1 });
    } finally {
      sessions?.abort();
      await child?.close();
      await capacity.close();
      Time.setProvider(previous);
    }
  });
});
