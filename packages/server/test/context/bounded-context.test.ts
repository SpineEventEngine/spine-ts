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
  type Event,
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
  ProcessManager,
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

type ProcessManagerState = Message<"ProcessManagerState"> & {
  id: string;
  queue: string;
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

const fileEntityVisibilityFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.visibility.descriptorSetBase64,
);
const ProcessManagerStateSchema = messageDesc(
  fileEntityVisibilityFixture,
  0,
) as GenMessage<ProcessManagerState>;

class TaskAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
class DuplicateTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {}
class TaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {}
class TaskProcessManager extends ProcessManager<string, typeof ProcessManagerStateSchema, number> {}

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

  it("owns a stable stand with repository state types registered", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    const stand = context.stand();

    expect(stand).toBe(context.stand());
    expect(stand.stateTypes()).toEqual([deriveTypeUrl(ProjectionStateSchema)]);

    await stand.update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-1",
        name: "Task",
        priority: 1,
      }),
    );

    await expect(stand.read(ProjectionStateSchema, "task-1")).resolves.toMatchObject({
      id: "task-1",
      name: "Task",
      priority: 1,
    });
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

  it("closes the event store when event dispatcher registration fails", () => {
    const storageFactory = new ObservingStorageFactory([]);
    const dispatcher = createEventDispatcher([ProjectionStateSchema], () => undefined);
    const brokenDispatcher = {
      messageSchemas: () => {
        throw new Error("Cannot read event schemas.");
      },
      dispatch: (event: Event): Promise<void> => Promise.resolve(void event),
    } satisfies EventDispatcher;

    expect(() =>
      BoundedContext.singleTenant("Tasks")
        .withStorageFactory(storageFactory)
        .addEventDispatcher(dispatcher)
        .addEventDispatcher(brokenDispatcher)
        .build(),
    ).toThrow("Cannot read event schemas.");

    expect(storageFactory.storages).toHaveLength(1);
    expect(storageFactory.storages[0]?.isOpen()).toBe(false);
  });

  it("preserves event registration and event-store cleanup failures", () => {
    const storageFactory = new ObservingStorageFactory([], [1]);
    const brokenDispatcher = {
      messageSchemas: () => {
        throw new Error("Cannot read event schemas.");
      },
      dispatch: (event: Event): Promise<void> => Promise.resolve(void event),
    } satisfies EventDispatcher;

    let thrown: unknown;
    try {
      BoundedContext.singleTenant("Tasks")
        .withStorageFactory(storageFactory)
        .addEventDispatcher(brokenDispatcher)
        .build();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const errors = (thrown as AggregateError).errors as Error[];
    expect(errors.map((error) => error.message)).toEqual([
      "Cannot read event schemas.",
      "Cannot close record storage.",
    ]);
    expect(storageFactory.storages).toHaveLength(1);
    expect(storageFactory.storages[0]?.isOpen()).toBe(false);
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
    expect(firstRepositories).toHaveLength(1);
    expect(firstRepositories[0]).not.toBe(repository);
    expect(firstRepositories[0]?.entityType).toBe(TaskAggregate);
    expect(firstRepositories[0]?.stateFullTypeName).toBe(AggregateStateSchema.typeName);
    expect(secondRepositories).toEqual(firstRepositories);
    expect(secondRepositories).not.toBe(firstRepositories);
    expect(secondRepositories[0]).not.toBe(firstRepositories[0]);
    expect(storageFactory.creations).toHaveLength(2);
    expect(stateTypeName(storageFactory.creations[1])).toBe(AggregateStateSchema.typeName);
  });

  it("does not register repositories removed before build", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).remove(repository).build();

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

    const repositories = context.registeredRepositories();
    expect(repositories).toHaveLength(1);
    expect(repositories[0]?.stateFullTypeName).toBe(AggregateStateSchema.typeName);
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
  });

  it("rejects reentrant repository registration between preflight and commit", () => {
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    let attempted = false;
    const storageFactory = new ReentrantStorageFactory([], () => {
      if (!attempted) {
        attempted = true;
        BoundedContext.singleTenant("Nested").add(repository).build();
      }
    });

    expect(() =>
      BoundedContext.singleTenant("Tasks")
        .withStorageFactory(storageFactory)
        .add(repository)
        .build(),
    ).toThrow('already registered with Bounded Context "Nested"');
    expect(storageFactory.storages).toHaveLength(2);
    expect(storageFactory.storages[1]?.isOpen()).toBe(false);
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

    expect(() =>
      BoundedContext.singleTenant("Tasks")
        .add(firstTaskRepository)
        .add(duplicateStateRepository)
        .build(),
    ).toThrow(`Repository state type "${AggregateStateSchema.typeName}" is already registered.`);
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
    } as unknown as Repository<typeof TaskAggregate>;

    expect(() => BoundedContext.singleTenant("Tasks").add(structuralRepository)).toThrow(
      "BoundedContextBuilder.add(repository) requires a Repository instance.",
    );
  });

  it("uses captured repository metadata instead of virtual getters for registration", () => {
    const projectionMetadata = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    }).metadata;
    class SpoofingRepository extends Repository<typeof TaskAggregate> {
      constructor() {
        super({
          entityType: TaskAggregate,
          schema: AggregateStateSchema,
        });
      }

      override get metadata(): Repository<typeof TaskAggregate>["metadata"] {
        return projectionMetadata as unknown as Repository<typeof TaskAggregate>["metadata"];
      }

      override get stateFullTypeName(): Repository<typeof TaskAggregate>["stateFullTypeName"] {
        return ProjectionStateSchema.typeName as Repository<
          typeof TaskAggregate
        >["stateFullTypeName"];
      }
    }

    const storageFactory = new ObservingStorageFactory([]);
    const spoofingRepository = new SpoofingRepository();
    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(spoofingRepository)
      .add(projectionRepository)
      .build();

    const repositories = context.registeredRepositories();
    expect(repositories.map((repository) => repository.stateFullTypeName)).toEqual([
      AggregateStateSchema.typeName,
      ProjectionStateSchema.typeName,
    ]);
    expect(repositories[0]).not.toBe(spoofingRepository);
    expect(repositories[1]).not.toBe(projectionRepository);
    expect(stateTypeName(storageFactory.creations[1])).toBe(AggregateStateSchema.typeName);
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

    expect(storageFactory.creations).toHaveLength(2);
    expect(storageFactory.storages).toHaveLength(2);
    expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
    expect(stateTypeName(storageFactory.creations[1])).toBe(AggregateStateSchema.typeName);

    const recoveryFactory = new ObservingStorageFactory([]);
    const recovered = BoundedContext.singleTenant("Recovered")
      .withStorageFactory(recoveryFactory)
      .add(aggregateRepository)
      .build();
    const repositories = recovered.registeredRepositories();
    expect(repositories).toHaveLength(1);
    expect(repositories[0]?.stateFullTypeName).toBe(AggregateStateSchema.typeName);
  });

  it("closes every prepared repository storage when cleanup also fails", () => {
    const storageFactory = new FailingStorageFactory(4, ProcessManagerStateSchema.typeName, [2]);
    const aggregateRepository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const projectionRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const processManagerRepository = new Repository({
      entityType: TaskProcessManager,
      schema: ProcessManagerStateSchema,
    });

    let thrown: unknown;
    try {
      BoundedContext.singleTenant("Tasks")
        .withStorageFactory(storageFactory)
        .add(aggregateRepository)
        .add(projectionRepository)
        .add(processManagerRepository)
        .build();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AggregateError);
    const errors = (thrown as AggregateError).errors as Error[];
    expect(errors.map((error) => error.message)).toEqual([
      `Cannot open storage for "${ProcessManagerStateSchema.typeName}".`,
      "Cannot close record storage.",
    ]);
    expect(storageFactory.storages).toHaveLength(3);
    expect(storageFactory.storages[1]?.isOpen()).toBe(false);
    expect(storageFactory.storages[2]?.isOpen()).toBe(false);
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

  it("does not expose repository, delivery, gRPC, or transport APIs on BoundedContext", () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const forbiddenMembers = [
      "repositories",
      "register",
      "registerRepository",
      "storage",
      "storageFactory",
      "delivery",
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
  #creationCount = 0;

  constructor(
    private readonly observed: string[],
    private readonly throwOnCloseCreations: readonly number[] = [],
  ) {
    super();
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    this.#creationCount += 1;
    this.creations.push({ context, recordSpec });
    const storage = this.throwOnCloseCreations.includes(this.#creationCount)
      ? new ThrowingCloseRecordStorage(context, recordSpec, this.observed)
      : new ObservingRecordStorage(context, recordSpec, this.observed);
    this.storages.push(storage);
    return storage;
  }
}

class FailingStorageFactory extends ObservingStorageFactory {
  #attempts = 0;

  constructor(
    private readonly failedAttempt: number,
    private readonly failedTypeName: string,
    throwOnCloseCreations: readonly number[] = [],
  ) {
    super([], throwOnCloseCreations);
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

class ReentrantStorageFactory extends ObservingStorageFactory {
  constructor(
    observed: string[],
    private readonly onCreate: () => void,
  ) {
    super(observed);
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
    this.#observe(record);
    await super.writeRecord(record);
  }

  protected override async writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    for (const record of records) {
      this.#observe(record);
    }
    await super.writeAllRecords(records);
  }

  #observe(record: ReturnType<RecordSpec<I, R>["materialize"]>): void {
    const candidate = record.record as { id?: { value?: string } };
    this.observed.push(`store:${candidate.id?.value ?? "missing"}`);
  }
}

class ThrowingCloseRecordStorage<I, R extends Message> extends ObservingRecordStorage<I, R> {
  override close(): void {
    super.close();
    throw new Error("Cannot close record storage.");
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
