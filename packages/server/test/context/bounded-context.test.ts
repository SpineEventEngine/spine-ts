import { create, type Message } from "@bufbuild/protobuf";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny, packCommand, packEvent } from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandContextSchema,
  CommandIdSchema,
  EventContextSchema,
  EventIdSchema,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import {
  InMemoryRecordStorage,
  type RecordSpec,
  type RecordStorage,
  type StorageContext,
  StorageFactory,
} from "@spine-ts/storage";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  Aggregate,
  BoundedContext,
  BoundedContextBuilder,
  BoundedContextNameError,
  Projection,
  Repository,
  type CommandEndpoint,
  type CommandDispatcher,
  type EventEndpoint,
  type EventDispatcher,
  type RepositoryView,
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
    throw new Error("Server bounded-context fixture descriptor set is empty.");
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

class TaskAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
class DuplicateTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
class TaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {}

describe("BoundedContext assembly", () => {
  it("rejects empty or blank context names", () => {
    expect(() => BoundedContext.singleTenant("\t\n")).toThrow(BoundedContextNameError);
    expect(() => BoundedContext.multitenant("")).toThrow(BoundedContextNameError);
  });

  it("builds single-tenant and multitenant contexts with names and tenant mode", () => {
    const singleTenant = BoundedContext.singleTenant("Tasks").build();
    const multitenant = BoundedContext.multitenant("Customers").build();

    expect(singleTenant.name.value).toBe("Tasks");
    expect(singleTenant.tenantMode).toBe("single-tenant");
    expect(singleTenant.isMultitenant).toBe(false);
    expect(singleTenant.spec.multitenant).toBe(false);

    expect(multitenant.name.value).toBe("Customers");
    expect(multitenant.tenantMode).toBe("multitenant");
    expect(multitenant.isMultitenant).toBe(true);
    expect(multitenant.spec.multitenant).toBe(true);
  });

  it("exposes stable post-only commandBus() and eventBus() endpoints from the built context", () => {
    const context = BoundedContext.singleTenant("Tasks").build();

    expectTypeOf(context.commandBus()).toEqualTypeOf<CommandEndpoint>();
    expectTypeOf(context.eventBus()).toEqualTypeOf<EventEndpoint>();
    expect(typeof context.commandBus().post).toBe("function");
    expect(typeof context.eventBus().post).toBe("function");
    expect("register" in context.commandBus()).toBe(false);
    expect("register" in context.eventBus()).toBe(false);
    expect(context.commandBus()).toBe(context.commandBus());
    expect(context.eventBus()).toBe(context.eventBus());
  });

  it("registers command dispatchers added to the builder", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher([ProjectionStateSchema], (command) => {
      observed.push(command.id?.uuid ?? "missing");
    });
    const context = BoundedContext.singleTenant("Tasks").addCommandDispatcher(dispatcher).build();

    await context.commandBus().post(createProjectionCommand("command-1"));

    expect(observed).toEqual(["command-1"]);
  });

  it("does not register command dispatchers removed before build", async () => {
    const dispatcher = createCommandDispatcher([ProjectionStateSchema], () => undefined);
    const context = BoundedContext.singleTenant("Tasks")
      .addCommandDispatcher(dispatcher)
      .removeCommandDispatcher(dispatcher)
      .build();

    await expect(context.commandBus().post(createProjectionCommand("command-2"))).rejects.toThrow(
      `No command dispatcher registered for "${deriveTypeUrl(ProjectionStateSchema)}".`,
    );
  });

  it("registers event dispatchers added to the builder", async () => {
    const observed: string[] = [];
    const dispatcher = createEventDispatcher([ProjectionStateSchema], (event) => {
      observed.push(event.id?.value ?? "missing");
    });
    const context = BoundedContext.singleTenant("Tasks").addEventDispatcher(dispatcher).build();

    await context.eventBus().post(createProjectionEvent("event-1"));

    expect(observed).toEqual(["event-1"]);
  });

  it("does not register event dispatchers removed before build", async () => {
    const observed: string[] = [];
    const dispatcher = createEventDispatcher([ProjectionStateSchema], (event) => {
      observed.push(event.id?.value ?? "missing");
    });
    const context = BoundedContext.singleTenant("Tasks")
      .addEventDispatcher(dispatcher)
      .removeEventDispatcher(dispatcher)
      .build();

    await context.eventBus().post(createProjectionEvent("event-2"));

    expect(observed).toEqual([]);
  });

  it("stores events in the context EventStore before dispatch", async () => {
    const observed: string[] = [];
    const storageFactory = new ObservingStorageFactory(observed);
    const dispatcher = createEventDispatcher([ProjectionStateSchema], (event) => {
      observed.push(`dispatch:${event.id?.value ?? "missing"}`);
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .addEventDispatcher(dispatcher)
      .build();

    await context.eventBus().post(createProjectionEvent("event-3"));

    expect(observed).toEqual(["store:event-3", "dispatch:event-3"]);
  });

  it("registers repositories added to the builder with the built context", () => {
    const storageFactory = new ObservingStorageFactory([]);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .build();

    const firstRepositories = context.registeredRepositories();
    const secondRepositories = context.registeredRepositories();

    expectTypeOf(firstRepositories).toEqualTypeOf<readonly RepositoryView[]>();
    expect(repository.isRegistered()).toBe(true);
    expect(repository.registeredContextName?.value).toBe("Tasks");
    expect(firstRepositories).toEqual([repository]);
    expect(secondRepositories).toEqual(firstRepositories);
    expect(secondRepositories).not.toBe(firstRepositories);
    expect(storageFactory.creations).toHaveLength(2);
    expect(stateTypeName(storageFactory.creations[1])).toBe(AggregateStateSchema.typeName);
  });

  it("does not register repositories removed before build", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).remove(repository).build();

    expect(repository.isRegistered()).toBe(false);
    expect(context.registeredRepositories()).toEqual([]);
  });

  it("keeps repeated add of the same repository idempotent for one built context", () => {
    const storageFactory = new ObservingStorageFactory([]);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .add(repository)
      .build();

    expect(repository.isRegistered()).toBe(true);
    expect(context.registeredRepositories()).toEqual([repository]);
    expect(storageFactory.creations).toHaveLength(2);
  });

  it("rejects registering one repository instance with two built contexts", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });

    BoundedContext.singleTenant("Tasks").add(repository).build();

    expect(() => BoundedContext.singleTenant("Customers").add(repository).build()).toThrow(
      "already registered with Bounded Context",
    );
    expect(repository.registeredContextName?.value).toBe("Tasks");
  });

  it("rejects duplicate repository entity or state identities when building", () => {
    const firstTaskRepository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const secondTaskRepository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const duplicateStateRepository = new Repository({
      entityType: DuplicateTaskAggregate,
      schema: AggregateStateSchema,
    });

    expect(() =>
      BoundedContext.singleTenant("Tasks")
        .add(firstTaskRepository)
        .add(secondTaskRepository)
        .build(),
    ).toThrow(`Repository entity type "TaskAggregate" is already registered.`);
    expect(firstTaskRepository.isRegistered()).toBe(false);
    expect(secondTaskRepository.isRegistered()).toBe(false);

    expect(() =>
      BoundedContext.singleTenant("Tasks")
        .add(firstTaskRepository)
        .add(duplicateStateRepository)
        .build(),
    ).toThrow(`Repository state type "${AggregateStateSchema.typeName}" is already registered.`);
    expect(firstTaskRepository.isRegistered()).toBe(false);
    expect(duplicateStateRepository.isRegistered()).toBe(false);
  });

  it("rejects structural repository lookalikes before registration", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const structuralRepository = {
      entityType: repository.entityType,
      entityFamily: repository.entityFamily,
      stateSchema: repository.stateSchema,
      metadata: repository.metadata,
      stateFullTypeName: repository.stateFullTypeName,
      idField: repository.idField,
      snapshot: repository.snapshot,
      isRegistered: () => false,
      registeredContextName: undefined,
    } as unknown as Repository<typeof TaskAggregate>;

    expect(() => BoundedContext.singleTenant("Tasks").add(structuralRepository)).toThrow(
      "BoundedContextBuilder.add(repository) requires a Repository instance.",
    );
    expect(repository.isRegistered()).toBe(false);
  });

  it("does not strand earlier repositories when later storage opening fails", () => {
    const storageFactory = new FailingStorageFactory(3, ProjectionStateSchema.typeName);
    const aggregateRepository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });

    expect(() =>
      BoundedContext.singleTenant("Tasks")
        .withStorageFactory(storageFactory)
        .add(aggregateRepository)
        .add(projectionRepository)
        .build(),
    ).toThrow(`Cannot open storage for "${ProjectionStateSchema.typeName}".`);

    expect(aggregateRepository.isRegistered()).toBe(false);
    expect(projectionRepository.isRegistered()).toBe(false);
    expect(storageFactory.creations).toHaveLength(2);
    expect(storageFactory.storages).toHaveLength(2);
    expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
    expect(stateTypeName(storageFactory.creations[1])).toBe(AggregateStateSchema.typeName);
  });

  it("keeps add and remove chainable while maintaining the registration list", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const builder = BoundedContext.singleTenant("Tasks");

    expect(builder.add(repository)).toBe(builder);
    expect(builder.remove(repository)).toBe(builder);
    expect(builder).toBeInstanceOf(BoundedContextBuilder);
  });

  it("does not expose repository, delivery, stand, gRPC, or transport APIs on BoundedContext", () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const forbiddenMembers = [
      "repositories",
      "register",
      "registerRepository",
      "storage",
      "storageFactory",
      "delivery",
      "stand",
      "grpc",
      "transport",
      "importBus",
      "systemContext",
      "tenantIndex",
      "repositoryLifecycle",
      "openStorage",
      "dispatch",
      "invoke",
    ];

    for (const member of forbiddenMembers) {
      expect(member in context).toBe(false);
      expect(Object.hasOwn(context, member)).toBe(false);
    }
  });
});

