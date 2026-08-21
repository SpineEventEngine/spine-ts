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

import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import { GatewayAuthenticatedSubscriptionSchema } from "@spine-event-engine/proto/auth";
import { SubscriptionSchema, TopicSchema } from "@spine-event-engine/proto/client";
import { ActorContextSchema, TenantIdSchema } from "@spine-event-engine/proto";
import {
  InMemoryStorageFactory,
  type RecordSpec as StorageRecordSpec,
  type StorageFactory,
  type StorageContext,
} from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";

import {
  DurableSubscriptionBindings,
  isDurableSubscriptionBindings,
} from "../../src/browser/index.js";
import { attachDurableSubscriptionCleanup } from "../../src/server/durable-subscription-bindings.js";

type RecordSpec<I, R> = StorageRecordSpec<I, R extends Message ? R : Message>;

const context = create(ActorContextSchema, {
  actor: { value: "actor" },
  tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant" } }),
});

function topic(): Uint8Array {
  return toBinary(TopicSchema, create(TopicSchema, { id: { value: "topic" }, context }));
}

function subscriptionId(wire: Uint8Array): string {
  const id = fromBinary(SubscriptionSchema, wire).id?.value;
  if (id === undefined) throw new Error("expected subscription id");
  return id;
}

function rawRecord(input: {
  readonly id?: string;
  readonly whenExpires: number;
  readonly topic?: ReturnType<typeof create<typeof TopicSchema>>;
}) {
  return create(GatewayAuthenticatedSubscriptionSchema, {
    ...(input.id === undefined ? {} : { id: { value: input.id } }),
    subscription: create(SubscriptionSchema, {
      ...(input.id === undefined ? {} : { id: { value: input.id } }),
      topic: input.topic ?? create(TopicSchema, { context }),
    }),
    whenExpires: { seconds: BigInt(Math.floor(input.whenExpires / 1_000)) },
  });
}

