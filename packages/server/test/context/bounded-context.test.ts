import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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
  EventSchema,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import {
  InMemoryStorageFactory,
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
import { boundedContextAccess } from "../../src/context/bounded-context.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

interface InternalSystemPairing {
  readonly domain: {
    readonly name: { readonly value: string };
    readonly tenantMode: "single-tenant" | "multitenant";
  };
  readonly system: {
    readonly name: { readonly value: string };
    readonly multitenant: boolean;
    readonly storesEvents: boolean;
  };
}

interface InternalTenantIndex {
  readonly tenantMode: "single-tenant" | "multitenant";
  all(): Promise<readonly string[]>;
  keep(tenantId: string): Promise<void>;
}

interface InternalDeliveryScope {
  readonly tenantId?: string;
}

interface InternalDeliveryEndpoint {
  readonly label: "HANDLE_COMMAND" | "UPDATE_SUBSCRIBER" | "REACT_UPON_EVENT";
  readonly targetTypeUrl: string;
  readonly shard: { readonly index: number; readonly ofTotal: number };
}

interface InternalDeliveryDescriptor {
  readonly storageFactory: StorageFactory;
  startupScopes(): Promise<readonly InternalDeliveryScope[]>;
  endpoints(): readonly InternalDeliveryEndpoint[];
  onReady(onReady: (ready: unknown) => void): () => void;
}

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
class GeneratedTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignProjection(command: ProjectionState): ProjectionState {
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: command.id,
        name: command.name,
        archived: false,
      }),
    );

    return create(ProjectionStateSchema, command);
  }
}
class TaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  onProjection(event: ProjectionState): void {
    this.updateDraftState(() =>
      create(ProjectionStateSchema, {
        id: event.id,
        name: event.name,
        priority: event.priority,
      }),
    );
  }
}
class TaskProcessManager extends ProcessManager<string, typeof ProcessManagerStateSchema, number> {}
class GeneratedTaskProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  assignTask(command: AggregateState): ProjectionState {
    this.updateDraftState(() =>
      create(ProcessManagerStateSchema, {
        id: command.id,
        queue: `${command.name} assigned`,
      }),
    );

    return create(ProjectionStateSchema, {
      id: command.id,
      name: `${command.name} event`,
      priority: 1,
    });
  }
}

function internalSystemPairing(context: BoundedContext): InternalSystemPairing {
  return (
    boundedContextAccess as unknown as {
      systemPairing(context: BoundedContext): InternalSystemPairing;
    }
  ).systemPairing(context);
}

function internalTenantIndex(context: BoundedContext): InternalTenantIndex {
  return (
    boundedContextAccess as unknown as {
      tenantIndex(context: BoundedContext): InternalTenantIndex;
    }
  ).tenantIndex(context);
}

function internalDeliveryDescriptor(context: BoundedContext): InternalDeliveryDescriptor {
  return (
    boundedContextAccess as unknown as {
      delivery(context: BoundedContext): InternalDeliveryDescriptor;
    }
  ).delivery(context);
}

