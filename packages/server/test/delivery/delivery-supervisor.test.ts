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

import { describe, expect, it, vi } from "vitest";
import { create, toBinary } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { EventSchema } from "@spine-event-engine/proto";
import { Identifiers } from "@spine-event-engine/core";
import type { WorkerId } from "@spine-event-engine/proto/delivery";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

import {
  DeliveryBuilder,
  DeliveryShutdownTimeoutError,
  DeliverySupervisor,
  type DeliveryShardUpdate,
  type DeliverySupervisorOptions,
  type Delivery,
  type DeliveryRunOptions,
  ShardIndex,
  ShardedWorkRegistry,
  UniformAcrossAllShards,
} from "../../src/index.js";
import type {
  DeliveryInbox,
  DeliveryOperationOptions,
  DeliveryWorkSession,
  DeliveryWorkRegistry,
} from "../../src/delivery/delivery-ports.js";
import { DeliveryMonitor } from "../../src/delivery/delivery-monitor.js";
import { deliverySupervisorAccess } from "../../src/delivery/delivery-supervisor.js";

import type {
  InboxMessage,
  InboxMessageId,
  InboxMessageInput,
  InboxReadOptions,
  InboxWriteResult,
} from "../../src/delivery/inbox.js";

describe("DeliverySupervisor", () => {
  it("does not log returned failed delivery evidence as a terminal detached run", async () => {
    const error = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ error })) };
    const supervisor = new DeliverySupervisor({
      source: {
        releaseExpired: () => Promise.resolve([]),
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: (options) => updatesUntilAborted(options?.signal),
      },
      delivery: qualifiedDelivery({
        run: () => Promise.reject(new Error("delivery secret")),
      }),
      onMessage: () => Promise.resolve(),
    });
    deliverySupervisorAccess.installLogger(supervisor, logger as never);

    await supervisor.start();
    supervisor.notify(newShard(0));
    await supervisor.whenIdle();

    expect(logger.withMetadata).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await supervisor.close();
  });

  it("warns once when initial recovery is retained for a later retry", async () => {
    const warn = vi.fn();
    const logger = { withMetadata: vi.fn(() => ({ warn })) };
    const supervisor = new DeliverySupervisor({
      source: {
        releaseExpired: () => Promise.resolve([]),
        shardSnapshot: () => Promise.reject(new Error("snapshot secret")),
        observeShardUpdates: () => emptyUpdates(),
      },
      delivery: new DeliveryBuilder()
        .withStorageFactory(new InMemoryStorageFactory())
        .withNode("node")
        .build(),
      onMessage: () => Promise.resolve(),
    });

    deliverySupervisorAccess.installLogger(supervisor, logger as never);

    await expect(supervisor.start()).resolves.toBeUndefined();
    expect(logger.withMetadata).toHaveBeenCalledTimes(1);
    expect(logger.withMetadata).toHaveBeenCalledWith({
      operation: "delivery.recovery",
      reasonCode: "failed",
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith("Delivery recovery failed.");
    await supervisor.close();
  });

  it("does not warn when close aborts an entered signal-aware recovery", async () => {
    const entered = Promise.withResolvers<undefined>();
    const warn = vi.fn();
    const error = vi.fn();
    const supervisor = new DeliverySupervisor({
      source: {
        releaseExpired: (_staleMs, options) =>
          new Promise<readonly unknown[]>((_, reject) => {
            const fail = () => {
              reject(new Error("aborted"));
            };
            if (options?.signal?.aborted) fail();
            else options?.signal?.addEventListener("abort", fail, { once: true });
            entered.resolve(undefined);
          }),
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => emptyUpdates(),
      },
      delivery: new DeliveryBuilder()
        .withStorageFactory(new InMemoryStorageFactory())
        .withNode("node")
        .build(),
      onMessage: () => Promise.resolve(),
    });
    deliverySupervisorAccess.installLogger(supervisor, {
      withMetadata: vi.fn(() => ({ warn, error })),
    } as never);
    const starting = supervisor.start();
    await entered.promise;
    await expect(supervisor.close({ graceMs: 0 })).rejects.toThrow(
      "Delivery supervisor shutdown timed out.",
    );
    await starting;
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    [
      "throws",
      {
        withMetadata: () => ({
          warn: () => {
            throw new Error("logger secret");
          },
        }),
      },
    ],
    [
      "rejects",
      { withMetadata: () => ({ warn: () => Promise.reject(new Error("logger secret")) }) },
    ],
  ] as const)("contains a logger that %s during retained recovery", async (_case, logger) => {
    const supervisor = new DeliverySupervisor({
      source: {
        releaseExpired: () => Promise.resolve([]),
        shardSnapshot: () => Promise.reject(new Error("snapshot secret")),
        observeShardUpdates: () => emptyUpdates(),
      },
      delivery: new DeliveryBuilder()
        .withStorageFactory(new InMemoryStorageFactory())
        .withNode("node")
        .build(),
      onMessage: () => Promise.resolve(),
    });
    deliverySupervisorAccess.installLogger(supervisor, logger as never);

    await expect(supervisor.start()).resolves.toBeUndefined();
    await Promise.resolve();
    await supervisor.close();
  });

  it("rejects foreign internal access installation and clears logger metadata on terminal close", async () => {
    const logger = { withMetadata: vi.fn(() => ({ warn: vi.fn() })) };
    const supervisor = new DeliverySupervisor({
      source: {
        releaseExpired: () => Promise.resolve([]),
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => emptyUpdates(),
      },
      delivery: new DeliveryBuilder()
        .withStorageFactory(new InMemoryStorageFactory())
        .withNode("node")
        .build(),
      onMessage: () => Promise.resolve(),
    });

    expect(() => {
      deliverySupervisorAccess.installLogger({} as never, logger as never);
    }).toThrow("Delivery supervisor logger requires a DeliverySupervisor instance.");
    expect(() => {
      deliverySupervisorAccess.loggerFor({} as never);
    }).toThrow("Delivery supervisor logger requires a DeliverySupervisor instance.");
    expect(() => {
      deliverySupervisorAccess.installFinalization({} as never, () => undefined);
    }).toThrow("Delivery supervisor finalization requires a DeliverySupervisor instance.");
    deliverySupervisorAccess.installLogger(supervisor, logger as never);
    expect(deliverySupervisorAccess.loggerFor(supervisor)).toBe(logger);
    await supervisor.start();
    await supervisor.close();
    expect(() => {
      deliverySupervisorAccess.loggerFor(supervisor);
    }).toThrow("Delivery supervisor logger is not installed.");
  });

  it("does not open a replacement watch until failed recovery later succeeds", async () => {
    let snapshots = 0;
    let watches = 0;
    const supervisor = new DeliverySupervisor({
      source: {
        releaseExpired: () => Promise.resolve([]),
        shardSnapshot: () => {
          snapshots += 1;
          return snapshots === 1
            ? Promise.reject(new Error("snapshot failed"))
            : Promise.resolve([]);
        },
        observeShardUpdates: (options) => {
          watches += 1;
          return updatesUntilAborted(options?.signal);
        },
      },
      delivery: new DeliveryBuilder()
        .withStorageFactory(new InMemoryStorageFactory())
        .withNode("node")
        .build(),
      onMessage: () => Promise.resolve(),
      recoveryMs: 1,
      watchInitialBackoffMs: 1,
      watchMaxBackoffMs: 1,
    });
    await supervisor.start();
    expect(watches).toBe(0);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(watches).toBe(1);
    await supervisor.close();
  });
  it.each([
    [{ concurrency: 0 }, "Delivery supervisor concurrency"],
    [{ pendingLimit: 0 }, "Delivery supervisor pending limit"],
    [{ recoveryMs: 0 }, "Delivery supervisor recovery interval"],
    [{ staleMs: 0 }, "Delivery supervisor stale session interval"],
    [{ watchInitialBackoffMs: 0 }, "Delivery supervisor watch initial backoff"],
    [{ watchMaxBackoffMs: 0 }, "Delivery supervisor watch maximum backoff"],
  ] as const)("rejects invalid positive bounds in %j", (options, name) => {
    expect(() =>
      supervisorFor({ run: () => Promise.resolve({ status: "COMPLETED", pages: [] }) }, options),
    ).toThrow(`${name} must be a positive safe integer.`);
  });

  it("rejects a watch maximum below its initial reconnect delay", () => {
    expect(() =>
      supervisorFor(
        { run: () => Promise.resolve({ status: "COMPLETED", pages: [] }) },
        { watchInitialBackoffMs: 20, watchMaxBackoffMs: 10 },
      ),
    ).toThrow(
      "Delivery supervisor watch maximum backoff must not be smaller than initial backoff.",
    );
  });

  it("rejects a forged port even when it copies the controlled method shape", () => {
    const run = () => Promise.resolve({ status: "COMPLETED" as const, pages: [] });
    expect(
      () =>
        new DeliverySupervisor({
          source: {
            shardSnapshot: () => Promise.resolve([]),
            observeShardUpdates: () => emptyUpdates(),
            releaseExpired: () => Promise.resolve([]),
          },
          delivery: {
            run,
            runControlled: run,
          } as never,
          onMessage: () => Promise.resolve(),
        }),
    ).toThrow("DeliverySupervisor requires a Delivery built by DeliveryBuilder.");
  });

  it("runs a notified shard through one controlled epoch", async () => {
    let calls = 0;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => Promise.resolve([]),
      },
      delivery: qualifiedDelivery(
        {
          run: () => {
            calls += 1;
            return Promise.resolve({ status: "COMPLETED" as const, pages: [] });
          },
        },
        1,
      ),
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    supervisor.notify(ShardIndex.single());
    await supervisor.whenIdle();

    expect(calls).toBe(1);
    await supervisor.close();
  });

  it("keeps start, notify, and completed close boundary states idempotent", async () => {
    let calls = 0;
    const supervisor = supervisorFor({
      run: () => {
        calls += 1;
        return Promise.resolve({ status: "COMPLETED", pages: [] });
      },
    });

    supervisor.notify(newShard(0));
    await supervisor.start();
    await supervisor.start();
    supervisor.notify(newShard(0));
    await supervisor.whenIdle();
    await supervisor.close();
    await supervisor.close();
    supervisor.notify(newShard(0));

    expect(calls).toBe(1);
    await expect(supervisor.start()).rejects.toThrow("Delivery supervisor is closed.");
  });

  it("rejects invalid close grace without changing lifecycle state", async () => {
    const supervisor = supervisorFor({
      run: () => Promise.resolve({ status: "COMPLETED", pages: [] }),
    });

    expect(() => supervisor.close({ graceMs: -1 })).toThrow(
      "Delivery close grace must be a safe integer.",
    );
    await supervisor.start();
    await supervisor.close();
  });

  it("returns one in-flight close attempt to concurrent callers", async () => {
    const held = Promise.withResolvers<undefined>();
    const supervisor = supervisorFor({
      run: async () => {
        await held.promise;
        return { status: "COMPLETED", pages: [] };
      },
    });
    await supervisor.start();
    supervisor.notify(newShard(0));

    const first = supervisor.close({ graceMs: 1_000 });
    const second = supervisor.close({ graceMs: 1 });
    expect(second).toBe(first);
    held.resolve(undefined);
    await first;
  });

  it("coalesces a same-shard storm into one follow-up run", async () => {
    const first = Promise.withResolvers<undefined>();
    let calls = 0;
    const supervisor = supervisorFor({
      run: async () => {
        calls += 1;
        if (calls === 1) await first.promise;
        return { status: "COMPLETED", pages: [] };
      },
    });

    await supervisor.start();
    supervisor.notify(newShard(0));
    supervisor.notify(newShard(0));
    supervisor.notify(newShard(0));
    first.resolve(undefined);
    await supervisor.whenIdle();

    expect(calls).toBe(2);
    await supervisor.close();
  });

  it.each(["notification-before-snapshot", "snapshot-before-notification"] as const)(
    "coalesces %s into one owned non-empty generation",
    async (ordering) => {
      const fixture = realDeliveryFixture();
      const shard = ShardIndex.single();
      await fixture.receive("first", 1n, shard);
      const first = fixture.inbox.pauseAfter(1);
      const snapshot = Promise.withResolvers<readonly DeliveryShardUpdate[]>();
      const supervisor = fixture.supervisor({
        shardSnapshot: () =>
          ordering === "notification-before-snapshot"
            ? snapshot.promise
            : Promise.resolve([pendingUpdate(shard)]),
      });

      const starting = supervisor.start();
      if (ordering === "notification-before-snapshot") {
        await Promise.resolve();
        supervisor.notify(shard);
        await first.started.promise;
        snapshot.resolve([pendingUpdate(shard)]);
      } else {
        await first.started.promise;
        supervisor.notify(shard);
      }
      first.resume.resolve(undefined);
      await starting;
      await supervisor.whenIdle();

      // A direct worker scans the owned shard through its empty terminal read.
      expect(fixture.inbox.admissions).toBe(3);
      expect(fixture.registry.pickups).toEqual([shard.key(), shard.key()]);
      expect(fixture.registry.releases).toEqual([shard.key(), shard.key()]);
      expect(fixture.delivered).toEqual(["first"]);
      await supervisor.close();
    },
  );

  it("bounds a same-shard notification storm to one empty successor admission", async () => {
    const fixture = realDeliveryFixture();
    const shard = ShardIndex.single();
    await fixture.receive("storm", 1n, shard);
    const first = fixture.inbox.pauseAfter(1);
    const supervisor = fixture.supervisor();

    await supervisor.start();
    supervisor.notify(shard);
    await first.started.promise;
    for (let index = 0; index < 100; index += 1) supervisor.notify(shard);
    first.resume.resolve(undefined);
    await supervisor.whenIdle();

    expect(fixture.inbox.admissions).toBe(3);
    expect(fixture.registry.pickups).toHaveLength(2);
    expect(fixture.registry.releases).toHaveLength(2);
    expect(fixture.delivered).toEqual(["storm"]);
    await supervisor.close();
  });

  it("retains a row arriving after the first admission for its queued generation", async () => {
    const fixture = realDeliveryFixture();
    const shard = ShardIndex.single();
    await fixture.receive("first", 1n, shard);
    const first = fixture.inbox.pauseAfter(1);
    const supervisor = fixture.supervisor();

    await supervisor.start();
    supervisor.notify(shard);
    await first.started.promise;
    supervisor.notify(shard);
    await fixture.receive("after-first-admission", 2n, shard);
    first.resume.resolve(undefined);
    await supervisor.whenIdle();

    expect(fixture.inbox.admissions).toBe(4);
    expect(fixture.registry.pickups).toHaveLength(2);
    expect(fixture.registry.releases).toHaveLength(2);
    expect(fixture.delivered).toEqual(["first", "after-first-admission"]);
    await supervisor.close();
  });

  it("retains a row arriving during empty admission immediately before completion", async () => {
    const fixture = realDeliveryFixture();
    const shard = ShardIndex.single();
    await fixture.receive("first", 1n, shard);
    const first = fixture.inbox.pauseAfter(1);
    const empty = fixture.inbox.pauseAfter(2);
    const supervisor = fixture.supervisor();

    await supervisor.start();
    supervisor.notify(shard);
    await first.started.promise;
    supervisor.notify(shard);
    first.resume.resolve(undefined);
    await empty.started.promise;
    await fixture.receive("during-empty-admission", 2n, shard);
    supervisor.notify(shard);
    empty.resume.resolve(undefined);
    await supervisor.whenIdle();

    expect(fixture.inbox.admissions).toBe(4);
    expect(fixture.registry.pickups).toHaveLength(2);
    expect(fixture.registry.releases).toHaveLength(2);
    expect(fixture.delivered).toEqual(["first", "during-empty-admission"]);
    await supervisor.close();
  });

  it("rescans real overflowed work after retained pending capacity clears", async () => {
    const fixture = realDeliveryFixture(3);
    const endpoint = Promise.withResolvers<undefined>();
    const firstStarted = Promise.withResolvers<undefined>();
    fixture.onMessage = async (signalId) => {
      if (signalId !== "zero") return;
      firstStarted.resolve(undefined);
      await endpoint.promise;
    };
    for (let index = 0; index < 3; index += 1) {
      await fixture.receive(
        ["zero", "one", "two"][index] ?? "unused",
        BigInt(index + 1),
        newShard(index),
      );
    }
    let snapshots = 0;
    const supervisor = fixture.supervisor(
      {
        shardSnapshot: () => {
          snapshots += 1;
          return Promise.resolve(snapshots === 1 ? [] : [pendingUpdate(newShard(2))]);
        },
      },
      { concurrency: 1, pendingLimit: 1 },
    );

    await supervisor.start();
    supervisor.notify(newShard(0));
    await firstStarted.promise;
    supervisor.notify(newShard(1));
    supervisor.notify(newShard(2));
    endpoint.resolve(undefined);
    await supervisor.whenIdle();

    expect(snapshots).toBe(2);
    expect(fixture.inbox.admissions).toBe(6);
    expect(fixture.registry.pickups).toEqual(["0/3", "1/3", "2/3"]);
    expect(fixture.registry.releases).toEqual(["0/3", "1/3", "2/3"]);
    expect(fixture.delivered).toEqual(["zero", "one", "two"]);
    await supervisor.close();
  });

  it("fences an in-flight direct empty read, releases ownership, and reports bounded close", async () => {
    const fixture = realDeliveryFixture();
    const empty = fixture.inbox.pauseAfter(1);
    const supervisor = fixture.supervisor();

    await supervisor.start();
    supervisor.notify(ShardIndex.single());
    await empty.started.promise;
    const closing = supervisor.close({ graceMs: 0 });
    empty.resume.resolve(undefined);

    await expect(closing).rejects.toBeInstanceOf(DeliveryShutdownTimeoutError);
    expect(fixture.registry.pickups).toEqual(["0/1"]);
    expect(fixture.registry.releases).toEqual(["0/1"]);
    expect(fixture.completions).toBe(1);
  });

  it("settles one failed empty successor admission without spinning", async () => {
    const fixture = realDeliveryFixture();
    const shard = ShardIndex.single();
    await fixture.receive("first", 1n, shard);
    const first = fixture.inbox.pauseAfter(1);
    fixture.inbox.failAt = 2;
    const supervisor = fixture.supervisor();

    await supervisor.start();
    supervisor.notify(shard);
    await first.started.promise;
    supervisor.notify(shard);
    first.resume.resolve(undefined);
    await supervisor.whenIdle();

    expect(fixture.inbox.admissions).toBe(3);
    expect(fixture.registry.pickups).toHaveLength(2);
    expect(fixture.registry.releases).toHaveLength(2);
    expect(fixture.delivered).toEqual(["first"]);
    await supervisor.close();
  });

  it("bounds distinct active shards and drains retained pending work", async () => {
    const first = Promise.withResolvers<undefined>();
    const seen: number[] = [];
    const supervisor = supervisorFor(
      {
        run: async ({ shard }) => {
          const selected = requireShard(shard);
          seen.push(selected.index);
          if (selected.index === 0) await first.promise;
          return { status: "COMPLETED", pages: [] };
        },
      },
      { concurrency: 1, pendingLimit: 1 },
    );

    await supervisor.start();
    supervisor.notify(newShard(0));
    supervisor.notify(newShard(1));
    supervisor.notify(newShard(2));
    first.resolve(undefined);
    await supervisor.whenIdle();

    expect(seen).toEqual([0, 1]);
    await supervisor.close();
  });

  it("rescans an overflowed distinct shard after capacity becomes available", async () => {
    const first = Promise.withResolvers<undefined>();
    const seen: number[] = [];
    let snapshots = 0;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => {
          snapshots += 1;
          return Promise.resolve(
            snapshots === 1
              ? []
              : [{ shard: newShard(2), status: "NOT_PICKED" as const, messages: 1 }],
          );
        },
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => Promise.resolve([]),
      },
      delivery: qualifiedDelivery({
        run: async ({ shard }) => {
          const selected = requireShard(shard);
          seen.push(selected.index);
          if (selected.index === 0) await first.promise;
          return { status: "COMPLETED" as const, pages: [] };
        },
      }),
      onMessage: () => Promise.resolve(),
      concurrency: 1,
      pendingLimit: 1,
    });

    await supervisor.start();
    supervisor.notify(newShard(0));
    supervisor.notify(newShard(1));
    supervisor.notify(newShard(2));
    first.resolve(undefined);
    await supervisor.whenIdle();

    expect(seen).toEqual([0, 1, 2]);
    expect(snapshots).toBe(2);
    await supervisor.close();
  });

  it("discovers pending shards from the source snapshot", async () => {
    const seen: number[] = [];
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () =>
          Promise.resolve([
            { shard: new ShardIndex(1, 2), status: "NOT_PICKED", messages: 4 },
            { shard: new ShardIndex(0, 2), status: "NOT_PICKED", messages: 0 },
          ]),
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => Promise.resolve([]),
      },
      delivery: qualifiedDelivery(
        {
          run: ({ shard }) => {
            seen.push(requireShard(shard).index);
            return Promise.resolve({ status: "COMPLETED" as const, pages: [] });
          },
        },
        2,
      ),
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    await supervisor.whenIdle();

    expect(seen).toEqual([1]);
    await supervisor.close();
  });

  it("fails closed when stale-session release has an unknown outcome", async () => {
    let snapshots = 0;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => {
          snapshots += 1;
          return Promise.resolve([
            { shard: newShard(0), status: "NOT_PICKED" as const, messages: 1 },
          ]);
        },
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => Promise.reject(new Error("outcome unknown")),
      },
      delivery: qualifiedDelivery({
        run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }),
      }),
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();

    expect(snapshots).toBe(0);
    await expect(supervisor.close()).rejects.toThrow("Delivery supervisor release cleanup failed.");
  });

  it("fences a blocked run when close grace expires", async () => {
    const held = Promise.withResolvers<undefined>();
    const supervisor = supervisorFor({
      run: async () => {
        await held.promise;
        return { status: "COMPLETED", pages: [] };
      },
    });

    await supervisor.start();
    supervisor.notify(new ShardIndex(0, 3));
    await expect(supervisor.close({ graceMs: 0 })).rejects.toBeInstanceOf(
      DeliveryShutdownTimeoutError,
    );

    held.resolve(undefined);
    await supervisor.whenIdle();
  });

  it("drops retained queued work when close stops admission", async () => {
    const first = Promise.withResolvers<undefined>();
    const seen: number[] = [];
    const supervisor = supervisorFor(
      {
        run: async ({ shard }) => {
          const selected = requireShard(shard);
          seen.push(selected.index);
          if (selected.index === 0) await first.promise;
          return { status: "COMPLETED", pages: [] };
        },
      },
      { concurrency: 1, pendingLimit: 1 },
    );

    await supervisor.start();
    supervisor.notify(newShard(0));
    supervisor.notify(newShard(1));
    const closing = supervisor.close({ graceMs: 100 });
    first.resolve(undefined);
    await closing;

    expect(seen).toEqual([0]);
  });

  it("restarts a failed Admin watch with one bounded backoff timer", async () => {
    vi.useFakeTimers();
    try {
      const warn = vi.fn();
      const logger = { withMetadata: vi.fn(() => ({ warn })) };
      let watches = 0;
      let snapshots = 0;
      const supervisor = new DeliverySupervisor({
        source: {
          shardSnapshot: () => {
            snapshots += 1;
            return Promise.resolve([]);
          },
          observeShardUpdates: () => {
            watches += 1;
            return failingUpdates();
          },
          releaseExpired: () => Promise.resolve([]),
        },
        delivery: qualifiedDelivery({
          run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }),
        }),
        onMessage: () => Promise.resolve(),
        watchInitialBackoffMs: 10,
        watchMaxBackoffMs: 10,
      });
      deliverySupervisorAccess.installLogger(supervisor, logger as never);

      await supervisor.start();
      vi.runAllTicks();
      expect(watches).toBe(1);
      expect(snapshots).toBe(1);
      expect(logger.withMetadata).toHaveBeenCalledTimes(1);
      expect(logger.withMetadata).toHaveBeenCalledWith({
        operation: "delivery.watch",
        reasonCode: "failed",
      });
      expect(warn).toHaveBeenCalledWith("Delivery shard watch failed.");
      await vi.advanceTimersByTimeAsync(10);
      expect(watches).toBe(2);
      expect(snapshots).toBe(2);
      await supervisor.close({ graceMs: 10 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("admits only positive unpicked updates from a completed Admin watch", async () => {
    const seen: number[] = [];
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () =>
          finiteUpdates([
            { shard: newShard(0), status: "PICKED", messages: 1 },
            { shard: newShard(1), status: "NOT_PICKED", messages: 0 },
            { shard: newShard(2), status: "NOT_PICKED", messages: 1 },
          ]),
        releaseExpired: () => Promise.resolve([]),
      },
      delivery: qualifiedDelivery({
        run: ({ shard }) => {
          seen.push(requireShard(shard).index);
          return Promise.resolve({ status: "COMPLETED", pages: [] });
        },
      }),
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    await new Promise<void>((resolve) => setImmediate(resolve));
    await supervisor.whenIdle();

    expect(seen).toEqual([2]);
    await supervisor.close();
  });

  it("ignores an Admin update that settles after close", async () => {
    const update = Promise.withResolvers<
      IteratorResult<{
        shard: ShardIndex;
        status: "NOT_PICKED";
        messages: number;
      }>
    >();
    let calls = 0;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => ({
          [Symbol.asyncIterator]: () => ({
            next: () => update.promise,
          }),
        }),
        releaseExpired: () => Promise.resolve([]),
      },
      delivery: qualifiedDelivery({
        run: () => {
          calls += 1;
          return Promise.resolve({ status: "COMPLETED", pages: [] });
        },
      }),
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    await supervisor.close();
    update.resolve({
      done: false,
      value: { shard: newShard(0), status: "NOT_PICKED", messages: 1 },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(calls).toBe(0);
  });

  it("retries only incomplete release cleanup on a later close", async () => {
    let releases = 0;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => {
          releases += 1;
          return releases === 2 ? Promise.reject(new Error("release failed")) : Promise.resolve([]);
        },
      },
      delivery: qualifiedDelivery({
        run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }),
      }),
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    await expect(supervisor.close({ graceMs: 10 })).rejects.toThrow(
      "Delivery supervisor release cleanup failed.",
    );
    await expect(supervisor.close({ graceMs: 10 })).resolves.toBeUndefined();

    // One start recovery, one failed cleanup, and one retry; successful phases do not repeat.
    expect(releases).toBe(3);
  });

  it("bounds a blocked release cleanup and aborts its cleanup request", async () => {
    let releases = 0;
    let aborted = false;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: (_inactivity, options) => {
          releases += 1;
          if (releases === 1) return Promise.resolve([]);
          return new Promise((_, reject) => {
            options?.signal?.addEventListener("abort", () => {
              aborted = true;
              reject(new Error("release cleanup aborted"));
            });
          });
        },
      },
      delivery: qualifiedDelivery({
        run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }),
      }),
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    await expect(supervisor.close({ graceMs: 0 })).rejects.toBeInstanceOf(
      DeliveryShutdownTimeoutError,
    );
    expect(aborted).toBe(true);
  });

  it("does not overlap close cleanup with a noncooperative recovery release", async () => {
    const release = Promise.withResolvers<readonly unknown[]>();
    let releases = 0;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => {
          releases += 1;
          return release.promise;
        },
      },
      delivery: qualifiedDelivery({
        run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }),
      }),
      onMessage: () => Promise.resolve(),
    });

    const starting = supervisor.start();
    await Promise.resolve();
    await expect(supervisor.close({ graceMs: 0 })).rejects.toBeInstanceOf(
      DeliveryShutdownTimeoutError,
    );
    expect(releases).toBe(1);

    release.resolve([]);
    await starting;
    await expect(supervisor.close({ graceMs: 10 })).resolves.toBeUndefined();
    expect(releases).toBe(1);
  });

  it("reuses a timed-out noncooperative cleanup until it settles", async () => {
    const cleanup = Promise.withResolvers<readonly unknown[]>();
    let releases = 0;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => {
          releases += 1;
          return releases === 1 ? Promise.resolve([]) : cleanup.promise;
        },
      },
      delivery: qualifiedDelivery({
        run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }),
      }),
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    await expect(supervisor.close({ graceMs: 0 })).rejects.toBeInstanceOf(
      DeliveryShutdownTimeoutError,
    );
    await expect(supervisor.close({ graceMs: 0 })).rejects.toBeInstanceOf(
      DeliveryShutdownTimeoutError,
    );
    expect(releases).toBe(2);

    cleanup.resolve([]);
    await Promise.resolve();
    await expect(supervisor.close({ graceMs: 10 })).resolves.toBeUndefined();
    expect(releases).toBe(2);
  });

  it("cancels the Admin watch as soon as close stops admission", async () => {
    const withMetadata = vi.fn(() => ({ warn: vi.fn(), error: vi.fn() }));
    let watchSignal: AbortSignal | undefined;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: (options) => {
          watchSignal = options?.signal;
          return updatesUntilAborted(options?.signal);
        },
        releaseExpired: () => Promise.resolve([]),
      },
      delivery: qualifiedDelivery({
        run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }),
      }),
      onMessage: () => Promise.resolve(),
    });
    deliverySupervisorAccess.installLogger(supervisor, { withMetadata } as never);

    await supervisor.start();
    await Promise.resolve();
    await supervisor.close({ graceMs: 10 });

    expect(watchSignal?.aborted).toBe(true);
    expect(withMetadata).not.toHaveBeenCalled();
  });

  it("retains one recovery timer and releases all timer resources on close", async () => {
    vi.useFakeTimers();
    try {
      const supervisor = new DeliverySupervisor({
        source: {
          shardSnapshot: () => Promise.resolve([]),
          observeShardUpdates: (options) => updatesUntilAborted(options?.signal),
          releaseExpired: () => Promise.resolve([]),
        },
        delivery: qualifiedDelivery({
          run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }),
        }),
        onMessage: () => Promise.resolve(),
        recoveryMs: 10,
      });

      await supervisor.start();
      expect(vi.getTimerCount()).toBe(1);

      await supervisor.close({ graceMs: 10 });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sanitizes an unknown release-cleanup rejection", async () => {
    let releases = 0;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => {
          releases += 1;
          return releases === 1
            ? Promise.resolve([])
            : Promise.reject(Object.assign(new Error("private payload"), { actor: "private" }));
        },
      },
      delivery: qualifiedDelivery({
        run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }),
      }),
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    await expect(supervisor.close({ graceMs: 10 })).rejects.toMatchObject({
      name: "Error",
      message: "Delivery supervisor release cleanup failed.",
    });
  });
});

