import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { TenantIdSchema } from "@spine-event-engine/proto";

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

  it("treats every non-value persisted TenantId mode as storage corruption", async () => {
    const factory = new InMemoryStorageFactory();
    const original = factory.createRecordStorage.bind(factory);
    let direct: ReturnType<typeof factory.createRecordStorage> | undefined;
    vi.spyOn(factory, "createRecordStorage").mockImplementation((context, spec) => {
      const storage = original(context, spec);
      direct = storage;
      return storage;
    });
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "multitenant",
      storageFactory: factory,
    });
    if (direct === undefined) throw new Error("Expected direct TenantId storage.");

    for (const tenant of [
      create(TenantIdSchema, { kind: { case: "domain", value: { value: "example.test" } } }),
      create(TenantIdSchema, { kind: { case: "email", value: { value: "a@example.test" } } }),
      create(TenantIdSchema),
    ]) {
      vi.spyOn(direct, "index").mockResolvedValueOnce([tenant]);
      await expect(index.all()).rejects.toThrow("invalid TenantId");
    }
  });
});
