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

import { Code, ConnectError } from "@connectrpc/connect";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";

import { ApplicationWorkObserver } from "../../src/delivery/application-work-observer.js";
import { deliveryControls } from "../../src/delivery/delivery-builder.js";
import { Delivery } from "../../src/delivery/delivery.js";
import { DeliveryMonitor } from "../../src/delivery/delivery-monitor.js";
import { Inbox } from "../../src/delivery/inbox.js";
import { InboxStorage } from "../../src/delivery/inbox-storage.js";
import { ShardIndex } from "../../src/delivery/shard-index.js";
import { ShardedWorkRegistry } from "../../src/delivery/sharded-work-registry.js";
import { createMessage } from "./inbox-message-fixture.js";

/**
 * Delivers queued work notices until the caller aborts the stream.
 */
class Notices {
  readonly #pending: ShardIndex[] = [];
  #resume: ((shard: ShardIndex | undefined) => void) | undefined;
  opens = 0;

  /**
   * Adds one advisory shard notice.
   *
   * @param shard Selects the advertised shard.
   */
  push(shard: ShardIndex): void {
    const resume = this.#resume;
    if (resume === undefined) this.#pending.push(shard);
    else {
      this.#resume = undefined;
      resume(shard);
    }
  }

  /**
   * Streams every queued notice and stays silent while idle.
   *
   * @param options Cancels the stream.
   */
  async *observeAvailableShards(options: { signal?: AbortSignal } = {}): AsyncIterable<ShardIndex> {
    this.opens += 1;
    while (!options.signal?.aborted) {
      const shard =
        this.#pending.shift() ??
        (await new Promise<ShardIndex | undefined>((resolve) => {
          this.#resume = resolve;
          options.signal?.addEventListener(
            "abort",
            () => {
              resolve(undefined);
            },
            { once: true },
          );
        }));
      if (shard === undefined) return;
      yield shard;
    }
  }
}

/**
 * Creates a two-shard local runtime for admission tests.
 *
 * @returns Its core and public managed facade.
 */
function delivery() {
  const context = { name: "ApplicationWorkObserver", multitenant: false } as const;
  const storageFactory = new InMemoryStorageFactory();
  const inbox = new Inbox(new InboxStorage({ context, storageFactory }));
  const core = new Delivery({
    context,
    storageFactory,
    inbox,
    strategy: { shardCount: 2, shardFor: () => new ShardIndex(0, 2) },
  });
  return { core, inbox, publicDelivery: deliveryControls.managed(core) };
}

/**
 * Replaces the fixture's single shard with the selected shard.
 *
 * @param id Identifies the pending row.
 * @param shard Selects the delivery shard.
 * @returns The pending row for local storage.
 */
function row(id: string, shard: ShardIndex) {
  const message = createMessage(id, id, 1n);
  return { ...message, id: { value: id, shard }, shard };
}

