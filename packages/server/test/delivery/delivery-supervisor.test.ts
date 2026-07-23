import { describe, expect, it, vi } from "vitest";

import {
  DeliveryShutdownTimeoutError,
  DeliverySupervisor,
  type DeliveryRunOptions,
  ShardIndex,
} from "../../src/index.js";

describe("DeliverySupervisor", () => {
  it("runs a notified shard through one controlled epoch", async () => {
    let calls = 0;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => Promise.resolve([]),
      },
      delivery: {
        run: () => {
          calls += 1;
          return Promise.resolve({ status: "COMPLETED" as const, pages: [] });
        },
      },
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    supervisor.notify(ShardIndex.single());
    await supervisor.whenIdle();

    expect(calls).toBe(1);
    await supervisor.close();
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
      delivery: {
        run: async ({ shard }) => {
          const selected = requireShard(shard);
          seen.push(selected.index);
          if (selected.index === 0) await first.promise;
          return { status: "COMPLETED" as const, pages: [] };
        },
      },
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
      delivery: {
        run: ({ shard }) => {
          seen.push(requireShard(shard).index);
          return Promise.resolve({ status: "COMPLETED" as const, pages: [] });
        },
      },
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
          return Promise.resolve([{ shard: newShard(0), status: "NOT_PICKED" as const, messages: 1 }]);
        },
        observeShardUpdates: () => emptyUpdates(),
        releaseExpired: () => Promise.reject(new Error("outcome unknown")),
      },
      delivery: { run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }) },
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

  it("restarts a failed Admin watch with one bounded backoff timer", async () => {
    vi.useFakeTimers();
    try {
      let watches = 0;
      const supervisor = new DeliverySupervisor({
        source: {
          shardSnapshot: () => Promise.resolve([]),
          observeShardUpdates: () => {
            watches += 1;
            return failingUpdates();
          },
          releaseExpired: () => Promise.resolve([]),
        },
        delivery: { run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }) },
        onMessage: () => Promise.resolve(),
        watchInitialBackoffMs: 10,
        watchMaxBackoffMs: 10,
      });

      await supervisor.start();
      vi.runAllTicks();
      expect(watches).toBe(1);
      await vi.advanceTimersByTimeAsync(10);
      expect(watches).toBe(2);
      await supervisor.close({ graceMs: 10 });
    } finally {
      vi.useRealTimers();
    }
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
      delivery: { run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }) },
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
      delivery: { run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }) },
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    await expect(supervisor.close({ graceMs: 0 })).rejects.toBeInstanceOf(
      DeliveryShutdownTimeoutError,
    );
    expect(aborted).toBe(true);
  });

  it("cancels the Admin watch as soon as close stops admission", async () => {
    let watchSignal: AbortSignal | undefined;
    const supervisor = new DeliverySupervisor({
      source: {
        shardSnapshot: () => Promise.resolve([]),
        observeShardUpdates: (options) => {
          watchSignal = options?.signal;
          return emptyUpdates();
        },
        releaseExpired: () => Promise.resolve([]),
      },
      delivery: { run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }) },
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    await Promise.resolve();
    await supervisor.close({ graceMs: 10 });

    expect(watchSignal?.aborted).toBe(true);
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
        delivery: { run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }) },
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
      delivery: { run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }) },
      onMessage: () => Promise.resolve(),
    });

    await supervisor.start();
    await expect(supervisor.close({ graceMs: 10 })).rejects.toMatchObject({
      name: "Error",
      message: "Delivery supervisor release cleanup failed.",
    });
  });
});

function supervisorFor(
  delivery: {
    run: (options: DeliveryRunOptions) => Promise<{ status: "COMPLETED"; pages: [] }>;
  },
  bounds: { concurrency?: number; pendingLimit?: number } = {},
): DeliverySupervisor {
  return new DeliverySupervisor({
    source: {
      shardSnapshot: () => Promise.resolve([]),
      observeShardUpdates: () => emptyUpdates(),
      releaseExpired: () => Promise.resolve([]),
    },
    delivery,
    onMessage: () => Promise.resolve(),
    ...bounds,
  });
}

function newShard(index: number): ShardIndex {
  return new ShardIndex(index, 3);
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
