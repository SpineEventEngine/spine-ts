import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  BytesValueSchema,
  EmptySchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  FieldMaskSchema,
  Int32ValueSchema,
  StringValueSchema,
  type Any,
} from "@bufbuild/protobuf/wkt";
import {
  ValidationException,
  deriveTypeUrl,
  packAny,
  packCommand,
  packEvent,
  type MessageSchema,
  unpackAny,
} from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandSchema,
  CommandContextSchema,
  CommandIdSchema,
  Command_SystemPropertiesSchema,
  EmailAddressSchema,
  EventContextSchema,
  EventIdSchema,
  InternetDomainSchema,
  TenantIdSchema,
  type TenantId,
  UserIdSchema,
  ValidationErrorSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import { CommandService } from "@spine-ts/proto/generated/spine/client/command_service_pb.js";
import {
  type CompositeFilter,
  CompositeFilter_CompositeOperator,
  CompositeFilterSchema,
  Filter_Operator,
  FilterSchema,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import {
  OrderBySchema,
  OrderBy_Direction,
  QueryIdSchema,
  QuerySchema,
  ResponseFormatSchema,
  type Query,
  type QueryResponse,
} from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
import { SubscriptionService } from "@spine-ts/proto/generated/spine/client/subscription_service_pb.js";
import {
  type Subscription,
  type SubscriptionUpdate,
  type Topic,
  SubscriptionIdSchema,
  SubscriptionSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-ts/proto/generated/spine/client/subscription_pb.js";
import type { Ack } from "@spine-ts/proto/generated/spine/core/ack_pb.js";
import type { Response } from "@spine-ts/proto/generated/spine/core/response_pb.js";
import { describe, expect, it } from "vitest";

import {
  Aggregate,
  BoundedContext,
  CommandRefusalError,
  Projection,
  Repository,
  Server,
  SpineServices,
  defineEntityHandlers,
  type CommandDispatcher,
  type EventDispatcher,
  type RunningServer,
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

type TaskId = Message<"spine.example.todo.v1.TaskId"> & {
  value: string;
};

type Task = Message<"spine.example.todo.v1.Task"> & {
  id?: TaskId;
  title: string;
  completed: boolean;
};

type ValidatedAggregateState = Message<"example.validation_refusal.ValidatedAggregateState"> & {
  id: string;
  name: string;
};

type ValidatedTaskCommand = Message<"example.validation_refusal.ValidatedTaskCommand"> & {
  id: string;
  name: string;
};

type TenantInput = string | TenantId;

function createFixtureFileDescriptor(descriptorSetBase64: string, imports = [file_spine_options]) {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];

  if (descriptor === undefined) {
    throw new Error("Spine services fixture descriptor set is empty.");
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
const fileTaskIdFixture = fileDesc(
  "CiNzcGluZS9leGFtcGxlL3RvZG8vdjEvdGFza19pZC5wcm90bxIVc3BpbmUuZXhhbXBsZS50b2Rv" +
    "LnYxIh0KBlRhc2tJZBITCgV2YWx1ZRgBIAEoCUIEoIUkAUIbqo0kF3R5cGUuc3BpbmUuZXhhbXBs" +
    "ZS50b2RvYgZwcm90bzM",
  [file_spine_options],
);
const fileTaskFixture = fileDesc(
  "CiFzcGluZS9leGFtcGxlL3RvZG8vdjEvdGFza3MucHJvdG8SFXNwaW5lLmV4YW1wbGUudG9kby52" +
    "MSJvCgRUYXNrEjcKAmlkGAEgASgLMh0uc3BpbmUuZXhhbXBsZS50b2RvLnYxLlRhc2tJZEIMoIUk" +
    "AeiFJAGAhiQBEhMKBXRpdGxlGAIgASgJQgSghSQBEhEKCWNvbXBsZXRlZBgDIAEoCDoG+ookAggB" +
    "QhuqjSQXdHlwZS5zcGluZS5leGFtcGxlLnRvZG9iBnByb3RvMw",
  [fileTaskIdFixture, file_spine_options],
);
const TaskIdSchema = messageDesc(fileTaskIdFixture, 0) as GenMessage<TaskId>;
const TaskSchema = messageDesc(fileTaskFixture, 0) as GenMessage<Task>;

class TaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  subscribeTask(event: ProjectionState): void {
    this.updateDraftState(() =>
      create(ProjectionStateSchema, {
        id: event.id,
        name: `${event.name} (projected)`,
        priority: event.priority + 1,
      }),
    );
  }
}

class RefusingTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(): never {
    throw new CommandRefusalError("TASK_ALREADY_COMPLETED", "Task is already completed.");
  }
}

class ValidatingTaskAggregate extends Aggregate<
  string,
  typeof ValidatedAggregateStateSchema,
  bigint
> {
  assignTask(command: ValidatedTaskCommand) {
    return createValidatedEvent(`event-${command.id}`, command.id, command.name);
  }

  applyTask(event: ValidatedAggregateState): void {
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

class TransitionViolatingTaskAggregate extends Aggregate<
  string,
  typeof AggregateStateSchema,
  bigint
> {
  assignTask(command: AggregateState) {
    return createAggregateEvent("event-transition-invalid", command.id, command.name);
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

class RollingBackTransitionTaskAggregate extends TransitionViolatingTaskAggregate {
  override assignTask(command: AggregateState) {
    return createAggregateEvent("event-transition-rollback", command.id, command.name);
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

class MessageIdTaskAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {}

describe("SpineServices", () => {
  it("posts commands through CommandService over a real gRPC transport", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher((command) => {
      observed.push(command.id?.uuid ?? "missing");
    });
    const context = BoundedContext.singleTenant("Tasks").addCommandDispatcher(dispatcher).build();
    const server = await startServices(context);

    try {
      const client = createClient(CommandService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const ack = await client.post(createProjectionCommand("command-1"));

      expect(ack.status?.status.case).toBe("ok");
      expect(ack.status?.status.value).toEqual(create(EmptySchema));
      expect(ack.messageId?.typeUrl).toBe(deriveTypeUrl(CommandIdSchema));
      expect(observed).toEqual(["command-1"]);
    } finally {
      await server.close();
    }
  });

  it("reads Stand state through QueryService over a real gRPC transport", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 7 }),
    });
    const server = await startServices(context);

    try {
      const client = createClient(QueryService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const response = await client.read(createQuery("task-1"));

      expect(response.response?.status?.status.case).toBe("ok");
      expect(response.message).toHaveLength(1);
      expect(unpackAny(response.message[0]?.state ?? packMissing(), ProjectionStateSchema)).toEqual(
        createState("task-1", "First"),
      );
      expect(response.message[0]?.version).toEqual(create(VersionSchema, { number: 7 }));
    } finally {
      await server.close();
    }
  });

  it("keeps ID-filter QueryService reads working through direct handlers", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 7 }),
    });
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createQuery("task-1"));

    expect(response.response?.status?.status.case).toBe("ok");
    expect(response.message).toHaveLength(1);
    expect(unpackAny(response.message[0]?.state ?? packMissing(), ProjectionStateSchema)).toEqual(
      createState("task-1", "First"),
    );
    expect(response.message[0]?.version).toEqual(create(VersionSchema, { number: 7 }));
  });

  it("keeps QueryService reads isolated by tenant", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.multitenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Tenant A"), {
      tenantId: "tenant-a",
    });
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Tenant B"), {
      tenantId: "tenant-b",
    });
    const server = await startServices(context);

    try {
      const client = createClient(QueryService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const response = await client.read(createQuery("task-1", "tenant-b"));

      expect(response.response?.status?.status.case).toBe("ok");
      expect(response.message).toHaveLength(1);
      expect(unpackAny(response.message[0]?.state ?? packMissing(), ProjectionStateSchema)).toEqual(
        createState("task-1", "Tenant B"),
      );
    } finally {
      await server.close();
    }
  });

  it("reads all projection states through QueryService include-all queries", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-2", "Second"), {
      version: create(VersionSchema, { number: 2 }),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 1 }),
    });
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createIncludeAllQuery());

    expect(response.response?.status?.status.case).toBe("ok");
    expect(response.message).toHaveLength(2);
    expect(unpackAny(response.message[0]?.state ?? packMissing(), ProjectionStateSchema)).toEqual(
      createState("task-1", "First"),
    );
    expect(response.message[0]?.version).toEqual(create(VersionSchema, { number: 1 }));
    expect(unpackAny(response.message[1]?.state ?? packMissing(), ProjectionStateSchema)).toEqual(
      createState("task-2", "Second"),
    );
    expect(response.message[1]?.version).toEqual(create(VersionSchema, { number: 2 }));
  });

  it("keeps QueryService include-all reads isolated by tenant", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.multitenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Tenant A"), {
      tenantId: "tenant-a",
      version: create(VersionSchema, { number: 1 }),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-2", "Tenant B"), {
      tenantId: "tenant-b",
      version: create(VersionSchema, { number: 2 }),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-3", "Tenant B Again"), {
      tenantId: "tenant-b",
      version: create(VersionSchema, { number: 3 }),
    });
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createIncludeAllQuery("tenant-b"));

    expect(response.response?.status?.status.case).toBe("ok");
    expect(response.message).toHaveLength(2);
    expect(unpackAny(response.message[0]?.state ?? packMissing(), ProjectionStateSchema)).toEqual(
      createState("task-2", "Tenant B"),
    );
    expect(response.message[0]?.version).toEqual(create(VersionSchema, { number: 2 }));
    expect(unpackAny(response.message[1]?.state ?? packMissing(), ProjectionStateSchema)).toEqual(
      createState("task-3", "Tenant B Again"),
    );
    expect(response.message[1]?.version).toEqual(create(VersionSchema, { number: 3 }));
  });

  it("rejects include-all reads for non-projection routes", async () => {
    const context = createFakeContext({
      entityFamily: "aggregate",
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      readAllVersioned: () => {
        throw new Error("include_all must not list aggregate state.");
      },
    });
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createIncludeAllQuery());

    expect(response.response?.status?.status.case).toBe("error");
    expect(responseErrorMessage(response)).toBe(
      "QueryService.Read include_all requires a projection target.",
    );
  });

  it("rejects non-projection include-all before multitenant tenant checks", async () => {
    const context = createFakeContext({
      entityFamily: "aggregate",
      isMultitenant: true,
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      readAllVersioned: () => {
        throw new Error("include_all must not list aggregate state.");
      },
    });
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createIncludeAllQuery());

    expect(response.response?.status?.status.case).toBe("error");
    expect(responseErrorMessage(response)).toBe(
      "QueryService.Read include_all requires a projection target.",
    );
  });

  it("rejects non-projection include-all before single-tenant tenant checks", async () => {
    const context = createFakeContext({
      entityFamily: "aggregate",
      isMultitenant: false,
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      readAllVersioned: () => {
        throw new Error("include_all must not list aggregate state.");
      },
    });
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createIncludeAllQuery("tenant-a"));

    expect(response.response?.status?.status.case).toBe("error");
    expect(responseErrorMessage(response)).toBe(
      "QueryService.Read include_all requires a projection target.",
    );
  });

  it("returns Spine error statuses for unsupported command and query targets", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const server = await startServices(context);

    try {
      const transport = createGrpcTransport({ baseUrl: server.baseUrl });
      const commandClient = createClient(CommandService, transport);
      const queryClient = createClient(QueryService, transport);

      const ack = await commandClient.post(createProjectionCommand("command-unsupported"));
      const response = await queryClient.read(createQuery("task-1"));

      expect(ack.status?.status.case).toBe("error");
      expect(response.response?.status?.status.case).toBe("error");
    } finally {
      await server.close();
    }
  });

  it("returns error statuses for dispatcher failures", async () => {
    const dispatcher = createFailingCommandDispatcher();
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .addCommandDispatcher(dispatcher)
      .build();
    const server = await startServices(context);

    try {
      const transport = createGrpcTransport({ baseUrl: server.baseUrl });
      const commandClient = createClient(CommandService, transport);

      const ack = await commandClient.post(createProjectionCommand("command-fails"));

      expect(ack.status?.status.case).toBe("error");
      expect(errorMessage(ack.status?.status)).toBe("Command post failed.");
    } finally {
      await server.close();
    }
  });

  it("returns Spine statuses for empty contexts and malformed read criteria", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    const server = await startServices(context);
    const emptyServer = await startServices();

    try {
      const transport = createGrpcTransport({ baseUrl: server.baseUrl });
      const commandClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: emptyServer.baseUrl }),
      );
      const queryClient = createClient(QueryService, transport);

      const ack = await commandClient.post(createCommandWithoutId());
      const noTarget = await queryClient.read(
        create(QuerySchema, {
          id: create(QueryIdSchema, { value: "q-no-target" }),
          context: createActorContext(),
        }),
      );
      const objectId = await queryClient.read(
        createQueryWithIds([packAny(CommandIdSchema, create(CommandIdSchema, { uuid: "task-1" }))]),
      );
      const emptyFilter = await queryClient.read(
        create(QuerySchema, {
          id: create(QueryIdSchema, { value: "q-empty-filter" }),
          target: create(TargetSchema, {
            type: deriveTypeUrl(ProjectionStateSchema),
            criterion: {
              case: "filters",
              value: create(TargetFiltersSchema),
            },
          }),
          context: createActorContext(),
        }),
      );

      expect(ack.messageId).toBeUndefined();
      expect(ack.status?.status.case).toBe("error");
      expect(errorMessage(ack.status?.status)).toBe("No bounded context accepted the command.");
      expect(noTarget.response?.status?.status.case).toBe("error");
      expect(objectId.response?.status?.status.case).toBe("ok");
      expect(objectId.message).toHaveLength(0);
      expect(emptyFilter.response?.status?.status.case).toBe("error");
    } finally {
      await emptyServer.close();
      await server.close();
    }
  });

  it("applies field masks to ID-filter and include-all reads", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 7 }),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-2", "Second"), {
      version: create(VersionSchema, { number: 8 }),
    });
    const handlers = registeredQueryHandlers(context);
    const nameOnly = create(ResponseFormatSchema, {
      fieldMask: create(FieldMaskSchema, { paths: ["name"] }),
    });
    const idOnly = create(ResponseFormatSchema, {
      fieldMask: create(FieldMaskSchema, { paths: ["id"] }),
    });

    const idResponse = await handlers.read(createFormattedQuery(nameOnly));
    const allResponse = await handlers.read(createFormattedIncludeAllQuery(idOnly));

    const idState = unpackAny(idResponse.message[0]?.state ?? packMissing(), ProjectionStateSchema);
    const allStates = allResponse.message.map((message) =>
      unpackAny(message.state ?? packMissing(), ProjectionStateSchema),
    );
    if (idState === undefined) {
      throw new Error("Expected masked ID-filter state.");
    }
    expect(idResponse.response?.status?.status.case).toBe("ok");
    expect(idState).toMatchObject({ name: "First" });
    expect(idState.id).toBe("");
    expect(idState.priority).toBe(0);
    expect(idResponse.message[0]?.version).toEqual(create(VersionSchema, { number: 7 }));
    expect(allResponse.response?.status?.status.case).toBe("ok");
    expect(allStates).toEqual([
      create(ProjectionStateSchema, { id: "task-1" }),
      create(ProjectionStateSchema, { id: "task-2" }),
    ]);
    expect(allResponse.message[0]?.version).toEqual(create(VersionSchema, { number: 7 }));
  });

  it("applies ordering and limit to include-all projection reads", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Beta", 2));
    await context.stand().update(ProjectionStateSchema, createState("task-2", "Alpha", 2));
    await context.stand().update(ProjectionStateSchema, createState("task-3", "Gamma", 1));
    const handlers = registeredQueryHandlers(context);
    const response = await handlers.read(
      createFormattedIncludeAllQuery(
        create(ResponseFormatSchema, {
          orderBy: [
            create(OrderBySchema, {
              column: "priority",
              direction: OrderBy_Direction.DESCENDING,
            }),
            create(OrderBySchema, {
              column: "name",
              direction: OrderBy_Direction.ASCENDING,
            }),
          ],
          limit: 2,
        }),
      ),
    );

    expect(response.response?.status?.status.case).toBe("ok");
    expect(response.message.map((message) => unpackProjectionState(message.state))).toEqual([
      createState("task-2", "Alpha", 2),
      createState("task-1", "Beta", 2),
    ]);
  });

  it("applies top-level exact column filters over projection state", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Open", 1));
    await context.stand().update(ProjectionStateSchema, createState("task-2", "Closed", 2));
    await context.stand().update(ProjectionStateSchema, createState("task-3", "Open", 3));
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createColumnFilterQuery("name", packStringId("Open")));

    expect(response.response?.status?.status.case).toBe("ok");
    expect(response.message.map((message) => unpackProjectionState(message.state))).toEqual([
      createState("task-1", "Open", 1),
      createState("task-3", "Open", 3),
    ]);
  });

  it("applies tenant-scoped filters, ordering, and masks", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.multitenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Tenant A", 1), {
      tenantId: "tenant-a",
    });
    await context.stand().update(ProjectionStateSchema, createState("task-2", "Bravo", 2), {
      tenantId: "tenant-b",
      version: create(VersionSchema, { number: 2 }),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-3", "Alpha", 2), {
      tenantId: "tenant-b",
      version: create(VersionSchema, { number: 3 }),
    });
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(
      createFormattedColumnFilterQuery(
        "priority",
        packInt32(2),
        create(ResponseFormatSchema, {
          fieldMask: create(FieldMaskSchema, { paths: ["name"] }),
          orderBy: [
            create(OrderBySchema, {
              column: "name",
              direction: OrderBy_Direction.ASCENDING,
            }),
          ],
        }),
        "tenant-b",
      ),
    );

    expect(response.response?.status?.status.case).toBe("ok");
    expect(response.message.map((message) => unpackProjectionState(message.state))).toEqual([
      create(ProjectionStateSchema, { name: "Alpha" }),
      create(ProjectionStateSchema, { name: "Bravo" }),
    ]);
    expect(response.message.map((message) => message.version)).toEqual([
      create(VersionSchema, { number: 3 }),
      create(VersionSchema, { number: 2 }),
    ]);
  });

  it("rejects limit without ordering before reading storage", async () => {
    const context = createRejectingReadContext();
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(
      createFormattedQuery(create(ResponseFormatSchema, { limit: 1 })),
    );

    expect(response.response?.status?.status.case).toBe("error");
    expect(responseErrorMessage(response)).toBe("QueryService.Read limit requires ordering.");
  });

  it("rejects malformed ordering before reading storage", async () => {
    const context = createRejectingReadContext();
    const handlers = registeredQueryHandlers(context);

    const missingColumn = await handlers.read(
      createFormattedQuery(
        create(ResponseFormatSchema, {
          orderBy: [create(OrderBySchema, { column: " " })],
        }),
      ),
    );
    const unknownDirection = await handlers.read(
      createFormattedQuery(
        create(ResponseFormatSchema, {
          orderBy: [
            create(OrderBySchema, {
              column: "name",
              direction: OrderBy_Direction.OD_UNKNOWN,
            }),
          ],
        }),
      ),
    );

    expect(responseErrorMessage(missingColumn)).toBe(
      "QueryService.Read order_by column is required.",
    );
    expect(responseErrorMessage(unknownDirection)).toBe(
      "QueryService.Read order_by direction must be ASCENDING or DESCENDING.",
    );
  });

  it("preserves malformed ID-filter entries for storage query execution", async () => {
    let observedQuery: { readonly ids?: readonly unknown[] } | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      queryVersioned: (_schema, query) => {
        observedQuery = query as { readonly ids?: readonly unknown[] };
        return Promise.resolve([]);
      },
    });
    const handlers = registeredQueryHandlers(context);
    const query = createQueryWithIds([packStringId("task-1")]);
    if (query.target?.criterion.case !== "filters") {
      throw new Error("Expected test query filters.");
    }
    const filters = query.target.criterion.value;
    filters.idFilter?.id.push(undefined as unknown as Any);

    const response = await handlers.read(query);

    expect(response.response?.status?.status.case).toBe("ok");
    expect(observedQuery?.ids).toEqual(["task-1", undefined]);
  });

  it("rejects unsupported column filter operators and composites", async () => {
    const context = createRejectingReadContext();
    const handlers = registeredQueryHandlers(context);

    const either = await handlers.read(
      createColumnFilterQuery("name", packStringId("Open"), {
        compositeOperator: CompositeFilter_CompositeOperator.EITHER,
      }),
    );
    const nested = await handlers.read(
      createColumnFilterQuery("name", packStringId("Open"), { nested: true }),
    );
    const greaterThan = await handlers.read(
      createColumnFilterQuery("priority", packInt32(1), {
        operator: Filter_Operator.GREATER_THAN,
      }),
    );

    expect(responseErrorMessage(either)).toBe(
      "QueryService.Read supports only ALL column filters.",
    );
    expect(responseErrorMessage(nested)).toBe(
      "QueryService.Read does not support nested column filters.",
    );
    expect(responseErrorMessage(greaterThan)).toBe(
      "QueryService.Read supports only EQUAL column filters.",
    );
  });

  it("rejects undefined, empty, and blank column filter names before reading storage", async () => {
    const context = createRejectingReadContext();
    const handlers = registeredQueryHandlers(context);

    const missing = createColumnFilterQuery("name", packStringId("Open"));
    if (missing.target?.criterion.case !== "filters") {
      throw new Error("Expected test query filters.");
    }
    const missingField = missing.target.criterion.value.filter[0]?.filter[0];
    if (missingField === undefined) {
      throw new Error("Expected test query filter.");
    }
    missingField.fieldPath = undefined;

    const empty = await handlers.read(createColumnFilterQuery("", packStringId("Open")));
    const blank = await handlers.read(createColumnFilterQuery(" ", packStringId("Open")));
    const undefinedColumn = await handlers.read(missing);

    expect(responseErrorMessage(undefinedColumn)).toBe(
      "QueryService.Read column filter field is required.",
    );
    expect(responseErrorMessage(empty)).toBe("QueryService.Read column filter field is required.");
    expect(responseErrorMessage(blank)).toBe("QueryService.Read column filter field is required.");
  });

  it("rejects excessive query breadth before reading storage", async () => {
    const context = createRejectingReadContext();
    const handlers = registeredQueryHandlers(context);

    const tooManyIds = await handlers.read(
      createQueryWithIds(Array.from({ length: 101 }, () => packStringId("x"))),
    );
    const tooManyFilters = await handlers.read(createColumnFilterQueryWithFilters(17));
    const tooManyInvalidFilters = await handlers.read(
      createColumnFilterQueryWithFilters(17, "unknown"),
    );
    const tooManyComposites = await handlers.read(createColumnFilterQueryWithComposites(9));
    const tooManyOrderings = await handlers.read(
      createFormattedIncludeAllQuery(
        create(ResponseFormatSchema, {
          orderBy: new Array(9).fill(undefined).map(() =>
            create(OrderBySchema, {
              column: "name",
              direction: OrderBy_Direction.ASCENDING,
            }),
          ),
        }),
      ),
    );
    const tooManyMaskPaths = await handlers.read(
      createFormattedQuery(
        create(ResponseFormatSchema, {
          fieldMask: create(FieldMaskSchema, { paths: new Array(33).fill("name") }),
        }),
      ),
    );
    const tooLongMaskPath = await handlers.read(
      createFormattedQuery(
        create(ResponseFormatSchema, {
          fieldMask: create(FieldMaskSchema, { paths: ["n".repeat(129)] }),
        }),
      ),
    );
    const tooLargeLimit = await handlers.read(
      createFormattedIncludeAllQuery(
        create(ResponseFormatSchema, {
          limit: 1_001,
          orderBy: [
            create(OrderBySchema, {
              column: "name",
              direction: OrderBy_Direction.ASCENDING,
            }),
          ],
        }),
      ),
    );

    expect(responseErrorMessage(tooManyIds)).toBe(
      "QueryService.Read id_filter may contain at most 100 IDs.",
    );
    expect(responseErrorMessage(tooManyFilters)).toBe(
      "QueryService.Read may contain at most 16 simple column filters.",
    );
    expect(responseErrorMessage(tooManyInvalidFilters)).toBe(
      "QueryService.Read may contain at most 16 simple column filters.",
    );
    expect(responseErrorMessage(tooManyComposites)).toBe(
      "QueryService.Read may contain at most 8 composite filters.",
    );
    expect(responseErrorMessage(tooManyOrderings)).toBe(
      "QueryService.Read order_by may contain at most 8 entries.",
    );
    expect(responseErrorMessage(tooManyMaskPaths)).toBe(
      "QueryService.Read field_mask may contain at most 32 paths.",
    );
    expect(responseErrorMessage(tooLongMaskPath)).toBe(
      "QueryService.Read field_mask paths may contain at most 128 characters.",
    );
    expect(responseErrorMessage(tooLargeLimit)).toBe(
      "QueryService.Read limit may be at most 1000.",
    );
  });

  it("rejects non-column filter and order_by names before reading storage", async () => {
    const context = createRejectingReadContext();
    const handlers = registeredQueryHandlers(context);

    const filter = await handlers.read(createColumnFilterQuery("id", packStringId("task-1")));
    const ordering = await handlers.read(
      createFormattedIncludeAllQuery(
        create(ResponseFormatSchema, {
          orderBy: [
            create(OrderBySchema, {
              column: "id",
              direction: OrderBy_Direction.ASCENDING,
            }),
          ],
        }),
      ),
    );

    expect(responseErrorMessage(filter)).toBe(
      'QueryService.Read column filter "id" is not a declared column.',
    );
    expect(responseErrorMessage(ordering)).toBe(
      'QueryService.Read order_by column "id" is not a declared column.',
    );
  });

  it("rejects undefined composite filter operators before reading storage", async () => {
    const context = createRejectingReadContext();
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(
      createColumnFilterQuery("name", packStringId("Open"), {
        compositeOperator: CompositeFilter_CompositeOperator.CCF_CO_UNDEFINED,
      }),
    );

    expect(responseErrorMessage(response)).toBe(
      "QueryService.Read supports only ALL column filters.",
    );
  });

  it("accepts an empty response format as a no-op", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "First"));
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createFormattedQuery(create(ResponseFormatSchema)));

    expect(response.response?.status?.status.case).toBe("ok");
    expect(response.message).toHaveLength(1);
  });

  it("rejects inactive query criteria before reading storage", async () => {
    const context = createRejectingReadContext();
    const handlers = registeredQueryHandlers(context);

    const missingCriterion = await handlers.read(
      create(QuerySchema, {
        id: create(QueryIdSchema, { value: "q-missing-criterion" }),
        target: create(TargetSchema, {
          type: deriveTypeUrl(ProjectionStateSchema),
        }),
        context: createActorContext(),
      }),
    );
    const falseIncludeAll = await handlers.read(
      create(QuerySchema, {
        id: create(QueryIdSchema, { value: "q-false-include-all" }),
        target: create(TargetSchema, {
          type: deriveTypeUrl(ProjectionStateSchema),
          criterion: {
            case: "includeAll",
            value: false,
          },
        }),
        context: createActorContext(),
      }),
    );

    expect(responseErrorMessage(missingCriterion)).toBe(
      "QueryService.Read requires filters or include_all = true.",
    );
    expect(responseErrorMessage(falseIncludeAll)).toBe(
      "QueryService.Read requires filters or include_all = true.",
    );
  });

  it("returns stable errors for invalid command envelopes and read failures", async () => {
    const readFailureContext = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      readVersioned: () => Promise.reject(new Error("storage details")),
    });
    const server = await startServices(readFailureContext);

    try {
      const transport = createGrpcTransport({ baseUrl: server.baseUrl });
      const commandClient = createClient(CommandService, transport);
      const queryClient = createClient(QueryService, transport);

      const ack = await commandClient.post(create(CommandSchema));
      const response = await queryClient.read(createQuery("task-1"));

      expect(ack.status?.status.case).toBe("error");
      expect(errorMessage(ack.status?.status)).toBe("Command message type is required.");
      expect(response.response?.status?.status.case).toBe("error");
      expect(responseErrorMessage(response)).toBe("Query read failed.");
    } finally {
      await server.close();
    }
  });

  it("returns stable errors for include-all read failures", async () => {
    const readFailureContext = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      readAllVersioned: () => Promise.reject(new Error("storage details")),
    });
    const handlers = registeredQueryHandlers(readFailureContext);

    const response = await handlers.read(createIncludeAllQuery());

    expect(response.response?.status?.status.case).toBe("error");
    expect(responseErrorMessage(response)).toBe("Query read failed.");
  });

  it("wraps non-Error dispatcher failures in sanitized Spine command errors", async () => {
    const dispatcher: CommandDispatcher = {
      messageSchemas: () => [ProjectionStateSchema],
      // Deliberately covers defensive wrapping of third-party non-Error rejections.
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      dispatch: () => Promise.reject("dispatcher-string"),
    };
    const context = BoundedContext.singleTenant("Tasks").addCommandDispatcher(dispatcher).build();
    const server = await startServices(context);

    try {
      const client = createClient(CommandService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const ack = await client.post(createProjectionCommand("command-string-failure"));

      expect(ack.status?.status.case).toBe("error");
      expect(errorMessage(ack.status?.status)).toBe("Command post failed.");
    } finally {
      await server.close();
    }
  });

  it("returns stable Ack errors for immediate aggregate command refusals", async () => {
    const context = BoundedContext.singleTenant("Tasks").add(createRefusingRepository()).build();
    const handlers = registeredCommandHandlers(context);

    const ack = await handlers.post(createAggregateCommand("command-refused", "task-refused"));

    expect(ack.status?.status.case).toBe("error");
    expect(errorType(ack.status?.status)).toBe("TASK_ALREADY_COMPLETED");
    expect(errorMessage(ack.status?.status)).toBe("Task is already completed.");
  });

  it("returns stable Ack errors with details for invalid command payloads", async () => {
    const context = BoundedContext.singleTenant("Tasks").add(createValidatingRepository()).build();
    const handlers = registeredCommandHandlers(context);

    const ack = await handlers.post(createValidatedCommand("command-invalid", "task-invalid", ""));

    expect(ack.status?.status.case).toBe("error");
    expect(errorType(ack.status?.status)).toBe("COMMAND_VALIDATION_ERROR");
    expect(errorMessage(ack.status?.status)).toBe("Command payload validation failed.");
    expect(validationDetails(ack.status?.status)?.constraintViolation.length).toBeGreaterThan(0);
  });

  it("returns stable Ack errors with details for invalid custom-dispatcher command payloads", async () => {
    const dispatched: string[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .addCommandDispatcher(
        createValidatedCommandDispatcher((command) => {
          dispatched.push(command.id?.uuid ?? "");
        }),
      )
      .build();
    const handlers = registeredCommandHandlers(context);

    const ack = await handlers.post(createValidatedCommand("command-invalid", "task-invalid", ""));

    expect(ack.status?.status.case).toBe("error");
    expect(errorType(ack.status?.status)).toBe("COMMAND_VALIDATION_ERROR");
    expect(errorMessage(ack.status?.status)).toBe("Command payload validation failed.");
    expect(validationDetails(ack.status?.status)?.constraintViolation.length).toBeGreaterThan(0);
    expect(dispatched).toEqual([]);
  });

  it("returns stable Ack error details for incompatible command payload bytes", async () => {
    const context = BoundedContext.singleTenant("Tasks").add(createValidatingRepository()).build();
    const handlers = registeredCommandHandlers(context);
    const command = createValidatedCommand("command-incompatible", "task-incompatible", "name");

    if (command.message !== undefined) {
      command.message.value = new Uint8Array([255]);
    }

    const ack = await handlers.post(command);
    const details = validationDetails(ack.status?.status);

    expect(ack.status?.status.case).toBe("error");
    expect(errorType(ack.status?.status)).toBe("COMMAND_VALIDATION_ERROR");
    expect(errorMessage(ack.status?.status)).toBe("Command payload validation failed.");
    expect(details?.constraintViolation).toHaveLength(1);
  });

  it("keeps dispatcher-thrown validation exceptions sanitized", async () => {
    const dispatcher: CommandDispatcher = {
      messageSchemas: () => [ProjectionStateSchema],
      dispatch: () => Promise.reject(new ValidationException(create(ValidationErrorSchema, {}))),
    };
    const context = BoundedContext.singleTenant("Tasks").addCommandDispatcher(dispatcher).build();
    const handlers = registeredCommandHandlers(context);

    const ack = await handlers.post(createProjectionCommand("command-dispatcher-validation"));

    expect(ack.status?.status.case).toBe("error");
    expect(errorType(ack.status?.status)).toBe("COMMAND_POST_ERROR");
    expect(errorMessage(ack.status?.status)).toBe("Command post failed.");
    expect(validationDetails(ack.status?.status)).toBeUndefined();
  });

  it("returns stable Ack errors with details for transition validation failures", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createTransitionViolatingRepository())
      .build();
    const handlers = registeredCommandHandlers(context);

    const ack = await handlers.post(
      createAggregateCommand("command-transition-invalid", "task-transition-invalid"),
    );

    expect(ack.status?.status.case).toBe("error");
    expect(errorType(ack.status?.status)).toBe("COMMAND_STATE_TRANSITION_VALIDATION_FAILED");
    expect(errorMessage(ack.status?.status)).toBe("Command state transition validation failed.");
    expect(validationDetails(ack.status?.status)?.constraintViolation.length).toBeGreaterThan(0);
  });

  it("returns transition validation Ack errors after rejected commit rollback", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createRollingBackTransitionRepository())
      .build();
    const handlers = registeredCommandHandlers(context);

    const ack = await handlers.post(
      createAggregateCommand("command-transition-rollback", "task-transition-rollback"),
    );

    expect(ack.status?.status.case).toBe("error");
    expect(errorType(ack.status?.status)).toBe("COMMAND_STATE_TRANSITION_VALIDATION_FAILED");
    expect(errorMessage(ack.status?.status)).toBe("Command state transition validation failed.");
    expect(validationDetails(ack.status?.status)?.constraintViolation.length).toBeGreaterThan(0);
  });

  it("rejects command tenant mismatches without dispatching", async () => {
    const singleTenantDispatches: string[] = [];
    const multitenantDispatches: string[] = [];
    const singleTenant = BoundedContext.singleTenant("Single")
      .addCommandDispatcher(
        createCommandDispatcher((command) => singleTenantDispatches.push(command.id?.uuid ?? "")),
      )
      .build();
    const multitenant = BoundedContext.multitenant("Multi")
      .addCommandDispatcher(
        createCommandDispatcher((command) => multitenantDispatches.push(command.id?.uuid ?? "")),
      )
      .build();
    const singleServer = await startServices(singleTenant);
    const multiServer = await startServices(multitenant);

    try {
      const singleClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: singleServer.baseUrl }),
      );
      const multiClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: multiServer.baseUrl }),
      );

      const singleTenantAck = await singleClient.post(
        createProjectionCommand("single-with-tenant", "tenant-a"),
      );
      const multitenantAck = await multiClient.post(
        createProjectionCommand("multi-without-tenant"),
      );

      expect(singleTenantAck.status?.status.case).toBe("error");
      expect(errorMessage(singleTenantAck.status?.status)).toBe(
        "Tenant is not applicable for this command.",
      );
      expect(multitenantAck.status?.status.case).toBe("error");
      expect(errorMessage(multitenantAck.status?.status)).toBe(
        "Tenant is required for this command.",
      );
      expect(singleTenantDispatches).toEqual([]);
      expect(multitenantDispatches).toEqual([]);
    } finally {
      await multiServer.close();
      await singleServer.close();
    }
  });

  it("treats command tenant domain and email variants as present", async () => {
    const singleTenantDispatches: string[] = [];
    const multitenantDispatches: string[] = [];
    const singleTenant = BoundedContext.singleTenant("Single")
      .addCommandDispatcher(
        createCommandDispatcher((command) => singleTenantDispatches.push(command.id?.uuid ?? "")),
      )
      .build();
    const multitenant = BoundedContext.multitenant("Multi")
      .addCommandDispatcher(
        createCommandDispatcher((command) => multitenantDispatches.push(command.id?.uuid ?? "")),
      )
      .build();
    const singleServer = await startServices(singleTenant);
    const multiServer = await startServices(multitenant);

    try {
      const singleClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: singleServer.baseUrl }),
      );
      const multiClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: multiServer.baseUrl }),
      );

      const inapplicable = await singleClient.post(
        createProjectionCommand("single-domain-tenant", tenantDomain("tenant.example")),
      );
      const accepted = await multiClient.post(
        createProjectionCommand("multi-email-tenant", tenantEmail("tenant@example.test")),
      );

      expect(inapplicable.status?.status.case).toBe("error");
      expect(errorMessage(inapplicable.status?.status)).toBe(
        "Tenant is not applicable for this command.",
      );
      expect(accepted.status?.status.case).toBe("ok");
      expect(singleTenantDispatches).toEqual([]);
      expect(multitenantDispatches).toEqual(["multi-email-tenant"]);
    } finally {
      await multiServer.close();
      await singleServer.close();
    }
  });

  it("routes commands by registered type without posting to wrong contexts", async () => {
    const wrongPosts: string[] = [];
    const acceptedPosts: string[] = [];
    const wrongContext = createFakeContext({
      commandTypes: [deriveTypeUrl(StringValueSchema)],
      post: (command) => {
        wrongPosts.push(command.id?.uuid ?? "");
        return Promise.reject(new Error("wrong context touched"));
      },
    });
    const acceptedContext = createFakeContext({
      commandTypes: [deriveTypeUrl(ProjectionStateSchema)],
      post: (command) => {
        acceptedPosts.push(command.id?.uuid ?? "");
        return Promise.resolve();
      },
    });
    const server = await startServices(wrongContext, acceptedContext);

    try {
      const client = createClient(CommandService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const ack = await client.post(createProjectionCommand("command-routed"));

      expect(ack.status?.status.case).toBe("ok");
      expect(wrongPosts).toEqual([]);
      expect(acceptedPosts).toEqual(["command-routed"]);
    } finally {
      await server.close();
    }
  });

  it("uses the first registered command route for duplicate service routes", async () => {
    const firstPosts: string[] = [];
    const secondPosts: string[] = [];
    const firstContext = createFakeContext({
      commandTypes: [deriveTypeUrl(ProjectionStateSchema)],
      post: (command) => {
        firstPosts.push(command.id?.uuid ?? "");
        return Promise.resolve();
      },
    });
    const secondContext = createFakeContext({
      commandTypes: [deriveTypeUrl(ProjectionStateSchema)],
      post: (command) => {
        secondPosts.push(command.id?.uuid ?? "");
        return Promise.resolve();
      },
    });
    const server = await startServices(firstContext, secondContext);

    try {
      const client = createClient(CommandService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const ack = await client.post(createProjectionCommand("command-first-route"));

      expect(ack.status?.status.case).toBe("ok");
      expect(firstPosts).toEqual(["command-first-route"]);
      expect(secondPosts).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("rejects subscription tenant mismatches contractually", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const singleTenant = BoundedContext.singleTenant("SingleSubscription").add(repository).build();
    const secondRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const multitenant = BoundedContext.multitenant("MultiSubscription")
      .add(secondRepository)
      .build();
    const singleServer = await startServices(singleTenant);
    const multiServer = await startServices(multitenant);

    try {
      const singleClient = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: singleServer.baseUrl }),
      );
      const multiClient = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: multiServer.baseUrl }),
      );

      await expect(singleClient.subscribe(createTopic("tenant-a"))).rejects.toMatchObject({
        code: Code.InvalidArgument,
      } satisfies Partial<ConnectError>);
      await expect(multiClient.subscribe(createTopic())).rejects.toMatchObject({
        code: Code.InvalidArgument,
      } satisfies Partial<ConnectError>);
    } finally {
      await multiServer.close();
      await singleServer.close();
    }
  });

  it("treats subscription tenant domain and email variants as present", async () => {
    const capturedTenantKeys: (string | undefined)[] = [];
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const singleTenant = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      isMultitenant: false,
    });
    const multitenant = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      isMultitenant: true,
      subscribe: (_schema, callback, options) => {
        deliverUpdate = callback;
        capturedTenantKeys.push(options.tenantId);
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const singleHandlers = registeredSubscriptionHandlers(singleTenant);
    const multiHandlers = registeredSubscriptionHandlers(multitenant);

    await expect(
      Promise.resolve().then(() =>
        singleHandlers.subscribe(createTopic(tenantDomain("tenant.example"))),
      ),
    ).rejects.toMatchObject({
      code: Code.InvalidArgument,
    } satisfies Partial<ConnectError>);

    const subscription = await multiHandlers.subscribe(
      createTopic(tenantEmail("tenant@example.test")),
    );
    const iterator = multiHandlers.activate(subscription)[Symbol.asyncIterator]();
    const pending = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-tenant",
      state: createState("task-tenant", "Tenant"),
    });
    await withTimeout(pending, "subscription tenant activation update");
    await iterator.return?.();

    expect(capturedTenantKeys).toEqual(["email:tenant@example.test"]);
  });

  it("returns QueryResponse errors for query tenant mismatches", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const singleTenant = BoundedContext.singleTenant("Single").add(repository).build();
    const secondRepository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const multitenant = BoundedContext.multitenant("Multi").add(secondRepository).build();
    const singleServer = await startServices(singleTenant);
    const multiServer = await startServices(multitenant);

    try {
      const singleClient = createClient(
        QueryService,
        createGrpcTransport({ baseUrl: singleServer.baseUrl }),
      );
      const multiClient = createClient(
        QueryService,
        createGrpcTransport({ baseUrl: multiServer.baseUrl }),
      );

      const inapplicable = await singleClient.read(createQuery("task-1", "tenant-a"));
      const missing = await multiClient.read(createQuery("task-1"));

      expect(inapplicable.response?.status?.status.case).toBe("error");
      expect(responseErrorMessage(inapplicable)).toBe("Tenant is not applicable for this query.");
      expect(missing.response?.status?.status.case).toBe("error");
      expect(responseErrorMessage(missing)).toBe("Tenant is required for this query.");
    } finally {
      await multiServer.close();
      await singleServer.close();
    }
  });

  it("treats query tenant domain and email variants as present", async () => {
    const capturedTenantKeys: (string | undefined)[] = [];
    const singleTenant = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      isMultitenant: false,
    });
    const multitenant = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      isMultitenant: true,
      readVersioned: (_schema, _id, options) => {
        capturedTenantKeys.push(options.tenantId);
        return Promise.resolve({
          state: createState("task-1", "Tenant Domain"),
          version: create(VersionSchema, { number: 11 }),
        });
      },
    });
    const singleServer = await startServices(singleTenant);
    const multiServer = await startServices(multitenant);

    try {
      const singleClient = createClient(
        QueryService,
        createGrpcTransport({ baseUrl: singleServer.baseUrl }),
      );
      const multiClient = createClient(
        QueryService,
        createGrpcTransport({ baseUrl: multiServer.baseUrl }),
      );

      const inapplicable = await singleClient.read(
        createQuery("task-1", tenantEmail("tenant@example.test")),
      );
      const accepted = await multiClient.read(
        createQuery("task-1", tenantDomain("tenant.example")),
      );

      expect(inapplicable.response?.status?.status.case).toBe("error");
      expect(responseErrorMessage(inapplicable)).toBe("Tenant is not applicable for this query.");
      expect(accepted.response?.status?.status.case).toBe("ok");
      expect(capturedTenantKeys).toEqual(["domain:tenant.example"]);
    } finally {
      await multiServer.close();
      await singleServer.close();
    }
  });

  it("treats include-all query tenant domain and email variants as present", async () => {
    const capturedTenantKeys: (string | undefined)[] = [];
    const singleTenant = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      isMultitenant: false,
    });
    const multitenant = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      isMultitenant: true,
      readAllVersioned: (_schema, options) => {
        capturedTenantKeys.push(options.tenantId);
        return Promise.resolve([
          {
            state: createState("task-1", "Tenant Domain"),
            version: create(VersionSchema, { number: 11 }),
          },
        ]);
      },
    });
    const singleHandlers = registeredQueryHandlers(singleTenant);
    const multiHandlers = registeredQueryHandlers(multitenant);

    const inapplicable = await singleHandlers.read(
      createIncludeAllQuery(tenantEmail("tenant@example.test")),
    );
    const accepted = await multiHandlers.read(
      createIncludeAllQuery(tenantDomain("tenant.example")),
    );

    expect(inapplicable.response?.status?.status.case).toBe("error");
    expect(responseErrorMessage(inapplicable)).toBe("Tenant is not applicable for this query.");
    expect(accepted.response?.status?.status.case).toBe("ok");
    expect(capturedTenantKeys).toEqual(["domain:tenant.example"]);
  });

  it("activates and cancels explicit subscriptions over a real gRPC transport", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    const server = await startServices(context);

    try {
      const client = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: server.baseUrl }),
      );
      const subscription = await client.subscribe(createTopic());
      const updates = client.activate(subscription);
      const iterator = updates[Symbol.asyncIterator]();
      const nextUpdate = withTimeout(iterator.next(), "subscription update");

      await delay(25);
      await context.stand().update(ProjectionStateSchema, createState("task-1", "First"));

      const delivered = await nextUpdate;
      const update = delivered.value as SubscriptionUpdate | undefined;

      expect(subscription.id?.value).toMatch(/^s-/u);
      expect(subscription.topic?.target?.type).toBe(deriveTypeUrl(ProjectionStateSchema));
      expect(delivered.done).toBe(false);
      expect(update?.response?.status?.status.case).toBe("ok");
      expect(update?.subscription?.id).toEqual(subscription.id);
      if (update?.update.case !== "entityUpdates") {
        throw new Error("Expected entity subscription update.");
      }
      const state = update.update.value.update[0]?.kind;
      if (state?.case !== "state") {
        throw new Error("Expected entity state update.");
      }
      expect(unpackAny(state.value, ProjectionStateSchema)).toEqual(createState("task-1", "First"));

      const cancel = await withTimeout(client.cancel(subscription), "subscription cancellation");
      await context.stand().update(ProjectionStateSchema, createState("task-1", "Second"));

      expect(cancel.status?.status.case).toBe("ok");
    } finally {
      await server.close();
    }
  });

  it("delivers event_updates for activated event subscriptions", async () => {
    const context = BoundedContext.singleTenant("Events")
      .addEventDispatcher(createDomainEventDispatcher(AggregateStateSchema))
      .build();
    const handlers = registeredSubscriptionHandlers(context);

    const subscription = await handlers.subscribe(createEventTopic());
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const nextUpdate = withTimeout(iterator.next(), "event subscription update");

    await delay(25);
    await context.eventBus().post(createAggregateEvent("event-created", "aggregate-1", "Created"));

    const delivered = await nextUpdate;
    const update = delivered.value as SubscriptionUpdate | undefined;

    expect(delivered.done).toBe(false);
    expect(subscription.topic?.target?.type).toBe(deriveTypeUrl(AggregateStateSchema));
    expect(update?.response?.status?.status.case).toBe("ok");
    expect(update?.subscription?.id).toEqual(subscription.id);
    if (update?.update.case !== "eventUpdates") {
      throw new Error("Expected event subscription update.");
    }
    const event = update.update.value.event[0];
    if (event?.message === undefined) {
      throw new Error("Expected delivered event envelope.");
    }
    expect(event.id?.value).toBe("event-created");
    expect(unpackAny(event.message, AggregateStateSchema)).toEqual(
      create(AggregateStateSchema, {
        id: "aggregate-1",
        name: "Created",
        archived: false,
      }),
    );
    await iterator.return?.();
  });

  it("keeps multitenant event subscriptions isolated by tenant", async () => {
    const context = BoundedContext.multitenant("TenantEvents")
      .addEventDispatcher(createDomainEventDispatcher(AggregateStateSchema))
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createEventTopic("tenant-a"));
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const nextUpdate = iterator.next();

    await delay(25);
    await context
      .eventBus()
      .post(createAggregateEvent("event-tenant-b", "aggregate-1", "Tenant B", "tenant-b"));
    const beforeMatchingTenant = await Promise.race([
      nextUpdate.then(() => "delivered"),
      delay(50).then(() => "pending"),
    ]);

    await context
      .eventBus()
      .post(createAggregateEvent("event-tenant-a", "aggregate-1", "Tenant A", "tenant-a"));
    const delivered = await withTimeout(nextUpdate, "tenant event subscription update");
    const update = delivered.value as SubscriptionUpdate | undefined;

    expect(beforeMatchingTenant).toBe("pending");
    expect(delivered.done).toBe(false);
    if (update?.update.case !== "eventUpdates") {
      throw new Error("Expected tenant event subscription update.");
    }
    expect(update.update.value.event.map((event) => event.id?.value)).toEqual(["event-tenant-a"]);
    await iterator.return?.();
  });

  it("keeps duplicate activation and cancellation behavior for event subscriptions", async () => {
    const context = BoundedContext.singleTenant("EventLifecycle")
      .addEventDispatcher(createDomainEventDispatcher(AggregateStateSchema))
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createEventTopic());
    const primaryIterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const firstUpdate = primaryIterator.next();

    await delay(25);
    const duplicateIterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const duplicateDone = await withTimeout(
      duplicateIterator.next(),
      "duplicate event activation close",
    );

    await context.eventBus().post(createAggregateEvent("event-primary", "aggregate-1", "Primary"));
    const delivered = await withTimeout(firstUpdate, "primary event activation update");
    const afterCancel = primaryIterator.next();
    await handlers.cancel(subscription);

    await context
      .eventBus()
      .post(createAggregateEvent("event-after-cancel", "aggregate-1", "Late"));
    const closed = await withTimeout(afterCancel, "canceled event subscription close");

    expect(duplicateDone.done).toBe(true);
    expect(delivered.done).toBe(false);
    expect(closed.done).toBe(true);
  });

  it("rejects unsupported event subscription filters through the service boundary", async () => {
    const context = BoundedContext.singleTenant("FilteredEvents")
      .addEventDispatcher(createDomainEventDispatcher(AggregateStateSchema))
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const topic = create(TopicSchema, {});

    topic.id = create(TopicIdSchema, { value: "t-filtered-event" });
    topic.context = createActorContext();
    topic.target = create(TargetSchema, {
      type: deriveTypeUrl(AggregateStateSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema),
      },
    });

    let thrown: unknown;
    try {
      await handlers.subscribe(topic);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConnectError);
    expect((thrown as ConnectError).code).toBe(Code.InvalidArgument);
    expect((thrown as ConnectError).rawMessage).toBe(
      "SubscriptionService.Subscribe event topics support only include_all in this runtime slice.",
    );
  });

  it("rejects internal event targets before listener attachment", () => {
    const context = BoundedContext.singleTenant("InternalEvents")
      .addEventDispatcher(createDomainEventDispatcher(Command_SystemPropertiesSchema))
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const topic = createEventTopic();
    topic.target = createEventSubscriptionTarget(Command_SystemPropertiesSchema);

    let thrown: unknown;
    try {
      void handlers.subscribe(topic);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ConnectError);
    expect((thrown as ConnectError).code).toBe(Code.InvalidArgument);
    expect((thrown as ConnectError).rawMessage).toBe("Unsupported subscription target.");
  });

  it("delivers subscription updates from real projection event handling", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProjectionRepositoryWithHandlers())
      .build();
    const handlers = registeredSubscriptionHandlers(context);

    const subscription = await handlers.subscribe(createTopic());
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const nextUpdate = withTimeout(iterator.next(), "projection subscription update");

    await delay(25);
    await context.eventBus().post(createProjectionEvent("event-projected", "task-projected"));

    const delivered = await nextUpdate;
    const update = delivered.value as SubscriptionUpdate | undefined;

    expect(delivered.done).toBe(false);
    if (update?.update.case !== "entityUpdates") {
      throw new Error("Expected entity subscription update.");
    }
    const state = update.update.value.update[0]?.kind;
    if (state?.case !== "state") {
      throw new Error("Expected entity state update.");
    }
    expect(unpackAny(state.value, ProjectionStateSchema)).toEqual(
      createState("task-projected", "Task (projected)", 2),
    );
    await iterator.return?.();
  });

  it("matches subscription filters before delivering entity updates", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(
      createFilteredTopic({ id: "task-1", name: "Open" }),
    );
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const first = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-1",
      state: createState("task-1", "Closed"),
    });
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-2",
      state: createState("task-2", "Open"),
    });
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-1",
      state: createState("task-1", "Open"),
    });

    const delivered = await withTimeout(first, "filtered subscription update");
    const update = delivered.value as SubscriptionUpdate | undefined;

    expect(delivered.done).toBe(false);
    expect(unpackEntityState(update)).toEqual(createState("task-1", "Open"));
    await iterator.return?.();
  });

  it("emits no-longer-matching when a filtered subscription stops matching", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly previousState?: ProjectionState;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createFilteredTopic({ name: "Open" }));
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const next = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-1",
      previousState: createState("task-1", "Open"),
      state: createState("task-1", "Closed"),
    });

    const delivered = await withTimeout(next, "no-longer-matching subscription update");
    const update = delivered.value as SubscriptionUpdate | undefined;

    expect(delivered.done).toBe(false);
    expect(entityUpdateKind(update)?.case).toBe("noLongerMatching");
    expect(entityUpdateKind(update)?.value).toBe(true);
    expect(unpackAny(entityUpdateId(update) ?? packMissing(), StringValueSchema)?.value).toBe(
      "task-1",
    );
    await iterator.return?.();
  });

  it("applies topic field masks only to delivered subscription states", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly previousState?: ProjectionState;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(
      createFilteredTopic({ name: "Open", fieldMask: ["name"] }),
    );
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const first = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-1",
      state: createState("task-1", "Open", 7),
    });
    const deliveredState = await withTimeout(first, "masked subscription state");
    const second = iterator.next();
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-1",
      previousState: createState("task-1", "Open", 7),
      state: createState("task-1", "Closed", 7),
    });
    const noLongerMatching = await withTimeout(second, "unmasked no-longer-matching update");

    expect(unpackEntityState(deliveredState.value as SubscriptionUpdate | undefined)).toEqual(
      create(ProjectionStateSchema, { name: "Open" }),
    );
    expect(entityUpdateKind(noLongerMatching.value as SubscriptionUpdate | undefined)?.case).toBe(
      "noLongerMatching",
    );
    await iterator.return?.();
  });

  it("rejects unsupported subscription filters before activation attaches Stand delivery", async () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        subscribeCalls += 1;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const topic = createFilteredTopic({ name: "Open" });
    if (topic.target?.criterion.case !== "filters") {
      throw new Error("Expected filtered topic.");
    }
    const filter = topic.target.criterion.value.filter[0]?.filter[0];
    if (filter === undefined) {
      throw new Error("Expected simple subscription filter.");
    }
    filter.operator = Filter_Operator.GREATER_THAN;

    await expect(Promise.resolve().then(() => handlers.subscribe(topic))).rejects.toThrow(
      "SubscriptionService.Subscribe supports only EQUAL field filters.",
    );
    expect(subscribeCalls).toBe(0);
  });

  it("rejects malformed subscription topics before activation attaches Stand delivery", () => {
    const handlers = registeredSubscriptionHandlers(
      createFakeContext({ stateTypes: [deriveTypeUrl(ProjectionStateSchema)] }),
    );
    const cases = [
      {
        topic: create(TopicSchema, {
          id: create(TopicIdSchema, { value: "" }),
          target: createSubscriptionTarget(),
          context: createActorContext(),
        }),
        message: "Subscription topic ID is required.",
      },
      {
        topic: create(TopicSchema, {
          id: create(TopicIdSchema, { value: "t-missing-context" }),
          target: createSubscriptionTarget(),
        }),
        message: "Subscription topic context is required.",
      },
      {
        topic: create(TopicSchema, {
          id: create(TopicIdSchema, { value: "t-missing-criterion" }),
          target: create(TargetSchema, { type: deriveTypeUrl(ProjectionStateSchema) }),
          context: createActorContext(),
        }),
        message: "Subscription topic criterion is required.",
      },
      {
        topic: create(TopicSchema, {
          id: create(TopicIdSchema, { value: "t-include-none" }),
          target: create(TargetSchema, {
            type: deriveTypeUrl(ProjectionStateSchema),
            criterion: { case: "includeAll", value: false },
          }),
          context: createActorContext(),
        }),
        message: "SubscriptionService.Subscribe requires filters or include_all = true.",
      },
    ];

    for (const { topic, message } of cases) {
      expect(() => handlers.subscribe(topic)).toThrow(message);
    }
  });

  it("rejects empty subscription target filters before activation attaches Stand delivery", () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        subscribeCalls += 1;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const topic = create(TopicSchema, {
      id: create(TopicIdSchema, { value: "t-empty-filters" }),
      target: create(TargetSchema, {
        type: deriveTypeUrl(ProjectionStateSchema),
        criterion: {
          case: "filters",
          value: create(TargetFiltersSchema),
        },
      }),
      context: createActorContext(),
    });

    expect(() => handlers.subscribe(topic)).toThrow(
      "SubscriptionService.Subscribe requires an ID filter or field filter.",
    );
    expect(subscribeCalls).toBe(0);
  });

  it("rejects invalid subscription field masks before activation attaches Stand delivery", () => {
    const handlers = registeredSubscriptionHandlers(
      createFakeContext({ stateTypes: [deriveTypeUrl(ProjectionStateSchema)] }),
    );
    const cases = [
      {
        fieldMask: new Array(33).fill("name") as string[],
        message: "SubscriptionService.Subscribe field_mask may contain at most 32 paths.",
      },
      {
        fieldMask: ["n".repeat(129)],
        message:
          "SubscriptionService.Subscribe field_mask paths may contain at most 128 characters.",
      },
      {
        fieldMask: [".name"],
        message: "SubscriptionService.Subscribe field_mask path is required.",
      },
      {
        fieldMask: ["name."],
        message: "SubscriptionService.Subscribe field_mask path is required.",
      },
      {
        fieldMask: ["name..value"],
        message: "SubscriptionService.Subscribe field_mask path is required.",
      },
      {
        fieldMask: ["missing"],
        message: 'SubscriptionService.Subscribe field_mask "missing" is not a state field.',
      },
      {
        fieldMask: ["name.value"],
        message: 'SubscriptionService.Subscribe field_mask "name.value" is not a message path.',
      },
    ];

    for (const { fieldMask, message } of cases) {
      const topic = createTopic();
      topic.fieldMask = create(FieldMaskSchema, { paths: fieldMask });

      expect(() => handlers.subscribe(topic)).toThrow(message);
    }
  });

  it("rejects invalid subscription field filters before activation attaches Stand delivery", () => {
    const handlers = registeredSubscriptionHandlers(
      createFakeContext({ stateTypes: [deriveTypeUrl(ProjectionStateSchema)] }),
    );
    const cases = [
      {
        filter: create(FilterSchema, {
          fieldPath: { fieldName: [] },
          value: packStringId("Open"),
          operator: Filter_Operator.EQUAL,
        }),
        message: "SubscriptionService.Subscribe field filter path is required.",
      },
      {
        filter: create(FilterSchema, {
          fieldPath: { fieldName: ["missing"] },
          value: packStringId("Open"),
          operator: Filter_Operator.EQUAL,
        }),
        message: 'SubscriptionService.Subscribe field filter "missing" is not a state field.',
      },
      {
        filter: create(FilterSchema, {
          fieldPath: { fieldName: [Array.from({ length: 129 }, () => "n").join("")] },
          value: packStringId("Open"),
          operator: Filter_Operator.EQUAL,
        }),
        message:
          "SubscriptionService.Subscribe field filter path components may contain at most 128 characters.",
      },
      {
        filter: create(FilterSchema, {
          fieldPath: { fieldName: Array.from({ length: 17 }, () => "name") },
          value: packStringId("Open"),
          operator: Filter_Operator.EQUAL,
        }),
        message:
          "SubscriptionService.Subscribe field filter path may contain at most 16 components.",
      },
      {
        filter: create(FilterSchema, {
          fieldPath: { fieldName: ["name"] },
          operator: Filter_Operator.EQUAL,
        }),
        message: "SubscriptionService.Subscribe field filter value is required.",
      },
    ];

    for (const { filter, message } of cases) {
      const topic = createFilteredTopicWithCriteria({
        filter: [
          create(CompositeFilterSchema, {
            filter: [filter],
            operator: CompositeFilter_CompositeOperator.ALL,
          }),
        ],
      });

      expect(() => handlers.subscribe(topic)).toThrow(message);
    }
  });

  it("rejects wrong-type Any values for message-typed subscription field filters", () => {
    const repository = new Repository({
      entityType: MessageIdTaskAggregate,
      schema: TaskSchema,
    });
    const context = BoundedContext.singleTenant("MessageIdTasks").add(repository).build();
    const handlers = registeredSubscriptionHandlers(context);
    const topic = createFilteredTopicForTask({
      filter: [
        create(CompositeFilterSchema, {
          filter: [
            create(FilterSchema, {
              fieldPath: { fieldName: ["id"] },
              value: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: "wrong-id" })),
              operator: Filter_Operator.EQUAL,
            }),
          ],
          operator: CompositeFilter_CompositeOperator.ALL,
        }),
      ],
    });

    expect(() => handlers.subscribe(topic)).toThrow(
      "SubscriptionService.Subscribe field filter value must pack spine.example.todo.v1.TaskId.",
    );
  });

  it("keeps returned subscription mutation from changing activation tenant or topic", async () => {
    const capturedTenantKeys: (string | undefined)[] = [];
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      isMultitenant: true,
      subscribe: (_schema, callback, options) => {
        capturedTenantKeys.push(options.tenantId);
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createTopic("tenant-a"));
    if (subscription.topic === undefined) {
      throw new Error("Expected returned subscription topic.");
    }
    subscription.topic = createFilteredTopic({ name: "Never", tenantId: "tenant-b" });
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const next = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-cloned",
      state: createState("task-cloned", "Delivered"),
    });
    const delivered = await withTimeout(next, "clone-isolated subscription update");

    expect(capturedTenantKeys).toEqual(["tenant-a"]);
    expect(unpackEntityState(delivered.value as SubscriptionUpdate | undefined)).toEqual(
      createState("task-cloned", "Delivered"),
    );
    await iterator.return?.();
  });

  it("keeps delivered subscription metadata mutation from changing later updates", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createTopic());
    const originalSubscriptionId = subscription.id?.value;
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const first = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "first-delivered",
      state: createState("first-delivered", "First"),
    });
    const firstDelivered = await withTimeout(
      first,
      "first clone-isolated subscription metadata update",
    );
    const firstUpdate = firstDelivered.value as SubscriptionUpdate | undefined;

    expect(firstUpdate?.subscription?.id?.value).toBe(originalSubscriptionId);
    if (firstUpdate?.subscription === undefined) {
      throw new Error("Expected first delivered update to echo subscription metadata.");
    }
    if (firstUpdate.subscription.id === undefined) {
      throw new Error("Expected first delivered update to echo subscription ID.");
    }
    firstUpdate.subscription.id.value = "mutated-subscription";
    firstUpdate.subscription.topic = createFilteredTopic({ name: "Mutated" });

    const second = iterator.next();
    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "second-delivered",
      state: createState("second-delivered", "Second"),
    });
    const secondDelivered = await withTimeout(
      second,
      "second clone-isolated subscription metadata update",
    );
    const secondUpdate = secondDelivered.value as SubscriptionUpdate | undefined;

    expect(secondUpdate?.subscription?.id?.value).toBe(originalSubscriptionId);
    expect(secondUpdate?.subscription?.topic).toEqual(subscription.topic);
    await iterator.return?.();
  });

  it("coerces non-positive subscription service options", () => {
    const handlers = registeredSubscriptionHandlers(
      createFakeContext({ stateTypes: [deriveTypeUrl(ProjectionStateSchema)] }),
      { inactiveTtlMs: 0, queueLimit: 0 },
    );

    expect(() => handlers.subscribe(createTopic())).not.toThrow();
  });

  it("keeps missing subscription IDs inert", async () => {
    const handlers = registeredSubscriptionHandlers(
      createFakeContext({ stateTypes: [deriveTypeUrl(ProjectionStateSchema)] }),
    );
    const iterator = handlers.activate(create(SubscriptionSchema))[Symbol.asyncIterator]();

    await expect(
      withTimeout(iterator.next(), "missing subscription ID activation"),
    ).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect((handlers.cancel(create(SubscriptionSchema)) as Response).status?.status.case).toBe(
      "ok",
    );
  });

  it("rejects empty subscription ID filters before activation attaches Stand delivery", () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        subscribeCalls += 1;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const topic = create(TopicSchema, {
      id: create(TopicIdSchema, { value: "t-empty-id-filter" }),
      target: create(TargetSchema, {
        type: deriveTypeUrl(ProjectionStateSchema),
        criterion: {
          case: "filters",
          value: create(TargetFiltersSchema, {
            idFilter: { id: [] },
          }),
        },
      }),
      context: createActorContext(),
    });

    expect(() => handlers.subscribe(topic)).toThrow(
      "SubscriptionService.Subscribe id_filter requires at least one ID.",
    );
    expect(subscribeCalls).toBe(0);
  });

  it("delivers subscription updates matched by EITHER filters", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(
      createFilteredTopicWithCriteria({
        filter: [
          create(CompositeFilterSchema, {
            filter: [
              create(FilterSchema, {
                fieldPath: { fieldName: ["name"] },
                value: packStringId("Closed"),
                operator: Filter_Operator.EQUAL,
              }),
              create(FilterSchema, {
                fieldPath: { fieldName: ["priority"] },
                value: packInt32(7),
                operator: Filter_Operator.EQUAL,
              }),
            ],
            operator: CompositeFilter_CompositeOperator.EITHER,
          }),
        ],
      }),
    );
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const next = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-1",
      state: createState("task-1", "Open", 7),
    });

    const delivered = (await withTimeout(next, "either subscription")).value as
      SubscriptionUpdate | undefined;

    expect(unpackEntityState(delivered)).toEqual(createState("task-1", "Open", 7));
    await iterator.return?.();
  });

  it("delivers ID-only subscriptions and accepts unknown Any ID values", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const id = packAny(TopicIdSchema, create(TopicIdSchema, { value: "packed-id" }));
    const subscription = await handlers.subscribe(
      createFilteredTopicWithCriteria({ idFilter: { id: [id] } }),
    );
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const next = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id,
      state: createState("task-1", "Packed"),
    });

    const delivered = (await withTimeout(next, "id-only subscription")).value as
      SubscriptionUpdate | undefined;

    expect(unpackEntityState(delivered)).toEqual(createState("task-1", "Packed"));
    await iterator.return?.();
  });

  it("matches byte subscription ID filters by value", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const id = new Uint8Array([1, 2, 3]);
    const subscription = await handlers.subscribe(
      createFilteredTopicWithCriteria({ idFilter: { id: [packBytes(id)] } }),
    );
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const next = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: new Uint8Array([9]),
      state: createState("task-ignored", "Ignored"),
    });
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: new Uint8Array(id),
      state: createState("task-1", "Bytes"),
    });

    const delivered = (await withTimeout(next, "byte-id subscription")).value as
      SubscriptionUpdate | undefined;

    expect(unpackEntityState(delivered)).toEqual(createState("task-1", "Bytes"));
    await iterator.return?.();
  });

  it("matches message-typed subscription ID filters and packs delivered message IDs", async () => {
    const repository = new Repository({
      entityType: MessageIdTaskAggregate,
      schema: TaskSchema,
    });
    const context = BoundedContext.singleTenant("MessageIdTasks").add(repository).build();
    const handlers = registeredSubscriptionHandlers(context);
    const taskId = create(TaskIdSchema, { value: "task-message-id" });
    const subscription = await handlers.subscribe(createMessageIdFilteredTopic(taskId));
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const next = iterator.next();

    await delay(25);
    await context.stand().update(
      TaskSchema,
      create(TaskSchema, {
        id: create(TaskIdSchema, { value: "ignored" }),
        title: "Ignored",
      }),
    );
    await context.stand().update(
      TaskSchema,
      create(TaskSchema, {
        id: taskId,
        title: "Matched",
      }),
    );

    const delivered = (await withTimeout(next, "message-id subscription")).value as
      SubscriptionUpdate | undefined;

    expect(unpackAny(entityUpdateId(delivered) ?? packMissing(), TaskIdSchema)).toEqual(taskId);
    expect(unpackAny(entityUpdateKind(delivered)?.value as Any, TaskSchema)).toEqual(
      create(TaskSchema, {
        id: taskId,
        title: "Matched",
      }),
    );
    await iterator.return?.();
  });

  it("rejects malformed subscription ID filters before activation attaches Stand delivery", () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        subscribeCalls += 1;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const id = { value: "object-id" } as unknown as Any;
    const topic = createFilteredTopicWithCriteria({
      idFilter: { id: [packStringId("ignored")] },
    });
    if (
      topic.target?.criterion.case !== "filters" ||
      topic.target.criterion.value.idFilter === undefined
    ) {
      throw new Error("Expected subscription ID filter.");
    }
    topic.target.criterion.value.idFilter.id[0] = id;
    expect(() => handlers.subscribe(topic)).toThrow(
      "SubscriptionService.Subscribe id_filter values must be packed Any messages.",
    );
    expect(subscribeCalls).toBe(0);
  });

  it("rejects over-limit subscription ID filters before activation attaches Stand delivery", () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        subscribeCalls += 1;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const topic = createFilteredTopicWithCriteria({
      idFilter: {
        id: Array.from({ length: 101 }, (_, index) => packStringId(`task-${String(index)}`)),
      },
    });

    expect(() => handlers.subscribe(topic)).toThrow(
      "SubscriptionService.Subscribe id_filter may contain at most 100 IDs.",
    );
    expect(subscribeCalls).toBe(0);
  });

  it("rejects over-depth subscription composites before activation attaches Stand delivery", () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        subscribeCalls += 1;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const topic = createFilteredTopicWithCriteria({
      idFilter: { id: [packStringId("task-1")] },
      filter: [createNestedSubscriptionComposite(10)],
    });

    expect(() => handlers.subscribe(topic)).toThrow(
      "SubscriptionService.Subscribe composite filters may nest at most 8 levels.",
    );
    expect(subscribeCalls).toBe(0);
  });

  it("rejects too many nested subscription composites before activation attaches Stand delivery", () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        subscribeCalls += 1;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const topic = createFilteredTopicWithCriteria({
      idFilter: { id: [packStringId("task-1")] },
      filter: [
        create(CompositeFilterSchema, {
          compositeFilter: Array.from({ length: 8 }, () =>
            create(CompositeFilterSchema, {
              operator: CompositeFilter_CompositeOperator.ALL,
            }),
          ),
          operator: CompositeFilter_CompositeOperator.ALL,
        }),
      ],
    });

    expect(() => handlers.subscribe(topic)).toThrow(
      "SubscriptionService.Subscribe may contain at most 8 composite filters.",
    );
    expect(subscribeCalls).toBe(0);
  });

  it("rejects too many top-level subscription composites before walking fields", () => {
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        throw new Error("over-broad filters must not attach delivery.");
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const topic = createFilteredTopicWithCriteria({
      filter: Array.from({ length: 9 }, () =>
        create(CompositeFilterSchema, {
          filter: [
            create(FilterSchema, {
              fieldPath: { fieldName: ["missing"] },
              value: packStringId("Open"),
              operator: Filter_Operator.EQUAL,
            }),
          ],
          operator: CompositeFilter_CompositeOperator.ALL,
        }),
      ),
    });

    expect(() => handlers.subscribe(topic)).toThrow(
      "SubscriptionService.Subscribe may contain at most 8 composite filters.",
    );
  });

  it("rejects empty undefined-operator subscription composites before activation attaches Stand delivery", () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        subscribeCalls += 1;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const topic = createFilteredTopicWithCriteria({
      idFilter: { id: [packStringId("task-1")] },
      filter: [
        create(CompositeFilterSchema, {
          operator: CompositeFilter_CompositeOperator.CCF_CO_UNDEFINED,
        }),
      ],
    });

    expect(() => handlers.subscribe(topic)).toThrow(
      "SubscriptionService.Subscribe supports only ALL or EITHER composite filters.",
    );
    expect(subscribeCalls).toBe(0);
  });

  it("does not deliver pre-activation updates and tolerates unknown subscription cancellation", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    const server = await startServices(context);

    try {
      const client = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: server.baseUrl }),
      );
      const subscription = await client.subscribe(createTopic());
      await context.stand().update(ProjectionStateSchema, createState("task-queued", "Queued"));

      const iterator = client.activate(subscription)[Symbol.asyncIterator]();
      const nextUpdate = withTimeout(iterator.next(), "post-activation subscription update");
      await delay(25);
      await context.stand().update(ProjectionStateSchema, createState("task-live", "Live"));
      const delivered = await nextUpdate;
      const update = delivered.value as SubscriptionUpdate | undefined;
      const unknown = create(SubscriptionSchema, {
        id: create(SubscriptionIdSchema, { value: "s-missing" }),
        topic: createTopic(),
      });
      const unknownIterator = client.activate(unknown)[Symbol.asyncIterator]();
      const unknownNext = await withTimeout(unknownIterator.next(), "unknown subscription close");
      const cancel = await client.cancel(unknown);
      const missingIdCancel = await client.cancel(create(SubscriptionSchema));

      expect(delivered.done).toBe(false);
      if (update?.update.case !== "entityUpdates") {
        throw new Error("Expected entity subscription update.");
      }
      const state = update.update.value.update[0]?.kind;
      if (state?.case !== "state") {
        throw new Error("Expected entity state update.");
      }
      expect(unpackAny(state.value, ProjectionStateSchema)).toEqual(
        createState("task-live", "Live"),
      );
      expect(unknownNext.done).toBe(true);
      expect(cancel.status?.status.case).toBe("ok");
      expect(missingIdCancel.status?.status.case).toBe("ok");
      await client.cancel(subscription);
    } finally {
      await server.close();
    }
  });

  it("keeps subscription identities process-local to one service adapter", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        subscribeCalls += 1;
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const firstHandlers = registeredSubscriptionHandlers(context);
    const secondHandlers = registeredSubscriptionHandlers(context);
    const subscription = await firstHandlers.subscribe(createTopic());

    const unknownNext = await withTimeout(
      secondHandlers.activate(subscription)[Symbol.asyncIterator]().next(),
      "other service adapter subscription close",
    );
    const iterator = firstHandlers.activate(subscription)[Symbol.asyncIterator]();
    const nextUpdate = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-local",
      state: createState("task-local", "Local"),
    });
    const delivered = await withTimeout(nextUpdate, "original service adapter update");

    expect(unknownNext.done).toBe(true);
    expect(delivered.done).toBe(false);
    expect(subscribeCalls).toBe(1);
    await iterator.return?.();
  });

  it("releases subscription delivery when the activation iterator closes", async () => {
    const activeStandSubscriptions: string[] = [];
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        activeStandSubscriptions.push("open");
        deliverUpdate = callback;
        return {
          get closed() {
            return activeStandSubscriptions.length === 0;
          },
          unsubscribe: () => {
            activeStandSubscriptions.pop();
          },
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createTopic());

    expect(activeStandSubscriptions).toEqual([]);

    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const pending = iterator.next();

    await delay(25);
    expect(activeStandSubscriptions).toEqual(["open"]);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-close",
      state: createState("task-close", "Close"),
    });
    await withTimeout(pending, "first subscription update");
    await iterator.return?.();

    expect(activeStandSubscriptions).toEqual([]);
  });

  it("keeps duplicate activation inert after a subscription is active", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    let subscribeCalls = 0;
    let unsubscribeCount = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        subscribeCalls += 1;
        deliverUpdate = callback;
        return {
          get closed() {
            return unsubscribeCount > 0;
          },
          unsubscribe: () => {
            unsubscribeCount += 1;
          },
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createTopic());
    const primaryIterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const firstUpdate = primaryIterator.next();

    await delay(25);
    const duplicateIterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const duplicateDone = await withTimeout(duplicateIterator.next(), "duplicate activation close");

    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-primary",
      state: createState("task-primary", "Primary"),
    });
    const delivered = await withTimeout(firstUpdate, "primary activation update");
    await duplicateIterator.return?.();
    const secondUpdate = primaryIterator.next();
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-still-active",
      state: createState("task-still-active", "Still active"),
    });
    const stillActive = await withTimeout(secondUpdate, "primary activation after duplicate");

    expect(duplicateDone.done).toBe(true);
    expect(delivered.done).toBe(false);
    expect(stillActive.done).toBe(false);
    expect(subscribeCalls).toBe(1);
    expect(unsubscribeCount).toBe(0);
    await primaryIterator.return?.();
    expect(unsubscribeCount).toBe(1);
  });

  it("removes inactive subscription records when activation attachment fails", async () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        subscribeCalls += 1;
        throw new Error("stand subscribe failed");
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createTopic());
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toThrow("stand subscribe failed");

    const secondActivation = await withTimeout(
      handlers.activate(subscription)[Symbol.asyncIterator]().next(),
      "activation after failed attachment",
    );

    expect(secondActivation.done).toBe(true);
    expect(subscribeCalls).toBe(1);
  });

  it("cancels subscriptions by ID and keeps cleanup idempotent", async () => {
    const unsubscribeCounts: number[] = [];
    const callbacks: ((update: {
      readonly typeUrl: string;
      readonly id: unknown;
      readonly state: ProjectionState;
    }) => void)[] = [];
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        const index = callbacks.length;
        let closed = false;
        callbacks.push(callback);
        unsubscribeCounts.push(0);
        return {
          get closed() {
            return closed;
          },
          unsubscribe: () => {
            unsubscribeCounts[index] = (unsubscribeCounts[index] ?? 0) + 1;
            closed = true;
          },
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const firstSubscription = await handlers.subscribe(createTopic());
    const secondSubscription = await handlers.subscribe(createTopic());
    const firstIterator = handlers.activate(firstSubscription)[Symbol.asyncIterator]();
    const secondIterator = handlers.activate(secondSubscription)[Symbol.asyncIterator]();
    const firstNext = firstIterator.next();
    const secondNext = secondIterator.next();

    await delay(25);
    await handlers.cancel(firstSubscription);
    await handlers.cancel(firstSubscription);
    await firstIterator.return?.();
    callbacks[1]?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-second",
      state: createState("task-second", "Second"),
    });

    const firstClosed = await withTimeout(firstNext, "canceled subscription close");
    const secondDelivered = await withTimeout(secondNext, "second subscription update");

    expect(firstSubscription.id?.value).not.toBe(secondSubscription.id?.value);
    expect(firstClosed.done).toBe(true);
    expect(secondDelivered.done).toBe(false);
    expect(unsubscribeCounts).toEqual([1, 0]);
    await handlers.cancel(secondSubscription);
    await secondIterator.return?.();
    expect(unsubscribeCounts).toEqual([1, 1]);
  });

  it("packs delivered subscription update IDs for supported ID shapes", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createTopic());
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const first = iterator.next();
    const anyId = packAny(TopicIdSchema, create(TopicIdSchema, { value: "already-packed" }));
    const bytesId = new Uint8Array([7, 8, 9]);

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-first",
      state: createState("task-first", "First"),
    });
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: bytesId,
      state: createState("task-bytes", "Bytes"),
    });
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: anyId,
      state: createState("task-any", "Any"),
    });

    const firstUpdate = await withTimeout(first, "first direct subscription update");
    const secondUpdate = await withTimeout(iterator.next(), "queued direct subscription update");
    const thirdUpdate = await withTimeout(iterator.next(), "packed Any subscription update");
    const secondValue = secondUpdate.value as SubscriptionUpdate | undefined;
    const thirdValue = thirdUpdate.value as SubscriptionUpdate | undefined;

    expect(firstUpdate.done).toBe(false);
    expect(secondUpdate.done).toBe(false);
    expect(thirdUpdate.done).toBe(false);
    const firstId = entityUpdateId(firstUpdate.value as SubscriptionUpdate);
    const secondId = entityUpdateId(secondValue);
    const thirdId = entityUpdateId(thirdValue);
    if (firstId === undefined || secondId === undefined || thirdId === undefined) {
      throw new Error("Expected packed update IDs.");
    }
    expect(unpackAny(firstId, StringValueSchema)).toEqual(
      create(StringValueSchema, { value: "task-first" }),
    );
    expect(unpackAny(secondId, BytesValueSchema)).toEqual(
      create(BytesValueSchema, { value: bytesId }),
    );
    expect(thirdId).toEqual(anyId);
    await iterator.return?.();
  });

  it("expires abandoned inactive subscriptions before activation", async () => {
    const activeStandSubscriptions: string[] = [];
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        activeStandSubscriptions.push("open");
        return {
          get closed() {
            return activeStandSubscriptions.length === 0;
          },
          unsubscribe: () => {
            activeStandSubscriptions.pop();
          },
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context, { inactiveTtlMs: 10 });
    const subscription = await handlers.subscribe(createTopic());

    await delay(25);
    const update = await withTimeout(
      handlers.activate(subscription)[Symbol.asyncIterator]().next(),
      "expired subscription activation",
    );

    expect(update.done).toBe(true);
    expect(activeStandSubscriptions).toEqual([]);
  });

  it("closes slow subscription consumers when the update queue limit is exceeded", async () => {
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    let unsubscribeCount = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        deliverUpdate = callback;
        return {
          get closed() {
            return unsubscribeCount > 0;
          },
          unsubscribe: () => {
            unsubscribeCount += 1;
          },
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context, { queueLimit: 1 });
    const subscription = await handlers.subscribe(createTopic());
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const first = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-one",
      state: createState("task-one", "One"),
    });
    await withTimeout(first, "first slow subscription update");
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-two",
      state: createState("task-two", "Two"),
    });
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-three",
      state: createState("task-three", "Three"),
    });

    const next = await withTimeout(iterator.next(), "closed slow subscription");

    expect(next.done).toBe(true);
    expect(unsubscribeCount).toBe(1);
  });

  it("fails unsupported subscription topics contractually", async () => {
    const context = BoundedContext.singleTenant("Tasks").build();
    const server = await startServices(context);

    try {
      const client = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: server.baseUrl }),
      );

      await expect(client.subscribe(create(TopicSchema))).rejects.toMatchObject({
        code: Code.InvalidArgument,
      } satisfies Partial<ConnectError>);
    } finally {
      await server.close();
    }
  });

  it("rejects unknown subscription targets before attaching Stand delivery", () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      subscribe: () => {
        subscribeCalls += 1;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const topic = create(TopicSchema, {
      id: create(TopicIdSchema, { value: "t-unknown-target" }),
      target: create(TargetSchema, {
        type: "type.spine.io/example.UnknownState",
        criterion: {
          case: "includeAll",
          value: true,
        },
      }),
      context: createActorContext(),
    });

    expect(() => handlers.subscribe(topic)).toThrow("Unsupported subscription target.");
    expect(subscribeCalls).toBe(0);
  });

  it("fails known subscription topics with missing required fields", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    const server = await startServices(context);

    try {
      const client = createClient(
        SubscriptionService,
        createGrpcTransport({ baseUrl: server.baseUrl }),
      );
      const malformed = create(TopicSchema, {
        target: create(TargetSchema, {
          type: deriveTypeUrl(ProjectionStateSchema),
        }),
      });

      await expect(client.subscribe(malformed)).rejects.toMatchObject({
        code: Code.InvalidArgument,
      } satisfies Partial<ConnectError>);
    } finally {
      await server.close();
    }
  });

  it("fails known subscription topics with missing context or criterion directly", () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();
    const handlers = registeredSubscriptionHandlers(context);
    const target = create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion: {
        case: "includeAll",
        value: true,
      },
    });

    expect(() =>
      handlers.subscribe(
        create(TopicSchema, {
          id: create(TopicIdSchema, { value: "t-missing-context" }),
          target,
        }),
      ),
    ).toThrow("Subscription topic context is required.");
    expect(() =>
      handlers.subscribe(
        create(TopicSchema, {
          id: create(TopicIdSchema, { value: "t-missing-criterion" }),
          target: create(TargetSchema, {
            type: deriveTypeUrl(ProjectionStateSchema),
          }),
          context: createActorContext(),
        }),
      ),
    ).toThrow("Subscription topic criterion is required.");
  });
});

