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

import { create, type Message } from "@bufbuild/protobuf";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { TypeUrls, AnyMessages, SignalEnvelopes } from "@spine-event-engine/core";
import {
  ActorContextSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  type Event,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-event-engine/proto";
import {
  EventStore,
  InMemoryStorageFactory,
  type OnEventAccepted,
} from "@spine-event-engine/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EventBus, type EventDispatcher } from "../../src/index.js";
import type { ILogLayer } from "loglayer";
import { eventBusAccess } from "../../src/bus/event-bus.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { tenant } from "../tenant-fixture.js";

const validationChecks = vi.hoisted(() => vi.fn());

vi.mock("@spine-event-engine/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@spine-event-engine/core")>();

  return {
    ...actual,
    Validate: {
      ...actual.Validate,
      check: (...args: Parameters<typeof actual.Validate.check>) => {
        validationChecks(...args);
        return actual.Validate.check(...args);
      },
    },
  };
});

type TaskEvent = Message<"TaskEvent"> & {
  id: string;
  name: string;
};

type ReviewStarted = Message<"ReviewStarted"> & {
  id: string;
};

type ValidatedTaskEvent = Message<"spine.server.testing.handlerregistry.ValidatedTaskEvent"> & {
  id: string;
  name: string;
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

const fileHandlerRegistryEventsFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.handlerRegistryEvents.descriptorSetBase64,
);
const TaskEventSchema = messageDesc(fileHandlerRegistryEventsFixture, 1) as GenMessage<TaskEvent>;
const ReviewStartedSchema = messageDesc(
  fileHandlerRegistryEventsFixture,
  0,
) as GenMessage<ReviewStarted>;
const ValidatedTaskEventSchema = messageDesc(
  fileHandlerRegistryEventsFixture,
  2,
) as GenMessage<ValidatedTaskEvent>;

