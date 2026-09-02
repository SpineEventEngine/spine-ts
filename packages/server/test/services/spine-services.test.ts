/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { compressionGzip, createGrpcTransport } from "@connectrpc/connect-node";
import { clone, create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  BoolValueSchema,
  BytesValueSchema,
  DoubleValueSchema,
  EmptySchema,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  FieldMaskSchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  TimestampSchema,
  UInt32ValueSchema,
  type Any,
} from "@bufbuild/protobuf/wkt";
import {
  ValidationException,
  type MessageSchema,
  TypeUrls,
  AnyMessages,
  SignalEnvelopes,
} from "@spine-event-engine/core";
import {
  ActorContextSchema,
  CommandSchema,
  CommandContextSchema,
  CommandIdSchema,
  Command_SystemPropertiesSchema,
  EmailAddressSchema,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  FieldPathSchema,
  InternetDomainSchema,
  OriginSchema,
  RejectionEventContextSchema,
  TenantIdSchema,
  type TenantId,
  UserIdSchema,
  ValidationErrorSchema,
  VersionSchema,
  file_spine_options,
  type Event,
} from "@spine-event-engine/proto";
import { CommandService } from "@spine-event-engine/proto/client";
import {
  type CompositeFilter,
  CompositeFilter_CompositeOperator,
  CompositeFilterSchema,
  Filter_Operator,
  FilterSchema,
  TargetFiltersSchema,
  TargetSchema,
} from "@spine-event-engine/proto/client";
import {
  OrderBySchema,
  OrderBy_Direction,
  QueryIdSchema,
  QuerySchema,
  ResponseFormatSchema,
  type Query,
  type QueryResponse,
} from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import { SubscriptionService } from "@spine-event-engine/proto/client";
import {
  type Subscription,
  type SubscriptionUpdate,
  type Topic,
  SubscriptionIdSchema,
  SubscriptionSchema,
  TopicIdSchema,
  TopicSchema,
} from "@spine-event-engine/proto/client";
import type { Ack } from "@spine-event-engine/proto";
import type { Response } from "@spine-event-engine/proto";
import * as EntityLog from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import {
  EventStore,
  InMemoryStorageFactory,
  type NormalizedQueryPlan,
} from "@spine-event-engine/storage";
import { describe, expect, it, vi } from "vitest";
import type { ILogLayer } from "loglayer";

import {
  Aggregate,
  BoundedContext,
  Projection,
  Repository,
  Server,
  SpineServices,
  EntityHandlers,
  InMemorySubscriptionRegistry,
  type CommandDispatcher,
  type EventDispatcher,
  type RunningServer,
} from "../../src/index.js";
import { boundedContextAccess } from "../../src/context/bounded-context.js";
import { spineServicesAccess } from "../../src/services/spine-services.js";
import { TaskAlreadyDone } from "../../../../examples/todo/generated/spine/examples/todo/task_rejections.js";
import { TaskAlreadyDoneSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_rejections_pb.js";
import {
  TaskIdSchema as TodoIdSchema,
  TaskListIdSchema as TodoTaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import {
  TaskCreatedSchema,
  type TaskCreated,
} from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import { TaskSchema as TodoTaskSchema } from "../../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

const GeneratedTaskIdSchema = TodoIdSchema;
let stateChangeSequence = 0;

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

type TaskId = Message<"spine.examples.todo.TaskId"> & {
  value: string;
};

type TaskListId = Message<"spine.examples.todo.TaskListId"> & {
  value: string;
};

type Task = Message<"spine.examples.todo.Task"> & {
  id?: TaskId;
  title: string;
  completed: boolean;
  taskListId?: TaskListId;
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
const fileTaskIdFixture = TodoIdSchema.file;
const fileTaskFixture = TodoTaskSchema.file;
const TaskIdSchema = messageDesc(fileTaskIdFixture, 0) as GenMessage<TaskId>;
const TaskSchema = messageDesc(fileTaskFixture, 0) as GenMessage<Task>;

class TaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  subscribeTask(event: TaskCreated): void {
    const id = event.id?.value ?? "";
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectionStateSchema, {
          id,
          name: `${event.title} (projected)`,
          priority: 2,
        }),
      ),
    );
  }
}

class RejectingTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(): never {
    throw TaskAlreadyDone.create({
      id: create(GeneratedTaskIdSchema, { value: this.id }),
    });
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
    this.update((draft) =>
      Object.assign(
        draft,
        create(ValidatedAggregateStateSchema, {
          id: event.id,
          name: event.name,
        }),
      ),
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
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: `${command.id}-changed`,
          name: command.name,
          archived: command.archived,
        }),
      ),
    );
    return createAggregateEvent("event-transition-invalid", command.id, command.name);
  }
}

class RollingBackTransitionTaskAggregate extends TransitionViolatingTaskAggregate {
  override assignTask(command: AggregateState) {
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: `${command.id}-changed`,
          name: command.name,
          archived: command.archived,
        }),
      ),
    );
    return createAggregateEvent("event-transition-rollback", command.id, command.name);
  }
}

class MessageIdTaskAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {}