function createCommandDispatcher(
  onDispatch: (command: ReturnType<typeof createProjectionCommand>) => void,
): CommandDispatcher {
  return {
    messageSchemas: () => [ProjectionStateSchema],
    dispatch: (command) => {
      onDispatch(command);
      return Promise.resolve();
    },
  };
}

function createDomainEventDispatcher(schema: MessageSchema): EventDispatcher {
  return {
    messageSchemas: () => [schema],
    dispatch: () => Promise.resolve(),
  };
}

function createValidatedCommandDispatcher(
  onDispatch: (command: ReturnType<typeof createValidatedCommand>) => void,
): CommandDispatcher {
  return {
    messageSchemas: () => [ValidatedTaskCommandSchema],
    dispatch: (command) => {
      onDispatch(command);
      return Promise.resolve();
    },
  };
}

function createFailingCommandDispatcher(): CommandDispatcher {
  return {
    messageSchemas: () => [ProjectionStateSchema],
    dispatch: () => Promise.reject(new Error("Dispatcher failed.")),
  };
}

function createProjectionRepositoryWithHandlers(): Repository<typeof TaskProjection> {
  const handlers = defineEntityHandlers(TaskProjection, ProjectionStateSchema, (builder) => [
    builder.subscribe(ProjectionStateSchema, "subscribeTask"),
  ]);

  return new Repository({
    entityType: TaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createRefusingRepository(): Repository<typeof RefusingTaskAggregate> {
  const handlers = defineEntityHandlers(RefusingTaskAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
  ]);

  return new Repository({
    entityType: RefusingTaskAggregate,
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

function createTransitionViolatingRepository(): Repository<
  typeof TransitionViolatingTaskAggregate
> {
  const handlers = defineEntityHandlers(
    TransitionViolatingTaskAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(AggregateStateSchema, "applyTask"),
    ],
  );

  return new Repository({
    entityType: TransitionViolatingTaskAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createRollingBackTransitionRepository(): Repository<
  typeof RollingBackTransitionTaskAggregate
> {
  const handlers = defineEntityHandlers(
    RollingBackTransitionTaskAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(AggregateStateSchema, "applyTask"),
    ],
  );

  return new Repository({
    entityType: RollingBackTransitionTaskAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createProjectionCommand(id: string, tenantId?: TenantInput) {
  return packCommand({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(tenantId),
    }),
    schema: ProjectionStateSchema,
    message: createState("task-1", "Task"),
  });
}

function createAggregateCommand(id: string, aggregateId: string, name = "Task") {
  return packCommand({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(),
    }),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: aggregateId,
      name,
      archived: false,
    }),
  });
}

function createValidatedCommand(id: string, aggregateId: string, name: string) {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(),
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

function createAggregateEvent(
  id: string,
  aggregateId: string,
  name: string,
  tenantId?: TenantInput,
) {
  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: createEventContext(tenantId),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: aggregateId,
      name,
      archived: false,
    }),
  });
}

