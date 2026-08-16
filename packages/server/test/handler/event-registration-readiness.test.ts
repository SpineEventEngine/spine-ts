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

import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, expectTypeOf, it } from "vitest";
import { EventSchema, file_spine_options } from "@spine-event-engine/proto";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import {
  EventRegistrationReadiness,
  EntityHandlers,
  HandlerMetadataRegistry,
  HandlerMetadataRegistryError,
  type EntityHandlersMetadata,
  type EventApplicationHandlerMetadata,
  type EventRegistrationApplicationMetadata,
  type EventRegistrationReadinessLookup,
  type EventRegistrationReactorMetadata,
  type EventRegistrationSubscriberMetadata,
  type EventReactionHandlerMetadata,
  type EventSubscriptionHandlerMetadata,
  type HandlerKind,
  type HandlerMetadata,
  type HandlerMetadataRegistryLookup,
  type RegisteredHandlerMetadata,
} from "../../src/index.js";

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

type EventHandlerMetadata =
  EventApplicationHandlerMetadata | EventReactionHandlerMetadata | EventSubscriptionHandlerMetadata;

class TaskProjection {
  subscribeCreated(event: Message<"spine.core.Event">): void {
    void event;
  }

  reactToCreated(event: Message<"spine.core.Event">): void {
    void event;
  }

  applyCreated(event: Message<"spine.core.Event">): void {
    void event;
  }
}

class AuditProjection {
  subscribeCreated(event: Message<"spine.core.Event">): void {
    void event;
  }

  reactToCreated(event: Message<"spine.core.Event">): void {
    void event;
  }

  applyCreated(event: Message<"spine.core.Event">): void {
    void event;
  }
}

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Server event registration readiness fixture descriptor set is empty.");
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

