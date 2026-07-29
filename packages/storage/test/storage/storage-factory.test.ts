import { create } from "@bufbuild/protobuf";
import { AnySchema } from "@bufbuild/protobuf/wkt";
import type { Event } from "@spine-event-engine/proto";
import { EventIdSchema, EventSchema } from "@spine-event-engine/proto";
import { describe, expect, it } from "vitest";

import {
  InMemoryStorageFactory,
  InMemoryStorageBackend,
  RecordColumn,
  RecordSpec,
  type StorageFactory,
} from "../../src/index.js";
import { StorageScopes } from "../../src/storage/canonical-scope.js";

describe("StorageFactory", () => {
  it("exposes immutable storage-scope methods", () => {
    const rejectsReassignment = () => {
      // @ts-expect-error Frozen owner methods cannot be reassigned.
      StorageScopes.canonical = () => "unreachable";
    };
    void rejectsReassignment;
    expect(Object.isFrozen(StorageScopes)).toBe(true);
    expect(Object.getOwnPropertyDescriptor(StorageScopes, "canonical")?.writable).toBe(false);
  });

  it("length-delimits tenant scope components without colliding", () => {
    const first = StorageScopes.canonical({ name: "a:b", multitenant: true, tenantId: "c" }, "d");
    const second = StorageScopes.canonical({ name: "a", multitenant: true, tenantId: "b:c" }, "d");

    expect(first).not.toBe(second);
  });

  it("creates typed record storages through the JVM-like seam", () => {
    const factory: StorageFactory = new InMemoryStorageFactory();
    const spec = createEventSpec();
    const storage = factory.createRecordStorage(
      {
        name: "Tasks",
        multitenant: false,
      },
      spec,
    );

    expect(storage.recordSpec).toBe(spec);
  });

  it("creates separate storage objects over one factory backing store", async () => {
    const factory = new InMemoryStorageFactory();
    const spec = createEventSpec();
    const first = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);
    const second = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);

    await first.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated"));

    expect(first).not.toBe(second);
    await expect(second.read(create(EventIdSchema, { value: "event-1" }))).resolves.toMatchObject({
      id: { value: "event-1" },
    });
  });

  it("isolates compatible scopes across default independent factories", async () => {
    const firstFactory = new InMemoryStorageFactory();
    const secondFactory = new InMemoryStorageFactory();
    const incompatibleFactory = new InMemoryStorageFactory();
    const compatible = createEventSpec();
    const first = firstFactory.createRecordStorage(
      { name: "SharedFactoryScope", multitenant: false },
      compatible,
    );
    const second = secondFactory.createRecordStorage(
      { name: "SharedFactoryScope", multitenant: false },
      compatible,
    );
    await first.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated"));

    await expect(second.read(create(EventIdSchema, { value: "event-1" }))).resolves.toBeUndefined();

    expect(() =>
      incompatibleFactory.createRecordStorage(
        { name: "SharedFactoryScope", multitenant: false },
        new RecordSpec({
          schema: EventSchema,
          storageKey: compatible.storageKey,
          idKind: "string",
          extractId: (event) => event.id,
        }),
      ),
    ).not.toThrow();
  });

  it("shares compatible scopes and rejects mismatches across factories given one backend token", async () => {
    const backend = new InMemoryStorageBackend();
    const firstFactory = new InMemoryStorageFactory(backend);
    const secondFactory = new InMemoryStorageFactory(backend);
    const compatible = createEventSpec();
    const first = firstFactory.createRecordStorage(
      { name: "SharedFactoryScope", multitenant: false },
      compatible,
    );
    const second = secondFactory.createRecordStorage(
      { name: "SharedFactoryScope", multitenant: false },
      compatible,
    );
    await first.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated"));

    await expect(second.read(create(EventIdSchema, { value: "event-1" }))).resolves.toMatchObject({
      id: { value: "event-1" },
    });
    const incompatible = secondFactory.createRecordStorage(
      { name: "SharedFactoryScope", multitenant: false },
      new RecordSpec({
        schema: EventSchema,
        storageKey: compatible.storageKey,
        idKind: "string",
        extractId: (event) => event.id,
      }),
    );
    await expect(incompatible.read(create(EventIdSchema, { value: "event-1" }))).rejects.toThrow(
      /incompatible/,
    );
  });

  it("retains shared backend rows when a sibling factory closes", async () => {
    const backend = new InMemoryStorageBackend();
    const firstFactory = new InMemoryStorageFactory(backend);
    const secondFactory = new InMemoryStorageFactory(backend);
    const spec = createEventSpec();
    const first = firstFactory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);
    await first.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated"));

    firstFactory.close();

    const sibling = secondFactory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);
    await expect(sibling.read(create(EventIdSchema, { value: "event-1" }))).resolves.toMatchObject({
      id: { value: "event-1" },
    });
  });

  it("keeps records isolated by storage context name", async () => {
    const factory = new InMemoryStorageFactory();
    const spec = createEventSpec();
    const tasks = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);
    const users = factory.createRecordStorage({ name: "Users", multitenant: false }, spec);

    await tasks.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated"));

    await expect(users.read(create(EventIdSchema, { value: "event-1" }))).resolves.toBeUndefined();
  });

  it("shares Unicode-delimited equivalent scopes without colliding context or storage keys", async () => {
    const backend = new InMemoryStorageBackend();
    const contextName = "Tasks-a-é-中-𐀀";
    const storageKey = "tasks.Task-a-é-中-𐀀";
    const firstFactory = new InMemoryStorageFactory(backend);
    const secondFactory = new InMemoryStorageFactory(backend);
    const first = firstFactory.createRecordStorage(
      { name: contextName, multitenant: false },
      createEventSpec(storageKey),
    );
    const equivalent = secondFactory.createRecordStorage(
      { name: contextName, multitenant: false },
      createEventSpec(storageKey),
    );
    const otherContext = secondFactory.createRecordStorage(
      { name: `${contextName}-other`, multitenant: false },
      createEventSpec(storageKey),
    );
    const otherStorageKey = secondFactory.createRecordStorage(
      { name: contextName, multitenant: false },
      createEventSpec(`${storageKey}-other`),
    );

    await first.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated"));

    await expect(
      equivalent.read(create(EventIdSchema, { value: "event-1" })),
    ).resolves.toMatchObject({
      id: { value: "event-1" },
    });
    await expect(
      otherContext.read(create(EventIdSchema, { value: "event-1" })),
    ).resolves.toBeUndefined();
    await expect(
      otherStorageKey.read(create(EventIdSchema, { value: "event-1" })),
    ).resolves.toBeUndefined();
  });

  it("keeps single-tenant records separate from multitenant slices", async () => {
    const factory = new InMemoryStorageFactory();
    const spec = createEventSpec();
    const singleTenant = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);
    const multitenant = factory.createRecordStorage(
      { name: "Tasks", multitenant: true, tenantId: "__single__" },
      spec,
    );

    await singleTenant.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated"));

    await expect(
      multitenant.read(create(EventIdSchema, { value: "event-1" })),
    ).resolves.toBeUndefined();
  });

  it("binds compatibility independently for distinct tenant scopes", async () => {
    const backend = new InMemoryStorageBackend();
    const factory = new InMemoryStorageFactory(backend);
    const compatible = createEventSpec();
    const tenantOne = { name: "TenantBound", multitenant: true, tenantId: "one" };
    const tenantTwo = { name: "TenantBound", multitenant: true, tenantId: "two" };

    const first = factory.createRecordStorage(tenantOne, compatible);
    const otherTenant = factory.createRecordStorage(
      tenantTwo,
      new RecordSpec({
        schema: EventSchema,
        storageKey: compatible.storageKey,
        idKind: "string",
        extractId: (event) => event.id,
      }),
    );
    const sameTenantMismatch = factory.createRecordStorage(
      tenantOne,
      new RecordSpec({
        schema: EventSchema,
        storageKey: compatible.storageKey,
        idKind: "string",
        extractId: (event) => event.id,
      }),
    );

    await expect(first.read(create(EventIdSchema, { value: "event-1" }))).resolves.toBeUndefined();
    await expect(
      otherTenant.read(create(EventIdSchema, { value: "event-1" })),
    ).resolves.toBeUndefined();
    await expect(
      sameTenantMismatch.read(create(EventIdSchema, { value: "event-1" })),
    ).rejects.toThrow(/incompatible/);
  });

  it("rejects record storage creation after the factory closes", () => {
    const factory = new InMemoryStorageFactory();
    const spec = createEventSpec();

    factory.close();

    expect(factory.isOpen()).toBe(false);
    expect(() => factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec)).toThrow(
      /closed/,
    );
  });
});

function createEventSpec(storageKey = "EventSchema:legacy") {
  return new RecordSpec({
    schema: EventSchema,
    storageKey,
    idSchema: EventIdSchema,
    extractId: (event) => {
      if (event.id === undefined) {
        throw new Error("Expected event.id.");
      }

      return event.id;
    },
    columns: [new RecordColumn<Event>("typeUrl", (event) => event.message?.typeUrl, "string")],
  });
}

function createEvent(id: string, typeUrl: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: create(AnySchema, { typeUrl }),
  });
}
