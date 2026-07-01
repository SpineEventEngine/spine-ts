import { create, type Message } from "@bufbuild/protobuf";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny, packEvent } from "@spine-ts/core";
import {
  EventContextSchema,
  EventIdSchema,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import { EventStore, InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { EventBus, type EventDispatcher } from "../../src/index.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

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
    throw new Error("Event bus fixture descriptor set is empty.");
  }

  return fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    imports,
  );
}

const fileEntityMetadataFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.main.descriptorSetBase64,
);
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;
const AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;

describe("EventBus", () => {
  it("appends events to EventStore before dispatching them", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      createEventDispatcher([ProjectionStateSchema], async (event) => {
        const stored = await store.read();

        observed.push(`stored:${stored[0]?.id?.value ?? "missing"}`);
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);

    await bus.post(createProjectionEvent("event-1"));

    expect(observed).toEqual(["stored:event-1", "dispatch:event-1"]);
  });

  it("posts events asynchronously to all matching dispatchers in registration order", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const first = createEventDispatcher([ProjectionStateSchema], (event) => {
      observed.push(`first:${event.id?.value ?? "missing"}`);
    });
    const second = createEventDispatcher([ProjectionStateSchema], (event) => {
      observed.push(`second:${event.id?.value ?? "missing"}`);
    });
    const other = createEventDispatcher([AggregateStateSchema], (event) => {
      observed.push(`other:${event.id?.value ?? "missing"}`);
    });
    const bus = new EventBus(store, [first, second, other]);

    const completion = bus.post(createProjectionEvent("event-2"));

    observed.push("after-post");
    expect(observed).toEqual(["after-post"]);

    await completion;

    expect(observed).toEqual(["after-post", "first:event-2", "second:event-2"]);
  });

  it("rejects posting events without a registered dispatcher after storing them", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);
    const event = createProjectionEvent("event-3");

    await expect(bus.post(event)).rejects.toThrow(
      `No event dispatcher registered for "${deriveTypeUrl(ProjectionStateSchema)}".`,
    );
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-3" } }]);
  });
});

function createEventDispatcher(
  schemas: readonly GenMessage<Message>[],
  onDispatch: (event: ReturnType<typeof createProjectionEvent>) => void | Promise<void>,
): EventDispatcher {
  return {
    messageSchemas: () => schemas,
    dispatch: (event) => Promise.resolve(onDispatch(event)),
  };
}

function createProjectionEvent(id: string) {
  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: packAny(UserIdSchema, create(UserIdSchema, { value: "aggregate-1" })),
      version: create(VersionSchema, { number: 1 }),
    }),
    schema: ProjectionStateSchema,
    message: create(ProjectionStateSchema, {
      id: "task-1",
      name: "Task",
      priority: 1,
    }),
  });
}