describe("BoundedContext assembly", () => {
  it("rejects empty or blank context names", () => {
    expect(() => BoundedContext.singleTenant("\t\n")).toThrow(BoundedContextNameError);
    expect(() => BoundedContext.multitenant("")).toThrow(BoundedContextNameError);
    expect(() => BoundedContext.singleTenant("__spine/Tasks/tenants")).toThrow(
      BoundedContextNameError,
    );
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

  it("derives internal system pairing metadata for built domain contexts", () => {
    const singleTenant = BoundedContext.singleTenant("Tasks").build();
    const multitenant = BoundedContext.multitenant("Customers").build();

    const singlePairing = internalSystemPairing(singleTenant);
    const multitenantPairing = internalSystemPairing(multitenant);

    expect(singlePairing.domain.name.value).toBe("Tasks");
    expect(singlePairing.domain.tenantMode).toBe("single-tenant");
    expect(singlePairing.system.name.value).toBe("Tasks_System");
    expect(singlePairing.system.multitenant).toBe(false);
    expect(singlePairing.system.storesEvents).toBe(false);

    expect(multitenantPairing.domain.name.value).toBe("Customers");
    expect(multitenantPairing.domain.tenantMode).toBe("multitenant");
    expect(multitenantPairing.system.name.value).toBe("Customers_System");
    expect(multitenantPairing.system.multitenant).toBe(true);
    expect(multitenantPairing.system.storesEvents).toBe(false);
  });

  it("exposes a constant single-tenant index through internal context access", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const tenantIndex = internalTenantIndex(context);

    expect(tenantIndex.tenantMode).toBe("single-tenant");
    await expect(tenantIndex.all()).resolves.toEqual([]);
    await expect(tenantIndex.keep("tenant-a")).rejects.toThrow(
      'Single-tenant context "Tasks" does not accept tenant recording.',
    );
  });

  it("rejects single-tenant index access after context close", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const tenantIndex = internalTenantIndex(context);

    await context.close();

    await expect(tenantIndex.all()).rejects.toThrow("TenantIndex is closed.");
    await expect(tenantIndex.keep("tenant-a")).rejects.toThrow("TenantIndex is closed.");
  });

  it("stores multitenant index entries through the configured storage factory", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const first = BoundedContext.multitenant("Customers")
      .withStorageFactory(storageFactory)
      .build();
    const firstIndex = internalTenantIndex(first);

    expect(firstIndex.tenantMode).toBe("multitenant");

    await firstIndex.keep("tenant-b");
    await firstIndex.keep("tenant-a");
    await firstIndex.keep("tenant-a");

    await expect(firstIndex.all()).resolves.toEqual(["tenant-a", "tenant-b"]);

    const recovered = BoundedContext.multitenant("Customers")
      .withStorageFactory(storageFactory)
      .build();
    const recoveredIndex = internalTenantIndex(recovered);

    await expect(recoveredIndex.all()).resolves.toEqual(["tenant-a", "tenant-b"]);
  });

  it("describes actual delivery storage and tenant startup scopes through internal access", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const single = BoundedContext.singleTenant("Tasks").withStorageFactory(storageFactory).build();
    const multitenant = BoundedContext.multitenant("Customers")
      .withStorageFactory(storageFactory)
      .build();

    await internalTenantIndex(multitenant).keep("tenant-b");
    await internalTenantIndex(multitenant).keep("tenant-a");

    expect(internalDeliveryDescriptor(single).storageFactory).toBe(storageFactory);
    await expect(internalDeliveryDescriptor(single).startupScopes()).resolves.toEqual([{}]);
    expect(internalDeliveryDescriptor(multitenant).storageFactory).toBe(storageFactory);
    await expect(internalDeliveryDescriptor(multitenant).startupScopes()).resolves.toEqual([
      { tenantId: "tenant-a" },
      { tenantId: "tenant-b" },
    ]);
  });

  it("describes configured supported delivery endpoints and their shards", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskProcessManager,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            signalSchema: AggregateStateSchema,
            emittedSchemas: [ProjectionStateSchema],
            parameterCount: 1,
          },
        ],
      },
      {
        entityType: TaskProjection,
        stateSchema: ProjectionStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "onProjection",
            signalSchema: ProjectionStateSchema,
            emittedSchemas: [],
            parameterCount: 1,
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskProcessManager)
      .add(TaskProjection)
      .buildAsync();

    expect(internalDeliveryDescriptor(context).endpoints()).toEqual([
      {
        label: "HANDLE_COMMAND",
        targetTypeUrl: deriveTypeUrl(ProcessManagerStateSchema),
        shard: { index: 0, ofTotal: 1 },
      },
      {
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl: deriveTypeUrl(ProjectionStateSchema),
        shard: { index: 0, ofTotal: 1 },
      },
    ]);

    const ready: unknown[] = [];
    const stopObserving = internalDeliveryDescriptor(context).onReady((scope) => ready.push(scope));
    await context.commandBus().post(createAggregateCommand("command-ready"));
    stopObserving();

    expect(ready).toEqual([
      {
        label: "HANDLE_COMMAND",
        targetTypeUrl: deriveTypeUrl(ProcessManagerStateSchema),
        shard: { index: 0, ofTotal: 1 },
      },
      {
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl: deriveTypeUrl(ProjectionStateSchema),
        shard: { index: 0, ofTotal: 1 },
      },
    ]);
  });

  it("rejects blank multitenant index entries", async () => {
    const context = BoundedContext.multitenant("Customers").build();
    const tenantIndex = internalTenantIndex(context);

    await expect(tenantIndex.keep(" \t ")).rejects.toThrow(
      "Tenant index requires a non-blank tenant ID.",
    );
  });

  it("keeps tenant-index storage in an internal namespace", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    const customers = BoundedContext.multitenant("Customers")
      .withStorageFactory(storageFactory)
      .build();
    const tenantIndex = internalTenantIndex(customers);

    await tenantIndex.keep("tenant-a");

    const tenantIndexCreation = storageFactory.creations.find(
      (creation) => creation.context.name !== "Customers",
    );
    expect(tenantIndexCreation?.context).toMatchObject({
      name: "__spine/Customers/tenants",
      multitenant: false,
    });

    const publicStorage = storageFactory.createRecordStorage(
      { name: "Customers_Tenants", multitenant: false },
      tenantIndexCreation?.recordSpec as RecordSpec<string, Message<"google.protobuf.StringValue">>,
    );

    await expect(publicStorage.index()).resolves.toEqual([]);
  });

  it("exposes stable commandBus() and eventBus() endpoints from the built context", () => {
    const context = BoundedContext.singleTenant("Tasks").build();

    expectTypeOf(context.commandBus()).toEqualTypeOf<CommandEndpoint>();
    expectTypeOf(context.eventBus()).toEqualTypeOf<EventEndpoint>();
    expect(typeof context.commandBus().post).toBe("function");
    expect(typeof context.commandBus().acceptedCommandTypes).toBe("function");
    expect(typeof context.eventBus().post).toBe("function");
    expect(typeof context.eventBus().acceptedEventTypes).toBe("function");
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

  it("does not expose internal event types accepted by framework dispatchers", () => {
    const dispatcher = createEventDispatcher([EventSchema, ProjectionStateSchema], () => undefined);
    const context = BoundedContext.singleTenant("Tasks").addEventDispatcher(dispatcher).build();

    expect(context.eventBus().acceptedEventTypes()).toEqual([deriveTypeUrl(ProjectionStateSchema)]);
  });

  it("rejects package-local event subscriptions for non-context values", () => {
    expect(() =>
      boundedContextAccess.subscribeToEvent(
        {} as BoundedContext,
        deriveTypeUrl(ProjectionStateSchema),
        { onEvent: () => undefined },
      ),
    ).toThrow("Event subscription requires a built BoundedContext instance.");
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

  it("builds generated repositories from entity classes with buildAsync", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignProjection",
            signalSchema: ProjectionStateSchema,
            emittedSchemas: [ProjectionStateSchema],
            parameterCount: 1,
          },
        ],
      },
      {
        entityType: TaskProjection,
        stateSchema: ProjectionStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "onProjection",
            signalSchema: ProjectionStateSchema,
            emittedSchemas: [],
            parameterCount: 1,
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskAggregate)
      .add(TaskProjection)
      .buildAsync();

    expect(context.registeredRepositories().map((repository) => repository.entityType)).toEqual([
      GeneratedTaskAggregate,
      TaskProjection,
    ]);
    expect(context.commandBus().acceptedCommandTypes()).toEqual([
      deriveTypeUrl(ProjectionStateSchema),
    ]);

    await expect(context.commandBus().post(createProjectionCommand("command-4"))).resolves.toBe(
      undefined,
    );
  });

  it("executes a generated process-manager repository assembled through buildAsync", async () => {
    const observed: Event[] = [];
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskProcessManager,
        stateSchema: ProcessManagerStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            signalSchema: AggregateStateSchema,
            emittedSchemas: [ProjectionStateSchema],
            parameterCount: 1,
          },
        ],
      },
    ]);
    const context = await BoundedContext.singleTenant("Tasks")
      .withGeneratedRegistryRoot(registryRoot)
      .add(GeneratedTaskProcessManager)
      .addEventDispatcher(
        createEventDispatcher([ProjectionStateSchema], (event) => {
          observed.push(event);
        }),
      )
      .buildAsync();

    await expect(
      context.commandBus().post(
        packCommand({
          id: create(CommandIdSchema, { uuid: "command-generated-pm" }),
          context: create(CommandContextSchema, {
            actorContext: create(ActorContextSchema, {
              actor: create(UserIdSchema, { value: "user-1" }),
            }),
          }),
          schema: AggregateStateSchema,
          message: create(AggregateStateSchema, {
            id: "generated-pm",
            name: "Generated PM",
            archived: false,
          }),
        }),
      ),
    ).resolves.toBeUndefined();

    await expect(context.stand().read(ProcessManagerStateSchema, "generated-pm")).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "generated-pm",
        queue: "Generated PM assigned",
      }),
    );
    await waitForCondition(
      () => observed.length === 1,
      "generated process-manager produced event dispatch",
    );
    expect(observed).toHaveLength(1);
    expect(observed[0]?.id).toEqual(create(EventIdSchema, { value: "command-generated-pm-1" }));
    const message = observed[0]?.message;
    if (message === undefined) {
      throw new Error("Expected a generated process-manager produced event.");
    }
    expect(message.typeUrl).toBe(deriveTypeUrl(ProjectionStateSchema));
  });

  it("requires an explicit generated registry root for entity-class assembly", async () => {
    await expect(
      BoundedContext.singleTenant("Tasks").add(GeneratedTaskAggregate).buildAsync(),
    ).rejects.toThrow("requires withGeneratedRegistryRoot(root)");
  });

  it("accepts generated registry roots passed as file URL strings", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [],
      },
    ]);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(registryRoot.href)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).resolves.toBeInstanceOf(BoundedContext);
  });

  it("rejects malformed generated registry root URLs", async () => {
    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot("file://%")
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow('Generated registry root "file://%" is not a valid URL.');
  });

  it("rejects generated registry roots outside file URLs", async () => {
    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot("https://example.com/generated")
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("must use the file: URL scheme");
  });

  it("rejects generated registry root URL aliases with query or hash", async () => {
    const registryRoot = createGeneratedRegistryRoot([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [],
      },
    ]);
    const aliasedRoot = new URL(registryRoot.href);

    aliasedRoot.search = "cache=1";

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(aliasedRoot)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("must not include a query or hash");

    aliasedRoot.search = "";
    aliasedRoot.hash = "generated";

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(aliasedRoot)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("must not include a query or hash");
  });

  it("rejects generated registry modules that resolve outside the trusted root", async () => {
    const fixture = createGeneratedRegistryFixture([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [],
      },
    ]);
    const root = mkdtempSync(join(tmpdir(), "spine-context-generated-registry-root-"));
    const moduleDir = join(root, "generated/handler");

    mkdirSync(moduleDir, { recursive: true });
    symlinkSync(fixture.registryPath, join(moduleDir, "generated-handler-registry.js"));

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(pathToFileURL(root))
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("must resolve within the configured generated registry root");
  });

  it("checks the generated registry file before each import instead of using a stale module cache", async () => {
    const fixture = createGeneratedRegistryFixture([
      {
        entityType: GeneratedTaskAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [],
      },
    ]);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(fixture.root)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).resolves.toBeInstanceOf(BoundedContext);

    rmSync(fixture.registryPath);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(fixture.root)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("must exist and be readable");
  });

  it("fails clearly when generated metadata is missing for an entity class", async () => {
    const registryRoot = createGeneratedRegistryRoot([]);

    await expect(
      BoundedContext.singleTenant("Tasks")
        .withGeneratedRegistryRoot(registryRoot)
        .add(GeneratedTaskAggregate)
        .buildAsync(),
    ).rejects.toThrow("Generated handler registry is missing metadata for GeneratedTaskAggregate.");
  });

  it("fails clearly when sync build sees entity-class generated assembly", () => {
    expect(() => BoundedContext.singleTenant("Tasks").add(GeneratedTaskAggregate).build()).toThrow(
      "Use buildAsync().",
    );
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

  it("closes owned buses, stand, event store, repository storage, and tenant index once", async () => {
    const storageFactory = new ObservingStorageFactory([]);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.multitenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .build();

    await context.close();
    await context.close();

    await expect(
      context.commandBus().post(createProjectionCommand("command-closed")),
    ).rejects.toMatchObject({
      operation: "enqueue",
      state: "closed",
    });
    expect(() => context.stand().stateTypes()).toThrow("Stand is closed.");
    expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
    expect(storageFactory.isOpen()).toBe(true);
  });

  it("closes tenant-index storage if repository registration fails", () => {
    const storageFactory = new FailingStorageFactory(3, AggregateStateSchema.typeName);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });

    expect(() =>
      BoundedContext.multitenant("Tasks")
        .withStorageFactory(storageFactory)
        .add(repository)
        .build(),
    ).toThrow('Cannot open storage for "AggregateState".');

    const tenantIndexCreation = storageFactory.creations.find(
      (creation) => creation.context.name !== "Tasks",
    );
    expect(tenantIndexCreation?.context.name).toBe("__spine/Tasks/tenants");
    expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
  });

  it("waits for in-flight direct Stand updates before closing subscriptions", async () => {
    const storageFactory = new DelayingStorageFactory();
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .build();
    const deliveries: string[] = [];
    context.stand().subscribe(ProjectionStateSchema, (update) => {
      deliveries.push(update.state.name);
    });

    const update = context.stand().update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-in-flight",
        name: "In Flight",
        priority: 1,
      }),
    );
    await storageFactory.writeStarted;
    const close = context.stand().close();

    expect(() => context.stand().stateTypes()).toThrow("Stand is closed.");

    storageFactory.releaseWrite();
    await update;
    await close;

    expect(deliveries).toEqual(["In Flight"]);
    await expect(
      context.stand().update(
        ProjectionStateSchema,
        create(ProjectionStateSchema, {
          id: "task-rejected",
          name: "Rejected",
          priority: 1,
        }),
      ),
    ).rejects.toThrow("Stand is closed.");
  });

  it("attempts every bounded-context close and reports aggregate failure", async () => {
    const storageFactory = new ObservingStorageFactory([], [1, 2]);
    const repository = new Repository({
      entityType: TaskAggregate,
      schema: AggregateStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(repository)
      .build();

    const closeFailure = await context.close().then(
      () => {
        throw new Error("Expected BoundedContext close to fail.");
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(AggregateError);
        return error as AggregateError;
      },
    );

    expect(closeFailure).toBeInstanceOf(AggregateError);
    expect(closeFailure).toMatchObject({
      message: "BoundedContext close failed.",
    });
    await expect(context.close()).rejects.toMatchObject({
      message: "BoundedContext close failed.",
    });
    expect(closeFailure.errors.map((error: Error) => error.message)).toEqual([
      "Cannot close record storage.",
      "Cannot close record storage.",
    ]);
    expect(storageFactory.storages.every((storage) => !storage.isOpen())).toBe(true);
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

class DelayingStorageFactory extends StorageFactory {
  readonly writeStarted: Promise<void>;
  #startWrite: (() => void) | undefined;
  #finishWrite: (() => void) | undefined;
  #writeFinished: Promise<void>;
  #delayed = false;

  constructor() {
    super();
    this.writeStarted = new Promise((resolve) => {
      this.#startWrite = resolve;
    });
    this.#writeFinished = new Promise((resolve) => {
      this.#finishWrite = resolve;
    });
  }

  releaseWrite(): void {
    this.#finishWrite?.();
  }

  protected onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new DelayingRecordStorage(context, recordSpec, {
      beforeFirstWrite: async () => {
        if (this.#delayed) {
          return;
        }
        this.#delayed = true;
        this.#startWrite?.();
        await this.#writeFinished;
      },
    });
  }
}

class DelayingRecordStorage<I, R extends Message> extends InMemoryRecordStorage<I, R> {
  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    private readonly delay: { beforeFirstWrite(): Promise<void> },
  ) {
    super(context, recordSpec);
  }

  protected override async writeRecord(
    record: ReturnType<RecordSpec<I, R>["materialize"]>,
  ): Promise<void> {
    await this.delay.beforeFirstWrite();
    await super.writeRecord(record);
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

function createAggregateCommand(id: string) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: "task-ready",
      name: "Task Ready",
      archived: false,
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

function createGeneratedRegistryFixture(
  entities: readonly {
    readonly entityType: object;
    readonly stateSchema: GenMessage<Message>;
    readonly handlers: readonly {
      readonly kind:
        "command-assignment" | "command-reaction" | "event-subscription" | "event-reaction";
      readonly methodName: string;
      readonly signalSchema: GenMessage<Message>;
      readonly emittedSchemas: readonly GenMessage<Message>[];
      readonly parameterCount: 1 | 2;
    }[];
  }[],
): { readonly root: URL; readonly registryPath: string } {
  const slot = `__spineContextGeneratedRegistry_${Math.random().toString(36).slice(2)}`;
  const root = mkdtempSync(join(tmpdir(), "spine-context-generated-registry-"));
  const moduleDir = join(root, "generated/handler");
  const registryPath = join(moduleDir, "generated-handler-registry.js");
  const values = globalThis as Record<string, unknown>;

  mkdirSync(moduleDir, { recursive: true });
  values[slot] = Object.freeze({ version: 1, entities });
  writeFileSync(
    registryPath,
    `export const generatedHandlerRegistry = globalThis[${JSON.stringify(slot)}];\n`,
    "utf8",
  );

  return Object.freeze({
    root: pathToFileURL(root),
    registryPath,
  });
}

function createGeneratedRegistryRoot(
  entities: Parameters<typeof createGeneratedRegistryFixture>[0],
): URL {
  return createGeneratedRegistryFixture(entities).root;
}

async function waitForCondition(predicate: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${label}.`);
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
