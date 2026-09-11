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

import { describe, expect, expectTypeOf, it } from "vitest";

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
import {
  type ProjectCreated,
  ProjectCreatedSchema,
} from "../../test-fixtures/generated/entity-metadata/project_events_pb.js";
import {
  ProjectOverviewStateSchema,
  ProjectStateSchema,
} from "../../test-fixtures/generated/entity-metadata/project_states_pb.js";

type EventHandlerMetadata =
  EventApplicationHandlerMetadata | EventReactionHandlerMetadata | EventSubscriptionHandlerMetadata;

class TaskProjection {
  subscribeCreated(event: ProjectCreated): void {
    void event;
  }

  reactToCreated(event: ProjectCreated): void {
    void event;
  }

  applyCreated(event: ProjectCreated): void {
    void event;
  }
}

class AuditProjection {
  subscribeCreated(event: ProjectCreated): void {
    void event;
  }

  reactToCreated(event: ProjectCreated): void {
    void event;
  }

  applyCreated(event: ProjectCreated): void {
    void event;
  }
}

describe("event registration readiness", () => {
  it("treats an empty handler registry as valid event readiness", () => {
    const readiness = EventRegistrationReadiness.fromRegistry(new HandlerMetadataRegistry());

    expectTypeOf<EventRegistrationReadiness>().toExtend<EventRegistrationReadinessLookup>();
    expect(readiness.eventTypeNames()).toEqual([]);
    expect(readiness.findEventSubscribers(ProjectCreatedSchema.typeName)).toEqual([]);
    expect(readiness.findEventReactors(ProjectCreatedSchema.typeName)).toEqual([]);
    expect(readiness.findEventApplications(ProjectCreatedSchema.typeName)).toEqual([]);
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
    const handlers = EntityHandlers.define(
      TaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [
        builder.subscribe(ProjectCreatedSchema, "subscribeCreated"),
        builder.react(ProjectCreatedSchema, "reactToCreated"),
        builder.apply(ProjectCreatedSchema, "applyCreated", { allowImport: true }),
      ],
    );
    const readiness = EventRegistrationReadiness.fromRegistry(
      new HandlerMetadataRegistry([handlers]),
    );

    expect(readiness.eventTypeNames()).toEqual([ProjectCreatedSchema.typeName]);
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
      ProjectOverviewStateSchema,
      (builder) => [
        builder.subscribe(ProjectCreatedSchema, "subscribeCreated"),
        builder.react(ProjectCreatedSchema, "reactToCreated"),
      ],
    );
    const auditHandlers = EntityHandlers.define(AuditProjection, ProjectStateSchema, (builder) => [
      builder.subscribe(ProjectCreatedSchema, "subscribeCreated"),
      builder.react(ProjectCreatedSchema, "reactToCreated"),
    ]);
    const readiness = EventRegistrationReadiness.fromEntityHandlers([
      projectionHandlers,
      auditHandlers,
    ]);

    const subscribers = readiness.findEventSubscribers(ProjectCreatedSchema.typeName);
    const reactors = readiness.findEventReactors(ProjectCreatedSchema.typeName);

    expectTypeOf<
      (typeof subscribers)[number]
    >().toEqualTypeOf<EventRegistrationSubscriberMetadata>();
    expectTypeOf<(typeof reactors)[number]>().toEqualTypeOf<EventRegistrationReactorMetadata>();
    expect(subscribers.map(({ entity }) => entity.fullTypeName)).toEqual([
      ProjectOverviewStateSchema.typeName,
      ProjectStateSchema.typeName,
    ]);
    expect(reactors.map(({ entity }) => entity.fullTypeName)).toEqual([
      ProjectOverviewStateSchema.typeName,
      ProjectStateSchema.typeName,
    ]);
  });

  it("groups event applications by event type and keeps allowImport metadata", () => {
    const projectionHandlers = EntityHandlers.define(
      TaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.apply(ProjectCreatedSchema, "applyCreated", { allowImport: true })],
    );
    const auditHandlers = EntityHandlers.define(AuditProjection, ProjectStateSchema, (builder) => [
      builder.apply(ProjectCreatedSchema, "applyCreated"),
    ]);
    const readiness = EventRegistrationReadiness.fromEntityHandlers([
      projectionHandlers,
      auditHandlers,
    ]);

    const applications = readiness.findEventApplications(ProjectCreatedSchema.typeName);

    expectTypeOf<
      (typeof applications)[number]
    >().toEqualTypeOf<EventRegistrationApplicationMetadata>();
    expect(applications).toMatchObject([
      {
        eventFullTypeName: ProjectCreatedSchema.typeName,
        stateTypeName: ProjectOverviewStateSchema.typeName,
        handler: { kind: "event-application", methodName: "applyCreated", allowImport: true },
      },
      {
        eventFullTypeName: ProjectCreatedSchema.typeName,
        stateTypeName: ProjectStateSchema.typeName,
        handler: { kind: "event-application", methodName: "applyCreated", allowImport: false },
      },
    ]);
  });

  it("keeps duplicate event application failure owned by HandlerMetadataRegistry", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
      builder.apply(ProjectCreatedSchema, "applyCreated"),
    ]);
    const second = EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
      builder.apply(ProjectCreatedSchema, "applyCreated"),
    ]);

    expect(() => EventRegistrationReadiness.fromEntityHandlers([first, second])).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => EventRegistrationReadiness.fromEntityHandlers([first, second])).toThrow(
      new RegExp(
        `Duplicate event application for entity "${ProjectOverviewStateSchema.typeName}" and event "${ProjectCreatedSchema.typeName}"`,
      ),
    );
  });

  it("rejects duplicate event applications from custom registry lookups", () => {
    const first = EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
      builder.apply(ProjectCreatedSchema, "applyCreated"),
    ]);
    const second = EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, (builder) => [
      builder.apply(ProjectCreatedSchema, "applyCreated"),
    ]);
    const customLookup = createRegistryLookupForEventHandlers([
      createRegisteredEventHandler(first, first.eventApplications[0]),
      createRegisteredEventHandler(second, second.eventApplications[0]),
    ]);

    expect(() => EventRegistrationReadiness.fromRegistry(customLookup)).toThrow(
      HandlerMetadataRegistryError,
    );
    expect(() => EventRegistrationReadiness.fromRegistry(customLookup)).toThrow(
      new RegExp(
        `Duplicate event application for entity "${ProjectOverviewStateSchema.typeName}" and event "${ProjectCreatedSchema.typeName}"`,
      ),
    );
  });

  it("returns frozen copy-safe event lists and receiver values", () => {
    const handlers = EntityHandlers.define(
      TaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [
        builder.subscribe(ProjectCreatedSchema, "subscribeCreated"),
        builder.react(ProjectCreatedSchema, "reactToCreated"),
        builder.apply(ProjectCreatedSchema, "applyCreated", { allowImport: true }),
      ],
    );
    const readiness = EventRegistrationReadiness.fromEntityHandlers([handlers]);

    const firstList = readiness.eventTypeNames();
    const secondList = readiness.eventTypeNames();
    const firstSubscribers = readiness.findEventSubscribers(ProjectCreatedSchema.typeName);
    const secondSubscribers = readiness.findEventSubscribers(ProjectCreatedSchema.typeName);
    const firstApplications = readiness.findEventApplications(ProjectCreatedSchema.typeName);
    const secondApplications = readiness.findEventApplications(ProjectCreatedSchema.typeName);

    expect(firstList).toEqual([ProjectCreatedSchema.typeName]);
    expect(Object.isFrozen(firstList)).toBe(true);
    expect(firstList).not.toBe(secondList);
    expect(() => {
      (firstList as string[]).push("example.MutatedEvent");
    }).toThrow(TypeError);
    expect(readiness.eventTypeNames()).toEqual([ProjectCreatedSchema.typeName]);

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
    expect(
      readiness.findEventSubscribers(ProjectCreatedSchema.typeName)[0]?.eventFullTypeName,
    ).toBe(ProjectCreatedSchema.typeName);
  });

  it("keeps returned nested event metadata from mutating later lookups", () => {
    const mutableHandler: EventSubscriptionHandlerMetadata = {
      kind: "event-subscription",
      schema: ProjectCreatedSchema,
      descriptor: ProjectCreatedSchema,
      messageFullTypeName: ProjectCreatedSchema.typeName,
      methodName: "subscribeCreated",
      parameterCount: 1,
      origin: "domestic",
    };
    const mutableEntityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: createProjectionEntityMetadata(),
      handlers: [mutableHandler],
      commandAssignments: [],
      commandSubstitutions: [],
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

    const subscriber = readiness.findEventSubscribers(ProjectCreatedSchema.typeName)[0];
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

    expect(readiness.findEventSubscribers(ProjectCreatedSchema.typeName)[0]).toMatchObject({
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
    const mutableSchema = { ...ProjectCreatedSchema };
    const mutableDescriptor = { ...ProjectCreatedSchema };
    const mutableHandler: EventSubscriptionHandlerMetadata = {
      kind: "event-subscription",
      schema: mutableSchema,
      descriptor: mutableDescriptor,
      messageFullTypeName: ProjectCreatedSchema.typeName,
      methodName: "subscribeCreated",
      parameterCount: 1,
      origin: "domestic",
    };
    const mutableEntityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: createProjectionEntityMetadata(),
      handlers: [mutableHandler],
      commandAssignments: [],
      commandSubstitutions: [],
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

    const subscriber = readiness.findEventSubscribers(ProjectCreatedSchema.typeName)[0];

    expect(Object.isFrozen(subscriber?.handler.schema)).toBe(true);
    expect(Object.isFrozen(subscriber?.handler.descriptor)).toBe(true);
    expect(() => {
      (subscriber?.handler.schema as { typeName: string }).typeName = "example.MutatedEvent";
    }).toThrow(TypeError);
    expect(() => {
      (subscriber?.handler.descriptor as { typeName: string }).typeName =
        "example.MutatedEventDescriptor";
    }).toThrow(TypeError);

    expect(readiness.findEventSubscribers(ProjectCreatedSchema.typeName)[0]).toMatchObject({
      handler: {
        schema: { typeName: ProjectCreatedSchema.typeName },
        descriptor: { typeName: ProjectCreatedSchema.typeName },
      },
    });
  });

  it("ignores caller-supplied entity semantic tags", () => {
    const handler: EventSubscriptionHandlerMetadata = {
      kind: "event-subscription",
      schema: ProjectCreatedSchema,
      descriptor: ProjectCreatedSchema,
      messageFullTypeName: ProjectCreatedSchema.typeName,
      methodName: "subscribeCreated",
      parameterCount: 1,
      origin: "domestic",
    };
    const entityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: metadataWithTags(Object.freeze([null])),
      handlers: [handler],
      commandAssignments: [],
      commandSubstitutions: [],
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
    const handlers = EntityHandlers.define(
      TaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [
        builder.subscribe(ProjectCreatedSchema, "subscribeCreated"),
        builder.apply(ProjectCreatedSchema, "applyCreated"),
      ],
    );
    const readiness = EventRegistrationReadiness.fromEntityHandlers([handlers]);

    const subscriber = readiness.findEventSubscribers(ProjectCreatedSchema.typeName)[0];
    const application = readiness.findEventApplications(ProjectCreatedSchema.typeName)[0];

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
      schema: { ...ProjectCreatedSchema, typeName: eventFullTypeName },
      descriptor: { ...ProjectCreatedSchema, typeName: eventFullTypeName },
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
      commandSubstitutions: [],
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
  return EntityHandlers.define(TaskProjection, ProjectOverviewStateSchema, () => []).entity;
}

function metadataWithTags(semanticTags: unknown): EntityHandlersMetadata["entity"] {
  return Object.freeze({
    ...createProjectionEntityMetadata(),
    semanticTags,
  });
}
