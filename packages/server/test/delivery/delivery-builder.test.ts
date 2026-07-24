import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { afterEach, describe, expect, expectTypeOf, it } from "vitest";

import {
  DeliveryBuilder,
  type DeliveryMonitor,
  EnvironmentType,
  ServerEnvironment,
  ShardIndex,
  ShardedWorkRegistry,
  UniformAcrossAllShards,
} from "../../src/index.js";
import { resetServerEnvironmentForTest } from "../../src/testing/index.js";

afterEach(async () => {
  await resetServerEnvironmentForTest();
});

describe("DeliveryBuilder", () => {
  it("rejects empty target coordinates for uniform shard assignment", () => {
    const strategy = UniformAcrossAllShards.singleShard();

    expect(() => strategy.shardFor("", "type.example.dev/Task")).toThrow(
      "Delivery target ID must be a non-empty string.",
    );
    expect(() => strategy.shardFor("task", "")).toThrow(
      "Delivery target type must be a non-empty string.",
    );
  });

  it("runs through supplied exclusive inbox and registry ports without renewal", async () => {
    const shard = ShardIndex.single();
    const message = {
      id: { value: "message", shard },
      inboxId: { targetId: "id", targetTypeUrl: "type" },
      signalId: "signal",
      label: "UPDATE_SUBSCRIBER" as const,
      status: "TO_DELIVER" as const,
      shard,
      whenReceived: new Date(),
      version: 1n,
    };
    let completed = 0;
    let released = 0;
    let renewed = 0;
    const work = {
      message,
      synchronize: () => Promise.resolve(),
      complete: () => Promise.resolve(++completed > 0),
      abandon: () => Promise.resolve(),
    };
    const inbox = {
      sessionKind: "EXCLUSIVE" as const,
      receive: () => Promise.resolve({ outcome: "WRITTEN" as const, message }),
      read: () => Promise.resolve([message]),
      readMessage: () => Promise.resolve(message),
      begin: () => Promise.resolve(work),
    };
    const registry = {
      sessionKind: "EXCLUSIVE" as const,
      pickUp: () => Promise.resolve({ kind: "EXCLUSIVE" as const, shard }),
      renew: () => Promise.resolve(((renewed += 1), undefined)),
      release: () => Promise.resolve(((released += 1), true)),
    };
    const seen: string[] = [];
    const result = await new DeliveryBuilder()
      .withStorageFactory(new InMemoryStorageFactory())
      .withInbox(inbox)
      .withWorkRegistry(registry)
      .build()
      .run({
        onMessage: (value) => {
          seen.push(value.signalId);
        },
      });
    expect(result.status).toBe("COMPLETED");
    expect(seen).toEqual(["signal"]);
    expect(completed).toBe(1);
    expect(released).toBe(1);
    expect(renewed).toBe(0);
  });
  it("accepts a supplied structural inbox port", () => {
    const inbox = {
      sessionKind: "LEASED" as const,
      receive: () => Promise.reject(new Error("not used")),
      read: () => Promise.resolve([]),
      readMessage: () => Promise.resolve(undefined),
      begin: () => Promise.resolve(undefined),
    };

    expect(new DeliveryBuilder().withInbox(inbox).build().inbox).toBe(inbox);
  });
  it("fails fast when supplied inbox and registry session kinds differ", () => {
    const inbox = {
      sessionKind: "EXCLUSIVE" as const,
      receive: () => Promise.reject(new Error("not used")),
      read: () => Promise.resolve([]),
      readMessage: () => Promise.resolve(undefined),
      begin: () => Promise.resolve(undefined),
    };
    const registry = {
      sessionKind: "LEASED" as const,
      pickUp: () => Promise.resolve(undefined),
      release: () => Promise.resolve(false),
    };

    expect(() => new DeliveryBuilder().withInbox(inbox).withWorkRegistry(registry).build()).toThrow(
      "Delivery inbox and work registry session kinds must match.",
    );
  });
  it("compares each supplied port with the resolved local default session kind", () => {
    const remoteInbox = {
      sessionKind: "EXCLUSIVE" as const,
      receive: () => Promise.reject(new Error("not used")),
      read: () => Promise.resolve([]),
      readMessage: () => Promise.resolve(undefined),
      begin: () => Promise.resolve(undefined),
    };
    const remoteRegistry = {
      sessionKind: "EXCLUSIVE" as const,
      pickUp: () => Promise.resolve(undefined),
      release: () => Promise.resolve(false),
    };

    expect(() => new DeliveryBuilder().withInbox(remoteInbox).build()).toThrow(
      "Delivery inbox and work registry session kinds must match.",
    );
    expect(() => new DeliveryBuilder().withWorkRegistry(remoteRegistry).build()).toThrow(
      "Delivery inbox and work registry session kinds must match.",
    );
    expect(() =>
      new DeliveryBuilder().withInbox({ ...remoteInbox, sessionKind: "LEASED" }).build(),
    ).not.toThrow();
    expect(() =>
      new DeliveryBuilder().withWorkRegistry({ ...remoteRegistry, sessionKind: "LEASED" }).build(),
    ).not.toThrow();
  });
  it("rejects either direction of supplied session-kind mismatch and accepts a matching pair", () => {
    const inbox = {
      sessionKind: "LEASED" as const,
      receive: () => Promise.reject(new Error("not used")),
      read: () => Promise.resolve([]),
      readMessage: () => Promise.resolve(undefined),
      begin: () => Promise.resolve(undefined),
    };
    const exclusiveRegistry = {
      sessionKind: "EXCLUSIVE" as const,
      pickUp: () => Promise.resolve(undefined),
      release: () => Promise.resolve(false),
    };
    const leasedRegistry = { ...exclusiveRegistry, sessionKind: "LEASED" as const };

    expect(() =>
      new DeliveryBuilder().withInbox(inbox).withWorkRegistry(exclusiveRegistry).build(),
    ).toThrow("Delivery inbox and work registry session kinds must match.");
    expect(() =>
      new DeliveryBuilder().withInbox(inbox).withWorkRegistry(leasedRegistry).build(),
    ).not.toThrow();
  });
  it("uses the singleton storage and node defaults for one immutable delivery", () => {
    const storageFactory = new InMemoryStorageFactory();
    ServerEnvironment.when(EnvironmentType.Local).use({ storageFactory });

    const delivery = new DeliveryBuilder().build();

    expect(delivery.storageFactory).toBe(storageFactory);
    expect(delivery.node).toBe(ServerEnvironment.instance().nodeId);
    expect(delivery.context).toEqual({ name: "__System_Delivery__", multitenant: false });
    expect(delivery.strategy.shardFor("target", "type.example.dev/Task")).toEqual(
      ShardIndex.single(),
    );
  });

  it("runs finite pages until the shard is idle", async () => {
    const delivery = new DeliveryBuilder()
      .withContext({ name: "Tasks", multitenant: false })
      .withStorageFactory(new InMemoryStorageFactory())
      .withPageSize(1)
      .build();
    await delivery.inbox.receive({
      inboxId: { targetId: "task-1", targetTypeUrl: "type.example.dev/Task" },
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-23T05:00:00.000Z"),
      version: 1n,
    });
    const seen: string[] = [];

    const result = await delivery.run({
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(result.status).toBe("COMPLETED");
    expect(result.pages).toHaveLength(1);
    expect(seen).toEqual(["signal-1"]);
  });

  it("continues past a bounded unsupported prefix to a supported tail", async () => {
    const delivery = new DeliveryBuilder()
      .withContext({ name: "Tasks", multitenant: false })
      .withStorageFactory(new InMemoryStorageFactory())
      .withPageSize(1)
      .withBatchSize(3)
      .build();
    for (let index = 1; index <= 1_001; index += 1) {
      await receive(delivery, `unsupported-${String(index)}`, BigInt(index), "CATCH_UP");
    }
    await receive(delivery, "supported-tail", 1_002n);
    const seen: string[] = [];

    const result = await delivery.run({
      onMessage(message) {
        seen.push(message.signalId);
      },
    });

    expect(result.status).toBe("COMPLETED");
    expect(seen).toEqual(["supported-tail"]);
  });

  it("stops after a monitor-cancelled page and reports stable observations", async () => {
    const events: string[] = [];
    const delivery = new DeliveryBuilder()
      .withContext({ name: "Tasks", multitenant: false })
      .withStorageFactory(new InMemoryStorageFactory())
      .withPageSize(1)
      .withMonitor({
        onStarted() {
          events.push("started");
        },
        onPage() {
          events.push("page");
          return false;
        },
        onCompleted(result) {
          events.push(result.status);
        },
      })
      .build();
    await delivery.inbox.receive({
      inboxId: { targetId: "task-1", targetTypeUrl: "type.example.dev/Task" },
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-23T05:00:00.000Z"),
      version: 1n,
    });

    const result = await delivery.run({ onMessage: () => undefined });

    expect(result.status).toBe("STOPPED");
    expect(events).toEqual(["started", "page", "STOPPED"]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);
  });

  it("reports a failed page before the terminal result", async () => {
    const events: string[] = [];
    const delivery = new DeliveryBuilder()
      .withContext({ name: "Tasks", multitenant: false })
      .withStorageFactory(new InMemoryStorageFactory())
      .withMonitor({
        onStarted() {
          events.push("started");
        },
        onPage() {
          events.push("page");
        },
        onFailure() {
          events.push("failed");
        },
        onCompleted(result) {
          events.push(result.status);
        },
      })
      .build();
    await delivery.inbox.receive({
      inboxId: { targetId: "task-1", targetTypeUrl: "type.example.dev/Task" },
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-23T05:00:00.000Z"),
      version: 1n,
    });

    const result = await delivery.run({
      onMessage() {
        throw new Error("endpoint failed");
      },
    });

    expect(result.status).toBe("FAILED");
    expect(events).toEqual(["started", "page", "failed", "FAILED"]);
    const page = result.pages.at(0);
    expect(page).toEqual({
      status: "FAILED",
      processed: 1,
      accepted: 1,
      delivered: 0,
      failed: 1,
    });
    expect(Object.isFrozen(page)).toBe(true);
    expect(page === undefined ? undefined : "failures" in page).toBe(false);
  });

  it("uses the configured work registry for shard pickup", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const context = { name: "Tasks", multitenant: false };
    recordedPickups = [];
    const registry = new RecordingRegistry({ context, storageFactory });
    const delivery = new DeliveryBuilder()
      .withContext(context)
      .withStorageFactory(storageFactory)
      .withWorkRegistry(registry)
      .build();

    await delivery.run({ onMessage: () => undefined });

    expect(recordedPickups).toEqual([ShardIndex.single().key()]);
  });

  it("reports an already-owned shard without reporting a start", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const context = { name: "Tasks", multitenant: false };
    const registry = new ShardedWorkRegistry({ context, storageFactory });
    const session = await registry.pickUp(ShardIndex.single(), "node-owner");
    const events: string[] = [];
    const delivery = new DeliveryBuilder()
      .withContext(context)
      .withStorageFactory(storageFactory)
      .withWorkRegistry(registry)
      .withMonitor({
        onStarted() {
          events.push("started");
        },
        onSkipped() {
          events.push("skipped");
        },
        onCompleted(result) {
          events.push(result.status);
        },
      })
      .build();

    const result = await delivery.run({ onMessage: () => undefined });

    expect(session).toBeDefined();
    expect(result.status).toBe("SKIPPED");
    expect(events).toEqual(["skipped", "SKIPPED"]);
  });

  it.each(["onStarted", "onPage", "onCompleted"] as const)(
    "releases the shard when %s throws",
    async (hook) => {
      const storageFactory = new InMemoryStorageFactory();
      const context = { name: "Tasks", multitenant: false };
      const registry = new ShardedWorkRegistry({ context, storageFactory });
      const failure = new Error(`${hook} failed`);
      const monitor: DeliveryMonitor = {
        ...(hook === "onStarted" ? { onStarted: () => raise(failure) } : {}),
        ...(hook === "onPage" ? { onPage: () => raise(failure) } : {}),
        ...(hook === "onCompleted" ? { onCompleted: () => raise(failure) } : {}),
      };
      const delivery = new DeliveryBuilder()
        .withContext(context)
        .withStorageFactory(storageFactory)
        .withWorkRegistry(registry)
        .withMonitor(monitor)
        .withNode("node-a")
        .build();

      await expect(delivery.run({ onMessage: () => undefined })).rejects.toBe(failure);
      const next = await registry.pickUp(ShardIndex.single(), "node-b");

      expect(next).toBeDefined();
      if (next !== undefined) {
        await registry.release(next);
      }
    },
  );

  it("rejects a throwing failure hook without completion and releases its shard", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const context = { name: "Tasks", multitenant: false };
    const registry = new ShardedWorkRegistry({ context, storageFactory });
    const failure = new Error("onFailure failed");
    const events: string[] = [];
    const delivery = new DeliveryBuilder()
      .withContext(context)
      .withStorageFactory(storageFactory)
      .withWorkRegistry(registry)
      .withMonitor({
        onFailure() {
          events.push("failure");
          throw failure;
        },
        onCompleted() {
          events.push("completed");
        },
      })
      .withNode("node-a")
      .build();
    await receive(delivery, "signal-1", 1n);

    await expect(
      delivery.run({
        onMessage() {
          throw new Error("endpoint failed");
        },
      }),
    ).rejects.toBe(failure);
    expect(events).toEqual(["failure"]);
    const next = await registry.pickUp(ShardIndex.single(), "node-b");
    expect(next).toBeDefined();
    if (next !== undefined) {
      await registry.release(next);
    }
  });

  it("rejects a throwing skipped hook without completion or disturbing the owner", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const context = { name: "Tasks", multitenant: false };
    const registry = new ShardedWorkRegistry({ context, storageFactory });
    const owner = await registry.pickUp(ShardIndex.single(), "node-owner");
    const failure = new Error("onSkipped failed");
    const events: string[] = [];
    const delivery = new DeliveryBuilder()
      .withContext(context)
      .withStorageFactory(storageFactory)
      .withWorkRegistry(registry)
      .withMonitor({
        onSkipped() {
          events.push("skipped");
          throw failure;
        },
        onCompleted() {
          events.push("completed");
        },
      })
      .withNode("node-a")
      .build();

    await expect(delivery.run({ onMessage: () => undefined })).rejects.toBe(failure);
    expect(events).toEqual(["skipped"]);
    await expect(registry.pickUp(ShardIndex.single(), "node-b")).resolves.toBeUndefined();
    expect(owner).toBeDefined();
    if (owner !== undefined) {
      await registry.release(owner);
    }
    const next = await registry.pickUp(ShardIndex.single(), "node-b");
    expect(next).toBeDefined();
    if (next !== undefined) {
      await registry.release(next);
    }
  });

  it("rejects a supplied work registry from another storage context", () => {
    const context = { name: "Tasks", multitenant: false };
    const storageFactory = new InMemoryStorageFactory();
    const registry = new ShardedWorkRegistry({
      context: { name: "Other", multitenant: false },
      storageFactory,
    });

    expect(() =>
      new DeliveryBuilder()
        .withContext(context)
        .withStorageFactory(storageFactory)
        .withWorkRegistry(registry)
        .withNode("node-a")
        .build(),
    ).toThrow("Delivery work registry must use the delivery storage context and factory.");
  });

  it("rejects a supplied work registry from another storage factory", () => {
    const context = { name: "Tasks", multitenant: false };
    const registry = new ShardedWorkRegistry({
      context,
      storageFactory: new InMemoryStorageFactory(),
    });

    expect(() =>
      new DeliveryBuilder()
        .withContext(context)
        .withStorageFactory(new InMemoryStorageFactory())
        .withWorkRegistry(registry)
        .withNode("node-a")
        .build(),
    ).toThrow("Delivery work registry must use the delivery storage context and factory.");
  });

  it("rejects invalid finite builder bounds and target strategy inputs", () => {
    const builder = new DeliveryBuilder();

    expect(() => builder.withPageSize(0)).toThrow(
      "Delivery page size must be a positive safe integer.",
    );
    expect(() => builder.withBatchSize(Number.POSITIVE_INFINITY)).toThrow(
      "Delivery batch size must be a positive safe integer.",
    );
    expect(() => builder.withNode("")).toThrow("Delivery node must be a non-empty string.");
    expect(() => builder.withContext({ name: "", multitenant: false })).toThrow(
      "Delivery storage context name must be a non-empty string.",
    );
    expect(() => UniformAcrossAllShards.forNumber(0)).toThrow(
      "Delivery shard count must be a positive safe integer.",
    );
  });

  it.each([0, Number.NaN, 1.5])(
    "rejects a custom strategy with invalid shard count %s",
    (shardCount) => {
      const strategy = {
        shardCount,
        shardFor: () => ShardIndex.single(),
      };

      expect(() => new DeliveryBuilder().withStrategy(strategy)).toThrow(
        "Delivery strategy shard count must be a positive safe integer.",
      );
    },
  );

  it("revalidates a custom strategy shard count when resolving configuration", () => {
    const strategy = {
      shardCount: 2,
      shardFor: () => new ShardIndex(0, 2),
    };
    const builder = new DeliveryBuilder()
      .withStorageFactory(new InMemoryStorageFactory())
      .withNode("node-a")
      .withStrategy(strategy);
    strategy.shardCount = Number.NaN;

    expect(() => builder.build()).toThrow(
      "Delivery strategy shard count must be a positive safe integer.",
    );
  });

  it("snapshots strategy cardinality without freezing the caller's object", async () => {
    const strategy = {
      shardCount: 2,
      shardFor() {
        return new ShardIndex(1, this.shardCount);
      },
    };
    const delivery = new DeliveryBuilder()
      .withContext({ name: "Tasks", multitenant: false })
      .withStorageFactory(new InMemoryStorageFactory())
      .withNode("node-a")
      .withStrategy(strategy)
      .build();
    const originalShard = delivery.strategy.shardFor("task-1", "type.example.dev/Task");
    await delivery.inbox.receive({
      inboxId: { targetId: "task-1", targetTypeUrl: "type.example.dev/Task" },
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: originalShard,
      whenReceived: new Date("2026-07-23T05:00:00.000Z"),
      version: 1n,
    });
    strategy.shardCount = 3;
    const seen: string[] = [];

    expect(strategy.shardCount).toBe(3);
    expect(delivery.strategy.shardCount).toBe(2);
    expect(() => delivery.strategy.shardFor("task-2", "type.example.dev/Task")).toThrow(
      "Delivery strategy shard total must equal its resolved shard count.",
    );
    await expect(
      delivery.run({
        shard: originalShard,
        onMessage(message) {
          seen.push(message.signalId);
        },
      }),
    ).resolves.toMatchObject({ status: "COMPLETED" });
    expect(seen).toEqual(["signal-1"]);
    await expect(
      delivery.run({
        shard: new ShardIndex(1, 3),
        onMessage: () => undefined,
      }),
    ).rejects.toThrow("Delivery run shard total must equal the configured strategy shard count.");
  });

  it("accepts finite bounds at their maxima and rejects larger values", () => {
    expect(() => new DeliveryBuilder().withPageSize(1_000)).not.toThrow();
    expect(() => new DeliveryBuilder().withBatchSize(1_000)).not.toThrow();
    expect(() => new DeliveryBuilder().withPageSize(1_001)).toThrow(
      "Delivery page size must be at most 1000.",
    );
    expect(() => new DeliveryBuilder().withBatchSize(1_001)).toThrow(
      "Delivery batch size must be at most 1000.",
    );
  });

  it("snapshots overrides for each build while allowing deterministic builder reuse", () => {
    const storageFactory = new InMemoryStorageFactory();
    const context = { name: "Tasks", multitenant: false };
    const strategy = UniformAcrossAllShards.forNumber(3);
    const first = new DeliveryBuilder()
      .withContext(context)
      .withStorageFactory(storageFactory)
      .withStrategy(strategy)
      .withPageSize(2)
      .withBatchSize(3)
      .withNode("node-a");

    const deliveryA = first.build();
    context.name = "Changed";
    const deliveryB = first.withPageSize(4).withNode("node-b").build();

    expect(deliveryA).toMatchObject({
      context: { name: "Tasks", multitenant: false },
      storageFactory,
      strategy,
      pageSize: 2,
      batchSize: 3,
      node: "node-a",
    });
    expect(deliveryB).toMatchObject({ pageSize: 4, batchSize: 3, node: "node-b" });
    expect(deliveryB.context).toEqual({ name: "Tasks", multitenant: false });
    expect(deliveryA).not.toBe(deliveryB);
  });

  it("requires an explicit run shard for a multi-shard strategy", async () => {
    const strategy = UniformAcrossAllShards.forNumber(3);
    const delivery = new DeliveryBuilder()
      .withContext({ name: "Tasks", multitenant: false })
      .withStorageFactory(new InMemoryStorageFactory())
      .withStrategy(strategy)
      .withNode("node-a")
      .build();

    expect(strategy.shardCount).toBe(3);
    await expect(delivery.run({ onMessage: () => undefined })).rejects.toThrow(
      "Delivery run requires an explicit shard for a multi-shard strategy.",
    );
  });

  it("rejects an explicit run shard from a different durable shard set", async () => {
    const mismatchedShard = new ShardIndex(0, 2);
    const context = { name: "Tasks", multitenant: false };
    const storageFactory = new InMemoryStorageFactory();
    recordedPickups = [];
    const registry = new RecordingRegistry({ context, storageFactory });
    const delivery = new DeliveryBuilder()
      .withContext(context)
      .withStorageFactory(storageFactory)
      .withWorkRegistry(registry)
      .withStrategy(UniformAcrossAllShards.forNumber(3))
      .withNode("node-a")
      .build();
    await delivery.inbox.receive({
      inboxId: { targetId: "task-1", targetTypeUrl: "type.example.dev/Task" },
      signalId: "signal-1",
      label: "UPDATE_SUBSCRIBER",
      status: "TO_DELIVER",
      shard: mismatchedShard,
      whenReceived: new Date("2026-07-23T05:00:00.000Z"),
      version: 1n,
    });

    await expect(
      delivery.run({ shard: mismatchedShard, onMessage: () => undefined }),
    ).rejects.toThrow("Delivery run shard total must equal the configured strategy shard count.");
    expect(recordedPickups).toEqual([]);
    await expect(
      delivery.inbox.read(mismatchedShard, { statuses: ["TO_DELIVER"] }),
    ).resolves.toHaveLength(1);
  });

  it("does not resolve the server environment when storage and node are explicit", () => {
    const delivery = new DeliveryBuilder()
      .withContext({ name: "Tasks", multitenant: false })
      .withStorageFactory(new InMemoryStorageFactory())
      .withNode("node-a")
      .build();

    expect(delivery.node).toBe("node-a");
    expect(() => {
      ServerEnvironment.when(EnvironmentType.Local).use({});
    }).not.toThrow();
  });

  it("exposes only builder-owned inbox, configuration, and run behavior", () => {
    const delivery = new DeliveryBuilder()
      .withContext({ name: "Tasks", multitenant: false })
      .withStorageFactory(new InMemoryStorageFactory())
      .withNode("node-a")
      .build();

    expectTypeOf(delivery).not.toHaveProperty("drain");
    expectTypeOf(delivery).not.toHaveProperty("drainMessage");
    expectTypeOf(delivery).not.toHaveProperty("attempts");
    expectTypeOf(delivery).not.toHaveProperty("shards");
    expect("drain" in delivery).toBe(false);
    expect("drainMessage" in delivery).toBe(false);
    expect("attempts" in delivery).toBe(false);
    expect("shards" in delivery).toBe(false);
  });
});

class RecordingRegistry extends ShardedWorkRegistry {
  override pickUp(shard: ShardIndex): Promise<undefined> {
    recordedPickups.push(shard.key());
    return Promise.resolve(undefined);
  }
}

let recordedPickups: string[] = [];

function raise(error: Error): never {
  throw error;
}

async function receive(
  delivery: ReturnType<DeliveryBuilder["build"]>,
  signalId: string,
  version: bigint,
  label: "CATCH_UP" | "UPDATE_SUBSCRIBER" = "UPDATE_SUBSCRIBER",
): Promise<void> {
  await delivery.inbox.receive({
    inboxId: { targetId: "task-1", targetTypeUrl: "type.example.dev/Task" },
    signalId,
    label,
    status: "TO_DELIVER",
    shard: ShardIndex.single(),
    whenReceived: new Date("2026-07-23T05:00:00.000Z"),
    version,
  });
}