describe("DurableSubscriptionBindings", () => {
  it("stores the approved authenticated subscription record directly", () => {
    const factory = new InMemoryStorageFactory();
    const open = factory.createRecordStorage.bind(factory);
    let spec: RecordSpec<unknown, never> | undefined;
    factory.createRecordStorage = ((
      context: StorageContext,
      candidate: RecordSpec<unknown, never>,
    ) => {
      spec = candidate;
      return open(context, candidate as never);
    }) as never;

    new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "approved-record",
      nextId: () => "s-approved",
      cleanup: () => Promise.resolve(),
    });

    expect(spec?.recordType).toBe(GatewayAuthenticatedSubscriptionSchema);
    expect(spec?.sourceType).toBe(GatewayAuthenticatedSubscriptionSchema);
    expect(spec?.columns.map((column) => column.name)).toEqual(["when_expires"]);
  });

  it("requires an open store, a trusted topic, and a unique direct ID", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "creation-invariants",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    expect(isDurableSubscriptionBindings(bindings)).toBe(true);
    expect(isDurableSubscriptionBindings(undefined)).toBe(false);
    await expect(
      bindings.create({
        topic: { kind: "subscription-topic", bytes: toBinary(TopicSchema, create(TopicSchema)) },
        whenExpires: 1_000,
      }),
    ).rejects.toThrow("trusted context");
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    await expect(
      bindings.create({
        topic: { kind: "subscription-topic", bytes: topic() },
        whenExpires: 1_000,
      }),
    ).resolves.toMatchObject({ kind: "public-subscription" });
    await expect(
      bindings.create({
        topic: { kind: "subscription-topic", bytes: topic() },
        whenExpires: 2_000,
      }),
    ).rejects.toThrow("unique");
    await bindings.close();
    await expect(
      bindings.create({
        topic: { kind: "subscription-topic", bytes: topic() },
        whenExpires: 1_000,
      }),
    ).rejects.toThrow("closed");
  });

  it("refuses actor-less topics and unsafe expiry before direct persistence", async () => {
    for (const input of [
      {
        topic: {
          kind: "subscription-topic" as const,
          bytes: toBinary(
            TopicSchema,
            create(TopicSchema, { context: create(ActorContextSchema) }),
          ),
        },
        whenExpires: 1_000,
      },
      {
        topic: { kind: "subscription-topic" as const, bytes: topic() },
        whenExpires: 9_007_199_254_740_992,
      },
    ]) {
      const bindings = new DurableSubscriptionBindings({
        storageFactory: new InMemoryStorageFactory(),
        namespace: `invalid-create-${String(input.whenExpires)}`,
        nextId: () => "s-one",
        cleanup: () => Promise.resolve(),
      });
      await expect(bindings.create(input)).rejects.toThrow("record is invalid");
    }
  });

  it("rejects a direct read whose storage slot differs from the retained ID", async () => {
    const backing = new InMemoryStorageFactory();
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        Object.assign(storage, {
          read: () => Promise.resolve(rawRecord({ id: "retained", whenExpires: 2_000 })),
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "mismatched-read-slot",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });

    await expect(
      bindings.activate({
        id: "requested",
        context,
        nowMs: 1,
        signal: new AbortController().signal,
        onDefinition: () => Promise.resolve(),
      }),
    ).rejects.toThrow("record is invalid");
  });

  it("refuses a mismatched expiry query slot before backend cleanup", async () => {
    const backing = new InMemoryStorageFactory();
    let cleanups = 0;
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        Object.assign(storage, {
          queryEntries: () =>
            Promise.resolve([
              { id: { value: "slot" }, record: rawRecord({ id: "retained", whenExpires: 1 }) },
            ]),
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "mismatched-purge-slot",
      nextId: () => "s-one",
      cleanup: () => {
        cleanups++;
        return Promise.resolve();
      },
    });

    await expect(bindings.purgeExpired(1)).rejects.toThrow("record is invalid");
    expect(cleanups).toBe(0);
  });

  it("refuses a mismatched recovery query slot before rehydration", async () => {
    const backing = new InMemoryStorageFactory();
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        Object.assign(storage, {
          queryEntries: () =>
            Promise.resolve([
              {
                id: { value: "slot" },
                record: rawRecord({ id: "retained", whenExpires: 2_000 }),
              },
            ]),
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "mismatched-recovery-slot",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    let restored = 0;

    await expect(
      bindings.recoverActive({
        nowMs: 1,
        onDefinition: () => {
          restored++;
          return Promise.resolve();
        },
      }),
    ).rejects.toThrow("record is invalid");
    expect(restored).toBe(0);
  });

  it("rejects a blank namespace, blank direct ID, and already-aborted activation", async () => {
    expect(
      () =>
        new DurableSubscriptionBindings({
          storageFactory: new InMemoryStorageFactory(),
          namespace: " ",
          nextId: () => "s-one",
          cleanup: () => Promise.resolve(),
        }),
    ).toThrow("non-blank");
    for (const limits of [
      { pendingOperationLimit: 0 },
      { operationTimeoutMs: -1 },
      { shutdownTimeoutMs: 1.5 },
      { maxRequestBytes: Number.NaN },
    ])
      expect(
        () =>
          new DurableSubscriptionBindings({
            storageFactory: new InMemoryStorageFactory(),
            namespace: "invalid-limits",
            nextId: () => "s-one",
            cleanup: () => Promise.resolve(),
            limits,
          }),
      ).toThrow("positive safe integers");
    const blank = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "blank-id",
      nextId: () => " ",
      cleanup: () => Promise.resolve(),
    });
    await expect(
      blank.create({ topic: { kind: "subscription-topic", bytes: topic() }, whenExpires: 1_000 }),
    ).rejects.toThrow("non-blank");

    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "aborted-activation",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    const wire = await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    const signal = new AbortController();
    signal.abort();
    await expect(
      bindings.activate({
        id: subscriptionId(wire.bytes),
        context,
        nowMs: 1,
        signal: signal.signal,
        onDefinition: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
  });

  it("refuses a storage seam that cannot provide atomic compare-and-set", () => {
    const backing = new InMemoryStorageFactory();
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        Object.assign(storage, { atomicCompareAndSet: false });
        return storage;
      }) as never,
    };
    expect(
      () =>
        new DurableSubscriptionBindings({
          storageFactory: factory,
          namespace: "non-atomic",
          nextId: () => "s-one",
          cleanup: () => Promise.resolve(),
        }),
    ).toThrow("atomic compare-and-set");
  });

  it("accepts a create whose exact CAS was applied before its response was lost", async () => {
    const backing = new InMemoryStorageFactory();
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        const compareAndSet = storage.compareAndSet.bind(storage);
        let first = true;
        Object.assign(storage, {
          compareAndSet: async (...input: Parameters<typeof compareAndSet>) => {
            const applied = await compareAndSet(...input);
            if (first) {
              first = false;
              return false;
            }
            return applied;
          },
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "lost-create-response",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });

    await expect(
      bindings.create({
        topic: { kind: "subscription-topic", bytes: topic() },
        whenExpires: 1_000,
      }),
    ).resolves.toMatchObject({ kind: "public-subscription" });
  });

  it("reconciles an applied create whose CAS response throws, but propagates an absent write", async () => {
    for (const mode of ["applied", "absent"] as const) {
      const backing = new InMemoryStorageFactory();
      // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
      const factory: StorageFactory = {
        createRecordStorage: ((
          storageContext: StorageContext,
          spec: RecordSpec<unknown, unknown>,
        ) => {
          const storage = backing.createRecordStorage(storageContext, spec);
          const compareAndSet = storage.compareAndSet.bind(storage);
          Object.assign(storage, {
            compareAndSet: async (...input: Parameters<typeof compareAndSet>) => {
              if (mode === "applied") await compareAndSet(...input);
              throw new Error(`${mode} CAS response lost`);
            },
          });
          return storage;
        }) as never,
      };
      const bindings = new DurableSubscriptionBindings({
        storageFactory: factory,
        namespace: `cas-${mode}`,
        nextId: () => "s-one",
        cleanup: () => Promise.resolve(),
      });
      const creating = bindings.create({
        topic: { kind: "subscription-topic", bytes: topic() },
        whenExpires: 1_000,
      });
      if (mode === "applied")
        await expect(creating).resolves.toMatchObject({ kind: "public-subscription" });
      else await expect(creating).rejects.toThrow("absent CAS response lost");
    }
  });

  it("does not accept a divergent reread after a create CAS error", async () => {
    const backing = new InMemoryStorageFactory();
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        const compareAndSet = storage.compareAndSet.bind(storage);
        Object.assign(storage, {
          compareAndSet: async (...input: Parameters<typeof compareAndSet>) => {
            await compareAndSet(...input);
            throw new Error("CAS response lost");
          },
          read: () =>
            Promise.resolve(
              create(GatewayAuthenticatedSubscriptionSchema, {
                id: { value: "s-one" },
                whenExpires: { seconds: 2n },
              }),
            ),
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "divergent-cas",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    await expect(
      bindings.create({
        topic: { kind: "subscription-topic", bytes: topic() },
        whenExpires: 1_000,
      }),
    ).rejects.toThrow("CAS response lost");
  });

  it("round-trips the full approved record across a reopened Gateway", async () => {
    const factory = new InMemoryStorageFactory();
    const first = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "gateway",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    const created = await first.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    await first.close();
    const reopened = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "gateway",
      nextId: () => "s-two",
      cleanup: () => Promise.resolve(),
    });
    const restored: Uint8Array[] = [];
    await reopened.recoverActive({
      nowMs: 1,
      onDefinition: (wire) => {
        restored.push(wire.bytes);
        return Promise.resolve();
      },
    });
    expect(restored).toEqual([created.bytes]);
  });

  it("fails recovery without deletion when a stored record is malformed", async () => {
    const backing = new InMemoryStorageFactory();
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        Object.assign(storage, {
          queryEntries: () =>
            Promise.resolve([
              {
                id: { value: "malformed" },
                record: create(GatewayAuthenticatedSubscriptionSchema, {
                  id: { value: "malformed" },
                  whenExpires: { seconds: 1n },
                }),
              },
            ]),
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "malformed-recovery",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    await expect(
      bindings.recoverActive({ nowMs: 0, onDefinition: () => Promise.resolve() }),
    ).rejects.toThrow("record is invalid");
  });

  it("fails closed for missing and unsafe persisted expiry during recovery", async () => {
    for (const whenExpires of [undefined, { seconds: 9_007_199_254_740_992n }] as const) {
      const backing = new InMemoryStorageFactory();
      let cleanups = 0;
      // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
      const factory: StorageFactory = {
        createRecordStorage: ((
          storageContext: StorageContext,
          spec: RecordSpec<unknown, unknown>,
        ) => {
          const storage = backing.createRecordStorage(storageContext, spec);
          Object.assign(storage, {
            queryEntries: () =>
              Promise.resolve([
                {
                  id: { value: "raw" },
                  record: create(GatewayAuthenticatedSubscriptionSchema, {
                    id: { value: "raw" },
                    subscription: create(SubscriptionSchema, {
                      id: { value: "raw" },
                      topic: create(TopicSchema, { context }),
                    }),
                    whenExpires,
                  }),
                },
              ]),
          });
          return storage;
        }) as never,
      };
      const bindings = new DurableSubscriptionBindings({
        storageFactory: factory,
        namespace: `raw-${String(cleanups)}`,
        nextId: () => "s",
        cleanup: () => {
          cleanups++;
          return Promise.resolve();
        },
      });
      await expect(
        bindings.recoverActive({ nowMs: 1, onDefinition: () => Promise.resolve() }),
      ).rejects.toThrow("record is invalid");
      expect(cleanups).toBe(0);
    }
  });

  it("keeps an expired record when backend cleanup fails", async () => {
    const factory = new InMemoryStorageFactory();
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "expiry",
      nextId: () => "s-one",
      cleanup: () => Promise.reject(new Error("backend unavailable")),
    });
    const created = await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1,
    });
    await bindings.purgeExpired(1);
    const restored: Uint8Array[] = [];
    await bindings.recoverActive({
      nowMs: 0,
      onDefinition: (wire) => {
        restored.push(wire.bytes);
        return Promise.resolve();
      },
    });
    expect(restored).toEqual([created.bytes]);
  });

  it("removes an expired recovered record only after its cleanup completes", async () => {
    let cleaned = 0;
    const factory = new InMemoryStorageFactory();
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "recovery-expiry",
      nextId: () => "s-one",
      cleanup: () => {
        cleaned++;
        return Promise.resolve();
      },
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1,
    });

    await bindings.recoverActive({ nowMs: 1, onDefinition: () => Promise.resolve() });
    await expect(
      bindings.recoverActive({ nowMs: 0, onDefinition: () => Promise.resolve() }),
    ).resolves.toBeUndefined();
    expect(cleaned).toBe(1);
  });

  it("requires the retained and request Tenant identity to agree", async () => {
    const noTenant = create(ActorContextSchema, { actor: { value: "actor" } });
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "tenant-ownership",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    const retainedWithoutTenant = await bindings.create({
      topic: {
        kind: "subscription-topic",
        bytes: toBinary(TopicSchema, create(TopicSchema, { context: noTenant })),
      },
      whenExpires: 1_000,
    });
    await expect(
      bindings.activate({
        id: subscriptionId(retainedWithoutTenant.bytes),
        context: noTenant,
        nowMs: 1,
        signal: new AbortController().signal,
        onDefinition: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "activated" });
    await expect(
      bindings.cancel({
        id: subscriptionId(retainedWithoutTenant.bytes),
        context,
        nowMs: 1,
        onDefinition: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
  });

  it("deletes an expired record only after its cleanup succeeds", async () => {
    let cleanups = 0;
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "successful-expiry",
      nextId: () => "s-one",
      cleanup: () => {
        cleanups++;
        return Promise.resolve();
      },
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1,
    });

    await bindings.purgeExpired(1);
    await expect(
      bindings.recoverActive({ nowMs: 0, onDefinition: () => Promise.resolve() }),
    ).resolves.toBeUndefined();
    expect(cleanups).toBe(1);
  });

  it("denies expired and foreign transitions while missing cancellation is idempotent", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "transition-denial",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    const created = await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 10,
    });
    const id = subscriptionId(created.bytes);
    const foreign = create(ActorContextSchema, {
      actor: { value: "different-actor" },
      tenantId: create(TenantIdSchema, { kind: { case: "value", value: "tenant" } }),
    });

    await expect(
      bindings.activate({
        id,
        context: foreign,
        nowMs: 1,
        signal: new AbortController().signal,
        onDefinition: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      bindings.cancel({ id, context: foreign, nowMs: 1, onDefinition: () => Promise.resolve() }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      bindings.activate({
        id,
        context,
        nowMs: 10,
        signal: new AbortController().signal,
        onDefinition: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      bindings.cancel({ id: "missing", context, nowMs: 1, onDefinition: () => Promise.resolve() }),
    ).resolves.toEqual({ kind: "closed" });
  });

  it("activates a valid retained definition with its canonical public wire", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "valid-activation",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    const created = await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    await expect(
      bindings.activate({
        id: subscriptionId(created.bytes),
        context,
        nowMs: 1,
        signal: new AbortController().signal,
        onDefinition: (wire) => {
          expect(wire).toEqual(created);
          return Promise.resolve();
        },
      }),
    ).resolves.toEqual({ kind: "activated" });
  });

  it("cancels the stored definition before its exact CAS deletion", async () => {
    const calls: Uint8Array[] = [];
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "cancel",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    const created = await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    const id = subscriptionId(created.bytes);

    await expect(
      bindings.cancel({
        id,
        context,
        nowMs: 1,
        onDefinition: (wire) => {
          calls.push(wire.bytes);
          return Promise.resolve();
        },
      }),
    ).resolves.toEqual({ kind: "closed" });
    await expect(
      bindings.cancel({ id, context, nowMs: 1, onDefinition: () => Promise.resolve() }),
    ).resolves.toEqual({ kind: "closed" });
    expect(calls).toEqual([created.bytes]);
  });

  it("returns denied after a false cancel CAS and closes on its retry", async () => {
    const backing = new InMemoryStorageFactory();
    let rejectDelete = true;
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        const compareAndSet = storage.compareAndSet.bind(storage);
        Object.assign(storage, {
          compareAndSet: async (...input: Parameters<typeof compareAndSet>) => {
            if (input[2] === undefined && rejectDelete) {
              rejectDelete = false;
              return false;
            }
            return compareAndSet(...input);
          },
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "cancel-retry",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    const wire = await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    const input = {
      id: subscriptionId(wire.bytes),
      context,
      nowMs: 1,
      onDefinition: () => Promise.resolve(),
    };
    await expect(bindings.cancel(input)).resolves.toEqual({ kind: "denied" });
    await expect(bindings.cancel(input)).resolves.toEqual({ kind: "closed" });
  });

  it("preserves a row when cancellation cleanup fails", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "retry",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    const created = await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    const id = subscriptionId(created.bytes);

    await expect(
      bindings.cancel({
        id,
        context,
        nowMs: 1,
        onDefinition: () => Promise.reject(new Error("cleanup failed")),
      }),
    ).rejects.toThrow("cleanup failed");
    const restored: Uint8Array[] = [];
    await bindings.recoverActive({
      nowMs: 1,
      onDefinition: (wire) => {
        restored.push(wire.bytes);
        return Promise.resolve();
      },
    });
    expect(restored).toEqual([created.bytes]);
  });

  it("aborts an active callback before serializing cancellation", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "active-cancel",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    const created = await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    const id = subscriptionId(created.bytes);
    let aborted = false;
    let started: () => void = () => undefined;
    const activated = new Promise<void>((resolve) => {
      started = resolve;
    });
    const active = bindings.activate({
      id,
      context,
      nowMs: 1,
      signal: new AbortController().signal,
      onDefinition: async (_wire, signal) => {
        started();
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        });
      },
    });

    await activated;
    await expect(
      bindings.cancel({ id, context, nowMs: 1, onDefinition: () => Promise.resolve() }),
    ).resolves.toEqual({ kind: "closed" });
    await expect(active).resolves.toEqual({ kind: "activated" });
    expect(aborted).toBe(true);
  });

  it("admits one queued cancellation but rejects a third same-ID operation", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "bounded-same-id-work",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    let release: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });
    const active = bindings.activate({
      id: "s-one",
      context,
      nowMs: 1,
      signal: new AbortController().signal,
      onDefinition: () => started,
    });
    await Promise.resolve();
    const cancelling = bindings.cancel({
      id: "s-one",
      context,
      nowMs: 1,
      onDefinition: () => Promise.resolve(),
    });
    await expect(
      bindings.activate({
        id: "s-one",
        context,
        nowMs: 1,
        signal: new AbortController().signal,
        onDefinition: () => Promise.resolve(),
      }),
    ).rejects.toThrow("binding-busy");
    release();
    await active;
    await expect(cancelling).resolves.toEqual({ kind: "closed" });
  });

  it("admits new queued work after the previous queued operation starts", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "reopened-same-id-queue",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let secondStarted: () => void = () => undefined;
    const secondStart = new Promise<void>((resolve) => {
      secondStarted = resolve;
    });
    let releaseSecond: () => void = () => undefined;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const first = bindings.activate({
      id: "s-one",
      context,
      nowMs: 1,
      signal: new AbortController().signal,
      onDefinition: () => firstGate,
    });
    await Promise.resolve();
    const second = bindings.activate({
      id: "s-one",
      context,
      nowMs: 1,
      signal: new AbortController().signal,
      onDefinition: async () => {
        secondStarted();
        await secondGate;
      },
    });
    releaseFirst();
    await secondStart;
    const third = bindings.activate({
      id: "s-one",
      context,
      nowMs: 1,
      signal: new AbortController().signal,
      onDefinition: () => Promise.resolve(),
    });
    await expect(
      bindings.activate({
        id: "s-one",
        context,
        nowMs: 1,
        signal: new AbortController().signal,
        onDefinition: () => Promise.resolve(),
      }),
    ).rejects.toThrow("binding-busy");
    releaseSecond();
    await expect(Promise.all([first, second, third])).resolves.toHaveLength(3);
    await bindings.close();
  });

  it("forwards caller activation abort to the active backend callback", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "caller-abort",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    const caller = new AbortController();
    let resolveStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const active = bindings.activate({
      id: "s-one",
      context,
      nowMs: 1,
      signal: caller.signal,
      onDefinition: async (_wire, signal) => {
        resolveStarted();
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              resolve();
            },
            { once: true },
          );
        });
      },
    });
    await started;
    caller.abort();
    await expect(active).resolves.toEqual({ kind: "activated" });
  });

  it("observes caller cancellation triggered synchronously by active work", async () => {
    vi.useFakeTimers();
    try {
      const bindings = new DurableSubscriptionBindings({
        storageFactory: new InMemoryStorageFactory(),
        namespace: "synchronous-caller-abort",
        nextId: () => "s-one",
        cleanup: () => Promise.resolve(),
      });
      await bindings.create({
        topic: { kind: "subscription-topic", bytes: topic() },
        whenExpires: 1_000,
      });
      const caller = new AbortController();
      const active = bindings.activate({
        id: "s-one",
        context,
        nowMs: 1,
        signal: caller.signal,
        onDefinition: () => {
          caller.abort();
          return new Promise<void>(() => undefined);
        },
      });
      const settled = Promise.race([
        active.then(() => "activated"),
        new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve("timed out");
          }, 1);
        }),
      ]);

      await vi.advanceTimersByTimeAsync(1);
      await expect(settled).resolves.toBe("activated");
    } finally {
      vi.useRealTimers();
    }
  });

  it("releases local activation state after its callback throws so cancellation can retry", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "activation-failure",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    const wire = await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });
    const id = subscriptionId(wire.bytes);
    await expect(
      bindings.activate({
        id,
        context,
        nowMs: 1,
        signal: new AbortController().signal,
        onDefinition: () => Promise.reject(new Error("activation failed")),
      }),
    ).rejects.toThrow("activation failed");
    await expect(
      bindings.cancel({ id, context, nowMs: 1, onDefinition: () => Promise.resolve() }),
    ).resolves.toEqual({ kind: "closed" });
    await expect(
      bindings.activate({
        id: "",
        context,
        nowMs: 1,
        signal: new AbortController().signal,
        onDefinition: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
  });

  it("continues expiry cleanup after one callback failure and rejects use after repeated close", async () => {
    let id = 0;
    const cleaned: string[] = [];
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "mixed-expiry",
      nextId: () => String(++id),
      cleanup: (wire) => {
        const value = subscriptionId(wire.bytes);
        cleaned.push(value);
        return value === "1"
          ? Promise.reject(new Error("first cleanup failed"))
          : Promise.resolve();
      },
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1,
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 2,
    });
    await bindings.purgeExpired(2);
    const restored: string[] = [];
    await bindings.recoverActive({
      nowMs: 0,
      onDefinition: (wire) => {
        restored.push(subscriptionId(wire.bytes));
        return Promise.resolve();
      },
    });
    expect(cleaned).toEqual(["1", "2"]);
    expect(restored).toEqual(["1"]);
    await bindings.close();
    await expect(bindings.close()).resolves.toBeUndefined();
    await expect(bindings.purgeExpired(3)).rejects.toThrow("closed");
  });

  it("uses an attached backend cleanup before removing an expired durable row", async () => {
    const cleaned: string[] = [];
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "attached-expiry",
      nextId: () => "attached",
      cleanup: (wire) => {
        cleaned.push(`caller:${subscriptionId(wire.bytes)}`);
        return Promise.resolve();
      },
    });
    attachDurableSubscriptionCleanup(bindings, (wire) => {
      cleaned.push(`backend:${subscriptionId(wire.bytes)}`);
      return Promise.resolve();
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1,
    });

    await bindings.purgeExpired(1);
    const restored: string[] = [];
    await bindings.recoverActive({
      nowMs: 0,
      onDefinition: (wire) => {
        restored.push(subscriptionId(wire.bytes));
        return Promise.resolve();
      },
    });

    expect(cleaned).toEqual(["backend:attached", "caller:attached"]);
    expect(restored).toEqual([]);
  });

  it("coalesces overlapping expiry purges instead of exhausting the per-binding queue", async () => {
    let cleanupStarted: (() => void) | undefined;
    const started = new Promise<undefined>((resolve) => {
      cleanupStarted = () => {
        resolve(undefined);
      };
    });
    let releaseCleanup: (() => void) | undefined;
    const heldCleanup = new Promise<undefined>((resolve) => {
      releaseCleanup = () => {
        resolve(undefined);
      };
    });
    let cleanups = 0;
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "overlapping-expiry-purges",
      nextId: () => "expired",
      cleanup: async () => {
        cleanups++;
        cleanupStarted?.();
        await heldCleanup;
      },
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1,
    });

    const first = bindings.purgeExpired(1);
    await started;
    const second = bindings.purgeExpired(1);
    const third = bindings.purgeExpired(1);
    releaseCleanup?.();

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(cleanups).toBe(1);
  });

  it("does not extend a bounded purge for duplicate active horizons", async () => {
    let releaseCleanup: (() => void) | undefined;
    const heldCleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    const cleaned: string[] = [];
    let next = 0;
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "duplicate-expiry-purge-horizon",
      nextId: () => `expired-${String(++next)}`,
      cleanup: async (wire) => {
        cleaned.push(subscriptionId(wire.bytes));
        if (cleaned.length === 1) await heldCleanup;
      },
    });
    for (let index = 0; index < 26; index += 1) {
      await bindings.create({
        topic: { kind: "subscription-topic", bytes: topic() },
        whenExpires: 1,
      });
    }

    const initial = bindings.purgeExpired(1);
    await vi.waitFor(() => {
      expect(cleaned).toHaveLength(1);
    });
    const duplicate = bindings.purgeExpired(1);
    releaseCleanup?.();

    await expect(Promise.all([initial, duplicate])).resolves.toEqual([undefined, undefined]);
    expect(cleaned).toHaveLength(25);
  });

  it("runs one later bounded purge horizon after an overlapping cleanup", async () => {
    let releaseCleanup: (() => void) | undefined;
    const heldCleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let first = true;
    const cleaned: string[] = [];
    let next = 0;
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "later-expiry-purge-horizon",
      nextId: () => `expired-${String(++next)}`,
      cleanup: async (wire) => {
        cleaned.push(subscriptionId(wire.bytes));
        if (first) {
          first = false;
          await heldCleanup;
        }
      },
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1,
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 2,
    });

    const initial = bindings.purgeExpired(1);
    await vi.waitFor(() => {
      expect(cleaned).toEqual(["expired-1"]);
    });
    const later = bindings.purgeExpired(2);
    releaseCleanup?.();

    await expect(Promise.all([initial, later])).resolves.toEqual([undefined, undefined]);
    expect(cleaned).toEqual(["expired-1", "expired-2"]);
  });

  it("retains a coalesced later purge horizon after the active purge fails", async () => {
    const backing = new InMemoryStorageFactory();
    let releaseFailure: (() => void) | undefined;
    const firstQuery = new Promise<void>((resolve) => {
      releaseFailure = resolve;
    });
    let failFirstQuery = true;
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        const queryEntries = storage.queryEntries.bind(storage);
        Object.assign(storage, {
          queryEntries: async (...input: Parameters<typeof storage.queryEntries>) => {
            if (failFirstQuery) {
              failFirstQuery = false;
              await firstQuery;
              throw new Error("temporary expiry scan failure");
            }
            return queryEntries(...input);
          },
        });
        return storage;
      }) as never,
    };
    const cleaned: string[] = [];
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "retry-later-expiry-purge-horizon",
      nextId: (() => {
        let next = 0;
        return () => `expired-${String(++next)}`;
      })(),
      cleanup: (wire) => {
        cleaned.push(subscriptionId(wire.bytes));
        return Promise.resolve();
      },
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1,
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 2,
    });

    const initial = bindings.purgeExpired(1);
    await vi.waitFor(() => {
      expect(releaseFailure).toBeTypeOf("function");
    });
    const later = bindings.purgeExpired(2);
    releaseFailure?.();

    await expect(Promise.all([initial, later])).rejects.toThrow("temporary expiry scan failure");
    await expect(bindings.purgeExpired(1)).resolves.toBeUndefined();

    expect(cleaned).toEqual(["expired-1", "expired-2"]);
  });

  it("joins a coalesced purge before closing storage", async () => {
    let releaseCleanup: (() => void) | undefined;
    const heldCleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve;
    });
    let closes = 0;
    const backing = new InMemoryStorageFactory();
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        const close = storage.close.bind(storage);
        Object.assign(storage, {
          close: () => {
            closes++;
            close();
          },
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "close-joins-coalesced-purge",
      nextId: () => "expired",
      cleanup: () => heldCleanup,
      limits: { shutdownTimeoutMs: 100 },
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1,
    });

    const first = bindings.purgeExpired(1);
    await vi.waitFor(() => {
      expect(releaseCleanup).toBeTypeOf("function");
    });
    const second = bindings.purgeExpired(1);
    const closing = bindings.close();
    await Promise.resolve();
    expect(closes).toBe(0);
    releaseCleanup?.();

    await expect(Promise.all([first, second, closing])).resolves.toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(closes).toBe(1);
  });

  it("stops a raw expiry scan at its first unexpired row", async () => {
    const backing = new InMemoryStorageFactory();
    let cleanups = 0;
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        Object.assign(storage, {
          queryEntries: () =>
            Promise.resolve([
              { id: { value: "fresh" }, record: rawRecord({ id: "fresh", whenExpires: 2_000 }) },
              { id: { value: "expired" }, record: rawRecord({ id: "expired", whenExpires: 1 }) },
            ]),
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "raw-purge-stops",
      nextId: () => "s-one",
      cleanup: () => {
        cleanups++;
        return Promise.resolve();
      },
    });

    await bindings.purgeExpired(1_000);

    expect(cleanups).toBe(0);
  });

  it("denies a raw cancel CAS loss when its reread still retains the row", async () => {
    const backing = new InMemoryStorageFactory();
    const stored = rawRecord({ id: "raw-cancel", whenExpires: 2_000 });
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        Object.assign(storage, {
          read: () => Promise.resolve(stored),
          compareAndSet: () => Promise.resolve(false),
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "raw-cancel-retained",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });

    await expect(
      bindings.cancel({
        id: "raw-cancel",
        context,
        nowMs: 1,
        onDefinition: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "denied" });
    await expect(
      bindings.activate({
        id: "raw-cancel",
        context,
        nowMs: 1,
        signal: new AbortController().signal,
        onDefinition: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "activated" });
  });

  it("accepts a cancel whose CAS response is lost after durable deletion", async () => {
    const backing = new InMemoryStorageFactory();
    let deleting = false;
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        const compareAndSet = storage.compareAndSet.bind(storage);
        const read = storage.read.bind(storage);
        Object.assign(storage, {
          compareAndSet: async (...input: Parameters<typeof compareAndSet>) => {
            if (input[2] === undefined) {
              deleting = true;
              await compareAndSet(...input);
              return false;
            }
            return compareAndSet(...input);
          },
          read: (id: Parameters<typeof read>[0]) =>
            deleting ? Promise.resolve(undefined) : read(id),
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "lost-cancel-response",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 1_000,
    });

    await expect(
      bindings.cancel({ id: "s-one", context, nowMs: 1, onDefinition: () => Promise.resolve() }),
    ).resolves.toEqual({ kind: "closed" });
  });

  it("rejects raw records without an ID during cancellation and recovery", async () => {
    const backing = new InMemoryStorageFactory();
    const stored = rawRecord({ whenExpires: 2_000 });
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        Object.assign(storage, {
          read: () => Promise.resolve(stored),
          queryEntries: () => Promise.resolve([{ id: { value: "raw" }, record: stored }]),
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "raw-missing-id",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });

    await expect(
      bindings.cancel({
        id: "raw",
        context,
        nowMs: 1,
        onDefinition: () => Promise.resolve(),
      }),
    ).rejects.toThrow("record is invalid");
    await expect(
      bindings.recoverActive({ nowMs: 1, onDefinition: () => Promise.resolve() }),
    ).rejects.toThrow("record is invalid");
  });

  it("denies activation for a raw topic without trusted context and preserves its row", async () => {
    const backing = new InMemoryStorageFactory();
    const stored = rawRecord({
      id: "raw-untrusted-topic",
      whenExpires: 2_000,
      topic: create(TopicSchema, { id: { value: "topic" } }),
    });
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        Object.assign(storage, { read: () => Promise.resolve(stored) });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "raw-untrusted-topic",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
    });

    await expect(
      bindings.activate({
        id: "raw-untrusted-topic",
        context,
        nowMs: 1,
        signal: new AbortController().signal,
        onDefinition: () => Promise.resolve(),
      }),
    ).rejects.toThrow("record is invalid");
    await expect(
      bindings.cancel({
        id: "raw-untrusted-topic",
        context,
        nowMs: 1,
        onDefinition: () => Promise.resolve(),
      }),
    ).rejects.toThrow("record is invalid");
  });

  it("keeps an active update stream open until its caller aborts", async () => {
    const bindings = new DurableSubscriptionBindings({
      storageFactory: new InMemoryStorageFactory(),
      namespace: "timeout",
      nextId: () => "s-timeout",
      cleanup: () => Promise.resolve(),
      limits: { operationTimeoutMs: 1 },
    });
    await bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 2_000,
    });
    const controller = new AbortController();
    let aborted = false;
    let settled = false;
    const active = bindings.activate({
      id: "s-timeout",
      context,
      nowMs: 1,
      signal: controller.signal,
      onDefinition: async (_wire, signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        });
      },
    });
    void active.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(settled).toBe(false);
    controller.abort();

    await expect(active).resolves.toEqual({ kind: "activated" });
    expect(aborted).toBe(true);
    await expect(
      bindings.activate({
        id: "s-timeout",
        context,
        nowMs: 1,
        signal: new AbortController().signal,
        onDefinition: () => Promise.resolve(),
      }),
    ).resolves.toEqual({ kind: "activated" });
  });

  it("joins cooperative admitted create, expiry cleanup, and recovery before closing storage", async () => {
    for (const operation of ["create", "purge", "recover"] as const) {
      const backing = new InMemoryStorageFactory();
      let release: (() => void) | undefined;
      let resolveStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        resolveStarted = resolve;
      });
      const wait = () =>
        new Promise<void>((resolve) => {
          release = resolve;
          resolveStarted?.();
        });
      let closes = 0;
      // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
      const factory: StorageFactory = {
        createRecordStorage: ((
          storageContext: StorageContext,
          spec: RecordSpec<unknown, unknown>,
        ) => {
          const storage = backing.createRecordStorage(storageContext, spec);
          const close = storage.close.bind(storage);
          if (operation === "create") {
            const compareAndSet = storage.compareAndSet.bind(storage);
            Object.assign(storage, {
              compareAndSet: async (...input: Parameters<typeof compareAndSet>) => {
                await wait();
                return compareAndSet(...input);
              },
            });
          }
          Object.assign(storage, {
            close: () => {
              closes++;
              close();
            },
          });
          return storage;
        }) as never,
      };
      const bindings = new DurableSubscriptionBindings({
        storageFactory: factory,
        namespace: `close-joins-${operation}`,
        nextId: () => "s-one",
        cleanup: () => (operation === "purge" ? wait() : Promise.resolve()),
        limits: { shutdownTimeoutMs: 100 },
      });
      if (operation !== "create")
        await bindings.create({
          topic: { kind: "subscription-topic", bytes: topic() },
          whenExpires: operation === "purge" ? 1 : 2_000,
        });
      const admitted =
        operation === "create"
          ? bindings.create({
              topic: { kind: "subscription-topic", bytes: topic() },
              whenExpires: 2_000,
            })
          : operation === "purge"
            ? bindings.purgeExpired(1)
            : bindings.recoverActive({ nowMs: 1, onDefinition: () => wait() });
      await started;
      const closing = bindings.close();
      await Promise.resolve();
      expect(closes).toBe(0);
      release?.();
      await admitted;
      await closing;
      expect(closes).toBe(1);
    }
  });

  it("bounds noncooperative admitted work during shutdown and closes storage once", async () => {
    const backing = new InMemoryStorageFactory();
    let closes = 0;
    // @ts-expect-error Port-fault fixture intentionally supplies only record storage.
    const factory: StorageFactory = {
      createRecordStorage: ((
        storageContext: StorageContext,
        spec: RecordSpec<unknown, unknown>,
      ) => {
        const storage = backing.createRecordStorage(storageContext, spec);
        const close = storage.close.bind(storage);
        Object.assign(storage, {
          compareAndSet: () => new Promise<boolean>(() => undefined),
          close: () => {
            closes++;
            close();
          },
        });
        return storage;
      }) as never,
    };
    const bindings = new DurableSubscriptionBindings({
      storageFactory: factory,
      namespace: "close-times-out",
      nextId: () => "s-one",
      cleanup: () => Promise.resolve(),
      limits: { shutdownTimeoutMs: 1 },
    });
    void bindings.create({
      topic: { kind: "subscription-topic", bytes: topic() },
      whenExpires: 2_000,
    });
    await expect(bindings.close()).rejects.toThrow("shutdown timed out");
    expect(closes).toBe(1);
    await expect(
      bindings.recoverActive({ nowMs: 1, onDefinition: () => Promise.resolve() }),
    ).rejects.toThrow("closed");
  });
});
