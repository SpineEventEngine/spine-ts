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

import { create, toBinary, type Message } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ActorContextSchema,
  EmailAddressSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  InternetDomainSchema,
  OriginSchema,
  TenantIdSchema,
  type Event,
  type EventId,
  type TenantId,
} from "@spine-event-engine/proto";
import { describe, expect, it, vi } from "vitest";
import {
  TaskIdSchema,
  TaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import {
  TaskCreatedSchema,
  TaskRenamedSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";

import {
  EventStore,
  InMemoryStorageBackend,
  InMemoryStorageFactory,
  RecordStorage,
  StorageGroup,
  type RecordSpec,
  type StorageContext,
} from "../../src/index.js";
import { InMemoryRecordStorage } from "../../src/memory/in-memory-record-storage.js";
import { eventStoreAccess, EventStoreGroups } from "../../src/provider.js";

describe("EventStore", () => {
  it("uses the selected Bounded Context name while retaining the Event Store role", () => {
    expect(EventStoreGroups.forContext("Orders").name).toBe("Orders");
    expect(EventStoreGroups.forContext("Orders_System", "system").name).toBe("Orders_System");
    expect(
      EventStoreGroups.identity(EventStoreGroups.forContext("Orders_System", "system")),
    ).not.toBe(EventStoreGroups.identity(EventStoreGroups.forContext("Orders_System")));
  });

  it("separates contexts sharing a factory while retaining each original Event ID", async () => {
    const factory = new InMemoryStorageFactory(new InMemoryStorageBackend());
    const event = createEvent("same-id", "created", 1n);
    const imported = createEvent("same-id", "renamed", 1n);
    const orders = new EventStore({ name: "Orders", multitenant: false }, factory);
    const billing = new EventStore({ name: "Billing", multitenant: false }, factory);

    await orders.append(event);
    await billing.append(imported);
    expect(await orders.read()).toEqual([event]);
    expect(await billing.read()).toEqual([imported]);
    expect(EventStoreGroups.forContext("Orders").name).not.toBe(
      EventStoreGroups.forContext("Billing").name,
    );
    await Promise.all([orders.close(), billing.close()]);
  });
  it("keeps synchronous assembly cleanup off the public EventStore instance", () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    expect("closeIdle" in store).toBe(false);
  });

  it("reuses one record storage for admission, append, and repeated reads", async () => {
    const factory = new TrackedEventStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const event = createEvent("retained-event", "created", 1n);

    await store.accept(event);
    await store.append(event);
    expect(await store.read()).toEqual([event]);
    expect(await store.read()).toEqual([event]);
    expect(factory.creations).toHaveLength(1);
    expect(factory.closes).toEqual([]);

    await store.close();
    expect(factory.closes).toEqual([0]);
  });

  it("retains separate record storage for an event tenant and the selected read tenant", async () => {
    const factory = new TrackedEventStorageFactory();
    const store = new EventStore(
      { name: "Tasks", multitenant: true, tenantId: tenant("tenant-a") },
      factory,
    );
    const local = createEvent("local-event", "created", 1n, "tenant-a");
    const other = createEvent("other-event", "created", 2n, "tenant-b");

    await store.append(local);
    await store.append(other);
    expect(await store.read()).toEqual([local]);
    expect(
      factory.creations.map((context) => context.multitenant && context.tenantId.kind),
    ).toEqual([tenant("tenant-a").kind, tenant("tenant-b").kind]);
    expect(factory.creations).toHaveLength(2);
    await store.close();
    expect(factory.closes).toEqual([0, 1]);
  });

  it("retries record storage creation after a provider failure", async () => {
    const factory = new TrackedEventStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    factory.failNextCreate = true;

    await expect(store.append(createEvent("first-attempt", "created", 1n))).rejects.toThrow(
      "record creation failed",
    );
    expect(factory.creations).toHaveLength(0);
    await store.append(createEvent("second-attempt", "created", 2n));
    expect(await store.read()).toHaveLength(1);
    expect(factory.creations).toHaveLength(1);
    await store.close();
  });

  it("attempts every retained close and rejects further operations after a close failure", async () => {
    const factory = new TrackedEventStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: true }, factory);
    await store.append(createEvent("event-a", "created", 1n, "tenant-a"));
    await store.append(createEvent("event-b", "created", 1n, "tenant-b"));
    factory.failCloseAt = 0;

    await expect(store.close()).rejects.toThrow("record close failed");
    expect(factory.closes).toEqual([0, 1]);
    expect(store.isOpen()).toBe(false);
    expect(factory.isOpen()).toBe(true);
    await expect(store.close()).rejects.toThrow("record close failed");
    expect(factory.closes).toEqual([0, 1]);
    await expect(
      store.append(createEvent("after-close", "created", 2n, "tenant-a")),
    ).rejects.toThrow("EventStore is closed");
    await expect(
      store.accept(createEvent("after-close", "created", 2n, "tenant-a")),
    ).rejects.toThrow("EventStore is closed");
    await expect(store.appendAll([])).rejects.toThrow("EventStore is closed");
    expect(factory.creations).toHaveLength(2);
  });

  it("reports every retained storage close failure", async () => {
    const factory = new TrackedEventStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: true }, factory);
    await store.append(createEvent("event-a", "created", 1n, "tenant-a"));
    await store.append(createEvent("event-b", "created", 1n, "tenant-b"));
    factory.failAllCloses = true;

    await expect(store.close()).rejects.toThrow(AggregateError);
    expect(factory.closes).toEqual([0, 1]);
  });

  it("drains an admitted Event batch before closing its retained storage", async () => {
    const factory = new GatedEventStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const records = [createEvent("first", "created", 1n), createEvent("second", "renamed", 2n)];
    const writing = store.appendAll(records);
    await factory.entered;

    const closing = store.close();
    const closesBeforeRelease = [...factory.closes];
    const denied = store.append(createEvent("later", "created", 3n));
    factory.release();
    const [writeResult, closeResult, deniedResult] = await Promise.allSettled([
      writing,
      closing,
      denied,
    ]);

    expect(closesBeforeRelease).toEqual([]);
    expect(writeResult.status).toBe("fulfilled");
    expect(closeResult.status).toBe("fulfilled");
    expect(deniedResult).toMatchObject({
      status: "rejected",
      reason: new Error("EventStore is closed."),
    });
    expect(factory.creations).toHaveLength(1);
    expect(factory.closes).toEqual([0]);
    const reader = new EventStore({ name: "Tasks", multitenant: false }, factory);
    expect(await reader.read()).toEqual(records);
    await reader.close();
  });

  it("waits for an admitted query before closing its retained storage", async () => {
    const factory = new GatedReadStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const event = createEvent("queried-event", "created", 1n);
    await store.append(event);
    const reading = store.read();
    await factory.entered;

    const closing = store.close();
    expect(factory.closes).toEqual([]);
    factory.release();
    await expect(reading).resolves.toEqual([event]);
    await expect(closing).resolves.toBeUndefined();
    expect(() => {
      eventStoreAccess.closeIdle(store);
    }).not.toThrow();
    expect(factory.closes).toEqual([0]);
  });

  it("reports cleanup failure after draining work and attempts every retained close", async () => {
    const factory = new GatedEventStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: true }, factory);
    const admitted = store.append(createEvent("tenant-a-event", "created", 1n, "tenant-a"));
    await factory.entered;
    await store.append(createEvent("tenant-b-event", "created", 1n, "tenant-b"));
    factory.failCloseAt = 0;

    const closing = store.close();
    expect(store.close()).toBe(closing);
    expect(factory.closes).toEqual([]);
    factory.release();
    await expect(admitted).resolves.toBeUndefined();
    await expect(closing).rejects.toThrow("record close failed");
    expect(factory.closes).toEqual([0, 1]);
  });

  it("allows close inside the acceptance callback after its admission check", async () => {
    const factory = new TrackedEventStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const event = createEvent("callback-close", "created", 1n);

    await expect(
      store.acceptThenAppend(event, async () => {
        await store.close();
      }),
    ).rejects.toThrow("EventStore is closed");
    expect(factory.closes).toEqual([0]);
    expect(factory.isOpen()).toBe(true);
  });

  it("rejects idle cleanup while storage work is active without closing handles", async () => {
    const factory = new GatedEventStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const writing = store.append(createEvent("active-idle-close", "created", 1n));
    await factory.entered;

    expect(() => {
      eventStoreAccess.closeIdle(store);
    }).toThrow("requires no active storage work");
    expect(factory.closes).toEqual([]);
    expect(store.isOpen()).toBe(true);
    factory.release();
    await writing;
    eventStoreAccess.closeIdle(store);
    expect(factory.closes).toEqual([0]);
    await expect(store.close()).resolves.toBeUndefined();
    expect(factory.closes).toEqual([0]);
  });

  it("keeps the same failed cleanup outcome after synchronous idle close", async () => {
    const factory = new TrackedEventStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    await store.append(createEvent("idle-failure", "created", 1n));
    factory.failCloseAt = 0;

    expect(() => {
      eventStoreAccess.closeIdle(store);
    }).toThrow("record close failed");
    await expect(store.close()).rejects.toThrow("record close failed");
    expect(() => {
      eventStoreAccess.closeIdle(store);
    }).toThrow("record close failed");
    expect(factory.closes).toEqual([0]);
    expect(store.isOpen()).toBe(false);
  });

  it("keeps a grouped Event family separate across reads and strict admission", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "Tasks", multitenant: false } as const;
    const domain = new EventStore(context, factory);
    const system = new EventStore(context, factory, new StorageGroup("spine_system_events"));
    const event = createEvent("shared-event-id", "created", 1n);

    await domain.append(event);
    await system.append(event);
    expect(await domain.read()).toEqual([event]);
    expect(await system.read()).toEqual([event]);
    await expect(domain.accept(event)).rejects.toThrow();
    await expect(system.accept(event)).rejects.toThrow();

    const groupedOnly = createEvent("grouped-only", "renamed", 2n);
    await system.append(groupedOnly);
    const groupedId = groupedOnly.id;
    if (groupedId === undefined) throw new Error("Expected a generated Event ID.");
    expect(await domain.read({ ids: [groupedId] })).toEqual([]);
    expect(await system.read({ ids: [groupedId] })).toEqual([groupedOnly]);
  });

  it("separates equal domain and System names across factories sharing memory", async () => {
    const backend = new InMemoryStorageBackend();
    const context = { name: "Support_System", multitenant: false } as const;
    const domain = new EventStore(
      context,
      new InMemoryStorageFactory(backend),
      EventStoreGroups.forContext(context.name),
    );
    const system = new EventStore(
      context,
      new InMemoryStorageFactory(backend),
      EventStoreGroups.forContext(context.name, "system"),
    );
    const first = createEvent("same-id", "created", 1n);
    const second = createEvent("same-id", "renamed", 1n);

    await domain.append(first);
    await system.append(second);
    expect(await domain.read()).toEqual([first]);
    expect(await system.read()).toEqual([second]);
  });

  it("persists generated Spine events through record storage", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    const earlier = createEvent("event-1", "created", 1n);
    const later = createEvent("event-2", "renamed", 2n);

    await store.appendAll([later, earlier]);

    const read = await store.read({
      sort: [{ field: "created", direction: "asc" }],
    });

    expect(read.map((event) => event.id?.value)).toEqual(["event-1", "event-2"]);
    expect(read[0]).not.toBe(earlier);
    expect(read[1]).not.toBe(later);
  });

  it("reads only from the explicitly selected tenant slice", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: true }, factory);

    await store.append(createEvent("event-a", "created", 1n, "tenant-a"));
    await store.append(createEvent("event-b", "created", 1n, "tenant-b"));

    await expect(readTenantEvents(factory, tenant("tenant-a"))).resolves.toMatchObject([
      { id: { value: "event-a" } },
    ]);
    await expect(readTenantEvents(factory, tenant("tenant-b"))).resolves.toMatchObject([
      { id: { value: "event-b" } },
    ]);
  });

  it("uses event envelope tenant for single-event append and accept", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: true }, factory);
    const event = createEvent("event-a", "created", 1n, "tenant-a");

    await expect(store.accept(event)).resolves.toBeUndefined();
    await expect(store.append(event)).resolves.toBeUndefined();

    await expect(readTenantEvents(factory, tenant("tenant-a"))).resolves.toMatchObject([
      { id: { value: "event-a" } },
    ]);
    await expect(readTenantEvents(factory, tenant("tenant-b"))).resolves.toEqual([]);

    await expect(
      store.append(
        createEvent("event-domain", "created", 2n, {
          kind: "domain",
          value: "example.com",
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readTenantEvents(factory, tenant({ kind: "domain", value: "example.com" })),
    ).resolves.toMatchObject([{ id: { value: "event-domain" } }]);

    await expect(
      store.append(
        createEvent("event-email", "created", 3n, {
          kind: "email",
          value: "owner@example.com",
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      readTenantEvents(factory, tenant({ kind: "email", value: "owner@example.com" })),
    ).resolves.toMatchObject([{ id: { value: "event-email" } }]);
  });

  it("uses a past-message actor tenant and rejects accepting an existing ID", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: true }, factory);
    const event = createEvent("event-past", "created", 1n);
    if (event.context === undefined) throw new Error("Expected an event context.");
    event.context.origin = {
      case: "pastMessage",
      value: create(OriginSchema, {
        actorContext: create(ActorContextSchema, { tenantId: tenant("tenant-past") }),
      }),
    };

    await store.append(event);
    await expect(store.accept(event)).rejects.toThrow(/unique event IDs/);
    await expect(readTenantEvents(factory, tenant("tenant-past"))).resolves.toMatchObject([
      { id: { value: "event-past" } },
    ]);
  });

  it("requires an explicit tenant for multitenant reads", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: true },
      new InMemoryStorageFactory(),
    );

    await expect(store.read()).rejects.toThrow(/reads require a complete tenant ID/);
  });

  it("requires an event tenant when no multitenant default is selected", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: true },
      new InMemoryStorageFactory(),
    );

    await expect(store.append(createEvent("event-a", "created", 1n))).rejects.toThrow(
      /append requires an event tenant ID/,
    );
  });

  it("rejects a batch that crosses tenant boundaries", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: true },
      new InMemoryStorageFactory(),
    );

    await expect(
      store.appendAll([
        createEvent("event-a", "created", 1n, "tenant-a"),
        createEvent("event-b", "created", 1n, "tenant-b"),
      ]),
    ).rejects.toThrow(/cannot contain events from different tenants/);
  });

  it("supports empty appends and closes with the delegated record storage", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(store.appendAll([])).resolves.toBeUndefined();
    expect(store.isOpen()).toBe(true);

    await store.close();

    expect(store.isOpen()).toBe(false);
    await expect(store.read()).rejects.toThrow(/closed/);
  });

  it("rejects events without IDs and persists none from the batch", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      store.appendAll([
        create(EventSchema, {
          message: create(AnySchema, { typeUrl: "type.spine.io/spine.examples.todo.TaskCreated" }),
        }),
        create(EventSchema, {
          message: create(AnySchema, { typeUrl: "type.spine.io/tasks.TaskClosed" }),
        }),
      ]),
    ).rejects.toThrow(/event\.id/);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("rejects events with blank IDs", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      store.append(
        create(EventSchema, {
          id: create(EventIdSchema),
          message: create(AnySchema, { typeUrl: "type.spine.io/spine.examples.todo.TaskCreated" }),
        }),
      ),
    ).rejects.toThrow(/non-empty event\.id\.value/);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("rejects events with whitespace IDs", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(store.append(createEvent("   ", "created", 1n))).rejects.toThrow(
      /non-empty event\.id\.value/,
    );
    await expect(store.read()).resolves.toEqual([]);
  });

  it("rejects duplicate event IDs across stores sharing one factory and context", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "Tasks", multitenant: false };
    const first = new EventStore(context, factory);
    const second = new EventStore(context, factory);

    await first.append(createEvent("event-1", "created", 1n));

    await expect(second.append(createEvent("event-1", "renamed", 2n))).rejects.toThrow(
      /unique event IDs/,
    );
    await expect(first.read()).resolves.toHaveLength(1);
  });

  it("accepts an identical immutable append from another store without rewriting it", async () => {
    const factory = new InMemoryStorageFactory();
    const first = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const second = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const event = createEvent("same-event", "created", 1n);

    await first.append(event);
    await expect(second.append(event)).resolves.toBeUndefined();
    await expect(first.read()).resolves.toEqual([event]);
  });

  it("accepts concurrent identical immutable appends as one stored Event", async () => {
    const backend = new InMemoryStorageBackend();
    const first = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(backend),
    );
    const second = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(backend),
    );
    const event = createEvent("same-concurrent", "created", 1n);

    await expect(Promise.all([first.append(event), second.append(event)])).resolves.toEqual([
      undefined,
      undefined,
    ]);
    await expect(first.read()).resolves.toEqual([event]);
  });

  it("retries an ordered batch after a failure before its later insert", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const records = [createEvent("first", "created", 1n), createEvent("second", "renamed", 2n)];
    const original = Object.getOwnPropertyDescriptor(RecordStorage.prototype, "compareAndSet")
      ?.value as InMemoryRecordStorage<EventId, Event>["compareAndSet"];
    let failed = false;
    const write = vi
      .spyOn(InMemoryRecordStorage.prototype, "compareAndSet")
      .mockImplementation(function (
        this: InMemoryRecordStorage<EventId, Event>,
        id,
        expected,
        next,
      ) {
        if ((id as EventId).value === "second" && !failed) {
          failed = true;
          return Promise.reject(new Error("failure before later insert"));
        }
        return original.call(this, id, expected, next);
      });
    try {
      await expect(store.appendAll(records)).rejects.toThrow("failure before later insert");
      await expect(store.read()).resolves.toEqual([records[0]]);
      await expect(store.appendAll(records)).resolves.toBeUndefined();
      await expect(store.read()).resolves.toEqual(records);
    } finally {
      write.mockRestore();
    }
  });

  it("retries the same batch after an ambiguous later insert without changing Event IDs", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const records = [createEvent("first", "created", 1n), createEvent("second", "renamed", 2n)];
    const original = Object.getOwnPropertyDescriptor(RecordStorage.prototype, "compareAndSet")
      ?.value as InMemoryRecordStorage<EventId, Event>["compareAndSet"];
    let failed = false;
    const write = vi
      .spyOn(InMemoryRecordStorage.prototype, "compareAndSet")
      .mockImplementation(async function (
        this: InMemoryRecordStorage<EventId, Event>,
        id,
        expected,
        next,
      ) {
        const inserted = await original.call(this, id, expected, next);
        if ((id as EventId).value === "second" && !failed) {
          failed = true;
          throw new Error("response lost after insert");
        }
        return inserted;
      });
    try {
      await expect(store.appendAll(records)).rejects.toThrow("response lost after insert");
      await expect(store.appendAll(records)).resolves.toBeUndefined();
      await expect(store.read()).resolves.toEqual(records);
    } finally {
      write.mockRestore();
    }
  });

  it("allows only one strict admission after competing callbacks pass the absence precheck", async () => {
    const factory = new InMemoryStorageFactory();
    const first = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const second = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const event = createEvent("contended", "created", 1n);
    let admitted = 0;
    let release: (() => void) | undefined;
    let bothEntered: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    const callback = async () => {
      admitted += 1;
      if (admitted === 2) bothEntered?.();
      await gate;
    };
    const results = [
      first.acceptThenAppend(event, callback),
      second.acceptThenAppend(event, callback),
    ];
    await entered;
    release?.();

    const settled = await Promise.allSettled(results);
    expect(admitted).toBe(2);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(1);
    await expect(first.read()).resolves.toEqual([event]);
    await expect(first.acceptThenAppend(event, vi.fn())).rejects.toThrow(/unique event IDs/);
  });

  it("retries a vanished ID collision once and fails when no immutable row can be confirmed", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const original = Object.getOwnPropertyDescriptor(RecordStorage.prototype, "compareAndSet")
      ?.value as InMemoryRecordStorage<EventId, Event>["compareAndSet"];
    let attempts = 0;
    const write = vi
      .spyOn(InMemoryRecordStorage.prototype, "compareAndSet")
      .mockImplementation(function (
        this: InMemoryRecordStorage<EventId, Event>,
        id,
        expected,
        next,
      ) {
        attempts += 1;
        return attempts === 1 ? Promise.resolve(false) : original.call(this, id, expected, next);
      });
    try {
      await expect(store.append(createEvent("vanished", "created", 1n))).resolves.toBeUndefined();
      expect(attempts).toBe(2);
    } finally {
      write.mockRestore();
    }

    const lost = vi
      .spyOn(InMemoryRecordStorage.prototype, "compareAndSet")
      .mockResolvedValue(false);
    try {
      await expect(store.append(createEvent("never-present", "created", 1n))).rejects.toThrow(
        /could not confirm its ID/,
      );
    } finally {
      lost.mockRestore();
    }
  });

  it("atomically rejects concurrent duplicate IDs across factories for one logical context", async () => {
    const backend = new InMemoryStorageBackend();
    const first = new EventStore(
      { name: "First", multitenant: false },
      new InMemoryStorageFactory(backend),
    );
    const second = new EventStore(
      { name: "First", multitenant: false },
      new InMemoryStorageFactory(backend),
    );

    const results = await Promise.allSettled([
      first.append(createEvent("shared-event", "created", 1n)),
      second.append(createEvent("shared-event", "renamed", 2n)),
    ]);

    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toHaveLength(1);
    await expect(first.read()).resolves.toHaveLength(1);
  });

  it("rejects duplicate event IDs within one append batch", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      store.appendAll([
        createEvent("event-1", "created", 1n),
        createEvent("event-1", "renamed", 2n),
      ]),
    ).rejects.toThrow(/unique event IDs/);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("retains an inserted batch prefix when a later ID already exists", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    await store.append(createEvent("event-existing", "created", 1n));

    await expect(
      store.appendAll([
        createEvent("event-prefix", "renamed", 2n),
        createEvent("event-existing", "renamed", 3n),
      ]),
    ).rejects.toThrow(/unique event IDs/);

    await expect(store.read()).resolves.toMatchObject([
      {
        id: { value: "event-existing" },
        message: { typeUrl: "type.spine.io/spine.examples.todo.TaskCreated" },
      },
      {
        id: { value: "event-prefix" },
        message: { typeUrl: "type.spine.io/spine.examples.todo.TaskRenamed" },
      },
    ]);
  });

  it("fails closed when a provider does not promise atomic compare-and-set", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new NonAtomicEventStorageFactory(),
    );

    await expect(store.append(createEvent("event-a", "created", 1n))).rejects.toThrow(
      /requires atomic record compare-and-set/,
    );
  });

  it("snapshots events before queued append work runs", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const event = createEvent("event-before-mutation", "created", 1n);

    const append = store.append(event);
    event.id = create(EventIdSchema, { value: "event-after-mutation" });

    await append;

    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-before-mutation" } }]);
  });
});

