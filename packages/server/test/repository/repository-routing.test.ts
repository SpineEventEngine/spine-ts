import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  BoolValueSchema,
  DoubleValueSchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { packAny, packCommand, packEvent, unpackAny } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  type Event as SpineEvent,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  TenantIdSchema,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import {
  EventStore,
  InMemoryStorageFactory,
  RecordStorage,
  type RecordSpec,
  type StorageContext,
} from "@spine-ts/storage";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  Aggregate,
  AggregateStorage,
  BoundedContext,
  Repository,
  RepositoryIdentityError,
  defineEntityHandlers,
  type EntityHandlersMetadata,
  type EventDispatcher,
} from "../../src/index.js";
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
    throw new Error("Repository routing fixture descriptor set is empty.");
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

class TaskAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(command: AggregateState): void {
    void command;
  }

  reactToProjection(event: ProjectionState): void {
    void event;
  }
}

class ExecutingTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static assigneeCalls = 0;
  static applierCalls = 0;

  static reset(): void {
    this.assigneeCalls = 0;
    this.applierCalls = 0;
  }

  assignTask(command: AggregateState) {
    ExecutingTaskAggregate.assigneeCalls++;

    if (command.name === "Multi") {
      return [
        createAggregateEvent("event-Multi-1", command.id, 0, "Multi one"),
        createAggregateEvent("event-Multi-2", command.id, 0, "Multi two"),
      ];
    }

    return packEvent({
      id: create(EventIdSchema, { value: `event-${command.name}` }),
      context: create(EventContextSchema),
      schema: AggregateStateSchema,
      message: create(AggregateStateSchema, {
        id: command.id,
        name: command.name,
        archived: false,
      }),
    });
  }

  applyTask(event: AggregateState): void {
    ExecutingTaskAggregate.applierCalls++;
    this.startTransaction();
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: event.id,
        name: `${event.name} (applied)`,
        archived: true,
      }),
    );
    this.commitTransaction();
  }
}

class AsyncAssigneeAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static resolveCommand: ((eventName: string) => void) | undefined;

  assignTask(command: AggregateState): Promise<SpineEvent> {
    return new Promise((resolve) => {
      AsyncAssigneeAggregate.resolveCommand = (eventName) => {
        resolve(createAggregateEvent(`event-${eventName}`, command.id, 0, eventName));
      };
    });
  }

  applyTask(event: AggregateState): void {
    this.startTransaction();
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: event.id,
        name: `${event.name} (applied)`,
        archived: event.archived,
      }),
    );
    this.commitTransaction();
  }
}

class NoApplierAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(command: AggregateState) {
    return createAggregateEvent("event-no-applier", command.id, 0, command.name);
  }

  reactTask(event: AggregateState): void {
    void event;
  }
}

class MalformedEventAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(): unknown {
    return create(EventSchema, {
      id: create(EventIdSchema, { value: "event-malformed" }),
      context: create(EventContextSchema),
    });
  }

  applyTask(event: AggregateState): void {
    void event;
  }
}

class BigintVersionAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static observedVersions: unknown[] = [];

  static reset(): void {
    this.observedVersions = [];
  }

  assignTask(command: AggregateState) {
    BigintVersionAggregate.observedVersions.push(this.version);
    return createAggregateEvent(`event-bigint-${command.name}`, command.id, 0, command.name);
  }

  applyTask(event: AggregateState): void {
    this.startTransaction();
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: event.id,
        name: event.name,
        archived: event.archived,
      }),
    );
    this.commitTransaction();
  }
}