function realDeliveryFixture(shardCount = 1): RealDeliveryFixture {
  return new RealDeliveryFixture(shardCount);
}

class RealDeliveryFixture {
  readonly context = {
    name: `real-supervisor-${crypto.randomUUID()}`,
    multitenant: false,
  } as const;
  readonly storageFactory = new InMemoryStorageFactory();
  readonly inbox: AdmissionInbox;
  readonly registry: ObservedRegistry;
  readonly delivery: Delivery;
  readonly delivered: string[] = [];
  onMessage: ((signalId: string) => Promise<void>) | undefined;
  completions = 0;

  constructor(shardCount: number) {
    const seedDelivery = new DeliveryBuilder()
      .withContext(this.context)
      .withStorageFactory(this.storageFactory)
      .withNode("seed-node")
      .build();
    this.inbox = new AdmissionInbox(seedDelivery.inbox);
    this.registry = new ObservedRegistry(
      new ShardedWorkRegistry({ context: this.context, storageFactory: this.storageFactory }),
    );
    this.delivery = new DeliveryBuilder()
      .withContext(this.context)
      .withStorageFactory(this.storageFactory)
      .withStrategy(UniformAcrossAllShards.forNumber(shardCount))
      .withInbox(this.inbox)
      .withWorkRegistry(this.registry)
      .withMonitor(
        new FixtureMonitor(() => {
          this.completions += 1;
        }),
      )
      .withNode("worker-node")
      .build();
  }