describe("SpineServices", () => {
  it("rejects foreign package-private logger access", () => {
    const foreign = {} as SpineServices;

    expect(() => {
      spineServicesAccess.installLogger(foreign, {} as never);
    }).toThrow("SpineServices logger requires a SpineServices instance.");
    expect(() => {
      spineServicesAccess.clearLogger(foreign);
    }).toThrow("SpineServices logger requires a SpineServices instance.");
  });

  it("uses the current Todo descriptor type names in routing fixtures", () => {
    expect(TaskIdSchema.typeName).toBe("spine.examples.todo.TaskId");
    expect(TaskSchema.typeName).toBe("spine.examples.todo.Task");
  });

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
      expect(ack.messageId?.typeUrl).toBe(TypeUrls.derive(CommandIdSchema));
      expect(observed).toEqual(["command-1"]);
    } finally {
      await server.close();
    }
  });

  it("rejects an uncompressed request message above the configured network bound", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher((command) => {
      observed.push(command.id?.uuid ?? "missing");
    });
    const context = BoundedContext.singleTenant("Tasks").addCommandDispatcher(dispatcher).build();
    const server = await new Server({ contexts: [context], readMaxBytes: 512 }).start();

    try {
      const client = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: server.baseUrl, writeMaxBytes: 10_000 }),
      );

      await expect(
        client.post(createProjectionCommand("oversized-command", undefined, "x".repeat(2_000))),
      ).rejects.toMatchObject({ code: Code.ResourceExhausted } satisfies Partial<ConnectError>);
      expect(observed).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("defaults the request message bound to 4,194,304 uncompressed bytes", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher((command) => {
      observed.push(command.id?.uuid ?? "missing");
    });
    const context = BoundedContext.singleTenant("Tasks").addCommandDispatcher(dispatcher).build();
    const server = await new Server({ contexts: [context] }).start();

    try {
      const client = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: server.baseUrl, writeMaxBytes: 5_000_000 }),
      );

      await expect(
        client.post(createProjectionCommand("default-bound", undefined, "x".repeat(4_194_304))),
      ).rejects.toMatchObject({ code: Code.ResourceExhausted } satisfies Partial<ConnectError>);
      expect(observed).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("rejects a compressed request whose uncompressed message exceeds the network bound", async () => {
    const observed: string[] = [];
    const dispatcher = createCommandDispatcher((command) => {
      observed.push(command.id?.uuid ?? "missing");
    });
    const context = BoundedContext.singleTenant("Tasks").addCommandDispatcher(dispatcher).build();
    const server = await new Server({ contexts: [context], readMaxBytes: 512 }).start();

    try {
      const client = createClient(
        CommandService,
        createGrpcTransport({
          baseUrl: server.baseUrl,
          writeMaxBytes: 10_000,
          sendCompression: compressionGzip,
          compressMinBytes: 0,
        }),
      );

      await expect(
        client.post(createProjectionCommand("compressed-command", undefined, "x".repeat(2_000))),
      ).rejects.toMatchObject({ code: Code.ResourceExhausted } satisfies Partial<ConnectError>);
      expect(observed).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it("rejects a response message above the configured network bound", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "x".repeat(2_000)));
    const server = await new Server({ contexts: [context], writeMaxBytes: 512 }).start();

    try {
      const client = createClient(
        QueryService,
        createGrpcTransport({ baseUrl: server.baseUrl, readMaxBytes: 10_000 }),
      );

      await expect(client.read(createQuery("task-1"))).rejects.toMatchObject({
        code: Code.ResourceExhausted,
      } satisfies Partial<ConnectError>);
    } finally {
      await server.close();
    }
  });

  it("reads Stand state through QueryService over a real gRPC transport", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 7 }),
    });
    const server = await startServices(context);

    try {
      const client = createClient(QueryService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const response = await client.read(createQuery("task-1"));

      expect(response.response?.status?.status.case).toBe("ok");
      expect(response.message).toHaveLength(1);
      expect(
        AnyMessages.unpack(response.message[0]?.state ?? packMissing(), ProjectionStateSchema),
      ).toEqual(createState("task-1", "First"));
      expect(response.message[0]?.version).toEqual(create(VersionSchema, { number: 7 }));
    } finally {
      await server.close();
    }
  });

  it("executes the complete Entity query contract over real gRPC", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("NetworkQuery").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Beta", 2), {
      version: create(VersionSchema, { number: 1 }),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-2", "Alpha", 2), {
      version: create(VersionSchema, { number: 2 }),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-3", "Gamma", 1), {
      version: create(VersionSchema, { number: 3 }),
    });
    const server = await startServices(context);

    try {
      const client = createClient(QueryService, createGrpcTransport({ baseUrl: server.baseUrl }));
      const query = create(QuerySchema, {
        id: create(QueryIdSchema, { value: "q-network-complete" }),
        target: create(TargetSchema, {
          type: TypeUrls.derive(ProjectionStateSchema),
          criterion: {
            case: "filters",
            value: create(TargetFiltersSchema, {
              filter: [
                create(CompositeFilterSchema, {
                  operator: CompositeFilter_CompositeOperator.ALL,
                  filter: [
                    create(FilterSchema, {
                      fieldPath: { fieldName: ["priority"] },
                      value: packInt32(2),
                      operator: Filter_Operator.GREATER_OR_EQUAL,
                    }),
                  ],
                  compositeFilter: [
                    create(CompositeFilterSchema, {
                      operator: CompositeFilter_CompositeOperator.EITHER,
                      filter: [
                        create(FilterSchema, {
                          fieldPath: { fieldName: ["name"] },
                          value: packStringId("Alpha"),
                          operator: Filter_Operator.EQUAL,
                        }),
                        create(FilterSchema, {
                          fieldPath: { fieldName: ["name"] },
                          value: packStringId("Beta"),
                          operator: Filter_Operator.EQUAL,
                        }),
                      ],
                    }),
                  ],
                }),
              ],
            }),
          },
        }),
        context: createActorContext(),
        format: create(ResponseFormatSchema, {
          fieldMask: create(FieldMaskSchema, { paths: ["name"] }),
          orderBy: [
            create(OrderBySchema, { column: "priority", direction: OrderBy_Direction.DESCENDING }),
            create(OrderBySchema, { column: "name", direction: OrderBy_Direction.ASCENDING }),
          ],
          limit: 1,
        }),
      });

      const response = await client.read(query);
      expect(response.response?.status?.status.case).toBe("ok");
      expect(response.message.map((item) => unpackProjectionState(item.state))).toEqual([
        create(ProjectionStateSchema, { name: "Alpha" }),
      ]);
      expect(response.message[0]?.version).toEqual(create(VersionSchema, { number: 2 }));

      const invalid = createColumnFilterQuery("priority", packStringId("wrong"));
      const invalidResponse = await client.read(invalid);
      expect(responseErrorMessage(invalidResponse)).toBe(
        'QueryService.Read column filter "priority" has the wrong value type.',
      );
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
    expect(
      AnyMessages.unpack(response.message[0]?.state ?? packMissing(), ProjectionStateSchema),
    ).toEqual(createState("task-1", "First"));
    expect(response.message[0]?.version).toEqual(create(VersionSchema, { number: 7 }));
  });

  it("reads message-typed IDs and rejects incompatible ID payloads through QueryService", async () => {
    const repository = new Repository({
      entityType: MessageIdTaskAggregate,
      schema: TaskSchema,
    });
    const context = BoundedContext.singleTenant("MessageIdTasks")
      .add(repository)
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
    const taskId = create(TaskIdSchema, { value: "task-message-id" });
    const task = create(TaskSchema, {
      id: taskId,
      title: "Message ID",
      taskListId: create(TodoTaskListIdSchema, { value: "message-id-list" }),
    });
    await context.stand().update(TaskSchema, task);
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createMessageIdQuery(taskId));
    const incompatible = await handlers.read(
      createMessageIdQuery(create(TaskIdSchema, { value: "unused" }), packStringId("wrong")),
    );

    expect(response.response?.status?.status.case).toBe("ok");
    expect(response.message).toHaveLength(1);
    expect(AnyMessages.unpack(response.message[0]?.state ?? packMissing(), TaskSchema)).toEqual(
      task,
    );
    expect(responseErrorMessage(incompatible)).toBe(
      "QueryService.Read id_filter values must pack spine.examples.todo.TaskId.",
    );
  });

  it("keeps QueryService reads isolated by tenant", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.multitenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Tenant A"), {
      tenantId: tenantValue("tenant-a"),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Tenant B"), {
      tenantId: tenantValue("tenant-b"),
    });
    const server = await startServices(context);

    try {
      const client = createClient(QueryService, createGrpcTransport({ baseUrl: server.baseUrl }));

      const response = await client.read(createQuery("task-1", "tenant-b"));

      expect(response.response?.status?.status.case).toBe("ok");
      expect(response.message).toHaveLength(1);
      expect(
        AnyMessages.unpack(response.message[0]?.state ?? packMissing(), ProjectionStateSchema),
      ).toEqual(createState("task-1", "Tenant B"));
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
    expect(
      AnyMessages.unpack(response.message[0]?.state ?? packMissing(), ProjectionStateSchema),
    ).toEqual(createState("task-1", "First"));
    expect(response.message[0]?.version).toEqual(create(VersionSchema, { number: 1 }));
    expect(
      AnyMessages.unpack(response.message[1]?.state ?? packMissing(), ProjectionStateSchema),
    ).toEqual(createState("task-2", "Second"));
    expect(response.message[1]?.version).toEqual(create(VersionSchema, { number: 2 }));
  });

  it("keeps QueryService include-all reads isolated by tenant", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.multitenant("Tasks").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Tenant A"), {
      tenantId: tenantValue("tenant-a"),
      version: create(VersionSchema, { number: 1 }),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-2", "Tenant B"), {
      tenantId: tenantValue("tenant-b"),
      version: create(VersionSchema, { number: 2 }),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-3", "Tenant B Again"), {
      tenantId: tenantValue("tenant-b"),
      version: create(VersionSchema, { number: 3 }),
    });
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createIncludeAllQuery("tenant-b"));

    expect(response.response?.status?.status.case).toBe("ok");
    expect(response.message).toHaveLength(2);
    expect(
      AnyMessages.unpack(response.message[0]?.state ?? packMissing(), ProjectionStateSchema),
    ).toEqual(createState("task-2", "Tenant B"));
    expect(response.message[0]?.version).toEqual(create(VersionSchema, { number: 2 }));
    expect(
      AnyMessages.unpack(response.message[1]?.state ?? packMissing(), ProjectionStateSchema),
    ).toEqual(createState("task-3", "Tenant B Again"));
    expect(response.message[1]?.version).toEqual(create(VersionSchema, { number: 3 }));
  });

  it("reads all aggregate states through QueryService include-all queries", async () => {
    const context = createFakeContext({
      entityFamily: "aggregate",
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
      readAllVersioned: () =>
        Promise.resolve([{ state: createState("task-aggregate", "Aggregate") }]),
    });
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createIncludeAllQuery());

    expect(response.response?.status?.status.case).toBe("ok");
    expect(
      AnyMessages.unpack(response.message[0]?.state ?? packMissing(), ProjectionStateSchema),
    ).toEqual(createState("task-aggregate", "Aggregate"));
  });

  it("reads all process-manager states through QueryService include-all queries", async () => {
    const context = createFakeContext({
      entityFamily: "process-manager",
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
      readAllVersioned: () =>
        Promise.resolve([{ state: createState("task-pm", "Process manager") }]),
    });
    const handlers = registeredQueryHandlers(context);

    const response = await handlers.read(createIncludeAllQuery());

    expect(response.response?.status?.status.case).toBe("ok");
    expect(
      AnyMessages.unpack(response.message[0]?.state ?? packMissing(), ProjectionStateSchema),
    ).toEqual(createState("task-pm", "Process manager"));
  });

  it("accepts declared and system-column filters for aggregate and process-manager routes", async () => {
    const plans: unknown[] = [];
    const handlers = (["aggregate", "process-manager"] as const).map((entityFamily) =>
      registeredQueryHandlers(
        createFakeContext({
          entityFamily,
          stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
          queryVersioned: (_schema, plan) => {
            plans.push(plan);
            return Promise.resolve([]);
          },
        }),
      ),
    );
    const queries = [
      createColumnFilterQuery("name", packStringId("Entity")),
      createColumnFilterQuery(
        "archived",
        AnyMessages.pack(BoolValueSchema, create(BoolValueSchema, { value: false })),
      ),
      createColumnFilterQuery(
        "deleted",
        AnyMessages.pack(BoolValueSchema, create(BoolValueSchema, { value: false })),
      ),
    ];
    const responses = await Promise.all(
      handlers.flatMap((handler) => queries.map((query) => handler.read(query))),
    );

    expect(responses.every((response) => response.response?.status?.status.case === "ok")).toBe(
      true,
    );
    expect(plans).toHaveLength(6);
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
        createQueryWithIds([
          AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "task-1" })),
        ]),
      );
      const emptyFilter = await queryClient.read(
        create(QuerySchema, {
          id: create(QueryIdSchema, { value: "q-empty-filter" }),
          target: create(TargetSchema, {
            type: TypeUrls.derive(ProjectionStateSchema),
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

    const idState = AnyMessages.unpack(
      idResponse.message[0]?.state ?? packMissing(),
      ProjectionStateSchema,
    );
    const allStates = allResponse.message.map((message) =>
      AnyMessages.unpack(message.state ?? packMissing(), ProjectionStateSchema),
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

  it("filters and orders by the Projection version system column", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("VersionQuery").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "First"), {
      version: create(VersionSchema, { number: 1 }),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-2", "Second"), {
      version: create(VersionSchema, { number: 3 }),
    });
    const query = createColumnFilterQuery(
      "version",
      AnyMessages.pack(VersionSchema, create(VersionSchema, { number: 2 }), { validate: false }),
      { operator: Filter_Operator.GREATER_OR_EQUAL },
    );
    query.format = create(ResponseFormatSchema, {
      orderBy: [
        create(OrderBySchema, { column: "version", direction: OrderBy_Direction.DESCENDING }),
      ],
      limit: 1,
    });

    const response = await registeredQueryHandlers(context).read(query);

    expect(response.message.map((message) => unpackProjectionState(message.state)?.id)).toEqual([
      "task-2",
    ]);
    expect(response.message[0]?.version).toEqual(create(VersionSchema, { number: 3 }));
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
      tenantId: tenantValue("tenant-a"),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-2", "Bravo", 2), {
      tenantId: tenantValue("tenant-b"),
      version: create(VersionSchema, { number: 2 }),
    });
    await context.stand().update(ProjectionStateSchema, createState("task-3", "Alpha", 2), {
      tenantId: tenantValue("tenant-b"),
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

  it("adds the implicit storage query cap without requiring ordering", async () => {
    const observedQueries: NormalizedQueryPlan<unknown>[] = [];
    const context = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
      queryVersioned: (_schema, query) => {
        observedQueries.push(query as NormalizedQueryPlan<unknown>);
        return Promise.resolve([]);
      },
    });
    const handlers = registeredQueryHandlers(context);

    const responses = [];
    responses.push(await handlers.read(createIncludeAllQuery()));
    responses.push(
      await handlers.read(createFormattedQuery(create(ResponseFormatSchema, { limit: 0 }))),
    );
    responses.push(
      await handlers.read(
        createFormattedColumnFilterQuery(
          "name",
          packStringId("Open"),
          create(ResponseFormatSchema),
        ),
      ),
    );
    responses.push(
      await handlers.read(
        createFormattedQuery(
          create(ResponseFormatSchema, {
            limit: 7,
            orderBy: [
              create(OrderBySchema, {
                column: "name",
                direction: OrderBy_Direction.ASCENDING,
              }),
            ],
          }),
        ),
      ),
    );

    expect(responses.map((response) => responseErrorMessage(response))).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);

    expect(observedQueries.map((query) => query.limit)).toEqual([
      undefined,
      undefined,
      undefined,
      7,
    ]);
    expect(observedQueries.map((query) => query.candidateLimit)).toEqual([
      1_000, 1_000, 1_000, 1_000,
    ]);
  });

  it("applies tenant filtering before the implicit storage query cap", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.multitenant("ImplicitQueryCap").add(repository).build();
    const tenantAUpdates = Array.from({ length: 1_001 }, (_, index) =>
      context
        .stand()
        .update(
          ProjectionStateSchema,
          createState(`tenant-a-${String(index)}`, `Tenant A ${String(index)}`),
          { tenantId: tenantValue("tenant-a") },
        ),
    );
    await Promise.all(tenantAUpdates);
    await context.stand().update(ProjectionStateSchema, createState("tenant-b-1", "Tenant B 1"), {
      tenantId: tenantValue("tenant-b"),
    });
    await context.stand().update(ProjectionStateSchema, createState("tenant-b-2", "Tenant B 2"), {
      tenantId: tenantValue("tenant-b"),
    });
    const handlers = registeredQueryHandlers(context);

    const tenantA = await handlers.read(createIncludeAllQuery("tenant-a"));
    const tenantB = await handlers.read(createIncludeAllQuery("tenant-b"));
    const tenantASystem = await handlers.read(
      createFormattedIncludeAllQuery(
        create(ResponseFormatSchema, {
          orderBy: [
            create(OrderBySchema, {
              column: "version",
              direction: OrderBy_Direction.ASCENDING,
            }),
          ],
        }),
        "tenant-a",
      ),
    );
    const tenantAExplicit = await handlers.read(
      createFormattedIncludeAllQuery(
        create(ResponseFormatSchema, {
          limit: 1,
          orderBy: [
            create(OrderBySchema, {
              column: "name",
              direction: OrderBy_Direction.ASCENDING,
            }),
          ],
        }),
        "tenant-a",
      ),
    );
    const tenantAExplicitSystem = await handlers.read(
      createFormattedIncludeAllQuery(
        create(ResponseFormatSchema, {
          limit: 1,
          orderBy: [
            create(OrderBySchema, {
              column: "version",
              direction: OrderBy_Direction.ASCENDING,
            }),
          ],
        }),
        "tenant-a",
      ),
    );

    expect(responseErrorMessage(tenantA)).toBe("Query read failed.");
    expect(responseErrorMessage(tenantASystem)).toBe("Query read failed.");
    expect(responseErrorMessage(tenantAExplicit)).toBe("Query read failed.");
    expect(responseErrorMessage(tenantAExplicitSystem)).toBe("Query read failed.");
    expect(tenantB.message.map((message) => unpackProjectionState(message.state)?.id)).toEqual([
      "tenant-b-1",
      "tenant-b-2",
    ]);
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

  it("rejects malformed ID-filter entries before storage query execution", async () => {
    let observedQuery: { readonly ids?: readonly unknown[] } | undefined;
    const context = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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

    expect(response.response?.status?.status.case).toBe("error");
    expect(responseErrorMessage(response)).toBe(
      "QueryService.Read id_filter entries are required.",
    );
    expect(observedQuery).toBeUndefined();
  });

  it("executes EITHER, nested, and range column filters", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("NestedQuery").add(repository).build();
    await context.stand().update(ProjectionStateSchema, createState("task-1", "Open", 1));
    await context.stand().update(ProjectionStateSchema, createState("task-2", "Closed", 2));
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

    expect(either.response?.status?.status.case).toBe("ok");
    expect(nested.response?.status?.status.case).toBe("ok");
    expect(greaterThan.message.map((message) => unpackProjectionState(message.state)?.id)).toEqual([
      "task-2",
    ]);
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
      "QueryService.Read composite operator must be ALL or EITHER.",
    );
  });

  it("rejects empty and malformed simple filter shapes before reading storage", async () => {
    const handlers = registeredQueryHandlers(createRejectingReadContext());
    const empty = createColumnFilterQuery();
    const missingField = createColumnFilterQuery();
    const nestedField = createColumnFilterQuery();
    const missingValue = createColumnFilterQuery();
    const unknownOperator = createColumnFilterQuery();
    if (
      empty.target?.criterion.case !== "filters" ||
      missingField.target?.criterion.case !== "filters" ||
      nestedField.target?.criterion.case !== "filters" ||
      missingValue.target?.criterion.case !== "filters" ||
      unknownOperator.target?.criterion.case !== "filters"
    ) {
      throw new Error("Expected filter queries.");
    }
    const emptyComposite = empty.target.criterion.value.filter[0];
    const missingFieldFilter = missingField.target.criterion.value.filter[0]?.filter[0];
    const nestedFieldFilter = nestedField.target.criterion.value.filter[0]?.filter[0];
    const missingValueFilter = missingValue.target.criterion.value.filter[0]?.filter[0];
    const unknownOperatorFilter = unknownOperator.target.criterion.value.filter[0]?.filter[0];
    if (
      emptyComposite === undefined ||
      missingFieldFilter === undefined ||
      nestedFieldFilter === undefined ||
      missingValueFilter === undefined ||
      unknownOperatorFilter === undefined
    ) {
      throw new Error("Expected simple filters.");
    }
    emptyComposite.filter = [];
    missingFieldFilter.fieldPath = undefined;
    nestedFieldFilter.fieldPath = create(FieldPathSchema, { fieldName: ["name", "value"] });
    missingValueFilter.value = undefined;
    unknownOperatorFilter.operator = Filter_Operator.CFO_UNDEFINED;

    const responses = await Promise.all([
      handlers.read(empty),
      handlers.read(missingField),
      handlers.read(nestedField),
      handlers.read(missingValue),
      handlers.read(unknownOperator),
    ]);

    expect(responses.map(responseErrorMessage)).toEqual([
      "QueryService.Read composite filter must not be empty.",
      "QueryService.Read column filter field is required.",
      "QueryService.Read supports only top-level column filters.",
      "QueryService.Read column filter value is required.",
      "QueryService.Read comparison operator is not supported.",
    ]);
  });

  it("rejects descriptor-incompatible numeric wrappers before provider access", async () => {
    const handlers = registeredQueryHandlers(createRejectingReadContext());
    const doubleWrapped = await handlers.read(
      createColumnFilterQuery(
        "priority",
        AnyMessages.pack(DoubleValueSchema, create(DoubleValueSchema, { value: 2 })),
      ),
    );
    const unsignedWrapped = await handlers.read(
      createColumnFilterQuery(
        "priority",
        AnyMessages.pack(UInt32ValueSchema, create(UInt32ValueSchema, { value: 2 })),
      ),
    );

    expect(responseErrorMessage(doubleWrapped)).toBe(
      'QueryService.Read column filter "priority" has the wrong value type.',
    );
    expect(responseErrorMessage(unsignedWrapped)).toBe(
      'QueryService.Read column filter "priority" has the wrong value type.',
    );
  });

  it("rejects a wide nested composite before reading or enqueueing children", async () => {
    const handlers = registeredQueryHandlers(createRejectingReadContext());
    const query = createColumnFilterQuery();
    if (query.target?.criterion.case !== "filters") throw new Error("Expected filters.");
    const root = query.target.criterion.value.filter[0];
    if (root === undefined) throw new Error("Expected root composite.");
    root.filter = [];
    const children = new Array<CompositeFilter>(9);
    let childReads = 0;
    Object.defineProperty(children, 0, {
      configurable: true,
      get() {
        childReads += 1;
        throw new Error("wide child must not be read");
      },
    });
    root.compositeFilter = children;

    const response = await handlers.read(query);

    expect(responseErrorMessage(response)).toBe(
      "QueryService.Read may contain at most 8 composite filters.",
    );
    expect(childReads).toBe(0);
  });

  it("normalizes typed system-column predicates before provider access", async () => {
    const plans: unknown[] = [];
    const context = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
      queryVersioned: (_schema, plan) => {
        plans.push(plan);
        return Promise.resolve([]);
      },
    });
    const handlers = registeredQueryHandlers(context);

    const responses = await Promise.all([
      handlers.read(
        createColumnFilterQuery(
          "version",
          AnyMessages.pack(
            VersionSchema,
            create(VersionSchema, {
              number: 2,
              timestamp: create(TimestampSchema, { seconds: 2n }),
            }),
          ),
          { operator: Filter_Operator.GREATER_OR_EQUAL },
        ),
      ),
      handlers.read(
        createColumnFilterQuery(
          "archived",
          AnyMessages.pack(BoolValueSchema, create(BoolValueSchema, { value: false })),
        ),
      ),
      handlers.read(
        createColumnFilterQuery(
          "deleted",
          AnyMessages.pack(BoolValueSchema, create(BoolValueSchema, { value: true })),
        ),
      ),
    ]);

    expect(responses.every((response) => response.response?.status?.status.case === "ok")).toBe(
      true,
    );
    expect(plans).toHaveLength(3);
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
          type: TypeUrls.derive(ProjectionStateSchema),
        }),
        context: createActorContext(),
      }),
    );
    const falseIncludeAll = await handlers.read(
      create(QuerySchema, {
        id: create(QueryIdSchema, { value: "q-false-include-all" }),
        target: create(TargetSchema, {
          type: TypeUrls.derive(ProjectionStateSchema),
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
      readVersioned: () => Promise.reject(new Error("storage details")),
    });
    const commandHandlers = registeredCommandHandlers(readFailureContext);
    const queryHandlers = registeredQueryHandlers(readFailureContext);

    const ack = await commandHandlers.post(create(CommandSchema));
    const response = await queryHandlers.read(createQuery("task-1"));

    expect(ack.status?.status.case).toBe("error");
    expect(errorMessage(ack.status?.status)).toBe("Command message type is required.");
    expect(response.response?.status?.status.case).toBe("error");
    expect(responseErrorMessage(response)).toBe("Query read failed.");
  });

  it("returns stable errors for include-all read failures", async () => {
    const readFailureContext = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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

  it("accepts a domain rejection and stores its typed event asynchronously", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createRejectingRepository())
      .withStorageFactory(storageFactory)
      .build();
    const handlers = registeredCommandHandlers(context);
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, storageFactory);
    const command = createAggregateCommand("command-rejected", "task-rejected");

    const ack = await handlers.post(command);
    const [event] = await waitForStoredEvents(eventStore, 1);

    expect(ack.status?.status.case).toBe("ok");
    expect(event?.message?.typeUrl).toBe(TypeUrls.derive(TaskAlreadyDoneSchema));
    expect(
      event?.message === undefined
        ? undefined
        : AnyMessages.unpack(event.message, TaskAlreadyDoneSchema),
    ).toEqual(
      create(TaskAlreadyDoneSchema, {
        id: create(GeneratedTaskIdSchema, { value: "task-rejected" }),
      }),
    );
    expect(event?.context?.rejection?.command).toEqual(command);
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

  it("contains transition validation failures with an OK Ack", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createTransitionViolatingRepository())
      .build();
    const handlers = registeredCommandHandlers(context);

    const ack = await handlers.post(
      createAggregateCommand("command-transition-invalid", "task-transition-invalid"),
    );

    expect(ack.status?.status.case).toBe("ok");
  });

  it("contains rollback transition validation failures with an OK Ack", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createRollingBackTransitionRepository())
      .build();
    const handlers = registeredCommandHandlers(context);

    const ack = await handlers.post(
      createAggregateCommand("command-transition-rollback", "task-transition-rollback"),
    );

    expect(ack.status?.status.case).toBe("ok");
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

    try {
      const singleClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: singleServer.baseUrl }),
      );
      const singleTenantAck = await singleClient.post(
        createProjectionCommand("single-with-tenant", "tenant-a"),
      );

      expect(singleTenantAck.status?.status.case).toBe("error");
      expect(errorMessage(singleTenantAck.status?.status)).toBe(
        "Tenant is not applicable for this command.",
      );
    } finally {
      await singleServer.close();
    }

    const multiServer = await startServices(multitenant);
    try {
      const multiClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: multiServer.baseUrl }),
      );
      const multitenantAck = await multiClient.post(
        createProjectionCommand("multi-without-tenant"),
      );

      expect(multitenantAck.status?.status.case).toBe("error");
      expect(errorMessage(multitenantAck.status?.status)).toBe(
        "Tenant is required for this command.",
      );
      expect(singleTenantDispatches).toEqual([]);
      expect(multitenantDispatches).toEqual([]);
    } finally {
      await multiServer.close();
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

    try {
      const singleClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: singleServer.baseUrl }),
      );
      const inapplicable = await singleClient.post(
        createProjectionCommand("single-domain-tenant", tenantDomain("tenant.example")),
      );

      expect(inapplicable.status?.status.case).toBe("error");
      expect(errorMessage(inapplicable.status?.status)).toBe(
        "Tenant is not applicable for this command.",
      );
    } finally {
      await singleServer.close();
    }

    const multiServer = await startServices(multitenant);
    try {
      const multiClient = createClient(
        CommandService,
        createGrpcTransport({ baseUrl: multiServer.baseUrl }),
      );
      const accepted = await multiClient.post(
        createProjectionCommand("multi-email-tenant", tenantEmail("tenant@example.test")),
      );

      expect(accepted.status?.status.case).toBe("ok");
      expect(singleTenantDispatches).toEqual([]);
      expect(multitenantDispatches).toEqual(["multi-email-tenant"]);
    } finally {
      await multiServer.close();
    }
  });

  it("routes commands by registered type without posting to wrong contexts", async () => {
    const wrongPosts: string[] = [];
    const acceptedPosts: string[] = [];
    const wrongContext = createFakeContext({
      commandTypes: [TypeUrls.derive(StringValueSchema)],
      post: (command) => {
        wrongPosts.push(command.id?.uuid ?? "");
        return Promise.reject(new Error("wrong context touched"));
      },
    });
    const acceptedContext = createFakeContext({
      commandTypes: [TypeUrls.derive(ProjectionStateSchema)],
      post: (command) => {
        acceptedPosts.push(command.id?.uuid ?? "");
        return Promise.resolve();
      },
    });
    const handlers = registeredCommandHandlersFor([wrongContext, acceptedContext]);

    const ack = await handlers.post(createProjectionCommand("command-routed"));

    expect(ack.status?.status.case).toBe("ok");
    expect(wrongPosts).toEqual([]);
    expect(acceptedPosts).toEqual(["command-routed"]);
  });

  it("uses the first registered command route for duplicate service routes", async () => {
    const firstPosts: string[] = [];
    const secondPosts: string[] = [];
    const firstContext = createFakeContext({
      commandTypes: [TypeUrls.derive(ProjectionStateSchema)],
      post: (command) => {
        firstPosts.push(command.id?.uuid ?? "");
        return Promise.resolve();
      },
    });
    const secondContext = createFakeContext({
      commandTypes: [TypeUrls.derive(ProjectionStateSchema)],
      post: (command) => {
        secondPosts.push(command.id?.uuid ?? "");
        return Promise.resolve();
      },
    });
    const handlers = registeredCommandHandlersFor([firstContext, secondContext]);

    const ack = await handlers.post(createProjectionCommand("command-first-route"));

    expect(ack.status?.status.case).toBe("ok");
    expect(firstPosts).toEqual(["command-first-route"]);
    expect(secondPosts).toEqual([]);
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
    const capturedTenantKeys: (TenantId | undefined)[] = [];
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const singleTenant = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
      isMultitenant: false,
    });
    const multitenant = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: "task-tenant",
      state: createState("task-tenant", "Tenant"),
    });
    await withTimeout(pending, "subscription tenant activation update");
    await iterator.return?.();

    expect(capturedTenantKeys).toEqual([tenantEmail("tenant@example.test")]);
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
    const capturedTenantKeys: (TenantId | undefined)[] = [];
    const singleTenant = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
      isMultitenant: false,
    });
    const multitenant = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
      isMultitenant: true,
      readVersioned: (_schema, _id, options) => {
        capturedTenantKeys.push(options.tenantId);
        return Promise.resolve({
          state: createState("task-1", "Tenant Domain"),
          version: create(VersionSchema, { number: 11 }),
        });
      },
    });
    const singleHandlers = registeredQueryHandlers(singleTenant);
    const multiHandlers = registeredQueryHandlers(multitenant);

    const inapplicable = await singleHandlers.read(
      createQuery("task-1", tenantEmail("tenant@example.test")),
    );
    const accepted = await multiHandlers.read(
      createQuery("task-1", tenantDomain("tenant.example")),
    );

    expect(inapplicable.response?.status?.status.case).toBe("error");
    expect(responseErrorMessage(inapplicable)).toBe("Tenant is not applicable for this query.");
    expect(accepted.response?.status?.status.case).toBe("ok");
    expect(capturedTenantKeys).toEqual([tenantDomain("tenant.example")]);
  });

  it("treats include-all query tenant domain and email variants as present", async () => {
    const capturedTenantKeys: (TenantId | undefined)[] = [];
    const singleTenant = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
      isMultitenant: false,
    });
    const multitenant = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
    expect(capturedTenantKeys).toEqual([tenantDomain("tenant.example")]);
  });

  it("activates and cancels explicit subscriptions over a real gRPC transport", async () => {
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
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
      await postEntityStateChanged(context, ProjectionStateSchema, createState("task-1", "First"));

      const delivered = await nextUpdate;
      const update = delivered.value as SubscriptionUpdate | undefined;

      expect(subscription.id?.value).toMatch(/^s-/u);
      expect(subscription.topic?.target?.type).toBe(TypeUrls.derive(ProjectionStateSchema));
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
      expect(AnyMessages.unpack(state.value, ProjectionStateSchema)).toEqual(
        createState("task-1", "First"),
      );

      const cancel = await withTimeout(client.cancel(subscription), "subscription cancellation");
      await context.stand().update(ProjectionStateSchema, createState("task-1", "Second"));

      expect(cancel.status?.status.case).toBe("ok");
    } finally {
      await server.close();
    }
  });

  it("stores the canonical subscription lifecycle in the context Stand registry", async () => {
    const registry = new InMemorySubscriptionRegistry();
    const repository = new Repository({
      entityType: TaskProjection,
      schema: ProjectionStateSchema,
    });
    const context = BoundedContext.singleTenant("RegistrySubscriptions")
      .withSubscriptionRegistry(registry)
      .add(repository)
      .build();
    const handlers = registeredSubscriptionHandlers(context);

    const subscription = await handlers.subscribe(createTopic());
    const created = await registry.snapshot();

    expect(created).toHaveLength(1);
    expect(created[0]?.subscription).toEqual(subscription);
    expect(created[0]?.phase).toBe("pending");

    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const pending = iterator.next();
    await delay(25);

    const id = subscription.id;
    if (id === undefined) throw new Error("Subscription ID is required.");
    expect((await registry.get(id))?.phase).toBe("active");
    await handlers.cancel(subscription);
    await pending;
    expect(await registry.get(id)).toBeUndefined();
    await context.close();
  });

  it("activates a registry definition from another service instance", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const firstContext = BoundedContext.singleTenant("SharedSubscriptions")
      .withStorageFactory(storageFactory)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema }))
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
    const secondContext = BoundedContext.singleTenant("SharedSubscriptions")
      .withStorageFactory(storageFactory)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema }))
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
    const first = registeredSubscriptionHandlers(firstContext);
    const second = registeredSubscriptionHandlers(secondContext);

    try {
      const subscription = await first.subscribe(createTopic());
      const iterator = second.activate(subscription)[Symbol.asyncIterator]();
      const pending = iterator.next();
      await delay(25);
      await postEntityStateChanged(
        secondContext,
        ProjectionStateSchema,
        createState("task-shared", "Shared"),
      );

      const delivery = await withTimeout(pending, "cross-service subscription update");
      expect(delivery.done).toBe(false);
      await second.cancel(subscription);
      await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    } finally {
      await secondContext.close();
      await firstContext.close();
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
    const source = createAggregateEvent("event-created", "aggregate-1", "Created");
    await context.eventBus().post(source);

    const delivered = await nextUpdate;
    const update = delivered.value as SubscriptionUpdate | undefined;

    expect(delivered.done).toBe(false);
    expect(subscription.topic?.target?.type).toBe(TypeUrls.derive(AggregateStateSchema));
    expect(update?.response?.status?.status.case).toBe("ok");
    expect(update?.subscription?.id).toEqual(subscription.id);
    if (update?.update.case !== "eventUpdates") {
      throw new Error("Expected event subscription update.");
    }
    const event = update.update.value.event[0];
    if (event?.message === undefined) {
      throw new Error("Expected delivered event envelope.");
    }
    expect(event).toEqual(source);
    expect(event).not.toBe(source);
    expect(event.id?.value).toBe("event-created");
    expect(AnyMessages.unpack(event.message, AggregateStateSchema)).toEqual(
      create(AggregateStateSchema, {
        id: "aggregate-1",
        name: "Created",
        archived: false,
      }),
    );
    await iterator.return?.();
  });

  it("keeps a closed event subscription detached when best-effort cleanup rejects", async () => {
    const context = BoundedContext.singleTenant("EventCleanup")
      .withSubscriptionRegistry(new RejectingDeleteRegistry())
      .addEventDispatcher(createDomainEventDispatcher(AggregateStateSchema))
      .build();
    const services = new SpineServices({ contexts: [context], queueLimit: 1 });
    let handlers:
      | {
          subscribe(topic: Topic): Promise<Subscription>;
          activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate>;
        }
      | undefined;
    services.register({
      service(schema: unknown, implementation: unknown) {
        if (schema === SubscriptionService) handlers = implementation as typeof handlers;
        return this;
      },
    } as never);
    if (handlers === undefined) throw new Error("SubscriptionService was not registered.");
    const subscription = await handlers.subscribe(createEventTopic());
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const first = iterator.next();
    await delay(25);
    await context.eventBus().post(createAggregateEvent("event-1", "aggregate-1", "First"));
    await first;
    await context.eventBus().post(createAggregateEvent("event-2", "aggregate-1", "Second"));
    await context.eventBus().post(createAggregateEvent("event-3", "aggregate-1", "Third"));
    await delay(25);

    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
    await context.close();
  });

  it("redacts rejection details only from client event subscription updates", async () => {
    const internallyDispatched: ReturnType<typeof createRejectionEvent>[] = [];
    const context = BoundedContext.multitenant("RejectionEvents")
      .addEventDispatcher({
        messageSchemas: () => [TaskAlreadyDoneSchema],
        dispatch: (event) => {
          internallyDispatched.push(event);
          return Promise.resolve();
        },
      })
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(
      createEventTopic("tenant-rejected", TaskAlreadyDoneSchema),
    );
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const nextUpdate = withTimeout(iterator.next(), "rejection event subscription update");
    const command = createAggregateCommand("command-rejected", "task-rejected");
    const source = createRejectionEvent(command, "rejection stack");

    await delay(25);
    await context.eventBus().post(source);

    const delivered = await nextUpdate;
    const update = delivered.value as SubscriptionUpdate | undefined;
    if (update?.update.case !== "eventUpdates") {
      throw new Error("Expected rejection event subscription update.");
    }
    const event = update.update.value.event[0];
    if (event === undefined) {
      throw new Error("Expected delivered rejection event envelope.");
    }
    const expected = clone(EventSchema, source);
    if (expected.context?.rejection === undefined) {
      throw new Error("Expected rejection event context.");
    }
    expected.context.rejection.command = undefined;
    // Model the legacy wire field only to verify client-side security redaction.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expected.context.rejection.commandMessage = undefined;
    expected.context.rejection.stacktrace = "";

    expect(event).toEqual(expected);
    expect(event.context?.rejection?.command).toBeUndefined();
    // Verify that the legacy wire payload is absent from the client clone.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(event.context?.rejection?.commandMessage).toBeUndefined();
    expect(event.context?.rejection?.stacktrace).toBe("");
    expect(source.context?.rejection?.command).toEqual(command);
    // Verify that security redaction did not mutate the legacy source payload.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    expect(source.context?.rejection?.commandMessage?.value.byteLength).toBeGreaterThan(0);
    expect(source.context?.rejection?.stacktrace).toBe("rejection stack");
    expect(internallyDispatched).toEqual([source]);
    expect(internallyDispatched[0]?.context?.rejection).toEqual(source.context?.rejection);
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
    const attachment = await awaitSubscriptionAttachment(context, subscription);
    let settled = false;
    void nextUpdate.then(() => {
      settled = true;
    });

    await context
      .eventBus()
      .post(createAggregateEvent("event-tenant-b", "aggregate-1", "Tenant B", "tenant-b"));
    await Promise.resolve();
    expect(settled).toBe(false);

    await context
      .eventBus()
      .post(createAggregateEvent("event-tenant-a", "aggregate-1", "Tenant A", "tenant-a"));
    const delivered = await withTimeout(nextUpdate, "tenant event subscription update");
    const update = delivered.value as SubscriptionUpdate | undefined;

    expect(delivered.done).toBe(false);
    if (update?.update.case !== "eventUpdates") {
      throw new Error("Expected tenant event subscription update.");
    }
    expect(update.update.value.event.map((event) => event.id?.value)).toEqual(["event-tenant-a"]);
    attachment.unsubscribe();
    await iterator.return?.();
  });

  it("matches multitenant event subscriptions against past-message actor tenants", async () => {
    const context = BoundedContext.multitenant("PastMessageTenantEvents")
      .addEventDispatcher(createDomainEventDispatcher(AggregateStateSchema))
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createEventTopic("tenant-past"));
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const nextUpdate = iterator.next();
    const attachment = await awaitSubscriptionAttachment(context, subscription);
    let settled = false;
    void nextUpdate.then(() => {
      settled = true;
    });

    await context
      .eventBus()
      .post(createPastMessageAggregateEvent("event-past-other", "tenant-other"));
    await Promise.resolve();
    expect(settled).toBe(false);
    await context
      .eventBus()
      .post(createPastMessageAggregateEvent("event-past-match", "tenant-past"));

    const delivered = await withTimeout(nextUpdate, "past-message tenant subscription update");
    const update = delivered.value as SubscriptionUpdate | undefined;

    expect(delivered.done).toBe(false);
    expect(update?.update.case).toBe("eventUpdates");
    expect(
      update?.update.case === "eventUpdates"
        ? update.update.value.event.map((event) => event.id?.value)
        : [],
    ).toEqual(["event-past-match"]);
    attachment.unsubscribe();
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
      type: TypeUrls.derive(AggregateStateSchema),
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

  it("rejects field masks and false include-all values on event topics", () => {
    const context = BoundedContext.singleTenant("MalformedEventTopics")
      .addEventDispatcher(createDomainEventDispatcher(AggregateStateSchema))
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const masked = createEventTopic();
    masked.fieldMask = create(FieldMaskSchema, { paths: ["name"] });
    const disabled = createEventTopic();
    if (disabled.target?.criterion.case !== "includeAll") {
      throw new Error("Expected an include-all event topic.");
    }
    disabled.target.criterion.value = false;

    for (const [topic, message] of [
      [masked, "SubscriptionService.Subscribe event topics do not support field_mask."],
      [disabled, "SubscriptionService.Subscribe requires filters or include_all = true."],
    ] as const) {
      expect(() => handlers.subscribe(topic)).toThrow(message);
    }
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
    expect(AnyMessages.unpack(state.value, ProjectionStateSchema)).toEqual(
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: "task-1",
      state: createState("task-1", "Closed"),
    });
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: "task-2",
      state: createState("task-2", "Open"),
    });
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: "task-1",
      previousState: createState("task-1", "Open"),
      state: createState("task-1", "Closed"),
    });

    const delivered = await withTimeout(next, "no-longer-matching subscription update");
    const update = delivered.value as SubscriptionUpdate | undefined;

    expect(delivered.done).toBe(false);
    expect(entityUpdateKind(update)?.case).toBe("noLongerMatching");
    expect(entityUpdateKind(update)?.value).toBe(true);
    expect(
      AnyMessages.unpack(entityUpdateId(update) ?? packMissing(), StringValueSchema)?.value,
    ).toBe("task-1");
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: "task-1",
      state: createState("task-1", "Open", 7),
    });
    const deliveredState = await withTimeout(first, "masked subscription state");
    const second = iterator.next();
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      createFakeContext({ stateTypes: [TypeUrls.derive(ProjectionStateSchema)] }),
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
          target: create(TargetSchema, { type: TypeUrls.derive(ProjectionStateSchema) }),
          context: createActorContext(),
        }),
        message: "Subscription topic criterion is required.",
      },
      {
        topic: create(TopicSchema, {
          id: create(TopicIdSchema, { value: "t-include-none" }),
          target: create(TargetSchema, {
            type: TypeUrls.derive(ProjectionStateSchema),
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
        type: TypeUrls.derive(ProjectionStateSchema),
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
      createFakeContext({ stateTypes: [TypeUrls.derive(ProjectionStateSchema)] }),
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
      createFakeContext({ stateTypes: [TypeUrls.derive(ProjectionStateSchema)] }),
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
    const context = BoundedContext.singleTenant("MessageIdTasks")
      .add(repository)
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const topic = createFilteredTopicForTask({
      filter: [
        create(CompositeFilterSchema, {
          filter: [
            create(FilterSchema, {
              fieldPath: { fieldName: ["id"] },
              value: AnyMessages.pack(
                CommandIdSchema,
                create(CommandIdSchema, { uuid: "wrong-id" }),
              ),
              operator: Filter_Operator.EQUAL,
            }),
          ],
          operator: CompositeFilter_CompositeOperator.ALL,
        }),
      ],
    });

    expect(() => handlers.subscribe(topic)).toThrow(
      "SubscriptionService.Subscribe field filter value must pack spine.examples.todo.TaskId.",
    );
  });

  it("keeps returned subscription mutation from changing activation tenant or topic", async () => {
    const capturedTenantKeys: (TenantId | undefined)[] = [];
    let deliverUpdate:
      | ((update: {
          readonly typeUrl: string;
          readonly id: unknown;
          readonly state: ProjectionState;
        }) => void)
      | undefined;
    const context = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: "task-cloned",
      state: createState("task-cloned", "Delivered"),
    });
    const delivered = await withTimeout(next, "clone-isolated subscription update");

    expect(capturedTenantKeys).toEqual([tenantValue("tenant-a")]);
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
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

  it("coerces a non-positive subscription queue limit", () => {
    const handlers = registeredSubscriptionHandlers(
      createFakeContext({ stateTypes: [TypeUrls.derive(ProjectionStateSchema)] }),
      { queueLimit: 0 },
    );

    expect(() => handlers.subscribe(createTopic())).not.toThrow();
  });

  it("keeps missing subscription IDs inert", async () => {
    const handlers = registeredSubscriptionHandlers(
      createFakeContext({ stateTypes: [TypeUrls.derive(ProjectionStateSchema)] }),
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

  it("keeps registry-missing and expired subscriptions inert during activation", async () => {
    for (const outcome of ["missing", "expired"] as const) {
      const context = BoundedContext.singleTenant(`Subscription-${outcome}`)
        .withSubscriptionRegistry(new InertActivationRegistry(outcome))
        .add(new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema }))
        .build();
      const handlers = registeredSubscriptionHandlers(context);

      try {
        const subscription = await handlers.subscribe(createTopic());
        await expect(
          withTimeout(
            handlers.activate(subscription)[Symbol.asyncIterator]().next(),
            `${outcome} subscription activation`,
          ),
        ).resolves.toEqual({ done: true, value: undefined });
      } finally {
        await context.close();
      }
    }
  });

  it("rejects empty subscription ID filters before activation attaches Stand delivery", () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
        type: TypeUrls.derive(ProjectionStateSchema),
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
      subscribe: (_schema, callback) => {
        deliverUpdate = callback;
        return {
          closed: false,
          unsubscribe: () => undefined,
        };
      },
    });
    const handlers = registeredSubscriptionHandlers(context);
    const id = AnyMessages.pack(TopicIdSchema, create(TopicIdSchema, { value: "packed-id" }));
    const subscription = await handlers.subscribe(
      createFilteredTopicWithCriteria({ idFilter: { id: [id] } }),
    );
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const next = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: new Uint8Array([9]),
      state: createState("task-ignored", "Ignored"),
    });
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
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
    const context = BoundedContext.singleTenant("MessageIdTasks")
      .add(repository)
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const taskId = create(TaskIdSchema, { value: "task-message-id" });
    const subscription = await handlers.subscribe(createMessageIdFilteredTopic(taskId));
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const next = iterator.next();
    const attachment = await awaitSubscriptionAttachment(context, subscription);

    await postEntityStateChanged(
      context,
      TaskSchema,
      create(TaskSchema, {
        id: create(TaskIdSchema, { value: "ignored" }),
        title: "Ignored",
      }),
    );
    await postEntityStateChanged(
      context,
      TaskSchema,
      create(TaskSchema, {
        id: taskId,
        title: "Matched",
      }),
    );

    const delivered = (await withTimeout(next, "message-id subscription")).value as
      SubscriptionUpdate | undefined;

    expect(AnyMessages.unpack(entityUpdateId(delivered) ?? packMissing(), TaskIdSchema)).toEqual(
      taskId,
    );
    expect(AnyMessages.unpack(entityUpdateKind(delivered)?.value as Any, TaskSchema)).toEqual(
      create(TaskSchema, {
        id: taskId,
        title: "Matched",
      }),
    );
    attachment.unsubscribe();
    await iterator.return?.();
  });

  it("matches message-valued subscription fields by their encoded value", async () => {
    const repository = new Repository({
      entityType: MessageIdTaskAggregate,
      schema: TaskSchema,
    });
    const context = BoundedContext.singleTenant("MessageFieldTasks")
      .add(repository)
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const taskId = create(TaskIdSchema, { value: "task-message-field" });
    const subscription = await handlers.subscribe(
      createFilteredTopicForTask({
        filter: [
          create(CompositeFilterSchema, {
            filter: [
              create(FilterSchema, {
                fieldPath: { fieldName: ["id"] },
                value: AnyMessages.pack(TaskIdSchema, taskId),
                operator: Filter_Operator.EQUAL,
              }),
            ],
            operator: CompositeFilter_CompositeOperator.ALL,
          }),
        ],
      }),
    );
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const next = iterator.next();
    const attachment = await awaitSubscriptionAttachment(context, subscription);

    await postEntityStateChanged(
      context,
      TaskSchema,
      create(TaskSchema, {
        id: create(TaskIdSchema, { value: "other-message-field" }),
        title: "Ignored",
      }),
    );
    await postEntityStateChanged(
      context,
      TaskSchema,
      create(TaskSchema, { id: clone(TaskIdSchema, taskId), title: "Matched" }),
    );

    const delivered = (await withTimeout(next, "message field subscription")).value as
      SubscriptionUpdate | undefined;

    expect(AnyMessages.unpack(entityUpdateId(delivered) ?? packMissing(), TaskIdSchema)).toEqual(
      taskId,
    );
    expect(AnyMessages.unpack(entityUpdateKind(delivered)?.value as Any, TaskSchema)).toEqual(
      create(TaskSchema, { id: taskId, title: "Matched" }),
    );
    attachment.unsubscribe();
    await iterator.return?.();
  });

  it("rejects malformed subscription ID filters before activation attaches Stand delivery", () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
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
      await postEntityStateChanged(
        context,
        ProjectionStateSchema,
        createState("task-live", "Live"),
      );
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
      expect(AnyMessages.unpack(state.value, ProjectionStateSchema)).toEqual(
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: "task-primary",
      state: createState("task-primary", "Primary"),
    });
    const delivered = await withTimeout(firstUpdate, "primary activation update");
    await duplicateIterator.return?.();
    const secondUpdate = primaryIterator.next();
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
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

  it("serializes simultaneous activation before the registry activation await", async () => {
    const registry = new GatedActivateRegistry();
    const context = BoundedContext.singleTenant("ActivationRace")
      .withSubscriptionRegistry(registry)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema }))
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createTopic());
    const first = handlers.activate(subscription)[Symbol.asyncIterator]();
    const second = handlers.activate(subscription)[Symbol.asyncIterator]();
    const firstNext = first.next();
    const secondNext = second.next();

    await registry.activationStarted;
    registry.releaseActivation();

    const duplicate = await withTimeout(secondNext, "simultaneous duplicate activation close");
    await postEntityStateChanged(context, ProjectionStateSchema, createState("race", "Delivered"));
    const primary = await withTimeout(firstNext, "simultaneous primary activation update");

    expect(duplicate.done).toBe(true);
    expect(primary.done).toBe(false);
    expect(registry.activations).toBe(1);
    await first.return?.();
    await context.close();
  });

  it("removes inactive subscription records when activation attachment fails", async () => {
    let subscribeCalls = 0;
    const context = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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

  it("surfaces attachment setup and registry cleanup failures together during activation", async () => {
    const registry = new FailingDeleteRegistry();
    const context = BoundedContext.singleTenant("SubscriptionCleanup")
      .withSubscriptionRegistry(registry)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema }))
      .build();
    const handlers = registeredSubscriptionHandlers(context);
    const subscription = await handlers.subscribe(createTopic());

    try {
      await expect(
        handlers.activate(subscription)[Symbol.asyncIterator]().next(),
      ).rejects.toMatchObject({
        message: "Subscription activation and cleanup failed.",
        errors: [
          { message: "subscription attachment setup failed" },
          { message: "subscription registry cleanup failed" },
        ],
      });
      expect(registry.deletions).toBe(1);
    } finally {
      await context.close();
    }
  });

  it("warns once when detached closed-stream cleanup rejects without changing the stream outcome", async () => {
    const registry = new RejectingDeleteRegistry();
    const context = BoundedContext.singleTenant("CleanupWarning")
      .withSubscriptionRegistry(registry)
      .add(new Repository({ entityType: TaskProjection, schema: ProjectionStateSchema }))
      .addEventDispatcher(createDomainEventDispatcher(EntityLog.EntityStateChangedSchema))
      .build();
    const warn = vi.fn(() => Promise.reject(new Error("logger rejection")));
    const withMetadata = vi.fn(() => ({ warn }));
    const services = new SpineServices({ contexts: [context], queueLimit: 1 });
    spineServicesAccess.installLogger(services, { withMetadata } as unknown as ILogLayer);
    let handlers:
      | {
          subscribe(topic: Topic): Promise<Subscription>;
          activate(subscription: Subscription): AsyncIterable<SubscriptionUpdate>;
        }
      | undefined;
    services.register({
      service(schema: unknown, implementation: unknown) {
        if (schema === SubscriptionService) handlers = implementation as typeof handlers;
        return this;
      },
    } as never);
    if (handlers === undefined) throw new Error("SubscriptionService was not registered.");
    const subscription = await handlers.subscribe(createTopic());
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const first = iterator.next();
    await delay(25);
    await postEntityStateChanged(context, ProjectionStateSchema, createState("cleanup", "First"));
    await first;
    await postEntityStateChanged(context, ProjectionStateSchema, createState("cleanup", "Second"));
    await postEntityStateChanged(context, ProjectionStateSchema, createState("cleanup", "Third"));
    await delay(25);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("Subscription cleanup failed.");
    expect(withMetadata).toHaveBeenCalledWith({
      subscriptionId: subscription.id?.value,
      operation: "service.subscription_cleanup",
      reasonCode: "cleanup_failed",
    });
    expect(registry.deletions).toBe(1);
    await iterator.return?.();
    await context.close();
  });

  it("cancels subscriptions by ID and keeps cleanup idempotent", async () => {
    const unsubscribeCounts: number[] = [];
    const callbacks: ((update: {
      readonly typeUrl: string;
      readonly id: unknown;
      readonly state: ProjectionState;
    }) => void)[] = [];
    const context = createFakeContext({
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
    const anyId = AnyMessages.pack(
      TopicIdSchema,
      create(TopicIdSchema, { value: "already-packed" }),
    );
    const bytesId = new Uint8Array([7, 8, 9]);

    await delay(25);
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: "task-first",
      state: createState("task-first", "First"),
    });
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: bytesId,
      state: createState("task-bytes", "Bytes"),
    });
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: anyId,
      state: createState("task-any", "Any"),
    });
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: true,
      state: createState("task-bool", "Bool"),
    });
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: 42,
      state: createState("task-number", "Number"),
    });
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: 9007199254740993n,
      state: createState("task-bigint", "Bigint"),
    });
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: { unsupported: true },
      state: createState("task-object", "Object"),
    });

    const firstUpdate = await withTimeout(first, "first direct subscription update");
    const secondUpdate = await withTimeout(iterator.next(), "queued direct subscription update");
    const thirdUpdate = await withTimeout(iterator.next(), "packed Any subscription update");
    const fourthUpdate = await withTimeout(iterator.next(), "boolean ID subscription update");
    const fifthUpdate = await withTimeout(iterator.next(), "number ID subscription update");
    const sixthUpdate = await withTimeout(iterator.next(), "bigint ID subscription update");
    const seventhUpdate = await withTimeout(iterator.next(), "object ID subscription update");
    const secondValue = secondUpdate.value as SubscriptionUpdate | undefined;
    const thirdValue = thirdUpdate.value as SubscriptionUpdate | undefined;
    const fourthValue = fourthUpdate.value as SubscriptionUpdate | undefined;
    const fifthValue = fifthUpdate.value as SubscriptionUpdate | undefined;
    const sixthValue = sixthUpdate.value as SubscriptionUpdate | undefined;
    const seventhValue = seventhUpdate.value as SubscriptionUpdate | undefined;

    expect(firstUpdate.done).toBe(false);
    expect(secondUpdate.done).toBe(false);
    expect(thirdUpdate.done).toBe(false);
    expect(fourthUpdate.done).toBe(false);
    expect(fifthUpdate.done).toBe(false);
    expect(sixthUpdate.done).toBe(false);
    expect(seventhUpdate.done).toBe(false);
    const firstId = entityUpdateId(firstUpdate.value as SubscriptionUpdate);
    const secondId = entityUpdateId(secondValue);
    const thirdId = entityUpdateId(thirdValue);
    const fourthId = entityUpdateId(fourthValue);
    const fifthId = entityUpdateId(fifthValue);
    const sixthId = entityUpdateId(sixthValue);
    const seventhId = entityUpdateId(seventhValue);
    if (
      firstId === undefined ||
      secondId === undefined ||
      thirdId === undefined ||
      fourthId === undefined ||
      fifthId === undefined ||
      sixthId === undefined
    ) {
      throw new Error("Expected packed update IDs.");
    }
    expect(AnyMessages.unpack(firstId, StringValueSchema)).toEqual(
      create(StringValueSchema, { value: "task-first" }),
    );
    expect(AnyMessages.unpack(secondId, BytesValueSchema)).toEqual(
      create(BytesValueSchema, { value: bytesId }),
    );
    expect(thirdId).toEqual(anyId);
    expect(AnyMessages.unpack(fourthId, BoolValueSchema)).toEqual(
      create(BoolValueSchema, { value: true }),
    );
    expect(AnyMessages.unpack(fifthId, DoubleValueSchema)).toEqual(
      create(DoubleValueSchema, { value: 42 }),
    );
    expect(AnyMessages.unpack(sixthId, Int64ValueSchema)).toEqual(
      create(Int64ValueSchema, { value: 9007199254740993n }),
    );
    expect(seventhId).toBeUndefined();
    await iterator.return?.();
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
    const handlers = registeredSubscriptionHandlers(context, {
      queueLimit: 1,
      subscriptionLimit: 1,
    });
    const subscription = await handlers.subscribe(createTopic());
    const iterator = handlers.activate(subscription)[Symbol.asyncIterator]();
    const first = iterator.next();

    await delay(25);
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: "task-one",
      state: createState("task-one", "One"),
    });
    await withTimeout(first, "first slow subscription update");
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: "task-two",
      state: createState("task-two", "Two"),
    });
    deliverUpdate?.({
      typeUrl: TypeUrls.derive(ProjectionStateSchema),
      id: "task-three",
      state: createState("task-three", "Three"),
    });

    const next = await withTimeout(iterator.next(), "closed slow subscription");

    expect(next.done).toBe(true);
    expect(unsubscribeCount).toBe(1);
    await expect(handlers.subscribe(createTopic())).resolves.toBeDefined();
  });

  it("releases subscription capacity after activation attachment fails", async () => {
    const handlers = registeredSubscriptionHandlers(
      createFakeContext({
        stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
        subscribe: () => {
          throw new Error("activation failed");
        },
      }),
      { subscriptionLimit: 1 },
    );
    const subscription = await handlers.subscribe(createTopic());

    await expect(handlers.activate(subscription)[Symbol.asyncIterator]().next()).rejects.toThrow(
      "activation failed",
    );
    await expect(handlers.subscribe(createTopic())).resolves.toBeDefined();
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
      stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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
          type: TypeUrls.derive(ProjectionStateSchema),
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
      type: TypeUrls.derive(ProjectionStateSchema),
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
            type: TypeUrls.derive(ProjectionStateSchema),
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
  const handlers = EntityHandlers.define(TaskProjection, ProjectionStateSchema, (builder) => [
    builder.subscribe(TaskCreatedSchema, "subscribeTask"),
  ]);

  return new Repository({
    entityType: TaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createRejectingRepository(): Repository<typeof RejectingTaskAggregate> {
  const handlers = EntityHandlers.define(
    RejectingTaskAggregate,
    AggregateStateSchema,
    (builder) => [builder.assign(AggregateStateSchema, "assignTask")],
  );

  return new Repository({
    entityType: RejectingTaskAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createValidatingRepository(): Repository<typeof ValidatingTaskAggregate> {
  const handlers = EntityHandlers.define(
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
  const handlers = EntityHandlers.define(
    TransitionViolatingTaskAggregate,
    AggregateStateSchema,
    (builder) => [builder.assign(AggregateStateSchema, "assignTask")],
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
  const handlers = EntityHandlers.define(
    RollingBackTransitionTaskAggregate,
    AggregateStateSchema,
    (builder) => [builder.assign(AggregateStateSchema, "assignTask")],
  );

  return new Repository({
    entityType: RollingBackTransitionTaskAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createProjectionCommand(id: string, tenantId?: TenantInput, name = "Task") {
  return SignalEnvelopes.command({
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(tenantId),
    }),
    schema: ProjectionStateSchema,
    message: createState("task-1", name),
  });
}

function createAggregateCommand(id: string, aggregateId: string, name = "Task") {
  return SignalEnvelopes.command({
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
    message: AnyMessages.pack(
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
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: id }),
    context: createEventContext(aggregateId, tenantId),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: aggregateId,
      name,
      archived: false,
    }),
  });
}

function createPastMessageAggregateEvent(id: string, tenantId: string) {
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      origin: {
        case: "pastMessage",
        value: create(OriginSchema, { actorContext: createActorContext(tenantId) }),
      },
    }),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: `aggregate-${id}`,
      name: "Past message",
      archived: false,
    }),
  });
}

function createRejectionEvent(
  command: ReturnType<typeof createAggregateCommand>,
  stacktrace: string,
) {
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: "event-rejected" }),
    context: create(EventContextSchema, {
      timestamp: create(TimestampSchema, { seconds: 123n, nanos: 456 }),
      origin: {
        case: "importContext",
        value: createActorContext("tenant-rejected"),
      },
      producerId: AnyMessages.pack(
        StringValueSchema,
        create(StringValueSchema, { value: "producer-1" }),
      ),
      rejection: create(RejectionEventContextSchema, {
        command,
        commandMessage: AnyMessages.pack(
          StringValueSchema,
          create(StringValueSchema, { value: "legacy rejected command payload" }),
        ),
        stacktrace,
      }),
    }),
    schema: TaskAlreadyDoneSchema,
    message: create(TaskAlreadyDoneSchema, {
      id: create(GeneratedTaskIdSchema, { value: "task-rejected" }),
    }),
  });
}