class ObservingStorageFactory extends StorageFactory {
  readonly creations: StorageCreation[] = [];
  readonly storages: RecordStorage<unknown, Message>[] = [];

  constructor(private readonly observed: string[]) {
    super();
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.creations.push({ context, recordSpec });
    const storage = new ObservingRecordStorage(context, recordSpec, this.observed);
    this.storages.push(storage);
    return storage;
  }
}

class FailingStorageFactory extends ObservingStorageFactory {
  #attempts = 0;

  constructor(
    private readonly failedAttempt: number,
    private readonly failedTypeName: string,
  ) {
    super([]);
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.#attempts += 1;
    if (this.#attempts === this.failedAttempt) {
      throw new Error(`Cannot open storage for "${this.failedTypeName}".`);
    }
    return super.onCreateRecordStorage(context, recordSpec);
  }
}

class ObservingRecordStorage<I, R extends Message> extends InMemoryRecordStorage<I, R> {
  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    private readonly observed: string[],
  ) {
    super(context, recordSpec);
  }

  protected override async writeRecord(
    record: ReturnType<RecordSpec<I, R>["materialize"]>,
  ): Promise<void> {
    const candidate = record.record as { id?: { value?: string } };
    this.observed.push(`store:${candidate.id?.value ?? "missing"}`);
    await super.writeRecord(record);
  }
}

