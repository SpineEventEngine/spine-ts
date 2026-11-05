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

import {
  InMemoryStorageFactory,
  StorageGroup,
  type RecordStorage,
} from "@spine-event-engine/storage";
import { StoragePreparations } from "@spine-event-engine/storage/provider";
import { betterAuth } from "better-auth";
import type { AdapterFactory } from "better-auth/adapters";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { clone, create } from "@bufbuild/protobuf";
import {
  BetterAuthSessionRecordSchema,
  BetterAuthUserRecordSchema,
  type BetterAuthAccountRecord,
  type BetterAuthSessionRecord,
  type BetterAuthUserRecord,
  type BetterAuthVerificationRecord,
} from "@spine-event-engine/proto/auth";
import { describe, expect, it, vi } from "vitest";

import { PersistentBetterAuthStore, type BetterAuthUser } from "../../src/better-auth/index.js";
import { nativeFactoryFor } from "../../src/better-auth/persistent-store.js";
import { BetterAuthRecords } from "../../src/better-auth/record-codec.js";

describe("native record conversion", () => {
  const user = {
    id: "user-1",
    name: "Ada",
    email: "ada@example.test",
    emailVerified: false,
    image: "",
    createdAt: new Date(-1),
    updatedAt: new Date(1),
  };

  it("round-trips negative and neighboring millisecond dates and optional empty strings", () => {
    const record = BetterAuthRecords.encode("user", user);
    const decoded = BetterAuthRecords.decode("user", record);
    expect(decoded.createdAt).toEqual(new Date(-1));
    expect(decoded.updatedAt).toEqual(new Date(1));
    expect(decoded.image).toBe("");
    expect(
      BetterAuthRecords.decode(
        "user",
        BetterAuthRecords.encode("user", { ...user, image: undefined }),
      ).image,
    ).toBeUndefined();
  });

  it("rejects unused provider artifacts while retaining a provisioned password hash", () => {
    const account = {
      id: "provider_subject",
      userId: "user-1",
      providerId: "credential",
      accountId: "user-1",
      password: "stored-hash",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    expect(
      BetterAuthRecords.decode("account", BetterAuthRecords.encode("account", account)).password,
    ).toBe("stored-hash");
    for (const field of [
      "accessToken",
      "refreshToken",
      "idToken",
      "scope",
      "accessTokenExpiresAt",
      "refreshTokenExpiresAt",
    ])
      for (const value of ["unused-secret", ""])
        expect(() => BetterAuthRecords.encode("account", { ...account, [field]: value })).toThrow(
          /Unsupported selected Account value/u,
        );
    expect(() =>
      BetterAuthRecords.encode("account", { ...account, accessToken: null }),
    ).not.toThrow();
  });

  it("rejects malformed selected identities and unknown native fields before encoding", () => {
    const createdAt = new Date(0);
    expect(() =>
      BetterAuthRecords.encode("verification", {
        id: "verification-slot",
        identifier: "",
        value: "secret",
        expiresAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      }),
    ).toThrow(/requires identifier/u);
    expect(() =>
      BetterAuthRecords.key("account", {
        providerId: "google",
        accountId: "",
      }),
    ).toThrow(/nonempty/u);
    expect(() =>
      BetterAuthRecords.encode("session", {
        id: "session-1",
        token: 42,
        userId: "user-1",
        expiresAt: createdAt,
        createdAt,
        updatedAt: createdAt,
      }),
    ).toThrow(/token/u);
    expect(() =>
      BetterAuthRecords.encode("session", {
        id: "session-1",
        userId: "user-1",
        expiresAt: createdAt,
        createdAt,
        updatedAt: createdAt,
        randomField: "not selected",
      }),
    ).toThrow(/Unsupported session field/u);
  });

  it("rejects malformed native types and unrepresentable dates before persistence", () => {
    expect(() => BetterAuthRecords.encode("user", { ...user, emailVerified: "yes" })).toThrow(
      /emailVerified/u,
    );
    expect(() =>
      BetterAuthRecords.encode("user", { ...user, createdAt: new Date(Number.NaN) }),
    ).toThrow(/date/u);
    const record = create(BetterAuthUserRecordSchema, {
      ...user,
      createdAt: { seconds: 0n, nanos: 1 },
      updatedAt: timestampFromDate(new Date(0)),
    });
    expect(() => BetterAuthRecords.decode("user", record)).toThrow(/submillisecond/u);
  });
});

describe("PersistentBetterAuthStore construction", () => {
  it("acquires and prepares only selected models by default", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const provider = StoragePreparations.for(factory);
    const prepared: string[] = [];
    StoragePreparations.register(factory, {
      supportsRecordIndexes: true,
      prepareRecord: async (_context, spec, _group, mode) => {
        prepared.push(mode);
        await provider.prepareRecord(_context, spec, _group, mode);
      },
      prepareEntity: provider.prepareEntity.bind(provider),
      prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
      prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
    });
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-selected"),
      models: ["session", "account"],
    });

    expect(acquired).toHaveBeenCalledTimes(2);
    expect(prepared).toHaveLength(2);
    expect(prepared).toEqual(["create", "create"]);
    await store.close();
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("skips all physical preparation on an explicit false handle", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const provider = StoragePreparations.for(factory);
    const prepared = vi.fn();
    StoragePreparations.register(factory, {
      supportsRecordIndexes: true,
      prepareRecord: (context, spec, group, mode) => {
        prepared();
        return provider.prepareRecord(context, spec, group, mode);
      },
      prepareEntity: provider.prepareEntity.bind(provider),
      prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
      prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
    });
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-unprepared"),
      models: ["session"],
      createMissingStructures: false,
    });

    expect(acquired).toHaveBeenCalledTimes(1);
    expect(prepared).not.toHaveBeenCalled();
    await store.close();
    await factory.close();
  });

  it("rejects a stored User alongside an external User source before storage acquisition", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    await expect(
      PersistentBetterAuthStore.create({
        storageFactory: factory,
        group: new StorageGroup("better-auth-conflict"),
        models: ["user", "session"],
        users: { findById: () => Promise.resolve(undefined) },
      }),
    ).rejects.toThrow(/User/u);
    expect(acquired).not.toHaveBeenCalled();
    await factory.close();
  });

  it("rejects invalid selections before acquisition and closes a non-CAS handle", async () => {
    const factory = new InMemoryStorageFactory();
    const original = factory.createRecordStorage.bind(factory);
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const group = new StorageGroup("better-auth-invalid-selection");
    for (const models of [[], ["session", "session"], ["unsupported"]])
      await expect(
        PersistentBetterAuthStore.create({
          storageFactory: factory,
          group,
          models: models as "session"[],
        }),
      ).rejects.toThrow();
    expect(acquired).not.toHaveBeenCalled();
    acquired.mockImplementation((...args) => {
      const handle = original(...args);
      Object.defineProperty(handle, "atomicCompareAndSet", { value: false });
      return handle;
    });
    await expect(
      PersistentBetterAuthStore.create({
        storageFactory: factory,
        group,
        models: ["session"],
      }),
    ).rejects.toThrow(/atomic compare-and-set/u);
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("retains both preparation and acquired-handle cleanup failures", async () => {
    const factory = new InMemoryStorageFactory();
    const original = factory.createRecordStorage.bind(factory);
    vi.spyOn(factory, "createRecordStorage").mockImplementation((...args) => {
      const handle = original(...args);
      vi.spyOn(handle, "close").mockImplementation(() => {
        throw new Error("handle close failed");
      });
      return handle;
    });
    const provider = StoragePreparations.for(factory);
    StoragePreparations.register(factory, {
      supportsRecordIndexes: true,
      prepareRecord: () => Promise.reject(new Error("preparation failed")),
      prepareEntity: provider.prepareEntity.bind(provider),
      prepareAgentHistory: provider.prepareAgentHistory.bind(provider),
      prepareAgentCommit: provider.prepareAgentCommit.bind(provider),
    });
    await expect(
      PersistentBetterAuthStore.create({
        storageFactory: factory,
        group: new StorageGroup("better-auth-failed-preparation"),
        models: ["session"],
      }),
    ).rejects.toMatchObject({
      errors: [new Error("preparation failed"), new Error("handle close failed")],
    });
    expect(factory.isOpen()).toBe(true);
    await factory.close();
  });

  it("reports selected-handle close failure while retaining the shared factory", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-close-failure"),
      models: ["session"],
    });
    const handle = acquired.mock.results[0]?.value as RecordStorage<
      string,
      BetterAuthSessionRecord
    >;
    const close = vi.spyOn(handle, "close").mockImplementation(() => {
      throw new Error("selected handle failed to close");
    });
    try {
      await expect(store.close()).rejects.toThrow(/Better Auth handle close failed/u);
      expect(factory.isOpen()).toBe(true);
    } finally {
      close.mockRestore();
      await factory.close();
    }
  });
});