  supervisor(
    source: Partial<DeliverySupervisorOptions["source"]> = {},
    bounds: Partial<Omit<DeliverySupervisorOptions, "source" | "delivery" | "onMessage">> = {},
  ): DeliverySupervisor {
    return new DeliverySupervisor({
      source: {
        shardSnapshot: source.shardSnapshot ?? (() => Promise.resolve([])),
        observeShardUpdates: source.observeShardUpdates ?? (() => emptyUpdates()),
        releaseExpired: source.releaseExpired ?? (() => Promise.resolve([])),
      },
      delivery: this.delivery,
      onMessage: async (message) => {
        this.delivered.push(message.signalId);
        await this.onMessage?.(message.signalId);
      },
      ...bounds,
    });
  }

  async receive(signalId: string, version: bigint, shard: ShardIndex): Promise<void> {
    await this.inbox.receive({
      inboxId: {
        targetId: Identifiers.pack("string", "target"),
        targetTypeUrl: "type.example.dev/Target",
      },
      signalId,
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard,
      whenReceived: new Date("2026-07-23T12:00:00.000Z"),
      version,
      signal: create(AnySchema, {
        typeUrl: "type.spine.io/spine.core.Event",
        value: toBinary(EventSchema, create(EventSchema)),
      }),
    });
  }
}

