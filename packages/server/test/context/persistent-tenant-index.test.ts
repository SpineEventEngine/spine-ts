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

import { create, type Message } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  InternetDomainSchema,
  TenantIdSchema,
  TenantSchema,
  type TenantId,
  type Tenant,
} from "@spine-event-engine/proto";
import {
  InMemoryStorageFactory,
  type RecordStorageOptions,
  RecordSpec,
  StorageGroup,
  type StorageContext,
  type RecordStorage,
} from "@spine-event-engine/storage";
import { StoragePreparations } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import { PersistentTenantIndex } from "../../src/context/persistent-tenant-index.js";
import type { TenantIndexCursor } from "../../src/context/tenant-index.js";
import { tenant } from "../tenant-fixture.js";

const group = new StorageGroup("tenant-directory-test");
const signal = new AbortController().signal;

function preparationProbe(factory: InMemoryStorageFactory) {
  const provider = StoragePreparations.for(factory);
  const prepare = vi.fn(() => Promise.resolve());
  StoragePreparations.register(factory, {
    supportsRecordIndexes: provider.supportsRecordIndexes === true,
    prepareRecord: async (context, spec, storageGroup, mode) => {
      await prepare();
      await provider.prepareRecord(context, spec, storageGroup, mode);
    },
    prepareEntity: provider.prepareEntity.bind(provider),
    prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
    prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
  });
  return prepare;
}