function createEventContext(tenantId?: TenantInput) {
  const context = create(EventContextSchema);

  if (tenantId !== undefined) {
    context.origin = {
      case: "importContext",
      value: createActorContext(tenantId),
    };
  }

  return context;
}

function createValidatedEvent(id: string, aggregateId: string, name: string) {
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

function createProjectionEvent(id: string, entityId: string) {
  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      version: create(VersionSchema, { number: 1 }),
    }),
    schema: ProjectionStateSchema,
    message: createState(entityId, "Task"),
  });
}

function createCommandWithoutId() {
  return create(CommandSchema, {
    message: packAny(ProjectionStateSchema, createState("task-1", "Task")),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(),
    }),
  });
}

function createQuery(id: string, tenantId?: TenantInput) {
  return createQueryWithIds([packStringId(id)], tenantId);
}

function createQueryWithIds(ids: ReturnType<typeof packAny>[], tenantId?: TenantInput) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "q-1" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: { id: ids },
        }),
      },
    }),
    context: createActorContext(tenantId),
  });
}

function createColumnFilterQuery(
  column = "name",
  value: ReturnType<typeof packAny> = packStringId("First"),
  options: {
    readonly operator?: Filter_Operator;
    readonly compositeOperator?: CompositeFilter_CompositeOperator;
    readonly nested?: boolean;
  } = {},
) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "q-column-filter" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          filter: [
            create(CompositeFilterSchema, {
              filter: [
                create(FilterSchema, {
                  fieldPath: { fieldName: [column] },
                  value,
                  operator: options.operator ?? Filter_Operator.EQUAL,
                }),
              ],
              operator: options.compositeOperator ?? CompositeFilter_CompositeOperator.ALL,
              compositeFilter:
                options.nested === true
                  ? [
                      create(CompositeFilterSchema, {
                        operator: CompositeFilter_CompositeOperator.ALL,
                      }),
                    ]
                  : [],
            }),
          ],
        }),
      },
    }),
    context: createActorContext(),
  });
}

