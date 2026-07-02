import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  AnySchema,
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  type Any,
} from "@bufbuild/protobuf/wkt";
import { packAny, packEvent } from "@spine-ts/core";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import {
  EventStore,
  InMemoryRecordStorage,
  InMemoryStorageFactory,
  RecordStorage,
  type RecordSpec,
  type StorageContext,
} from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { AggregateStorage } from "../../src/index.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type NestedId = Message<"NestedId"> & {
  value: string;
};

type ObjectIdEvent = Message<"ObjectIdEvent"> & {
  id?: NestedId;
};

type NumberIdEvent = Message<"NumberIdEvent"> & {
  id: number;
};

type BooleanIdEvent = Message<"BooleanIdEvent"> & {
  id: boolean;
};

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Aggregate storage fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;
const fileRoutingFixture = fileDesc(
  Buffer.from(
    toBinary(
      FileDescriptorProtoSchema,
      create(FileDescriptorProtoSchema, {
        name: "spine_ts/test/aggregate_routing.proto",
        package: "spine_ts.test",
        syntax: "proto3",
        messageType: [
          {
            name: "NestedId",
            field: [field("value", 1, FieldDescriptorProto_Type.STRING)],
          },
          {
            name: "ObjectIdEvent",
            field: [
              field("id", 1, FieldDescriptorProto_Type.MESSAGE, {
                typeName: ".spine_ts.test.NestedId",
              }),
            ],
          },
          {
            name: "NumberIdEvent",
            field: [field("id", 1, FieldDescriptorProto_Type.INT32)],
          },
          {
            name: "BooleanIdEvent",
            field: [field("id", 1, FieldDescriptorProto_Type.BOOL)],
          },
        ],
      }),
    ),
  ).toString("base64"),
);
const NestedIdSchema = messageDesc(fileRoutingFixture, 0) as GenMessage<NestedId>;
const ObjectIdEventSchema = messageDesc(fileRoutingFixture, 1) as GenMessage<ObjectIdEvent>;
const NumberIdEventSchema = messageDesc(fileRoutingFixture, 2) as GenMessage<NumberIdEvent>;
const BooleanIdEventSchema = messageDesc(fileRoutingFixture, 3) as GenMessage<BooleanIdEvent>;