describe("controlled provisioning", () => {
  const now = new Date("2025-01-01T00:00:00.123Z");
  const user = {
    id: "user-1",
    name: "Ada",
    email: "ada@example.test",
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  };

  it("accepts an identical retry and rejects conflicting IDs or emails before another write", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-idempotent"),
      models: ["user"],
    });
    try {
      await store.provision({ users: [user] });
      await store.provision({ users: [user] });
      await expect(store.provision({ users: [{ ...user, name: "Other" }] })).rejects.toThrow(
        /Conflicting/u,
      );
      await expect(store.provision({ users: [{ ...user, id: "user-2" }] })).rejects.toThrow(
        /email/u,
      );
      const storage = acquired.mock.results[0]?.value as RecordStorage<
        string,
        BetterAuthUserRecord
      >;
      expect((await storage.queryEntries({})).map((entry) => entry.id)).toEqual(["user-1"]);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("fences native traffic after a partial write until an identical retry completes", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-partial"),
      models: ["user", "account", "session"],
    });
    try {
      const account = acquired.mock.results[1]?.value as RecordStorage<
        string,
        BetterAuthAccountRecord
      >;
      vi.spyOn(account, "compareAndSet").mockRejectedValueOnce(new Error("account write failed"));
      const provisionedUser = { ...user };
      const provisionedAccount = {
        userId: "user-1",
        accountId: "user-1",
        providerId: "credential",
        password: "hashed-secret",
        createdAt: now,
        updatedAt: now,
      };
      const input = {
        users: [provisionedUser],
        accounts: [provisionedAccount],
      };
      await expect(store.provision(input)).rejects.toThrow(/account write failed/u);
      const native = (
        await betterAuth({
          database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
          secret: "e".repeat(32),
          baseURL: "http://localhost:3000",
          advanced: { database: { validateSchema: false } },
        }).$context
      ).adapter;
      await expect(
        native.findOne({ model: "user", where: [{ field: "id", value: "user-1" }] }),
      ).rejects.toThrow(/provisioning/u);
      await expect(store.provision({})).rejects.toThrow(/identical/u);
      await expect(store.provision({ users: [user] })).rejects.toThrow(/identical/u);
      await expect(store.provision({ users: [{ ...user, id: "unrelated" }] })).rejects.toThrow(
        /identical/u,
      );
      provisionedUser.name = "Mutated after failure";
      await expect(store.provision(input)).rejects.toThrow(/identical/u);
      provisionedUser.name = user.name;
      provisionedAccount.password = "changed-secret";
      await expect(store.provision(input)).rejects.toThrow(/identical/u);
      provisionedAccount.password = "hashed-secret";
      await expect(
        native.findOne({ model: "user", where: [{ field: "id", value: "user-1" }] }),
      ).rejects.toThrow(/provisioning/u);
      await store.provision(input);
      expect(
        (
          await native.findOne<{ id: string }>({
            model: "user",
            where: [{ field: "id", value: "user-1" }],
          })
        )?.id,
      ).toBe("user-1");
      expect(
        (
          await native.findOne<{ id: string }>({
            model: "user",
            where: [
              { field: "id", value: "user-1" },
              { field: "emailVerified", value: true },
            ],
          })
        )?.id,
      ).toBe("user-1");
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("provisions only prelinked Accounts against a complete external User", async () => {
    const factory = new InMemoryStorageFactory();
    let linked = false;
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-external-account"),
      models: ["account"],
      users: { findById: (id) => Promise.resolve(linked && id === user.id ? user : undefined) },
    });
    const account = {
      userId: user.id,
      providerId: "google",
      accountId: "subject-1",
      createdAt: now,
      updatedAt: now,
    };
    try {
      await expect(store.provision({ accounts: [account] })).rejects.toThrow(/absent User/u);
      linked = true;
      await store.provision({ accounts: [account] });
      const auth = betterAuth({
        database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
        secret: "prelinked-account-test-secret-32-characters",
        baseURL: "http://localhost:3000",
        advanced: { database: { validateSchema: false } },
      });
      const native = (await auth.$context).adapter;
      expect(
        (
          await native.findOne<{ userId: string }>({
            model: "account",
            where: [
              { field: "providerId", value: "google" },
              { field: "accountId", value: "subject-1" },
            ],
          })
        )?.userId,
      ).toBe(user.id);
      expect(
        await native.count({ model: "account", where: [{ field: "userId", value: user.id }] }),
      ).toBe(1);
      await expect(
        native.update({
          model: "account",
          where: [{ field: "accountId", value: "subject-1" }],
          update: { password: "other" },
        }),
      ).rejects.toThrow(/provisioning/u);
      await expect(
        native.deleteMany({
          model: "account",
          where: [{ field: "userId", value: user.id }],
        }),
      ).rejects.toThrow(/provisioning/u);
      await store.provision({ accounts: [account] });
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("rejects provisioning families absent from the selected store", async () => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-no-provisioned-models"),
      models: ["session"],
    });
    try {
      await expect(store.provision({ users: [user] })).rejects.toThrow(/Stored User/u);
      await expect(
        store.provision({
          accounts: [
            {
              userId: user.id,
              providerId: "google",
              accountId: "subject-1",
              createdAt: now,
              updatedAt: now,
            },
          ],
        }),
      ).rejects.toThrow(/Account was not selected/u);
      expect(await store.purgeExpired(timestampFromDate(now))).toBe(0);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("rejects duplicate batch identities and absent stored links before writes", async () => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-batch-validation"),
      models: ["user", "account"],
    });
    const account = {
      userId: user.id,
      providerId: "google",
      accountId: "subject-1",
      createdAt: now,
      updatedAt: now,
    };
    try {
      await expect(store.provision({ users: [user, user] })).rejects.toThrow(/Duplicate/u);
      await expect(store.provision({ users: [user, { ...user, id: "other" }] })).rejects.toThrow(
        /Duplicate/u,
      );
      await expect(store.provision({ accounts: [account] })).rejects.toThrow(/absent User/u);
      await store.provision({ users: [user], accounts: [account] });
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("serializes administrator provisioning while an external link read is pending", async () => {
    const factory = new InMemoryStorageFactory();
    let release!: () => void;
    let entered!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-provisioning-serial"),
      models: ["account"],
      users: {
        findById: async () => {
          entered();
          await pending;
          return user;
        },
      },
    });
    const account = {
      userId: user.id,
      providerId: "google",
      accountId: "subject-1",
      createdAt: now,
      updatedAt: now,
    };
    try {
      const first = store.provision({ accounts: [account] });
      await reading;
      await expect(store.provision({ accounts: [account] })).rejects.toThrow(
        /already in progress/u,
      );
      release();
      await first;
      await store.provision({ accounts: [account] });
    } finally {
      release();
      await store.close();
      await factory.close();
    }
  });
});

