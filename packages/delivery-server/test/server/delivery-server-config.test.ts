import { describe, expect, it } from "vitest";

import { createInMemoryDeliveryServerCore, DeliveryServer } from "../../src/index.js";

describe("DeliveryServer configuration", () => {
  it("uses documented defaults and keeps configured zero", () => {
    const server = new DeliveryServer({ port: 0, processingTimeoutSeconds: 0 });

    expect(server.host).toBe("127.0.0.1");
    expect(server.port).toBe(0);
  });

  it("rejects invalid configuration synchronously before startup", () => {
    expect(() => new DeliveryServer({ host: " " })).toThrow("Delivery server host is invalid.");
    expect(() => new DeliveryServer({ port: -1 })).toThrow("Delivery server port is invalid.");
    expect(() => new DeliveryServer({ maxInboundMessageBytes: 0 })).toThrow(
      "Delivery server inbound message size is invalid.",
    );
    expect(() => new DeliveryServer({ maxRetainedMessages: 0 })).toThrow(
      "Delivery server retained message limit is invalid.",
    );
    expect(() => new DeliveryServer({ maxTrackedShards: 1_001 })).toThrow(
      "Delivery server tracked shard limit is invalid.",
    );
    expect(() => createInMemoryDeliveryServerCore({ maxTrackedShards: 1_001 })).toThrow(
      "Delivery server maxTrackedShards is invalid.",
    );
    expect(() => createInMemoryDeliveryServerCore({ maxRetainedMessages: 0 })).toThrow(
      "Delivery server maxRetainedMessages is invalid.",
    );
  });
});
