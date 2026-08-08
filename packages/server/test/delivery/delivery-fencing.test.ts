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
        receive: () => Promise.reject(new Error("not used")),
        read: () => Promise.resolve([]),
        readMessage: () => Promise.resolve(undefined),
        markDelivered: () => Promise.resolve(undefined),
        begin: () => Promise.resolve(undefined),
      },
      workRegistry: {
        sessionKind: "LEASED",
        pickUp: () => {
          pickups += 1;
          return Promise.resolve(undefined);
        },
        release: () => Promise.resolve(true),
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
        receive: () => Promise.reject(new Error("not used")),
        read: () => Promise.resolve([]),
        readMessage: () => Promise.resolve(undefined),
        markDelivered: () => Promise.resolve(undefined),
        begin: () => Promise.resolve(undefined),
      },
      workRegistry: {
        sessionKind: "LEASED",
        pickUp: () =>
          Promise.resolve({
            kind: "LEASED" as const,
            shard,
            worker: { nodeId: { value: "node" }, value: "worker" },
            pickedUpAt: new Date(),
            expiresAt: new Date(),
          }),
        release: () => {
          releases += 1;
          return Promise.resolve(true);
        },
      },
    });
    await expect(delivery.drain(shard, { onMessage: () => undefined })).resolves.toMatchObject({
      status: "STOPPED",
    });
    expect(releases).toBe(1);
  });
});
