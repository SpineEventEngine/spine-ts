/* eslint-disable @typescript-eslint/require-await */

import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import { TenantIdSchema } from "@spine-event-engine/proto";
import { Identifiers } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { describe, expect, it } from "vitest";

import {
  AlreadyPickedUp,
  DeliveryBuilder,
  DeliveryMonitor,
  FailedPickUp,
  FailedReception,
  ShardIndex,
  ShardedWorkRegistry,
  UniformAcrossAllShards,
} from "../../src/index.js";
import { Delivery as CoreDelivery } from "../../src/delivery/delivery.js";
import { InboxRecords } from "../../src/delivery/inbox-records.js";
import { createMessage } from "./inbox-message-fixture.js";

describe("DeliveryMonitor delivery", () => {
  it("is instantiable and permits direct or promised hook results", async () => {
    const monitor = new DeliveryMonitor();
    expect(await monitor.shouldContinueAfter("DELIVERY")).toBe(true);
    await monitor.onDeliveryStarted(ShardIndex.single());
    await monitor.onDeliveryCompleted({ processed: 0, delivered: 0, failed: 0 });
    await (
      await monitor.onShardPickUpFailure(new FailedPickUp(ShardIndex.single(), new Error()))
    ).execute();
    await (await monitor.onShardAlreadyPicked(new AlreadyPickedUp(ShardIndex.single()))).execute();
    const reception = new FailedReception(
      message("failed", "target", ShardIndex.single()),
      new Error(),
      async () => undefined,
      async () => undefined,
    );
    await (await monitor.onReceptionFailure(reception)).execute();
    await reception.repeatDispatching().execute();
  });

  it("repeats one failed dispatch when the monitor selects the direct action", async () => {
    const shard = ShardIndex.single();
    const pending = message("pending", "target", shard);
    let reads = 0;
    let calls = 0;
    let acknowledgements = 0;
    class RepeatMonitor extends DeliveryMonitor {
      override onReceptionFailure(reception: FailedReception) {
        return reception.repeatDispatching();
      }
    }
    await build()
      .withMonitor(new RepeatMonitor())
      .withInbox({
        sessionKind: "LEASED",
        receive: async () => {
          throw new Error("not used");
        },
        read: async () => (reads++ === 0 ? [pending] : []),
        readMessage: async () => undefined,
        markDelivered: async (value) => {
          acknowledgements += 1;
          return value;
        },
      })
      .withWorkRegistry(registry(shard))
      .build()
      .run({
        shard,
        onMessage: async () => {
          calls += 1;
          if (calls === 1) throw new Error("first dispatch fails");
        },
      });
    expect(calls).toBe(2);
    expect(acknowledgements).toBe(1);
  });

  it("allocates an opaque distinct WorkerId for each delivery lifetime", () => {
    const first = build().withNode("node-a").build();
    const second = build().withNode("node-a").build();
    expect(first.worker.nodeId?.value).toBe("node-a");
    expect(first.worker.value).not.toBe("node-a");
    expect(second.worker.value).not.toBe(first.worker.value);
  });

  it("accepts an explicit complete WorkerId", () => {
    const worker = create(WorkerIdSchema, { nodeId: { value: "node-a" }, value: "restart-a" });
    const delivery = build().withWorker(worker).build();
    if (worker.nodeId === undefined) throw new Error("Expected a complete worker node ID.");
    worker.nodeId.value = "mutated";
    worker.value = "mutated";
    expect(delivery.worker).toMatchObject({ nodeId: { value: "node-a" }, value: "restart-a" });
    const nodeId = delivery.worker.nodeId;
    if (nodeId === undefined) throw new Error("Expected a complete worker node ID.");
    expect(() => {
      (nodeId as { value: string }).value = "mutated-again";
    }).toThrow();
  });

  it("accepts a custom shard registry with an equivalent cloned tenant", () => {
    const storageFactory = new InMemoryStorageFactory();
    const registryContext = {
      name: "Tasks",
      multitenant: true as const,
      tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } }),
    };
    const builderContext = {
      ...registryContext,
      tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant-a" } }),
    };
    const workRegistry = new ShardedWorkRegistry({
      context: registryContext,
      storageFactory,
    });

    expect(() =>
      new DeliveryBuilder()
        .withContext(builderContext)
        .withStorageFactory(storageFactory)
        .withWorkRegistry(workRegistry)
        .build(),
    ).not.toThrow();
  });

  it("rejects conflicting direct worker and node identities", () => {
    expect(() =>
      build()
        .withNode("node-a")
        .withWorker(create(WorkerIdSchema, { nodeId: { value: "node-b" }, value: "x" })),
    ).toThrow("must match");
  });

  it.each([
    [create(AnySchema), "type.example/Task", "Delivery target ID must be a non-default Any."],
    [Identifiers.pack("string", "task-1"), "", "Delivery target type must be a non-empty string."],
  ])("rejects incomplete shard coordinates", (targetId, targetType, message) => {
    expect(() => UniformAcrossAllShards.singleShard().shardFor(targetId, targetType)).toThrow(
      message,
    );
  });

  it("keeps typed target shards stable across records and a fresh strategy", () => {
    const targetType = "type.example.dev/Typed";
    const first = UniformAcrossAllShards.forNumber(17);
    const second = UniformAcrossAllShards.forNumber(17);
    const targets = [
      Identifiers.pack("string", "42"),
      Identifiers.pack("int32", 42),
      Identifiers.pack("int64", 42n),
      Identifiers.pack(UserIdSchema, create(UserIdSchema, { value: "42" })),
    ];
    const shards = targets.map((targetId, index) => {
      const before = first.shardFor(targetId, targetType);
      const restored = InboxRecords.read(
        InboxRecords.write({
          ...createMessage(`shard-${String(index)}`, `signal-${String(index)}`, 1n),
          inboxId: { targetId, targetTypeUrl: targetType },
          id: { value: `shard-${String(index)}`, shard: before },
          shard: before,
        }),
      );
      return [before, second.shardFor(restored.inboxId.targetId, targetType)] as const;
    });

    expect(shards.every(([before, after]) => before.key() === after.key())).toBe(true);
    expect(shards[0]?.[0]).toEqual(first.shardFor(Identifiers.pack("string", "42"), targetType));
  });

  it.each([
    [0, "Delivery page size must be a positive safe integer."],
    [1_001, "Delivery page size must be at most 1000."],
  ])("rejects page size %i outside the finite delivery bound", (pageSize, message) => {
    expect(() => build().withPageSize(pageSize)).toThrow(message);
  });

  it("rejects a strategy that returns a shard from a different configured total", () => {
    const delivery = build()
      .withStrategy({
        shardCount: 2,
        shardFor: () => new ShardIndex(0, 3),
      })
      .build();

    expect(() =>
      delivery.strategy.shardFor(Identifiers.pack("string", "task-1"), "type.example/Task"),
    ).toThrow("Delivery strategy shard total must equal its resolved shard count.");
  });

  it("does not expose caller target bytes to a custom strategy", () => {
    const targetId = Identifiers.pack("int32", 42);
    const expected = new Uint8Array(targetId.value);
    const delivery = build()
      .withStrategy({
        shardCount: 1,
        shardFor: (candidate) => {
          candidate.value.fill(0);
          return ShardIndex.single();
        },
      })
      .build();

    expect(delivery.strategy.shardFor(targetId, "type.example/Task")).toEqual(ShardIndex.single());
    expect(targetId.value).toEqual(expected);
  });

  it.each([
    [
      () => UniformAcrossAllShards.forNumber(0),
      "Delivery shard count must be a positive safe integer.",
    ],
    [() => build().withNode(""), "Delivery node must be a non-empty string."],
    [() => build().withNode(1 as never), "Delivery node must be a non-empty string."],
    [
      () => build().withWorker(create(WorkerIdSchema)),
      "Delivery worker must contain non-blank node and value.",
    ],
    [
      () => build().withWorker(create(WorkerIdSchema, { nodeId: { value: " " }, value: "x" })),
      "Delivery worker must contain non-blank node and value.",
    ],
    [
      () => build().withStrategy({ shardCount: 0, shardFor: () => ShardIndex.single() }),
      "Delivery strategy shard count must be a positive safe integer.",
    ],
  ])("rejects invalid public delivery builder input", (operation, message) => {
    expect(operation).toThrow(message);
  });

  it("maps skipped and failed pickup outcomes without rejecting", async () => {
    const shard = ShardIndex.single();
    const inbox = {
      sessionKind: "LEASED" as const,
      receive: async () => {
        throw new Error("not used");
      },
      read: async () => [],
      readMessage: async () => undefined,
      markDelivered: async () => undefined,
    };
    const skipped = await build()
      .withInbox(inbox)
      .withWorkRegistry({
        sessionKind: "LEASED",
        pickUp: async () => undefined,
        validateOwnership: async () => undefined,
        release: async () => true,
      })
      .build()
      .run({ shard, onMessage: async () => undefined });
    const failed = await build()
      .withInbox(inbox)
      .withWorkRegistry({
        sessionKind: "LEASED",
        pickUp: async () => {
          throw new Error("pickup failed");
        },
        validateOwnership: async () => undefined,
        release: async () => true,
      })
      .build()
      .run({ shard, onMessage: async () => undefined });
    expect(skipped.status).toBe("SKIPPED");
    expect(failed.status).toBe("FAILED");
  });

  it("stops at monitor delivery and page continuation gates", async () => {
    const shard = ShardIndex.single();
    for (const stage of ["DELIVERY", "PAGE"] as const) {
      let reads = 0;
      class StopMonitor extends DeliveryMonitor {
        override shouldContinueAfter(current: "DELIVERY" | "PAGE") {
          return current !== stage;
        }
      }
      await build()
        .withMonitor(new StopMonitor())
        .withInbox({
          sessionKind: "LEASED",
          receive: async () => {
            throw new Error("not used");
          },
          read: async () => (reads++ === 0 ? [message("pending", "target", shard)] : []),
          readMessage: async () => undefined,
          markDelivered: async (value) => value,
        })
        .withWorkRegistry(registry(shard))
        .build()
        .run({ shard, onMessage: async () => undefined });
      expect(reads).toBe(stage === "DELIVERY" ? 0 : 1);
    }
  });

  it("contains a lost acknowledgement and uses the default acknowledgement fallback", async () => {
    const shard = ShardIndex.single();
    const pending = message("pending", "target", shard);
    let reads = 0;
    let acknowledgements = 0;
    await build()
      .withInbox({
        sessionKind: "LEASED",
        receive: async () => {
          throw new Error("not used");
        },
        read: async () => (reads++ === 0 ? [pending] : []),
        readMessage: async () => undefined,
        markDelivered: async (value) => (acknowledgements++ === 0 ? undefined : value),
      })
      .withWorkRegistry(registry(shard))
      .build()
      .run({ shard, onMessage: async () => undefined });
    expect(acknowledgements).toBe(2);
  });

  it("maps an abort raised by an in-flight endpoint to a stopped public run", async () => {
    const shard = ShardIndex.single();
    const controller = new AbortController();
    const pending = message("pending", "target", shard);
    const delivery = new CoreDelivery({
      context: { name: `abort-${crypto.randomUUID()}`, multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox: {
        sessionKind: "LEASED",
        receive: async () => {
          throw new Error("not used");
        },
        read: async () => [pending],
        readMessage: async () => undefined,
        markDelivered: async (value) => value,
      },
      workRegistry: registry(shard),
    });
    const result = await delivery.runControlled({
      shard,
      signal: controller.signal,
      onMessage: async () => {
        controller.abort();
      },
    });
    expect(result.status).toBe("STOPPED");
  });

  it("stops a controlled run before shard acquisition when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const shard = ShardIndex.single();
    let pickups = 0;
    const delivery = new CoreDelivery({
      context: { name: `pre-abort-${crypto.randomUUID()}`, multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      workRegistry: {
        ...registry(shard),
        pickUp: async () => {
          pickups += 1;
          return leasedSession(shard);
        },
      },
    });
    await expect(
      delivery.runControlled({
        shard,
        signal: controller.signal,
        onMessage: async () => undefined,
      }),
    ).resolves.toMatchObject({ status: "STOPPED" });
    expect(pickups).toBe(0);
  });

  it("maps a controlled already-owned shard to SKIPPED", async () => {
    const shard = ShardIndex.single();
    const delivery = new CoreDelivery({
      context: { name: `skip-${crypto.randomUUID()}`, multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      workRegistry: {
        sessionKind: "LEASED",
        pickUp: async () => undefined,
        validateOwnership: async (session) => session,
        release: async () => true,
      },
    });
    await expect(
      delivery.runControlled({
        shard,
        signal: new AbortController().signal,
        onMessage: async () => undefined,
      }),
    ).resolves.toMatchObject({ status: "SKIPPED" });
  });

  it("drains an exclusive session without attempting lease renewal", async () => {
    const shard = ShardIndex.single();
    const pending = message("exclusive", "target", shard);
    let reads = 0;
    const delivery = new CoreDelivery({
      context: { name: `exclusive-${crypto.randomUUID()}`, multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox: {
        sessionKind: "EXCLUSIVE",
        receive: async () => {
          throw new Error("not used");
        },
        read: async () => (reads++ === 0 ? [pending] : []),
        readMessage: async () => undefined,
        markDelivered: async (value) => value,
      },
      workRegistry: {
        sessionKind: "EXCLUSIVE",
        pickUp: async () => ({ kind: "EXCLUSIVE" as const, shard }),
        validateOwnership: async (session) => session,
        release: async () => true,
      },
    });
    await expect(
      delivery.drain(shard, { onMessage: async () => undefined }),
    ).resolves.toMatchObject({
      status: "DRAINED",
    });
  });

  it("contains failed acknowledgement and continues an independent target", async () => {
    const shard = ShardIndex.single();
    const messages = [
      message("first", "same", shard),
      message("blocked", "same", shard),
      message("other", "other", shard),
    ];
    let reads = 0;
    const seen: string[] = [];
    await build()
      .withInbox({
        sessionKind: "LEASED",
        receive: async () => {
          throw new Error("not used");
        },
        read: async () => (reads++ === 0 ? messages : []),
        readMessage: async () => undefined,
        markDelivered: async (value) => {
          if (value.signalId === "first") throw new Error("acknowledgement failed");
          return value;
        },
      })
      .withWorkRegistry(registry(shard))
      .build()
      .run({
        onMessage: (value) => {
          seen.push(value.signalId);
          if (value.signalId === "first") throw new Error("dispatch failed");
        },
      });
    expect(seen).toEqual(["first", "other"]);
  });

  it("stops after one no-progress pass over a target blocked by acknowledgement failure", async () => {
    const shard = ShardIndex.single();
    const pending = message("pending", "same", shard);
    let reads = 0;
    await build()
      .withInbox({
        sessionKind: "LEASED",
        receive: async () => {
          throw new Error("not used");
        },
        read: async () => {
          reads += 1;
          return [pending];
        },
        readMessage: async () => undefined,
        markDelivered: async () => {
          throw new Error("mark failed");
        },
      })
      .withWorkRegistry(registry(shard))
      .build()
      .run({
        onMessage: () => {
          throw new Error("dispatch failed");
        },
      });
    expect(reads).toBe(1);
  });

  it("fences callback before dispatch after renewal loss", async () => {
    const shard = ShardIndex.single();
    let dispatched = 0;
    await build()
      .withInbox({
        sessionKind: "LEASED",
        receive: async () => {
          throw new Error("not used");
        },
        read: async () => [message("pending", "target", shard)],
        readMessage: async () => undefined,
        markDelivered: async () => {
          throw new Error("must not acknowledge");
        },
      })
      .withWorkRegistry({ ...registry(shard), validateOwnership: async () => undefined })
      .build()
      .run({
        onMessage: () => {
          dispatched += 1;
        },
      });
    expect(dispatched).toBe(0);
  });

  it("rejects incompatible supplied Inbox and shard-registry session kinds", () => {
    const shard = ShardIndex.single();
    expect(() =>
      build()
        .withInbox({
          sessionKind: "EXCLUSIVE",
          receive: async () => {
            throw new Error("not used");
          },
          read: async () => [],
          readMessage: async () => undefined,
          markDelivered: async () => undefined,
        })
        .withWorkRegistry(registry(shard))
        .build(),
    ).toThrow("Delivery inbox and work registry session kinds must match.");
  });

  it("rejects invalid builder bounds and target coordinates", () => {
    expect(() => new DeliveryBuilder().withPageSize(0)).toThrow(
      "Delivery page size must be a positive safe integer.",
    );
    expect(() => ShardIndex.single()).not.toThrow();
  });
});

function build(): DeliveryBuilder {
  return new DeliveryBuilder().withStorageFactory(new InMemoryStorageFactory());
}
function message(signalId: string, targetId: string, shard: ShardIndex) {
  return {
    id: { value: signalId, shard },
    inboxId: { targetId: Identifiers.pack("string", targetId), targetTypeUrl: "type" },
    signalId,
    label: "UPDATE_SUBSCRIBER" as const,
    status: "TO_DELIVER" as const,
    shard,
    whenReceived: new Date(),
    version: 1n,
  };
}
function registry(shard: ShardIndex) {
  const session = leasedSession(shard);
  return {
    sessionKind: "LEASED" as const,
    pickUp: async () => session,
    validateOwnership: async () => session,
    release: async () => true,
  };
}

function leasedSession(shard: ShardIndex) {
  return {
    kind: "LEASED" as const,
    shard,
    worker: create(WorkerIdSchema, { nodeId: { value: "node" }, value: "worker" }),
    pickedUpAt: new Date(0),
    expiresAt: new Date(60_000),
  };
}
