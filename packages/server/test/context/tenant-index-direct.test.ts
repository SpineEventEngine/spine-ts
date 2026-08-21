/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";
import { InMemoryStorageFactory, StorageFactory } from "@spine-event-engine/storage";
import { TenantBoundary, type TenantCatalog } from "@spine-event-engine/storage/provider";
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

  it("rejects multitenant index use after close", async () => {
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "multitenant",
      storageFactory: new InMemoryStorageFactory(),
    });
    index.close();

    await expect(index.all()).rejects.toThrow(/TenantIndex.*closed/);
    await expect(index.keep(tenant("tenant-a"))).rejects.toThrow(/TenantIndex.*closed/);
  });

  it("rejects a provider without a tenant catalog", () => {
    expect(() =>
      TenantIndexes.create({
        contextName: "Tasks",
        tenantMode: "multitenant",
        storageFactory: {} as StorageFactory,
      }),
    ).toThrow(/provider-owned tenant catalog/);
  });

  it("rejects a single-tenant boundary returned by a multitenant catalog", async () => {
    const factory = new CatalogFactory({
      all: () => Promise.resolve([TenantBoundary.single]),
      keep: () => Promise.resolve(),
      close: () => Promise.resolve(),
    });
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "multitenant",
      storageFactory: factory,
    });

    await expect(index.all()).rejects.toThrow(/returned a single-tenant boundary/);
  });
});

class CatalogFactory extends InMemoryStorageFactory {
  constructor(private readonly catalog: TenantCatalog) {
    super();
  }

  override tenantCatalog(): TenantCatalog {
    return this.catalog;
  }
}