class AdmissionInbox implements DeliveryInbox {
  readonly sessionKind = "LEASED" as const;
  admissions = 0;
  failAt: number | undefined;
  readonly #delegate: DeliveryInbox;
  readonly #pauses = new Map<number, AdmissionPause>();

  constructor(delegate: DeliveryInbox) {
    this.#delegate = delegate;
  }

  pauseAfter(admission: number): AdmissionPause {
    const pause = {
      started: Promise.withResolvers<undefined>(),
      resume: Promise.withResolvers<undefined>(),
    };
    this.#pauses.set(admission, pause);
    return pause;
  }

  receive(input: InboxMessageInput, options?: DeliveryOperationOptions): Promise<InboxWriteResult> {
    return this.#delegate.receive(input, options);
  }

  async read(
    shard: ShardIndex,
    options?: InboxReadOptions & DeliveryOperationOptions,
  ): Promise<readonly InboxMessage[]> {
    this.admissions += 1;
    if (this.admissions === this.failAt) throw new Error("admission failed");
    const messages = await this.#delegate.read(shard, options);
    const pause = this.#pauses.get(this.admissions);
    if (pause !== undefined) {
      pause.started.resolve(undefined);
      await pause.resume.promise;
    }
    return messages;
  }

  readMessage(
    id: InboxMessageId,
    options?: DeliveryOperationOptions,
  ): Promise<InboxMessage | undefined> {
    return this.#delegate.readMessage(id, options);
  }