describe("repository signal routing", () => {
  it("executes aggregate commands through a built bounded-context command bus", async () => {
    ExecutingTaskAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const observed: string[] = [];
    const repository = createExecutingRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (event) => {
          observed.push(event.id?.value ?? "missing");
          return Promise.resolve();
        },
      })
      .withStorageFactory(factory)
      .build();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    const completion = context
      .commandBus()
      .post(createAggregateCommand("command-exec", "task-exec", "TaskExec"));

    expect(ExecutingTaskAggregate.assigneeCalls).toBe(0);
    expect(observed).toEqual([]);

    await completion;

    expect(ExecutingTaskAggregate.assigneeCalls).toBe(1);
    expect(ExecutingTaskAggregate.applierCalls).toBe(1);
    await expect(eventStore.read()).resolves.toMatchObject([{ id: { value: "event-TaskExec" } }]);
    await expect(storage.readHistory("task-exec")).resolves.toMatchObject({
      snapshot: {
        aggregateId: "task-exec",
        version: 1n,
        state: {
          id: "task-exec",
          name: "TaskExec (applied)",
          archived: true,
        },
      },
      events: [],
    });
    expect(observed).toEqual(["event-TaskExec"]);
  });

  it("keeps an already registered repository executable after a failed second registration", async () => {
    ExecutingTaskAggregate.reset();
    const repository = createExecutingRepository();
    const firstContext = BoundedContext.singleTenant("Tasks").add(repository).build();

    expect(() => BoundedContext.singleTenant("OtherTasks").add(repository).build()).toThrow(
      "already registered with Bounded Context",
    );

    await firstContext
      .commandBus()
      .post(createAggregateCommand("command-after-registration-failure", "task-after-failure"));

    expect(ExecutingTaskAggregate.assigneeCalls).toBe(1);
    expect(ExecutingTaskAggregate.applierCalls).toBe(1);
  });

  it("keeps a reentrantly registered repository executable after failed outer cleanup", async () => {
    ExecutingTaskAggregate.reset();
    const repository = createExecutingRepository();
    let nestedContext: BoundedContext | undefined;
    let attempted = false;
    const outerFactory = new ReentrantRegistrationStorageFactory(() => {
      if (attempted) {
        return;
      }
      attempted = true;
      nestedContext = BoundedContext.singleTenant("Nested")
        .add(repository)
        .withStorageFactory(new InMemoryStorageFactory())
        .build();
    });

    expect(() =>
      BoundedContext.singleTenant("Outer").add(repository).withStorageFactory(outerFactory).build(),
    ).toThrow('already registered with Bounded Context "Nested"');

    await nestedContext
      ?.commandBus()
      .post(createAggregateCommand("command-after-reentrant-failure", "task-reentrant"));

    expect(ExecutingTaskAggregate.assigneeCalls).toBe(1);
    expect(ExecutingTaskAggregate.applierCalls).toBe(1);
  });

  it("persists array command output with sequential aggregate versions", async () => {
    ExecutingTaskAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await context.commandBus().post(createAggregateCommand("command-multi", "task-multi", "Multi"));

    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(eventStore.read()).resolves.toMatchObject([
      { id: { value: "event-Multi-1" }, context: { version: { number: 1 } } },
      { id: { value: "event-Multi-2" }, context: { version: { number: 2 } } },
    ]);
    await expect(storage.readHistory("task-multi")).resolves.toMatchObject({
      snapshot: {
        aggregateId: "task-multi",
        version: 2n,
        state: {
          id: "task-multi",
          name: "Multi two (applied)",
          archived: true,
        },
      },
      events: [],
    });
  });

  it("awaits async aggregate command assignees before storing produced events", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createAsyncAssigneeRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    const completion = context
      .commandBus()
      .post(createAggregateCommand("command-async", "task-async", "Async"));

    await Promise.resolve();
    await expect(storage.readHistory("task-async")).resolves.toMatchObject({
      snapshot: undefined,
      events: [],
    });

    AsyncAssigneeAggregate.resolveCommand?.("Async");
    await completion;

    await expect(storage.readHistory("task-async")).resolves.toMatchObject({
      snapshot: {
        aggregateId: "task-async",
        version: 1n,
        state: { name: "Async (applied)" },
      },
      events: [],
    });
  });

  it("resolves aggregate command execution after commit when stored-event dispatch later throws", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: () => Promise.reject(new Error("dispatch failed after commit")),
      })
      .withStorageFactory(factory)
      .build();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-dispatch-failure", "task-dispatch")),
    ).resolves.toBeUndefined();

    await expect(eventStore.read()).resolves.toMatchObject([{ id: { value: "event-Task" } }]);
    await expect(storage.readHistory("task-dispatch")).resolves.toMatchObject({
      snapshot: {
        aggregateId: "task-dispatch",
        version: 1n,
      },
      events: [],
    });
  });

  it("dispatches appended events when snapshot writing fails but rejects command completion", async () => {
    const factory = new SnapshotFailingStorageFactory();
    const observed: string[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (event) => {
          observed.push(event.id?.value ?? "missing");
          return Promise.resolve();
        },
      })
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-snapshot-fails", "task-snapshot-fails")),
    ).rejects.toThrow("Cannot write aggregate snapshot.");

    await expect(eventStore.read()).resolves.toMatchObject([{ id: { value: "event-Task" } }]);
    expect(observed).toEqual(["event-Task"]);
  });

  it("does not block the outer command on nested commands posted from stored-event dispatch", async () => {
    const factory = new InMemoryStorageFactory();
    const nestedGate = createSignal();
    const nestedPosted = createSignal();
    const nestedFinished = createSignal();
    const contextRef: { current?: BoundedContext } = {};

    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: async (event) => {
          if (event.id?.value === "event-Outer") {
            nestedPosted.resolve();
            const currentContext = contextRef.current;

            if (currentContext === undefined) {
              throw new Error("Bounded context is not ready.");
            }

            await currentContext
              .commandBus()
              .post(createAggregateCommand("command-inner", "task-inner", "Inner"));
            nestedFinished.resolve();
            return;
          }

          if (event.id?.value === "event-Inner") {
            await nestedGate.promise;
          }
        },
      })
      .withStorageFactory(factory)
      .build();
    contextRef.current = context;

    let outerResolved = false;
    const outerCompletion = context
      .commandBus()
      .post(createAggregateCommand("command-outer", "task-outer", "Outer"))
      .then(() => {
        outerResolved = true;
      });

    await nestedPosted.promise;
    await Promise.resolve();
    expect(outerResolved).toBe(true);

    nestedGate.resolve();
    await outerCompletion;
    await nestedFinished.promise;
  });

  it("rejects aggregate command output when no applier is registered", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createNoApplierRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createAggregateCommand("command-no-applier", "task-no-applier")),
    ).rejects.toThrow(/no applier/);
    await expect(eventStore.read()).resolves.toEqual([]);
  });

  it("rejects malformed aggregate command output before storage", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createMalformedEventRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createAggregateCommand("command-malformed", "task-malformed")),
    ).rejects.toThrow(/event.message.typeUrl/);
    await expect(eventStore.read()).resolves.toEqual([]);
  });

  it("keeps stored aggregate history tenant-scoped for multitenant command execution", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.multitenant("Tasks")
      .add(createExecutingRepository())
      .withStorageFactory(factory)
      .build();
    const tenantAStorage = new AggregateStorage({
      context: { name: "Tasks", multitenant: true, tenantId: "tenant-a" },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });
    const tenantBStorage = new AggregateStorage({
      context: { name: "Tasks", multitenant: true, tenantId: "tenant-b" },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await context
      .commandBus()
      .post(createAggregateCommand("command-tenant-a", "shared-task", "TenantA", "tenant-a"));
    await context
      .commandBus()
      .post(createAggregateCommand("command-tenant-b", "shared-task", "TenantB", "tenant-b"));

    await expect(tenantAStorage.readHistory("shared-task")).resolves.toMatchObject({
      snapshot: {
        aggregateId: "shared-task",
        version: 1n,
        state: { name: "TenantA (applied)" },
      },
    });
    await expect(tenantBStorage.readHistory("shared-task")).resolves.toMatchObject({
      snapshot: {
        aggregateId: "shared-task",
        version: 1n,
        state: { name: "TenantB (applied)" },
      },
    });
  });

  it("rehydrates repository-executed aggregates with bigint version metadata", async () => {
    BigintVersionAggregate.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createBigintVersionRepository())
      .withStorageFactory(new InMemoryStorageFactory())
      .build();

    await context
      .commandBus()
      .post(createAggregateCommand("command-bigint-1", "task-bigint", "One"));
    await context
      .commandBus()
      .post(createAggregateCommand("command-bigint-2", "task-bigint", "Two"));

    expect(BigintVersionAggregate.observedVersions).toEqual([0n, 1n]);
  });

  it("rejects produced aggregate versions outside the protobuf int32 range", async () => {
    const factory = new InMemoryStorageFactory();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });
    await storage.writeSnapshot({
      aggregateId: "task-overflow",
      state: create(AggregateStateSchema, {
        id: "task-overflow",
        name: "Overflow",
        archived: false,
      }),
      version: 2_147_483_647n,
      lifecycle: { archived: false, deleted: false },
    });
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createAggregateCommand("command-overflow", "task-overflow")),
    ).rejects.toThrow(/int32 range/);
    await expect(eventStore.read()).resolves.toEqual([]);
  });

  it("stores produced aggregate events with a readable producer ID", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await context
      .commandBus()
      .post(createAggregateCommand("command-producer-id", "task-producer-id"));

    const [stored] = await eventStore.read();
    expect(readReadableProducerId(stored)).toBe("task-producer-id");
  });

  it("routes commands to one aggregate ID by the first command field", async () => {
    const repository = createRoutingRepository();
    const command = createAggregateCommand("command-1", "task-1");
    const route = repository.routeCommand(command);

    expect(route).toMatchObject({
      entityId: "task-1",
      messageFullTypeName: AggregateStateSchema.typeName,
      invocation: "deferred",
    });
    expectTypeOf(route.entityId).toEqualTypeOf<string>();

    const context = BoundedContext.singleTenant("Tasks").add(repository).build();

    await expect(context.commandBus().post(command)).resolves.toBeUndefined();
  });

  it("routes events by matching producer ID or by the first event field", async () => {
    const repository = createRoutingRepository();

    const producerRoute = repository.routeEvent(
      createProjectionEvent("event-1", "task-1", {
        producerId: "task-1",
      }),
    );
    const firstFieldRoute = repository.routeEvent(createProjectionEvent("event-2", "field-task"));

    expect(producerRoute).toMatchObject({
      entityIds: ["task-1"],
      messageFullTypeName: ProjectionStateSchema.typeName,
      invocation: "deferred",
    });
    expectTypeOf(producerRoute.entityIds).toEqualTypeOf<readonly string[]>();
    expect(firstFieldRoute.entityIds).toEqual(["field-task"]);

    const context = BoundedContext.singleTenant("Tasks").add(repository).build();

    await expect(
      context.eventBus().post(createProjectionEvent("event-3", "posted-task")),
    ).resolves.toBeUndefined();
  });

  it("rejects contradictory producer and first-field event IDs", () => {
    const repository = createRoutingRepository();

    expect(() =>
      repository.routeEvent(
        createProjectionEvent("event-contradictory", "first-field-task", {
          producerId: "producer-task",
        }),
      ),
    ).toThrow(/same entity/);
  });

  it("rejects unreadable producer IDs", () => {
    const repository = createRoutingRepository();

    expect(() =>
      repository.routeEvent(
        createProjectionEvent("event-unreadable-producer", "first-field-task", {
          producerMessage: create(AggregateStateSchema, {
            id: "producer-task",
            name: "producer",
            archived: false,
          }),
        }),
      ),
    ).toThrow(/readable producer ID/);
  });

  it("rejects invalid repository events before context event storage", async () => {
    const factory = new InMemoryStorageFactory();
    const repository = createRoutingRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.eventBus().post(
        createProjectionEvent("event-not-stored", "first-field-task", {
          producerId: "producer-task",
        }),
      ),
    ).rejects.toThrow(/same entity/);
    await expect(eventStore.read()).resolves.toEqual([]);
  });

  it("runs repository event acceptance before custom dispatcher acceptance", async () => {
    const factory = new InMemoryStorageFactory();
    const observed: string[] = [];
    const customDispatcher: EventDispatcher = {
      messageSchemas: () => [ProjectionStateSchema],
      accept: () => {
        observed.push("custom-accept");
        return Promise.resolve();
      },
      dispatch: () => Promise.resolve(),
    };
    const context = BoundedContext.singleTenant("Tasks")
      .add(createRoutingRepository())
      .addEventDispatcher(customDispatcher)
      .withStorageFactory(factory)
      .build();

    await expect(
      context.eventBus().post(
        createProjectionEvent("event-rejected-before-custom", "first-field-task", {
          producerId: "producer-task",
        }),
      ),
    ).rejects.toThrow(/same entity/);
    expect(observed).toEqual([]);
  });

  it("rejects structurally fabricated handler metadata", () => {
    const handlers = defineEntityHandlers(TaskAggregate, AggregateStateSchema, (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
    ]);
    const fabricated = { ...handlers } as unknown as EntityHandlersMetadata<
      TaskAggregate,
      typeof AggregateStateSchema
    >;

    expect(
      () =>
        new Repository({
          entityType: TaskAggregate,
          schema: AggregateStateSchema,
          handlers: fabricated,
        }),
    ).toThrow(RepositoryIdentityError);
  });
});

