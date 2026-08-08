import { create } from "@bufbuild/protobuf";
import { WorkerIdSchema, type WorkerId } from "@spine-event-engine/proto/delivery";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Delivery, type DeliveryEndpointMessage } from "../../src/delivery/delivery.js";
import { DeliveryMonitor } from "../../src/delivery/delivery-monitor.js";
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
    expect(picked).toEqual(worker);
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

function createDelivery(options: {
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
  read?: () => Promise<DeliveryEndpointMessage[]>;
  mark?: (row: DeliveryEndpointMessage) => Promise<DeliveryEndpointMessage | undefined>;
}): Delivery {
  const rows = options.rows ?? [];
  return new Delivery({
    context: { name: "DeliveryWorker", multitenant: false },
    storageFactory: new InMemoryStorageFactory(),
    worker: options.worker ?? workerId("node", "restart"),
    inbox: {
      sessionKind: "LEASED",
      receive: async () => {
        throw new Error("not used");
      },
      read: async () => options.read?.() ?? [...rows],
      readMessage: async () => undefined,
      markDelivered: async (row) => options.mark?.(row) ?? row,
      begin: async () => undefined,
    },
    workRegistry: {
      sessionKind: "LEASED",
      pickUp: async (shard, worker) => options.registry?.pickUp(shard, worker) ?? session(shard),
      renew: async (current) => options.registry?.renew?.() ?? current,
      release: async () => options.registry?.release() ?? true,
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
