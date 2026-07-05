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
import { deriveTypeUrl, packAny, packCommand, packEvent, unpackAny } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandSchema,
  CommandContextSchema,
  CommandIdSchema,
  type Event as SpineEvent,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  MessageIdSchema,
  OriginSchema,
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
  Projection,
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

type ValidatedAggregateState = Message<"example.validation_refusal.ValidatedAggregateState"> & {
  id: string;
  name: string;
};

type ValidatedTaskCommand = Message<"example.validation_refusal.ValidatedTaskCommand"> & {
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
const fileValidationRefusalFixture = fileDesc(
  "CiB2YWxpZGF0aW9uLXJlZnVzYWwvY29tbWFuZC5wcm90bxIaZXhhbXBsZS52YWxpZGF0aW9uX3JlZnVz" +
    "YWwaE3NwaW5lL29wdGlvbnMucHJvdG8ibAoXVmFsaWRhdGVkQWdncmVnYXRlU3RhdGUSFAoCaWQYASAB" +
    "KAlCBICGJAFSAmlkEhIKBG5hbWUYAiABKAlSBG5hbWU6J/qKJAQIARAD2oskGwoZZXhhbXBsZS50YWdz" +
    "LkFnZ3JlZ2F0ZVRhZyJAChRWYWxpZGF0ZWRUYXNrQ29tbWFuZBIOCgJpZBgBIAEoCVICaWQSGAoEbmFt" +
    "ZRgCIAEoCUIEoIUkAVIEbmFtZWIGcHJvdG8z",
  [file_spine_options],
);
const ValidatedAggregateStateSchema = messageDesc(
  fileValidationRefusalFixture,
  0,
) as GenMessage<ValidatedAggregateState>;
const ValidatedTaskCommandSchema = messageDesc(
  fileValidationRefusalFixture,
  1,
) as GenMessage<ValidatedTaskCommand>;

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

class ValidatingTaskAggregate extends Aggregate<
  string,
  typeof ValidatedAggregateStateSchema,
  bigint
> {
  static assigneeCalls = 0;
  static applierCalls = 0;

  static reset(): void {
    this.assigneeCalls = 0;
    this.applierCalls = 0;
  }

  assignTask(command: ValidatedTaskCommand) {
    ValidatingTaskAggregate.assigneeCalls++;
    return createValidatedEvent(`event-${command.id}`, command.id, command.name);
  }

  applyTask(event: ValidatedAggregateState): void {
    ValidatingTaskAggregate.applierCalls++;
    this.startTransaction();
    this.updateDraftState(() =>
      create(ValidatedAggregateStateSchema, {
        id: event.id,
        name: event.name,
      }),
    );
    this.commitTransaction();
  }
}

class TransitionViolatingAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(command: AggregateState) {
    return createAggregateEvent("event-transition-invalid", command.id, 0, command.name);
  }

  applyTask(event: AggregateState): void {
    this.startTransaction();
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: `${event.id}-changed`,
        name: event.name,
        archived: event.archived,
      }),
    );
    this.commitTransaction();
  }
}

class RollingBackTransitionAggregate extends TransitionViolatingAggregate {
  override assignTask(command: AggregateState) {
    return createAggregateEvent("event-transition-rollback", command.id, 0, command.name);
  }

  override applyTask(event: AggregateState): void {
    this.startTransaction();
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: `${event.id}-changed`,
        name: event.name,
        archived: event.archived,
      }),
    );
    const result = this.commitTransaction();
    if (result.status === "rejected") {
      this.rollbackTransaction();
    }
  }
}

class RecoveringTransitionAggregate extends TransitionViolatingAggregate {
  override assignTask(command: AggregateState) {
    return createAggregateEvent("event-transition-recovers", command.id, 0, command.name);
  }

  override applyTask(event: AggregateState): void {
    this.startTransaction();
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: `${event.id}-changed`,
        name: event.name,
        archived: event.archived,
      }),
    );
    const result = this.commitTransaction();
    if (result.status === "accepted") {
      return;
    }

    this.rollbackTransaction();
    this.startTransaction();
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: event.id,
        name: `${event.name} recovered`,
        archived: event.archived,
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

class AsyncApplierAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static started = createSignal();
  static gate = createSignal();
  static rejection: Error | undefined;

  static reset(): void {
    this.started = createSignal();
    this.gate = createSignal();
    this.rejection = undefined;
  }

  assignTask(command: AggregateState) {
    return createAggregateEvent("event-async-applier", command.id, 0, command.name);
  }

  async applyTask(event: AggregateState): Promise<void> {
    AsyncApplierAggregate.started.resolve();
    await AsyncApplierAggregate.gate.promise;

    if (AsyncApplierAggregate.rejection !== undefined) {
      throw AsyncApplierAggregate.rejection;
    }

    this.startTransaction();
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: event.id,
        name: `${event.name} (async applied)`,
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

class ProjectionProducingAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(command: AggregateState) {
    return createProjectionEvent(
      `event-${command.name}`,
      command.id,
      command.name === "PastMessageTenant"
        ? { pastMessageTenantId: "tenant-b" }
        : { importTenantId: "tenant-b" },
    );
  }

  applyProjection(event: ProjectionState): void {
    this.startTransaction();
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: event.id,
        name: event.name,
        archived: false,
      }),
    );
    this.commitTransaction();
  }
}

class CommandTenantProjectionProducingAggregate extends Aggregate<
  string,
  typeof AggregateStateSchema,
  bigint
> {
  assignTask(command: AggregateState) {
    return createProjectionEvent(`event-${command.name}`, command.id);
  }

  applyProjection(event: ProjectionState): void {
    this.startTransaction();
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: event.id,
        name: event.name,
        archived: false,
      }),
    );
    this.commitTransaction();
  }
}

class ExecutingTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeTask(event: ProjectionState): void {
    ExecutingTaskProjection.subscriberCalls++;
    this.startTransaction();
    this.updateDraftState(() =>
      create(ProjectionStateSchema, {
        id: event.id,
        name: `${event.name} (projected)`,
        priority: event.priority + 1,
      }),
    );
    this.commitTransaction();
  }
}

class PassiveTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeTask(event: ProjectionState): void {
    PassiveTaskProjection.subscriberCalls++;
    void event;
  }
}

class AccumulatingTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  subscribeTask(event: ProjectionState): void {
    this.startTransaction();
    this.updateDraftState((draft) => {
      draft.name = event.name;
      draft.priority += event.priority;
      return draft;
    });
    this.commitTransaction();
  }
}

class ReactingTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  reactTask(event: ProjectionState): void {
    void event;
  }
}

class MissingSubscriberMethodProjection extends Projection<
  string,
  typeof ProjectionStateSchema,
  number
> {
  missingSubscriber(event: ProjectionState): void {
    void event;
  }
}

class ThrowingTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static failure = new Error("projection subscriber failed");

  subscribeTask(event: ProjectionState): void {
    void event;
    throw ThrowingTaskProjection.failure;
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

  it("awaits async aggregate event appliers before storing snapshots", async () => {
    AsyncApplierAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createAsyncApplierRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });
    let completed = false;

    const completion = context
      .commandBus()
      .post(createAggregateCommand("command-async-applier", "task-async-applier", "AsyncApplier"))
      .then(() => {
        completed = true;
      });

    await AsyncApplierAggregate.started.promise;
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    expect(completed).toBe(false);
    await expect(storage.readHistory("task-async-applier")).resolves.toMatchObject({
      snapshot: undefined,
      events: [],
    });

    AsyncApplierAggregate.gate.resolve();
    await completion;

    await expect(storage.readHistory("task-async-applier")).resolves.toMatchObject({
      snapshot: {
        aggregateId: "task-async-applier",
        version: 1n,
        state: { name: "AsyncApplier (async applied)" },
      },
      events: [],
    });
  });

  it("rejects aggregate command completion when an async event applier rejects", async () => {
    AsyncApplierAggregate.reset();
    AsyncApplierAggregate.rejection = new Error("async applier failed");
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createAsyncApplierRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    const completion = context
      .commandBus()
      .post(createAggregateCommand("command-async-applier-fails", "task-async-applier-fails"));

    await AsyncApplierAggregate.started.promise;
    AsyncApplierAggregate.gate.resolve();

    await expect(completion).rejects.toThrow("async applier failed");
    await expect(eventStore.read()).resolves.toEqual([]);
  });

  it("resolves aggregate command execution after commit when stored-event dispatch later throws", async () => {
    const factory = new InMemoryStorageFactory();
    const dispatchAttempted = createSignal();
    const dispatchFailure = new Error("dispatch failed after commit");
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: () => {
          dispatchAttempted.resolve();
          return Promise.reject(dispatchFailure);
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
    await dispatchAttempted.promise;

    const [failure] = await waitForFailures(context, 1);
    expect(failure).toMatchObject({
      event: { id: { value: "event-Task" } },
      error: { name: "Error", message: "dispatch failed after commit" },
    });
    expect(failure?.error).not.toBe(dispatchFailure);
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

  it("rejects invalid aggregate command payloads before durable aggregate work", async () => {
    ValidatingTaskAggregate.reset();
    const factory = new ObservingStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createValidatingRepository())
      .withStorageFactory(factory)
      .build();

    await expect(
      context.commandBus().post(createValidatedCommand("command-invalid", "task-invalid", "")),
    ).rejects.toThrow(/validation/i);

    expect(ValidatingTaskAggregate.assigneeCalls).toBe(0);
    expect(ValidatingTaskAggregate.applierCalls).toBe(0);
    expect(factory.operations).toEqual([]);
  });

  it("rejects state-transition validation failures before storing aggregate output", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createTransitionViolatingRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-transition-invalid", "task-transition-invalid")),
    ).rejects.toMatchObject({
      type: "COMMAND_STATE_TRANSITION_VALIDATION_FAILED",
      clientMessage: "Command state transition validation failed.",
    });

    await expect(eventStore.read()).resolves.toEqual([]);
    await expect(storage.readHistory("task-transition-invalid")).resolves.toMatchObject({
      snapshot: undefined,
      events: [],
    });
  });

  it("rejects rolled-back state-transition validation failures before storage", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createRollingBackTransitionRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-transition-rollback", "task-transition-rollback")),
    ).rejects.toMatchObject({
      type: "COMMAND_STATE_TRANSITION_VALIDATION_FAILED",
      clientMessage: "Command state transition validation failed.",
    });

    await expect(eventStore.read()).resolves.toEqual([]);
    await expect(storage.readHistory("task-transition-rollback")).resolves.toMatchObject({
      snapshot: undefined,
      events: [],
    });
  });

  it("reports invalid stored history as aggregate replay failure", async () => {
    const factory = new InMemoryStorageFactory();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });
    const context = BoundedContext.singleTenant("Tasks")
      .add(createTransitionViolatingRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await storage.appendEvents("task-replay-invalid", [
      createAggregateEvent("event-replay-invalid", "task-replay-invalid", 1, "BrokenHistory"),
    ]);

    let rejection: unknown;
    try {
      await context
        .commandBus()
        .post(createAggregateCommand("command-after-broken-history", "task-replay-invalid"));
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toMatchObject({ name: "ReplayError" });
    expect(rejection).not.toMatchObject({
      type: "COMMAND_STATE_TRANSITION_VALIDATION_FAILED",
    });
    await expect(eventStore.read()).resolves.toHaveLength(1);
  });

  it("clears rejected transition markers when a fresh transaction succeeds", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createRecoveringTransitionRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-transition-recovers", "task-recovers")),
    ).resolves.toBeUndefined();

    await expect(storage.readHistory("task-recovers")).resolves.toMatchObject({
      snapshot: {
        aggregateId: "task-recovers",
        version: 1n,
        state: {
          id: "task-recovers",
          name: "Task recovered",
        },
      },
      events: [],
    });
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

  it("rejects multitenant aggregate command execution without tenant context", async () => {
    const context = BoundedContext.multitenant("Tasks").add(createExecutingRepository()).build();

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-missing-tenant", "task-missing-tenant")),
    ).rejects.toThrow(/tenantId/);
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

  it("executes projection event subscribers and records latest state in Stand", async () => {
    ExecutingTaskProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .build();

    await context.eventBus().post(createProjectionEvent("event-projected", "task-projected"));

    expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
    await expect(
      context.stand().readVersioned(ProjectionStateSchema, "task-projected"),
    ).resolves.toMatchObject({
      state: {
        id: "task-projected",
        name: "Task (projected)",
        priority: 2,
      },
      version: { number: 1 },
    });
  });

  it("delivers Stand subscriptions after real projection event handling", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .build();
    const updates: ProjectionState[] = [];
    context.stand().subscribe(ProjectionStateSchema, (update) => {
      updates.push(update.state);
    });

    await context.eventBus().post(createProjectionEvent("event-subscribed", "task-subscribed"));

    expect(updates).toEqual([
      create(ProjectionStateSchema, {
        id: "task-subscribed",
        name: "Task (projected)",
        priority: 2,
      }),
    ]);
  });

  it("does not write unchanged projection state after subscriber execution", async () => {
    PassiveTaskProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createPassiveProjectionRepository())
      .build();

    await context.eventBus().post(createProjectionEvent("event-passive", "task-passive"));

    expect(PassiveTaskProjection.subscriberCalls).toBe(1);
    await expect(
      context.stand().read(ProjectionStateSchema, "task-passive"),
    ).resolves.toBeUndefined();
  });

  it("loads existing projection state before applying later delivered events", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createAccumulatingProjectionRepository())
      .build();

    await context.eventBus().post(createProjectionEvent("event-accumulated-1", "task-accumulated"));
    await context.eventBus().post(createProjectionEvent("event-accumulated-2", "task-accumulated"));

    await expect(
      context.stand().read(ProjectionStateSchema, "task-accumulated"),
    ).resolves.toMatchObject({
      id: "task-accumulated",
      name: "Task",
      priority: 2,
    });
  });

  it("routes projection events without writing Stand when no subscriber is registered", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createReactingProjectionRepository())
      .build();

    await context.eventBus().post(createProjectionEvent("event-reacting", "task-reacting"));

    await expect(
      context.stand().read(ProjectionStateSchema, "task-reacting"),
    ).resolves.toBeUndefined();
  });

  it("uses command tenant over imported tenant metadata when stored aggregate events update projections", async () => {
    const context = BoundedContext.multitenant("Tasks")
      .add(createProjectionProducingRepository())
      .add(createExecutingProjectionRepository())
      .build();

    await context
      .commandBus()
      .post(createAggregateCommand("command-project-tenant", "task-tenant", "Tenant", "tenant-a"));

    const projected = await waitForProjectionState(context, "task-tenant", "tenant-a");

    expect(projected).toMatchObject({
      name: "Task (projected)",
      priority: 2,
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-tenant", { tenantId: "tenant-b" }),
    ).resolves.toBeUndefined();
  });

  it("uses command tenant over embedded past-message tenant", async () => {
    const context = BoundedContext.multitenant("Tasks")
      .add(createProjectionProducingRepository())
      .add(createExecutingProjectionRepository())
      .build();

    await context
      .commandBus()
      .post(
        createAggregateCommand(
          "command-project-past-message-tenant",
          "task-past-message-tenant",
          "PastMessageTenant",
          "tenant-a",
        ),
      );

    const projected = await waitForProjectionState(context, "task-past-message-tenant", "tenant-a");

    expect(projected).toMatchObject({
      name: "Task (projected)",
      priority: 2,
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-past-message-tenant", {
        tenantId: "tenant-b",
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects aggregate commands without ids before tenant projection updates", async () => {
    const context = BoundedContext.multitenant("Tasks")
      .add(createProjectionProducingRepository())
      .add(createExecutingProjectionRepository())
      .build();

    await expect(
      context
        .commandBus()
        .post(createIdlessAggregateCommand("task-no-id-tenant", "NoIdTenant", "tenant-a")),
    ).rejects.toThrow(/requires command\.id/);
    await expect(
      context.stand().read(ProjectionStateSchema, "task-no-id-tenant", {
        tenantId: "tenant-a",
      }),
    ).resolves.toBeUndefined();
    await expect(
      context.stand().read(ProjectionStateSchema, "task-no-id-tenant", {
        tenantId: "tenant-b",
      }),
    ).resolves.toBeUndefined();
  });

  it("uses command tenant metadata when stored aggregate events update projections", async () => {
    const context = BoundedContext.multitenant("Tasks")
      .add(createTenantProjectionRepo())
      .add(createExecutingProjectionRepository())
      .build();
    const updates: ProjectionState[] = [];
    context.stand().subscribe(
      ProjectionStateSchema,
      (update) => {
        updates.push(update.state);
      },
      { tenantId: "tenant-a" },
    );

    await context
      .commandBus()
      .post(
        createAggregateCommand(
          "command-project-command-tenant",
          "task-command-tenant",
          "Tenant",
          "tenant-a",
        ),
      );

    const projected = await waitForProjectionState(context, "task-command-tenant", "tenant-a");

    expect(projected).toMatchObject({
      name: "Task (projected)",
      priority: 2,
    });
    expect(updates).toEqual([
      create(ProjectionStateSchema, {
        id: "task-command-tenant",
        name: "Task (projected)",
        priority: 2,
      }),
    ]);
    await expect(
      context.stand().read(ProjectionStateSchema, "task-command-tenant", { tenantId: "tenant-b" }),
    ).resolves.toBeUndefined();
  });

  it("records stored-event projection subscriber failures without rejecting aggregate commands", async () => {
    const subscriberFailure = new Error("projection subscriber failed after commit");
    ThrowingTaskProjection.failure = subscriberFailure;
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProjectionProducingRepository())
      .add(createThrowingProjectionRepository())
      .build();

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-project-fails", "task-project-fails", "Projected")),
    ).resolves.toBeUndefined();

    const [failure] = await waitForFailures(context, 1);
    expect(failure).toMatchObject({
      event: { id: { value: "event-Projected" } },
      error: { name: "Error", message: "projection subscriber failed after commit" },
    });
    expect(failure?.error).not.toBe(subscriberFailure);
  });

  it("snapshots stored-event dispatch failures as bounded diagnostics", async () => {
    const thrown = new Error("x".repeat(600));
    thrown.name = "";
    delete thrown.stack;
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: () => Promise.reject(thrown),
      })
      .build();

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-non-error-dispatch", "task-non-error-dispatch")),
    ).resolves.toBeUndefined();

    const [failure] = await waitForFailures(context, 1);

    expect(failure).toMatchObject({
      event: { id: { value: "event-Task" } },
      error: {
        name: "Error",
        message: `${"x".repeat(497)}...`,
      },
    });
    expect(failure?.error).not.toBe(thrown);
    expect(Object.isFrozen(failure?.error)).toBe(true);
  });

  it("bounds stored-event dispatch failure diagnostics and returns copy-safe snapshots", async () => {
    const subscriberFailure = new Error("bounded projection subscriber failed");
    ThrowingTaskProjection.failure = subscriberFailure;
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProjectionProducingRepository())
      .add(createThrowingProjectionRepository())
      .build();

    for (let index = 0; index < 12; index++) {
      const suffix = String(index);
      await context
        .commandBus()
        .post(
          createAggregateCommand(
            `command-bounded-${suffix}`,
            `task-bounded-${suffix}`,
            `B${suffix}`,
          ),
        );
    }

    await waitForFailure(context, (failures) =>
      failures.some((failure) => failure.event.id?.value === "event-B11"),
    );
    const failures = context.storedEventDispatchFailures();

    expect(failures).toHaveLength(10);
    expect(failures[0]).toMatchObject({ event: { id: { value: "event-B2" } } });
    expect(failures.at(-1)).toMatchObject({
      event: { id: { value: "event-B11" } },
      error: { name: "Error", message: "bounded projection subscriber failed" },
    });
    expect(failures.at(-1)?.error).not.toBe(subscriberFailure);
    expect(Object.isFrozen(failures.at(-1)?.error)).toBe(true);

    subscriberFailure.message = "mutated after capture";
    const firstFailure = failures[0];
    if (firstFailure?.event.id !== undefined) {
      firstFailure.event.id.value = "mutated-returned-event";
    }
    const reread = context.storedEventDispatchFailures();

    expect(reread[0]).toMatchObject({
      event: { id: { value: "event-B2" } },
      error: { message: "bounded projection subscriber failed" },
    });
  });

  it("records projection updates without version metadata when the delivered event has none", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .build();

    await context.eventBus().post(
      createProjectionEvent("event-without-version", "task-without-version", {
        includeVersion: false,
      }),
    );

    await expect(
      context.stand().readVersioned(ProjectionStateSchema, "task-without-version"),
    ).resolves.toMatchObject({
      state: { name: "Task (projected)" },
    });
    await expect(
      context.stand().readVersioned(ProjectionStateSchema, "task-without-version"),
    ).resolves.not.toHaveProperty("version");
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

  it("reports missing projection subscriber methods with neutral repository execution wording", async () => {
    const context = BoundedContext.singleTenant("Tasks").add(createMissingSubscriberRepo()).build();
    const descriptor = Object.getOwnPropertyDescriptor(
      MissingSubscriberMethodProjection.prototype,
      "missingSubscriber",
    );
    delete (MissingSubscriberMethodProjection.prototype as { missingSubscriber?: unknown })
      .missingSubscriber;

    try {
      await expect(
        context
          .eventBus()
          .post(createProjectionEvent("event-missing-method", "task-missing-method")),
      ).rejects.toThrow('Repository entity execution requires method "missingSubscriber".');
    } finally {
      if (descriptor !== undefined) {
        Object.defineProperty(
          MissingSubscriberMethodProjection.prototype,
          "missingSubscriber",
          descriptor,
        );
      }
    }
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

function createExecutingProjectionRepository(): Repository<typeof ExecutingTaskProjection> {
  const handlers = defineEntityHandlers(
    ExecutingTaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionStateSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: ExecutingTaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createPassiveProjectionRepository(): Repository<typeof PassiveTaskProjection> {
  const handlers = defineEntityHandlers(PassiveTaskProjection, ProjectionStateSchema, (builder) => [
    builder.subscribe(ProjectionStateSchema, "subscribeTask"),
  ]);

  return new Repository({
    entityType: PassiveTaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createAccumulatingProjectionRepository(): Repository<typeof AccumulatingTaskProjection> {
  const handlers = defineEntityHandlers(
    AccumulatingTaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionStateSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: AccumulatingTaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createReactingProjectionRepository(): Repository<typeof ReactingTaskProjection> {
  const handlers = defineEntityHandlers(
    ReactingTaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.react(ProjectionStateSchema, "reactTask")],
  );

  return new Repository({
    entityType: ReactingTaskProjection,
    schema: ProjectionStateSchema,
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

function createValidatingRepository(): Repository<typeof ValidatingTaskAggregate> {
  const handlers = defineEntityHandlers(
    ValidatingTaskAggregate,
    ValidatedAggregateStateSchema,
    (builder) => [
      builder.assign(ValidatedTaskCommandSchema, "assignTask"),
      builder.apply(ValidatedAggregateStateSchema, "applyTask"),
    ],
  );

  return new Repository({
    entityType: ValidatingTaskAggregate,
    schema: ValidatedAggregateStateSchema,
    handlers,
  });
}

function createTransitionViolatingRepository(): Repository<typeof TransitionViolatingAggregate> {
  const handlers = defineEntityHandlers(
    TransitionViolatingAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(AggregateStateSchema, "applyTask"),
    ],
  );

  return new Repository({
    entityType: TransitionViolatingAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createRollingBackTransitionRepository(): Repository<
  typeof RollingBackTransitionAggregate
> {
  const handlers = defineEntityHandlers(
    RollingBackTransitionAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(AggregateStateSchema, "applyTask"),
    ],
  );

  return new Repository({
    entityType: RollingBackTransitionAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createRecoveringTransitionRepository(): Repository<typeof RecoveringTransitionAggregate> {
  const handlers = defineEntityHandlers(
    RecoveringTransitionAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(AggregateStateSchema, "applyTask"),
    ],
  );

  return new Repository({
    entityType: RecoveringTransitionAggregate,
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

function createAsyncApplierRepository(): Repository<typeof AsyncApplierAggregate> {
  const handlers = defineEntityHandlers(AsyncApplierAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
    builder.apply(AggregateStateSchema, "applyTask"),
  ]);

  return new Repository({
    entityType: AsyncApplierAggregate,
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

function createProjectionProducingRepository(): Repository<typeof ProjectionProducingAggregate> {
  const handlers = defineEntityHandlers(
    ProjectionProducingAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(ProjectionStateSchema, "applyProjection"),
    ],
  );

  return new Repository({
    entityType: ProjectionProducingAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createTenantProjectionRepo(): Repository<
  typeof CommandTenantProjectionProducingAggregate
> {
  const handlers = defineEntityHandlers(
    CommandTenantProjectionProducingAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(ProjectionStateSchema, "applyProjection"),
    ],
  );

  return new Repository({
    entityType: CommandTenantProjectionProducingAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createMissingSubscriberRepo(): Repository<typeof MissingSubscriberMethodProjection> {
  const handlers = defineEntityHandlers(
    MissingSubscriberMethodProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionStateSchema, "missingSubscriber")],
  );

  return new Repository({
    entityType: MissingSubscriberMethodProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createThrowingProjectionRepository(): Repository<typeof ThrowingTaskProjection> {
  const handlers = defineEntityHandlers(
    ThrowingTaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionStateSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: ThrowingTaskProjection,
    schema: ProjectionStateSchema,
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

function createValidatedCommand(id: string, aggregateId: string, name: string, tenantId?: string) {
  return create(CommandSchema, {
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
    message: packAny(
      ValidatedTaskCommandSchema,
      create(ValidatedTaskCommandSchema, {
        id: aggregateId,
        name,
      }),
      { validate: false },
    ),
  });
}

function createIdlessAggregateCommand(aggregateId: string, name = "Task", tenantId?: string) {
  return create(CommandSchema, {
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
    message: packAny(
      AggregateStateSchema,
      create(AggregateStateSchema, {
        id: aggregateId,
        name,
        archived: false,
      }),
    ),
  });
}

function createValidatedEvent(id: string, aggregateId: string, name: string): SpineEvent {
  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema),
    schema: ValidatedAggregateStateSchema,
    message: create(ValidatedAggregateStateSchema, {
      id: aggregateId,
      name,
    }),
  });
}

function createProjectionEvent(
  id: string,
  entityId: string,
  options: {
    readonly producerId?: string;
    readonly producerMessage?: AggregateState;
    readonly importTenantId?: string;
    readonly pastMessageTenantId?: string;
    readonly includeVersion?: boolean;
  } = {},
) {
  const origin = projectionEventOrigin(options);

  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      ...(origin === undefined ? {} : { origin }),
      producerId: projectionProducerId(options),
      ...(options.includeVersion === false
        ? {}
        : { version: create(VersionSchema, { number: 1 }) }),
    }),
    schema: ProjectionStateSchema,
    message: create(ProjectionStateSchema, {
      id: entityId,
      name: "Task",
      priority: 1,
    }),
  });
}

function projectionEventOrigin(options: {
  readonly importTenantId?: string;
  readonly pastMessageTenantId?: string;
}) {
  if (options.importTenantId !== undefined) {
    return {
      case: "importContext" as const,
      value: create(ActorContextSchema, {
        tenantId: createTenantId(options.importTenantId),
      }),
    };
  }
  if (options.pastMessageTenantId !== undefined) {
    return {
      case: "pastMessage" as const,
      value: create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: "past-command" })),
          typeUrl: deriveTypeUrl(AggregateStateSchema),
        }),
        actorContext: create(ActorContextSchema, {
          tenantId: createTenantId(options.pastMessageTenantId),
        }),
      }),
    };
  }
  return undefined;
}

function createTenantId(value: string) {
  return create(TenantIdSchema, {
    kind: {
      case: "value",
      value,
    },
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

async function waitForProjectionState(
  context: BoundedContext,
  id: string,
  tenantId?: string,
): Promise<ProjectionState | undefined> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const state = await context
      .stand()
      .read(ProjectionStateSchema, id, tenantId === undefined ? {} : { tenantId });
    if (state !== undefined) {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return undefined;
}

async function waitForFailures(
  context: BoundedContext,
  count: number,
): Promise<ReturnType<BoundedContext["storedEventDispatchFailures"]>> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const failures = context.storedEventDispatchFailures();
    if (failures.length >= count) {
      return failures;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return context.storedEventDispatchFailures();
}

async function waitForFailure(
  context: BoundedContext,
  predicate: (failures: ReturnType<BoundedContext["storedEventDispatchFailures"]>) => boolean,
): Promise<ReturnType<BoundedContext["storedEventDispatchFailures"]>> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const failures = context.storedEventDispatchFailures();
    if (predicate(failures)) {
      return failures;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return context.storedEventDispatchFailures();
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

class ObservingStorageFactory extends InMemoryStorageFactory {
  readonly operations: string[] = [];

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new ObservingRecordStorage(
      context,
      recordSpec,
      super.onCreateRecordStorage(context, recordSpec),
      this.operations,
    );
  }
}

class ObservingRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    private readonly delegate: RecordStorage<I, R>,
    private readonly operations: string[],
  ) {
    super(context, recordSpec);
  }

  protected deleteRecord(id: I): Promise<boolean> {
    this.operations.push("delete");
    return this.delegate.delete(id);
  }

  protected queryRecordEntries(query: Parameters<RecordStorage<I, R>["queryEntries"]>[0]) {
    this.operations.push("query");
    return this.delegate.queryEntries(query);
  }

  protected readRecord(id: I): Promise<R | undefined> {
    this.operations.push("read");
    return this.delegate.read(id);
  }

  protected compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    this.operations.push("compareAndSet");
    return this.delegate.compareAndSet(id, expected?.record, next?.record);
  }

  protected writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    this.operations.push("writeAll");
    return this.delegate.writeAll(records.map((record) => record.record));
  }

  protected writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    this.operations.push("write");
    return this.delegate.write(record.record);
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