describe("AggregateStorage", () => {
  it("loads the latest snapshot plus events after the snapshot version", async () => {
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await storage.appendEvents("task-1", [
      createAggregateEvent("event-1", "task-1", 1, "created"),
      createAggregateEvent("event-2", "task-1", 2, "renamed"),
    ]);
    await storage.writeSnapshot({
      aggregateId: "task-1",
      state: create(AggregateStateSchema, {
        id: "task-1",
        name: "renamed",
        archived: false,
      }),
      version: 2n,
      lifecycle: {
        archived: false,
        deleted: false,
      },
    });
    await storage.appendEvents("task-1", [
      createAggregateEvent("event-3", "task-1", 3, "assigned"),
      createAggregateEvent("event-4", "task-1", 4, "closed"),
    ]);
    await storage.appendEvents("other-task", [
      createAggregateEvent("event-other", "other-task", 5, "outside"),
    ]);

    const history = await storage.readHistory("task-1");

    expect(history.snapshot).toMatchObject({
      aggregateId: "task-1",
      state: {
        id: "task-1",
        name: "renamed",
        archived: false,
      },
      version: 2n,
      lifecycle: {
        archived: false,
        deleted: false,
      },
    });
    expect(history.events.map((event) => event.id?.value)).toEqual(["event-3", "event-4"]);
  });

  it("loads full aggregate event history when no snapshot is present", async () => {
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await storage.appendEvents("task-2", [
      createAggregateEvent("event-5", "task-2", 1, "created"),
      createAggregateEvent("event-6", "task-2", 2, "renamed"),
    ]);

    const history = await storage.readHistory("task-2");

    expect(history.snapshot).toBeUndefined();
    expect(history.events.map((event) => event.id?.value)).toEqual(["event-5", "event-6"]);
  });

  it("rejects mismatched or unreadable aggregate IDs before appending", async () => {
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await expect(
      storage.appendEvents("task-3", [
        createAggregateEvent("event-7", "task-3", 1, "created"),
        createAggregateEvent("event-8", "other-task", 2, "wrong aggregate"),
      ]),
    ).rejects.toThrow(/same aggregate ID/);
    await expect(
      storage.appendEvents("task-3", [createAggregateEvent("event-9", "task-3", undefined)]),
    ).rejects.toThrow(/version/);

    const history = await storage.readHistory("task-3");
    expect(history.events).toEqual([]);
  });

  it("rejects duplicate and non-increasing event versions for one aggregate", async () => {
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await expect(
      storage.appendEvents("task-4", [
        createAggregateEvent("event-10", "task-4", 1, "created"),
        createAggregateEvent("event-11", "task-4", 1, "duplicate"),
      ]),
    ).rejects.toThrow(/increasing/);
    expect((await storage.readHistory("task-4")).events).toEqual([]);

    await storage.appendEvents("task-4", [createAggregateEvent("event-12", "task-4", 2)]);
    await expect(
      storage.appendEvents("task-4", [createAggregateEvent("event-13", "task-4", 2)]),
    ).rejects.toThrow(/increasing/);
    expect((await storage.readHistory("task-4")).events.map((event) => event.id?.value)).toEqual([
      "event-12",
    ]);
  });

  it("loads aggregate history by version when event IDs sort differently", async () => {
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await storage.appendEvents("task-5", [
      createAggregateEvent("event-z", "task-5", 1, "created"),
      createAggregateEvent("event-a", "task-5", 2, "renamed"),
    ]);

    expect((await storage.readHistory("task-5")).events.map((event) => event.id?.value)).toEqual([
      "event-z",
      "event-a",
    ]);
  });

  it("routes aggregate events by the first field when producer ID is absent", async () => {
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      stateSchema: AggregateStateSchema,
      eventSchemas: [ProjectionStateSchema, AggregateStateSchema],
    });

    await storage.appendEvents("task-6", [
      createAggregateEvent("event-first-field", "task-6", 1, "created", {
        producerId: false,
      }),
    ]);

    expect((await storage.readHistory("task-6")).events.map((event) => event.id?.value)).toEqual([
      "event-first-field",
    ]);
  });

  it("rejects events that cannot be routed to an aggregate", async () => {
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      stateSchema: AggregateStateSchema,
      eventSchemas: [],
    });

    await expect(
      storage.appendEvents("task-7", [
        createAggregateEvent("event-unrouted", "task-7", 1, "changed", {
          producerId: false,
        }),
      ]),
    ).rejects.toThrow(/same aggregate ID/);
    await expect(
      storage.appendEvents("task-7", [
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-without-message" }),
          context: create(EventContextSchema, {
            version: create(VersionSchema, { number: 1 }),
          }),
        }),
      ]),
    ).rejects.toThrow(/same aggregate ID/);
  });

  it("routes first-field primitive IDs and rejects message-valued IDs", async () => {
    const storage = new AggregateStorage<typeof AggregateStateSchema, string | number | boolean>({
      context: { name: "Tasks", multitenant: false },
      storageFactory: new InMemoryStorageFactory(),
      stateSchema: AggregateStateSchema,
      eventSchemas: [ObjectIdEventSchema, NumberIdEventSchema, BooleanIdEventSchema],
    });

    await storage.appendEvents(42, [
      packEvent({
        id: create(EventIdSchema, { value: "event-number-id" }),
        context: create(EventContextSchema, {
          version: create(VersionSchema, { number: 1 }),
        }),
        schema: NumberIdEventSchema,
        message: create(NumberIdEventSchema, { id: 42 }),
      }),
    ]);
    await storage.appendEvents(true, [
      packEvent({
        id: create(EventIdSchema, { value: "event-boolean-id" }),
        context: create(EventContextSchema, {
          version: create(VersionSchema, { number: 1 }),
        }),
        schema: BooleanIdEventSchema,
        message: create(BooleanIdEventSchema, { id: true }),
      }),
    ]);

    expect((await storage.readHistory(42)).events.map((event) => event.id?.value)).toEqual([
      "event-number-id",
    ]);
    expect((await storage.readHistory(true)).events.map((event) => event.id?.value)).toEqual([
      "event-boolean-id",
    ]);
    await expect(
      storage.appendEvents("task-10", [
        packEvent({
          id: create(EventIdSchema, { value: "event-object-id" }),
          context: create(EventContextSchema, {
            version: create(VersionSchema, { number: 1 }),
          }),
          schema: ObjectIdEventSchema,
          message: create(ObjectIdEventSchema, {
            id: create(NestedIdSchema, { value: "task-10" }),
          }),
        }),
      ]),
    ).rejects.toThrow(/same aggregate ID/);
  });

  it("rejects duplicate versions already present in stored aggregate history", async () => {
    const context = { name: "Tasks", multitenant: false };
    const storageFactory = new SharedEventStorageFactory();
    const storage = new AggregateStorage({
      context,
      storageFactory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });
    const eventStore = new EventStore(context, storageFactory);

    await eventStore.appendAll([
      createAggregateEvent("event-duplicate-a", "task-8", 1),
      createAggregateEvent("event-duplicate-b", "task-8", 1),
    ]);

    await expect(storage.readHistory("task-8")).rejects.toThrow(/duplicate versions/);
  });

  it("fails closed for corrupted snapshot records", async () => {
    await expect(
      corruptStorage({
        typeUrl: "type.example/OtherRecord",
        value: new Uint8Array(),
      }).readHistory("task-9"),
    ).rejects.toThrow(/unexpected internal type URL/);

    await expect(
      corruptStorage({
        typeUrl: snapshotRecordTypeUrl,
        value: Buffer.from(JSON.stringify({ stateTypeUrl: AggregateStateSchema.typeName }), "utf8"),
      }).readHistory("task-9"),
    ).rejects.toThrow(/malformed/);

    await expect(
      corruptStorage({
        typeUrl: snapshotRecordTypeUrl,
        value: Buffer.from(
          JSON.stringify({
            stateTypeUrl: AggregateStateSchema.typeName,
            stateBase64: "",
            version: "1",
            archived: false,
            deleted: false,
          }),
          "utf8",
        ),
      }).readHistory("task-9"),
    ).rejects.toThrow(/malformed/);

    await expect(
      corruptStorage({
        typeUrl: snapshotRecordTypeUrl,
        value: Buffer.from(
          JSON.stringify({
            aggregateId: "other-task",
            stateTypeUrl: AggregateStateSchema.typeName,
            stateBase64: "",
            version: "1",
            archived: false,
            deleted: false,
          }),
          "utf8",
        ),
      }).readHistory("task-9"),
    ).rejects.toThrow(/unexpected ID/);

    await expect(
      corruptStorage({
        typeUrl: snapshotRecordTypeUrl,
        value: Buffer.from(
          JSON.stringify({
            aggregateId: "task-9",
            stateTypeUrl: "type.spine.io/example.OtherState",
            stateBase64: "",
            version: "1",
            archived: false,
            deleted: false,
          }),
          "utf8",
        ),
      }).readHistory("task-9"),
    ).rejects.toThrow(/unexpected state type/);
  });
});

