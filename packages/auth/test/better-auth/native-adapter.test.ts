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

import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { InMemoryStorageFactory, StorageGroup } from "@spine-event-engine/storage";
import { betterAuth } from "better-auth";
import type { AdapterFactory } from "better-auth/adapters";
import { describe, expect, it } from "vitest";

import { PersistentBetterAuthStore } from "../../src/better-auth/index.js";
import { nativeFactoryFor } from "../../src/better-auth/persistent-store.js";

const now = new Date("2025-01-01T00:00:00.000Z");
const later = new Date("2025-03-01T00:00:00.000Z");

/**
 * Opens actual native adapter operations over selected in-memory records.
 *
 * @returns Store, factory and transformed native adapter.
 */
async function harness() {
  const factory = new InMemoryStorageFactory();
  const store = await PersistentBetterAuthStore.create({
    storageFactory: factory,
    group: new StorageGroup("better-auth-operations"),
    models: ["session", "verification"],
    clock: () => timestampFromDate(now),
  });
  const auth = betterAuth({
    database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
    secret: "native-operations-secret-32-characters",
    baseURL: "http://localhost:3000",
    advanced: { database: { validateSchema: false } },
  });
  return { factory, store, native: (await auth.$context).adapter };
}

/**
 * Creates one complete native session with its token as stable identity.
 *
 * @param native Transformed native adapter.
 * @param token Stable session token.
 * @param userId Linked User ID.
 * @returns Created native session.
 */
async function session(
  native: Awaited<ReturnType<typeof harness>>["native"],
  token: string,
  userId: string,
) {
  return native.create({
    model: "session",
    data: {
      token,
      userId,
      expiresAt: later,
      createdAt: now,
      updatedAt: now,
    },
  });
}