function createColumnFilterQueryWithFilters(filterCount: number, column = "name") {
  const query = createColumnFilterQuery(column, packStringId("Open"));
  if (query.target?.criterion.case !== "filters") {
    throw new Error("Expected test query filters.");
  }
  const composite = query.target.criterion.value.filter[0];
  if (composite === undefined) {
    throw new Error("Expected test query composite.");
  }
  composite.filter = new Array(filterCount).fill(undefined).map(() =>
    create(FilterSchema, {
      fieldPath: { fieldName: [column] },
      value: packStringId("Open"),
      operator: Filter_Operator.EQUAL,
    }),
  );

  return query;
}

function createColumnFilterQueryWithComposites(compositeCount: number) {
  const query = createColumnFilterQuery("name", packStringId("Open"));
  if (query.target?.criterion.case !== "filters") {
    throw new Error("Expected test query filters.");
  }
  query.target.criterion.value.filter = new Array(compositeCount).fill(undefined).map(() =>
    create(CompositeFilterSchema, {
      filter: [
        create(FilterSchema, {
          fieldPath: { fieldName: ["name"] },
          value: packStringId("Open"),
          operator: Filter_Operator.EQUAL,
        }),
      ],
      operator: CompositeFilter_CompositeOperator.ALL,
    }),
  );

  return query;
}