function createEventContext(producerId: string, tenantId?: TenantInput) {
  const context = create(EventContextSchema, {
    producerId: AnyMessages.pack(
      StringValueSchema,
      create(StringValueSchema, { value: producerId }),
    ),
  });

  if (tenantId !== undefined) {
    context.origin = {
      case: "importContext",
      value: createActorContext(tenantId),
    };
  }

  return context;
}

function createValidatedEvent(id: string, aggregateId: string, name: string) {
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(
        StringValueSchema,
        create(StringValueSchema, { value: aggregateId }),
      ),
    }),
    schema: ValidatedAggregateStateSchema,
    message: create(ValidatedAggregateStateSchema, {
      id: aggregateId,
      name,
    }),
  });
}

function createProjectionEvent(id: string, entityId: string) {
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(
        StringValueSchema,
        create(StringValueSchema, { value: entityId }),
      ),
      version: create(VersionSchema, { number: 1 }),
    }),
    schema: TaskCreatedSchema,
    message: create(TaskCreatedSchema, {
      id: create(GeneratedTaskIdSchema, { value: entityId }),
      title: "Task",
      taskListId: create(TodoTaskListIdSchema, { value: entityId }),
    }),
  });
}

function createCommandWithoutId() {
  return create(CommandSchema, {
    message: AnyMessages.pack(ProjectionStateSchema, createState("task-1", "Task")),
    context: create(CommandContextSchema, {
      actorContext: createActorContext(),
    }),
  });
}

