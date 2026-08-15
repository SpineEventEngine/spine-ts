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

/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @typescript-eslint/require-await */

import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { Identifiers } from "@spine-event-engine/core";
import { WorkerIdSchema, type WorkerId } from "@spine-event-engine/proto/delivery";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Delivery, type DeliveryEndpointMessage } from "../../src/delivery/delivery.js";
import { DeliveryMonitor } from "../../src/delivery/delivery-monitor.js";
import type { DeliveryOperationOptions } from "../../src/delivery/delivery-ports.js";
import type { InboxReadOptions } from "../../src/delivery/inbox.js";
import { commitFenced } from "../../src/repository/commit-fence.js";
import { ShardIndex } from "../../src/index.js";

describe("Delivery direct worker", () => {
  it("reports exact acknowledgement through the callback shorthand", async () => {
    const shard = ShardIndex.single();
    const target = message("target", "target", shard);
    const rows = [target];
    let seen = 0;
    const delivery = createDelivery({
      rows,
      mark: async (row) => {
        remove(rows, row);
        return row;
      },
    });

    await expect(
      delivery.drainMessage(target, () => {
        seen += 1;
      }),
    ).resolves.toMatchObject({ acknowledged: true, run: { delivered: 1 } });
    expect(seen).toBe(1);
  });

  it("runs one owned delivered cleanup page after each delivery page and on an empty drain", async () => {
    const shard = ShardIndex.single();
    const pending = message("pending", "target", shard);
    const delivered = { ...pending, status: "DELIVERED" as const };
    let pendingReads = 0;
    let cleanupReads = 0;
    let removals = 0;
    const delivery = createDelivery({
      pageSize: 1,
      read: async (options) => {
        if (options?.statuses?.includes("DELIVERED")) {
          cleanupReads += 1;
          return cleanupReads === 1 ? [delivered] : [];
        }
        pendingReads += 1;
        return pendingReads === 1 ? [pending] : [];
      },
      remove: async () => {
        removals += 1;
        return true;
      },
    });

    await expect(delivery.drain(shard, { onMessage: () => undefined })).resolves.toMatchObject({
      status: "DRAINED",
      delivered: 1,
    });
    expect(cleanupReads).toBe(2);
    expect(removals).toBe(1);
  });

  it("stops cleanup when cancellation or ownership loss occurs and leaves the row for retry", async () => {
    const shard = ShardIndex.single();
    const delivered = { ...message("delivered", "target", shard), status: "DELIVERED" as const };
    const controller = new AbortController();
    let removals = 0;
    const delivery = createDelivery({
      read: async (options) => (options?.statuses?.includes("DELIVERED") ? [delivered] : []),
      remove: async () => {
        removals += 1;
        controller.abort();
        return true;
      },
    });
    await expect(
      delivery.drain(shard, {
        onMessage: () => undefined,
        operation: { signal: controller.signal },
      }),
    ).resolves.toMatchObject({ status: "STOPPED", delivered: 0 });
    expect(removals).toBe(1);
  });

  it("leaves a delivered row retryable when cancellation arrives before cleanup deletion", async () => {
    const shard = ShardIndex.single();
    const delivered = { ...message("delivered", "target", shard), status: "DELIVERED" as const };
    const controller = new AbortController();
    let removals = 0;
    const delivery = createDelivery({
      read: async (options) => {
        if (!options?.statuses?.includes("DELIVERED")) return [];
        controller.abort();
        return [delivered];
      },
      remove: async () => {
        removals += 1;
        return true;
      },
    });

    await expect(
      delivery.drain(shard, {
        onMessage: () => undefined,
        operation: { signal: controller.signal },
      }),
    ).resolves.toMatchObject({ status: "STOPPED", delivered: 0 });
    expect(removals).toBe(0);
  });

  it("removes every delivered row returned by one bounded cleanup page", async () => {
    const shard = ShardIndex.single();
    const delivered = [
      { ...message("first", "first", shard), status: "DELIVERED" as const },
      { ...message("second", "second", shard), status: "DELIVERED" as const },
    ];
    const removed: string[] = [];
    const delivery = createDelivery({
      pageSize: 2,
      read: async (options) => (options?.statuses?.includes("DELIVERED") ? delivered : []),
      remove: async (row) => {
        removed.push(row.signalId);
        return true;
      },
    });

    await expect(delivery.drain(shard, { onMessage: () => undefined })).resolves.toMatchObject({
      status: "DRAINED",
    });
    expect(removed).toEqual(["first", "second"]);
  });

  it("continues past one full protected cleanup page to remove a later eligible row", async () => {
    const shard = ShardIndex.single();
    const protectedRows = [
      { ...message("protected-one", "one", shard), status: "DELIVERED" as const },
      { ...message("protected-two", "two", shard), status: "DELIVERED" as const },
    ];
    const eligible = { ...message("eligible", "three", shard), status: "DELIVERED" as const };
    const catalog = [...protectedRows, eligible];
    const removed: string[] = [];
    const delivery = createDelivery({
      pageSize: 2,
      read: async (options) => {
        if (!options?.statuses?.includes("DELIVERED")) return [];
        const after = options.after?.messageId;
        const start =
          after === undefined ? 0 : catalog.findIndex((row) => row.id.value === after) + 1;
        return catalog.slice(start, start + 2);
      },
      remove: async (row) => {
        if (row.signalId === "eligible") removed.push(row.signalId);
        return row.signalId === "eligible";
      },
    });

    await expect(delivery.drain(shard, { onMessage: () => undefined })).resolves.toMatchObject({
      status: "DRAINED",
    });
    expect(removed).toEqual(["eligible"]);
  });

  it("stops when a refused cleanup deletion is followed by lost ownership", async () => {
    const shard = ShardIndex.single();
    const delivered = { ...message("delivered", "target", shard), status: "DELIVERED" as const };
    let validations = 0;
    const delivery = createDelivery({
      read: async (options) => (options?.statuses?.includes("DELIVERED") ? [delivered] : []),
      remove: async () => false,
      registry: {
        pickUp: async () => session(shard),
        renew: async () => (validations++ < 2 ? session(shard) : undefined),
        release: async () => true,
      },
    });

    await expect(delivery.drain(shard, { onMessage: () => undefined })).resolves.toMatchObject({
      status: "STOPPED",
    });
  });

  it("omits cleanup for custom Inbox ports and forwards operation deadlines to cleanup reads", async () => {
    const shard = ShardIndex.single();
    const observed: number[] = [];
    const delivery = createDelivery({
      read: async (options) => {
        if (options?.statuses?.includes("DELIVERED")) observed.push(options.timeoutMs!);
        return [];
      },
      remove: async () => true,
    });
    await delivery.drain(shard, { onMessage: () => undefined, operation: { timeoutMs: 123 } });
    expect(observed).toEqual([123]);

    let customCleanupReads = 0;
    await expect(
      createDelivery({
        read: async (options) => {
          if (options?.statuses?.includes("DELIVERED")) customCleanupReads += 1;
          return [];
        },
      }).drain(shard, { onMessage: () => undefined }),
    ).resolves.toMatchObject({ status: "DRAINED" });
    expect(customCleanupReads).toBe(0);
  });

  it("stops before cleanup deletion when the shard fence is lost", async () => {
    const shard = ShardIndex.single();
    let removals = 0;
    const delivery = createDelivery({
      read: async (options) =>
        options?.statuses?.includes("DELIVERED")
          ? [{ ...message("old", "target", shard), status: "DELIVERED" as const }]
          : [],
      remove: async () => {
        removals += 1;
        return true;
      },
      registry: {
        pickUp: async () => session(shard),
        renew: async () => undefined,
        release: async () => true,
      },
    });
    await expect(delivery.drain(shard, { onMessage: () => undefined })).resolves.toMatchObject({
      status: "STOPPED",
    });
    expect(removals).toBe(0);
  });

  it("stops after a delivery page when ownership is lost before its maintenance pass", async () => {
    const shard = ShardIndex.single();
    const rows = [message("one", "target", shard)];
    let ownsShard = true;
    let cleanupReads = 0;
    const delivery = createDelivery({
      rows,
      read: async (options) => {
        if (options?.statuses?.includes("DELIVERED")) {
          cleanupReads += 1;
          return [];
        }
        return rows;
      },
      mark: async (row) => {
        remove(rows, row);
        ownsShard = false;
        return row;
      },
      remove: async () => true,
      registry: {
        pickUp: async () => session(shard),
        renew: async () => (ownsShard ? session(shard) : undefined),
        release: async () => true,
      },
    });

    await expect(delivery.drain(shard, { onMessage: () => undefined })).resolves.toMatchObject({
      status: "STOPPED",
      delivered: 1,
    });
    expect(cleanupReads).toBe(0);
  });
  it("passes its complete opaque WorkerId to shard pickup and skips an owned shard", async () => {
    const shard = ShardIndex.single();
    const worker = workerId("node-a", "restart-a");
    let picked: WorkerId | undefined;
    const delivery = createDelivery({
      worker,
      registry: {
        pickUp: async (_shard, value) => {
          picked = value;
          return undefined;
        },
        release: async () => true,
      },
    });
    const run = await delivery.drain(shard, {
      onMessage: () => {
        throw new Error("must not dispatch");
      },
    });
    expect(picked).toMatchObject({ nodeId: { value: "node-a" }, value: "restart-a" });
    expect(run.status).toBe("SKIPPED");
  });

  it("renews before callback and durable acknowledgement", async () => {
    const shard = ShardIndex.single();
    const rows = [message("one", "target", shard)];
    let renewals = 0;
    let marks = 0;
    const delivery = createDelivery({
      rows,
      registry: {
        pickUp: async () => session(shard),
        renew: async () => {
          renewals += 1;
          return session(shard);
        },
        release: async () => true,
      },
      mark: async (row) => {
        marks += 1;
        remove(rows, row);
        return row;
      },
    });
    const run = await delivery.drain(shard, { onMessage: () => undefined });
    expect(run).toMatchObject({ status: "DRAINED", processed: 1, delivered: 1 });
    expect(renewals).toBeGreaterThanOrEqual(2);
    expect(marks).toBe(1);
  });

  it("fences callback when renewal is lost", async () => {
    const shard = ShardIndex.single();
    let dispatched = 0;
    const delivery = createDelivery({
      rows: [message("one", "target", shard)],
      registry: {
        pickUp: async () => session(shard),
        renew: async () => undefined,
        release: async () => true,
      },
    });
    const run = await delivery.drain(shard, {
      onMessage: () => {
        dispatched += 1;
      },
    });
    expect(run.status).toBe("STOPPED");
    expect(dispatched).toBe(0);
  });

  it("validates ownership at repository commit time", async () => {
    const shard = ShardIndex.single();
    const rows = [message("one", "target", shard)];
    let validations = 0;
    let commits = 0;
    const delivery = createDelivery({
      rows,
      registry: {
        pickUp: async () => session(shard),
        renew: async () => (++validations === 1 ? session(shard) : undefined),
        release: async () => true,
      },
    });

    const run = await delivery.drain(shard, {
      onMessage: async () => {
        await commitFenced({}, () => {
          commits += 1;
          return { status: "committed" };
        });
      },
    });

    expect(run).toMatchObject({ status: "STOPPED", delivered: 0, failed: 1 });
    expect(commits).toBe(0);
    expect(rows).toHaveLength(1);
  });

  it("contains a thrown renewal before callback or acknowledgement", async () => {
    const shard = ShardIndex.single();
    let callbacks = 0;
    let acknowledgements = 0;
    let releases = 0;
    const delivery = createDelivery({
      rows: [message("one", "target", shard)],
      registry: {
        pickUp: async () => session(shard),
        renew: async () => {
          throw new Error("renew failed");
        },
        release: async () => {
          releases += 1;
          return true;
        },
      },
      mark: async () => {
        acknowledgements += 1;
        throw new Error("must not acknowledge");
      },
    });
    await expect(
      delivery.drain(shard, {
        onMessage: () => {
          callbacks += 1;
        },
      }),
    ).resolves.toMatchObject({ status: "STOPPED" });
    expect(callbacks).toBe(0);
    expect(acknowledgements).toBe(0);
    expect(releases).toBe(1);
  });

  it.each([false, new Error("release failed")])(
    "returns FAILED when abort cleanup cannot release ownership",
    async (releaseResult) => {
      const shard = ShardIndex.single();
      const controller = new AbortController();
      const pickup = Promise.withResolvers<ReturnType<typeof session>>();
      let completion = 0;
      let releaseOptions: unknown;
      const delivery = createDelivery({
        monitor: new (class extends DeliveryMonitor {
          override onDeliveryCompleted() {
            completion += 1;
          }
        })(),
        registry: {
          pickUp: async () => pickup.promise,
          release: async (_session, operation) => {
            releaseOptions = operation;
            if (releaseResult instanceof Error) throw releaseResult;
            return releaseResult;
          },
        },
      });
      const run = delivery.drain(shard, {
        onMessage: () => undefined,
        operation: { signal: controller.signal },
      });
      pickup.resolve(session(shard));
      controller.abort();
      await expect(run).resolves.toMatchObject({ status: "FAILED" });
      expect(completion).toBe(0);
      expect(releaseOptions).toBeUndefined();
    },
  );

  it("forwards the exact operation signal to Inbox reads", async () => {
    const shard = ShardIndex.single();
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const delivery = createDelivery({
      read: async (options) => {
        received = options?.signal;
        return [];
      },
    });
    await delivery.drain(shard, {
      onMessage: () => undefined,
      operation: { signal: controller.signal },
    });
    expect(received).toBe(controller.signal);
  });

  it("defaults a failed reception to durable acknowledgement", async () => {
    const shard = ShardIndex.single();
    const rows = [message("failed", "target", shard)];
    const delivery = createDelivery({
      rows,
      mark: async (row) => {
        remove(rows, row);
        return row;
      },
    });
    const run = await delivery.drain(shard, {
      onMessage: () => {
        throw new Error("dispatch failed");
      },
    });
    expect(run).toMatchObject({ failed: 1, delivered: 1 });
    expect(rows).toEqual([]);
  });

  it("retains a failure message independently from later caller mutation", async () => {
    const shard = ShardIndex.single();
    const row = {
      ...message("failed", "target", shard),
      signal: create(AnySchema, { typeUrl: "type.example/signal", value: new Uint8Array([1, 2]) }),
      keepUntil: new Date(10_000),
    };
    const delivery = createDelivery({ rows: [row], mark: async () => undefined });
    const run = await delivery.drain(shard, {
      onMessage: () => {
        throw new Error("failed");
      },
    });
    const mutable = row as unknown as {
      id: { value: string };
      inboxId: { targetId: string };
      shard: ShardIndex;
      whenReceived: Date;
      keepUntil: Date;
      signal: { value: Uint8Array };
    };
    mutable.id.value = "mutated";
    mutable.inboxId.targetId = "mutated";
    mutable.shard = new ShardIndex(0, 2);
    mutable.whenReceived.setTime(20_000);
    mutable.keepUntil.setTime(30_000);
    mutable.signal.value[0] = 9;
    const fact = run.failures[0]!.message;
    expect(fact).toMatchObject({
      id: { value: "failed" },
      inboxId: { targetId: Identifiers.pack("string", "target") },
    });
    expect(fact.shard).toMatchObject({ index: 0, ofTotal: 1 });
    expect(fact.whenReceived.getTime()).not.toBe(20_000);
    expect(fact.keepUntil?.getTime()).toBe(10_000);
    expect(fact.signal?.value[0]).toBe(1);
    expect(() => {
      (fact.id as { value: string }).value = "changed";
    }).toThrow();
  });

  it("repeats a failed reception when the monitor selects repeat dispatch", async () => {
    const shard = ShardIndex.single();
    const rows = [message("failed", "target", shard)];
    let calls = 0;
    const delivery = createDelivery({
      rows,
      mark: async (row) => {
        remove(rows, row);
        return row;
      },
      monitor: new (class extends DeliveryMonitor {
        override onReceptionFailure(
          reception: Parameters<DeliveryMonitor["onReceptionFailure"]>[0],
        ) {
          return reception.repeatDispatching();
        }
      })(),
    });
    const run = await delivery.drain(shard, {
      onMessage: () => {
        calls += 1;
        if (calls === 1) throw new Error("first dispatch failed");
      },
    });
    expect(run).toMatchObject({ status: "DRAINED", failed: 1, delivered: 1 });
    expect(calls).toBe(2);
  });

  it.each([false, new Error("release failed")])(
    "contains unsuccessful shard release and does not complete the monitor",
    async (release) => {
      const shard = ShardIndex.single();
      const delivery = createDelivery({
        registry: {
          pickUp: async () => session(shard),
          release: async () => {
            if (release instanceof Error) throw release;
            return release;
          },
        },
      });
      const run = await delivery.drain(shard, { onMessage: () => undefined });
      expect(run.status).toBe("FAILED");
    },
  );

  it("blocks only a target after acknowledgement failure and does not spin", async () => {
    const shard = ShardIndex.single();
    const first = message("first", "same", shard);
    const blocked = message("blocked", "same", shard);
    const other = message("other", "other", shard);
    const rows = [first, blocked, other];
    const seen: string[] = [];
    let reads = 0;
    const delivery = createDelivery({
      rows,
      read: async () => {
        reads += 1;
        return [...rows];
      },
      mark: async (row) => {
        if (row.signalId === "first") throw new Error("durable mark failed");
        remove(rows, row);
        return row;
      },
    });
    await delivery.drain(shard, {
      onMessage: (row) => {
        seen.push(row.signalId);
        if (row.signalId === "first") throw new Error("dispatch failed");
      },
    });
    expect(seen).toEqual(["first", "other"]);
    expect(reads).toBe(2);
    expect(rows.map((row) => row.signalId)).toEqual(["first", "blocked"]);
  });

  it("advances beyond a full blocked page to deliver an independent target", async () => {
    const shard = ShardIndex.single();
    const blocked = message("blocked", "a", shard);
    const independent = message("independent", "b", shard);
    const catalog = [blocked, independent];
    const pending = new Set(catalog);
    const seen: string[] = [];
    const reads: (InboxReadOptions | undefined)[] = [];
    const delivery = createDelivery({
      pageSize: 1,
      read: async (options) => {
        reads.push(options);
        const after = options?.after?.messageId;
        const start =
          after === undefined ? 0 : catalog.findIndex((row) => row.id.value === after) + 1;
        return catalog.filter((row) => pending.has(row)).slice(start, start + 1);
      },
      mark: async (row) => {
        if (row.signalId === "blocked") throw new Error("acknowledgement failed");
        pending.delete(row);
        return row;
      },
    });
    const run = await delivery.drain(shard, {
      onMessage: (row) => {
        seen.push(row.signalId);
        if (row.signalId === "blocked") throw new Error("dispatch failed");
      },
    });
    expect(run).toMatchObject({ status: "DRAINED", delivered: 1, failed: 1 });
    expect(seen).toEqual(["blocked", "independent"]);
    expect(reads).toHaveLength(4);
    expect(reads[1]?.after).toMatchObject({ messageId: "blocked" });
    expect(reads[3]?.after).toMatchObject({ messageId: "blocked" });
    expect([...pending].map((row) => row.signalId)).toEqual(["blocked"]);
  });

  it("rescans rows that arrive while a preceding page is dispatched", async () => {
    const shard = ShardIndex.single();
    const rows = [message("first", "first", shard)];
    const seen: string[] = [];
    const delivery = createDelivery({
      rows,
      mark: async (row) => {
        remove(rows, row);
        return row;
      },
    });
    await delivery.drain(shard, {
      onMessage: (row) => {
        seen.push(row.signalId);
        if (row.signalId === "first") rows.push(message("second", "second", shard));
      },
    });
    expect(seen).toEqual(["first", "second"]);
  });

  it("releases only after an in-flight callback settles when aborted", async () => {
    const shard = ShardIndex.single();
    const rows = [message("one", "target", shard)];
    const controller = new AbortController();
    let release = 0;
    let resolve: (() => void) | undefined;
    const blocked = new Promise<void>((done) => {
      resolve = done;
    });
    const delivery = createDelivery({
      rows,
      registry: {
        pickUp: async () => session(shard),
        renew: async () => session(shard),
        release: async () => {
          release += 1;
          return true;
        },
      },
    });
    const run = delivery.runControlled({
      shard,
      signal: controller.signal,
      onMessage: async () => blocked,
    });
    await Promise.resolve();
    controller.abort();
    expect(release).toBe(0);
    resolve?.();
    await expect(run).resolves.toMatchObject({ status: "STOPPED" });
    expect(release).toBe(1);
  });

  it("does not dispatch unsupported labels", async () => {
    const shard = ShardIndex.single();
    const rows = [message("catch-up", "target", shard, "CATCH_UP")];
    let seen = 0;
    const delivery = createDelivery({ rows });
    await delivery.drain(shard, {
      onMessage: () => {
        seen += 1;
      },
    });
    expect(seen).toBe(0);
  });
});