function createFormattedColumnFilterQuery(
  column: string,
  value: ReturnType<typeof packAny>,
  format: Query["format"],
  tenantId?: TenantInput,
) {
  const query = createColumnFilterQuery(column, value);
  query.context = createActorContext(tenantId);
  query.format = format;

  return query;
}

function createFormattedQuery(format: Query["format"]) {
  const query = createQuery("task-1");
  query.format = format;

  return query;
}

function createIncludeAllQuery(tenantId?: TenantInput) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "q-empty" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion: {
        case: "includeAll",
        value: true,
      },
    }),
    context: createActorContext(tenantId),
  });
}

function createFormattedIncludeAllQuery(format: Query["format"], tenantId?: TenantInput) {
  const query = createIncludeAllQuery(tenantId);
  query.format = format;

  return query;
}

function createTopic(tenantId?: TenantInput) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "t-1" }),
    target: createSubscriptionTarget(),
    context: createActorContext(tenantId),
  });
}

function createEventTopic(tenantId?: TenantInput) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "t-event" }),
    target: createEventSubscriptionTarget(),
    context: createActorContext(tenantId),
  });
}

function createSubscriptionTarget() {
  return create(TargetSchema, {
    type: deriveTypeUrl(ProjectionStateSchema),
    criterion: {
      case: "includeAll",
      value: true,
    },
  });
}

