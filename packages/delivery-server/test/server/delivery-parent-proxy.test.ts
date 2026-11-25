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
  GuardedInboxService,
  Health,
  InboxService,
  ManagedShardService,
  ReleaseExpiredSessionsSchema,
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
  it("routes positive inbox, managed, guarded, and global release calls across slots", async () => {
    const server = new DeliveryServer({ host: "127.0.0.1", port: 0, processCount: 2 });
    await server.start();
    const sessions = new Http2SessionManager(server.baseUrl);
    const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions });
    const inbox = createClient(InboxService, transport);
    const managed = createClient(ManagedShardService, transport);
    const guarded = createClient(GuardedInboxService, transport);
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
      const acknowledged = await guarded.acknowledge({ session: handle, expected: c });
      expect(acknowledged.matched).toBe(true);
      expect(acknowledged.message?.status).toBe(InboxMessageStatus.DELIVERED);
      expect((await guarded.removePendingDuplicate({ session: handle, expected: b })).matched).toBe(
        true,
      );
      if (acknowledged.message === undefined) throw new Error("Completed row is missing.");
      await managed.releaseShardSession(handle);
      await inbox.removeOne({ message: acknowledged.message });
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
      expect(
        (await guarded.removeExpiredDelivered({ session: cleanup, expected: expired })).matched,
      ).toBe(true);
      expect(
        (await guarded.removePendingDuplicate({ session: cleanup, expected: pending })).matched,
      ).toBe(true);
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

  it("rejects new operations and aborts an in-flight child call when the proxy closes", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const proxy = new DeliveryParentProxy(pool);
    const row = domainMessage("closing-row", create(ShardIndexSchema, { index: 0, ofTotal: 2 }));
    const entered = Promise.withResolvers<undefined>();
    const reserve = pool.ledger.reserve.bind(pool.ledger);
    const spy = vi.spyOn(pool.ledger, "reserve").mockImplementation((ticket, growth, phase) => {
      if (ticket.slot === 0) {
        entered.resolve(undefined);
        throw new ConnectError("Private reserve unavailable.", Code.Unavailable);
      }
      reserve(ticket, growth, phase);
    });
    const context = { signal: new AbortController().signal, timeoutMs: () => undefined } as never;
    try {
      const inFlight = proxy
        .inbox()
        .writeOne(create(WriteMessageSchema, { message: row }), context);
      await entered.promise;
      proxy.close();
      await expect(inFlight).rejects.toBeDefined();
      await expect(
        proxy.inbox().writeOne(create(WriteMessageSchema, { message: row }), context),
      ).rejects.toMatchObject({ code: Code.Unavailable });
      if (row.id === undefined) throw new Error("Inbox fixture identity is missing.");
      await expect(proxy.inbox().findOne(row.id, context)).rejects.toMatchObject({
        code: Code.Unavailable,
      });
      expect(() => proxy.observing().observeAll(create(EmptySchema), context)).toThrow(
        expect.objectContaining({ code: Code.Unavailable }),
      );
      expect(() => proxy.admin().subscribeToShardUpdates(create(EmptySchema), context)).toThrow(
        expect.objectContaining({ code: Code.Unavailable }),
      );
    } finally {
      spy.mockRestore();
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

  it("enforces one global row limit across competing child writes", async () => {
    const server = new DeliveryServer({ port: 0, processCount: 2, maxRetainedMessages: 1 });
    await server.start();
    const sessions = new Http2SessionManager(server.baseUrl);
    const transport = createGrpcTransport({ baseUrl: server.baseUrl, sessionManager: sessions });
    const inbox = createClient(InboxService, transport);
    try {
      const writes = await Promise.allSettled(
        [0, 1].map((index) =>
          inbox.writeOne({
            message: domainMessage(
              `competing-${String(index)}`,
              create(ShardIndexSchema, { index, ofTotal: 2 }),
            ),
          }),
        ),
      );
      expect(writes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(writes.filter((result) => result.status === "rejected")).toHaveLength(1);
      const snapshot = await createClient(AdminService, transport).getShardInfo(
        create(EmptySchema),
      );
      expect(snapshot.shards).toHaveLength(1);
    } finally {
      sessions.abort();
      await server.close();
    }
  });

  it("lets a healthy slot read and write while another slot's report is unsettled", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const proxy = new DeliveryParentProxy(pool);
    const context = { signal: new AbortController().signal, timeoutMs: () => undefined } as never;
    const entered = Promise.withResolvers<undefined>();
    const report = pool.ledger.report.bind(pool.ledger);
    const reportSpy = vi
      .spyOn(pool.ledger, "report")
      .mockImplementation((ticket, usage, revision) => {
        if (ticket.slot === 0) {
          entered.resolve(undefined);
          throw new ConnectError("Private report unavailable.", Code.Unavailable);
        }
        report(ticket, usage, revision);
      });
    const a = domainMessage("unsettled-a", create(ShardIndexSchema, { index: 0, ofTotal: 2 }));
    const b = domainMessage("healthy-b", create(ShardIndexSchema, { index: 1, ofTotal: 2 }));
    try {
      const uncertain = proxy.inbox().writeOne(create(WriteMessageSchema, { message: a }), context);
      await entered.promise;
      await proxy.inbox().writeOne(create(WriteMessageSchema, { message: b }), context);
      if (b.id === undefined) throw new Error("Inbox fixture identity is missing.");
      const found = await proxy.inbox().findOne(b.id, context);
      expect(found.message?.id?.uuid).toBe("healthy-b");
      reportSpy.mockRestore();
      await uncertain;
    } finally {
      reportSpy.mockRestore();
      proxy.close();
      await pool.close();
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

  it("keeps a renewal when a later public release enters before capacity admission", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const proxy = new DeliveryParentProxy(pool);
    const context = { signal: new AbortController().signal, timeoutMs: () => undefined } as never;
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
    const worker = (value: string) =>
      create(WorkerIdSchema, { nodeId: { value: "replica" }, value });
    const reserve = pool.ledger.reserve.bind(pool.ledger);
    const entered = Promise.withResolvers<undefined>();
    let blocked = true;
    const reserveSpy = vi
      .spyOn(pool.ledger, "reserve")
      .mockImplementation((ticket, growth, phase) => {
        if (ticket.slot === 0 && ticket.sequence === 2n && blocked) {
          entered.resolve(undefined);
          throw new ConnectError("Private reserve unavailable.", Code.Unavailable);
        }
        reserve(ticket, growth, phase);
      });
    try {
      const first = pickedHandle(
        await proxy
          .managed()
          .pickShardRaw(
            create(DeliveryShardPickupSchema, { shard, worker: worker("same") }),
            context,
          ),
      );
      const renewal = proxy.managed().renewShardSession(first, context);
      await entered.promise;
      const stale = proxy.managed().releaseShardSession(first, context);
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      blocked = false;
      await renewal;
      await stale;
      const competing = await proxy
        .managed()
        .pickShardRaw(
          create(DeliveryShardPickupSchema, { shard, worker: worker("rival") }),
          context,
        );
      expect(competing.result?.case).toBe("busy");
    } finally {
      blocked = false;
      reserveSpy.mockRestore();
      proxy.close();
      await pool.close();
    }
  });

  it("forwards a deadline and retires its ticket before later same-slot work", async () => {
    const pool = new DeliveryChildPool(2, DeliveryConfig.resolve({ port: 0 }));
    await pool.start();
    const proxy = new DeliveryParentProxy(pool);
    const shard = create(ShardIndexSchema, { index: 0, ofTotal: 2 });
    const row = domainMessage("deadline-row", shard);
    const reserve = pool.ledger.reserve.bind(pool.ledger);
    const entered = Promise.withResolvers<undefined>();
    let blocked = true;
    const spy = vi.spyOn(pool.ledger, "reserve").mockImplementation((ticket, growth, phase) => {
      if (ticket.slot === 0 && blocked) {
        entered.resolve(undefined);
        throw new ConnectError("Private reserve unavailable.", Code.Unavailable);
      }
      reserve(ticket, growth, phase);
    });
    const signal = new AbortController();
    const deadline = { signal: signal.signal, timeoutMs: () => 60 } as never;
    const normal = { signal: new AbortController().signal, timeoutMs: () => undefined } as never;
    try {
      const cancelled = new AbortController();
      cancelled.abort();
      await expect(
        proxy.inbox().writeOne(create(WriteMessageSchema, { message: row }), {
          signal: cancelled.signal,
          timeoutMs: () => undefined,
        } as never),
      ).rejects.toMatchObject({ code: Code.Canceled });
      const expired = proxy
        .inbox()
        .writeOne(create(WriteMessageSchema, { message: row }), deadline);
      await entered.promise;
      await expect(expired).rejects.toMatchObject({ code: Code.DeadlineExceeded });
      blocked = false;
      await proxy.inbox().writeOne(create(WriteMessageSchema, { message: row }), normal);
      if (row.id === undefined) throw new Error("Inbox fixture identity is missing.");
      expect((await proxy.inbox().findOne(row.id, normal)).message?.id?.uuid).toBe("deadline-row");
    } finally {
      blocked = false;
      spy.mockRestore();
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
