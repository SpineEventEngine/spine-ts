import { describe, expect, it } from "vitest";

import { createInMemoryDeliveryServerCore } from "../src/index.js";

describe("createInMemoryDeliveryServerCore", () => {
  it("creates an isolated core with only Inbox and Shard handler seams", () => {
    const core = createInMemoryDeliveryServerCore();

    expect(core.inbox).toBeDefined();
    expect(core.shards).toBeDefined();
    expect("close" in core).toBe(false);
  });
});
