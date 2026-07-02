import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { packAny, packCommand, packEvent } from "@spine-ts/core";
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
import { EventStore, InMemoryStorageFactory } from "@spine-ts/storage";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  Aggregate,
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

class TaskAggregate extends Aggregate<string, typeof AggregateStateSchema, number> {
  assignTask(command: AggregateState): void {
    void command;
  }

  reactToProjection(event: ProjectionState): void {
    void event;
  }
}

describe("repository signal routing", () => {
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

function createAggregateCommand(id: string, aggregateId: string) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: aggregateId,
      name: "Task",
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
