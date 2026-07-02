import { create, type Message } from "@bufbuild/protobuf";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
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

  it("stores events without a registered dispatcher and resolves", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);
    const event = createProjectionEvent("event-3");

    await expect(bus.post(event)).resolves.toBeUndefined();
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-3" } }]);
  });

  it("does not invoke dispatchers when EventStore append fails", async () => {
    const observed: string[] = [];
    const store = {
      accept: () => Promise.resolve(),
      append: () => Promise.reject(new Error("append failed")),
    } as unknown as EventStore;
    const bus = new EventBus(store, [
      createEventDispatcher([ProjectionStateSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);

    await expect(bus.post(createProjectionEvent("event-4"))).rejects.toThrow("append failed");

    expect(observed).toEqual([]);
  });

  it("validates matching dispatchers before storing events", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store, [
      {
        messageSchemas: () => [ProjectionStateSchema],
        accept: () => Promise.reject(new Error("event rejected")),
        dispatch: () => Promise.resolve(),
      },
    ]);

    await expect(bus.post(createProjectionEvent("event-rejected"))).rejects.toThrow(
      "event rejected",
    );
    await expect(store.read()).resolves.toEqual([]);
  });

  it("validates event-store identity before dispatcher acceptance", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      {
        messageSchemas: () => [ProjectionStateSchema],
        accept: () => {
          observed.push("accept");
          return Promise.resolve();
        },
        dispatch: () => Promise.resolve(),
      },
    ]);
    const event = createProjectionEvent("event-blank-id");
    event.id = create(EventIdSchema);

    await expect(bus.post(event)).rejects.toThrow(/non-empty event\.id\.value/);

    expect(observed).toEqual([]);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("stores events after pre-store validation succeeds", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      {
        messageSchemas: () => [ProjectionStateSchema],
        accept: (event) => {
          observed.push(`accept:${event.id?.value ?? "missing"}`);
          return Promise.resolve();
        },
        dispatch: (event) => {
          observed.push(`dispatch:${event.id?.value ?? "missing"}`);
          return Promise.resolve();
        },
      },
    ]);

    await bus.post(createProjectionEvent("event-accepted"));

    expect(observed).toEqual(["accept:event-accepted", "dispatch:event-accepted"]);
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-accepted" } }]);
  });

  it("can retry registering a dispatcher after message schema collection fails", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    let attempts = 0;
    const dispatcher: EventDispatcher = {
      messageSchemas: () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error("schema read failed");
        }
        return [ProjectionStateSchema];
      },
      dispatch: (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
        return Promise.resolve();
      },
    };
    const bus = new EventBus(store);

    expect(() => bus.register(dispatcher)).toThrow("schema read failed");
    expect(bus.register(dispatcher)).toBe(dispatcher);

    await bus.post(createProjectionEvent("event-5"));

    expect(observed).toEqual(["dispatch:event-5"]);
  });

  it("does not register the same event dispatcher twice during reentrant schema collection", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store);
    let reentered = false;
    const dispatcher: EventDispatcher = {
      messageSchemas: () => {
        if (!reentered) {
          reentered = true;
          bus.register(dispatcher);
        }
        return [ProjectionStateSchema];
      },
      dispatch: (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
        return Promise.resolve();
      },
    };

    bus.register(dispatcher);
    await bus.post(createProjectionEvent("event-6"));

    expect(observed).toEqual(["dispatch:event-6"]);
  });

  it("rejects nested posts from active event dispatch", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const context: { bus?: EventBus } = {};
    const dispatcher = createEventDispatcher([ProjectionStateSchema], async (event) => {
      observed.push(`outer:${event.id?.value ?? "missing"}`);
      await expect(context.bus?.post(createProjectionEvent("event-nested"))).rejects.toThrow(
        "Cannot enqueue runtime work from an active runtime work item.",
      );
      observed.push("after-rejection");
    });
    const bus = new EventBus(store, [dispatcher]);
    context.bus = bus;

    await bus.post(createProjectionEvent("event-7"));

    expect(observed).toEqual(["outer:event-7", "after-rejection"]);
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
