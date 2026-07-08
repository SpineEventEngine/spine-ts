import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { connectNodeAdapter, createGrpcTransport } from "@connectrpc/connect-node";
import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  EmptySchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  FieldMaskSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import {
  ValidationException,
  deriveTypeUrl,
  packAny,
  packCommand,
  packEvent,
  unpackAny,
} from "@spine-ts/core";
import {
  ActorContextSchema,
  CommandSchema,
  CommandContextSchema,
  CommandIdSchema,
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
  CompositeFilterSchema,
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
import { describe, expect, it } from "vitest";

import {
  Aggregate,
  BoundedContext,
  CommandRefusalError,
  Projection,
  Repository,
  SpineServices,
  defineEntityHandlers,
  type CommandDispatcher,
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

  it("rejects unsupported column filters before reading storage", async () => {
    const context = createRejectingReadContext();
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createColumnFilterQuery());

    expect(response.response?.status?.status.case).toBe("error");
    expect(responseErrorMessage(response)).toBe(
      "QueryService.Read does not support column filters.",
    );
  });

  it("rejects unsupported response formats before reading storage", async () => {
    const context = createRejectingReadContext();
    const handlers = registeredQueryHandlers(context);

    const fieldMask = await handlers.read(
      createFormattedQuery(
        create(ResponseFormatSchema, {
          fieldMask: create(FieldMaskSchema, { paths: ["name"] }),
        }),
      ),
    );
    const orderBy = await handlers.read(
      createFormattedQuery(
        create(ResponseFormatSchema, {
          orderBy: [
            create(OrderBySchema, {
              column: "name",
              direction: OrderBy_Direction.ASCENDING,
            }),
          ],
        }),
      ),
    );
    const limit = await handlers.read(
      createFormattedQuery(
        create(ResponseFormatSchema, {
          limit: 1,
        }),
      ),
    );

    expect(responseErrorMessage(fieldMask)).toBe("QueryService.Read does not support field masks.");
    expect(responseErrorMessage(orderBy)).toBe("QueryService.Read does not support ordering.");
    expect(responseErrorMessage(limit)).toBe("QueryService.Read does not support limits.");
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

  it("delivers post-activation queued updates and omits non-string update IDs", async () => {
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

    await delay(25);
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: "task-first",
      state: createState("task-first", "First"),
    });
    deliverUpdate?.({
      typeUrl: deriveTypeUrl(ProjectionStateSchema),
      id: { value: "task-object" },
      state: createState("task-object", "Object"),
    });

    const firstUpdate = await withTimeout(first, "first direct subscription update");
    const secondUpdate = await withTimeout(iterator.next(), "queued direct subscription update");
    const secondValue = secondUpdate.value as SubscriptionUpdate | undefined;

    expect(firstUpdate.done).toBe(false);
    expect(secondUpdate.done).toBe(false);
    if (secondValue?.update.case !== "entityUpdates") {
      throw new Error("Expected entity subscription update.");
    }
    expect(secondValue.update.value.update[0]?.id).toBeUndefined();
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

function createAggregateEvent(id: string, aggregateId: string, name: string) {
  return packEvent({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: aggregateId,
      name,
      archived: false,
    }),
  });
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

function createColumnFilterQuery() {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "q-column-filter" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(ProjectionStateSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: {
            id: [packStringId("task-1")],
          },
          filter: [create(CompositeFilterSchema)],
        }),
      },
    }),
    context: createActorContext(),
  });
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

function createTopic(tenantId?: TenantInput) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "t-1" }),
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
  readonly subscribe?: (
    schema: typeof ProjectionStateSchema,
    callback: (update: {
      readonly typeUrl: string;
      readonly id: unknown;
      readonly state: ProjectionState;
    }) => void,
    options: { readonly tenantId?: string },
  ) => { readonly closed: boolean; unsubscribe(): void };
}) {
  const commandTypes = options.commandTypes ?? [];
  const stateTypes = options.stateTypes ?? [];

  return {
    isMultitenant: options.isMultitenant ?? false,
    commandBus: () =>
      Object.freeze({
        acceptedCommandTypes: () => commandTypes,
        post: options.post ?? (() => Promise.resolve()),
      }),
    registeredRepositories: () =>
      stateTypes.map((typeUrl) =>
        Object.freeze({
          entityFamily: options.entityFamily ?? "projection",
          stateSchema: ProjectionStateSchema,
          typeUrl,
        }),
      ),
    stand: () =>
      Object.freeze({
        subscribe: options.subscribe ?? (() => ({ closed: false, unsubscribe: () => undefined })),
        readAllVersioned: options.readAllVersioned ?? (() => Promise.resolve([])),
        readVersioned: options.readVersioned ?? (() => Promise.resolve(undefined)),
      }),
  } as unknown as BoundedContext;
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

async function startServices(...contexts: BoundedContext[]) {
  const services = new SpineServices({ contexts });
  const sessions = new Set<http2.ServerHttp2Session>();
  const server = http2.createServer(
    connectNodeAdapter({
      routes: (router) => {
        services.register(router);
      },
    }),
  );
  server.on("session", (session) => {
    sessions.add(session);
    session.on("close", () => sessions.delete(session));
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port.toString()}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        for (const session of sessions) {
          session.destroy();
        }
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      }),
  };
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