describe("event registration readiness", () => {
  it("treats an empty handler registry as valid event readiness", () => {
    const readiness = EventRegistrationReadiness.fromRegistry(new HandlerMetadataRegistry());

    expectTypeOf<EventRegistrationReadiness>().toExtend<EventRegistrationReadinessLookup>();
    expect(readiness.eventTypeNames()).toEqual([]);
    expect(readiness.findEventSubscribers("spine.core.Event")).toEqual([]);
    expect(readiness.findEventReactors("spine.core.Event")).toEqual([]);
    expect(readiness.findEventApplications("spine.core.Event")).toEqual([]);
    expect(Object.isFrozen(readiness.eventTypeNames())).toBe(true);
  });

  it("rejects direct runtime construction without the package factory token", () => {
    const constructor = EventRegistrationReadiness as unknown as new (
      authenticityToken: symbol,
      eventFullTypeNames: readonly string[],
      subscribersByTypeName: ReadonlyMap<string, readonly EventRegistrationSubscriberMetadata[]>,
      reactorsByTypeName: ReadonlyMap<string, readonly EventRegistrationReactorMetadata[]>,
      applicationsByTypeName: ReadonlyMap<string, readonly EventRegistrationApplicationMetadata[]>,
    ) => EventRegistrationReadiness;

    expect(() => {
      Reflect.construct(constructor, [Symbol("external"), [], new Map(), new Map(), new Map()]);
    }).toThrow(
      "EventRegistrationReadiness instances must be created by the package factory methods.",
    );
  });

  it("lists registered event message full type names in deterministic order", () => {
    const handlers = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.subscribe(EventSchema, "subscribeCreated"),
      builder.react(AggregateStateSchema, "reactToCreated"),
      builder.apply(EventSchema, "applyCreated", { allowImport: true }),
    ]);
    const readiness = EventRegistrationReadiness.fromRegistry(
      new HandlerMetadataRegistry([handlers]),
    );

    expect(readiness.eventTypeNames()).toEqual(["AggregateState", "spine.core.Event"]);
  });

  it("orders event message names by locale-independent code units", () => {
    const registry = createRegistryLookupForEventNames([
      "example.Event_Alpha",
      "example.Event0Alpha",
      "example.EventAlpha",
      "example.Eventalpha",
    ]);

    const readiness = EventRegistrationReadiness.fromRegistry(registry);

    expect(readiness.eventTypeNames()).toEqual([
      "example.Event0Alpha",
      "example.EventAlpha",
      "example.Event_Alpha",
      "example.Eventalpha",
    ]);
  });

  it("preserves subscriber and reactor fan-out for the same event type", () => {
    const projectionHandlers = EntityHandlers.define(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [
        builder.subscribe(EventSchema, "subscribeCreated"),
        builder.react(EventSchema, "reactToCreated"),
      ],
    );
    const auditHandlers = EntityHandlers.define(
      AuditProjection,
      AggregateStateSchema,
      (builder) => [
        builder.subscribe(EventSchema, "subscribeCreated"),
        builder.react(EventSchema, "reactToCreated"),
      ],
    );
    const readiness = EventRegistrationReadiness.fromEntityHandlers([
      projectionHandlers,
      auditHandlers,
    ]);

    const subscribers = readiness.findEventSubscribers(EventSchema.typeName);
    const reactors = readiness.findEventReactors(EventSchema.typeName);

    expectTypeOf<
      (typeof subscribers)[number]
    >().toEqualTypeOf<EventRegistrationSubscriberMetadata>();
    expectTypeOf<(typeof reactors)[number]>().toEqualTypeOf<EventRegistrationReactorMetadata>();
    expect(subscribers.map(({ entity }) => entity.fullTypeName)).toEqual([
      "ProjectionState",
      "AggregateState",
    ]);
    expect(reactors.map(({ entity }) => entity.fullTypeName)).toEqual([
      "ProjectionState",
      "AggregateState",
    ]);
  });

  it("groups event applications by event type and keeps allowImport metadata", () => {
    const projectionHandlers = EntityHandlers.define(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.apply(EventSchema, "applyCreated", { allowImport: true })],
    );
    const auditHandlers = EntityHandlers.define(
      AuditProjection,
      AggregateStateSchema,
      (builder) => [builder.apply(EventSchema, "applyCreated")],
    );
    const readiness = EventRegistrationReadiness.fromEntityHandlers([
      projectionHandlers,
      auditHandlers,
    ]);

    const applications = readiness.findEventApplications(EventSchema.typeName);

    expectTypeOf<
      (typeof applications)[number]
    >().toEqualTypeOf<EventRegistrationApplicationMetadata>();
    expect(applications).toMatchObject([
      {
        eventFullTypeName: "spine.core.Event",
        stateTypeName: "ProjectionState",
        handler: { kind: "event-application", methodName: "applyCreated", allowImport: true },
      },
      {
        eventFullTypeName: "spine.core.Event",
        stateTypeName: "AggregateState",
        handler: { kind: "event-application", methodName: "applyCreated", allowImport: false },
      },
    ]);
  });

  it("keeps duplicate event application failure owned by HandlerMetadataRegistry", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.apply(EventSchema, "applyCreated"),
    ]);
    const second = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.apply(EventSchema, "applyCreated"),
    ]);

    expect(() => EventRegistrationReadiness.fromEntityHandlers([first, second])).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => EventRegistrationReadiness.fromEntityHandlers([first, second])).toThrow(
      /Duplicate event application for entity "ProjectionState" and event "spine\.core\.Event"/,
    );
  });

  it("rejects duplicate event applications from custom registry lookups", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.apply(EventSchema, "applyCreated"),
    ]);
    const second = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.apply(EventSchema, "applyCreated"),
    ]);
    const customLookup = createRegistryLookupForEventHandlers([
      createRegisteredEventHandler(first, first.eventApplications[0]),
      createRegisteredEventHandler(second, second.eventApplications[0]),
    ]);

    expect(() => EventRegistrationReadiness.fromRegistry(customLookup)).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => EventRegistrationReadiness.fromRegistry(customLookup)).toThrow(
      /Duplicate event application for entity "ProjectionState" and event "spine\.core\.Event"/,
    );
  });

  it("returns frozen copy-safe event lists and receiver values", () => {
    const handlers = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.subscribe(EventSchema, "subscribeCreated"),
      builder.react(EventSchema, "reactToCreated"),
      builder.apply(EventSchema, "applyCreated", { allowImport: true }),
    ]);
    const readiness = EventRegistrationReadiness.fromEntityHandlers([handlers]);

    const firstList = readiness.eventTypeNames();
    const secondList = readiness.eventTypeNames();
    const firstSubscribers = readiness.findEventSubscribers(EventSchema.typeName);
    const secondSubscribers = readiness.findEventSubscribers(EventSchema.typeName);
    const firstApplications = readiness.findEventApplications(EventSchema.typeName);
    const secondApplications = readiness.findEventApplications(EventSchema.typeName);

    expect(firstList).toEqual(["spine.core.Event"]);
    expect(Object.isFrozen(firstList)).toBe(true);
    expect(firstList).not.toBe(secondList);
    expect(() => {
      (firstList as string[]).push("example.MutatedEvent");
    }).toThrow(TypeError);
    expect(readiness.eventTypeNames()).toEqual(["spine.core.Event"]);

    expect(firstSubscribers).toEqual(secondSubscribers);
    expect(firstSubscribers).not.toBe(secondSubscribers);
    expect(firstSubscribers[0]).not.toBe(secondSubscribers[0]);
    expect(Object.isFrozen(firstSubscribers)).toBe(true);
    expect(Object.isFrozen(firstSubscribers[0])).toBe(true);
    expect(() => {
      (firstSubscribers[0] as { eventFullTypeName: string }).eventFullTypeName =
        "example.MutatedEvent";
    }).toThrow(TypeError);

    expect(firstApplications).toEqual(secondApplications);
    expect(firstApplications).not.toBe(secondApplications);
    expect(firstApplications[0]).not.toBe(secondApplications[0]);
    expect(Object.isFrozen(firstApplications)).toBe(true);
    expect(Object.isFrozen(firstApplications[0]?.handler)).toBe(true);
    expect(readiness.findEventSubscribers(EventSchema.typeName)[0]?.eventFullTypeName).toBe(
      "spine.core.Event",
    );
  });

  it("keeps returned nested event metadata from mutating later lookups", () => {
    const mutableHandler: EventSubscriptionHandlerMetadata = {
      kind: "event-subscription",
      schema: EventSchema,
      descriptor: EventSchema,
      messageFullTypeName: EventSchema.typeName,
      methodName: "subscribeCreated",
      parameterCount: 1,
      origin: "domestic",
    };
    const mutableEntityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: createProjectionEntityMetadata(),
      handlers: [mutableHandler],
      commandAssignments: [],
      commandReactions: [],
      eventSubscriptions: [mutableHandler],
      stateSubscriptions: [],
      eventReactions: [],
      eventApplications: [],
    };
    const mutableRegisteredHandler: RegisteredHandlerMetadata<EventSubscriptionHandlerMetadata> = {
      entityHandlers: mutableEntityHandlers,
      entityType: TaskProjection,
      entity: mutableEntityHandlers.entity,
      handler: mutableHandler,
    };
    const readiness = EventRegistrationReadiness.fromRegistry(
      createRegistryLookupForEventHandlers([mutableRegisteredHandler]),
    );

    const subscriber = readiness.findEventSubscribers(EventSchema.typeName)[0];
    const nestedSubscription = subscriber?.entityHandlers.eventSubscriptions[0];

    if (nestedSubscription === undefined) {
      throw new Error("Expected event subscriber metadata to include a nested event subscription.");
    }

    expect(Object.isFrozen(subscriber?.handler)).toBe(true);
    expect(Object.isFrozen(subscriber?.entityHandlers)).toBe(true);
    expect(Object.isFrozen(subscriber?.entityHandlers.eventSubscriptions)).toBe(true);
    expect(Object.isFrozen(subscriber?.registeredHandler)).toBe(true);
    expect(Object.isFrozen(subscriber?.registeredHandler.handler)).toBe(true);
    expect(() => {
      (subscriber?.handler as { methodName: string }).methodName = "mutatedHandler";
    }).toThrow(TypeError);
    expect(() => {
      (nestedSubscription as { methodName: string }).methodName = "mutatedNestedHandler";
    }).toThrow(TypeError);
    expect(() => {
      (subscriber?.registeredHandler.handler as { methodName: string }).methodName =
        "mutatedRegisteredHandler";
    }).toThrow(TypeError);

    expect(readiness.findEventSubscribers(EventSchema.typeName)[0]).toMatchObject({
      handler: { methodName: "subscribeCreated" },
      entityHandlers: {
        eventSubscriptions: [{ methodName: "subscribeCreated" }],
      },
      registeredHandler: {
        handler: { methodName: "subscribeCreated" },
      },
    });
  });

  it("keeps returned event schema and descriptor metadata from mutating later lookups", () => {
    const mutableSchema = { ...EventSchema };
    const mutableDescriptor = { ...EventSchema };
    const mutableHandler: EventSubscriptionHandlerMetadata = {
      kind: "event-subscription",
      schema: mutableSchema,
      descriptor: mutableDescriptor,
      messageFullTypeName: EventSchema.typeName,
      methodName: "subscribeCreated",
      parameterCount: 1,
      origin: "domestic",
    };
    const mutableEntityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: createProjectionEntityMetadata(),
      handlers: [mutableHandler],
      commandAssignments: [],
      commandReactions: [],
      eventSubscriptions: [mutableHandler],
      stateSubscriptions: [],
      eventReactions: [],
      eventApplications: [],
    };
    const mutableRegisteredHandler: RegisteredHandlerMetadata<EventSubscriptionHandlerMetadata> = {
      entityHandlers: mutableEntityHandlers,
      entityType: TaskProjection,
      entity: mutableEntityHandlers.entity,
      handler: mutableHandler,
    };
    const readiness = EventRegistrationReadiness.fromRegistry(
      createRegistryLookupForEventHandlers([mutableRegisteredHandler]),
    );

    const subscriber = readiness.findEventSubscribers(EventSchema.typeName)[0];

    expect(Object.isFrozen(subscriber?.handler.schema)).toBe(true);
    expect(Object.isFrozen(subscriber?.handler.descriptor)).toBe(true);
    expect(() => {
      (subscriber?.handler.schema as { typeName: string }).typeName = "example.MutatedEvent";
    }).toThrow(TypeError);
    expect(() => {
      (subscriber?.handler.descriptor as { typeName: string }).typeName =
        "example.MutatedEventDescriptor";
    }).toThrow(TypeError);

    expect(readiness.findEventSubscribers(EventSchema.typeName)[0]).toMatchObject({
      handler: {
        schema: { typeName: EventSchema.typeName },
        descriptor: { typeName: EventSchema.typeName },
      },
    });
  });

  it("ignores caller-supplied entity semantic tags", () => {
    const handler: EventSubscriptionHandlerMetadata = {
      kind: "event-subscription",
      schema: EventSchema,
      descriptor: EventSchema,
      messageFullTypeName: EventSchema.typeName,
      methodName: "subscribeCreated",
      parameterCount: 1,
      origin: "domestic",
    };
    const entityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: metadataWithTags(Object.freeze([null])),
      handlers: [handler],
      commandAssignments: [],
      commandReactions: [],
      eventSubscriptions: [handler],
      stateSubscriptions: [],
      eventReactions: [],
      eventApplications: [],
    };
    const registeredHandler: RegisteredHandlerMetadata<EventSubscriptionHandlerMetadata> = {
      entityHandlers,
      entityType: TaskProjection,
      entity: entityHandlers.entity,
      handler,
    };

    expect(() =>
      EventRegistrationReadiness.fromRegistry(
        createRegistryLookupForEventHandlers([registeredHandler]),
      ),
    ).not.toThrow();
  });

  it("preserves entity field metadata identity in returned event metadata", () => {
    const handlers = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.subscribe(EventSchema, "subscribeCreated"),
      builder.apply(EventSchema, "applyCreated"),
    ]);
    const readiness = EventRegistrationReadiness.fromEntityHandlers([handlers]);

    const subscriber = readiness.findEventSubscribers(EventSchema.typeName)[0];
    const application = readiness.findEventApplications(EventSchema.typeName)[0];

    expect(handlers.entity.idField).toBe(handlers.entity.firstFieldRoutingHint.field);
    expect(subscriber?.entity.idField).toBe(subscriber?.entity.firstFieldRoutingHint.field);
    expect(subscriber?.registeredHandler.entity.idField).toBe(
      subscriber?.registeredHandler.entity.firstFieldRoutingHint.field,
    );
    expect(subscriber?.entityHandlers.entity.idField).toBe(
      subscriber?.entityHandlers.entity.firstFieldRoutingHint.field,
    );
    expect(application?.entity.idField).toBe(application?.entity.firstFieldRoutingHint.field);
    expect(application?.registeredHandler.entity.idField).toBe(
      application?.registeredHandler.entity.firstFieldRoutingHint.field,
    );
    expect(application?.entityHandlers.entity.idField).toBe(
      application?.entityHandlers.entity.firstFieldRoutingHint.field,
    );
  });

  it("does not expose bus, broker, import, storage, dispatch, delivery, or acknowledgement members", () => {
    const readiness = EventRegistrationReadiness.fromRegistry(new HandlerMetadataRegistry());

    expect(readiness).not.toHaveProperty("bus");
    expect(readiness).not.toHaveProperty("eventBus");
    expect(readiness).not.toHaveProperty("integrationBroker");
    expect(readiness).not.toHaveProperty("importBus");
    expect(readiness).not.toHaveProperty("eventStore");
    expect(readiness).not.toHaveProperty("delivery");
    expect(readiness).not.toHaveProperty("stand");
    expect(readiness).not.toHaveProperty("subscriptionService");
    expect(readiness).not.toHaveProperty("dispatch");
    expect(readiness).not.toHaveProperty("post");
    expect(readiness).not.toHaveProperty("route");
    expect(readiness).not.toHaveProperty("ack");
    expect(readiness).not.toHaveProperty("handle");
  });
});