describe("EventBus", () => {
  afterEach(() => {
    validationChecks.mockReset();
  });

  it("appends events to EventStore before dispatching them", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      createEventDispatcher([TaskEventSchema], async (event) => {
        const stored = await store.read();

        observed.push(`stored:${stored[0]?.id?.value ?? "missing"}`);
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);

    await bus.post(createTaskEvent("event-1"));

    expect(observed).toEqual(["stored:event-1", "dispatch:event-1"]);
  });

  it("posts events asynchronously to all matching dispatchers in registration order", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const first = createEventDispatcher([TaskEventSchema], (event) => {
      observed.push(`first:${event.id?.value ?? "missing"}`);
    });
    const second = createEventDispatcher([TaskEventSchema], (event) => {
      observed.push(`second:${event.id?.value ?? "missing"}`);
    });
    const other = createEventDispatcher([ReviewStartedSchema], (event) => {
      observed.push(`other:${event.id?.value ?? "missing"}`);
    });
    const bus = new EventBus(store, [first, second, other]);

    const completion = bus.post(createTaskEvent("event-2"));

    observed.push("after-post");
    expect(observed).toEqual(["after-post"]);

    await completion;

    expect(observed).toEqual(["after-post", "first:event-2", "second:event-2"]);
  });

  it("rejects fresh events without a registered schema before storing them", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);
    const event = createTaskEvent("event-3");

    await expect(bus.post(event)).rejects.toThrow(/No event schema registered/);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("stores valid events registered without a dispatcher", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);

    eventBusAccess.registerSchemas(bus, [TaskEventSchema]);

    await expect(bus.post(createTaskEvent("event-schema-only"))).resolves.toBeUndefined();
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-schema-only" } }]);
  });

  it("unregisters only target origin routes while preserving admission and unrelated dispatchers", async () => {
    const bus = eventBusAccess.createForgettingBus();
    const target = createEventDispatcher([TaskEventSchema, ReviewStartedSchema], () =>
      Promise.resolve(),
    );
    target.externalEventSchemas = () => [TaskEventSchema];
    const unrelated = createEventDispatcher([TaskEventSchema], () => Promise.resolve());
    unrelated.externalEventSchemas = () => [TaskEventSchema];
    const seen: string[] = [];
    target.dispatch = () => {
      seen.push("target");
      return Promise.resolve();
    };
    unrelated.dispatch = () => {
      seen.push("unrelated");
      return Promise.resolve();
    };
    bus.register(target);
    bus.register(unrelated);
    eventBusAccess.registerSchemas(bus, [ReviewStartedSchema]);
    eventBusAccess.unregister(bus, target);
    eventBusAccess.unregister(bus, target);
    const external = createTaskEvent("external-route");
    external.context = create(EventContextSchema, { external: true });
    await bus.post(external);
    await bus.post(
      SignalEnvelopes.event({
        context: create(EventContextSchema),
        schema: ReviewStartedSchema,
        message: create(ReviewStartedSchema, { id: "domestic-route" }),
      }),
    );
    expect(seen).toEqual(["unrelated"]);
    expect(eventBusAccess.schema(bus, TypeUrls.derive(TaskEventSchema))).toBe(TaskEventSchema);
    expect(eventBusAccess.schema(bus, TypeUrls.derive(ReviewStartedSchema))).toBe(
      ReviewStartedSchema,
    );
  });

  it("rejects system schemas from a domain bus before EventStore access", () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);

    expect(() => {
      eventBusAccess.registerSchemas(bus, [EntityLog.EntityStateChangedSchema]);
    }).toThrow(
      'Domain EventBus rejects system event schema "type.spine.system.server.EntityStateChanged".',
    );
  });

  it("accepts only system schemas on an internally assembled system bus", () => {
    const bus = eventBusAccess.createSystemBus(undefined);

    expect(() => {
      eventBusAccess.registerSchemas(bus, [EntityLog.EntityStateChangedSchema]);
    }).not.toThrow();
    expect(() => {
      eventBusAccess.registerSchemas(bus, [TaskEventSchema]);
    }).toThrow(
      'System EventBus rejects domain event schema "type.spine.server.testing.handlerregistry.TaskEvent".',
    );
  });

  it("rejects untyped construction without an EventStore", () => {
    expect(() => new EventBus(undefined as never)).toThrow("EventBus requires an EventStore.");
  });

  it("forgets events across assembly, posting, and close without event storage", async () => {
    const observed: string[] = [];
    const storage = observeEventStoreAccess();
    validationChecks.mockImplementation(() => {
      observed.push("validate");
    });
    const bus = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [ValidatedTaskEventSchema],
        accept: () => {
          observed.push("accept");
          return Promise.resolve();
        },
        dispatch: () => {
          observed.push("dispatch");
          return Promise.resolve();
        },
      },
    ]);
    eventBusAccess.subscribe(bus, TypeUrls.derive(ValidatedTaskEventSchema), {
      onEvent: (event) => {
        observed.push(`subscriber:${event.id?.value ?? "missing"}`);
      },
    });

    await bus.post(createValidatedEvent("event-forgotten", "name"));
    await bus.close();

    expect(observed).toEqual(["validate", "accept", "dispatch", "subscriber:event-forgotten"]);
    expect(validationChecks).toHaveBeenCalledTimes(1);
    storage.expectNoAccess();
    storage.restore();
  });

  it("stops forgotten events after validation failure without event storage", async () => {
    const observed: string[] = [];
    const storage = observeEventStoreAccess();
    validationChecks.mockImplementation(() => {
      observed.push("validate");
    });
    const bus = eventBusAccess.createForgettingBus([
      createEventDispatcher([ValidatedTaskEventSchema], () => {
        observed.push("dispatch");
      }),
    ]);
    eventBusAccess.subscribe(bus, TypeUrls.derive(ValidatedTaskEventSchema), {
      onEvent: () => {
        observed.push("subscriber");
      },
    });

    await expect(bus.post(createValidatedEvent("event-forgotten-invalid", ""))).rejects.toThrow();
    await bus.close();

    expect(observed).toEqual(["validate"]);
    storage.expectNoAccess();
    storage.restore();
  });

  it("stops forgotten events after admission failure without event storage", async () => {
    const observed: string[] = [];
    const storage = observeEventStoreAccess();
    validationChecks.mockImplementation(() => {
      observed.push("validate");
    });
    const bus = eventBusAccess.createForgettingBus([
      {
        messageSchemas: () => [ValidatedTaskEventSchema],
        accept: () => {
          observed.push("accept");
          return Promise.reject(new Error("admission failed"));
        },
        dispatch: () => {
          observed.push("dispatch");
          return Promise.resolve();
        },
      },
    ]);
    eventBusAccess.subscribe(bus, TypeUrls.derive(ValidatedTaskEventSchema), {
      onEvent: () => {
        observed.push("subscriber");
      },
    });

    await expect(
      bus.post(createValidatedEvent("event-forgotten-rejected", "name")),
    ).rejects.toThrow("admission failed");
    await bus.close();

    expect(observed).toEqual(["validate", "accept"]);
    storage.expectNoAccess();
    storage.restore();
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
    const event = createTaskEvent("event-blank-message");
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
      createEventDispatcher([TaskEventSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);

    await expect(bus.post(createTaskEvent("event-4"))).rejects.toThrow("append failed");

    expect(observed).toEqual([]);
  });

  it("uses one event-envelope tenant snapshot for acceptance and append", async () => {
    const factory = new InMemoryStorageFactory();
    const store = new EventStore({ name: "Tasks", multitenant: true }, factory);
    const event = createTaskEvent("event-tenant-captured");
    if (event.context === undefined) throw new Error("Expected generated event context.");
    event.context.origin = {
      case: "importContext",
      value: create(ActorContextSchema, { tenantId: tenant("tenant-a") }),
    };
    const bus = new EventBus(store, [
      {
        messageSchemas: () => [TaskEventSchema],
        accept: () => {
          if (event.context === undefined) throw new Error("Expected generated event context.");
          event.context.origin = {
            case: "importContext",
            value: create(ActorContextSchema, { tenantId: tenant("tenant-b") }),
          };
          return Promise.resolve();
        },
        dispatch: () => Promise.resolve(),
      },
    ]);

    await bus.post(event);

    await expect(
      new EventStore(
        { name: "Tasks", multitenant: true, tenantId: tenant("tenant-a") },
        factory,
      ).read(),
    ).resolves.toMatchObject([{ id: { value: "event-tenant-captured" } }]);
    await expect(
      new EventStore(
        { name: "Tasks", multitenant: true, tenantId: tenant("tenant-b") },
        factory,
      ).read(),
    ).resolves.toEqual([]);
  });

  it("validates matching dispatchers before storing events", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store, [
      {
        messageSchemas: () => [TaskEventSchema],
        accept: () => Promise.reject(new Error("event rejected")),
        dispatch: () => Promise.resolve(),
      },
    ]);

    await expect(bus.post(createTaskEvent("event-rejected"))).rejects.toThrow("event rejected");
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
        messageSchemas: () => [TaskEventSchema],
        accept: () => {
          observed.push("accept");
          return Promise.resolve();
        },
        dispatch: () => Promise.resolve(),
      },
    ]);
    const event = createTaskEvent("event-blank-id");
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
    let acceptedSnapshot: Event | undefined;
    const bus = new EventBus(store, [
      {
        messageSchemas: () => [TaskEventSchema],
        accept: (event) => {
          acceptedSnapshot = event;
          observed.push(`accept:${event.id?.value ?? "missing"}`);
          return Promise.resolve();
        },
        dispatch: (event) => {
          expect(event).toBe(acceptedSnapshot);
          observed.push(`dispatch:${event.id?.value ?? "missing"}`);
          return Promise.resolve();
        },
      },
    ]);

    await bus.post(createTaskEvent("event-accepted"));

    expect(observed).toEqual(["accept:event-accepted", "dispatch:event-accepted"]);
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-accepted" } }]);
  });

  it("rejects invalid events before every normal event intake boundary", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      {
        messageSchemas: () => [ValidatedTaskEventSchema],
        accept: () => {
          observed.push("accept");
          return Promise.resolve();
        },
        dispatch: () => {
          observed.push("dispatch");
          return Promise.resolve();
        },
      },
    ]);
    const typeUrl = TypeUrls.derive(ValidatedTaskEventSchema);
    eventBusAccess.subscribe(bus, typeUrl, {
      onEvent: () => {
        observed.push("subscriber");
      },
    });

    await expect(bus.post(createValidatedEvent("event-invalid-post", ""))).rejects.toThrow();
    expect(validationChecks).toHaveBeenCalledTimes(1);
    validationChecks.mockClear();

    let followUp!: Promise<void>;
    await eventBusAccess.runExclusive(bus, () => {
      followUp = eventBusAccess.postFollowUp(
        bus,
        createValidatedEvent("event-invalid-follow-up", ""),
      );
    });
    await expect(followUp).rejects.toThrow();
    expect(validationChecks).toHaveBeenCalledTimes(1);
    validationChecks.mockClear();

    await expect(
      eventBusAccess.postStored(bus, createValidatedEvent("event-invalid-stored", "")),
    ).rejects.toThrow();
    expect(validationChecks).toHaveBeenCalledTimes(1);
    validationChecks.mockClear();

    let storedFollowUp!: Promise<void>;
    await eventBusAccess.runExclusive(bus, () => {
      storedFollowUp = eventBusAccess.postStoredFollowUp(
        bus,
        createValidatedEvent("event-invalid-stored-follow-up", ""),
      );
    });
    await expect(storedFollowUp).rejects.toThrow();

    expect(validationChecks).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([]);
    await expect(store.read()).resolves.toEqual([]);
  });

  it("validates each admitted event once at every intake boundary", async () => {
    const observed: string[] = [];
    const store = {
      acceptThenAppend: async (event: Event, onAccepted: OnEventAccepted) => {
        observed.push(`store:${event.id?.value ?? "missing"}`);
        await onAccepted(event);
        observed.push(`append:${event.id?.value ?? "missing"}`);
        return event;
      },
    } as unknown as EventStore;
    validationChecks.mockImplementation(() => {
      observed.push("validate");
    });
    const bus = new EventBus(store, [
      {
        messageSchemas: () => [ValidatedTaskEventSchema],
        accept: () => {
          observed.push("accept");
          return Promise.resolve();
        },
        dispatch: () => {
          observed.push("dispatch");
          return Promise.resolve();
        },
      },
    ]);

    await bus.post(createValidatedEvent("event-valid-post", "name"));
    expect(validationChecks).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([
      "store:event-valid-post",
      "validate",
      "accept",
      "append:event-valid-post",
      "dispatch",
    ]);

    validationChecks.mockClear();
    observed.length = 0;
    let followUp!: Promise<void>;
    await eventBusAccess.runExclusive(bus, () => {
      followUp = eventBusAccess.postFollowUp(
        bus,
        createValidatedEvent("event-valid-follow-up", "name"),
      );
    });
    await followUp;
    expect(validationChecks).toHaveBeenCalledTimes(1);
    expect(observed).toEqual([
      "store:event-valid-follow-up",
      "validate",
      "accept",
      "append:event-valid-follow-up",
      "dispatch",
    ]);

    validationChecks.mockClear();
    observed.length = 0;
    await eventBusAccess.postStored(bus, createValidatedEvent("event-valid-stored", "name"));
    expect(validationChecks).toHaveBeenCalledTimes(1);
    expect(observed).toEqual(["validate", "accept", "dispatch"]);

    validationChecks.mockClear();
    observed.length = 0;
    let storedFollowUp!: Promise<void>;
    await eventBusAccess.runExclusive(bus, () => {
      storedFollowUp = eventBusAccess.postStoredFollowUp(
        bus,
        createValidatedEvent("event-valid-stored-follow-up", "name"),
      );
    });
    await storedFollowUp;
    expect(validationChecks).toHaveBeenCalledTimes(1);
    expect(observed).toEqual(["validate", "accept", "dispatch"]);
  });

  it("validates an admitted event once before storing and dispatching it", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      {
        messageSchemas: () => [ValidatedTaskEventSchema],
        accept: () => {
          observed.push("accept");
          return Promise.resolve();
        },
        dispatch: () => {
          observed.push("dispatch");
          return Promise.resolve();
        },
      },
    ]);

    await bus.post(createValidatedEvent("event-valid", "name"));

    expect(validationChecks).toHaveBeenCalledTimes(1);
    expect(observed).toEqual(["accept", "dispatch"]);
    await expect(store.read()).resolves.toMatchObject([{ id: { value: "event-valid" } }]);
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
        return [TaskEventSchema];
      },
      dispatch: (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
        return Promise.resolve();
      },
    };
    const bus = new EventBus(store);

    expect(() => bus.register(dispatcher)).toThrow("schema read failed");
    expect(bus.register(dispatcher)).toBe(dispatcher);

    await bus.post(createTaskEvent("event-5"));

    expect(observed).toEqual(["dispatch:event-5"]);
  });

  it("deduplicates repeated schemas from one event dispatcher", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      createEventDispatcher([TaskEventSchema, TaskEventSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);

    await bus.post(createTaskEvent("event-deduplicated"));

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
        return [TaskEventSchema];
      },
      dispatch: (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
        return Promise.resolve();
      },
    };

    bus.register(dispatcher);
    await bus.post(createTaskEvent("event-6"));

    expect(observed).toEqual(["dispatch:event-6"]);
  });

  it("dispatches already stored events without appending them again", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      createEventDispatcher([TaskEventSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);
    const event = createTaskEvent("event-stored-dispatch");

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
      createEventDispatcher([TaskEventSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);
    const subscription = eventBusAccess.subscribe(bus, TypeUrls.derive(TaskEventSchema), {
      onEvent: (event) => {
        observed.push(`event:${event.id?.value ?? "missing"}`);
      },
    });

    await bus.post(createTaskEvent("event-subscribed"));

    expect(subscription.closed).toBe(false);
    expect(observed).toEqual(["dispatch:event-subscribed", "event:event-subscribed"]);

    subscription.unsubscribe();
    await bus.post(createTaskEvent("event-after-unsubscribe"));

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
      createEventDispatcher([TaskEventSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);
    const typeUrl = TypeUrls.derive(TaskEventSchema);
    const errors: { readonly message: string; readonly facts: Record<string, unknown> }[] = [];
    const logger = {
      withMetadata: (facts: Record<string, unknown>) => ({
        error: (message: string) => errors.push({ message, facts }),
      }),
    };
    eventBusAccess.installLogger(bus, logger as unknown as ILogLayer);
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

    await expect(bus.post(createTaskEvent("event-snapshot"))).resolves.toBeUndefined();

    expect(observed).toEqual([
      "dispatch:event-snapshot",
      "first:event-snapshot",
      "second:event-snapshot",
    ]);
    expect(errors).toEqual([
      {
        message: "Event subscriber failed.",
        facts: {
          eventType: "type.googleapis.com/spine.server.testing.handlerregistry.TaskEvent",
          operation: "event.subscriber",
          reasonCode: "subscriber_failed",
        },
      },
    ]);
  });

  it("contains subscriber failure without a logger and rejects foreign logger installation", async () => {
    const bus = new EventBus(
      new EventStore({ name: "Tasks", multitenant: false }, new InMemoryStorageFactory()),
      [createEventDispatcher([TaskEventSchema], () => undefined)],
    );
    eventBusAccess.subscribe(bus, TypeUrls.derive(TaskEventSchema), {
      onEvent() {
        throw new Error("contained without logging");
      },
    });

    await expect(bus.post(createTaskEvent("event-no-logger"))).resolves.toBeUndefined();
    expect(() => {
      eventBusAccess.installLogger({} as EventBus, {} as ILogLayer);
    }).toThrow("EventBus logger requires an EventBus instance.");
  });

  it("contains asynchronous subscriber rejection without delaying later subscribers", async () => {
    const bus = new EventBus(
      new EventStore({ name: "Tasks", multitenant: false }, new InMemoryStorageFactory()),
      [createEventDispatcher([TaskEventSchema], () => undefined)],
    );
    const errors: { readonly message: string; readonly facts: Record<string, unknown> }[] = [];
    eventBusAccess.installLogger(bus, {
      withMetadata: (facts: Record<string, unknown>) => ({
        error: (message: string) => errors.push({ message, facts }),
      }),
    } as unknown as ILogLayer);
    const later = vi.fn();
    eventBusAccess.subscribe(bus, TypeUrls.derive(TaskEventSchema), {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onEvent: () => Promise.reject(new Error("async subscriber failure")),
    });
    eventBusAccess.subscribe(bus, TypeUrls.derive(TaskEventSchema), { onEvent: later });

    await bus.post(createTaskEvent("event-async"));
    expect(later).toHaveBeenCalledTimes(1);
    await delay(0);
    expect(errors).toEqual([
      {
        message: "Event subscriber failed.",
        facts: {
          eventType: TypeUrls.derive(TaskEventSchema),
          operation: "event.subscriber",
          reasonCode: "subscriber_failed",
        },
      },
    ]);
  });

  it("reports deferred subscriber rejection after the bus closes", async () => {
    const bus = new EventBus(
      new EventStore({ name: "Tasks", multitenant: false }, new InMemoryStorageFactory()),
      [createEventDispatcher([TaskEventSchema], () => undefined)],
    );
    const errors: string[] = [];
    eventBusAccess.installLogger(bus, {
      withMetadata: () => ({ error: (message: string) => errors.push(message) }),
    } as unknown as ILogLayer);
    let reject!: (reason: unknown) => void;
    eventBusAccess.subscribe(bus, TypeUrls.derive(TaskEventSchema), {
      // eslint-disable-next-line @typescript-eslint/no-misused-promises
      onEvent: () =>
        new Promise<void>((_resolve, rejected) => {
          reject = rejected;
        }),
    });

    await bus.post(createTaskEvent("event-deferred"));
    await bus.close();
    reject(new Error("late failure"));
    await delay(0);
    expect(errors).toEqual(["Event subscriber failed."]);
  });

  it("closes direct event subscribers when the bus closes", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      createEventDispatcher([TaskEventSchema], (event) => {
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      }),
    ]);
    const subscription = eventBusAccess.subscribe(bus, TypeUrls.derive(TaskEventSchema), {
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
      eventBusAccess.subscribe(bus, TypeUrls.derive(TaskEventSchema), {
        onEvent: () => undefined,
      }),
    ).toThrow(/closed/i);

    await closing;

    expect(() =>
      eventBusAccess.subscribe(bus, TypeUrls.derive(TaskEventSchema), {
        onEvent: () => undefined,
      }),
    ).toThrow(/closed/i);
  });

  it("rejects internal event-bus access for non-event-bus values", () => {
    const notBus = {} as EventBus;

    expect(() =>
      eventBusAccess.subscribe(notBus, TypeUrls.derive(TaskEventSchema), {
        onEvent: () => undefined,
      }),
    ).toThrow("Event subscription requires an EventBus instance.");
    expect(() => eventBusAccess.eventSchemas(notBus)).toThrow(
      "Event schema listing requires an EventBus instance.",
    );
    expect(() => {
      eventBusAccess.registerSchemas(notBus, [TaskEventSchema]);
    }).toThrow("Event schema registration requires an EventBus instance.");
  });

  it("coordinates close through internal event-bus access", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);

    eventBusAccess.beginClose(bus);
    expect(eventBusAccess.acceptedWorkCount(bus)).toBe(0);
    await eventBusAccess.drain(bus);
    await eventBusAccess.finishClose(bus);
  });

  it("runs accept hooks before dispatching already stored events", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      {
        messageSchemas: () => [TaskEventSchema],
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
    const event = createTaskEvent("event-stored-accepted");

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
        messageSchemas: () => [TaskEventSchema],
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
    const event = createTaskEvent("event-stored-accept-failure");

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
    const dispatcher = createEventDispatcher([TaskEventSchema], async (event) => {
      observed.push(`dispatch:${event.id?.value ?? "missing"}`);
      context.resolveDispatchStarted?.();
      await dispatcherCanFinish;
      if (event.id?.value === "event-close-source" && context.bus !== undefined) {
        await store.append(createTaskEvent("event-close-follow-up"));
        void eventBusAccess.postStoredFollowUp(
          context.bus,
          createTaskEvent("event-close-follow-up"),
        );
      }
    });
    const bus = new EventBus(store, [dispatcher]);
    context.bus = bus;
    const activeDispatchStarted = new Promise<void>((resolve) => {
      context.resolveDispatchStarted = resolve;
    });

    const post = bus.post(createTaskEvent("event-close-source"));
    await activeDispatchStarted;

    const close = bus.close().then(() => "closed");

    await expect(Promise.race([close, delay(25)])).resolves.toBe("pending");

    releaseDispatcher();
    await expect(post).resolves.toBeUndefined();
    await expect(close).resolves.toBe("closed");

    expect(observed).toEqual(["dispatch:event-close-source", "dispatch:event-close-follow-up"]);
  });

  it("appends and dispatches follow-up events before later exclusive work", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const observed: string[] = [];
    const bus = new EventBus(store, [
      createEventDispatcher([TaskEventSchema], async (event) => {
        const stored = await store.read();
        observed.push(`dispatch:${event.id?.value ?? "missing"}`);
        observed.push(`stored:${stored.map((entry) => entry.id?.value ?? "missing").join(",")}`);
      }),
    ]);

    await eventBusAccess.runExclusive(bus, () => {
      void eventBusAccess.postFollowUp(bus, createTaskEvent("event-follow-up-fresh"));
      observed.push("after-schedule");
    });

    await bus.close();

    expect(observed).toEqual([
      "after-schedule",
      "dispatch:event-follow-up-fresh",
      "stored:event-follow-up-fresh",
    ]);
  });

  it("rejects follow-up event intake after close", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);

    await bus.close();

    await expect(
      eventBusAccess.postFollowUp(bus, createTaskEvent("event-follow-up-after-close")),
    ).rejects.toThrow(/closed/);
  });

  it("rejects public and internal event intake after close", async () => {
    const store = new EventStore(
      { name: "Tasks", multitenant: false },
      new InMemoryStorageFactory(),
    );
    const bus = new EventBus(store);

    await bus.close();
    await bus.close();

    await expect(bus.post(createTaskEvent("event-after-close"))).rejects.toThrow(/closed/);
    await expect(
      eventBusAccess.postStored(bus, createTaskEvent("event-stored-after-close")),
    ).rejects.toThrow(/closed/);
    await expect(
      eventBusAccess.postStoredFollowUp(bus, createTaskEvent("event-follow-up-after-close")),
    ).rejects.toThrow(/closed/);
  });

  it("rejects stored-event dispatch for non-event-bus values", () => {
    expect(() =>
      eventBusAccess.postStored({} as EventBus, createTaskEvent("event-wrong-bus")),
    ).toThrow(/EventBus instance/);
  });

  it("rejects exclusive framework work for non-event-bus values", () => {
    expect(() => eventBusAccess.runExclusive({} as EventBus, () => "unused")).toThrow(
      /EventBus instance/,
    );
  });

  it("rejects internal close coordination for non-event-bus values", () => {
    const bus = {} as EventBus;

    expect(() => eventBusAccess.postFollowUp(bus, createTaskEvent("event-follow-up-post"))).toThrow(
      /EventBus instance/,
    );
    expect(() =>
      eventBusAccess.postStoredFollowUp(bus, createTaskEvent("event-follow-up")),
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
    const dispatcher = createEventDispatcher([TaskEventSchema], async (event) => {
      observed.push(`outer:${event.id?.value ?? "missing"}`);
      await expect(context.bus?.post(createTaskEvent("event-nested"))).rejects.toThrow(
        "Cannot enqueue runtime work from an active runtime work item.",
      );
      observed.push("after-rejection");
    });
    const bus = new EventBus(store, [dispatcher]);
    context.bus = bus;

    await bus.post(createTaskEvent("event-7"));

    expect(observed).toEqual(["outer:event-7", "after-rejection"]);
  });
});