function createAggregateEvent(
  id: string,
  aggregateId: string,
  version: number | undefined,
  name = "changed",
  options: { readonly producerId?: boolean } = {},
) {
  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId:
        options.producerId === false
          ? undefined
          : packAny(UserIdSchema, create(UserIdSchema, { value: aggregateId })),
      version: version === undefined ? undefined : create(VersionSchema, { number: version }),
    }),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: aggregateId,
      name,
      archived: false,
    }),
  });
}

function field(
  name: string,
  number: number,
  type: FieldDescriptorProto_Type,
  options: { readonly typeName?: string } = {},
) {
  const descriptor = {
    name,
    number,
    label: FieldDescriptorProto_Label.OPTIONAL,
    type,
  };
  return options.typeName === undefined
    ? descriptor
    : { ...descriptor, typeName: options.typeName };
}

const snapshotRecordTypeUrl = "type.spine-ts.dev/internal/AggregateSnapshotRecord";

function corruptStorage(
  record: Pick<Any, "typeUrl" | "value">,
): AggregateStorage<typeof AggregateStateSchema> {
  return new AggregateStorage({
    context: { name: "Tasks", multitenant: false },
    storageFactory: new CorruptSnapshotFactory(create(AnySchema, record)),
    stateSchema: AggregateStateSchema,
    eventSchemas: [AggregateStateSchema],
  });
}

class CorruptSnapshotFactory extends InMemoryStorageFactory {
  #firstStorage = true;

  constructor(readonly record: Any) {
    super();
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    if (this.#firstStorage) {
      this.#firstStorage = false;
      return new CorruptSnapshotStorage(context, recordSpec, this.record as unknown as R);
    }

    return new InMemoryRecordStorage(context, recordSpec);
  }
}

class SharedEventStorageFactory extends InMemoryStorageFactory {
  #eventStorage: RecordStorage<unknown, Message> | undefined;
  #openedSnapshotStorage = false;

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    if (!this.#openedSnapshotStorage) {
      this.#openedSnapshotStorage = true;
      return new InMemoryRecordStorage(context, recordSpec);
    }

    if (this.#eventStorage === undefined) {
      this.#eventStorage = new InMemoryRecordStorage(context, recordSpec);
    }

    return this.#eventStorage as RecordStorage<I, R>;
  }
}

class CorruptSnapshotStorage<I, R extends Message> extends RecordStorage<I, R> {
  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    readonly record: R,
  ) {
    super(context, recordSpec);
  }

  protected deleteRecord(): Promise<boolean> {
    return Promise.resolve(false);
  }

  protected queryRecords(): Promise<readonly R[]> {
    return Promise.resolve([this.record]);
  }

  protected readRecord(): Promise<R | undefined> {
    return Promise.resolve(this.record);
  }

  protected writeAllRecords(): Promise<void> {
    return Promise.resolve();
  }

  protected writeRecord(): Promise<void> {
    return Promise.resolve();
  }
}