function createQuery(id: string, tenantId?: TenantInput) {
  return createQueryWithIds([packStringId(id)], tenantId);
}

function createQueryWithIds(ids: ReturnType<typeof AnyMessages.pack>[], tenantId?: TenantInput) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "q-1" }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(ProjectionStateSchema),
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

function createMessageIdQuery(id: TaskId, incompatibleId?: ReturnType<typeof AnyMessages.pack>) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "q-message-id" }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(TaskSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: { id: [incompatibleId ?? AnyMessages.pack(TaskIdSchema, id)] },
        }),
      },
    }),
    context: createActorContext(),
  });
}

function createColumnFilterQuery(
  column = "name",
  value: ReturnType<typeof AnyMessages.pack> = packStringId("First"),
  options: {
    readonly operator?: Filter_Operator;
    readonly compositeOperator?: CompositeFilter_CompositeOperator;
    readonly nested?: boolean;
  } = {},
) {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "q-column-filter" }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(ProjectionStateSchema),
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
                        filter: [
                          create(FilterSchema, {
                            fieldPath: { fieldName: [column] },
                            value,
                            operator: options.operator ?? Filter_Operator.EQUAL,
                          }),
                        ],
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
  value: ReturnType<typeof AnyMessages.pack>,
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
      type: TypeUrls.derive(ProjectionStateSchema),
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

