import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { describe, expect, expectTypeOf, it } from "vitest";
import { EventSchema, file_spine_options } from "@spine-ts/proto";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import {
  EventRegistrationReadiness,
  defineEntityHandlers,
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
    expect(readiness.registeredEventMessageFullTypeNames()).toEqual([]);
    expect(readiness.findEventSubscribers("spine.core.Event")).toEqual([]);
    expect(readiness.findEventReactors("spine.core.Event")).toEqual([]);
    expect(readiness.findEventApplications("spine.core.Event")).toEqual([]);
    expect(Object.isFrozen(readiness.registeredEventMessageFullTypeNames())).toBe(true);
  });

  it("rejects direct runtime construction without the package factory token", () => {
    const constructor = EventRegistrationReadiness as unknown as new (
      authenticityToken: symbol,
      eventFullTypeNames: readonly string[],
      subscribersByEventFullTypeName: ReadonlyMap<
        string,
        readonly EventRegistrationSubscriberMetadata[]
      >,
      reactorsByEventFullTypeName: ReadonlyMap<string, readonly EventRegistrationReactorMetadata[]>,
      applicationsByEventFullTypeName: ReadonlyMap<
        string,
        readonly EventRegistrationApplicationMetadata[]
      >,
    ) => EventRegistrationReadiness;

    expect(() => {
      Reflect.construct(constructor, [Symbol("external"), [], new Map(), new Map(), new Map()]);
    }).toThrow(
      "EventRegistrationReadiness instances must be created by the package factory methods.",
    );
  });

  it("lists registered event message full type names in deterministic order", () => {
    const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.subscribe(EventSchema, "subscribeCreated"),
      builder.react(AggregateStateSchema, "reactToCreated"),
      builder.apply(EventSchema, "applyCreated", { allowImport: true }),
    ]);
    const readiness = EventRegistrationReadiness.fromRegistry(
      new HandlerMetadataRegistry([handlers]),
    );

    expect(readiness.registeredEventMessageFullTypeNames()).toEqual([
      "AggregateState",
      "spine.core.Event",
    ]);
  });

  it("orders event message names by locale-independent code units", () => {
    const registry = createRegistryLookupForEventNames([
      "example.Event_Alpha",
      "example.Event0Alpha",
      "example.EventAlpha",
      "example.Eventalpha",
    ]);

    const readiness = EventRegistrationReadiness.fromRegistry(registry);

    expect(readiness.registeredEventMessageFullTypeNames()).toEqual([
      "example.Event0Alpha",
      "example.EventAlpha",
      "example.Event_Alpha",
      "example.Eventalpha",
    ]);
  });

  it("preserves subscriber and reactor fan-out for the same event type", () => {
    const projectionHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [
        builder.subscribe(EventSchema, "subscribeCreated"),
        builder.react(EventSchema, "reactToCreated"),
      ],
    );
    const auditHandlers = defineEntityHandlers(AuditProjection, AggregateStateSchema, (builder) => [
      builder.subscribe(EventSchema, "subscribeCreated"),
      builder.react(EventSchema, "reactToCreated"),
    ]);
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
    const projectionHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.apply(EventSchema, "applyCreated", { allowImport: true })],
    );
    const auditHandlers = defineEntityHandlers(AuditProjection, AggregateStateSchema, (builder) => [
      builder.apply(EventSchema, "applyCreated"),
    ]);
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
        entityStateFullTypeName: "ProjectionState",
        handler: { kind: "event-application", methodName: "applyCreated", allowImport: true },
      },
      {
        eventFullTypeName: "spine.core.Event",
        entityStateFullTypeName: "AggregateState",
        handler: { kind: "event-application", methodName: "applyCreated", allowImport: false },
      },
    ]);
  });

  it("keeps duplicate event application failure owned by HandlerMetadataRegistry", () => {
    const first = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.apply(EventSchema, "applyCreated"),
    ]);
    const second = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
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
    const first = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.apply(EventSchema, "applyCreated"),
    ]);
    const second = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
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
    const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.subscribe(EventSchema, "subscribeCreated"),
      builder.react(EventSchema, "reactToCreated"),
      builder.apply(EventSchema, "applyCreated", { allowImport: true }),
    ]);
    const readiness = EventRegistrationReadiness.fromEntityHandlers([handlers]);

    const firstList = readiness.registeredEventMessageFullTypeNames();
    const secondList = readiness.registeredEventMessageFullTypeNames();
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
    expect(readiness.registeredEventMessageFullTypeNames()).toEqual(["spine.core.Event"]);

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
    };
    const mutableEntityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: createProjectionEntityMetadata(),
      handlers: [mutableHandler],
      commandAssignments: [],
      commandReactions: [],
      eventSubscriptions: [mutableHandler],
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
    };
    const mutableEntityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: createProjectionEntityMetadata(),
      handlers: [mutableHandler],
      commandAssignments: [],
      commandReactions: [],
      eventSubscriptions: [mutableHandler],
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

  it("rejects malformed caller-supplied entity semantic tags before routing", () => {
    const handler: EventSubscriptionHandlerMetadata = {
      kind: "event-subscription",
      schema: EventSchema,
      descriptor: EventSchema,
      messageFullTypeName: EventSchema.typeName,
      methodName: "subscribeCreated",
      parameterCount: 1,
    };
    const entityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: metadataWithTags(Object.freeze([null])),
      handlers: [handler],
      commandAssignments: [],
      commandReactions: [],
      eventSubscriptions: [handler],
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
    ).toThrow(/Registration readiness entity semanticTags must be a dense array/);
  });

  it("preserves entity field metadata identity in returned event metadata", () => {
    const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
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
    };
    const entityHandlers: EntityHandlersMetadata = {
      entityType: TaskProjection,
      entity: createProjectionEntityMetadata(),
      handlers: [handler],
      commandAssignments: [],
      commandReactions: [],
      eventSubscriptions: [handler],
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
    findEntityHandlersByState: (entityStateFullTypeName) =>
      eventHandlers
        .map(({ entityHandlers }) => entityHandlers)
        .filter(({ entity }) => entity.fullTypeName === entityStateFullTypeName),
    findHandlersByKind: <Kind extends HandlerKind>(kind: Kind) =>
      eventHandlers.filter(
        ({ handler }) => handler.kind === kind,
      ) as unknown as readonly RegisteredHandlerMetadata<
        Extract<HandlerMetadata, { readonly kind: Kind }>
      >[],
    findHandlersByMessageFullTypeName: (messageFullTypeName) =>
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
  return defineEntityHandlers(TaskProjection, ProjectionStateSchema, () => []).entity;
}

function metadataWithTags(semanticTags: unknown): EntityHandlersMetadata["entity"] {
  return Object.freeze({
    ...createProjectionEntityMetadata(),
    semanticTags,
  }) as EntityHandlersMetadata["entity"];
}