describe("native Better Auth adapter", () => {
  it("creates and resolves a session through the actual native adapter factory", async () => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-native-session"),
      models: ["session"],
      users: { findById: () => Promise.resolve(undefined) },
      clock: () => timestampFromDate(new Date("2025-01-02T03:04:05.678Z")),
    });
    try {
      const auth = betterAuth({
        database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
        secret: "a".repeat(32),
        baseURL: "http://localhost:3000",
        session: { cookieCache: { enabled: false } },
        advanced: { database: { validateSchema: false } },
      });
      const native = (await auth.$context).adapter;
      const now = new Date("2025-01-02T03:04:05.678Z");
      const session = await native.create({
        model: "session",
        data: {
          token: "native-token",
          userId: "user-1",
          expiresAt: new Date("2025-02-02T03:04:05.678Z"),
          createdAt: now,
          updatedAt: now,
        },
      });
      expect(session.id).toBe("native-token");
      expect(
        (
          await native.findOne<{ id: string }>({
            model: "session",
            where: [{ field: "token", value: "native-token" }],
          })
        )?.id,
      ).toBe("native-token");
      await expect(
        native.findOne({ model: "session", where: [{ field: "ipAddress", value: "127.0.0.1" }] }),
      ).rejects.toThrow(/indexed/u);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("signs in only an administrator-provisioned password identity", async () => {
    const factory = new InMemoryStorageFactory();
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-password"),
      models: ["user", "account", "session"],
    });
    const auth = betterAuth({
      database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
      secret: "c".repeat(32),
      baseURL: "http://localhost:3000",
      emailAndPassword: { enabled: true, disableSignUp: true },
      session: { cookieCache: { enabled: false } },
      advanced: { database: { validateSchema: false } },
    });
    try {
      const ctx = await auth.$context;
      const now = new Date();
      await store.provision({
        users: [
          {
            id: "user-1",
            name: "Ada",
            email: "ada@example.test",
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          },
        ],
        accounts: [
          {
            userId: "user-1",
            accountId: "user-1",
            providerId: "credential",
            password: await ctx.password.hash("correct-password-123"),
            createdAt: now,
            updatedAt: now,
          },
        ],
      });
      const response = await auth.api.signInEmail({
        body: { email: "ada@example.test", password: "correct-password-123" },
        asResponse: true,
      });
      expect(response.status).toBe(200);
      const cookie = response.headers.getSetCookie()[0]?.split(";")[0];
      expect(cookie).toBeTruthy();
      if (cookie === undefined) throw new Error("Native sign-in omitted its session cookie.");
      const session = await auth.api.getSession({ headers: new Headers({ cookie }) });
      expect(session?.user.id).toBe("user-1");
      const signup = await auth.api.signUpEmail({
        body: { name: "New", email: "new@example.test", password: "correct-password-123" },
        asResponse: true,
      });
      expect(signup.status).not.toBe(200);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("makes a native OAuth state deletion a one-winner consume gate", async () => {
    const factory = new InMemoryStorageFactory();
    const group = new StorageGroup("better-auth-state-gate");
    const first = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group,
      models: ["verification"],
      clock: () => timestampFromDate(new Date("2025-01-01T00:00:00.000Z")),
    });
    const second = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group,
      models: ["verification"],
      clock: () => timestampFromDate(new Date("2025-01-01T00:00:00.000Z")),
    });
    const native = async (store: PersistentBetterAuthStore) =>
      (
        await betterAuth({
          database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
          secret: "b".repeat(32),
          baseURL: "http://localhost:3000",
          advanced: { database: { validateSchema: false } },
        }).$context
      ).adapter;
    try {
      const a = await native(first);
      const b = await native(second);
      await a.create({
        model: "verification",
        data: {
          identifier: "auth-state:one",
          value: "opaque-state",
          expiresAt: new Date("2025-02-01T00:00:00.000Z"),
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      });
      await a.delete({
        model: "verification",
        where: [{ field: "identifier", value: "auth-state:one" }],
      });
      await expect(
        b.delete({
          model: "verification",
          where: [{ field: "identifier", value: "auth-state:one" }],
        }),
      ).rejects.toThrow(/consumed/u);
    } finally {
      await first.close();
      await second.close();
      await factory.close();
    }
  });

  it("maintains a selected Verification family without a Session handle", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const expiry = new Date("2025-01-02T00:00:00.123Z");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-verification-only"),
      models: ["verification"],
      clock: () => timestampFromDate(expiry),
    });
    try {
      const storage = acquired.mock.results[0]?.value as RecordStorage<
        string,
        BetterAuthVerificationRecord
      >;
      const record = BetterAuthRecords.encode("verification", {
        id: "verification-1",
        identifier: "auth-state:one",
        value: "state-secret",
        expiresAt: expiry,
        createdAt: expiry,
        updatedAt: expiry,
      }) as BetterAuthVerificationRecord;
      expect(await storage.compareAndSet(record.id, undefined, record)).toBe(true);
      expect(await store.purgeExpired(timestampFromDate(expiry))).toBe(1);
      expect(await storage.read(record.id)).toBeUndefined();
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("hides an expired session until explicit indexed maintenance removes it", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const expiry = new Date("2025-01-02T00:00:00.123Z");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-expiry"),
      models: ["session"],
      clock: () => timestampFromDate(expiry),
    });
    try {
      const native = (
        await betterAuth({
          database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
          secret: "d".repeat(32),
          baseURL: "http://localhost:3000",
          advanced: { database: { validateSchema: false } },
        }).$context
      ).adapter;
      await native.create({
        model: "session",
        data: {
          token: "expired-token",
          userId: "user-1",
          expiresAt: expiry,
          createdAt: new Date("2025-01-01T00:00:00.000Z"),
          updatedAt: new Date("2025-01-01T00:00:00.000Z"),
        },
      });
      expect(
        await native.findOne({
          model: "session",
          where: [{ field: "token", value: "expired-token" }],
        }),
      ).toBeNull();
      const storage = acquired.mock.results[0]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      expect(await storage.read("expired-token")).toBeDefined();
      expect(await store.purgeExpired(timestampFromDate(expiry))).toBe(1);
      expect(await storage.read("expired-token")).toBeUndefined();
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("leaves a concurrently extended expiry for later maintenance and rejects a future cutoff", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const cutoff = new Date("2025-02-01T00:00:00.000Z");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-expiry-race"),
      models: ["session"],
      clock: () => timestampFromDate(cutoff),
    });
    try {
      const storage = acquired.mock.results[0]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      const originalExpiry = timestampFromDate(new Date("2025-01-01T00:00:00.000Z"));
      const laterExpiry = timestampFromDate(new Date("2025-03-01T00:00:00.000Z"));
      const record = create(BetterAuthSessionRecordSchema, {
        id: "extended-token",
        userId: "user-1",
        expiresAt: originalExpiry,
        createdAt: originalExpiry,
        updatedAt: originalExpiry,
      });
      expect(await storage.compareAndSet(record.id, undefined, record)).toBe(true);
      const compare = storage.compareAndSet.bind(storage);
      vi.spyOn(storage, "compareAndSet").mockImplementation(async (id, expected, next) => {
        if (next === undefined && expected !== undefined) {
          const extended = clone(BetterAuthSessionRecordSchema, expected);
          extended.expiresAt = laterExpiry;
          expect(await compare(id, expected, extended)).toBe(true);
          return false;
        }
        return compare(id, expected, next);
      });
      expect(await store.purgeExpired(timestampFromDate(cutoff))).toBe(0);
      expect((await storage.read(record.id))?.expiresAt).toEqual(laterExpiry);
      await expect(
        store.purgeExpired(timestampFromDate(new Date(cutoff.getTime() + 1))),
      ).rejects.toThrow(/cutoff/u);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("stops expiry maintenance after an abort during a confirmed deletion", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const cutoff = new Date("2025-02-01T00:00:00.000Z");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-expiry-abort"),
      models: ["session"],
      clock: () => timestampFromDate(cutoff),
    });
    try {
      const storage = acquired.mock.results[0]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      const expiry = timestampFromDate(new Date("2025-01-01T00:00:00.000Z"));
      for (const id of ["first", "second"])
        expect(
          await storage.compareAndSet(
            id,
            undefined,
            create(BetterAuthSessionRecordSchema, {
              id,
              userId: "user-1",
              expiresAt: expiry,
              createdAt: expiry,
              updatedAt: expiry,
            }),
          ),
        ).toBe(true);
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const deleting = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const original = storage.compareAndSet.bind(storage);
      vi.spyOn(storage, "compareAndSet").mockImplementation(async (id, expected, next) => {
        if (next === undefined && id === "first") {
          entered();
          await gate;
        }
        return original(id, expected, next);
      });
      const controller = new AbortController();
      const aborted = new Error("maintenance aborted");
      const pending = store.purgeExpired(timestampFromDate(cutoff), controller.signal);
      await deleting;
      controller.abort(aborted);
      release();
      await expect(pending).rejects.toBe(aborted);
      expect(await storage.read("first")).toBeUndefined();
      expect(await storage.read("second")).toBeDefined();
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("drains an admitted native read before closing its handle", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-close-drain"),
      models: ["session"],
    });
    const native = (
      await betterAuth({
        database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
        secret: "f".repeat(32),
        baseURL: "http://localhost:3000",
        advanced: { database: { validateSchema: false } },
      }).$context
    ).adapter;
    try {
      const now = new Date();
      await native.create({
        model: "session",
        data: {
          token: "drain-token",
          userId: "user-1",
          expiresAt: new Date(now.getTime() + 60_000),
          createdAt: now,
          updatedAt: now,
        },
      });
      const storage = acquired.mock.results[0]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      const originalRead = storage.read.bind(storage);
      let started!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      vi.spyOn(storage, "read").mockImplementation(async (id: string) => {
        started();
        await gate;
        return originalRead(id);
      });
      const pending = native.findOne<{ id: string }>({
        model: "session",
        where: [{ field: "token", value: "drain-token" }],
      });
      await entered;
      const closing = store.close();
      expect(storage.isOpen()).toBe(true);
      await expect(
        native.findOne({ model: "session", where: [{ field: "token", value: "drain-token" }] }),
      ).rejects.toThrow(/closed/u);
      release();
      expect((await pending)?.id).toBe("drain-token");
      await closing;
      expect(storage.isOpen()).toBe(false);
      expect(factory.isOpen()).toBe(true);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("keeps external User absence, outage and incomplete projection distinct", async () => {
    const factory = new InMemoryStorageFactory();
    const lookup = vi
      .fn<(...args: [string]) => Promise<BetterAuthUser | undefined>>()
      .mockResolvedValue(undefined);
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-external-user"),
      models: ["session"],
      users: { findById: lookup },
    });
    try {
      const native = (
        await betterAuth({
          database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
          secret: "g".repeat(32),
          baseURL: "http://localhost:3000",
          advanced: { database: { validateSchema: false } },
        }).$context
      ).adapter;
      expect(
        await native.findOne({ model: "user", where: [{ field: "id", value: "unknown" }] }),
      ).toBeNull();
      lookup.mockRejectedValueOnce(new Error("directory unavailable"));
      await expect(
        native.findOne({ model: "user", where: [{ field: "id", value: "user-1" }] }),
      ).rejects.toThrow(/directory unavailable/u);
      lookup.mockResolvedValueOnce({ id: "user-1" } as BetterAuthUser);
      await expect(
        native.findOne({ model: "user", where: [{ field: "id", value: "user-1" }] }),
      ).rejects.toThrow(/requires name/u);
      await expect(
        native.findOne({ model: "user", where: [{ field: "email", value: "ada@example.test" }] }),
      ).rejects.toThrow(/email lookup/u);
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("rechecks the full native predicate after a competing conditional write", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-cas-race"),
      models: ["session"],
    });
    try {
      const native = (
        await betterAuth({
          database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
          secret: "h".repeat(32),
          baseURL: "http://localhost:3000",
          advanced: { database: { validateSchema: false } },
        }).$context
      ).adapter;
      const now = new Date();
      await native.create({
        model: "session",
        data: {
          token: "cas-token",
          userId: "user-1",
          expiresAt: new Date(now.getTime() + 60_000),
          createdAt: now,
          updatedAt: now,
        },
      });
      const storage = acquired.mock.results[0]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      const original = storage.compareAndSet.bind(storage);
      let injected = false;
      vi.spyOn(storage, "compareAndSet").mockImplementation(async (id, expected, next) => {
        if (!injected && expected !== undefined && next !== undefined) {
          injected = true;
          const changed = clone(BetterAuthSessionRecordSchema, expected);
          changed.userId = "user-2";
          expect(await original(id, expected, changed)).toBe(true);
          return false;
        }
        return original(id, expected, next);
      });
      expect(
        await native.updateMany({
          model: "session",
          where: [{ field: "userId", value: "user-1" }],
          update: { ipAddress: "203.0.113.1" },
        }),
      ).toBe(0);
      const record = await storage.read("cas-token");
      expect(record?.userId).toBe("user-2");
      expect(record?.ipAddress).toBeUndefined();
      await native.create({
        model: "session",
        data: {
          token: "vanishing-token",
          userId: "user-3",
          expiresAt: new Date(now.getTime() + 60_000),
          createdAt: now,
          updatedAt: now,
        },
      });
      const read = storage.read.bind(storage);
      let vanished = false;
      vi.spyOn(storage, "read").mockImplementation(async (id) => {
        if (id === "vanishing-token" && !vanished) {
          vanished = true;
          const current = await read(id);
          expect(current).toBeDefined();
          expect(await original(id, current, undefined)).toBe(true);
          return undefined;
        }
        return read(id);
      });
      expect(
        await native.updateMany({
          model: "session",
          where: [{ field: "userId", value: "user-3" }],
          update: { ipAddress: "203.0.113.2" },
        }),
      ).toBe(0);
      expect(await read("vanishing-token")).toBeUndefined();
    } finally {
      await store.close();
      await factory.close();
    }
  });

  it("uses the primary key for native ID membership without scanning a family", async () => {
    const factory = new InMemoryStorageFactory();
    const acquired = vi.spyOn(factory, "createRecordStorage");
    const store = await PersistentBetterAuthStore.create({
      storageFactory: factory,
      group: new StorageGroup("better-auth-id-membership"),
      models: ["session"],
    });
    try {
      const native = (
        await betterAuth({
          database: nativeFactoryFor(store) as AdapterFactory<Parameters<typeof betterAuth>[0]>,
          secret: "i".repeat(32),
          baseURL: "http://localhost:3000",
          advanced: { database: { validateSchema: false } },
        }).$context
      ).adapter;
      const now = new Date();
      for (const token of ["member-a", "member-b", "other"])
        await native.create({
          model: "session",
          data: {
            token,
            userId: "user-1",
            expiresAt: new Date(now.getTime() + 60_000),
            createdAt: now,
            updatedAt: now,
          },
        });
      const storage = acquired.mock.results[0]?.value as RecordStorage<
        string,
        BetterAuthSessionRecord
      >;
      const selected = vi.spyOn(storage, "queryEntries");
      const rows = await native.findMany<{ id: string }>({
        model: "session",
        where: [{ field: "id", operator: "in", value: ["member-a", "member-b"] }],
        limit: 10,
      });
      expect(rows.map((row) => row.id)).toEqual(["member-a", "member-b"]);
      expect(selected.mock.calls.every(([request]) => request?.ids !== undefined)).toBe(true);
    } finally {
      await store.close();
      await factory.close();
    }
  });
});