function createEventTopic(tenantId?: TenantInput, schema: MessageSchema = AggregateStateSchema) {
  return create(TopicSchema, {
    id: create(TopicIdSchema, { value: "t-event" }),
    target: createEventSubscriptionTarget(schema),
    context: createActorContext(tenantId),
  });
}

function createSubscriptionTarget() {
  return create(TargetSchema, {
    type: TypeUrls.derive(ProjectionStateSchema),
    criterion: {
      case: "includeAll",
      value: true,
    },
  });
}

function createEventSubscriptionTarget(schema: MessageSchema = AggregateStateSchema) {
  return create(TargetSchema, {
    type: TypeUrls.derive(schema),
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
      type: TypeUrls.derive(ProjectionStateSchema),
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
      type: TypeUrls.derive(ProjectionStateSchema),
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
      type: TypeUrls.derive(TaskSchema),
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
    idFilter: { id: [AnyMessages.pack(TaskIdSchema, id)] },
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

async function postEntityStateChanged(
  context: BoundedContext,
  schema: MessageSchema,
  state: Message,
): Promise<void> {
  const id = (state as Record<string, unknown>)[schema.fields[0]?.localName ?? "id"];
  const idSchema = schema.fields[0]?.message as MessageSchema | undefined;
  const packedId =
    idSchema !== undefined && id !== undefined
      ? AnyMessages.pack(idSchema, id as never, { validate: false })
      : AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: String(id) }));
  await (
    boundedContextAccess as unknown as {
      postSystemEvent(context: BoundedContext, event: Event): Promise<void>;
    }
  ).postSystemEvent(
    context,
    create(EventSchema, {
      id: { value: `state-change-${String(++stateChangeSequence)}` },
      message: AnyMessages.pack(
        EntityLog.EntityStateChangedSchema,
        create(EntityLog.EntityStateChangedSchema, {
          entity: { id: packedId, typeUrl: TypeUrls.derive(schema) },
          newState: AnyMessages.pack(schema, state, { validate: false }),
          signalId: [
            {
              id: AnyMessages.pack(
                StringValueSchema,
                create(StringValueSchema, { value: "test-signal" }),
              ),
              typeUrl: TypeUrls.derive(StringValueSchema),
            },
          ],
        }),
      ),
    }),
  );
}

