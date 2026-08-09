import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";
import { InternetDomainSchema, TenantIdSchema } from "@spine-event-engine/proto";

import { TenantIndexes } from "../../src/context/tenant-index.js";
import { tenant } from "../tenant-fixture.js";

describe("provider tenant index", () => {
  it("admits complete TenantIds through the factory catalog without record storage", async () => {
    const factory = new InMemoryStorageFactory();
    const createRecordStorage = vi.spyOn(factory, "createRecordStorage");
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "multitenant",
      storageFactory: factory,
    });

    const tenantA = tenant("tenant-a");
    const tenantB = create(TenantIdSchema, {
      kind: { case: "domain", value: create(InternetDomainSchema, { value: "example.test" }) },
    });
    await index.keep(tenantA);
    await index.keep(tenantB);
    await index.keep(tenantA);

    const admitted = await index.all();
    expect(admitted).toHaveLength(2);
    expect(admitted).toEqual(expect.arrayContaining([tenantA, tenantB]));
    expect(createRecordStorage).not.toHaveBeenCalled();
    index.close();
  });

  it("keeps the single-tenant index empty and rejects recording or later access", async () => {
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "single-tenant",
      storageFactory: new InMemoryStorageFactory(),
    });

    await expect(index.all()).resolves.toEqual([]);
    await expect(index.keep(tenant("tenant-a"))).rejects.toThrow("does not accept");
    index.close();
    await expect(index.all()).rejects.toThrow("closed");
    await expect(index.keep(tenant("tenant-a"))).rejects.toThrow("closed");
  });

  it("rejects an incomplete generated tenant at the shared boundary", async () => {
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "multitenant",
      storageFactory: new InMemoryStorageFactory(),
    });

    await expect(index.keep(create(TenantIdSchema))).rejects.toThrow(/non-empty TenantId/);
  });
});