type TenantInput =
  | string
  | {
      readonly kind: "domain" | "email";
      readonly value: string;
    };

function createEvent(
  id: string,
  kind: "created" | "renamed",
  seconds: bigint,
  tenantId?: TenantInput,
) {
  const taskId = create(TaskIdSchema, { value: "task-1" });
  const payload =
    kind === "created"
      ? create(TaskCreatedSchema, {
          id: taskId,
          title: "Task",
          taskListId: create(TaskListIdSchema, { value: "list-1" }),
        })
      : create(TaskRenamedSchema, { id: taskId, title: "Renamed" });
  const schema = kind === "created" ? TaskCreatedSchema : TaskRenamedSchema;
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: create(AnySchema, {
      typeUrl: `type.spine.io/${schema.typeName}`,
      value: toBinary(schema, payload as never),
    }),
    context: createEventContext(seconds, tenantId),
  });
}

function createEventContext(seconds: bigint, tenantId: TenantInput | undefined) {
  const context = create(EventContextSchema, {
    timestamp: create(TimestampSchema, { seconds }),
  });

  if (tenantId !== undefined) {
    context.origin = {
      case: "importContext",
      value: create(ActorContextSchema, {
        tenantId: create(TenantIdSchema, {
          kind: tenantKind(tenantId),
        }),
      }),
    };
  }

  return context;
}