function packStringId(id: string) {
  return AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id }));
}

function packInt32(value: number) {
  return AnyMessages.pack(Int32ValueSchema, create(Int32ValueSchema, { value }));
}

function packBytes(value: Uint8Array) {
  return AnyMessages.pack(BytesValueSchema, create(BytesValueSchema, { value }));
}

function unpackProjectionState(state: Any | undefined) {
  return AnyMessages.unpack(state ?? packMissing(), ProjectionStateSchema);
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
  return AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: "missing" }));
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

  return AnyMessages.unpack(
    value.details as Parameters<typeof AnyMessages.unpack>[0],
    ValidationErrorSchema,
  );
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
    stateTypes: [TypeUrls.derive(ProjectionStateSchema)],
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

class GatedActivateRegistry extends InMemorySubscriptionRegistry {
  activations = 0;
  #release: (() => void) | undefined;
  #started: (() => void) | undefined;
  readonly activationStarted = new Promise<void>((resolve) => {
    this.#started = resolve;
  });

  releaseActivation(): void {
    this.#release?.();
  }

  override async activate(id: Parameters<InMemorySubscriptionRegistry["activate"]>[0]) {
    this.activations += 1;
    this.#started?.();
    await new Promise<void>((resolve) => {
      this.#release = resolve;
    });
    return await super.activate(id);
  }
}