describe("selected native adapter operations", () => {
  it("counts, pages and conditionally changes only matching sessions", async () => {
    const { factory, store, native } = await harness();
    try {
      await session(native, "a", "user-1");
      await session(native, "b", "user-1");
      await session(native, "c", "user-2");
      expect(
        await native.count({ model: "session", where: [{ field: "userId", value: "user-1" }] }),
      ).toBe(2);
      const page = await native.findMany<{ id: string }>({
        model: "session",
        where: [{ field: "userId", value: "user-1" }],
        limit: 1,
        offset: 1,
      });
      expect(page.map((row) => row.id)).toEqual(["b"]);
      expect(await native.findMany({ model: "session", limit: 0 })).toEqual([]);
      expect(
        (
          await native.update<{ ipAddress?: string }>({
            model: "session",
            where: [{ field: "token", value: "a" }],
            update: { ipAddress: "203.0.113.1" },
          })
        )?.ipAddress,
      ).toBe("203.0.113.1");
      expect(
        await native.updateMany({
          model: "session",
          where: [{ field: "userId", value: "user-1" }],
          update: { userAgent: "test-agent" },
        }),
      ).toBe(2);
      expect(
        await native.deleteMany({
          model: "session",
          where: [{ field: "userId", value: "user-1" }],
        }),
      ).toBe(2);
      expect(await native.count({ model: "session" })).toBe(1);
      await expect(
        native.update({
          model: "verification",
          where: [{ field: "identifier", value: "none" }],
          update: { value: "x" },
        }),
      ).rejects.toThrow(/immutable/u);
      expect(
        (
          await native.findOne<{ userId: string }>({
            model: "session",
            where: [{ field: "token", value: "c" }],
          })
        )?.userId,
      ).toBe("user-2");
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("consumes one immutable verification value and rejects a duplicate create", async () => {
    const { factory, store, native } = await harness();
    try {
      const data = {
        identifier: "auth-state:single",
        value: "secret",
        expiresAt: later,
        createdAt: now,
        updatedAt: now,
      };
      await native.create({ model: "verification", data });
      await expect(native.create({ model: "verification", data })).rejects.toThrow(/Duplicate/u);
      expect(
        (
          await native.consumeOne<{ value: string }>({
            model: "verification",
            where: [{ field: "identifier", value: data.identifier }],
          })
        )?.value,
      ).toBe("secret");
      expect(
        await native.consumeOne({
          model: "verification",
          where: [{ field: "identifier", value: data.identifier }],
        }),
      ).toBeNull();
      expect(await native.count({ model: "verification" })).toBe(0);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("rechecks each supported ordered Date predicate after indexed selection", async () => {
    const { factory, store, native } = await harness();
    try {
      await session(native, "early", "user-1");
      await native.create({
        model: "session",
        data: {
          token: "late",
          userId: "user-1",
          expiresAt: later,
          createdAt: new Date(now.getTime() + 1_000),
          updatedAt: now,
        },
      });
      const anchored = { field: "userId", value: "user-1" };
      const cases = [
        { operator: "lt", value: new Date(now.getTime() + 1_000), ids: ["early"] },
        { operator: "lte", value: now, ids: ["early"] },
        { operator: "gt", value: now, ids: ["late"] },
        { operator: "gte", value: new Date(now.getTime() + 1_000), ids: ["late"] },
      ] as const;
      for (const item of cases) {
        const rows = await native.findMany<{ id: string }>({
          model: "session",
          where: [anchored, { field: "createdAt", operator: item.operator, value: item.value }],
          limit: 10,
        });
        expect(rows.map((row) => row.id)).toEqual(item.ids);
      }
      const dateMembers = await native.findMany<{ id: string }>({
        model: "session",
        where: [
          anchored,
          { field: "createdAt", operator: "in", value: [new Date(now), later] },
        ] as unknown as Parameters<typeof native.findMany>[0]["where"],
        limit: 10,
      });
      expect(dateMembers.map((row) => row.id)).toEqual(["early"]);
      expect(
        await native.updateMany({
          model: "session",
          where: [
            anchored,
            { field: "createdAt", operator: "in", value: [new Date(now), later] },
          ] as unknown as Parameters<typeof native.updateMany>[0]["where"],
          update: { ipAddress: "203.0.113.7" },
        }),
      ).toBe(1);
      expect(
        (
          await native.findOne<{ ipAddress?: string }>({
            model: "session",
            where: [{ field: "token", value: "early" }],
          })
        )?.ipAddress,
      ).toBe("203.0.113.7");
      const members = await native.findMany<{ id: string }>({
        model: "session",
        where: [{ field: "userId", operator: "in", value: ["user-1", "absent"] }],
        limit: 10,
      });
      expect(members.map((row) => row.id)).toEqual(["early", "late"]);
      expect(
        await native.findMany({
          model: "session",
          where: [
            { field: "userId", value: "user-1" },
            { field: "ipAddress", operator: "in", value: ["203.0.113.1"] },
          ],
          limit: 10,
        }),
      ).toEqual([]);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("rejects unsupported model writes, predicates and identity mutations", async () => {
    const { factory, store, native } = await harness();
    try {
      await session(native, "fixed", "user-1");
      await expect(native.create({ model: "user", data: { id: "x" } })).rejects.toThrow(
        /provisioning/u,
      );
      await expect(
        native.findOne({ model: "session", where: [{ field: "bogus", value: "x" }] }),
      ).rejects.toThrow();
      await expect(
        native.findOne({ model: "account", where: [{ field: "accessToken", value: null }] }),
      ).rejects.toThrow(/query field/u);
      await expect(
        native.findOne({
          model: "session",
          where: [
            { field: "token", value: "fixed" },
            { field: "createdAt", operator: "in", value: now },
          ] as unknown as Parameters<typeof native.findOne>[0]["where"],
        }),
      ).rejects.toThrow(/array/u);
      for (const where of [
        [{ field: "createdAt", operator: "in", value: [new Date("invalid")] }],
        [{ field: "createdAt", operator: "lt", value: "2025-01-01" }],
        [{ field: "userId", operator: "in", value: ["user-1", 3] }],
        [{ field: "userId", operator: "gt", value: "user-1" }],
      ])
        await expect(
          native.findOne({
            model: "session",
            where: [{ field: "token", value: "fixed" }, ...where] as Parameters<
              typeof native.findOne
            >[0]["where"],
          }),
        ).rejects.toThrow(/query|predicate|membership/u);
      await expect(
        native.findOne({
          model: "session",
          where: [{ field: "token", operator: "ne", value: "fixed" }],
        }),
      ).rejects.toThrow(/operator/u);
      await expect(
        native.findOne({
          model: "session",
          where: [{ field: "userId", value: "user-1", mode: "insensitive" }],
        }),
      ).rejects.toThrow(/mode/u);
      await expect(
        native.findOne({
          model: "session",
          where: [{ field: "userId", value: "user-1", connector: "OR" }],
        }),
      ).rejects.toThrow(/connector/u);
      await expect(
        native.findMany({
          model: "session",
          limit: 1,
          sortBy: { field: "createdAt", direction: "asc" },
        }),
      ).rejects.toThrow(/sort/u);
      await expect(
        native.update({
          model: "session",
          where: [{ field: "token", value: "fixed" }],
          update: { token: "other" },
        }),
      ).rejects.toThrow(/immutable/u);
      expect(
        await native.update({ model: "session", where: [], update: { ipAddress: "x" } }),
      ).toBeNull();
      await expect(native.deleteMany({ model: "session", where: [] })).rejects.toThrow(
        /predicate/u,
      );
      expect(await native.count({ model: "session" })).toBe(1);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("rejects unsupported native query shapes before a broad record traversal", async () => {
    const { factory, store, native } = await harness();
    try {
      await session(native, "fixed", "user-1");
      for (const request of [
        { model: "session", limit: -1 },
        { model: "session", limit: 1, offset: -1 },
        { model: "session", limit: 1, sortBy: { field: "id", direction: "desc" } },
        {
          model: "session",
          limit: 1,
          where: [{ field: "createdAt", operator: "lt", value: later }],
        },
        { model: "session", limit: 1, where: [{ field: "userId", value: 42 }] },
        {
          model: "session",
          limit: 1,
          where: [{ field: "userId", operator: "in", value: ["user-1", 42] }],
        },
        { model: "session", limit: 1, where: [{ field: "id", operator: "in", value: [42] }] },
      ])
        await expect(
          native.findMany(request as Parameters<typeof native.findMany>[0]),
        ).rejects.toThrow();
      expect(
        await native.findMany({
          model: "session",
          limit: 1,
          sortBy: { field: "id", direction: "asc" },
        }),
      ).toHaveLength(1);
      expect(await native.count({ model: "session" })).toBe(1);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("resolves complete external Users by ID or email and rechecks the full predicate", async () => {
    const factory = new InMemoryStorageFactory();
    const user = {
      id: "directory-1",
      name: "Ada",
      email: "ada@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    };
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-external-users"),
      models: ["session"],
      users: {
        findById: (id) => Promise.resolve(id === user.id ? user : undefined),
        findByEmail: (email) => Promise.resolve(email === user.email ? user : undefined),
      },
      clock: () => timestampFromDate(now),
    });
    try {
      const auth = betterAuth({
        database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
        secret: "external-directory-test-secret-32-characters",
        baseURL: "http://localhost:3000",
        advanced: { database: { validateSchema: false } },
      });
      const native = (await auth.$context).adapter;
      expect(
        (
          await native.findOne<{ name: string }>({
            model: "user",
            where: [{ field: "id", value: user.id }],
          })
        )?.name,
      ).toBe("Ada");
      expect(
        (
          await native.findOne<{ id: string }>({
            model: "user",
            where: [{ field: "email", value: user.email }],
          })
        )?.id,
      ).toBe(user.id);
      expect(
        await native.findOne({
          model: "user",
          where: [
            { field: "id", value: user.id },
            { field: "email", value: "other@example.test" },
          ],
        }),
      ).toBeNull();
      await expect(native.findMany({ model: "user", limit: 10 })).rejects.toThrow(/ID or email/u);
    } finally {
      await store.close();
      await factory.close();
    }
  });
});
