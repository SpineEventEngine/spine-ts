import { describe, expect, it, vi } from "vitest";
import { InMemoryStorageFactory } from "@spine-ts/storage";

import {
  DeliveryBuilder,
  DeliveryShutdownTimeoutError,
  DeliverySupervisor,
  type DeliverySupervisorOptions,
  type Delivery,
  type DeliveryRunOptions,
  ShardIndex,
  UniformAcrossAllShards,
} from "../../src/index.js";
import type {
  DeliveryInbox,
  DeliveryOperationOptions,
  DeliveryWorkRegistry,
} from "../../src/delivery/delivery-ports.js";
import type { InboxMessage } from "../../src/delivery/inbox.js";

describe("DeliverySupervisor", () => {
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
        delivery: qualifiedDelivery({
          run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }),
        }),
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
      delivery: qualifiedDelivery({
        run: () => Promise.resolve({ status: "COMPLETED" as const, pages: [] }),
      }),
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

  begin(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
}

class OpenRegistry implements DeliveryWorkRegistry {
  readonly sessionKind = "EXCLUSIVE" as const;

  pickUp(shard: ShardIndex) {
    return Promise.resolve({ kind: "EXCLUSIVE" as const, shard });
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