class InertActivationRegistry extends InMemorySubscriptionRegistry {
  constructor(private readonly outcome: "missing" | "expired") {
    super();
  }

  override activate(
    id: Parameters<InMemorySubscriptionRegistry["activate"]>[0],
  ): ReturnType<InMemorySubscriptionRegistry["activate"]> {
    void id;
    return Promise.resolve(Object.freeze({ kind: this.outcome }));
  }
}

class FailingDeleteRegistry extends InMemorySubscriptionRegistry {
  deletions = 0;

  override delete(
    id: Parameters<InMemorySubscriptionRegistry["delete"]>[0],
  ): ReturnType<InMemorySubscriptionRegistry["delete"]> {
    void id;
    this.deletions += 1;
    return Promise.reject(new Error("subscription registry cleanup failed"));
  }

  override cleanup(): ReturnType<InMemorySubscriptionRegistry["cleanup"]> {
    return Promise.reject(new Error("subscription attachment setup failed"));
  }
}

class RejectingDeleteRegistry extends InMemorySubscriptionRegistry {
  deletions = 0;

  override delete(
    id: Parameters<InMemorySubscriptionRegistry["delete"]>[0],
  ): ReturnType<InMemorySubscriptionRegistry["delete"]> {
    void id;
    this.deletions += 1;
    return Promise.reject(new Error("subscription registry cleanup failed"));
  }
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
    options: { readonly tenantId?: TenantId },
  ) => Promise<{ readonly state: ProjectionState; readonly version?: unknown } | undefined>;
  readonly readAllVersioned?: (
    schema: typeof ProjectionStateSchema,
    options: { readonly tenantId?: TenantId },
  ) => Promise<readonly { readonly state: ProjectionState; readonly version?: unknown }[]>;
  readonly queryVersioned?: (
    schema: typeof ProjectionStateSchema,
    query: unknown,
    options: { readonly tenantId?: TenantId },
  ) => Promise<readonly { readonly state: ProjectionState; readonly version?: unknown }[]>;
  readonly subscribe?: (
    schema: typeof ProjectionStateSchema,
    callback: (update: {
      readonly typeUrl: string;
      readonly id: unknown;
      readonly previousState?: ProjectionState;
      readonly state: ProjectionState;
    }) => void,
    options: { readonly tenantId?: TenantId },
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
        queryPlanVersioned: queryVersioned ?? (() => Promise.resolve([])),
      }),
  } as unknown as BoundedContext;
}

