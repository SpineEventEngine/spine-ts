import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { TypeUrls } from "@spine-event-engine/core";
import { CommandSchema, EventSchema, file_spine_options } from "@spine-event-engine/proto";
import { describe, expect, expectTypeOf, it } from "vitest";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

import {
  BoundedContext,
  CommandRegistrationReadiness,
  EventRegistrationReadiness,
  HandlerMetadataRegistry,
  createRoutingPlan,
  defineEntityHandlers,
  type CommandRuntimeRoutingPlan,
  type DeferredRoutingSeam,
  type EventRuntimeRoutingPlan,
  type ServerRuntimeRoutingPlan,
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

function withPatchedPrototypeMethod<Result>(
  prototype: object,
  methodName: string,
  replacement: unknown,
  run: () => Result,
): Result {
  const descriptor = Object.getOwnPropertyDescriptor(prototype, methodName);

  Object.defineProperty(prototype, methodName, {
    configurable: true,
    value: replacement,
  });

  try {
    return run();
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(prototype, methodName);
    } else {
      Object.defineProperty(prototype, methodName, descriptor);
    }
  }
}

describe("server runtime routing", () => {
  it("plans deterministic command topics and one competing-consumer command worker id", () => {
    const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
      builder.assign(CommandSchema, "assignCreate"),
      builder.assign(AggregateStateSchema, "assignArchive"),
    ]);
    const plan = createRoutingPlan({
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
      { signalKind: "command", messageTypeUrl: TypeUrls.derive(AggregateStateSchema) },
      { signalKind: "command", messageTypeUrl: TypeUrls.derive(CommandSchema) },
    ]);
    expect(plan.commands.topics.map(({ semanticTags }) => semanticTags)).toEqual([
      ["example.tags.ProjectionTag", "example.tags.SharedTag"],
      ["example.tags.ProjectionTag", "example.tags.SharedTag"],
    ]);
    expect(
      plan.commands.subscriptions.map(({ subscriberId, mode }) => ({ subscriberId, mode })),
    ).toEqual([
      { subscriberId: "command-worker-1", mode: "competing-consumer" },
      { subscriberId: "command-worker-1", mode: "competing-consumer" },
    ]);
    expect(plan.commands.workerIds).toEqual(["command-worker-1"]);
    expect(plan.commands.routes).toMatchObject([
      {
        routeId: "command-route-1",
        workerId: "command-worker-1",
        receiverGroup: "command-assignee",
        topicRoutingKey: plan.commands.topics[0]?.routing.routingKey,
        subscriptionDescriptorKey: plan.commands.subscriptions[0]?.descriptorKey,
        message: {
          fullTypeName: "AggregateState",
          typeUrl: TypeUrls.derive(AggregateStateSchema),
        },
      },
      {
        routeId: "command-route-2",
        workerId: "command-worker-1",
        receiverGroup: "command-assignee",
        topicRoutingKey: plan.commands.topics[1]?.routing.routingKey,
        subscriptionDescriptorKey: plan.commands.subscriptions[1]?.descriptorKey,
        message: {
          fullTypeName: "spine.core.Command",
          typeUrl: TypeUrls.derive(CommandSchema),
        },
      },
    ]);
    expect(plan.commands.routes[0]).not.toHaveProperty("topic");
    expect(plan.commands.routes[0]).not.toHaveProperty("subscription");
    expect(plan.commands.routes[0]).not.toHaveProperty("worker");
    expect(plan.commands.routes[0]).not.toHaveProperty("workerRegistrationKey");
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
    const plan = createRoutingPlan({
      context: BoundedContext.multitenant("Tasks").build(),
      events: EventRegistrationReadiness.fromEntityHandlers([
        projectionHandlers,
        aggregateHandlers,
      ]),
    });

    expectTypeOf<typeof plan.events>().toEqualTypeOf<EventRuntimeRoutingPlan>();
    expectTypeOf<(typeof plan.deferred)[number]>().toEqualTypeOf<DeferredRoutingSeam>();
    expect(
      plan.events.topics.map(({ signalKind, messageTypeUrl }) => ({ signalKind, messageTypeUrl })),
    ).toEqual([{ signalKind: "event", messageTypeUrl: TypeUrls.derive(EventSchema) }]);
    expect(plan.events.topics.map(({ semanticTags }) => semanticTags)).toEqual([
      ["example.tags.AggregateTag", "example.tags.ProjectionTag", "example.tags.SharedTag"],
    ]);
    expect(plan.events.subscriberRoutes).toHaveLength(2);
    expect(plan.events.reactorRoutes).toHaveLength(1);
    expect(plan.events.applicationRoutes).toHaveLength(1);
    expect(plan.events.subscriptions.every(({ mode }) => mode === "fan-out")).toBe(true);
    expect(plan.events.workerIds).toEqual([
      "event-application-worker-1",
      "event-reactor-worker-1",
      "event-subscriber-worker-1",
      "event-subscriber-worker-2",
    ]);

    const subscriberDescriptorKeys = plan.events.subscriberRoutes.map(
      ({ subscriptionDescriptorKey }) => subscriptionDescriptorKey,
    );
    const subscriberTopicKeys = plan.events.subscriberRoutes.map(
      ({ topicRoutingKey }) => topicRoutingKey,
    );
    const firstSubscriberRoute = plan.events.subscriberRoutes[0];
    const secondSubscriberRoute = plan.events.subscriberRoutes[1];
    expect(new Set(subscriberDescriptorKeys).size).toBe(2);
    expect(new Set(subscriberTopicKeys).size).toBe(1);
    expect(plan.events.subscriberRoutes).toMatchObject([
      {
        routeId: "event-subscriber-route-1",
        workerId: "event-subscriber-worker-1",
        receiverGroup: "subscriber",
        topicRoutingKey: plan.events.topics[0]?.routing.routingKey,
        subscriptionDescriptorKey: firstSubscriberRoute?.subscriptionDescriptorKey,
        message: {
          fullTypeName: EventSchema.typeName,
          typeUrl: TypeUrls.derive(EventSchema),
        },
      },
      {
        routeId: "event-subscriber-route-2",
        workerId: "event-subscriber-worker-2",
        receiverGroup: "subscriber",
        topicRoutingKey: plan.events.topics[0]?.routing.routingKey,
        subscriptionDescriptorKey: secondSubscriberRoute?.subscriptionDescriptorKey,
        message: {
          fullTypeName: EventSchema.typeName,
          typeUrl: TypeUrls.derive(EventSchema),
        },
      },
    ]);
    expect(plan.events.subscriberRoutes[0]).not.toHaveProperty("topic");
    expect(plan.events.subscriberRoutes[0]).not.toHaveProperty("subscription");
    expect(plan.events.subscriberRoutes[0]).not.toHaveProperty("worker");
    expect(plan.events.subscriberRoutes[0]).not.toHaveProperty("workerRegistrationKey");
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
    const plan = createRoutingPlan({
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
    const absentReadinessPlan = createRoutingPlan({
      context,
    });
    const emptyReadinessPlan = createRoutingPlan({
      context,
      commands: emptyCommandReadiness,
      events: emptyEventReadiness,
    });

    expect(absentReadinessPlan.commands).toEqual({
      topics: [],
      subscriptions: [],
      workerIds: [],
      routes: [],
    });
    expect(absentReadinessPlan.events).toEqual({
      topics: [],
      subscriptions: [],
      workerIds: [],
      subscriberRoutes: [],
      reactorRoutes: [],
      applicationRoutes: [],
    });
    expect(emptyReadinessPlan.commands.routes).toEqual([]);
    expect(emptyReadinessPlan.events.subscriberRoutes).toEqual([]);
  });

  it("rejects malformed context and non-authentic readiness inputs", () => {
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
      createRoutingPlan({
        context: {} as BoundedContext,
      }),
    ).toThrow(/requires a built BoundedContext/);

    expect(() =>
      createRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        commands: {
          registeredCommandMessageFullTypeNames: () => Object.freeze([CommandSchema.typeName]),
          findCommandAssignee: () => undefined,
        } as unknown as CommandRegistrationReadiness,
      }),
    ).toThrow(/must be an authentic CommandRegistrationReadiness instance/);

    expect(() =>
      createRoutingPlan({
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
    ).toThrow(/must be an authentic EventRegistrationReadiness instance/);
  });

  it("rejects prototype-forged command readiness before override methods run", () => {
    const commandHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.assign(CommandSchema, "assignCreate")],
    );
    const commandReadiness = CommandRegistrationReadiness.fromEntityHandlers([commandHandlers]);
    let overrideCalls = 0;

    const forgedCommandReadiness = overrideReadiness(commandReadiness, {
      registeredCommandMessageFullTypeNames: () => {
        overrideCalls += 1;
        throw new Error("forged command readiness names override should not run");
      },
      findCommandAssignee: () => {
        overrideCalls += 1;
        throw new Error("forged command readiness assignee override should not run");
      },
    });

    expect(() =>
      createRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        commands: forgedCommandReadiness,
      }),
    ).toThrow(/must be an authentic CommandRegistrationReadiness instance/);
    expect(overrideCalls).toBe(0);
  });

  it("rejects prototype-forged event readiness before override methods run", () => {
    const projectionHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(EventSchema, "subscribeCreated")],
    );
    const eventReadiness = EventRegistrationReadiness.fromEntityHandlers([projectionHandlers]);
    let overrideCalls = 0;

    const forgedEventReadiness = overrideReadiness(eventReadiness, {
      registeredEventMessageFullTypeNames: () => {
        overrideCalls += 1;
        throw new Error("forged event readiness names override should not run");
      },
      findEventSubscribers: () => {
        overrideCalls += 1;
        throw new Error("forged event readiness subscribers override should not run");
      },
      findEventReactors: () => {
        overrideCalls += 1;
        throw new Error("forged event readiness reactors override should not run");
      },
      findEventApplications: () => {
        overrideCalls += 1;
        throw new Error("forged event readiness applications override should not run");
      },
    });

    expect(() =>
      createRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        events: forgedEventReadiness,
      }),
    ).toThrow(/must be an authentic EventRegistrationReadiness instance/);
    expect(overrideCalls).toBe(0);
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
      createRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        commands: proxiedReadiness,
      }),
    ).toThrow(
      new TypeError(
        "Server runtime routing commands must be an authentic CommandRegistrationReadiness instance.",
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
      createRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        events: proxiedReadiness,
      }),
    ).toThrow(
      new TypeError(
        "Server runtime routing events must be an authentic EventRegistrationReadiness instance.",
      ),
    );
    expect(trapCalls).toBe(0);
  });

  it("uses planner-local indexed event worker identities for authentic event fan-out", () => {
    const projectionHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(EventSchema, "subscribeCreated")],
    );
    const aggregateHandlers = defineEntityHandlers(
      TaskAggregate,
      AggregateStateSchema,
      (builder) => [builder.subscribe(EventSchema, "subscribeCreated")],
    );
    const plan = createRoutingPlan({
      context: BoundedContext.singleTenant("Tasks").build(),
      events: EventRegistrationReadiness.fromEntityHandlers([
        projectionHandlers,
        aggregateHandlers,
      ]),
    });

    expect(plan.events.subscriberRoutes.map(({ workerId }) => workerId)).toEqual([
      "event-subscriber-worker-1",
      "event-subscriber-worker-2",
    ]);
    expect(new Set(plan.events.workerIds).size).toBe(2);
  });

  it("rejects prototype-forged readiness even when forged metadata looks malformed", () => {
    const commandHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.assign(CommandSchema, "assignCreate")],
    );
    const projectionHandlers = defineEntityHandlers(
      TaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(EventSchema, "subscribeCreated")],
    );
    const commandReadiness = CommandRegistrationReadiness.fromEntityHandlers([commandHandlers]);
    const eventReadiness = EventRegistrationReadiness.fromEntityHandlers([projectionHandlers]);
    const forgedCommandReadiness = overrideReadiness(commandReadiness, {
      findCommandAssignee: () => undefined,
    });
    const forgedEventReadiness = overrideReadiness(eventReadiness, {
      findEventSubscribers: () => Object.freeze([]),
      findEventReactors: () => Object.freeze([]),
      findEventApplications: () => Object.freeze([]),
    });

    expect(() =>
      createRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        commands: forgedCommandReadiness,
      }),
    ).toThrow(/must be an authentic CommandRegistrationReadiness instance/);

    expect(() =>
      createRoutingPlan({
        context: BoundedContext.singleTenant("Tasks").build(),
        events: forgedEventReadiness,
      }),
    ).toThrow(/must be an authentic EventRegistrationReadiness instance/);
  });

  it("rejects malformed authentic command readiness metadata deterministically", () => {
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

    const expectPatchedAssignee = (value: unknown, pattern: RegExp) => {
      withPatchedPrototypeMethod(
        CommandRegistrationReadiness.prototype,
        "findCommandAssignee",
        () => value,
        () => {
          expect(() =>
            createRoutingPlan({
              context: BoundedContext.singleTenant("Tasks").build(),
              commands: commandReadiness,
            }),
          ).toThrow(pattern);
        },
      );
    };

    expectPatchedAssignee(undefined, /must return assignee metadata/);
    expectPatchedAssignee(null, /must be an object/);
    expectPatchedAssignee(
      Object.freeze({
        ...assignee,
        commandFullTypeName: "example.WrongCommand",
      }),
      /must preserve commandFullTypeName/,
    );
    expectPatchedAssignee(
      Object.freeze({
        ...assignee,
        handler: null,
      }),
      /must expose a command-assignment handler/,
    );
    expectPatchedAssignee(
      Object.freeze({
        ...assignee,
        handler: Object.freeze({
          ...assignee.handler,
          messageFullTypeName: "example.WrongCommand",
        }),
      }),
      /must preserve the requested command message type/,
    );
    expectPatchedAssignee(
      Object.freeze({
        ...assignee,
        handler: Object.freeze({
          ...assignee.handler,
          schema: null,
        }),
      }),
      /must preserve the requested command message type/,
    );
    expectPatchedAssignee(
      Object.freeze({
        ...assignee,
        handler: Object.freeze({
          ...assignee.handler,
          schema: Object.freeze({ typeName: "example.WrongCommand" }),
        }),
      }),
      /must preserve the requested command message type/,
    );
    expectPatchedAssignee(
      Object.freeze({
        ...assignee,
        handler: Object.freeze({
          ...assignee.handler,
          schema: Object.freeze({ typeName: CommandSchema.typeName }),
        }),
      }),
      /command metadata for "spine.core.Command" is malformed/,
    );
  });

  it("rejects malformed authentic event readiness metadata deterministically", () => {
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

    const expectPatchedSubscribers = (value: unknown, pattern: RegExp) => {
      withPatchedPrototypeMethod(
        EventRegistrationReadiness.prototype,
        "findEventSubscribers",
        () => value,
        () => {
          expect(() =>
            createRoutingPlan({
              context: BoundedContext.singleTenant("Tasks").build(),
              events: eventReadiness,
            }),
          ).toThrow(pattern);
        },
      );
    };

    expectPatchedSubscribers(undefined, /receivers for "spine.core.Event" must be an array/);
    expectPatchedSubscribers(Object.freeze([null]), /must be an object/);
    expectPatchedSubscribers(
      Object.freeze([
        Object.freeze({
          ...subscriber,
          eventFullTypeName: "example.WrongEvent",
        }),
      ]),
      /must match the requested eventFullTypeName/,
    );
    expectPatchedSubscribers(
      Object.freeze([
        Object.freeze({
          ...subscriber,
          handler: Object.freeze({
            ...subscriber.handler,
            kind: "event-reaction" as const,
          }),
        }),
      ]),
      /must expose an event-subscription handler/,
    );
    expectPatchedSubscribers(
      Object.freeze([
        Object.freeze({
          ...subscriber,
          handler: Object.freeze({
            ...subscriber.handler,
            messageFullTypeName: "example.WrongEvent",
          }),
        }),
      ]),
      /must preserve the requested event message type/,
    );
    expectPatchedSubscribers(
      Object.freeze([
        Object.freeze({
          ...subscriber,
          handler: Object.freeze({
            ...subscriber.handler,
            schema: null,
          }),
        }),
      ]),
      /must preserve the requested event message type/,
    );
    expectPatchedSubscribers(
      Object.freeze([
        Object.freeze({
          ...subscriber,
          handler: Object.freeze({
            ...subscriber.handler,
            schema: Object.freeze({ typeName: "example.WrongEvent" }),
          }),
        }),
      ]),
      /must preserve the requested event message type/,
    );
    expectPatchedSubscribers(
      Object.freeze([
        Object.freeze({
          ...subscriber,
          handler: Object.freeze({
            ...subscriber.handler,
            schema: Object.freeze({ typeName: EventSchema.typeName }),
          }),
        }),
      ]),
      /event metadata for "spine.core.Event" is malformed/,
    );
  });
});