function createRegistryLookupForEventNames(
  eventFullTypeNames: readonly string[],
): HandlerMetadataRegistryLookup {
  const eventHandlers = eventFullTypeNames.map((eventFullTypeName) => {
    const handler: EventSubscriptionHandlerMetadata = {
      kind: "event-subscription",
      schema: { ...EventSchema, typeName: eventFullTypeName },
      descriptor: { ...EventSchema, typeName: eventFullTypeName },
      messageFullTypeName: eventFullTypeName,
      methodName: "subscribeCreated",
      parameterCount: 1,
      origin: "domestic",
    };
    const entityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: createProjectionEntityMetadata(),
      handlers: [handler],
      commandAssignments: [],
      commandReactions: [],
      eventSubscriptions: [handler],
      stateSubscriptions: [],
      eventReactions: [],
      eventApplications: [],
    };

    return {
      entityHandlers,
      entityType: TaskProjection,
      entity: entityHandlers.entity,
      handler,
    } satisfies RegisteredHandlerMetadata<EventSubscriptionHandlerMetadata>;
  });

  return createRegistryLookupForEventHandlers(eventHandlers);
}

function createRegistryLookupForEventHandlers(
  eventHandlers: readonly RegisteredHandlerMetadata<EventHandlerMetadata>[],
): HandlerMetadataRegistryLookup {
  return {
    listEntityHandlers: () => eventHandlers.map(({ entityHandlers }) => entityHandlers),
    listHandlers: () => eventHandlers,
    findByState: (entityStateFullTypeName) =>
      eventHandlers
        .map(({ entityHandlers }) => entityHandlers)
        .filter(({ entity }) => entity.fullTypeName === entityStateFullTypeName),
    findHandlersByKind: <Kind extends HandlerKind>(kind: Kind) =>
      eventHandlers.filter(
        ({ handler }) => handler.kind === kind,
      ) as unknown as readonly RegisteredHandlerMetadata<
        Extract<HandlerMetadata, { readonly kind: Kind }>
      >[],
    findByMessage: (messageFullTypeName) =>
      eventHandlers.filter(({ handler }) => handler.messageFullTypeName === messageFullTypeName),
    findCommandAssignment: () => undefined,
    findEventApplication: (entityStateFullTypeName, eventFullTypeName) =>
      eventHandlers.find(
        (entry): entry is RegisteredHandlerMetadata<EventApplicationHandlerMetadata> =>
          entry.handler.kind === "event-application" &&
          entry.entity.fullTypeName === entityStateFullTypeName &&
          entry.handler.messageFullTypeName === eventFullTypeName,
      ),
  };
}

function createRegisteredEventHandler<Handler extends EventHandlerMetadata>(
  entityHandlers: EntityHandlersMetadata,
  handler: Handler | undefined,
): RegisteredHandlerMetadata<Handler> {
  if (handler === undefined) {
    throw new Error("Expected event handler metadata.");
  }

  return {
    entityHandlers,
    entityType: entityHandlers.entityType,
    entity: entityHandlers.entity,
    handler,
  };
}

function createProjectionEntityMetadata(): EntityHandlersMetadata["entity"] {
  return EntityHandlers.define(TaskProjection, ProjectionStateSchema, () => []).entity;
}

function metadataWithTags(semanticTags: unknown): EntityHandlersMetadata["entity"] {
  return Object.freeze({
    ...createProjectionEntityMetadata(),
    semanticTags,
  });
}
