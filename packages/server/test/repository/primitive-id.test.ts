import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  BoolValueSchema,
  DoubleValueSchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { packAny, packEvent } from "@spine-ts/core";
import { EventContextSchema, EventIdSchema, UserIdSchema, VersionSchema } from "@spine-ts/proto";
import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { AggregateStorage } from "../../src/index.js";
import { MessageIds, PrimitiveIds } from "../../src/repository/primitive-id.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

function createFixtureFileDescriptor(descriptorSetBase64: string) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Primitive ID fixture descriptor set is empty.");
  }

  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"));
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;

describe("primitive aggregate IDs", () => {
  it("packs and unpacks primitive ID values directly", () => {
    expect(PrimitiveIds.unpack(PrimitiveIds.pack("task-primitive"))).toBe("task-primitive");
    expect(PrimitiveIds.unpack(PrimitiveIds.pack(42))).toBe(42);
    expect(PrimitiveIds.unpack(PrimitiveIds.pack(true))).toBe(true);
    expect(PrimitiveIds.unpack(undefined)).toBeUndefined();
  });

  it("reads only finite primitive message ID values", () => {
    expect(MessageIds.read({ $typeName: "example.TaskId", value: "task-1" })).toEqual({
      $typeName: "example.TaskId",
      value: "task-1",
    });
    expect(
      MessageIds.read({ $typeName: "example.TaskId", value: Number.POSITIVE_INFINITY }),
    ).toBeUndefined();
    expect(MessageIds.read({ $typeName: "example.TaskId" })).toBeUndefined();
    expect(MessageIds.read({ $typeName: 1, value: "task-1" })).toBeUndefined();
  });

  it("routes string, number, and boolean producer IDs through aggregate storage", async () => {
    const factory = new InMemoryStorageFactory();
    const storage = new AggregateStorage<typeof AggregateStateSchema, string | number | boolean>({
      context: { name: "PrimitiveIds", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [],
    });

    await storage.appendEvents("task-primitive", [
      createAggregateEvent("event-string", "task-primitive", "String", 1),
    ]);
    await storage.appendEvents(42, [createAggregateEvent("event-number", 42, "Number", 1)]);
    await storage.appendEvents(true, [createAggregateEvent("event-boolean", true, "Boolean", 1)]);

    await expect(storage.readHistory("task-primitive")).resolves.toMatchObject({
      events: [{ id: { value: "event-string" } }],
    });
    await expect(storage.readHistory(42)).resolves.toMatchObject({
      events: [{ id: { value: "event-number" } }],
    });
    await expect(storage.readHistory(true)).resolves.toMatchObject({
      events: [{ id: { value: "event-boolean" } }],
    });
  });

  it("routes legacy user ID producer IDs and rejects unreadable producer IDs", async () => {
    const factory = new InMemoryStorageFactory();
    const storage = new AggregateStorage({
      context: { name: "PrimitiveLegacyIds", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [],
    });

    await storage.appendEvents("user-task", [
      createAggregateEvent("event-user-id", "user-task", "User", 1, "user"),
    ]);

    await expect(storage.readHistory("user-task")).resolves.toMatchObject({
      events: [{ id: { value: "event-user-id" } }],
    });
    await expect(
      storage.appendEvents("unreadable-task", [
        createAggregateEvent("event-unreadable", "unreadable-task", "Unreadable", 1, "state"),
      ]),
    ).rejects.toThrow("readable producer ID");
  });
});

function createAggregateEvent(
  id: string,
  aggregateId: string | number | boolean,
  name: string,
  version: number,
  producerIdKind: "primitive" | "user" | "state" = "primitive",
) {
  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: producerId(producerIdKind, aggregateId),
      version: create(VersionSchema, { number: version }),
    }),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: String(aggregateId),
      name,
      archived: false,
    }),
  });
}

function producerId(kind: "primitive" | "user" | "state", id: string | number | boolean) {
  if (kind === "user") {
    return packAny(UserIdSchema, create(UserIdSchema, { value: String(id) }));
  }
  if (kind === "state") {
    return packAny(
      AggregateStateSchema,
      create(AggregateStateSchema, {
        id: String(id),
        name: "Unreadable",
        archived: false,
      }),
    );
  }

  switch (typeof id) {
    case "string":
      return packAny(StringValueSchema, create(StringValueSchema, { value: id }));
    case "number":
      return packAny(DoubleValueSchema, create(DoubleValueSchema, { value: id }));
    case "boolean":
      return packAny(BoolValueSchema, create(BoolValueSchema, { value: id }));
  }
}