function createEventSubscriptionTarget(schema: MessageSchema = AggregateStateSchema) {
  return create(TargetSchema, {
    type: deriveTypeUrl(schema),
    criterion: {
      case: "includeAll",
      value: true,
    },
  });
}

function createFilteredTopic(options: {
  readonly id?: string;
  readonly name?: string;
  readonly priority?: number;
  readonly tenantId?: TenantInput;
  readonly fieldMask?: readonly string[];
}) {
  const simpleFilters = [
    ...(options.name === undefined
      ? []
      : [
          create(FilterSchema, {
            fieldPath: { fieldName: ["name"] },
            value: packStringId(options.name),
            operator: Filter_Operator.EQUAL,
          }),
        ]),
    ...(options.priority === undefined
      ? []
      : [
          create(FilterSchema, {
            fieldPath: { fieldName: ["priority"] },
            value: packInt32(options.priority),
            operator: Filter_Operator.EQUAL,
          }),
        ]),
  ];

  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "t-filtered" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          ...(options.id === undefined ? {} : { idFilter: { id: [packStringId(options.id)] } }),
          filter: [
            create(CompositeFilterSchema, {
              filter: simpleFilters,
              operator: CompositeFilter_CompositeOperator.ALL,
            }),
          ],
        }),
      },
    }),
    context: createActorContext(options.tenantId),
    ...(options.fieldMask === undefined
      ? {}
      : { fieldMask: create(FieldMaskSchema, { paths: [...options.fieldMask] }) }),
  });
}

