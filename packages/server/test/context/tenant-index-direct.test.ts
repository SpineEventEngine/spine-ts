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
import { InternetDomainSchema, TenantIdSchema } from "@spine-event-engine/proto";
import { InMemoryStorageFactory, type StorageFactory } from "@spine-event-engine/storage";
import { TenantBoundary, type TenantCatalog } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import { TenantIndexes } from "../../src/context/tenant-index.js";
import { TenantAdmissions, TenantUnknownError } from "../../src/context/tenant-unknown-error.js";
import { tenant } from "../tenant-fixture.js";

describe("live tenant index", () => {
  it("reports a detached complete identity only for confirmed missing membership", async () => {
    const index = TenantIndexes.fromFactory({} as StorageFactory);
    const requested = create(TenantIdSchema, {
      kind: { case: "domain", value: create(InternetDomainSchema, { value: "original.test" }) },
    });
    const failure = await TenantAdmissions.require(index, "Projects", true, requested).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(TenantUnknownError);
    expect(failure).toMatchObject({ type: "TENANT_UNKNOWN", contextName: "Projects" });
    if (!(failure instanceof TenantUnknownError)) throw new Error("Expected typed tenant error.");
    requested.kind = { case: "value", value: "mutated" };
    const copy = failure.tenantId;
    copy.kind = { case: "value", value: "changed result" };
    expect(failure.tenantId.kind).toMatchObject({
      case: "domain",
      value: { value: "original.test" },
    });
    const lookupFailure = new Error("directory unavailable");
    vi.spyOn(index, "contains").mockRejectedValueOnce(lookupFailure);
    await expect(TenantAdmissions.require(index, "Projects", true, requested)).rejects.toBe(
      lookupFailure,
    );
  });

  it("rejects missing or inapplicable tenant shapes without directory lookup", async () => {
    const index = TenantIndexes.fromFactory({} as StorageFactory);
    const lookup = vi.spyOn(index, "contains");
    await expect(TenantAdmissions.require(index, "Single", false, tenant("extra"))).rejects.toThrow(
      "does not accept context.tenantId",
    );
    await expect(TenantAdmissions.require(index, "Multi", true)).rejects.toThrow(
      "requires context.tenantId",
    );
    expect(lookup).not.toHaveBeenCalled();
  });
  it("registers complete identities through the provider catalog without storage creation", async () => {
    const factory = new InMemoryStorageFactory();
    const createRecordStorage = vi.spyOn(factory, "createRecordStorage");
    const index = TenantIndexes.fromFactory(factory);
    const value = tenant("tenant-a");
    const domain = create(TenantIdSchema, {
      kind: { case: "domain", value: create(InternetDomainSchema, { value: "example.test" }) },
    });
    await index.keep(value);
    await index.keep(domain);
    await index.keep(value);
    await expect(index.contains(value)).resolves.toBe(true);
    await expect(index.contains(tenant("missing"))).resolves.toBe(false);
    expect(await index.all()).toEqual([domain, value]);
    expect(createRecordStorage).not.toHaveBeenCalled();
  });

  it("reads finite pages without using full enumeration", async () => {
    const source = new InMemoryStorageFactory().tenantCatalog();
    await source.keep(TenantBoundary.from(tenant("first")));
    await source.keep(TenantBoundary.from(tenant("second")));
    const index = TenantIndexes.fromFactory(
      new CatalogFactory({
        contains: (boundary) => source.contains(boundary),
        all: () => Promise.reject(new Error("full enumeration forbidden")),
        page: (request) => source.page(request),
        keep: (boundary) => source.keep(boundary),
        close: () => Promise.resolve(),
      }),
    );
    const signal = new AbortController().signal;
    const first = await index.page({ count: 1, signal });
    expect(first.ids).toHaveLength(1);
    if (first.after === undefined) throw new Error("Expected continuation.");
    const second = await index.page({ count: 1, signal, after: first.after });
    expect(second.ids).toHaveLength(1);
    expect(second.hasMore).toBe(false);
  });

  it("uses detached, bounded transient memory for a factory without a catalog", async () => {
    const index = TenantIndexes.fromFactory({} as StorageFactory);
    const original = tenant("registered");
    await index.keep(original);
    original.kind = { case: "value", value: "mutated" };
    await expect(index.contains(tenant("registered"))).resolves.toBe(true);
    await expect(index.contains(tenant("mutated"))).resolves.toBe(false);
    const listed = await index.all();
    const first = listed[0];
    if (first === undefined) throw new Error("Expected registered tenant.");
    first.kind = { case: "value", value: "changed-result" };
    await expect(index.all()).resolves.toEqual([tenant("registered")]);
    const signal = new AbortController().signal;
    const page = await index.page({ count: 1, signal });
    expect(page).toMatchObject({ ids: [tenant("registered")], hasMore: false });
    await index.keep(tenant("second"));
    const firstPage = await index.page({ count: 1, signal });
    expect(firstPage.hasMore).toBe(true);
    if (firstPage.after === undefined) throw new Error("Expected bounded continuation.");
    expect(Object.isFrozen(firstPage.after)).toBe(true);
    const mutable = firstPage.after as unknown as Record<string, unknown>;
    expect(Reflect.set(mutable, "index", 0)).toBe(false);
    expect(Reflect.set(mutable, "length", Infinity)).toBe(false);
    const secondPage = await index.page({ count: 1, signal, after: firstPage.after });
    expect(secondPage.ids).toEqual([tenant("second")]);
    expect(secondPage.hasMore).toBe(false);
    await expect(
      index.page({ count: 1, signal, after: { [Symbol.toStringTag]: "TenantCatalogCursor" } }),
    ).rejects.toThrow(/continuation/);
    const foreign = TenantIndexes.fromFactory({} as StorageFactory);
    await expect(foreign.page({ count: 1, signal, after: firstPage.after })).rejects.toThrow(
      /continuation/,
    );
    await expect(index.page({ count: 0, signal })).rejects.toThrow();
  });

  it("rejects incomplete tenant identities before provider lookup", async () => {
    const index = TenantIndexes.fromFactory(new InMemoryStorageFactory());
    await expect(index.keep(create(TenantIdSchema))).rejects.toThrow(/non-empty TenantId/);
  });

  it("rejects single-tenant boundaries returned by a provider catalog", async () => {
    const index = TenantIndexes.fromFactory(
      new CatalogFactory({
        contains: () => Promise.resolve(false),
        all: () => Promise.resolve([TenantBoundary.single]),
        page: () => Promise.resolve({ boundaries: [TenantBoundary.single], hasMore: false }),
        keep: () => Promise.resolve(),
        close: () => Promise.resolve(),
      }),
    );
    await expect(index.all()).rejects.toThrow(/single-tenant boundary/);
    await expect(index.page({ count: 1, signal: new AbortController().signal })).rejects.toThrow(
      /single-tenant boundary/,
    );
  });
});

/**
 * Substitutes one provider catalog for focused index tests.
 */
class CatalogFactory extends InMemoryStorageFactory {
  /**
   * Captures the selected test catalog.
   *
   * @param catalog Catalog to expose through the provider seam.
   */
  constructor(private readonly catalog: TenantCatalog) {
    super();
  }

  /**
   * Returns the supplied test catalog.
   *
   * @returns The supplied test catalog.
   */
  override tenantCatalog(): TenantCatalog {
    return this.catalog;
  }
}
