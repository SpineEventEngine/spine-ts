import { create, type Message } from "@bufbuild/protobuf";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny, packEvent } from "@spine-ts/core";
import {
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  type Event,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import { EventStore, InMemoryStorageFactory, type OnEventAccepted } from "@spine-ts/storage";
import { describe, expect, it } from "vitest";

import { EventBus, type EventDispatcher } from "../../src/index.js";
import { eventBusAccess } from "../../src/bus/event-bus.js";
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

  it("rejects events without a message", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);

    await expect(
      bus.post(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-without-message" }),
        }),
      ),
    ).rejects.toThrow(/event.message.typeUrl/);
  });

  it("rejects events with a blank message type URL", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const event = createProjectionEvent("event-blank-message");
    const bus = new EventBus(store);

    if (event.message !== undefined) {
      event.message.typeUrl = "";
    }

    await expect(bus.post(event)).rejects.toThrow(/event.message.typeUrl/);
  });

  it("does not invoke dispatchers when EventStore append fails", async () => {
    const observed: string[] = [];
    const store = {
      acceptThenAppend: async (event: Event, onAccepted: OnEventAccepted) => {
        await onAccepted(event);
        throw new Error("append failed");
      },
    } as unknown as EventStore;
    const bus = new EventBus(store, [
      createEventDispatcher([ProjectionStateSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);

    await expect(bus.post(createProjectionEvent("event-4"))).rejects.toThrow("append failed");

    expect(observed).toEqual([]);
  });

  it("uses one tenant context snapshot for acceptance and append", async () => {
    let currentTenantId = "tenant-a";
    const store = new EventStore(
      {
        name: "Tasks",
        multitenant: true,
        get tenantId() {
          return currentTenantId;
        },
      },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store, [
      {
        messageSchemas: () => [ProjectionStateSchema],
        accept: () => {
          currentTenantId = "tenant-b";
          return Promise.resolve();
        },
        dispatch: () => Promise.resolve(),
      },
    ]);

    await bus.post(createProjectionEvent("event-tenant-captured"));

    currentTenantId = "tenant-a";
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-tenant-captured" } }]);
    currentTenantId = "tenant-b";
    await expect(store.read()).resolves.toEqual([]);
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

  it("deduplicates repeated schemas from one event dispatcher", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      createEventDispatcher([ProjectionStateSchema, ProjectionStateSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);

    await bus.post(createProjectionEvent("event-deduplicated"));

    expect(observed).toEqual(["dispatch:event-deduplicated"]);
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

  it("dispatches already stored events without appending them again", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      createEventDispatcher([ProjectionStateSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);
    const event = createProjectionEvent("event-stored-dispatch");

    await store.append(event);
    await eventBusAccess.postStored(bus, event);

    expect(observed).toEqual(["dispatch:event-stored-dispatch"]);
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-stored-dispatch" } }]);
  });

  it("notifies direct event subscribers after stored-event dispatch", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      createEventDispatcher([ProjectionStateSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);
    const subscription = eventBusAccess.subscribe(bus, deriveTypeUrl(ProjectionStateSchema), {
      onEvent: (event) => {
        observed.push(`event:${event.id?.value ?? "missing"}`);
      },
    });

    await bus.post(createProjectionEvent("event-subscribed"));

    expect(subscription.closed).toBe(false);
    expect(observed).toEqual(["dispatch:event-subscribed", "event:event-subscribed"]);

    subscription.unsubscribe();
    await bus.post(createProjectionEvent("event-after-unsubscribe"));

    expect(subscription.closed).toBe(true);
    expect(observed).toEqual([
      "dispatch:event-subscribed",
      "event:event-subscribed",
      "dispatch:event-after-unsubscribe",
    ]);
  });

  it("isolates direct event subscriber failures and snapshots fanout", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      createEventDispatcher([ProjectionStateSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);
    const typeUrl = deriveTypeUrl(ProjectionStateSchema);
    const secondSubscription: { current?: { unsubscribe(): void } } = {};

    eventBusAccess.subscribe(bus, typeUrl, {
      onEvent: (event) => {
        observed.push(`first:${event.id?.value ?? "missing"}`);
        secondSubscription.current?.unsubscribe();
        eventBusAccess.subscribe(bus, typeUrl, {
          onEvent: (nested) => {
            observed.push(`late:${nested.id?.value ?? "missing"}`);
          },
        });
        throw new Error("subscriber failed");
      },
    });
    secondSubscription.current = eventBusAccess.subscribe(bus, typeUrl, {
      onEvent: (event) => {
        observed.push(`second:${event.id?.value ?? "missing"}`);
      },
    });

    await expect(bus.post(createProjectionEvent("event-snapshot"))).resolves.toBeUndefined();

    expect(observed).toEqual([
      "dispatch:event-snapshot",
      "first:event-snapshot",
      "second:event-snapshot",
    ]);
  });

  it("closes direct event subscribers when the bus closes", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      createEventDispatcher([ProjectionStateSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);
    const subscription = eventBusAccess.subscribe(bus, deriveTypeUrl(ProjectionStateSchema), {
      onEvent: (event) => {
        observed.push(`event:${event.id?.value ?? "missing"}`);
      },
    });

    await bus.close();
    subscription.unsubscribe();

    expect(subscription.closed).toBe(true);
    expect(observed).toEqual([]);
  });

  it("rejects direct event subscribers after close begins", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);
    const closing = bus.close();

    expect(() =>
      eventBusAccess.subscribe(bus, deriveTypeUrl(ProjectionStateSchema), {
        onEvent: () => undefined,
      }),
    ).toThrow(/closed/i);

    await closing;

    expect(() =>
      eventBusAccess.subscribe(bus, deriveTypeUrl(ProjectionStateSchema), {
        onEvent: () => undefined,
      }),
    ).toThrow(/closed/i);
  });

  it("rejects internal event-bus access for non-event-bus values", () => {
    const notBus = {} as EventBus;

    expect(() =>
      eventBusAccess.subscribe(notBus, deriveTypeUrl(ProjectionStateSchema), {
        onEvent: () => undefined,
      }),
    ).toThrow("Event subscription requires an EventBus instance.");
    expect(() => eventBusAccess.eventSchemas(notBus)).toThrow(
      "Event schema listing requires an EventBus instance.",
    );
  });

  it("runs accept hooks before dispatching already stored events", async () => {
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
    const event = createProjectionEvent("event-stored-accepted");

    await store.append(event);
    await eventBusAccess.postStored(bus, event);

    expect(observed).toEqual(["accept:event-stored-accepted", "dispatch:event-stored-accepted"]);
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-stored-accepted" } }]);
  });

  it("isolates already-stored accept failures to the delivery job", async () => {
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
          return Promise.reject(new Error("stored accept failed"));
        },
        dispatch: (event) => {
          observed.push(`dispatch:${event.id?.value ?? "missing"}`);
          return Promise.resolve();
        },
      },
    ]);
    const event = createProjectionEvent("event-stored-accept-failure");

    await store.append(event);
    await expect(eventBusAccess.postStored(bus, event)).rejects.toThrow("stored accept failed");

    expect(observed).toEqual(["accept:event-stored-accept-failure"]);
    await expect(store.read()).resolves.toMatchObject([
      { id: { value: "event-stored-accept-failure" } },
    ]);
  });

  it("rejects malformed already stored events before dispatcher lookup", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);

    await expect(
      eventBusAccess.postStored(
        bus,
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-stored-malformed" }),
        }),
      ),
    ).rejects.toThrow(/event.message.typeUrl/);
  });

  it("drains stored follow-up dispatch scheduled by active event work during close", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    let releaseDispatcher!: () => void;
    const dispatcherCanFinish = new Promise<void>((resolve) => {
      releaseDispatcher = resolve;
    });
    const context: { bus?: EventBus; resolveDispatchStarted?: () => void } = {};
    const dispatcher = createEventDispatcher([ProjectionStateSchema], async (event) => {
      observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      context.resolveDispatchStarted?.();
      await dispatcherCanFinish;
      if (event.id?.value === "event-close-source" && context.bus !== undefined) {
        await store.append(createProjectionEvent("event-close-follow-up"));
        void eventBusAccess.postStoredFollowUp(
          context.bus,
          createProjectionEvent("event-close-follow-up"),
        );
      }
    });
    const bus = new EventBus(store, [dispatcher]);
    context.bus = bus;
    const activeDispatchStarted = new Promise<void>((resolve) => {
      context.resolveDispatchStarted = resolve;
    });

    const post = bus.post(createProjectionEvent("event-close-source"));
    await activeDispatchStarted;

    const close = bus.close().then(() => "closed");

    await expect(Promise.race([close, delay(25)])).resolves.toBe("pending");

    releaseDispatcher();
    await expect(post).resolves.toBeUndefined();
    await expect(close).resolves.toBe("closed");

    expect(observed).toEqual(["dispatch:event-close-source", "dispatch:event-close-follow-up"]);
  });

  it("rejects public and internal event intake after close", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);

    await bus.close();
    await bus.close();

    await expect(bus.post(createProjectionEvent("event-after-close"))).rejects.toThrow(/closed/);
    await expect(
      eventBusAccess.postStored(bus, createProjectionEvent("event-stored-after-close")),
    ).rejects.toThrow(/closed/);
    await expect(
      eventBusAccess.postStoredFollowUp(bus, createProjectionEvent("event-follow-up-after-close")),
    ).rejects.toThrow(/closed/);
  });

  it("rejects stored-event dispatch for non-event-bus values", () => {
    expect(() =>
      eventBusAccess.postStored({} as EventBus, createProjectionEvent("event-wrong-bus")),
    ).toThrow(/EventBus instance/);
  });

  it("rejects exclusive framework work for non-event-bus values", () => {
    expect(() => eventBusAccess.runExclusive({} as EventBus, () => "unused")).toThrow(
      /EventBus instance/,
    );
  });

  it("rejects internal close coordination for non-event-bus values", () => {
    const bus = {} as EventBus;

    expect(() =>
      eventBusAccess.postStoredFollowUp(bus, createProjectionEvent("event-follow-up")),
    ).toThrow(/EventBus instance/);
    expect(() => {
      eventBusAccess.beginClose(bus);
    }).toThrow(/EventBus instance/);
    expect(() => eventBusAccess.drain(bus)).toThrow(/EventBus instance/);
    expect(() => eventBusAccess.finishClose(bus)).toThrow(/EventBus instance/);
    expect(() => eventBusAccess.acceptedWorkCount(bus)).toThrow(/EventBus instance/);
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

function delay(ms: number): Promise<"pending"> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("pending");
    }, ms);
  });
}
