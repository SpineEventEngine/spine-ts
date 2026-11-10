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
  InMemoryStorageFactory,
  StorageGroup,
  type RecordSpec,
  type RecordStorage,
  type RecordStorageOptions,
  type StorageContext,
} from "@spine-event-engine/storage";
import { StoragePreparations } from "@spine-event-engine/storage/provider";
import { describe, expect, it, vi } from "vitest";

import { PersistentTokenRevocations } from "../../src/index.js";

const group = new StorageGroup("signed-revocations-test");
const deadline = (seconds: bigint, nanos = 0) => create(TimestampSchema, { seconds, nanos });

describe("persistent signed-token revocations", () => {
  it("validates scope and token IDs before storage mutation", async () => {
    const factory = new InMemoryStorageFactory();
    await expect(
      PersistentTokenRevocations.create({
        storageFactory: factory,
        group,
        issuer: "",
        audience: "client",
      }),
    ).rejects.toThrow("issuer must be nonempty");
    const store = await PersistentTokenRevocations.create({
      storageFactory: factory,
      group,
      issuer: "issuer",
      audience: "client",
    });
    await expect(store.revoke("", deadline(200n))).rejects.toThrow("jti must be nonempty");
    await expect(store.isRevoked("")).rejects.toThrow("jti must be nonempty");
    await store.revoke("token", deadline(253_402_300_799n));
    expect(await store.isRevoked("token")).toBe(true);
    const closing = store.close();
    expect(store.close()).toBe(closing);
    await closing;
    await factory.close();
  });

  it("rejects a maintenance cutoff later than its trusted clock", async () => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentTokenRevocations.create({
      storageFactory: factory,
      group,
      issuer: "cutoff",
      audience: "client",
      clock: () => deadline(100n),
    });
    await expect(store.purgeExpired(deadline(100n, 1))).rejects.toThrow(
      "later than the trusted clock",
    );
    await store.close();
    await factory.close();
  });

  it("prepares by default and explicit true, while false never invokes preparation", async () => {
    const factory = new InMemoryStorageFactory();
    const provider = StoragePreparations.for(factory);
    let preparations = 0;
    StoragePreparations.register(factory, {
      supportsRecordIndexes: true,
      prepareRecord: async (context, spec, storageGroup, mode) => {
        preparations += 1;
        await provider.prepareRecord(context, spec, storageGroup, mode);
      },
      prepareEntity: provider.prepareEntity.bind(provider),
      prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
      prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
    });
    const options = {
      storageFactory: factory,
      group,
      issuer: "issuer",
      audience: "client",
      clock: () => deadline(100n),
    };
    const skipped = await PersistentTokenRevocations.create({
      ...options,
      createMissingStructures: false,
    });
    expect(preparations).toBe(0);
    const prepared = await PersistentTokenRevocations.create(options);
    const explicit = await PersistentTokenRevocations.create({
      ...options,
      createMissingStructures: true,
    });
    expect(preparations).toBe(2);
    await prepared.revoke("prepared", deadline(200n));
    expect(await skipped.isRevoked("prepared")).toBe(true);
    await skipped.close();
    await prepared.close();
    await explicit.close();
    await factory.close();
  });

  it("rejects non-atomic storage and preserves preparation plus handle-close failures", async () => {
    class NonAtomicFactory extends InMemoryStorageFactory {
      override createRecordStorage<I, R extends Message>(
        context: StorageContext,
        spec: RecordSpec<I, R>,
        selectedGroup?: StorageGroup,
        options?: RecordStorageOptions,
      ): RecordStorage<I, R> {
        const handle = super.createRecordStorage(context, spec, selectedGroup, options);
        Object.defineProperty(handle, "atomicCompareAndSet", { value: false });
        return handle;
      }
    }
    const nonAtomic = new NonAtomicFactory();
    const opened = vi.spyOn(nonAtomic, "createRecordStorage");
    await expect(
      PersistentTokenRevocations.create({
        storageFactory: nonAtomic,
        group,
        issuer: "issuer",
        audience: "client",
      }),
    ).rejects.toThrow("atomic compare-and-set");
    const rejected = opened.mock.results[0]?.value as RecordStorage<string, Message>;
    expect(rejected.isOpen()).toBe(false);
    expect(nonAtomic.isOpen()).toBe(true);
    await nonAtomic.close();

    const factory = new InMemoryStorageFactory();
    const provider = StoragePreparations.for(factory);
    const failure = new Error("preparation failed");
    StoragePreparations.register(factory, {
      supportsRecordIndexes: true,
      prepareRecord: () => Promise.reject(failure),
      prepareEntity: provider.prepareEntity.bind(provider),
      prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
      prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
    });
    const handles = vi.spyOn(factory, "createRecordStorage");
    const creating = PersistentTokenRevocations.create({
      storageFactory: factory,
      group,
      issuer: "issuer",
      audience: "client",
    });
    const handle = handles.mock.results[0]?.value as RecordStorage<string, Message>;
    vi.spyOn(handle, "close").mockImplementation(() => {
      throw new Error("handle close failed");
    });
    await expect(creating).rejects.toMatchObject({
      errors: [failure, expect.objectContaining({ message: "handle close failed" })],
    });
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("retains the longest scoped deadline through its inclusive acceptance instant", async () => {
    const factory = new InMemoryStorageFactory();
    let current = deadline(100n);
    const options = {
      storageFactory: factory,
      group,
      issuer: "issuer",
      audience: "client",
      clock: () => current,
    };
    const first = await PersistentTokenRevocations.create(options);
    const second = await PersistentTokenRevocations.create({
      ...options,
      createMissingStructures: false,
    });
    const other = await PersistentTokenRevocations.create({
      ...options,
      audience: "other-client",
      createMissingStructures: false,
    });
    await Promise.all([
      first.revoke("token-1", deadline(100n, 1)),
      second.revoke("token-1", deadline(200n, 2)),
      first.revoke("token-1", deadline(150n, 3)),
    ]);
    expect(await first.isRevoked("token-1")).toBe(true);
    expect(await second.isRevoked("token-1")).toBe(true);
    expect(await other.isRevoked("token-1")).toBe(false);
    current = deadline(200n, 2);
    expect(await first.purgeExpired(deadline(200n, 2))).toBe(0);
    expect(await first.isRevoked("token-1")).toBe(true);
    current = deadline(200n, 3);
    expect(await second.isRevoked("token-1")).toBe(false);
    expect(await first.purgeExpired(deadline(200n, 3))).toBe(1);
    expect(await second.isRevoked("token-1")).toBe(false);
    await first.close();
    await second.close();
    await other.close();
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("preserves a concurrent extension selected by indexed cleanup", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    let current = deadline(150n);
    const options = {
      storageFactory: factory,
      group,
      issuer: "race",
      audience: "client",
      clock: () => current,
    };
    const first = await PersistentTokenRevocations.create(options);
    const second = await PersistentTokenRevocations.create({
      ...options,
      createMissingStructures: false,
    });
    await first.revoke("token", deadline(100n));
    const handle = opened.mock.results[0]?.value as RecordStorage<string, Message>;
    const cas = handle.compareAndSet.bind(handle);
    let extended = false;
    vi.spyOn(handle, "compareAndSet").mockImplementation(async (id, expected, replacement) => {
      if (replacement === undefined && !extended) {
        extended = true;
        await second.revoke("token", deadline(180n));
      }
      return cas(id, expected, replacement);
    });
    expect(await first.purgeExpired(deadline(150n))).toBe(0);
    expect(extended).toBe(true);
    expect(await second.isRevoked("token")).toBe(true);
    current = deadline(181n);
    expect(await second.purgeExpired(current)).toBe(1);
    await first.close();
    await second.close();
    await factory.close();
  });

  it("stops cancelled indexed discovery before conditional deletion", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentTokenRevocations.create({
      storageFactory: factory,
      group,
      issuer: "cancel",
      audience: "client",
      clock: () => deadline(200n),
    });
    await store.revoke("token", deadline(100n));
    const handle = opened.mock.results[0]?.value as RecordStorage<string, Message>;
    const query = handle.queryPlanEntries.bind(handle);
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(handle, "queryPlanEntries").mockImplementation(async (plan) => {
      entered();
      await pending;
      return query(plan);
    });
    const deletion = vi.spyOn(handle, "compareAndSet");
    const controller = new AbortController();
    const reason = new Error("maintenance cancelled");
    const purge = store.purgeExpired(deadline(150n), controller.signal);
    await waiting;
    controller.abort(reason);
    release();
    await expect(purge).rejects.toBe(reason);
    expect(deletion).not.toHaveBeenCalled();
    await store.close();
    await factory.close();
  });

  it("drains a pending exact-expiry page after close without deleting its records", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentTokenRevocations.create({
      storageFactory: factory,
      group,
      issuer: "page-close",
      audience: "client",
      clock: () => deadline(200n),
    });
    await store.revoke("token", deadline(100n));
    const handle = opened.mock.results[0]?.value as RecordStorage<string, Message>;
    const query = handle.queryEntries.bind(handle);
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => (entered = resolve));
    const pending = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(handle, "queryEntries").mockImplementation(async (plan) => {
      entered();
      await pending;
      return query(plan);
    });
    const deletion = vi.spyOn(handle, "compareAndSet");
    const purge = store.purgeExpired(deadline(150n));
    await waiting;
    const closing = store.close();
    release();
    await expect(purge).rejects.toThrow("closed");
    expect(deletion).not.toHaveBeenCalled();
    await closing;
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("drains a pending conditional deletion before closing its handle", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentTokenRevocations.create({
      storageFactory: factory,
      group,
      issuer: "closing",
      audience: "client",
      clock: () => deadline(200n),
    });
    await store.revoke("token", deadline(100n));
    const handle = opened.mock.results[0]?.value as RecordStorage<string, Message>;
    const cas = handle.compareAndSet.bind(handle);
    let entered!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(handle, "compareAndSet").mockImplementation(async (id, expected, replacement) => {
      entered();
      await pending;
      return cas(id, expected, replacement);
    });
    const purge = store.purgeExpired(deadline(150n));
    await waiting;
    let closed = false;
    const closing = store.close().then(() => {
      closed = true;
    });
    expect(closed).toBe(false);
    release();
    await expect(purge).rejects.toThrow("closed");
    await closing;
    expect(handle.isOpen()).toBe(false);
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });
});