function createEventDispatcher(
  schemas: readonly GenMessage<Message>[],
  onDispatch: (event: ReturnType<typeof createTaskEvent>) => void | Promise<void>,
): EventDispatcher {
  return {
    messageSchemas: () => schemas,
    dispatch: (event) => Promise.resolve(onDispatch(event)),
  };
}

function createTaskEvent(id: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "aggregate-1" })),
      version: create(VersionSchema, { number: 1 }),
    }),
    message: AnyMessages.pack(
      TaskEventSchema,
      create(TaskEventSchema, { id: "task-1", name: "Task" }),
    ),
  });
}

function createValidatedEvent(id: string, name: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "aggregate-1" })),
      version: create(VersionSchema, { number: 1 }),
    }),
    message: AnyMessages.pack(
      ValidatedTaskEventSchema,
      create(ValidatedTaskEventSchema, { id: "task-1", name }),
      { validate: false },
    ),
  });
}

function observeEventStoreAccess() {
  const createStorage = vi.spyOn(InMemoryStorageFactory.prototype, "createRecordStorage");
  const acceptThenAppend = vi.spyOn(EventStore.prototype, "acceptThenAppend");
  const read = vi.spyOn(EventStore.prototype, "read");
  const close = vi.spyOn(EventStore.prototype, "close");

  return {
    expectNoAccess() {
      expect(createStorage).not.toHaveBeenCalled();
      expect(acceptThenAppend).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
      expect(close).not.toHaveBeenCalled();
    },
    restore() {
      createStorage.mockRestore();
      acceptThenAppend.mockRestore();
      read.mockRestore();
      close.mockRestore();
    },
  };
}

function delay(ms: number): Promise<"pending"> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("pending");
    }, ms);
  });
}