function tenantKind(tenantId: TenantInput): TenantId["kind"] {
  if (typeof tenantId === "string") {
    return { case: "value", value: tenantId };
  }
  if (tenantId.kind === "domain") {
    return { case: "domain", value: create(InternetDomainSchema, { value: tenantId.value }) };
  }
  return { case: "email", value: create(EmailAddressSchema, { value: tenantId.value }) };
}

function tenant(value: TenantInput): TenantId {
  return create(TenantIdSchema, { kind: tenantKind(value) });
}

async function readTenantEvents(factory: InMemoryStorageFactory, tenantId: TenantId) {
  const reader = new EventStore({ name: "Tasks", multitenant: true, tenantId }, factory);
  try {
    return await reader.read();
  } finally {
    await reader.close();
  }
}

class NonAtomicEventStorageFactory extends InMemoryStorageFactory {
  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    const storage = super.onCreateRecordStorage(context, recordSpec, group);
    Object.defineProperty(storage, "atomicCompareAndSet", { value: false });
    return storage;
  }
}

class TrackedEventStorageFactory extends InMemoryStorageFactory {
  readonly creations: StorageContext[] = [];
  readonly closes: number[] = [];
  failNextCreate = false;
  failCloseAt = -1;
  failAllCloses = false;

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    if (this.failNextCreate) {
      this.failNextCreate = false;
      throw new Error("record creation failed");
    }
    const storage = super.onCreateRecordStorage(context, recordSpec, group);
    const index = this.creations.push(context) - 1;
    const originalClose = storage.close.bind(storage);
    vi.spyOn(storage, "close").mockImplementation(() => {
      this.closes.push(index);
      originalClose();
      if (index === this.failCloseAt || this.failAllCloses) throw new Error("record close failed");
    });
    return storage;
  }
}