  markDelivered(
    message: InboxMessage,
    options?: DeliveryOperationOptions,
  ): Promise<InboxMessage | undefined> {
    return this.#delegate.markDelivered(message, options);
  }
}

interface AdmissionPause {
  readonly started: PromiseWithResolvers<undefined>;
  readonly resume: PromiseWithResolvers<undefined>;
}

class ObservedRegistry implements DeliveryWorkRegistry {
  readonly sessionKind = "LEASED" as const;
  readonly pickups: string[] = [];
  readonly releases: string[] = [];
  readonly #delegate: ShardedWorkRegistry;

  constructor(delegate: ShardedWorkRegistry) {
    this.#delegate = delegate;
  }

  async pickUp(
    shard: ShardIndex,
    worker: WorkerId,
    options?: DeliveryOperationOptions,
  ): Promise<DeliveryWorkSession | undefined> {
    void options;
    const session = await this.#delegate.pickUp(shard, worker);
    if (session !== undefined) this.pickups.push(shard.key());
    return session;
  }

  async renew(
    session: Extract<DeliveryWorkSession, { kind: "LEASED" }>,
    options?: DeliveryOperationOptions,
  ): Promise<Extract<DeliveryWorkSession, { kind: "LEASED" }> | undefined> {
    void options;
    return this.#delegate.renew(session);
  }

