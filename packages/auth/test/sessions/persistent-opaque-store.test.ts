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
import type { Message } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  AuthenticatedPrincipalSchema,
  OpaqueSessionRecordSchema,
} from "@spine-event-engine/proto/auth";
import {
  InMemoryStorageFactory,
  StorageGroup,
  type RecordStorage,
  type RecordSpec,
  type RecordStorageOptions,
  type StorageContext,
} from "@spine-event-engine/storage";
import { StoragePreparations } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import { PersistentOpaqueSessionStore } from "../../src/index.js";

const group = new StorageGroup("opaque-session-store-test");

function record(id: string, generation: string, nanos: number) {
  return create(OpaqueSessionRecordSchema, {
    id,
    generation,
    principal: create(AuthenticatedPrincipalSchema, { id: "principal" }),
    whenExpires: create(TimestampSchema, { seconds: 100n, nanos }),
  });
}

describe("persistent opaque session store", () => {
  it("rejects non-atomic storage and leaves the shared factory usable", async () => {
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
    const opened = vi.spyOn(factory, "createRecordStorage");
    await expect(
      PersistentOpaqueSessionStore.create({ storageFactory: factory, group }),
    ).rejects.toThrow("atomic compare-and-set");
    const handle = opened.mock.results.at(-1)?.value as RecordStorage<
      string,
      ReturnType<typeof record>
    >;
    expect(handle.isOpen()).toBe(false);
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("rejects a future cutoff and a replacement with a different stable reference", async () => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentOpaqueSessionStore.create({
      storageFactory: factory,
      group,
      clock: () => create(TimestampSchema, { seconds: 200n }),
    });
    await expect(store.purgeExpired(create(TimestampSchema, { seconds: 201n }))).rejects.toThrow(
      "trusted clock",
    );
    await expect(
      store.replace(record("one", "first", 1), record("two", "second", 1)),
    ).rejects.toThrow("stable reference");
    await store.close();
    await store.close();
    await expect(store.read("one")).rejects.toThrow("closed");
    await factory.close();
  });

  it("rejects a malformed trusted maintenance clock before scanning", async () => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentOpaqueSessionStore.create({
      storageFactory: factory,
      group,
      clock: () => create(TimestampSchema, { seconds: 200n, nanos: 1_000_000_000 }),
    });
    await expect(store.purgeExpired(create(TimestampSchema, { seconds: 100n }))).rejects.toThrow(
      "Timestamp range",
    );
    await store.close();
    await factory.close();
  });

  it("preserves preparation and acquired-handle cleanup failures together", async () => {
    const factory = new InMemoryStorageFactory();
    const provider = StoragePreparations.for(factory);
    let fail!: (error: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => (fail = reject));
    StoragePreparations.register(factory, {
      supportsRecordIndexes: true,
      prepareRecord: async () => pending,
      prepareEntity: provider.prepareEntity.bind(provider),
      prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
      prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
    });
    const opened = vi.spyOn(factory, "createRecordStorage");
    const creating = PersistentOpaqueSessionStore.create({ storageFactory: factory, group });
    const handle = opened.mock.results.at(-1)?.value as RecordStorage<
      string,
      ReturnType<typeof record>
    >;
    vi.spyOn(handle, "close").mockImplementation(() => {
      throw new Error("handle close failed");
    });
    fail(new Error("preparation failed"));
    await expect(creating).rejects.toMatchObject({
      errors: [
        expect.objectContaining({ message: "preparation failed" }),
        expect.objectContaining({ message: "handle close failed" }),
      ],
    });
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("prepares by default and never prepares an explicitly skipped handle", async () => {
    const factory = new InMemoryStorageFactory();
    const provider = StoragePreparations.for(factory);
    let prepares = 0;
    StoragePreparations.register(factory, {
      supportsRecordIndexes: true,
      prepareRecord: async (context, spec, storageGroup, mode) => {
        prepares += 1;
        await provider.prepareRecord(context, spec, storageGroup, mode);
      },
      prepareEntity: provider.prepareEntity.bind(provider),
      prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
      prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
    });
    const skipped = await PersistentOpaqueSessionStore.create({
      storageFactory: factory,
      group,
      createMissingStructures: false,
    });
    expect(prepares).toBe(0);
    const prepared = await PersistentOpaqueSessionStore.create({ storageFactory: factory, group });
    expect(prepares).toBe(1);
    await skipped.insert(record("prepared", "one", 1));
    expect(prepares).toBe(1);
    await skipped.close();
    await prepared.close();
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("fences new work and drains an admitted read before handle close", async () => {
    const factory = new InMemoryStorageFactory();
    const created = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentOpaqueSessionStore.create({ storageFactory: factory, group });
    const handle = created.mock.results.at(-1)?.value as RecordStorage<
      string,
      ReturnType<typeof record>
    >;
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (entered = resolve));
    const read = handle.read.bind(handle);
    vi.spyOn(handle, "read").mockImplementation(async (id) => {
      entered();
      await pending;
      return read(id);
    });
    const reading = store.read("missing");
    await arrived;
    const closing = store.close();
    await expect(store.read("new")).rejects.toThrow("closed");
    expect(handle.isOpen()).toBe(true);
    release();
    await reading;
    await closing;
    expect(handle.isOpen()).toBe(false);
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("shares atomic generations and skips physical preparation on explicit false", async () => {
    const factory = new InMemoryStorageFactory();
    const clock = () => create(TimestampSchema, { seconds: 200n });
    const first = await PersistentOpaqueSessionStore.create({
      storageFactory: factory,
      group,
      clock,
    });
    const second = await PersistentOpaqueSessionStore.create({
      storageFactory: factory,
      group,
      clock,
      createMissingStructures: false,
    });
    const initial = record("stable", "one", 1);
    expect(await first.insert(initial)).toBe(true);
    expect(await second.read("stable")).toEqual(initial);
    const [left, right] = await Promise.all([
      first.replace(initial, record("stable", "two", 2)),
      second.replace(initial, record("stable", "three", 3)),
    ]);
    expect([left, right].sort()).toEqual([false, true]);
    expect(await first.purgeExpired(create(TimestampSchema, { seconds: 100n, nanos: 1 }))).toBe(0);
    expect(await first.read("stable")).toBeDefined();
    await first.close();
    await second.close();
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("purges exact tied deadlines and leaves newer nanoseconds", async () => {
    const factory = new InMemoryStorageFactory();
    const clock = () => create(TimestampSchema, { seconds: 200n });
    const store = await PersistentOpaqueSessionStore.create({
      storageFactory: factory,
      group,
      clock,
    });
    await store.insert(record("a", "one", 1));
    await store.insert(record("b", "one", 1));
    await store.insert(record("c", "one", 2));
    expect(await store.purgeExpired(create(TimestampSchema, { seconds: 100n, nanos: 1 }))).toBe(2);
    expect(await store.read("a")).toBeUndefined();
    expect(await store.read("b")).toBeUndefined();
    expect(await store.read("c")).toBeDefined();
    await store.close();
    await factory.close();
  });

  it("retains a concurrently extended session during conditional purge", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const clock = () => create(TimestampSchema, { seconds: 200n });
    const store = await PersistentOpaqueSessionStore.create({
      storageFactory: factory,
      group,
      clock,
    });
    const handle = opened.mock.results.at(-1)?.value as RecordStorage<
      string,
      ReturnType<typeof record>
    >;
    const old = record("renewed", "one", 1);
    const extended = create(OpaqueSessionRecordSchema, {
      ...old,
      generation: "two",
      whenExpires: create(TimestampSchema, { seconds: 300n }),
    });
    await store.insert(old);
    const compare = handle.compareAndSet.bind(handle);
    let intercepted = false;
    vi.spyOn(handle, "compareAndSet").mockImplementation(async (id, expected, next) => {
      if (!intercepted && next === undefined) {
        intercepted = true;
        await compare(id, expected, extended);
        return false;
      }
      return compare(id, expected, next);
    });
    expect(await store.purgeExpired(create(TimestampSchema, { seconds: 100n, nanos: 1 }))).toBe(0);
    expect(await store.read("renewed")).toEqual(extended);
    await store.close();
    await factory.close();
  });

  it.each([1, 2])(
    "leaves a changing expired row at %i nanos for later purge and lets close drain",
    async (nextNanos) => {
      const factory = new InMemoryStorageFactory();
      const opened = vi.spyOn(factory, "createRecordStorage");
      const store = await PersistentOpaqueSessionStore.create({
        storageFactory: factory,
        group,
        clock: () => create(TimestampSchema, { seconds: 200n }),
      });
      const handle = opened.mock.results.at(-1)?.value as RecordStorage<
        string,
        ReturnType<typeof record>
      >;
      const old = record("changing", "one", 1);
      const changed = record("changing", "two", nextNanos);
      await store.insert(old);
      let release!: () => void;
      let entered!: () => void;
      const pending = new Promise<void>((resolve) => (release = resolve));
      const arrived = new Promise<void>((resolve) => (entered = resolve));
      const compare = handle.compareAndSet.bind(handle);
      let attempts = 0;
      vi.spyOn(handle, "compareAndSet").mockImplementation(async (id, expected, next) => {
        if (next !== undefined) return compare(id, expected, next);
        attempts += 1;
        if (attempts > 1) throw new Error("purge retried a changing row");
        entered();
        await pending;
        expect(await compare(id, expected, changed)).toBe(true);
        return false;
      });
      const purging = store.purgeExpired(create(TimestampSchema, { seconds: 100n, nanos: 2 }));
      await arrived;
      const closing = store.close();
      expect(handle.isOpen()).toBe(true);
      release();
      await expect(purging).resolves.toBe(0);
      await closing;
      expect(attempts).toBe(1);
      expect(handle.isOpen()).toBe(false);
      const later = await PersistentOpaqueSessionStore.create({
        storageFactory: factory,
        group,
        clock: () => create(TimestampSchema, { seconds: 200n }),
      });
      expect(await later.read("changing")).toEqual(changed);
      expect(await later.purgeExpired(create(TimestampSchema, { seconds: 100n, nanos: 2 }))).toBe(
        1,
      );
      await later.close();
      await factory.close();
    },
  );

  it("rejects cancellation before and after an awaited expiry-page query", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const clock = () => create(TimestampSchema, { seconds: 200n });
    const store = await PersistentOpaqueSessionStore.create({
      storageFactory: factory,
      group,
      clock,
    });
    const handle = opened.mock.results.at(-1)?.value as RecordStorage<
      string,
      ReturnType<typeof record>
    >;
    const cutoff = create(TimestampSchema, { seconds: 100n });
    const early = new AbortController();
    early.abort(new Error("early cancellation"));
    await expect(store.purgeExpired(cutoff, early.signal)).rejects.toThrow("early cancellation");
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (entered = resolve));
    const query = handle.queryPlanEntries.bind(handle);
    vi.spyOn(handle, "queryPlanEntries").mockImplementation(async (plan) => {
      entered();
      await pending;
      return query(plan);
    });
    const late = new AbortController();
    const purging = store.purgeExpired(cutoff, late.signal);
    await arrived;
    late.abort(new Error("late cancellation"));
    const closing = store.close();
    release();
    await expect(purging).rejects.toThrow("late cancellation");
    await closing;
    expect(handle.isOpen()).toBe(false);
    await factory.close();
  });

  it("reports a confirmed insert after a late cancellation so the caller can compensate", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentOpaqueSessionStore.create({ storageFactory: factory, group });
    const handle = opened.mock.results.at(-1)?.value as RecordStorage<
      string,
      ReturnType<typeof record>
    >;
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (entered = resolve));
    const compare = handle.compareAndSet.bind(handle);
    vi.spyOn(handle, "compareAndSet").mockImplementation(async (id, expected, next) => {
      if (expected === undefined) {
        entered();
        await pending;
      }
      return compare(id, expected, next);
    });
    const controller = new AbortController();
    const candidate = record("late", "one", 1);
    const inserting = store.insert(candidate, controller.signal);
    await arrived;
    controller.abort(new Error("cancelled after admission"));
    release();
    await expect(inserting).resolves.toBe(true);
    expect(await store.remove(candidate)).toBe(true);
    expect(await store.read("late")).toBeUndefined();
    await store.close();
    await factory.close();
  });
});
