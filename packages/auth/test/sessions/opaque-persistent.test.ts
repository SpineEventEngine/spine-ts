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

import { describe, expect, it } from "vitest";
import { vi } from "vitest";
import { sealData } from "iron-session";
import {
  InMemoryStorageFactory,
  StorageGroup,
  type RecordStorage,
} from "@spine-event-engine/storage";

import {
  MemoryOpaqueSessionStore,
  OpaqueSessions,
  PersistentOpaqueSessionStore,
} from "../../src/index.js";
import type { OpaqueSessionRecord } from "@spine-event-engine/proto/auth";

const password = "an opaque session test secret with at least 32 characters";

function clock(start = Date.now()) {
  let current = start;
  return { now: () => current, advance: (milliseconds: number) => (current += milliseconds) };
}

describe("opaque sealed sessions", () => {
  it("rejects a validly sealed value with a non-session payload", async () => {
    const sessions = await OpaqueSessions.create({
      scope: "orders-browser",
      password,
      clock: clock(),
      ttlMilliseconds: 60_000,
    });
    const malformed = await sealData("different domain payload", { password, ttl: 60 });
    expect(await sessions.resolve({ kind: "cookie", value: malformed })).toBeUndefined();
    await sessions.close();
  });

  it("propagates an authoritative store read failure", async () => {
    class FailingReadStore extends MemoryOpaqueSessionStore {
      override read(): Promise<OpaqueSessionRecord | undefined> {
        return Promise.reject(new Error("session storage unavailable"));
      }
    }
    const store = new FailingReadStore();
    const sessions = await OpaqueSessions.create({
      store,
      scope: "orders-browser",
      password,
      clock: clock(),
      ttlMilliseconds: 60_000,
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    await expect(sessions.resolve(issued.credential)).rejects.toThrow(
      "session storage unavailable",
    );
    await sessions.close();
    await store.close();
  });

  it("propagates conditional replacement and stable revoke failures", async () => {
    class FailingMutationStore extends MemoryOpaqueSessionStore {
      override replace(): Promise<boolean> {
        return Promise.reject(new Error("replacement unavailable"));
      }
      override revoke(): Promise<boolean> {
        return Promise.reject(new Error("revoke unavailable"));
      }
    }
    const store = new FailingMutationStore();
    const sessions = await OpaqueSessions.create({
      store,
      scope: "orders-browser",
      password,
      clock: clock(),
      ttlMilliseconds: 60_000,
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    await expect(sessions.rotate(issued.credential)).rejects.toThrow("replacement unavailable");
    await expect(sessions.logout(issued.credential)).rejects.toThrow("revoke unavailable");
    expect(await sessions.resolve(issued.credential)).toBeDefined();
    await sessions.close();
    await store.close();
  });

  it("does not authenticate a delayed read after strategy close", async () => {
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (entered = resolve));
    class DelayedReadStore extends MemoryOpaqueSessionStore {
      delayed = false;
      override async read(id: string): Promise<OpaqueSessionRecord | undefined> {
        if (this.delayed) {
          entered();
          await pending;
        }
        return super.read(id);
      }
    }
    const store = new DelayedReadStore();
    const sessions = await OpaqueSessions.create({
      store,
      scope: "orders-browser",
      password,
      clock: clock(),
      ttlMilliseconds: 60_000,
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    store.delayed = true;
    const resolving = sessions.resolve(issued.credential);
    await arrived;
    const closing = sessions.close();
    release();
    expect(await resolving).toBeUndefined();
    await closing;
    await store.close();
  });

  it("drains and compensates a cancelled late rotation through persistent CAS", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentOpaqueSessionStore.create({
      storageFactory: factory,
      group: new StorageGroup("late-rotation-cas"),
    });
    const handle = opened.mock.results.at(-1)?.value as RecordStorage<string, OpaqueSessionRecord>;
    const sessions = await OpaqueSessions.create({
      store,
      scope: "orders-browser",
      password,
      clock: clock(),
      ttlMilliseconds: 60_000,
    });
    const issued = await sessions.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (entered = resolve));
    const compare = handle.compareAndSet.bind(handle);
    let stableId = "";
    vi.spyOn(handle, "compareAndSet").mockImplementation(async (id, expected, next) => {
      if (expected !== undefined && next !== undefined) {
        stableId = id;
        entered();
        await pending;
      }
      return compare(id, expected, next);
    });
    const controller = new AbortController();
    const rotating = sessions.rotate(issued.credential, controller.signal);
    await arrived;
    controller.abort(new Error("rotation cancelled"));
    const closing = sessions.close();
    release();
    await expect(rotating).rejects.toThrow("rotation cancelled");
    await closing;
    expect(await store.read(stableId)).toBeUndefined();
    await store.close();
    await factory.close();
  });

  it("does not retain a credential when injected entropy or principal access closes it", async () => {
    const firstStore = new MemoryOpaqueSessionStore();
    let firstClose: Promise<void> | undefined;
    const first = await OpaqueSessions.create({
      store: firstStore,
      scope: "orders-browser",
      password,
      clock: clock(),
      ttlMilliseconds: 60_000,
      randomBytes: () => {
        firstClose ??= first.close();
        return new Uint8Array(32).fill(5);
      },
    });
    await expect(first.issue({ id: "principal" })).rejects.toThrow("closed");
    await firstClose;
    expect(await firstStore.read(Buffer.alloc(32, 5).toString("base64url"))).toBeUndefined();
    await firstStore.close();

    const secondStore = new MemoryOpaqueSessionStore();
    const second = await OpaqueSessions.create({
      store: secondStore,
      scope: "orders-browser",
      password,
      clock: clock(),
      ttlMilliseconds: 60_000,
    });
    let secondClose: Promise<void> | undefined;
    await expect(
      second.issue({
        get id() {
          secondClose ??= second.close();
          return "principal";
        },
      }),
    ).rejects.toThrow("closed");
    await secondClose;
    await secondStore.close();
  });

  it("compensates a confirmed late commit through the persistent CAS boundary", async () => {
    const factory = new InMemoryStorageFactory();
    const opened = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentOpaqueSessionStore.create({
      storageFactory: factory,
      group: new StorageGroup("late-opaque-cas"),
    });
    const handle = opened.mock.results.at(-1)?.value as RecordStorage<string, OpaqueSessionRecord>;
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (entered = resolve));
    const compare = handle.compareAndSet.bind(handle);
    let insertedId = "";
    vi.spyOn(handle, "compareAndSet").mockImplementation(async (id, expected, next) => {
      if (expected === undefined && next !== undefined) {
        insertedId = id;
        entered();
        await pending;
      }
      return compare(id, expected, next);
    });
    const sessions = await OpaqueSessions.create({
      store,
      scope: "orders-browser",
      password,
      clock: clock(),
      ttlMilliseconds: 60_000,
    });
    const controller = new AbortController();
    const issued = sessions.issue({ id: "principal" }, controller.signal);
    await arrived;
    controller.abort(new Error("persistent request cancelled"));
    const closing = sessions.close();
    release();
    await expect(issued).rejects.toThrow("persistent request cancelled");
    await closing;
    expect(await store.read(insertedId)).toBeUndefined();
    await store.close();
    await factory.close();
  });

  it("reports a failed late-issuance compensation instead of hiding storage failure", async () => {
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (entered = resolve));
    class FailingCompensationStore extends MemoryOpaqueSessionStore {
      override async insert(record: OpaqueSessionRecord): Promise<boolean> {
        entered();
        await pending;
        return super.insert(record);
      }
      override remove(): Promise<boolean> {
        return Promise.reject(new Error("compensation unavailable"));
      }
    }
    const store = new FailingCompensationStore();
    const sessions = await OpaqueSessions.create({
      store,
      scope: "orders-browser",
      password,
      clock: clock(),
      ttlMilliseconds: 60_000,
    });
    const controller = new AbortController();
    const issued = sessions.issue({ id: "principal" }, controller.signal);
    await arrived;
    controller.abort(new Error("cancelled"));
    release();
    await expect(issued).rejects.toThrow("compensation failed");
    await sessions.close();
    await store.close();
  });

  it("does not compensate an existing identical record after a cancelled ID collision", async () => {
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (entered = resolve));
    class CollisionStore extends MemoryOpaqueSessionStore {
      delayed = false;
      override async insert(record: OpaqueSessionRecord): Promise<boolean> {
        if (this.delayed) {
          entered();
          await pending;
        }
        return super.insert(record);
      }
    }
    const store = new CollisionStore();
    const time = clock();
    const sessions = await OpaqueSessions.create({
      store,
      scope: "orders-browser",
      password,
      clock: time,
      ttlMilliseconds: 60_000,
      randomBytes: () => new Uint8Array(32).fill(1),
      collisionAttempts: 1,
    });
    const first = await sessions.issue({ id: "same" });
    if (first.kind !== "created") throw new Error("expected first issuance");
    store.delayed = true;
    const controller = new AbortController();
    const second = sessions.issue({ id: "same" }, controller.signal);
    await arrived;
    controller.abort(new Error("cancelled collision"));
    release();
    await expect(second).rejects.toThrow("cancelled collision");
    expect(await sessions.resolve(first.credential)).toBeDefined();
    await sessions.close();
    await store.close();
  });

  it("rotates across independent strategies sharing a store and accepts retained seal keys", async () => {
    const store = new MemoryOpaqueSessionStore();
    const time = clock();
    const oldKeys = { "1": password };
    const allKeys = { "1": password, "2": `${password}-new` };
    const first = await OpaqueSessions.create({
      store,
      scope: "orders-browser",
      password: oldKeys,
      clock: time,
      ttlMilliseconds: 60_000,
    });
    const second = await OpaqueSessions.create({
      store,
      scope: "orders-browser",
      password: allKeys,
      clock: time,
      ttlMilliseconds: 60_000,
    });
    const removedKey = await OpaqueSessions.create({
      store,
      scope: "orders-browser",
      password: { "2": `${password}-new` },
      clock: time,
      ttlMilliseconds: 60_000,
    });
    const issued = await first.issue({ id: "principal" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    expect(await second.resolve(issued.credential)).toBeDefined();
    expect(await removedKey.resolve(issued.credential)).toBeUndefined();
    const rotated = await second.rotate(issued.credential);
    if (rotated.kind !== "rotated") throw new Error("expected rotation");
    expect(await first.resolve(rotated.credential)).toBeUndefined();
    expect(await second.resolve(rotated.credential)).toBeDefined();
    await first.logout(issued.credential);
    expect(await second.resolve(rotated.credential)).toBeUndefined();
    await first.close();
    await second.close();
    await removedKey.close();
    await store.close();
  });

  it("conditionally compensates a late insert and drains it during close", async () => {
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => (release = resolve));
    const arrived = new Promise<void>((resolve) => (entered = resolve));
    let insertedId = "";
    class DelayedStore extends MemoryOpaqueSessionStore {
      override async insert(record: OpaqueSessionRecord): Promise<boolean> {
        insertedId = record.id;
        entered();
        await pending;
        return super.insert(record);
      }
    }
    const store = new DelayedStore();
    const controller = new AbortController();
    const sessions = await OpaqueSessions.create({
      scope: "orders-browser",
      password,
      clock: clock(),
      ttlMilliseconds: 60_000,
      store,
    });
    const issued = sessions.issue({ id: "principal" }, controller.signal);
    await arrived;
    controller.abort(new Error("request cancelled"));
    const closing = sessions.close();
    release();
    await expect(issued).rejects.toThrow("request cancelled");
    await closing;
    expect(await store.read(insertedId)).toBeUndefined();
    await store.close();
  });

  it("seals a scoped reference and keeps absent and empty attributes distinct", async () => {
    const time = clock();
    const sessions = await OpaqueSessions.create({
      scope: "orders-browser",
      password,
      clock: time,
      ttlMilliseconds: 60_000,
    });
    const absent = await sessions.issue({ id: "one" });
    const empty = await sessions.issue({ id: "two", attributes: {} });
    expect(absent.kind).toBe("created");
    expect(empty.kind).toBe("created");
    if (absent.kind !== "created" || empty.kind !== "created") return;
    expect(absent.credential.value).not.toContain("one");
    expect((await sessions.resolve(absent.credential))?.principal).toEqual({ id: "one" });
    expect((await sessions.resolve(empty.credential))?.principal).toEqual({
      id: "two",
      attributes: {},
    });
    await sessions.close();
  });

  it("accepts one rotation and lets an old live seal revoke its stable session", async () => {
    const time = clock();
    const sessions = await OpaqueSessions.create({
      scope: "orders-browser",
      password,
      clock: time,
      ttlMilliseconds: 60_000,
    });
    const first = await sessions.issue({ id: "one" });
    if (first.kind !== "created") throw new Error("expected issuance");
    const [left, right] = await Promise.all([
      sessions.rotate(first.credential),
      sessions.rotate(first.credential),
    ]);
    expect([left.kind, right.kind].sort()).toEqual(["rejected", "rotated"]);
    const winner = left.kind === "rotated" ? left : right;
    if (winner.kind !== "rotated") throw new Error("expected rotation");
    expect(await sessions.resolve(first.credential)).toBeUndefined();
    expect(await sessions.resolve(winner.credential)).toBeDefined();
    await sessions.logout(first.credential);
    expect(await sessions.resolve(winner.credential)).toBeUndefined();
    await sessions.close();
  });

  it("rejects a foreign scope and an exact expired seal", async () => {
    const time = clock();
    const one = await OpaqueSessions.create({
      scope: "orders-browser",
      password,
      clock: time,
      ttlMilliseconds: 1_000,
    });
    const other = await OpaqueSessions.create({
      scope: "other-browser",
      password,
      clock: time,
      ttlMilliseconds: 1_000,
    });
    const issued = await one.issue({ id: "one" });
    if (issued.kind !== "created") throw new Error("expected issuance");
    expect(await other.resolve(issued.credential)).toBeUndefined();
    time.advance(1_000);
    expect(await one.resolve(issued.credential)).toBeUndefined();
    await one.close();
    await other.close();
  });
});