describe("persistent tenant index", () => {
  it("returns an empty page and complete list before registration", async () => {
    const factory = new InMemoryStorageFactory();
    const index = await PersistentTenantIndex.create({ storageFactory: factory, group });
    await expect(index.page({ count: 1, signal })).resolves.toEqual({ ids: [], hasMore: false });
    await expect(index.all()).resolves.toEqual([]);
    await index.close();
  });

  it("preserves complete IDs and the first registration through independent handles", async () => {
    const factory = new InMemoryStorageFactory();
    const firstTime = create(TimestampSchema, { seconds: 11n });
    const first = await PersistentTenantIndex.create({
      storageFactory: factory,
      group,
      clock: () => firstTime,
    });
    const second = await PersistentTenantIndex.create({
      storageFactory: factory,
      group,
      clock: () => create(TimestampSchema, { seconds: 22n }),
    });
    const value = tenant("example.test");
    const domain = create(TenantIdSchema, {
      kind: { case: "domain", value: create(InternetDomainSchema, { value: "example.test" }) },
    });
    expect(await first.contains(value)).toBe(false);
    await Promise.all([first.keep(value), second.keep(value)]);
    await first.keep(domain);
    const inspect = factory.createRecordStorage(
      { name: "inspection", multitenant: false },
      new RecordSpec({
        recordType: TenantSchema,
        idSchema: TenantIdSchema,
        extractId: (record) => record.id ?? tenant("missing"),
      }),
      group,
      { prepareOnAccess: false },
    );
    expect((await inspect.read(tenant("example.test")))?.whenCreated).toEqual(firstTime);
    inspect.close();
    value.kind = { case: "value", value: "changed" };
    expect(await second.contains(tenant("example.test"))).toBe(true);
    expect(await second.contains(domain)).toBe(true);
    const ids = await second.all();
    expect(ids).toHaveLength(2);
    const listed = ids[0];
    if (listed === undefined) throw new Error("Expected a registered tenant.");
    listed.kind = { case: "value", value: "changed result" };
    expect(await second.all()).toHaveLength(2);
    await first.close();
    expect(await second.contains(domain)).toBe(true);
    await second.close();
    expect(factory.isOpen()).toBe(true);
  });

  it("pages by continuation and rejects foreign or cancelled requests", async () => {
    const factory = new InMemoryStorageFactory();
    const first = await PersistentTenantIndex.create({ storageFactory: factory, group });
    const second = await PersistentTenantIndex.create({ storageFactory: factory, group });
    for (let index = 0; index < 12; index++) await first.keep(tenant(`tenant-${String(index)}`));
    const page = await first.page({ count: 3, signal });
    expect(page.ids).toHaveLength(3);
    expect(page.hasMore).toBe(true);
    if (page.after === undefined) throw new Error("Expected tenant continuation.");
    await expect(second.page({ count: 3, signal, after: page.after })).rejects.toThrow(
      /continuation/,
    );
    await expect(
      first.page({
        count: 3,
        signal,
        after: { [Symbol.toStringTag]: "TenantCatalogCursor" },
      }),
    ).rejects.toThrow(/continuation/);
    const ids = [...page.ids];
    let after: TenantIndexCursor | undefined = page.after;
    while (after !== undefined) {
      const next = await first.page({ count: 3, signal, after });
      ids.push(...next.ids);
      after = next.after;
    }
    expect(ids).toHaveLength(12);
    expect(await first.all()).toHaveLength(12);
    const controller = new AbortController();
    controller.abort();
    await expect(first.page({ count: 1, signal: controller.signal })).rejects.toThrow();
    await first.close();
    await second.close();
  });

  it("traverses beyond the provider's normal query batch", async () => {
    const factory = new InMemoryStorageFactory();
    const index = await PersistentTenantIndex.create({ storageFactory: factory, group });
    await Promise.all(
      Array.from({ length: 10_003 }, (_, count) => index.keep(tenant(`tenant-${String(count)}`))),
    );
    expect(await index.all()).toHaveLength(10_003);
    const page = await index.page({ count: Number.MAX_SAFE_INTEGER, signal });
    expect(page.ids).toHaveLength(10_003);
    expect(page.hasMore).toBe(false);
    await index.close();
  });

  it("skips preparation when requested and closes a failed construction handle", async () => {
    const factory = new InMemoryStorageFactory();
    const prepare = preparationProbe(factory);
    const createRecordStorage = vi.spyOn(factory, "createRecordStorage");
    const index = await PersistentTenantIndex.create({
      storageFactory: factory,
      group,
      createMissingStructures: false,
    });
    await index.keep(tenant("first"));
    expect(await index.contains(tenant("first"))).toBe(true);
    expect(prepare).not.toHaveBeenCalled();
    expect(createRecordStorage).toHaveBeenCalledWith(expect.anything(), expect.anything(), group, {
      prepareOnAccess: false,
    });
    await index.close();
  });

  it("prepares by default and closes only the acquired handle on preparation failure", async () => {
    const factory = new InMemoryStorageFactory();
    const prepare = preparationProbe(factory);
    const createStorage = vi.spyOn(factory, "createRecordStorage");
    const first = await PersistentTenantIndex.create({ storageFactory: factory, group });
    expect(prepare).toHaveBeenCalledOnce();
    const explicit = await PersistentTenantIndex.create({
      storageFactory: factory,
      group,
      createMissingStructures: true,
    });
    expect(prepare).toHaveBeenCalledTimes(2);
    await explicit.close();
    prepare.mockRejectedValueOnce(new Error("incompatible tenant table"));
    await expect(PersistentTenantIndex.create({ storageFactory: factory, group })).rejects.toThrow(
      "incompatible tenant table",
    );
    const failedHandle = createStorage.mock.results.at(-1)?.value as RecordStorage<
      TenantId,
      Tenant
    >;
    expect(failedHandle.isOpen()).toBe(false);
    await first.keep(tenant("usable"));
    await first.close();
    expect(factory.isOpen()).toBe(true);
  });

  it("rejects a provider without atomic compare-and-set and releases its handle", async () => {
    class NonAtomicFactory extends InMemoryStorageFactory {
      override createRecordStorage<I, R extends Message>(
        context: StorageContext,
        spec: RecordSpec<I, R>,
        group?: StorageGroup,
        options?: RecordStorageOptions,
      ): RecordStorage<I, R> {
        const storage = super.createRecordStorage(context, spec, group, options);
        Object.defineProperty(storage, "atomicCompareAndSet", { value: false });
        return storage;
      }
    }
    const factory = new NonAtomicFactory();
    const created = vi.spyOn(factory, "createRecordStorage");
    await expect(PersistentTenantIndex.create({ storageFactory: factory, group })).rejects.toThrow(
      /atomic compare-and-set/,
    );
    const handle = created.mock.results.at(-1)?.value as RecordStorage<TenantId, Tenant>;
    expect(handle.isOpen()).toBe(false);
    expect(factory.isOpen()).toBe(true);
  });

  it("drains admitted work and fences new calls during close", async () => {
    const factory = new InMemoryStorageFactory();
    const createStorage = vi.spyOn(factory, "createRecordStorage");
    const index = await PersistentTenantIndex.create({ storageFactory: factory, group });
    const storage = createStorage.mock.results.at(-1)?.value as RecordStorage<TenantId, Tenant>;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const read = storage.read.bind(storage);
    vi.spyOn(storage, "read").mockImplementation(async (id) => {
      await gate;
      return read(id);
    });
    const admitted = index.contains(tenant("pending"));
    const close = index.close();
    await expect(index.contains(tenant("new"))).rejects.toThrow(/closed/);
    expect(storage.isOpen()).toBe(true);
    release?.();
    await expect(admitted).resolves.toBe(false);
    await close;
    expect(storage.isOpen()).toBe(false);
    expect(index.close()).toBe(close);
  });

  it("propagates a failed primary-key lookup", async () => {
    const factory = new InMemoryStorageFactory();
    const createStorage = vi.spyOn(factory, "createRecordStorage");
    const index = await PersistentTenantIndex.create({ storageFactory: factory, group });
    const storage = createStorage.mock.results.at(-1)?.value as RecordStorage<TenantId, Tenant>;
    const failure = new Error("backend unavailable");
    vi.spyOn(storage, "read").mockRejectedValueOnce(failure);
    await expect(index.contains(tenant("failure"))).rejects.toBe(failure);
    await index.close();
  });

  it("retries a failed storage close without reopening index operations", async () => {
    const factory = new InMemoryStorageFactory();
    const created = vi.spyOn(factory, "createRecordStorage");
    const index = await PersistentTenantIndex.create({ storageFactory: factory, group });
    const storage = created.mock.results.at(-1)?.value as RecordStorage<TenantId, Tenant>;
    const closeStorage = storage.close.bind(storage);
    const close = vi
      .spyOn(storage, "close")
      .mockImplementationOnce(() => {
        throw new Error("temporary close failure");
      })
      .mockImplementation(closeStorage);
    await expect(index.close()).rejects.toThrow(/temporary close failure/);
    await expect(index.contains(tenant("closed"))).rejects.toThrow(/closed/);
    await index.close();
    expect(close).toHaveBeenCalledTimes(2);
    expect(storage.isOpen()).toBe(false);
  });

  it("rejects a page cancelled while the provider query is pending", async () => {
    const factory = new InMemoryStorageFactory();
    const created = vi.spyOn(factory, "createRecordStorage");
    const index = await PersistentTenantIndex.create({ storageFactory: factory, group });
    await index.keep(tenant("present"));
    const storage = created.mock.results.at(-1)?.value as RecordStorage<TenantId, Tenant>;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const query = storage.queryEntries.bind(storage);
    vi.spyOn(storage, "queryEntries").mockImplementation(async (request) => {
      await gate;
      return query(request);
    });
    const controller = new AbortController();
    const pending = index.page({ count: 1, signal: controller.signal });
    controller.abort();
    release?.();
    await expect(pending).rejects.toThrow();
    await index.close();
  });
});
