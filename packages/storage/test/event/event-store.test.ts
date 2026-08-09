import { create } from "@bufbuild/protobuf";
import { AnySchema, TimestampSchema } from "@bufbuild/protobuf/wkt";
import {
  ActorContextSchema,
  EmailAddressSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  InternetDomainSchema,
  TenantIdSchema,
  type TenantId,
} from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import { EventStore, InMemoryStorageFactory } from "../../src/index.js";
import { eventStoreAccess } from "../../src/internal/event-store.js";

describe("EventStore", () => {
  it("preserves a caller result through the provider-only Event Store lock", async () => {
    const factory = new InMemoryStorageFactory();
    await expect(
      eventStoreAccess.withLock(factory, { name: "Tasks", multitenant: false }, () =>
        Promise.resolve("sentinel"),
      ),
    ).resolves.toBe("sentinel");
  });

  it("persists generated Spine events through record storage", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    const earlier = createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n);
    const later = createEvent("event-2", "type.spine.io/tasks.TaskRenamed", 2n);

    await store.appendAll([later, earlier]);

    const read = await store.read({
      sort: [{ field: "created", direction: "asc" }],
    });

    expect(read.map((event) => event.id?.value)).toEqual(["event-1", "event-2"]);
    expect(read[0]).not.toBe(earlier);
    expect(read[1]).not.toBe(later);
  });

  it("uses the current tenant slice from the storage context", async () => {
    let currentTenantId = tenant("tenant-a");
    const factory = new InMemoryStorageFactory();
    const store = new EventStore(
      {
        name: "Tasks",
        multitenant: true,
        get tenantId() {
          return currentTenantId;
        },
      },
      factory,
    );

    await store.append(createEvent("event-a", "type.spine.io/tasks.TaskCreated", 1n));
    currentTenantId = tenant("tenant-b");
    await store.append(createEvent("event-b", "type.spine.io/tasks.TaskCreated", 1n));
    currentTenantId = tenant("tenant-a");

    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-a" } }]);
    currentTenantId = tenant("tenant-b");
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-b" } }]);
  });

  it("uses event envelope tenant for single-event append and accept", async () => {
    let currentTenantId = tenant("fallback-tenant");
    const factory = new InMemoryStorageFactory();
    const store = new EventStore(
      {
        name: "Tasks",
        multitenant: true,
        get tenantId() {
          return currentTenantId;
        },
      },
      factory,
    );
    const event = createEvent("event-a", "type.spine.io/tasks.TaskCreated", 1n, "tenant-a");

    await expect(store.accept(event)).resolves.toBeUndefined();
    await expect(store.append(event)).resolves.toBeUndefined();

    currentTenantId = tenant("tenant-a");
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-a" } }]);
    currentTenantId = tenant("tenant-b");
    await expect(store.read()).resolves.toEqual([]);

    await expect(
      store.append(
        createEvent("event-domain", "type.spine.io/tasks.TaskDomain", 2n, {
          kind: "domain",
          value: "example.com",
        }),
      ),
    ).resolves.toBeUndefined();
    currentTenantId = tenant({ kind: "domain", value: "example.com" });
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-domain" } }]);

    await expect(
      store.append(
        createEvent("event-email", "type.spine.io/tasks.TaskEmail", 3n, {
          kind: "email",
          value: "owner@example.com",
        }),
      ),
    ).resolves.toBeUndefined();
    currentTenantId = tenant({ kind: "email", value: "owner@example.com" });
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-email" } }]);
  });

  it("supports empty appends and closes with the delegated record storage", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(store.appendAll([])).resolves.toBeUndefined();
    const rollback = await store.appendAllWithRollback([]);
    await expect(rollback.rollback()).resolves.toBeUndefined();
    expect(store.isOpen()).toBe(true);

    store.close();

    expect(store.isOpen()).toBe(false);
    await expect(store.read()).rejects.toThrow(/closed/);
  });

  it("rejects events without IDs and persists none from the batch", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      store.appendAll([
        create(EventSchema, {
          message: create(AnySchema, { typeUrl: "type.spine.io/tasks.TaskCreated" }),
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
          message: create(AnySchema, { typeUrl: "type.spine.io/tasks.TaskCreated" }),
        }),
      ),
    ).rejects.toThrow(/non-empty event\.id\.value/);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("rejects events with whitespace IDs", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      store.append(createEvent("   ", "type.spine.io/tasks.TaskCreated", 1n)),
    ).rejects.toThrow(/non-empty event\.id\.value/);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("rejects duplicate event IDs across stores sharing one factory and context", async () => {
    const factory = new InMemoryStorageFactory();
    const context = { name: "Tasks", multitenant: false };
    const first = new EventStore(context, factory);
    const second = new EventStore(context, factory);

    await first.append(createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n));

    await expect(
      second.append(createEvent("event-1", "type.spine.io/tasks.TaskRenamed", 2n)),
    ).rejects.toThrow(/unique event IDs/);
    await expect(first.read()).resolves.toHaveLength(1);
  });

  it("rejects duplicate event IDs within one append batch", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      store.appendAll([
        createEvent("event-1", "type.spine.io/tasks.TaskCreated", 1n),
        createEvent("event-1", "type.spine.io/tasks.TaskRenamed", 2n),
      ]),
    ).rejects.toThrow(/unique event IDs/);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("rolls back appended events using cloned event IDs", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const first = createEvent("event-delete-1", "type.spine.io/tasks.TaskCreated", 1n);

    const rollback = await store.appendAllWithRollback([
      first,
      createEvent("event-delete-2", "type.spine.io/tasks.TaskRenamed", 2n),
    ]);
    first.id = create(EventIdSchema, { value: "event-mutated" });

    await rollback.rollback();

    await expect(store.read()).resolves.toEqual([]);
    await store.append(createEvent("event-delete-1", "type.spine.io/tasks.TaskCreated", 3n));
    await expect(rollback.rollback()).rejects.toThrow(
      "Event rollback token has already been used.",
    );
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-delete-1" } }]);
  });

  it("rejects rollback after close", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const rollback = await store.appendAllWithRollback([
      createEvent("event-after-close", "type.spine.io/tasks.TaskCreated", 1n),
    ]);

    store.close();

    await expect(rollback.rollback()).rejects.toThrow(/closed/);
  });

  it("snapshots events before queued append work runs", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const event = createEvent("event-before-mutation", "type.spine.io/tasks.TaskCreated", 1n);

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

function createEvent(id: string, typeUrl: string, seconds: bigint, tenantId?: TenantInput) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: create(AnySchema, {
      typeUrl,
      value: new Uint8Array([1, 2, 3]),
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