  validateOwnership(
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<DeliveryWorkSession | undefined> {
    if (session.kind !== "LEASED") return Promise.resolve(undefined);
    return this.renew(session, options);
  }

  async release(
    session: DeliveryWorkSession,
    options?: DeliveryOperationOptions,
  ): Promise<boolean> {
    void options;
    if (session.kind !== "LEASED") throw new Error("Observed registry requires a leased session.");
    const released = await this.#delegate.release(session);
    if (released) this.releases.push(session.shard.key());
    return released;
  }
}

class FixtureMonitor extends DeliveryMonitor {
  constructor(private readonly completed: () => void) {
    super();
  }
  override onDeliveryCompleted(): void {
    this.completed();
  }
}

function pendingUpdate(shard: ShardIndex): DeliveryShardUpdate {
  return { shard, status: "NOT_PICKED", messages: 1 };
}

function supervisorFor(
  delivery: {
    run: (options: DeliveryRunOptions) => Promise<{ status: "COMPLETED"; pages: [] }>;
  },
  bounds: Partial<Omit<DeliverySupervisorOptions, "source" | "delivery" | "onMessage">> = {},
): DeliverySupervisor {
  return new DeliverySupervisor({
    source: {
      shardSnapshot: () => Promise.resolve([]),
      observeShardUpdates: () => emptyUpdates(),
      releaseExpired: () => Promise.resolve([]),
    },
    delivery: qualifiedDelivery(delivery),
    onMessage: () => Promise.resolve(),
    ...bounds,
  });
}

function newShard(index: number): ShardIndex {
  return new ShardIndex(index, 3);
}

function qualifiedDelivery(
  delivery: {
    run: (options: DeliveryRunOptions) => Promise<{ status: "COMPLETED"; pages: [] }>;
  },
  shardCount = 3,
): Delivery {
  return new DeliveryBuilder()
    .withContext({ name: "supervisor-test", multitenant: false })
    .withStorageFactory(new InMemoryStorageFactory())
    .withStrategy(UniformAcrossAllShards.forNumber(shardCount))
    .withInbox(new RunnerInbox(delivery.run))
    .withWorkRegistry(new OpenRegistry())
    .withNode("test-node")
    .build();
}

class RunnerInbox implements DeliveryInbox {
  readonly sessionKind = "EXCLUSIVE" as const;
  readonly #run: (options: DeliveryRunOptions) => Promise<unknown>;

