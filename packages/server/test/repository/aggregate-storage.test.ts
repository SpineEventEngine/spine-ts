import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { packAny, packEvent } from "@spine-ts/core";
import {
  EventContextSchema,
  EventIdSchema,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import { InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { AggregateStorage } from "../../src/index.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
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
});

function createAggregateEvent(
  id: string,
  aggregateId: string,
  version: number | undefined,
  name = "changed",
) {
  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: packAny(UserIdSchema, create(UserIdSchema, { value: aggregateId })),
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