function createRoutingRepository(): Repository<typeof TaskAggregate> {
  const handlers = defineEntityHandlers(TaskAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
    builder.react(ProjectionStateSchema, "reactToProjection"),
  ]);

  return new Repository({
    entityType: TaskAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createExecutingRepository(): Repository<typeof ExecutingTaskAggregate> {
  const handlers = defineEntityHandlers(ExecutingTaskAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
    builder.apply(AggregateStateSchema, "applyTask"),
  ]);

  return new Repository({
    entityType: ExecutingTaskAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createAsyncAssigneeRepository(): Repository<typeof AsyncAssigneeAggregate> {
  const handlers = defineEntityHandlers(AsyncAssigneeAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
    builder.apply(AggregateStateSchema, "applyTask"),
  ]);

  return new Repository({
    entityType: AsyncAssigneeAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createBigintVersionRepository(): Repository<typeof BigintVersionAggregate> {
  const handlers = defineEntityHandlers(BigintVersionAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
    builder.apply(AggregateStateSchema, "applyTask"),
  ]);

  return new Repository({
    entityType: BigintVersionAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createNoApplierRepository(): Repository<typeof NoApplierAggregate> {
  const handlers = defineEntityHandlers(NoApplierAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
    builder.react(AggregateStateSchema, "reactTask"),
  ]);

  return new Repository({
    entityType: NoApplierAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createMalformedEventRepository(): Repository<typeof MalformedEventAggregate> {
  const handlers = defineEntityHandlers(
    MalformedEventAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(AggregateStateSchema, "applyTask"),
    ],
  );

  return new Repository({
    entityType: MalformedEventAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createAggregateEvent(
  id: string,
  aggregateId: string,
  version: number,
  name = "Task",
): SpineEvent {
  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      version: create(VersionSchema, { number: version }),
    }),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: aggregateId,
      name,
      archived: false,
    }),
  });
}

function createAggregateCommand(id: string, aggregateId: string, name = "Task", tenantId?: string) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        ...(tenantId === undefined
          ? {}
          : {
              tenantId: create(TenantIdSchema, {
                kind: {
                  case: "value",
                  value: tenantId,
                },
              }),
            }),
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: aggregateId,
      name,
      archived: false,
    }),
  });
}

function createProjectionEvent(
  id: string,
  entityId: string,
  options: {
    readonly producerId?: string;
    readonly producerMessage?: AggregateState;
  } = {},
) {
  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: projectionProducerId(options),
      version: create(VersionSchema, { number: 1 }),
    }),
    schema: ProjectionStateSchema,
    message: create(ProjectionStateSchema, {
      id: entityId,
      name: "Task",
      priority: 1,
    }),
  });
}