function createFilteredTopicWithCriteria(
  filters: Partial<{
    readonly idFilter: { readonly id: Any[] };
    readonly filter: CompositeFilter[];
  }>,
) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "t-filtered" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, filters),
      },
    }),
    context: createActorContext(),
  });
}

function createFilteredTopicForTask(
  filters: Partial<{
    readonly idFilter: { readonly id: Any[] };
    readonly filter: CompositeFilter[];
  }>,
) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "t-task-filtered" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(TaskSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, filters),
      },
    }),
    context: createActorContext(),
  });
}

function createMessageIdFilteredTopic(id: TaskId) {
  return createFilteredTopicForTask({
    idFilter: { id: [packAny(TaskIdSchema, id)] },
  });
}

function createNestedSubscriptionComposite(depth: number): CompositeFilter {
  return create(CompositeFilterSchema, {
    compositeFilter: depth <= 0 ? [] : [createNestedSubscriptionComposite(depth - 1)],
    operator: CompositeFilter_CompositeOperator.ALL,
  });
}

function createActorContext(tenantId?: TenantInput) {
  return create(ActorContextSchema, {
    ...(tenantId === undefined
      ? {}
      : {
          tenantId: typeof tenantId === "string" ? tenantValue(tenantId) : tenantId,
        }),
    actor: create(UserIdSchema, { value: "user-1" }),
  });
}

