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
import { EmptySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createGrpcTransport, Http2SessionManager } from "@connectrpc/connect-node";
import {
  AdminService,
  DeliveryShardPickupSchema,
  Health,
  InboxService,
  ManagedShardService,
  ReleaseExpiredSessionsSchema,
  ShardedWorkAvailableSchema,
  ShardObservingService,
  ShardService,
  SubscriptionResponseSchema,
  WriteMessageSchema,
} from "@spine-event-engine/proto/delivery-server";
import {
  InboxMessageStatus,
  ShardIndexSchema,
  WorkerIdSchema,
} from "@spine-event-engine/proto/delivery";
import { describe, expect, it, vi } from "vitest";

import { domainMessage } from "../core/domain-message.js";
import { pickedHandle } from "../session-fixtures.js";
import { DeliveryServer } from "../../src/index.js";
import { DeliveryChildPool } from "../../src/server/delivery-child-pool.js";
import { DeliveryConfig } from "../../src/server/config.js";
import { DeliveryParentProxy } from "../../src/server/delivery-parent-proxy.js";
import { DeliveryStreamFanIn } from "../../src/server/delivery-stream-fan-in.js";

describe("multi-process public Delivery endpoint", () => {
  it("reports more than 1,000 shards from two processes in total-then-index order", async () => {
    const server = new DeliveryServer({ port: 0, processCount: 2 });
    await server.start();
    const sessions = new Http2SessionManager(server.baseUrl);
    const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions });
    const inbox = createClient(InboxService, transport);
    const admin = createClient(AdminService, transport);
    try {
      const shards = Array.from({ length: 1_200 }, (_, index) =>
        create(ShardIndexSchema, { index, ofTotal: 1_201 }),
      );
      const smallerTotal = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
      await Promise.all(
        [...shards, smallerTotal].map((shard, row) =>
          inbox.writeOne({ message: domainMessage(`large-${String(row)}`, shard) }),
        ),
      );
      const snapshot = await admin.getShardInfo({});
      expect(snapshot.shards.map((item) => item.index)).toEqual([smallerTotal, ...shards]);
    } finally {
      sessions.abort();
      await server.close();
    }
  });
  it("rejects a private Admin stream that never acknowledged subscription", async () => {
    const pool = new DeliveryChildPool(1, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const invalid = create(SubscriptionResponseSchema);
    const merge = new DeliveryStreamFanIn(
      pool,
      "admin",
      () =>
        (async function* () {
          yield await Promise.resolve(invalid);
        })(),
      (frame) => frame.value.case === "created",
    );
    const reader = merge
      .observe(new AbortController().signal, new AbortController().signal, invalid)
      [Symbol.asyncIterator]();
    try {
      await expect(reader.next()).rejects.toMatchObject({ code: Code.DataLoss });
    } finally {
      await reader.return?.().catch(() => undefined);
      await pool.close();
    }
  });

  it("fails the global Admin ACK when a child ends just after its private ACK", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const hold = Promise.withResolvers<undefined>();
    const ack = create(SubscriptionResponseSchema, { value: { case: "created", value: true } });
    const merge = new DeliveryStreamFanIn(
      pool,
      "admin",
      (endpoint) =>
        (async function* () {
          if (endpoint.slot === 1) await hold.promise;
          yield ack;
        })(),
      (frame) => frame.value.case === "created",
    );
    const reader = merge
      .observe(new AbortController().signal, new AbortController().signal, ack)
      [Symbol.asyncIterator]();
    try {
      await expect(reader.next()).rejects.toMatchObject({ code: Code.Unavailable });
    } finally {
      hold.resolve(undefined);
      await reader.return?.().catch(() => undefined);
      await pool.close();
    }
  });

  it("cancels an Admin subscriber while a private child has not acknowledged", async () => {
    const pool = new DeliveryChildPool(1, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const entered = Promise.withResolvers<undefined>();
    const caller = new AbortController();
    const ack = create(SubscriptionResponseSchema, { value: { case: "created", value: true } });
    const merge = new DeliveryStreamFanIn(pool, "admin", (_endpoint, signal) =>
      (async function* () {
        entered.resolve(undefined);
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
        yield ack;
      })(),
    );
    const reader = merge
      .observe(caller.signal, new AbortController().signal, ack)
      [Symbol.asyncIterator]();
    try {
      const pending = reader.next();
      await entered.promise;
      caller.abort();
      await expect(pending).rejects.toMatchObject({ code: Code.Canceled });
    } finally {
      caller.abort();
      await reader.return?.().catch(() => undefined);
      await pool.close();
    }
  });

  it("does not open private Admin streams for a pre-aborted public subscriber", async () => {
    const pool = new DeliveryChildPool(1, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const open = vi.fn(() =>
      (async function* () {
        yield await Promise.resolve(create(SubscriptionResponseSchema));
      })(),
    );
    const merge = new DeliveryStreamFanIn(pool, "admin", open);
    const caller = new AbortController();
    caller.abort();
    try {
      const reader = merge
        .observe(caller.signal, new AbortController().signal)
        [Symbol.asyncIterator]();
      await expect(reader.next()).resolves.toMatchObject({ done: true });
      expect(open).not.toHaveBeenCalled();
    } finally {
      await pool.close();
    }
  });

  it("does not open a private stream when the public caller aborts during endpoint selection", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const open = vi.fn(() =>
      (async function* () {
        yield await Promise.resolve(
          create(ShardedWorkAvailableSchema, {
            shard: create(ShardIndexSchema, { index: 0, ofTotal: 2 }),
          }),
        );
      })(),
    );
    const merge = new DeliveryStreamFanIn(pool, "work", open);
    const caller = new AbortController();
    const reader = merge
      .observe(caller.signal, new AbortController().signal)
      [Symbol.asyncIterator]();
    try {
      const pending = reader.next();
      caller.abort();
      await expect(pending).resolves.toMatchObject({ done: true });
      expect(open).not.toHaveBeenCalled();
    } finally {
      caller.abort();
      await reader.return?.();
      await pool.close();
    }
  });

  it("fails global Admin while a missing slot leaves healthy work notices available", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const endpoint = pool.endpoint.bind(pool);
    const missing = vi.spyOn(pool, "endpoint").mockImplementation((slot) => {
      if (slot === 0) throw new ConnectError("slot unavailable", Code.Unavailable);
      return endpoint(slot);
    });
    const ack = create(SubscriptionResponseSchema, { value: { case: "created", value: true } });
    const admin = new DeliveryStreamFanIn(
      pool,
      "admin",
      () =>
        (async function* () {
          yield await Promise.resolve(ack);
        })(),
      (frame) => frame.value.case === "created",
    );
    const adminReader = admin
      .observe(new AbortController().signal, new AbortController().signal, ack)
      [Symbol.asyncIterator]();
    const notice = create(ShardedWorkAvailableSchema, {
      shard: create(ShardIndexSchema, { index: 1, ofTotal: 2 }),
    });
    const work = new DeliveryStreamFanIn(pool, "work", () =>
      (async function* () {
        yield await Promise.resolve(notice);
      })(),
    );
    const caller = new AbortController();
    const workReader = work
      .observe(caller.signal, new AbortController().signal)
      [Symbol.asyncIterator]();
    try {
      await expect(adminReader.next()).rejects.toMatchObject({ code: Code.Unavailable });
      expect((await nextFrame(workReader)).shard?.index).toBe(1);
    } finally {
      caller.abort();
      await adminReader.return?.().catch(() => undefined);
      await workReader.return?.();
      missing.mockRestore();
      await pool.close();
    }
  });

  it("rediscovers work after private EOF and detaches a paused public reader on abort", async () => {
    const pool = new DeliveryChildPool(1, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const notice = create(ShardedWorkAvailableSchema, {
      shard: create(ShardIndexSchema, { index: 0, ofTotal: 1 }),
    });
    let opens = 0;
    let detached = false;
    const merge = new DeliveryStreamFanIn(pool, "work", (_endpoint, signal) =>
      (async function* () {
        opens++;
        try {
          yield notice;
          if (opens > 1)
            await new Promise<void>((resolve) => {
              signal.addEventListener(
                "abort",
                () => {
                  resolve();
                },
                { once: true },
              );
            });
        } finally {
          if (opens > 1) detached = true;
        }
      })(),
    );
    const caller = new AbortController();
    const reader = merge
      .observe(caller.signal, new AbortController().signal)
      [Symbol.asyncIterator]();
    try {
      expect((await nextFrame(reader)).shard?.index).toBe(0);
      expect((await nextFrame(reader)).shard?.index).toBe(0);
      expect(opens).toBe(2);
      caller.abort();
      await vi.waitFor(() => {
        expect(detached).toBe(true);
      });
    } finally {
      caller.abort();
      await reader.return?.();
      await pool.close();
    }
  });

  it("rejects a read and an already committed write from a retired generation", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const proxy = new DeliveryParentProxy(pool);
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
    const row = domainMessage("generation-reply", shard);
    if (row.id === undefined) throw new Error("Inbox fixture identity is missing.");
    const id = row.id;
    const context = { signal: new AbortController().signal, timeoutMs: () => undefined } as never;
    try {
      const writeFence = vi.spyOn(pool, "current").mockImplementationOnce(() => false);
      await expect(
        proxy.inbox().writeOne(create(WriteMessageSchema, { message: row }), context),
      ).rejects.toMatchObject({ code: Code.Unavailable });
      writeFence.mockRestore();
      await vi.waitFor(async () => {
        expect((await proxy.inbox().findOne(id, context)).message?.id?.uuid).toBe(id.uuid);
      });
      const readFence = vi.spyOn(pool, "current").mockImplementationOnce(() => false);
      await expect(proxy.inbox().findOne(id, context)).rejects.toMatchObject({
        code: Code.Unavailable,
      });
      readFence.mockRestore();
    } finally {
      proxy.close();
      await pool.close();
    }
  });

  it("rejects an elapsed read deadline before forwarding it to a child", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const proxy = new DeliveryParentProxy(pool);
    const shard = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    const row = domainMessage("expired-read", shard);
    if (row.id === undefined) throw new Error("Inbox fixture identity is missing.");
    try {
      await expect(
        proxy.inbox().findOne(row.id, {
          signal: new AbortController().signal,
          timeoutMs: () => 100_000_000,
        } as never),
      ).resolves.toMatchObject({});
      await expect(
        proxy.inbox().findOne(row.id, {
          signal: new AbortController().signal,
          timeoutMs: () => 0,
        } as never),
      ).rejects.toMatchObject({ code: Code.DeadlineExceeded });
    } finally {
      proxy.close();
      await pool.close();
    }
  });

  it("keeps shards with equal index and different totals separate on the same child", async () => {
    const server = new DeliveryServer({ port: 0, processCount: 2 });
    await server.start();
    const sessions = new Http2SessionManager(server.baseUrl);
    const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions });
    const inbox = createClient(InboxService, transport);
    const admin = createClient(AdminService, transport);
    const managed = createClient(ManagedShardService, transport);
    const smaller = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    const larger = create(ShardIndexSchema, { index: 1, ofTotal: 3 });
    const first = domainMessage("same-uuid", smaller);
    const second = domainMessage("same-uuid", larger);
    const worker = create(WorkerIdSchema, { nodeId: { value: "replica" }, value: "pass" });
    try {
      await inbox.writeOne({ message: second });
      await inbox.writeOne({ message: first });
      const snapshot = await admin.getShardInfo({});
      expect(snapshot.shards.map((info) => info.index)).toEqual([smaller, larger]);

      const session = pickedHandle(await managed.pickShardForDelivery({ shard: smaller, worker }));
      await expect(managed.markDelivered({ session, id: second.id })).rejects.toMatchObject({
        code: Code.InvalidArgument,
      });
      await expect(managed.markDelivered({ session, id: first.id })).resolves.toMatchObject({
        matched: true,
      });
      expect((await inbox.newestMessageToDeliver(larger)).message).toEqual(second);
      expect((await inbox.newestMessageToDeliver(smaller)).message).toBeUndefined();
    } finally {
      sessions.abort();
      await server.close();
    }
  });

  it("routes positive inbox, managed, and global release calls across slots", async () => {
    const server = new DeliveryServer({ host: "127.0.0.1", port: 0, processCount: 2 });
    await server.start();
    const sessions = new Http2SessionManager(server.baseUrl);
    const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions });
    const inbox = createClient(InboxService, transport);
    const managed = createClient(ManagedShardService, transport);
    const shards = createClient(ShardService, transport);
    const first = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
    const second = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    const worker = (value: string) =>
      create(WorkerIdSchema, { nodeId: { value: "replica" }, value });
    const a = domainMessage("positive-a", first);
    const b = domainMessage("positive-b", second);
    const c = domainMessage("positive-c", second, 1);
    try {
      await inbox.writeMany({ shard: second, message: [b, c] });
      await inbox.writeOne({ message: a });
      expect(
        (await inbox.findManyInShard({ shard: second, pageSize: 2 })).message.map(
          (row) => row.id?.uuid,
        ),
      ).toEqual([b.id?.uuid, c.id?.uuid]);
      expect((await inbox.newestMessageToDeliver(second)).message?.id?.uuid).toBe(c.id?.uuid);
      const handle = pickedHandle(
        await managed.pickShardForDelivery({ shard: second, worker: worker("positive") }),
      );
      const acknowledged = await managed.markDelivered({ session: handle, id: c.id });
      expect(acknowledged.matched).toBe(true);
      expect(acknowledged.whenKeepUntil).toBeDefined();
      expect((await managed.removeDuplicate({ session: handle, id: b.id })).matched).toBe(true);
      await managed.releaseShardSession(handle);
      await inbox.removeOne({ message: c });
      await inbox.removeMany({ shard: first, message: [a] });
      expect((await inbox.findManyInShard({ shard: first, pageSize: 2 })).message).toEqual([]);
      expect((await inbox.findManyInShard({ shard: second, pageSize: 2 })).message).toEqual([]);
      const expired = domainMessage("positive-expired", first, 0, 0, InboxMessageStatus.DELIVERED);
      expired.keepUntil = create(TimestampSchema, { seconds: 1n, nanos: 0 });
      const pending = domainMessage("positive-pending", first);
      await inbox.writeMany({ shard: first, message: [expired, pending] });
      const cleanup = pickedHandle(
        await managed.pickShardForDelivery({ shard: first, worker: worker("cleanup") }),
      );
      await managed.removeExpiredDelivered(cleanup);
      expect((await inbox.findOne(expired.id ?? {})).message).toBeUndefined();
      expect((await managed.removeDuplicate({ session: cleanup, id: pending.id })).matched).toBe(
        true,
      );
      await managed.releaseShardSession(cleanup);
      const rawA = pickedHandle(
        await managed.pickShardRaw({ shard: first, worker: worker("raw-a") }),
      );
      const rawB = pickedHandle(
        await managed.pickShardRaw({ shard: second, worker: worker("raw-b") }),
      );
      await expect(
        shards.releaseSession({ shard: first, worker: rawA.worker }),
      ).rejects.toMatchObject({
        code: Code.FailedPrecondition,
      });
      await new Promise((resolve) => setTimeout(resolve, 2));
      const released = await shards.releaseSessions({
        inactivityPeriod: { seconds: 0n, nanos: 1_000 },
      });
      expect(released.shard.map((session) => session.shard?.index).sort()).toEqual([0, 1]);
      expect(rawB.sessionId).not.toBe(rawA.sessionId);
    } finally {
      sessions.abort();
      await server.close();
    }
  });

  it("fails Admin before its first global ACK when a previously acknowledged child dies", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const firstReady = Promise.withResolvers<undefined>();
    const hold = Promise.withResolvers<undefined>();
    const ack = create(SubscriptionResponseSchema, { value: { case: "created", value: true } });
    const merge = new DeliveryStreamFanIn(
      pool,
      "admin",
      (endpoint) =>
        (async function* () {
          if (endpoint.slot === 1) await hold.promise;
          yield ack;
          if (endpoint.slot === 0) firstReady.resolve(undefined);
          await hold.promise;
        })(),
      (frame) => frame.value.case === "created",
    );
    const controller = new AbortController();
    const reader = merge
      .observe(controller.signal, new AbortController().signal, ack)
      [Symbol.asyncIterator]();
    try {
      const first = reader.next();
      await firstReady.promise;
      process.kill(pool.endpoint(0).pid, "SIGKILL");
      await expect(
        Promise.race([
          first,
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error("Admin ACK waited for a dead child."));
            }, 300);
          }),
        ]),
      ).rejects.toMatchObject({ code: Code.Unavailable });
    } finally {
      controller.abort();
      hold.resolve(undefined);
      await reader.return?.().catch(() => undefined);
      await pool.close();
    }
  });

  it("refuses complete global results when a child generation changes after its reply", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const proxy = new DeliveryParentProxy(pool);
    const context = { signal: new AbortController().signal, timeoutMs: () => undefined } as never;
    const current = pool.current.bind(pool);
    try {
      for (const operation of [
        () => proxy.admin().getShardInfo(create(EmptySchema), context),
        () =>
          proxy.shards().releaseSessions(
            create(ReleaseExpiredSessionsSchema, {
              inactivityPeriod: { seconds: 1n, nanos: 0 },
            }),
            context,
          ),
      ]) {
        let checks = 0;
        const spy = vi.spyOn(pool, "current").mockImplementation((endpoint) => {
          checks++;
          return checks === 3 ? false : current(endpoint);
        });
        try {
          await expect(operation()).rejects.toMatchObject({ code: Code.Unavailable });
        } finally {
          spy.mockRestore();
        }
      }
    } finally {
      proxy.close();
      await pool.close();
    }
  });

  it("routes two shards and replays both to each late work subscriber", async () => {
    const server = new DeliveryServer({ host: "127.0.0.1", port: 0, processCount: 2 });
    await server.start();
    const sessions = new Http2SessionManager(server.baseUrl);
    const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions });
    const inbox = createClient(InboxService, transport);
    const admin = createClient(AdminService, transport);
    const observing = createClient(ShardObservingService, transport);
    const first = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
    const second = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
    const a = domainMessage("slot-a", first);
    const b = domainMessage("slot-b", second);
    try {
      await Promise.all([inbox.writeOne({ message: a }), inbox.writeOne({ message: b })]);
      const snapshot = await admin.getShardInfo(create(EmptySchema));
      expect(snapshot.shards.map((item) => item.index?.index)).toEqual([0, 1]);
      const left = observing.observeAll(create(EmptySchema))[Symbol.asyncIterator]();
      const initial = await Promise.all([nextFrame(left), nextFrame(left)]);
      expect(initial.map((item) => item.shard?.index).sort()).toEqual([0, 1]);
      const right = observing.observeAll(create(EmptySchema))[Symbol.asyncIterator]();
      const joined = await Promise.all([nextFrame(right), nextFrame(right)]);
      expect(joined.map((item) => item.shard?.index).sort()).toEqual([0, 1]);
      const updates = admin.subscribeToShardUpdates(create(EmptySchema))[Symbol.asyncIterator]();
      expect((await nextFrame(updates)).value.case).toBe("created");
      expect((await createClient(Health, transport).check({ service: "" })).status).toBeDefined();
      await Promise.all([left.return?.(), right.return?.(), updates.return?.()]);
    } finally {
      sessions.abort();
      await server.close();
    }
  });

  it("keeps healthy-slot work flowing and attaches a replacement while Admin fails", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const proxy = new DeliveryParentProxy(pool);
    const signal = new AbortController();
    const context = { signal: signal.signal, timeoutMs: () => undefined } as never;
    const work = proxy.observing().observeAll(create(EmptySchema), context)[Symbol.asyncIterator]();
    const admin = proxy
      .admin()
      .subscribeToShardUpdates(create(EmptySchema), context)
      [Symbol.asyncIterator]();
    try {
      const acknowledged = await nextFrame(admin);
      expect(acknowledged).toMatchObject({ value: { case: "created" } });
      const first = pool.endpoint(0);
      process.kill(first.pid, "SIGKILL");
      const healthy = create(ShardIndexSchema, { index: 1, ofTotal: 2 });
      const notice = nextFrame(work);
      await proxy.inbox().writeOne(
        create(WriteMessageSchema, {
          message: domainMessage("healthy-after-loss", healthy),
        }),
        context,
      );
      expect((await notice).shard?.index).toBe(1);
      await expect(admin.next()).rejects.toMatchObject({ code: Code.Unavailable });
      await vi.waitFor(() => {
        expect(pool.endpoint(0).generation).not.toBe(first.generation);
      });
      const recovered = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
      const next = nextFrame(work);
      await proxy.inbox().writeOne(
        create(WriteMessageSchema, {
          message: domainMessage("recovered-slot", recovered),
        }),
        context,
      );
      expect((await next).shard?.index).toBe(0);
    } finally {
      signal.abort();
      await work.return?.();
      await admin.return?.().catch(() => undefined);
      proxy.close();
      await pool.close();
    }
  });

  it("rejects a mixed batch in one modulo slot before writing either row", async () => {
    const server = new DeliveryServer({ port: 0, processCount: 2 });
    await server.start();
    const sessions = new Http2SessionManager(server.baseUrl);
    const inbox = createClient(
      InboxService,
      createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions }),
    );
    const first = create(ShardIndexSchema, { index: 0, ofTotal: 4 });
    const other = create(ShardIndexSchema, { index: 2, ofTotal: 4 });
    const a = domainMessage("batch-a", first);
    const b = domainMessage("batch-b", other);
    try {
      await expect(inbox.writeMany({ shard: first, message: [a, b] })).rejects.toMatchObject({
        code: Code.InvalidArgument,
      });
      const snapshot = await createClient(
        AdminService,
        createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions }),
      ).getShardInfo(create(EmptySchema));
      expect(snapshot.shards).toEqual([]);
    } finally {
      sessions.abort();
      await server.close();
    }
  });

  it("rejects an old generation's release after a replacement grants the shard", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const proxy = new DeliveryParentProxy(pool);
    const context = { signal: new AbortController().signal, timeoutMs: () => undefined } as never;
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
    const worker = (value: string) =>
      create(WorkerIdSchema, { nodeId: { value: "replica" }, value });
    try {
      const old = pickedHandle(
        await proxy
          .managed()
          .pickShardRaw(
            create(DeliveryShardPickupSchema, { shard, worker: worker("old") }),
            context,
          ),
      );
      const endpoint = pool.endpoint(0);
      process.kill(endpoint.pid, "SIGKILL");
      await vi.waitFor(() => {
        expect(pool.endpoint(0).generation).not.toBe(endpoint.generation);
      });
      const fresh = pickedHandle(
        await proxy
          .managed()
          .pickShardRaw(
            create(DeliveryShardPickupSchema, { shard, worker: worker("fresh") }),
            context,
          ),
      );
      expect(fresh.sessionId).not.toBe(old.sessionId);
      await proxy.managed().releaseShardSession(old, context);
      const competing = await proxy
        .managed()
        .pickShardRaw(
          create(DeliveryShardPickupSchema, { shard, worker: worker("rival") }),
          context,
        );
      expect(competing.result?.case).toBe("busy");
    } finally {
      proxy.close();
      await pool.close();
    }
  });

  it("does not return partial Admin or release results while a slot is missing", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const proxy = new DeliveryParentProxy(pool);
    const context = { signal: new AbortController().signal, timeoutMs: () => undefined } as never;
    const disappeared = Promise.withResolvers<undefined>();
    const detach = pool.onChange((slot) => {
      if (slot === 0) disappeared.resolve(undefined);
    });
    try {
      process.kill(pool.endpoint(0).pid, "SIGKILL");
      await disappeared.promise;
      await expect(proxy.admin().getShardInfo(create(EmptySchema), context)).rejects.toMatchObject({
        code: Code.Unavailable,
      });
      await expect(
        proxy.shards().releaseSessions(
          create(ReleaseExpiredSessionsSchema, {
            inactivityPeriod: { seconds: 1n, nanos: 0 },
          }),
          context,
        ),
      ).rejects.toMatchObject({ code: Code.Unavailable });
    } finally {
      detach();
      proxy.close();
      await pool.close();
    }
  });

  it("reconnects a broken private work stream while its child remains healthy", async () => {
    const pool = new DeliveryChildPool(1, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const proxy = new DeliveryParentProxy(pool);
    const context = { signal: new AbortController().signal, timeoutMs: () => undefined } as never;
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 1 });
    await proxy
      .inbox()
      .writeOne(
        create(WriteMessageSchema, { message: domainMessage("reconnect-work", shard) }),
        context,
      );
    let attempts = 0;
    const merge = new DeliveryStreamFanIn(pool, "work", (endpoint, signal) => {
      attempts++;
      const sessions = new Http2SessionManager(endpoint.baseUrl);
      const client = createClient(
        ShardObservingService,
        createGrpcTransport({ baseUrl: endpoint.baseUrl, sessionManager: sessions }),
      );
      const source = client.observeAll(create(EmptySchema), {
        headers: { authorization: endpoint.credential },
        signal,
      });
      return (async function* () {
        try {
          for await (const notice of source) {
            yield notice;
            if (attempts === 1)
              throw new ConnectError("Private stream interrupted.", Code.Unavailable);
          }
        } finally {
          sessions.abort();
        }
      })();
    });
    const controller = new AbortController();
    const reader = merge
      .observe(controller.signal, new AbortController().signal)
      [Symbol.asyncIterator]();
    try {
      expect((await nextFrame(reader)).shard?.index).toBe(0);
      expect((await nextFrame(reader)).shard?.index).toBe(0);
      expect(attempts).toBeGreaterThanOrEqual(2);
    } finally {
      controller.abort();
      await reader.return?.();
      proxy.close();
      await pool.close();
    }
  });
});

async function nextFrame<T>(stream: AsyncIterator<T>): Promise<T> {
  const result = await stream.next();
  if (result.done) throw new Error("Delivery stream ended before its expected frame.");
  return result.value;
}
