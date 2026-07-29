import { describe, expect, it } from "vitest";

import {
  DeliveryServer,
  InMemoryDelivery,
  type DeliveryCore,
  type DeliveryCoreOptions,
  type DeliveryServerOptions,
} from "../src/index.js";

describe("InMemoryDelivery", () => {
  it("creates an isolated core with only Inbox and Shard handler seams", () => {
    const options: DeliveryCoreOptions = {};
    const core: DeliveryCore = InMemoryDelivery.create(options);

    expect(core.inbox).toBeDefined();
    expect(core.shards).toBeDefined();
    expect("close" in core).toBe(false);
  });
});

describe("DeliveryServer public API", () => {
  it("exposes the standalone lifecycle class without internal listener details", () => {
    const options: DeliveryServerOptions = { port: 0 };
    const server = new DeliveryServer(options);
    expect(server.port).toBe(0);
    expect("server" in server).toBe(false);
  });
});
