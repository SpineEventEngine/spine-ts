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

  it("reads bounded provider pages when the unrelated all path is unavailable", async () => {
    const source = new InMemoryStorageFactory();
    const catalog = source.tenantCatalog();
    await catalog.keep(TenantBoundary.from(tenant("first")));
    await catalog.keep(TenantBoundary.from(tenant("second")));
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "multitenant",
      storageFactory: new CatalogFactory({
        all: () => Promise.reject(new Error("full enumeration forbidden")),
        page: (request) => catalog.page(request),
        keep: (boundary) => catalog.keep(boundary),
        close: () => Promise.resolve(),
      }),
    });
    const signal = new AbortController().signal;
    const first = await index.page({ count: 1, signal });
    expect(first.ids).toHaveLength(1);
    if (first.after === undefined) throw new Error("Expected tenant continuation.");
    const second = await index.page({ count: 1, signal, after: first.after });
    expect(second.ids).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    index.close();
    await expect(index.page({ count: 1, signal })).rejects.toThrow(/closed/);
  });

  it("reports SINGLE_TENANT without a storage partition and rejects recording or later access", async () => {
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "single-tenant",
      storageFactory: new InMemoryStorageFactory(),
    });

    await expect(index.all()).resolves.toEqual([tenant("SINGLE_TENANT")]);
    const signal = new AbortController().signal;
    await expect(index.page({ count: 1, signal })).resolves.toMatchObject({
      ids: [tenant("SINGLE_TENANT")],
      hasMore: false,
    });
    await expect(
      index.page({
        count: 1,
        signal,
        after: {
          [Symbol.toStringTag]: "TenantCatalogCursor",
        },
      }),
    ).rejects.toThrow(/continuation/);
    await expect(index.keep(tenant("tenant-a"))).rejects.toThrow("does not accept");
    index.close();
    await expect(index.all()).rejects.toThrow("closed");
    await expect(index.page({ count: 1, signal })).rejects.toThrow("closed");
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
      page: () => Promise.resolve({ boundaries: [TenantBoundary.single], hasMore: false }),
      keep: () => Promise.resolve(),
      close: () => Promise.resolve(),
    });
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "multitenant",
      storageFactory: factory,
    });

    await expect(index.all()).rejects.toThrow(/returned a single-tenant boundary/);
    await expect(index.page({ count: 1, signal: new AbortController().signal })).rejects.toThrow(
      /returned a single-tenant boundary/,
    );
  });

  it("fails setup when a catalog does not implement paging", () => {
    const legacy = {
      all: () => Promise.resolve([]),
      keep: () => Promise.resolve(),
      close: () => Promise.resolve(),
    } as unknown as TenantCatalog;
    expect(() =>
      TenantIndexes.create({
        contextName: "Tasks",
        tenantMode: "multitenant",
        storageFactory: new CatalogFactory(legacy),
      }),
    ).toThrow(/paged/);
  });

  it("rejects a provider page that arrives after its index closes", async () => {
    let deliver:
      ((page: { boundaries: readonly TenantBoundary[]; hasMore: false }) => void) | undefined;
    const delayed = new Promise<{ boundaries: readonly TenantBoundary[]; hasMore: false }>(
      (resolve) => {
        deliver = resolve;
      },
    );
    const index = TenantIndexes.create({
      contextName: "Tasks",
      tenantMode: "multitenant",
      storageFactory: new CatalogFactory({
        all: () => Promise.resolve([]),
        page: () => delayed,
        keep: () => Promise.resolve(),
        close: () => Promise.resolve(),
      }),
    });
    const reading = index.page({ count: 1, signal: new AbortController().signal });
    index.close();
    deliver?.({ boundaries: [TenantBoundary.from(tenant("late"))], hasMore: false });
    await expect(reading).rejects.toThrow(/closed/);
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
