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
import { create, fromBinary, ScalarType, toBinary } from "@bufbuild/protobuf";
import type { Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { AnySchema, StringValueSchema, type StringValue } from "@bufbuild/protobuf/wkt";
import type { Event } from "@spine-event-engine/proto";
import { EventIdSchema, EventSchema, TenantIdSchema } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import { describe, expect, it } from "vitest";

import {
  InMemoryStorageFactory,
  InMemoryStorageBackend,
  ColumnTypes,
  RecordColumn,
  RecordSpec,
  StorageGroup,
  type StorageFactory,
} from "../../src/index.js";
import { EntityCommitStorageFactories } from "../../src/internal/entity-commit.js";
import type { EntityStorageInput } from "../../src/internal/entity-history.js";

describe("StorageFactory", () => {
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

  it("keeps explicitly grouped records separate from ungrouped records with the same spec", async () => {
    const factory = new InMemoryStorageFactory();
    const spec = createEventSpec();
    const context = { name: "Tasks", multitenant: false } as const;
    const ungrouped = factory.createRecordStorage(context, spec);
    const grouped = factory.createRecordStorage(context, spec, new StorageGroup("task-state"));

    await ungrouped.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated"));

    await expect(
      grouped.read(create(EventIdSchema, { value: "event-1" })),
    ).resolves.toBeUndefined();
    await grouped.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated"));
    await expect(
      ungrouped.read(create(EventIdSchema, { value: "event-1" })),
    ).resolves.toMatchObject({
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

  it("shares a tenant and record family across Bounded Context names", async () => {
    const factory = new InMemoryStorageFactory();
    const spec = createEventSpec();
    const tasks = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);
    const users = factory.createRecordStorage({ name: "Users", multitenant: false }, spec);

    await tasks.write(createEvent("event-1", "type.spine.io/tasks.TaskCreated"));

    await expect(users.read(create(EventIdSchema, { value: "event-1" }))).resolves.toMatchObject({
      id: { value: "event-1" },
    });
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
    ).resolves.toMatchObject({ id: { value: "event-1" } });
    await expect(
      otherSource.read(create(EventIdSchema, { value: "event-1" })),
    ).resolves.toBeUndefined();
  });

  it("keeps single-tenant records separate from multitenant slices", async () => {
    const factory = new InMemoryStorageFactory();
    const spec = createEventSpec();
    const singleTenant = factory.createRecordStorage({ name: "Tasks", multitenant: false }, spec);
    const multitenant = factory.createRecordStorage(
      { name: "Tasks", multitenant: true, tenantId: tenant("value", "single") },
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
    const tenantOne = {
      name: "TenantBound",
      multitenant: true,
      tenantId: tenant("value", "one"),
    } as const;
    const tenantTwo = {
      name: "TenantBound",
      multitenant: true,
      tenantId: tenant("value", "two"),
    } as const;

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
            read(id: string): Promise<EntityRecord | undefined>;
            write(record: EntityRecord): Promise<void>;
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
      await entityStorage.current.write(currentRecord("task", "entity", 1));

      await expect(recordStorage.read("record")).resolves.toMatchObject({ value: "record" });
      const current = await entityStorage.current.read("task");
      expect(
        current?.state === undefined
          ? undefined
          : fromBinary(StringValueSchema, current.state.value),
      ).toEqual(create(StringValueSchema, { value: "entity" }));
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
    columns: [
      new RecordColumn<Event>(
        "typeUrl",
        ColumnTypes.scalar(ScalarType.STRING),
        (event) => event.message?.typeUrl,
      ),
    ],
  });
}

function tenant(kind: "value", value: string) {
  return create(TenantIdSchema, { kind: { case: kind, value } });
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
  const unpack = (id: NonNullable<EntityRecord["entityId"]>): string | undefined =>
    id.typeUrl.endsWith(`/${StringValueSchema.typeName}`)
      ? fromBinary(StringValueSchema, id.value).value
      : undefined;
  return {
    context: { name: "Tasks", multitenant: false },
    id: {
      clone: (id) => id,
      key: (id) => id,
      pack: (id) => packed(create(StringValueSchema, { value: id })),
      unpack,
    },
    columns: [],
    recordSpec: new RecordSpec({
      sourceType: StringValueSchema,
      recordType: EntityRecordSchema,
      idKind: "string",
      extractId: (record) => {
        if (record.entityId === undefined) throw new Error("EntityRecord requires entityId.");
        const id = unpack(record.entityId);
        if (id === undefined) throw new Error("EntityRecord has an incompatible ID.");
        return id;
      },
    }),
    sourceType: StringValueSchema,
    stateSchema: StringValueSchema,
  };
}

function currentRecord(id: string, value: string, version: number): EntityRecord {
  return create(EntityRecordSchema, {
    entityId: packed(create(StringValueSchema, { value: id })),
    state: packed(create(StringValueSchema, { value })),
    version: { number: version },
    lifecycleFlags: { archived: false, deleted: false },
  });
}

function packed(value: StringValue) {
  return create(AnySchema, {
    typeUrl: `type.spine.io/${StringValueSchema.typeName}`,
    value: toBinary(StringValueSchema, value),
  });
}
