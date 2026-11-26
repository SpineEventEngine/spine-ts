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
import { PrivateCapacityClient } from "../../src/server/private-capacity-client.js";
import { PrivateDeliveryChild } from "../../src/server/private-delivery-child.js";

describe("private delivery child", () => {
  it("reports expiry discovered while planning a rejected acknowledgement", async () => {
    let elapsed = 0;
    const configuration = {
      ...DeliveryConfig.resolve({ host: "127.0.0.1", port: 0, maxTrackedShards: 1 }),
      processingTimeoutMs: 1_000,
      monotonicNow: () => elapsed,
    };
    const ledger = new CapacityLedger(configuration);
    ledger.replace(0, "first");
    ledger.replace(1, "second");
    const capacity = new PrivateCapacityListener(
      ledger,
      new Map([["Bearer capacity", { slot: 0, generation: "first" }]]),
    );
    await capacity.start();
    const child = new PrivateDeliveryChild({
      slot: 0,
      generation: "first",
      credential: "Bearer child",
      capacityCredential: "Bearer capacity",
      capacityBaseUrl: capacity.baseUrl,
      configuration,
    });
    await child.start();
    const sessions = new Http2SessionManager(child.baseUrl);
    const transport = createGrpcTransport({ baseUrl: child.baseUrl, sessionManager: sessions });
    const inbox = createClient(InboxService, transport);
    const managed = createClient(ManagedShardService, transport);
    const guarded = createClient(GuardedInboxService, transport);
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
    const row = domainMessage("expiring-guard", shard);
    const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" });
    const headers = (sequence: number) => ({
      headers: { authorization: "Bearer child", "x-spine-capacity-sequence": String(sequence) },
    });
    try {
      await inbox.writeOne({ message: row }, headers(1));
      const picked = await managed.pickShardForDelivery(
        create(DeliveryShardPickupSchema, { shard, worker }),
        headers(2),
      );
      if (picked.result.case !== "pickedUp") throw new Error("Expected managed pickup.");
      await inbox.removeOne({ message: row }, headers(3));
      expect(ledger.usage()).toEqual({ rows: 0, bytes: 0, shards: 1 });
      elapsed = 1_001;
      await expect(
        guarded.acknowledge({ session: picked.result.value, expected: row }, headers(4)),
      ).rejects.toMatchObject({ code: Code.FailedPrecondition });
      await vi.waitFor(() => {
        expect(ledger.usage()).toEqual({ rows: 0, bytes: 0, shards: 0 });
      });
      const next = { slot: 1, generation: "second", sequence: 1n };
      ledger.reserve(next, { rows: 0, bytes: 0, shards: 1 });
      ledger.report(next, { rows: 0, bytes: 0, shards: 1 }, 1n);
      expect(ledger.usage().shards).toBe(1);
    } finally {
      sessions.abort();
      await child.close();
      await capacity.close();
    }
  });
  it.each(["writeOne", "writeMany", "pickShardRaw"] as const)(
    "refreshes tracked-shard growth after an expiring session during %s reservation",
    async (method) => {
      const configuration = {
        ...DeliveryConfig.resolve({ host: "127.0.0.1", port: 0, maxTrackedShards: 1 }),
        processingTimeoutMs: 30,
      };
      const ledger = new CapacityLedger(configuration);
      ledger.replace(0, "first");
      ledger.replace(1, "other");
      const capacity = new PrivateCapacityListener(
        ledger,
        new Map([["Bearer capacity", { slot: 0, generation: "first" }]]),
      );
      await capacity.start();
      const child = new PrivateDeliveryChild({
        slot: 0,
        generation: "first",
        credential: "Bearer child",
        capacityCredential: "Bearer capacity",
        capacityBaseUrl: capacity.baseUrl,
        configuration,
      });
      await child.start();
      const sessions = new Http2SessionManager(child.baseUrl);
      const transport = createGrpcTransport({ baseUrl: child.baseUrl, sessionManager: sessions });
      const managed = createClient(ManagedShardService, transport);
      const inbox = createClient(InboxService, transport);
      const shard = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
      const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" });
      const pickup = create(DeliveryShardPickupSchema, { shard, worker });
      const headers = (sequence: number) => ({
        headers: {
          authorization: "Bearer child",
          "x-spine-capacity-sequence": String(sequence),
        },
      });
      const entered = Promise.withResolvers<undefined>();
      const release = Promise.withResolvers<undefined>();
      try {
        await managed.pickShardRaw(pickup, headers(1));
        // The original prototype method is invoked with the spied instance below.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const original = PrivateCapacityClient.prototype.reserve;
        const phases: bigint[] = [];
        const spy = vi
          .spyOn(PrivateCapacityClient.prototype, "reserve")
          .mockImplementation(async function (
            this: PrivateCapacityClient,
            ticket,
            growth,
            signal,
            phase,
          ) {
            if (ticket.sequence === 2n) phases.push(phase ?? 0n);
            await original.call(this, ticket, growth, signal, phase);
            if (ticket.sequence === 2n) {
              if (phase === 0n) {
                entered.resolve(undefined);
                await release.promise;
              }
            }
          });
        try {
          const row = domainMessage("late-write", shard);
          const pending =
            method === "writeOne"
              ? inbox.writeOne({ message: row }, headers(2))
              : method === "writeMany"
                ? inbox.writeMany({ shard, message: [row] }, headers(2))
                : managed.pickShardRaw(pickup, headers(2));
          const settled = pending.then(
            () => ({ error: undefined }),
            (error: unknown) => ({ error }),
          );
          await entered.promise;
          await vi.waitFor(
            () => {
              expect(ledger.usage().shards).toBe(0);
            },
            { timeout: 2_000 },
          );
          ledger.reserve(
            { slot: 1, generation: "other", sequence: 1n },
            { rows: 0, bytes: 0, shards: 1 },
          );
          ledger.report(
            { slot: 1, generation: "other", sequence: 1n },
            { rows: 0, bytes: 0, shards: 1 },
            1n,
          );
          release.resolve(undefined);
          expect((await settled).error).toMatchObject({ code: Code.ResourceExhausted });
          expect(phases).toEqual([0n, 1n]);
          expect(ledger.usage().shards).toBe(1);
          if (method !== "pickShardRaw") {
            const found = await inbox.findOne(
              { index: shard, uuid: "late-write" },
              { headers: { authorization: "Bearer child" } },
            );
            expect(found.message).toBeUndefined();
          }
        } finally {
          release.resolve(undefined);
          spy.mockRestore();
        }
      } finally {
        sessions.abort();
        await child.close();
        await capacity.close();
      }
    },
  );
  it("keeps a retired child from binding a private port after shutdown", async () => {
    const configuration = DeliveryConfig.resolve({ port: 0 });
    const capacity = new PrivateCapacityListener(new CapacityLedger(configuration), new Map());
    await capacity.start();
    const child = new PrivateDeliveryChild({
      slot: 0,
      generation: "first",
      credential: "Bearer child",
      capacityCredential: "Bearer capacity",
      capacityBaseUrl: capacity.baseUrl,
      configuration,
    });
    try {
      expect(() => child.baseUrl).toThrow("has not started");
      await child.close();
      await expect(child.start()).rejects.toThrow("is closed");
      expect(() => child.baseUrl).toThrow("has not started");
    } finally {
      await child.close();
      await capacity.close();
    }
  });

  it("ends a generation after an autonomous expiry report is rejected permanently", async () => {
    const configuration = { ...DeliveryConfig.resolve({ port: 0 }), processingTimeoutMs: 20 };
    const ledger = new CapacityLedger(configuration);
    ledger.replace(0, "first");
    const credentials = new Map([["Bearer capacity", { slot: 0, generation: "first" }]]);
    const capacity = new PrivateCapacityListener(ledger, credentials);
    await capacity.start();
    const onFatal = vi.fn();
    const child = new PrivateDeliveryChild(
      {
        slot: 0,
        generation: "first",
        credential: "Bearer child",
        capacityCredential: "Bearer capacity",
        capacityBaseUrl: capacity.baseUrl,
        configuration,
      },
      onFatal,
    );
    await child.start();
    const sessions = new Http2SessionManager(child.baseUrl);
    const managed = createClient(
      ManagedShardService,
      createGrpcTransport({ baseUrl: child.baseUrl, sessionManager: sessions }),
    );
    try {
      const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
      const worker = create(WorkerIdSchema, { nodeId: { value: "node" }, value: "run" });
      await managed.pickShardRaw(create(DeliveryShardPickupSchema, { shard, worker }), {
        headers: { authorization: "Bearer child", "x-spine-capacity-sequence": "1" },
      });
      credentials.delete("Bearer capacity");
      await vi.waitFor(
        () => {
          expect(onFatal).toHaveBeenCalledOnce();
        },
        { timeout: 2_000 },
      );
    } finally {
      sessions.abort();
      await child.close();
      await capacity.close();
    }
  });
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
        client.writeOne({ message: row }, { headers: { authorization: "Bearer parent-child" } }),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      expect(ledger.usage()).toEqual({ rows: 0, bytes: 0, shards: 0 });
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
      await expect(
        control.barrier(
          { slot: 0n, generation: "first", sequence: 0n },
          { headers: { authorization: "Bearer parent-child" } },
        ),
      ).rejects.toMatchObject({ code: Code.InvalidArgument });
      await expect(
        control.barrier(
          { slot: 0n, generation: "older", sequence: 2n },
          { headers: { authorization: "Bearer parent-child" } },
        ),
      ).rejects.toMatchObject({ code: Code.FailedPrecondition });
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