function createFakeQueryVersioned(options: {
  readonly readVersioned?: (
    schema: typeof ProjectionStateSchema,
    id: unknown,
    options: { readonly tenantId?: TenantId },
  ) => Promise<{ readonly state: ProjectionState; readonly version?: unknown } | undefined>;
  readonly readAllVersioned?: (
    schema: typeof ProjectionStateSchema,
    options: { readonly tenantId?: TenantId },
  ) => Promise<readonly { readonly state: ProjectionState; readonly version?: unknown }[]>;
}) {
  if (options.readVersioned !== undefined) {
    const readVersioned = options.readVersioned;
    return async (
      schema: typeof ProjectionStateSchema,
      query: { readonly ids?: readonly unknown[]; readonly predicate?: unknown },
      readOptions: { readonly tenantId?: TenantId },
    ) => {
      const results = await Promise.all(
        (query.ids ?? normalizedTestIds(query.predicate)).map((id) =>
          readVersioned(schema, id, readOptions),
        ),
      );

      return results.filter((result) => result !== undefined);
    };
  }

  return options.readAllVersioned === undefined
    ? undefined
    : (
        schema: typeof ProjectionStateSchema,
        _query: unknown,
        readOptions: { readonly tenantId?: TenantId },
      ) => options.readAllVersioned?.(schema, readOptions);
}

function normalizedTestIds(predicate: unknown): readonly unknown[] {
  if (typeof predicate !== "object" || predicate === null) return [];
  if (Reflect.get(predicate, "kind") === "ids") {
    const ids: unknown = Reflect.get(predicate, "ids");
    return Array.isArray(ids) ? ids : [];
  }
  const predicates: unknown = Reflect.get(predicate, "predicates");
  if (!Array.isArray(predicates)) return [];
  return predicates.flatMap(normalizedTestIds);
}

function registeredCommandHandlers(
  context: BoundedContext,
  options: Omit<ConstructorParameters<typeof SpineServices>[0], "contexts"> = {},
) {
  return registeredCommandHandlersFor([context], options);
}

function registeredCommandHandlersFor(
  contexts: readonly BoundedContext[],
  options: Omit<ConstructorParameters<typeof SpineServices>[0], "contexts"> = {},
) {
  let handlers:
    | {
        post(command: ReturnType<typeof createProjectionCommand>): Promise<Ack>;
      }
    | undefined;
  const services = new SpineServices({ contexts, ...options });

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

async function awaitSubscriptionAttachment(context: BoundedContext, subscription: Subscription) {
  const id = subscription.id;
  if (id === undefined) throw new Error("Expected a subscription ID.");
  const registry = boundedContextAccess.subscriptionRegistry(context);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const entry = await registry.get(id);
    if (entry?.phase === "active") {
      return await boundedContextAccess.consumeSubscription(context, id.value, () => undefined);
    }
    await Promise.resolve();
  }

  throw new Error("Subscription did not become active.");
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

async function waitForStoredEvents(eventStore: EventStore, count: number) {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const events = await eventStore.read();
    if (events.length >= count) {
      return events;
    }
    await delay(5);
  }
  return await eventStore.read();
}