function createCommandDispatcher(
  schemas: readonly GenMessage<Message>[],
  onDispatch: (command: ReturnType<typeof createProjectionCommand>) => void | Promise<void>,
): CommandDispatcher {
  return {
    messageSchemas: () => schemas,
    dispatch: (command) => Promise.resolve(onDispatch(command)),
  };
}

function createEventDispatcher(
  schemas: readonly GenMessage<Message>[],
  onDispatch: (event: ReturnType<typeof createProjectionEvent>) => void | Promise<void>,
): EventDispatcher {
  return {
    messageSchemas: () => schemas,
    dispatch: (event) => Promise.resolve(onDispatch(event)),
  };
}

function createProjectionCommand(id: string) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    schema: ProjectionStateSchema,
    message: create(ProjectionStateSchema, {
      id: "task-1",
      name: "Task",
      priority: 1,
    }),
  });
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

interface StorageCreation {
  readonly context: StorageContext;
  readonly recordSpec: RecordSpec<unknown, Message>;
}

function stateTypeName(creation: StorageCreation | undefined): string | undefined {
  if (creation === undefined) {
    return undefined;
  }

  const record = creation.recordSpec.materialize(
    create(AggregateStateSchema, {
      id: "task-1",
      name: "Task",
      archived: false,
    }),
  ).record;

  return record.$typeName;
}