class GatedEventStorageFactory extends TrackedEventStorageFactory {
  readonly entered: Promise<void>;
  readonly #continue: Promise<void>;
  #onEntered: (() => void) | undefined;
  #onRelease: (() => void) | undefined;

  constructor() {
    super();
    this.entered = new Promise((resolve) => {
      this.#onEntered = resolve;
    });
    this.#continue = new Promise((resolve) => {
      this.#onRelease = resolve;
    });
  }

  release(): void {
    this.#onRelease?.();
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    const storage = super.onCreateRecordStorage(context, recordSpec, group);
    if (this.creations.length > 1) return storage;
    const compare = storage.compareAndSet.bind(storage);
    let writes = 0;
    vi.spyOn(storage, "compareAndSet").mockImplementation(async (id, expected, next) => {
      const inserted = await compare(id, expected, next);
      if (++writes === 1) {
        this.#onEntered?.();
        await this.#continue;
      }
      return inserted;
    });
    return storage;
  }
}

class GatedReadStorageFactory extends TrackedEventStorageFactory {
  readonly entered: Promise<void>;
  readonly #continue: Promise<void>;
  #onEntered: (() => void) | undefined;
  #onRelease: (() => void) | undefined;

  constructor() {
    super();
    this.entered = new Promise((resolve) => {
      this.#onEntered = resolve;
    });
    this.#continue = new Promise((resolve) => {
      this.#onRelease = resolve;
    });
  }

  release(): void {
    this.#onRelease?.();
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    const storage = super.onCreateRecordStorage(context, recordSpec, group);
    const query = storage.query.bind(storage);
    vi.spyOn(storage, "query").mockImplementation(async (request) => {
      const result = await query(request);
      this.#onEntered?.();
      await this.#continue;
      return result;
    });
    return storage;
  }
}