describe("ApplicationWorkObserver", () => {
  it("rejects an invalid explicit concurrency bound and a start after close", async () => {
    const source = new Notices();
    for (const invalid of [0, -1, 1.5, Number.NaN]) {
      expect(
        () => new ApplicationWorkObserver(source, {} as never, "test", undefined, invalid),
      ).toThrow("maxConcurrentDeliveries must be a positive safe integer.");
    }
    const observer = new ApplicationWorkObserver(source, {} as never, "test", undefined, 1);
    await observer.close();
    await expect(observer.start()).rejects.toThrow("Delivery observation is closed.");
    expect(source.opens).toBe(0);
  });

  it("paces repeated transient disconnects with the prior increasing reconnect policy", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const source = {
        observeAvailableShards(): AsyncIterable<ShardIndex> {
          return {
            [Symbol.asyncIterator]() {
              attempts += 1;
              return { next: () => Promise.reject(new ConnectError("offline", Code.Unavailable)) };
            },
          };
        },
      };
      const observer = new ApplicationWorkObserver(
        source,
        {} as never,
        "http://offline",
        undefined,
        undefined,
      );
      await observer.start();
      await Promise.resolve();
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(99);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toBe(2);
      await vi.advanceTimersByTimeAsync(199);
      expect(attempts).toBe(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toBe(3);
      await observer.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs distinct notice-driven shards concurrently with no configured limit", async () => {
    const { core, inbox, publicDelivery } = delivery();
    const first = new ShardIndex(0, 2);
    const second = new ShardIndex(1, 2);
    await inbox.storage.write(row("parallel-first", first));
    await inbox.storage.write(row("parallel-second", second));
    const entered = new Set<string>();
    const release = Promise.withResolvers<undefined>();
    core.setDispatcher(async (message) => {
      entered.add(message.id.value);
      await release.promise;
    });
    const notices = new Notices();
    const observer = new ApplicationWorkObserver(
      notices,
      publicDelivery,
      "http://local",
      undefined,
      undefined,
    );
    await observer.start();
    notices.push(first);
    notices.push(second);
    await vi.waitFor(() => {
      expect(entered.size).toBe(2);
    });
    release.resolve(undefined);
    await observer.whenIdle();
    await observer.close();
    await core.close();
  });

  it("reconnects after a clean EOF and discovers retained work", async () => {
    const { core, inbox, publicDelivery } = delivery();
    const shard = new ShardIndex(0, 2);
    await inbox.storage.write(row("after-eof", shard));
    const seen: string[] = [];
    core.setDispatcher((message) => {
      seen.push(message.id.value);
    });
    let opens = 0;
    const source = {
      async *observeAvailableShards({ signal }: { signal?: AbortSignal } = {}) {
        opens += 1;
        if (opens === 1) return;
        yield shard;
        await new Promise<undefined>((resolve) =>
          signal?.addEventListener(
            "abort",
            () => {
              resolve(undefined);
            },
            { once: true },
          ),
        );
      },
    };
    const observer = new ApplicationWorkObserver(
      source,
      publicDelivery,
      "http://local",
      undefined,
      undefined,
    );
    await observer.start();
    await vi.waitFor(() => {
      expect(seen).toEqual(["after-eof"]);
    });
    expect(opens).toBe(2);
    await observer.close();
    await core.close();
  });

  it("logs a failed background run and admits a later shard notice", async () => {
    const context = { name: "FailedBackground", multitenant: false } as const;
    const storageFactory = new InMemoryStorageFactory();
    const inbox = new Inbox(new InboxStorage({ context, storageFactory }));
    const registry = new ShardedWorkRegistry({ context, storageFactory });
    const first = new ShardIndex(0, 2);
    const second = new ShardIndex(1, 2);
    await inbox.storage.write(row("failed-pickup", first));
    await inbox.storage.write(row("after-failure", second));
    const logs: { facts: Record<string, unknown>; message: string }[] = [];
    const logger = {
      withMetadata: (facts: Record<string, unknown>) => ({
        error: (message: string) => {
          logs.push({ facts, message });
        },
      }),
    };
    const core = new Delivery({
      context,
      storageFactory,
      inbox,
      workRegistry: {
        sessionKind: "LEASED",
        pickUp: (shard, worker) =>
          shard.key() === first.key()
            ? Promise.reject(new ConnectError("refused", Code.Unavailable))
            : registry.pickUp(shard, worker),
        renew: (session) => registry.renew(session),
        validateOwnership: (session) => {
          if (session.kind !== "LEASED") throw new Error("Expected a local lease.");
          return registry.validateOwnership(session);
        },
        release: (session) => {
          if (session.kind !== "LEASED") throw new Error("Expected a local lease.");
          return registry.release(session);
        },
      },
      strategy: { shardCount: 2, shardFor: () => first },
    });
    const seen: string[] = [];
    core.setDispatcher((message) => {
      seen.push(message.id.value);
    });
    const notices = new Notices();
    const observer = new ApplicationWorkObserver(
      notices,
      deliveryControls.managed(core),
      "http://delivery.test",
      logger as never,
      1,
    );
    await observer.start();
    notices.push(first);
    await vi.waitFor(() => {
      expect(logs).toHaveLength(1);
    });
    expect(logs[0]).toMatchObject({
      message: "Delivery work observation failed.",
      facts: {
        method: "spine.delivery.ShardObservingService.ObserveAll",
        endpoint: "http://delivery.test",
        reasonCode: "run_failed",
        errorCode: "Unavailable",
      },
    });
    notices.push(second);
    await vi.waitFor(() => {
      expect(seen).toEqual(["after-failure"]);
    });
    await observer.close();
    await core.close();
    await registry.close();
  });

  it("clears the shard reservation before a custom callback starts a new normal run", async () => {
    const { core, inbox } = delivery();
    const shard = new ShardIndex(0, 2);
    await inbox.storage.write(row("reenter", shard));
    let continueAfter = false;
    const monitor = new DeliveryMonitor();
    vi.spyOn(monitor, "shouldContinueAfter").mockImplementation(() => continueAfter);
    const reentering = new Delivery({
      context: { name: "Reentry", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox,
      monitor,
      strategy: { shardCount: 2, shardFor: () => shard },
    });
    const seen: string[] = [];
    reentering.setDispatcher((message) => {
      seen.push(message.id.value);
    });
    let second: Promise<unknown> | undefined;
    reentering.setShardObserver(() => {
      continueAfter = true;
      second = reentering.deliverMessagesFrom(shard);
    });

    await expect(reentering.deliverMessagesFrom(shard)).resolves.toEqual({ status: "stopped" });
    await expect(second).resolves.toEqual({ status: "completed" });
    expect(seen).toEqual(["reenter"]);
    await reentering.close();
    await core.close();
  });

  it("reports a post-release lookup error and admits a later empty attempt", async () => {
    const { core, inbox } = delivery();
    const shard = new ShardIndex(0, 2);
    await inbox.storage.write(row("lookup", shard));
    const faulty = Object.create(inbox) as Inbox;
    let lookups = 0;
    Object.defineProperty(faulty, "newestPending", {
      value: (index: ShardIndex) => {
        lookups += 1;
        if (lookups === 2) {
          return Promise.reject(new Error("post-release lookup failed"));
        }
        return inbox.newestPending(index);
      },
    });
    const run = new Delivery({
      context: { name: "LookupFailure", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox: faulty,
      strategy: { shardCount: 2, shardFor: () => shard },
    });
    run.setDispatcher(() => undefined);
    run.setShardObserver(() => undefined);

    await expect(run.deliverMessagesFrom(shard)).rejects.toThrow("post-release lookup failed");
    await expect(run.deliverMessagesFrom(shard)).resolves.toEqual({ status: "noWork" });
    await run.close();
    await core.close();
  });

  it("skips custom observation after an exceptional read and clears admission", async () => {
    const { core, inbox } = delivery();
    const shard = new ShardIndex(0, 2);
    await inbox.storage.write(row("read-failure", shard));
    const faulty = Object.create(inbox) as Inbox;
    let fail = true;
    Object.defineProperty(faulty, "read", {
      value: (index: ShardIndex) => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error("Inbox read failed"));
        }
        return inbox.read(index);
      },
    });
    const run = new Delivery({
      context: { name: "ReadFailure", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox: faulty,
      strategy: { shardCount: 2, shardFor: () => shard },
    });
    run.setDispatcher(() => undefined);
    const observer = vi.fn();
    run.setShardObserver(observer);

    await expect(run.deliverMessagesFrom(shard)).rejects.toThrow("Inbox read failed");
    expect(observer).not.toHaveBeenCalled();
    await expect(run.deliverMessagesFrom(shard)).resolves.toEqual({ status: "completed" });
    expect(observer).not.toHaveBeenCalled();
    await run.close();
    await core.close();
  });

  it("cancels an admitted signal-aware handler before waiting for shutdown", async () => {
    const { core, inbox, publicDelivery } = delivery();
    const shard = new ShardIndex(0, 2);
    await inbox.storage.write(row("await-abort", shard));
    const entered = Promise.withResolvers<undefined>();
    let aborted = false;
    core.setDispatcher(async (_message, signal) => {
      entered.resolve(undefined);
      await new Promise<void>((resolve) =>
        signal?.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        ),
      );
    });
    const notices = new Notices();
    const observer = new ApplicationWorkObserver(
      notices,
      publicDelivery,
      "http://local",
      undefined,
      1,
    );
    await observer.start();
    notices.push(shard);
    await entered.promise;
    await observer.close();
    expect(aborted).toBe(true);
    await core.close();
  });

  it("passes only the newest late pending row to a custom observer after release", async () => {
    const context = { name: "LateCustomObservation", multitenant: false } as const;
    const storageFactory = new InMemoryStorageFactory();
    const inbox = new Inbox(new InboxStorage({ context, storageFactory }));
    const registry = new ShardedWorkRegistry({ context, storageFactory });
    const shard = ShardIndex.single();
    await inbox.storage.write(row("first", shard));
    let added = false;
    const core = new Delivery({
      context,
      storageFactory,
      inbox,
      workRegistry: {
        sessionKind: "LEASED",
        pickUp: (index, worker) => registry.pickUp(index, worker),
        renew: (session) => registry.renew(session),
        validateOwnership: (session) => {
          if (session.kind !== "LEASED") throw new Error("Expected a local lease.");
          return registry.validateOwnership(session);
        },
        release: async (session) => {
          if (session.kind !== "LEASED") throw new Error("Expected a local lease.");
          if (!added) {
            added = true;
            await inbox.storage.write({ ...row("late-a", shard), version: 2n });
            await inbox.storage.write({ ...row("late-z", shard), version: 3n });
          }
          return registry.release(session);
        },
      },
    });
    const observed: string[] = [];
    core.setDispatcher(() => undefined);
    core.setShardObserver((message) => observed.push(message.id.value));

    await expect(core.deliverMessagesFrom(shard)).resolves.toEqual({ status: "completed" });
    expect(observed).toEqual(["late-z"]);
    await core.close();
    await registry.close();
  });

  it("starts idle, counts a manual run, and admits another shard after its reminder", async () => {
    const { core, inbox, publicDelivery } = delivery();
    const first = new ShardIndex(0, 2);
    const second = new ShardIndex(1, 2);
    await inbox.storage.write(row("first", first));
    await inbox.storage.write(row("second", second));
    const releaseFirst = Promise.withResolvers<undefined>();
    const enteredFirst = Promise.withResolvers<undefined>();
    const seen: string[] = [];
    core.setDispatcher(async (message) => {
      seen.push(message.id.value);
      if (message.id.value === "first") {
        enteredFirst.resolve(undefined);
        await releaseFirst.promise;
      }
    });
    const notices = new Notices();
    const observer = new ApplicationWorkObserver(
      notices,
      publicDelivery,
      "http://local",
      undefined,
      1,
    );
    await observer.start();
    expect(notices.opens).toBe(1);
    const manual = publicDelivery.deliverMessagesFrom(first);
    await enteredFirst.promise;
    notices.push(first);
    notices.push(second);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(seen).toEqual(["first"]);
    releaseFirst.resolve(undefined);
    await expect(manual).resolves.toEqual({ status: "completed" });
    await observer.whenIdle();
    notices.push(second);
    await vi.waitFor(() => {
      expect(seen).toContain("second");
    });
    await observer.close();
    await core.close();
  });

  it("rediscovers work after Unavailable and stops retrying Unimplemented", async () => {
    const { core, inbox, publicDelivery } = delivery();
    const shard = new ShardIndex(0, 2);
    await inbox.storage.write(row("reconnected", shard));
    const seen: string[] = [];
    core.setDispatcher((message) => {
      seen.push(message.id.value);
    });
    let opens = 0;
    const source = {
      async *observeAvailableShards({ signal }: { signal?: AbortSignal } = {}) {
        opens += 1;
        if (opens === 1) throw new ConnectError("temporary", Code.Unavailable);
        yield shard;
        await new Promise<void>((resolve) =>
          signal?.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          ),
        );
      },
    };
    const observer = new ApplicationWorkObserver(
      source,
      publicDelivery,
      "http://local",
      undefined,
      undefined,
    );
    await observer.start();
    await vi.waitFor(() => {
      expect(seen).toEqual(["reconnected"]);
    });
    expect(opens).toBe(2);
    await observer.close();
    await core.close();

    let unsupportedCalls = 0;
    const unsupported = new ApplicationWorkObserver(
      {
        observeAvailableShards() {
          unsupportedCalls += 1;
          throw new ConnectError("method unavailable", Code.Unimplemented);
        },
      },
      publicDelivery,
      "http://local",
      undefined,
      undefined,
    );
    await unsupported.start();
    await vi.waitFor(() => {
      expect(unsupported.failure).toMatchObject({ code: Code.Unimplemented });
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(unsupportedCalls).toBe(1);
    await unsupported.close();
  });
});
