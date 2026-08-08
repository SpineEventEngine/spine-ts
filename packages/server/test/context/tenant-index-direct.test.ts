import { describe, expect, it } from "vitest";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

import { TenantIndexes } from "../../src/context/tenant-index.js";

describe("direct TenantId index", () => {
  it("stores direct value TenantIds and rejects invalid caller IDs", async () => {
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "multitenant",
      storageFactory: new InMemoryStorageFactory(),
    });

    await index.keep("tenant-a");
    await index.keep("tenant-b");
    await expect(index.all()).resolves.toEqual(["tenant-a", "tenant-b"]);
    expect(() => TenantIndexes.require(" ")).toThrow("non-blank");
    index.close();
  });

  it("keeps the single-tenant index empty and rejects recording or later access", async () => {
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "single-tenant",
      storageFactory: new InMemoryStorageFactory(),
    });

    await expect(index.all()).resolves.toEqual([]);
    await expect(index.keep("tenant-a")).rejects.toThrow("does not accept");
    index.close();
    await expect(index.all()).rejects.toThrow("closed");
    await expect(index.keep("tenant-a")).rejects.toThrow("closed");
  });
});
