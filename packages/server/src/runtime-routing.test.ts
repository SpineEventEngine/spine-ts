import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl } from "@spine-ts/core";
import { CommandSchema, EventSchema, file_spine_options } from "@spine-ts/proto";
import { describe, expect, expectTypeOf, it } from "vitest";
import { serverEntityMetadataTestFixtures } from "../test-fixtures/entity-metadata-fixtures.js";

import {
  BoundedContext,
  CommandRegistrationReadiness,
  EventRegistrationReadiness,
  HandlerMetadataRegistry,
  createServerRuntimeRoutingPlan,
  defineEntityHandlers,
  type CommandRuntimeRoutingPlan,
  type DeferredServerRuntimeRoutingSeam,
  type EventRuntimeRoutingPlan,
  type ServerRuntimeRoutingPlan,
} from "./index.js";

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

class TaskProjection {
  assignCreate(command: Message<"spine.core.Command">): void {
    void command;
  }

  assignArchive(command: Message<"AggregateState">): void {
    void command;
  }

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

class TaskAggregate {
  assignArchive(command: Message<"AggregateState">): void {
    void command;
  }

  subscribeCreated(event: Message<"spine.core.Event">): void {
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
    throw new Error("Server runtime routing fixture descriptor set is empty.");
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

function overrideReadiness<Readiness extends object>(
  readiness: Readiness,
  overrides: Partial<Record<keyof Readiness, unknown>>,
): Readiness {
  const prototype = Object.getPrototypeOf(readiness) as object;
  const clone = Object.create(prototype) as Record<PropertyKey, unknown>;

  for (const property of Reflect.ownKeys(prototype)) {
    if (property === "constructor") {
      continue;
    }

    const value = Reflect.get(readiness, property);

    if (typeof value === "function") {
      clone[property] = value.bind(readiness);
    }
  }

  for (const [property, value] of Object.entries(overrides)) {
    clone[property] = value;
  }

  return clone as Readiness;
}

describe("server runtime routing", () => {
  it("plans deterministic command topics and one competing-consumer command worker", () => {
    const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
      builder.assign(AggregateStateSchema, "assignArchive"),
    ]);
    const plan = createServerRuntimeRoutingPlan({
      context: BoundedContext.singleTenant("Tasks").build(),
      commands: CommandRegistrationReadiness.fromEntityHandlers([handlers]),
    });

    expectTypeOf<typeof plan>().toExtend<ServerRuntimeRoutingPlan>();
    expectTypeOf<typeof plan.commands>().toEqualTypeOf<CommandRuntimeRoutingPlan>();
    expect(plan.context.name.value).toBe("Tasks");
    expect(plan.commands.routes.map(({ message }) => message.fullTypeName)).toEqual([
      "AggregateState",
      "spine.core.Command",
    ]);
    expect(
      plan.commands.topics.map(({ signalKind, messageTypeUrl }) => ({
        signalKind,
        messageTypeUrl,
      })),
    ).toEqual([
      { signalKind: "command", messageTypeUrl: deriveTypeUrl(AggregateStateSchema) },
      { signalKind: "command", messageTypeUrl: deriveTypeUrl(CommandSchema) },
    ]);
    expect(
      plan.commands.subscriptions.map(({ subscriberId, mode }) => ({ subscriberId, mode })),
    ).toEqual([
      { subscriberId: "command-worker-1", mode: "competing-consumer" },
      { subscriberId: "command-worker-1", mode: "competing-consumer" },
    ]);
    expect(plan.commands.workers).toHaveLength(1);
    expect(plan.commands.workers[0]).toMatchObject({
      worker: {
        participantKind: "worker",
        participantId: "command-worker-1",
        workerRole: "command-worker",
      },
      signalKinds: ["command"],
    });
    expect(plan.commands.workers[0]?.subscriptions).toEqual(plan.commands.subscriptions);
    expect(plan.commands.routes).toMatchObject([
      {
        routeId: "command-route-1",
        workerId: "command-worker-1",
        receiverGroup: "command-assignee",
        topicRoutingKey: plan.commands.topics[0]?.routing.routingKey,
        subscriptionDescriptorKey: plan.commands.subscriptions[0]?.descriptorKey,
        workerRegistrationKey: plan.commands.workers[0]?.registrationKey,
        message: {
          fullTypeName: "AggregateState",
          typeUrl: deriveTypeUrl(AggregateStateSchema),
        },
      },
      {
        routeId: "command-route-2",
        workerId: "command-worker-1",
        receiverGroup: "command-assignee",
        topicRoutingKey: plan.commands.topics[1]?.routing.routingKey,
        subscriptionDescriptorKey: plan.commands.subscriptions[1]?.descriptorKey,
        workerRegistrationKey: plan.commands.workers[0]?.registrationKey,
        message: {
          fullTypeName: "spine.core.Command",
          typeUrl: deriveTypeUrl(CommandSchema),
        },
      },
    ]);
    expect(plan.commands.routes[0]).not.toHaveProperty("topic");
    expect(plan.commands.routes[0]).not.toHaveProperty("subscription");
    expect(plan.commands.routes[0]).not.toHaveProperty("worker");
  });

  it("plans event fan-out routes for subscribers, reactors, and applications while deferring other seams", () => {
    const projectionHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [
        builder.subscribe(EventSchema, "subscribeCreated"),
        builder.react(EventSchema, "reactToCreated"),
        builder.apply(EventSchema, "applyCreated", { allowImport: true }),
      ],
    );
    const aggregateHandlers = defineEntityHandlers(
      TaskAggregate,
      AggregateStateSchema,
      (builder) => [builder.subscribe(EventSchema, "subscribeCreated")],
    );
    const plan = createServerRuntimeRoutingPlan({
      context: BoundedContext.multitenant("Tasks").build(),
      events: EventRegistrationReadiness.fromEntityHandlers([
        projectionHandlers,
        aggregateHandlers,
      ]),
    });

    expectTypeOf<typeof plan.events>().toEqualTypeOf<EventRuntimeRoutingPlan>();
    expectTypeOf<
      (typeof plan.deferred)[number]
    >().toEqualTypeOf<DeferredServerRuntimeRoutingSeam>();
    expect(
      plan.events.topics.map(({ signalKind, messageTypeUrl }) => ({ signalKind, messageTypeUrl })),
    ).toEqual([{ signalKind: "event", messageTypeUrl: deriveTypeUrl(EventSchema) }]);
    expect(plan.events.subscriberRoutes).toHaveLength(2);
    expect(plan.events.reactorRoutes).toHaveLength(1);
    expect(plan.events.applicationRoutes).toHaveLength(1);
    expect(plan.events.subscriptions.every(({ mode }) => mode === "fan-out")).toBe(true);
    expect(plan.events.workers.every(({ worker }) => worker.workerRole === "event-worker")).toBe(
      true,
    );

    const subscriberDescriptorKeys = plan.events.subscriberRoutes.map(
      ({ subscriptionDescriptorKey }) => subscriptionDescriptorKey,
    );
    const subscriberTopicKeys = plan.events.subscriberRoutes.map(
      ({ topicRoutingKey }) => topicRoutingKey,
    );
    const firstSubscriberRoute = plan.events.subscriberRoutes[0];
    const secondSubscriberRoute = plan.events.subscriberRoutes[1];
    const firstSubscriberWorker = plan.events.workers.find(
      ({ worker }) => worker.participantId === firstSubscriberRoute?.workerId,
    );
    const secondSubscriberWorker = plan.events.workers.find(
      ({ worker }) => worker.participantId === secondSubscriberRoute?.workerId,
    );

    expect(new Set(subscriberDescriptorKeys).size).toBe(2);
    expect(new Set(subscriberTopicKeys).size).toBe(1);
    expect(plan.events.subscriberRoutes).toMatchObject([
      {
        routeId: "event-subscriber-route-1",
        workerId: "event-subscriber-worker-1",
        receiverGroup: "subscriber",
        topicRoutingKey: plan.events.topics[0]?.routing.routingKey,
        subscriptionDescriptorKey: firstSubscriberRoute?.subscriptionDescriptorKey,
        workerRegistrationKey: firstSubscriberWorker?.registrationKey,
        message: {
          fullTypeName: EventSchema.typeName,
          typeUrl: deriveTypeUrl(EventSchema),
        },
      },
      {
        routeId: "event-subscriber-route-2",
        workerId: "event-subscriber-worker-2",
        receiverGroup: "subscriber",
        topicRoutingKey: plan.events.topics[0]?.routing.routingKey,
        subscriptionDescriptorKey: secondSubscriberRoute?.subscriptionDescriptorKey,
        workerRegistrationKey: secondSubscriberWorker?.registrationKey,
        message: {
          fullTypeName: EventSchema.typeName,
          typeUrl: deriveTypeUrl(EventSchema),
        },
      },
    ]);
    expect(plan.events.subscriberRoutes[0]).not.toHaveProperty("topic");
    expect(plan.events.subscriberRoutes[0]).not.toHaveProperty("subscription");
    expect(plan.events.subscriberRoutes[0]).not.toHaveProperty("worker");
    expect(plan.deferred.map(({ signalKind, status }) => ({ signalKind, status }))).toEqual([
      { signalKind: "query", status: "deferred" },
      { signalKind: "subscription", status: "deferred" },
      { signalKind: "system", status: "deferred" },
    ]);
  });