function createDelivery(config: {
  rows?: DeliveryEndpointMessage[];
  worker?: WorkerId;
  registry?: {
    pickUp: (
      shard: ShardIndex,
      worker: WorkerId,
    ) => Promise<ReturnType<typeof session> | undefined>;
    renew?: () => Promise<ReturnType<typeof session> | undefined>;
    release: (current: ReturnType<typeof session>, operation?: unknown) => Promise<boolean>;
  };
  read?: (
    options?: InboxReadOptions & DeliveryOperationOptions,
  ) => Promise<DeliveryEndpointMessage[]>;
  mark?: (row: DeliveryEndpointMessage) => Promise<DeliveryEndpointMessage | undefined>;
  remove?: (row: DeliveryEndpointMessage) => Promise<boolean>;
  monitor?: DeliveryMonitor;
  pageSize?: number;
}): Delivery {
  const rows = config.rows ?? [];
  return new Delivery({
    context: { name: "DeliveryWorker", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
    worker: config.worker ?? workerId("node", "restart"),
    ...(config.monitor === undefined ? {} : { monitor: config.monitor }),
    ...(config.pageSize === undefined ? {} : { pageSize: config.pageSize }),
    inbox: {
      sessionKind: "LEASED",
      receive: async () => {
        throw new Error("not used");
      },
      read: async (_shard, options) => config.read?.(options) ?? [...rows],
      readMessage: async () => undefined,
      markDelivered: async (row) => config.mark?.(row) ?? row,
      ...(config.remove === undefined
        ? {}
        : { removeDelivered: async (row) => config.remove!(row) }),
    },
    workRegistry: {
      sessionKind: "LEASED",
      pickUp: async (shard, worker) => config.registry?.pickUp(shard, worker) ?? session(shard),
      renew: async (current) => config.registry?.renew?.() ?? current,
      validateOwnership: async (current) => config.registry?.renew?.() ?? current,
      release: async (current, operation) =>
        config.registry?.release(current as ReturnType<typeof session>, operation) ?? true,
    },
  });
}
function workerId(node: string, value: string): WorkerId {
  return create(WorkerIdSchema, { nodeId: { value: node }, value });
}
function session(shard: ShardIndex) {
  return {
    kind: "LEASED" as const,
    shard,
    worker: workerId("node", "restart"),
    pickedUpAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  };
}
function message(
  signalId: string,
  targetId: string,
  shard: ShardIndex,
  label: DeliveryEndpointMessage["label"] = "UPDATE_SUBSCRIBER",
): DeliveryEndpointMessage {
  return {
    id: { value: signalId, shard },
    inboxId: { targetId: Identifiers.pack("string", targetId), targetTypeUrl: "type" },
    signalId,
    label,
    status: "TO_DELIVER",
    shard,
    whenReceived: new Date(),
    version: 1n,
  };
}
function remove(rows: DeliveryEndpointMessage[], row: DeliveryEndpointMessage): void {
  const index = rows.indexOf(row);
  if (index >= 0) rows.splice(index, 1);
}
