import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { describe, expect, it } from "vitest";

import { Delivery } from "../../src/delivery/delivery.js";
import { DeliveryMonitor } from "../../src/delivery/delivery-monitor.js";
import { ShardIndex } from "../../src/index.js";

describe("Delivery fencing", () => {
  it("does not acquire a shard after an operation is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let pickups = 0;
    const delivery = new Delivery({
      context: { name: "Fencing", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      inbox: {
        sessionKind: "LEASED",
        receive: async () => {
          throw new Error("not used");
        },
        read: async () => [],
        readMessage: async () => undefined,
        markDelivered: async () => undefined,
        begin: async () => undefined,
      },
      workRegistry: {
        sessionKind: "LEASED",
        pickUp: async () => {
          pickups += 1;
          return undefined;
        },
        release: async () => true,
      },
    });
    await expect(
      delivery.drain(ShardIndex.single(), {
        operation: { signal: controller.signal },
        onMessage: () => undefined,
      }),
    ).resolves.toMatchObject({ status: "STOPPED" });
    expect(pickups).toBe(0);
  });

  it("releases a picked shard when monitor start fails", async () => {
    const shard = ShardIndex.single();
    let releases = 0;
    const delivery = new Delivery({
      context: { name: "Fencing", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      monitor: new (class extends DeliveryMonitor {
        override onDeliveryStarted(): void {
          throw new Error("start");
        }
      })(),
      inbox: {
        sessionKind: "LEASED",
        receive: async () => {
          throw new Error("not used");
        },
        read: async () => [],
        readMessage: async () => undefined,
        markDelivered: async () => undefined,
        begin: async () => undefined,
      },
      workRegistry: {
        sessionKind: "LEASED",
        pickUp: async () => ({
          kind: "LEASED" as const,
          shard,
          worker: { nodeId: { value: "node" }, value: "worker" },
          pickedUpAt: new Date(),
          expiresAt: new Date(),
        }),
        release: async () => {
          releases += 1;
          return true;
        },
      },
    });
    await expect(delivery.drain(shard, { onMessage: () => undefined })).resolves.toMatchObject({
      status: "STOPPED",
    });
    expect(releases).toBe(1);
  });
});