  it("returns a frozen copy-safe plan without dispatch, socket, or endpoint APIs", () => {
    const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
      builder.subscribe(EventSchema, "subscribeCreated"),
    ]);
    const plan = createServerRuntimeRoutingPlan({
      context: BoundedContext.singleTenant("Tasks").build(),
      commands: CommandRegistrationReadiness.fromEntityHandlers([handlers]),
      events: EventRegistrationReadiness.fromEntityHandlers([handlers]),
    });

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.context)).toBe(true);
    expect(Object.isFrozen(plan.commands)).toBe(true);
    expect(Object.isFrozen(plan.commands.topics)).toBe(true);
    expect(Object.isFrozen(plan.events.subscriberRoutes)).toBe(true);
    expect(Object.isFrozen(plan.deferred)).toBe(true);
    expect(() => {
      (
        plan.commands.topics as unknown as {
          signalKind: string;
        }[]
      ).push({ signalKind: "event" });
    }).toThrow(TypeError);
    expect(() => {
      (
        plan.events.subscriberRoutes[0] as unknown as {
          subscriptionDescriptorKey: string;
        }
      ).subscriptionDescriptorKey = "mutated-subscriber";
    }).toThrow(TypeError);
    expect(plan).not.toHaveProperty("dispatch");
    expect(plan).not.toHaveProperty("publish");
    expect(plan).not.toHaveProperty("socket");
    expect(plan).not.toHaveProperty("endpoint");
    expect(plan).not.toHaveProperty("storage");
    expect(plan.commands.routes[0]).not.toHaveProperty("assignee");
    expect(plan.events.subscriberRoutes[0]).not.toHaveProperty("receiver");
  });

  it("returns empty command and event routing plans when readiness is absent or empty", () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const emptyCommandReadiness = CommandRegistrationReadiness.fromRegistry(
      new HandlerMetadataRegistry(),
    );
    const emptyEventReadiness = EventRegistrationReadiness.fromRegistry(
      new HandlerMetadataRegistry(),
    );
    const absentReadinessPlan = createServerRuntimeRoutingPlan({
      context,
    });
    const emptyReadinessPlan = createServerRuntimeRoutingPlan({
      context,
      commands: emptyCommandReadiness,
      events: emptyEventReadiness,
    });

    expect(absentReadinessPlan.commands).toEqual({
      topics: [],
      subscriptions: [],
      workers: [],
      routes: [],
    });
    expect(absentReadinessPlan.events).toEqual({
      topics: [],
      subscriptions: [],
      workers: [],
      subscriberRoutes: [],
      reactorRoutes: [],
      applicationRoutes: [],
    });
    expect(emptyReadinessPlan.commands.routes).toEqual([]);
    expect(emptyReadinessPlan.events.subscriberRoutes).toEqual([]);
  });

  it("rejects malformed context and non-readiness lookup inputs", () => {
    const projectionHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(EventSchema, "subscribeCreated")],
    );
    const validEventReadiness = EventRegistrationReadiness.fromEntityHandlers([projectionHandlers]);
    const validSubscriber = validEventReadiness.findEventSubscribers(EventSchema.typeName)[0];

    if (validSubscriber === undefined) {
      throw new Error("Expected valid event subscriber metadata.");
    }

    expect(() =>
      createServerRuntimeRoutingPlan({
        context: {} as BoundedContext,
      }),
    ).toThrow(/requires a built BoundedContext/);

    expect(() =>
      createServerRuntimeRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        commands: {
          registeredCommandMessageFullTypeNames: () => Object.freeze([CommandSchema.typeName]),
          findCommandAssignee: () => undefined,
        } as unknown as CommandRegistrationReadiness,
      }),
    ).toThrow(/must be a CommandRegistrationReadiness instance/);

    expect(() =>
      createServerRuntimeRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        events: {
          registeredEventMessageFullTypeNames: () => Object.freeze([EventSchema.typeName]),
          findEventSubscribers: () =>
            Object.freeze([
              {
                ...validSubscriber,
                eventFullTypeName: "example.WrongEvent",
              },
            ]),
          findEventReactors: () => Object.freeze([]),
          findEventApplications: () => Object.freeze([]),
        } as unknown as EventRegistrationReadiness,
      }),
    ).toThrow(/must be an EventRegistrationReadiness instance/);
  });

  it("rejects malformed readiness metadata and receiverless event listings", () => {
    const commandHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.assign(CommandSchema, "assignCreate")],
    );
    const commandReadiness = CommandRegistrationReadiness.fromEntityHandlers([commandHandlers]);
    const assignee = commandReadiness.findCommandAssignee(CommandSchema.typeName);

    if (assignee === undefined) {
      throw new Error("Expected valid command assignee metadata.");
    }

    const malformedCommandReadiness = overrideReadiness(commandReadiness, {
      findCommandAssignee: () =>
        Object.freeze({
          ...assignee,
          handler: Object.freeze({
            ...assignee.handler,
            kind: "event-subscription" as const,
          }),
        }),
    });

    expect(() =>
      createServerRuntimeRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        commands: malformedCommandReadiness,
      }),
    ).toThrow(/must expose a command-assignment handler/);

    const projectionHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(EventSchema, "subscribeCreated")],
    );
    const eventReadiness = EventRegistrationReadiness.fromEntityHandlers([projectionHandlers]);
    const receiverlessEventReadiness = overrideReadiness(eventReadiness, {
      registeredEventMessageFullTypeNames: () => Object.freeze([EventSchema.typeName]),
      findEventSubscribers: () => Object.freeze([]),
      findEventReactors: () => Object.freeze([]),
      findEventApplications: () => Object.freeze([]),
    });

    expect(() =>
      createServerRuntimeRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        events: receiverlessEventReadiness,
      }),
    ).toThrow(/must return at least one receiver/);

    const subscriber = eventReadiness.findEventSubscribers(EventSchema.typeName)[0];

    if (subscriber === undefined) {
      throw new Error("Expected valid event subscriber metadata.");
    }

    const malformedEventReadiness = overrideReadiness(eventReadiness, {
      findEventSubscribers: () =>
        Object.freeze([
          Object.freeze({
            ...subscriber,
            handler: Object.freeze({
              ...subscriber.handler,
              messageFullTypeName: "example.WrongEvent",
            }),
          }),
        ]),
    });

    expect(() =>
      createServerRuntimeRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        events: malformedEventReadiness,
      }),
    ).toThrow(/must preserve the requested event message type/);
  });

  it("rejects proxy-wrapped command readiness before proxy traps can run", () => {
    const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
    ]);
    const readiness = CommandRegistrationReadiness.fromEntityHandlers([handlers]);
    let trapCalls = 0;

    const proxiedReadiness = new Proxy(readiness, {
      get() {
        trapCalls += 1;
        throw new Error("command proxy trap should not run");
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error("command proxy prototype trap should not run");
      },
    });

    expect(() =>
      createServerRuntimeRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        commands: proxiedReadiness,
      }),
    ).toThrow(
      new TypeError(
        "Server runtime routing commands must not be a Proxy-wrapped CommandRegistrationReadiness instance.",
      ),
    );
    expect(trapCalls).toBe(0);
  });

  it("rejects proxy-wrapped event readiness before proxy traps can run", () => {
    const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.subscribe(EventSchema, "subscribeCreated"),
    ]);
    const readiness = EventRegistrationReadiness.fromEntityHandlers([handlers]);
    let trapCalls = 0;

    const proxiedReadiness = new Proxy(readiness, {
      get() {
        trapCalls += 1;
        throw new Error("event proxy trap should not run");
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error("event proxy prototype trap should not run");
      },
    });

    expect(() =>
      createServerRuntimeRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        events: proxiedReadiness,
      }),
    ).toThrow(
      new TypeError(
        "Server runtime routing events must not be a Proxy-wrapped EventRegistrationReadiness instance.",
      ),
    );
    expect(trapCalls).toBe(0);
  });

  it("uses planner-local indexed event worker identities without lossy merges", () => {
    const projectionHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(EventSchema, "subscribeCreated")],
    );
    const eventReadiness = EventRegistrationReadiness.fromEntityHandlers([projectionHandlers]);
    const subscriber = eventReadiness.findEventSubscribers(EventSchema.typeName)[0];

    if (subscriber === undefined) {
      throw new Error("Expected valid event subscriber metadata.");
    }

    const collidingEventReadiness = overrideReadiness(eventReadiness, {
      findEventSubscribers: () =>
        Object.freeze([
          Object.freeze({
            ...subscriber,
            entity: Object.freeze({
              ...subscriber.entity,
              fullTypeName: "Example.Foo_Bar",
            }),
            handler: Object.freeze({
              ...subscriber.handler,
              methodName: "handleValue",
            }),
          }),
          Object.freeze({
            ...subscriber,
            entity: Object.freeze({
              ...subscriber.entity,
              fullTypeName: "Example.Foo-Bar",
            }),
            handler: Object.freeze({
              ...subscriber.handler,
              methodName: "handle-value",
            }),
          }),
        ]),
    });
    const plan = createServerRuntimeRoutingPlan({
      context: BoundedContext.singleTenant("Tasks").build(),
      events: collidingEventReadiness,
    });

    expect(plan.events.subscriberRoutes.map(({ workerId }) => workerId)).toEqual([
      "event-subscriber-worker-1",
      "event-subscriber-worker-2",
    ]);
    expect(new Set(plan.events.workers.map(({ worker }) => worker.participantId)).size).toBe(2);
    expect(JSON.stringify(plan.events.subscriberRoutes)).not.toMatch(/Foo|handle/i);
  });

  it("fails closed when handler schemas are missing, mismatched, or malformed", () => {
    const commandHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.assign(CommandSchema, "assignCreate")],
    );
    const commandReadiness = CommandRegistrationReadiness.fromEntityHandlers([commandHandlers]);
    const assignee = commandReadiness.findCommandAssignee(CommandSchema.typeName);

    if (assignee === undefined) {
      throw new Error("Expected valid command assignee metadata.");
    }

    const nullSchemaCommandReadiness = overrideReadiness(commandReadiness, {
      findCommandAssignee: () =>
        Object.freeze({
          ...assignee,
          handler: Object.freeze({
            ...assignee.handler,
            schema: null,
          }),
        }),
    });

    expect(() =>
      createServerRuntimeRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        commands: nullSchemaCommandReadiness,
      }),
    ).toThrow(/must preserve the requested command message type/);

    const malformedSchemaCommandReadiness = overrideReadiness(commandReadiness, {
      findCommandAssignee: () =>
        Object.freeze({
          ...assignee,
          handler: Object.freeze({
            ...assignee.handler,
            schema: Object.freeze({
              typeName: CommandSchema.typeName,
            }),
          }),
        }),
    });

    expect(() =>
      createServerRuntimeRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        commands: malformedSchemaCommandReadiness,
      }),
    ).toThrow(/Server runtime routing command metadata for "spine\.core\.Command" is malformed/);

    const projectionHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(EventSchema, "subscribeCreated")],
    );
    const eventReadiness = EventRegistrationReadiness.fromEntityHandlers([projectionHandlers]);
    const subscriber = eventReadiness.findEventSubscribers(EventSchema.typeName)[0];

    if (subscriber === undefined) {
      throw new Error("Expected valid event subscriber metadata.");
    }

    const mismatchedEventSchemaReadiness = overrideReadiness(eventReadiness, {
      findEventSubscribers: () =>
        Object.freeze([
          Object.freeze({
            ...subscriber,
            handler: Object.freeze({
              ...subscriber.handler,
              schema: Object.freeze({
                ...subscriber.handler.schema,
                typeName: "example.WrongEvent",
              }),
            }),
          }),
        ]),
    });

    expect(() =>
      createServerRuntimeRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        events: mismatchedEventSchemaReadiness,
      }),
    ).toThrow(/must preserve the requested event message type/);
  });
});