function tenantValue(value: string): TenantId {
  return create(TenantIdSchema, {
    kind: {
      case: "value",
      value,
    },
  });
}

function tenantDomain(value: string): TenantId {
  return create(TenantIdSchema, {
    kind: {
      case: "domain",
      value: create(InternetDomainSchema, { value }),
    },
  });
}

function tenantEmail(value: string): TenantId {
  return create(TenantIdSchema, {
    kind: {
      case: "email",
      value: create(EmailAddressSchema, { value }),
    },
  });
}

function createState(id: string, name: string, priority = 1): ProjectionState {
  return create(ProjectionStateSchema, {
    id,
    name,
    priority,
  });
}

function packStringId(id: string) {
  return packAny(StringValueSchema, create(StringValueSchema, { value: id }));
}

function packInt32(value: number) {
  return packAny(Int32ValueSchema, create(Int32ValueSchema, { value }));
}

function packBytes(value: Uint8Array) {
  return packAny(BytesValueSchema, create(BytesValueSchema, { value }));
}

function unpackProjectionState(state: Any | undefined) {
  return unpackAny(state ?? packMissing(), ProjectionStateSchema);
}

function unpackEntityState(update: SubscriptionUpdate | undefined) {
  const kind = entityUpdateKind(update);

  return kind?.case === "state" ? unpackProjectionState(kind.value) : undefined;
}

function entityUpdateKind(update: SubscriptionUpdate | undefined) {
  if (update?.update.case !== "entityUpdates") {
    return undefined;
  }

  return update.update.value.update[0]?.kind;
}

function entityUpdateId(update: SubscriptionUpdate | undefined) {
  if (update?.update.case !== "entityUpdates") {
    return undefined;
  }

  return update.update.value.update[0]?.id;
}

function packMissing() {
  return packAny(StringValueSchema, create(StringValueSchema, { value: "missing" }));
}

function errorMessage(status: unknown) {
  if (
    typeof status !== "object" ||
    status === null ||
    !("case" in status) ||
    status.case !== "error"
  ) {
    return undefined;
  }
  const value = "value" in status ? status.value : undefined;

  return typeof value === "object" && value !== null && "message" in value
    ? value.message
    : undefined;
}

function errorType(status: unknown) {
  if (
    typeof status !== "object" ||
    status === null ||
    !("case" in status) ||
    status.case !== "error"
  ) {
    return undefined;
  }
  const value = "value" in status ? status.value : undefined;

  return typeof value === "object" && value !== null && "type" in value ? value.type : undefined;
}

function validationDetails(status: unknown) {
  if (
    typeof status !== "object" ||
    status === null ||
    !("case" in status) ||
    status.case !== "error"
  ) {
    return undefined;
  }
  const value = "value" in status ? status.value : undefined;
  if (typeof value !== "object" || value === null || !("details" in value)) {
    return undefined;
  }

  return unpackAny(value.details as Parameters<typeof unpackAny>[0], ValidationErrorSchema);
}

function responseErrorMessage(response: unknown) {
  if (typeof response !== "object" || response === null || !("response" in response)) {
    return undefined;
  }
  const responseStatus = response.response;
  if (
    typeof responseStatus !== "object" ||
    responseStatus === null ||
    !("status" in responseStatus)
  ) {
    return undefined;
  }
  const status = responseStatus.status;
  if (typeof status !== "object" || status === null || !("status" in status)) {
    return undefined;
  }

  return errorMessage(status.status);
}

function createRejectingReadContext() {
  return createFakeContext({
    stateTypes: [deriveTypeUrl(ProjectionStateSchema)],
    queryVersioned: () => {
      throw new Error("unsupported query must not query storage.");
    },
    readAllVersioned: () => {
      throw new Error("unsupported query must not list storage.");
    },
    readVersioned: () => {
      throw new Error("unsupported query must not read storage.");
    },
  });
}

function createFakeContext(options: {
  readonly isMultitenant?: boolean;
  readonly commandTypes?: readonly string[];
  readonly entityFamily?: "aggregate" | "projection" | "process-manager";
  readonly eventTypes?: readonly string[];
  readonly stateTypes?: readonly string[];
  readonly post?: (command: ReturnType<typeof createProjectionCommand>) => Promise<void>;
  readonly readVersioned?: (
    schema: typeof ProjectionStateSchema,
    id: unknown,
    options: { readonly tenantId?: string },
  ) => Promise<{ readonly state: ProjectionState; readonly version?: unknown } | undefined>;
  readonly readAllVersioned?: (
    schema: typeof ProjectionStateSchema,
    options: { readonly tenantId?: string },
  ) => Promise<readonly { readonly state: ProjectionState; readonly version?: unknown }[]>;
  readonly queryVersioned?: (
    schema: typeof ProjectionStateSchema,
    query: unknown,
    options: { readonly tenantId?: string },
  ) => Promise<readonly { readonly state: ProjectionState; readonly version?: unknown }[]>;
  readonly subscribe?: (
    schema: typeof ProjectionStateSchema,
    callback: (update: {
      readonly typeUrl: string;
      readonly id: unknown;
      readonly previousState?: ProjectionState;
      readonly state: ProjectionState;
    }) => void,
    options: { readonly tenantId?: string },
  ) => { readonly closed: boolean; unsubscribe(): void };
}) {
  const commandTypes = options.commandTypes ?? [];
  const eventTypes = options.eventTypes ?? [];
  const stateTypes = options.stateTypes ?? [];
  const queryVersioned = options.queryVersioned ?? createFakeQueryVersioned(options);

  return {
    isMultitenant: options.isMultitenant ?? false,
    commandBus: () =>
      Object.freeze({
        acceptedCommandTypes: () => commandTypes,
        post: options.post ?? (() => Promise.resolve()),
      }),
    eventBus: () =>
      Object.freeze({
        acceptedEventTypes: () => eventTypes,
        post: () => Promise.resolve(),
      }),
    registeredRepositories: () =>
      stateTypes.map((typeUrl) =>
        Object.freeze({
          entityFamily: options.entityFamily ?? "projection",
          metadata: {
            columns: [{ name: "name" }, { name: "priority" }],
          },
          stateSchema: ProjectionStateSchema,
          typeUrl,
        }),
      ),
    stand: () =>
      Object.freeze({
        subscribe: options.subscribe ?? (() => ({ closed: false, unsubscribe: () => undefined })),
        readAllVersioned: options.readAllVersioned ?? (() => Promise.resolve([])),
        readVersioned: options.readVersioned ?? (() => Promise.resolve(undefined)),
        queryVersioned: queryVersioned ?? (() => Promise.resolve([])),
      }),
  } as unknown as BoundedContext;
}

function createFakeQueryVersioned(options: {
  readonly readVersioned?: (
    schema: typeof ProjectionStateSchema,
    id: unknown,
    options: { readonly tenantId?: string },
  ) => Promise<{ readonly state: ProjectionState; readonly version?: unknown } | undefined>;
  readonly readAllVersioned?: (
    schema: typeof ProjectionStateSchema,
    options: { readonly tenantId?: string },
  ) => Promise<readonly { readonly state: ProjectionState; readonly version?: unknown }[]>;
}) {
  if (options.readVersioned !== undefined) {
    const readVersioned = options.readVersioned;
    return async (
      schema: typeof ProjectionStateSchema,
      query: { readonly ids?: readonly unknown[] },
      readOptions: { readonly tenantId?: string },
    ) => {
      const results = await Promise.all(
        (query.ids ?? []).map((id) => readVersioned(schema, id, readOptions)),
      );

      return results.filter((result) => result !== undefined);
    };
  }

  return options.readAllVersioned === undefined
    ? undefined
    : (
        schema: typeof ProjectionStateSchema,
        _query: unknown,
        readOptions: { readonly tenantId?: string },
      ) => options.readAllVersioned?.(schema, readOptions);
}

function registeredCommandHandlers(
  context: BoundedContext,
  options: Omit<ConstructorParameters<typeof SpineServices>[0], "contexts"> = {},
) {
  let handlers:
    | {
        post(command: ReturnType<typeof createProjectionCommand>): Promise<Ack>;
      }
    | undefined;
  const services = new SpineServices({ contexts: [context], ...options });

  services.register({
    service(schema: unknown, implementation: unknown) {
      if (schema === CommandService) {
        handlers = implementation as typeof handlers;
      }
      return this;
    },
  } as never);

  if (handlers === undefined) {
    throw new Error("CommandService handlers were not registered.");
  }

  return handlers;
}

function registeredSubscriptionHandlers(
  context: BoundedContext,
  options: Omit<ConstructorParameters<typeof SpineServices>[0], "contexts"> = {},
) {
  let handlers:
    | {
        subscribe(topic: Topic): Subscription | Promise<Subscription>;
        activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate>;
        cancel(subscription: Subscription): unknown;
      }
    | undefined;
  const services = new SpineServices({ contexts: [context], ...options });

  services.register({
    service(schema: unknown, implementation: unknown) {
      if (schema === SubscriptionService) {
        handlers = implementation as typeof handlers;
      }
      return this;
    },
  } as never);

  if (handlers === undefined) {
    throw new Error("SubscriptionService handlers were not registered.");
  }

  return handlers;
}

function registeredQueryHandlers(
  context: BoundedContext,
  options: Omit<ConstructorParameters<typeof SpineServices>[0], "contexts"> = {},
) {
  let handlers:
    | {
        read(query: Query): Promise<QueryResponse>;
      }
    | undefined;
  const services = new SpineServices({ contexts: [context], ...options });

  services.register({
    service(schema: unknown, implementation: unknown) {
      if (schema === QueryService) {
        handlers = implementation as typeof handlers;
      }
      return this;
    },
  } as never);

  if (handlers === undefined) {
    throw new Error("QueryService handlers were not registered.");
  }

  return handlers;
}

async function startServices(...contexts: BoundedContext[]): Promise<RunningServer> {
  return new Server({ contexts }).start();
}

async function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timer = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}.`));
    }, 1_000);
  });

  try {
    return await Promise.race([promise, timer]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
