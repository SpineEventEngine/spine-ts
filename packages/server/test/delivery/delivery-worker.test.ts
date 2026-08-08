import { create } from "@bufbuild/protobuf";
import { WorkerIdSchema, type WorkerId } from "@spine-event-engine/proto/delivery";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Delivery, type DeliveryEndpointMessage } from "../../src/delivery/delivery.js";
import { DeliveryMonitor } from "../../src/delivery/delivery-monitor.js";
import type { InboxReadOptions } from "../../src/delivery/inbox.js";
import { ShardIndex } from "../../src/index.js";

describe("Delivery direct worker", () => {
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
    release: () => Promise<boolean>;
  };
  read?: (options?: InboxReadOptions) => Promise<DeliveryEndpointMessage[]>;
  mark?: (row: DeliveryEndpointMessage) => Promise<DeliveryEndpointMessage | undefined>;
  monitor?: DeliveryMonitor;
  pageSize?: number;
}): Delivery {
  const rows = config.rows ?? [];
  return new Delivery({
    context: { name: "DeliveryWorker", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
    worker: config.worker ?? workerId("node", "restart"),
    monitor: config.monitor,
    pageSize: config.pageSize,
    inbox: {
      sessionKind: "LEASED",
      receive: async () => {
        throw new Error("not used");
      },
      read: async (_shard, options) => config.read?.(options) ?? [...rows],
      readMessage: async () => undefined,
      markDelivered: async (row) => config.mark?.(row) ?? row,
    },
    workRegistry: {
      sessionKind: "LEASED",
      pickUp: async (shard, worker) => config.registry?.pickUp(shard, worker) ?? session(shard),
      renew: async (current) => config.registry?.renew?.() ?? current,
      release: async () => config.registry?.release() ?? true,
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
    inboxId: { targetId, targetTypeUrl: "type" },
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