  constructor(run: (options: DeliveryRunOptions) => Promise<unknown>) {
    this.#run = run;
  }

  receive(): Promise<never> {
    return Promise.reject(new Error("RunnerInbox.receive is unused."));
  }

  async read(shard: ShardIndex): Promise<readonly InboxMessage[]> {
    await this.#run({ shard, onMessage: () => Promise.resolve() });
    return [];
  }

  readMessage(): Promise<undefined> {
    return Promise.resolve(undefined);
  }

  markDelivered(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

class OpenRegistry implements DeliveryWorkRegistry {
  readonly sessionKind = "EXCLUSIVE" as const;

  pickUp(shard: ShardIndex) {
    return Promise.resolve({ kind: "EXCLUSIVE" as const, shard });
  }

  validateOwnership(session: DeliveryWorkSession): Promise<DeliveryWorkSession | undefined> {
    return Promise.resolve(session);
  }

  release(
    _session: Parameters<DeliveryWorkRegistry["release"]>[0],
    _options?: DeliveryOperationOptions,
  ): Promise<boolean> {
    void _session;
    void _options;
    return Promise.resolve(true);
  }
}

function requireShard(shard: ShardIndex | undefined): ShardIndex {
  if (shard === undefined) throw new Error("A supervisor run must select a shard.");
  return shard;
}

function emptyUpdates(): AsyncIterable<never> {
  return {
    async *[Symbol.asyncIterator](): AsyncGenerator<never> {
      await Promise.resolve();
      yield* [] as never[];
    },
  };
}

function failingUpdates(): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<never> {
      return {
        next: () => Promise.reject(new Error("watch disconnected")),
      };
    },
  };
}

function finiteUpdates(
  updates: readonly {
    readonly shard: ShardIndex;
    readonly status: "PICKED" | "NOT_PICKED";
    readonly messages: number;
  }[],
): AsyncIterable<{
  readonly shard: ShardIndex;
  readonly status: "PICKED" | "NOT_PICKED";
  readonly messages: number;
}> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = updates[Symbol.iterator]();
      return {
        next: () => Promise.resolve(iterator.next()),
      };
    },
  };
}

function updatesUntilAborted(signal: AbortSignal | undefined): AsyncIterable<never> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<never> {
      return {
        next: () =>
          new Promise<IteratorResult<never>>((resolve) => {
            if (signal?.aborted) {
              resolve({ done: true, value: undefined as never });
              return;
            }
            signal?.addEventListener(
              "abort",
              () => {
                resolve({ done: true, value: undefined as never });
              },
              { once: true },
            );
          }),
      };
    },
  };
}
