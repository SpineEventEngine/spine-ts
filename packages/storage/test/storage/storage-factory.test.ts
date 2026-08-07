import { create } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnySchema, StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
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
import { EntityCommitStorageFactories } from "../../src/internal/entity-commit.js";
import type { EntityStorageInput } from "../../src/internal/entity-history.js";
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
  });

  it("shares source-type scopes across factories given one backend token", async () => {
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

  it("shares Unicode-delimited equivalent source scopes without collisions", async () => {
    const backend = new InMemoryStorageBackend();
    const contextName = "Tasks-a-é-中-𐀀";
    const sourceSchema = sourceType("tasks.Task-a-é-中-𐀀");
    const firstFactory = new InMemoryStorageFactory(backend);
    const secondFactory = new InMemoryStorageFactory(backend);
    const first = firstFactory.createRecordStorage(
      { name: contextName, multitenant: false },
      createEventSpec(sourceSchema),
    );
    const equivalent = secondFactory.createRecordStorage(
      { name: contextName, multitenant: false },
      createEventSpec(sourceSchema),
    );
    const otherContext = secondFactory.createRecordStorage(
      { name: `${contextName}-other`, multitenant: false },
      createEventSpec(sourceSchema),
    );
    const otherSource = secondFactory.createRecordStorage(
      { name: contextName, multitenant: false },
      createEventSpec(sourceType(`${sourceSchema.typeName}-other`)),
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
      otherSource.read(create(EventIdSchema, { value: "event-1" })),
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

  it("keeps source-type rows isolated by tenant scope", async () => {
    const backend = new InMemoryStorageBackend();
    const factory = new InMemoryStorageFactory(backend);
    const spec = createEventSpec();
    const tenantOne = { name: "TenantBound", multitenant: true, tenantId: "one" };
    const tenantTwo = { name: "TenantBound", multitenant: true, tenantId: "two" };

    const first = factory.createRecordStorage(tenantOne, spec);
    const otherTenant = factory.createRecordStorage(tenantTwo, spec);

    await expect(first.read(create(EventIdSchema, { value: "event-1" }))).resolves.toBeUndefined();
    await expect(
      otherTenant.read(create(EventIdSchema, { value: "event-1" })),
    ).resolves.toBeUndefined();
  });

  it.each(["record-first", "entity-first"] as const)(
    "keeps generic records and Entity storage usable when created %s",
    async (order) => {
      const factory = new InMemoryStorageFactory();
      const records = () =>
        factory.createRecordStorage(
          { name: "SharedSource", multitenant: false },
          new RecordSpec<string, StringValue>({
            recordType: StringValueSchema,
            idKind: "string",
            extractId: (record) => record.value,
          }),
        );
      const entities = () =>
        factory.createEntityStorage({
          ...createEntityInput(),
          context: { name: "SharedSource", multitenant: false },
        }) as {
          readonly current: {
            read(id: string): Promise<{ readonly state: StringValue } | undefined>;
            write(record: {
              readonly id: string;
              readonly state: StringValue;
              readonly version: bigint;
              readonly archived: boolean;
              readonly deleted: boolean;
            }): Promise<void>;
          };
        };
      const [recordStorage, entityStorage] =
        order === "record-first"
          ? [records(), entities()]
          : (() => {
              const entityStorage = entities();
              return [records(), entityStorage] as const;
            })();

      await recordStorage.write(create(StringValueSchema, { value: "record" }));
      await entityStorage.current.write({
        id: "task",
        state: create(StringValueSchema, { value: "entity" }),
        version: 1n,
        archived: false,
        deleted: false,
      });

      await expect(recordStorage.read("record")).resolves.toMatchObject({ value: "record" });
      await expect(entityStorage.current.read("task")).resolves.toMatchObject({
        state: { value: "entity" },
      });
    },
  );

  it("rejects record storage creation after the factory closes", () => {
    const factory = new InMemoryStorageFactory();
    const spec = createEventSpec();

    factory.close();

    expect(factory.isOpen()).toBe(false);
    expect(() => factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec)).toThrow(
      /closed/,
    );
  });

  it("rejects internal entity and atomic commit storage creation after the factory closes", () => {
    const factory = new InMemoryStorageFactory();
    const input = createEntityInput();

    factory.close();

    expect(() => factory.createEntityStorage(input)).toThrow(/closed/);
    expect(() => EntityCommitStorageFactories.create(factory, input)).toThrow(/closed/);
  });
});

function createEventSpec(sourceType: GenMessage<Message> = EventSchema) {
  return new RecordSpec({
    sourceType,
    recordType: EventSchema,
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

function sourceType(typeName: string): GenMessage<Message> {
  return { typeName } as GenMessage<Message>;
}

function createEvent(id: string, typeUrl: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: create(AnySchema, { typeUrl }),
  });
}

function createEntityInput(): EntityStorageInput<string, StringValue> {
  return {
    context: { name: "Tasks", multitenant: false },
    id: { clone: (id) => id, key: (id) => id },
    extractId: () => "task",
    columns: [],
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
  };
}