function projectionProducerId(options: {
  readonly producerId?: string;
  readonly producerMessage?: AggregateState;
}) {
  if (options.producerMessage !== undefined) {
    return packAny(AggregateStateSchema, options.producerMessage);
  }
  if (options.producerId !== undefined) {
    return packAny(UserIdSchema, create(UserIdSchema, { value: options.producerId }));
  }
  return undefined;
}

function readReadableProducerId(event: { readonly context?: unknown } | undefined) {
  const producerId = (
    event?.context as { readonly producerId?: ReturnType<typeof packAny> | undefined } | undefined
  )?.producerId;

  if (producerId === undefined) {
    return undefined;
  }

  return (
    unpackAny(producerId, DoubleValueSchema)?.value ??
    unpackAny(producerId, UserIdSchema)?.value ??
    unpackAny(producerId, StringValueSchema)?.value ??
    unpackAny(producerId, BoolValueSchema)?.value
  );
}

function createSignal() {
  let resolve!: () => void;
  const promise = new Promise<void>((fulfill) => {
    resolve = () => {
      fulfill();
    };
  });

  return { promise, resolve };
}

class SnapshotFailingStorageFactory extends InMemoryStorageFactory {
  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new SnapshotFailingRecordStorage(
      context,
      recordSpec,
      super.onCreateRecordStorage(context, recordSpec),
    );
  }
}

class ReentrantRegistrationStorageFactory extends InMemoryStorageFactory {
  constructor(private readonly onCreate: () => void) {
    super();
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const storage = super.onCreateRecordStorage(context, recordSpec);
    this.onCreate();
    return storage;
  }
}

class SnapshotFailingRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    private readonly delegate: RecordStorage<I, R>,
  ) {
    super(context, recordSpec);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    return this.delegate.delete(id);
  }

  protected queryRecordEntries(query: Parameters<RecordStorage<I, R>["queryEntries"]>[0]) {
    return this.delegate.queryEntries(query);
  }

  protected readRecord(id: I): Promise<R | undefined> {
    return this.delegate.read(id);
  }

  protected compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    return this.delegate.compareAndSet(id, expected?.record, next?.record);
  }

  protected writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    if (records.some((record) => record.record.$typeName === "google.protobuf.Any")) {
      return Promise.reject(new Error("Cannot write aggregate snapshot."));
    }
    return this.delegate.writeAll(records.map((record) => record.record));
  }

  protected writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    if (record.record.$typeName === "google.protobuf.Any") {
      return Promise.reject(new Error("Cannot write aggregate snapshot."));
    }
    return this.delegate.write(record.record);
  }
}
