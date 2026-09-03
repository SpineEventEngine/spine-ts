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

import { clone, create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  type Any,
  AnySchema,
  BoolValueSchema,
  DoubleValueSchema,
  DescriptorProtoSchema,
  FieldDescriptorProto_Label,
  FieldDescriptorProtoSchema,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  Int32ValueSchema,
  Int64ValueSchema,
  StringValueSchema,
  TimestampSchema,
} from "@bufbuild/protobuf/wkt";
import {
  TypeUrls,
  AnyMessages,
  Identifiers,
  MessageInterfaces,
  SignalEnvelopes,
  StringifierRegistry,
} from "@spine-event-engine/core";
import {
  ActorContextSchema,
  type Command as SpineCommand,
  type CommandContext,
  CommandSchema,
  CommandContextSchema,
  CommandIdSchema,
  EmailAddressSchema,
  type EventContext,
  type Event as SpineEvent,
  EventContextSchema,
  EventIdSchema,
  EventSchema,
  InternetDomainSchema,
  MessageIdSchema,
  OriginSchema,
  TenantIdSchema,
  type TenantId,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-event-engine/proto";
import type { UserId } from "@spine-event-engine/proto";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { TaskListSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_list_pb.js";
import { TaskAlreadyDone } from "../../../../examples/todo/generated/spine/examples/todo/task_rejections.js";
import {
  type TaskAlreadyDone as TaskAlreadyDoneMessage,
  TaskAlreadyDoneSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_rejections_pb.js";
import {
  TaskIdSchema as TodoIdSchema,
  TaskListIdSchema as TodoTaskListIdSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js";
import * as TodoEvents from "../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js";
import { TaskSchema as TodoTaskSchema } from "../../../../examples/todo/generated/spine/examples/todo/tasks_pb.js";
import {
  EventStore,
  InMemoryStorageFactory,
  ColumnTypes,
  RecordColumn,
  RecordStorage,
  type RecordSpec,
  type StorageContext,
} from "@spine-event-engine/storage";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
import type { EntityRecord } from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";
import type {
  EntityCommitInput,
  EntityCommitResult,
  EntityCommitStorage,
} from "@spine-event-engine/storage/provider";
import {
  CommandDispatchedToHandlerSchema,
  EntityArchivedSchema,
  EntityCreatedSchema,
  EntityDeletedSchema,
  EntityRestoredSchema,
  EntityStateChangedSchema,
  EntityUnarchivedSchema,
  EventDispatchedToSubscriberSchema,
  EventDispatchedToReactorSchema,
} from "@spine-event-engine/proto/generated/spine/system/server/entity_log_events_pb.js";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { ILogLayer } from "loglayer";

import {
  Aggregate,
  BoundedContext,
  CommandRouting,
  EventRouting,
  ProcessManager,
  Projection,
  Repository,
  type RepositoryOptions,
  RepositoryIdentityError,
  ShardIndex,
  EntityHandlers,
  HandlerRegistryIngestor,
  type EntityHandlersMetadata,
  type EventDispatcher,
  type InboxMessage,
  SpecScanner,
  StateUpdateRouting,
} from "../../src/index.js";
import { boundedContextAccess } from "../../src/context/bounded-context.js";
import { CommandValidationError } from "../../src/bus/command-errors.js";
import { HandlerMetadataValues } from "../../src/handler/handler-metadata.js";
import { Delivery } from "../../src/delivery/delivery.js";
import { InboxTargets } from "../../src/delivery/inbox.js";
import { describeEntityMetadata } from "../../src/entity/entity-metadata.js";
import {
  EntityRecords,
  entityStorageDescriptor,
  standEntityStorageDescriptor,
} from "../../src/entity/entity-storage-descriptor.js";
import { standAccess } from "../../src/stand/stand.js";
import { SystemClock } from "../../src/runtime/signal-metadata.js";
import { repositoryAccess, type RepositoryView } from "../../src/repository/repository.js";
import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

const GeneratedTaskIdSchema = TodoIdSchema;

type ProjectionState = Message<"ProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type NeutralProjectionState = Message<"NeutralProjectionState"> & {
  id: string;
  name: string;
  priority: number;
};

type ProjectionEvent = Message<"ProjectionEvent"> & {
  id: string;
  name: string;
  priority: number;
};

type ImplicitTaskCommand = Message<"ImplicitTaskCommand"> & {
  id: string;
  name: string;
  priority: number;
};

type AggregateState = Message<"AggregateState"> & {
  id: string;
  name: string;
  archived: boolean;
};

type Int32AggregateState = Message<"Int32AggregateState"> & {
  id: number;
  name: string;
};

type Int64ProcessManagerState = Message<"Int64ProcessManagerState"> & {
  id: bigint;
  queue: string;
};

type RepeatedIdCommand = Message<"RepeatedIdCommand"> & {
  id: string[];
};

type MapIdCommand = Message<"MapIdCommand"> & {
  id: Record<string, string>;
};

type ProcessManagerState = Message<"ProcessManagerState"> & {
  id: string;
  queue: string;
};

type ValidatedAggregateState = Message<"example.validation_refusal.ValidatedAggregateState"> & {
  id: string;
  name: string;
};

type ValidatedTaskCommand = Message<"example.validation_refusal.ValidatedTaskCommand"> & {
  id: string;
  name: string;
};

type TaskId = Message<"spine.examples.todo.TaskId"> & {
  value: string;
};

type Task = Message<"spine.examples.todo.Task"> & {
  id?: TaskId;
  taskListId?: TaskListId;
  title: string;
  completed: boolean;
};

type TaskCreated = Message<"spine.examples.todo.TaskCreated"> & {
  id?: TaskId;
  title: string;
  taskListId?: TaskListId;
};

type TaskListId = Message<"spine.examples.todo.TaskListId"> & {
  value: string;
};

type Int64ProjectionId = Message<"Int64ProjectionId"> & {
  value: bigint;
};

type Int64MessageIdProjectionState = Message<"Int64MessageIdProjectionState"> & {
  id?: Int64ProjectionId;
  name: string;
};

type Int64MessageIdSourceState = Message<"Int64MessageIdSourceState"> & {
  id?: Int64ProjectionId;
  name: string;
};

type Int64MessageIdProjectionEvent = Message<"Int64MessageIdProjectionEvent"> & {
  id?: Int64ProjectionId;
  name: string;
};

type CompositeRouteId = Message<"CompositeRouteId"> & {
  reader?: UserId;
  number: number;
};

type CompositeRouteState = Message<"CompositeRouteState"> & {
  id?: CompositeRouteId;
  name: string;
};

type CompositeRouteEvent = Message<"CompositeRouteEvent"> & {
  id?: CompositeRouteId;
  name: string;
};

type CompositeRouteSourceState = Message<"CompositeRouteSourceState"> & {
  id?: CompositeRouteId;
  name: string;
};

type CompositeRouteProcessManagerState = Message<"CompositeRouteProcessManagerState"> & {
  id?: CompositeRouteId;
  queue: string;
};

type NumberRouteEvent = Message<"spine_ts.test.NumberRouteEvent"> & {
  id: number;
};

type WrongIdRouteEvent = Message<"spine_ts.test.WrongIdRouteEvent"> & {
  id?: UserId;
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
const fileProjectionEventFixture = (() => {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const source = descriptorSet.file[0];
  const state = source?.messageType[0];
  if (source === undefined || state === undefined) {
    throw new Error("Entity metadata fixture ProjectionState declaration is missing.");
  }
  const descriptor = clone(FileDescriptorProtoSchema, source);
  const event = descriptor.messageType[0];
  if (event === undefined) throw new Error("Projection Event fixture declaration is missing.");
  descriptor.name = "projection_event.proto";
  descriptor.messageType = [event];
  event.name = "ProjectionEvent";
  if (event.options !== undefined) {
    event.options.$unknown = event.options.$unknown?.filter((field) => field.no !== 73_903);
  }
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
})();
const fileNeutralProjectionStateFixture = (() => {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const source = descriptorSet.file[0];
  const state = source?.messageType[0];
  if (source === undefined || state === undefined) {
    throw new Error("Neutral ProjectionState fixture declaration is missing.");
  }
  const descriptor = clone(FileDescriptorProtoSchema, source);
  const neutral = descriptor.messageType[0];
  if (neutral === undefined) throw new Error("Neutral ProjectionState fixture is missing.");
  descriptor.name = "neutral_projection_state.proto";
  descriptor.messageType = [neutral];
  neutral.name = "NeutralProjectionState";
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
})();
const fileImplicitCommandFixture = (() => {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const source = descriptorSet.file[0];
  const state = source?.messageType[0];
  if (source === undefined || state === undefined) {
    throw new Error("Implicit Command fixture declaration is missing.");
  }
  const descriptor = clone(FileDescriptorProtoSchema, source);
  const command = descriptor.messageType[0];
  if (command === undefined) throw new Error("Implicit Command fixture is missing.");
  descriptor.name = "implicit_commands.proto";
  descriptor.messageType = [command];
  command.name = "ImplicitTaskCommand";
  if (command.options !== undefined) {
    command.options.$unknown = command.options.$unknown?.filter((field) => field.no !== 73_903);
  }
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
})();
const fileInt64MessageIdFixture = (() => {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const source = descriptorSet.file[0];
  if (source === undefined) throw new Error("Entity metadata fixture descriptor set is empty.");
  const descriptor = clone(FileDescriptorProtoSchema, source);
  const id = descriptor.messageType[8];
  const value = id?.field[0];
  const state = descriptor.messageType[9];
  if (id === undefined || value === undefined || state === undefined) {
    throw new Error("Entity metadata fixture message-ID declarations are missing.");
  }
  id.name = "Int64ProjectionId";
  value.type = FieldDescriptorProto_Type.INT64;
  state.name = "Int64MessageIdProjectionState";
  const idField = state.field[0];
  if (idField === undefined) throw new Error("Message-ID state ID field is missing.");
  idField.typeName = ".Int64ProjectionId";
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
})();
const fileInt64MessageIdEventFixture = (() => {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const source = descriptorSet.file[0];
  if (source === undefined) throw new Error("Entity metadata fixture descriptor set is empty.");
  const descriptor = clone(FileDescriptorProtoSchema, source);
  const id = descriptor.messageType[8];
  const value = id?.field[0];
  const event = descriptor.messageType[9];
  if (id === undefined || value === undefined || event === undefined) {
    throw new Error("Message-ID Event fixture declarations are missing.");
  }
  descriptor.name = "int64_projection_event.proto";
  descriptor.messageType = [id, event];
  id.name = "Int64ProjectionId";
  value.type = FieldDescriptorProto_Type.INT64;
  event.name = "Int64MessageIdProjectionEvent";
  const idField = event.field[0];
  if (idField === undefined) throw new Error("Message-ID Event ID field is missing.");
  idField.typeName = ".Int64ProjectionId";
  if (event.options !== undefined) {
    event.options.$unknown = event.options.$unknown?.filter((field) => field.no !== 73_903);
  }
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
  ]);
})();
const fileInt64MessageIdSourceFixture = (() => {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const source = descriptorSet.file[0];
  if (source === undefined) throw new Error("Entity metadata fixture descriptor set is empty.");
  const descriptor = clone(FileDescriptorProtoSchema, source);
  const state = descriptor.messageType[9];
  if (state === undefined) throw new Error("Message-ID source state declaration is missing.");
  descriptor.name = "int64_message_id_source.proto";
  descriptor.dependency = [source.name];
  descriptor.messageType = [state];
  state.name = "Int64MessageIdSourceState";
  const idField = state.field[0];
  if (idField === undefined) throw new Error("Message-ID source state ID field is missing.");
  idField.typeName = ".Int64ProjectionId";
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    fileInt64MessageIdFixture,
  ]);
})();
const fileCompositeRouteFixture = (() => {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const source = descriptorSet.file[0];
  if (source === undefined) throw new Error("Entity metadata fixture descriptor set is empty.");
  const descriptor = clone(FileDescriptorProtoSchema, source);
  const id = descriptor.messageType[8];
  const state = descriptor.messageType[9];
  if (id === undefined || state === undefined) {
    throw new Error("Composite message-ID fixture declarations are missing.");
  }
  const originalIdField = id.field[0];
  if (originalIdField === undefined) throw new Error("Composite ID field is missing.");
  id.name = "CompositeRouteId";
  id.field = [
    create(FieldDescriptorProtoSchema, {
      ...clone(FieldDescriptorProtoSchema, originalIdField),
      name: "reader",
      number: 1,
      label: FieldDescriptorProto_Label.OPTIONAL,
      type: FieldDescriptorProto_Type.MESSAGE,
      typeName: ".spine.core.UserId",
      jsonName: "reader",
    }),
    create(FieldDescriptorProtoSchema, {
      name: "number",
      number: 2,
      label: FieldDescriptorProto_Label.OPTIONAL,
      type: FieldDescriptorProto_Type.INT32,
      jsonName: "number",
    }),
  ];
  state.name = "CompositeRouteState";
  const stateId = state.field[0];
  if (stateId === undefined) throw new Error("Composite state ID field is missing.");
  stateId.typeName = ".CompositeRouteId";
  const event = clone(DescriptorProtoSchema, state);
  event.name = "CompositeRouteEvent";
  event.options = undefined;
  const sourceState = clone(DescriptorProtoSchema, state);
  sourceState.name = "CompositeRouteSourceState";
  descriptor.messageType.push(event, sourceState);
  descriptor.dependency.push(UserIdSchema.file.proto.name);
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
    UserIdSchema.file,
  ]);
})();
const ProjectionStateSchema = messageDesc(
  fileEntityMetadataFixture,
  0,
) as GenMessage<ProjectionState>;
const NeutralProjectionStateSchema = messageDesc(
  fileNeutralProjectionStateFixture,
  0,
) as GenMessage<NeutralProjectionState>;
const ProjectionEventSchema = messageDesc(
  fileProjectionEventFixture,
  0,
) as GenMessage<ProjectionEvent>;
const ImplicitTaskCommandSchema = messageDesc(
  fileImplicitCommandFixture,
  0,
) as GenMessage<ImplicitTaskCommand>;
const AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  1,
) as GenMessage<AggregateState>;
const Int32AggregateStateSchema = messageDesc(
  fileEntityMetadataFixture,
  10,
) as GenMessage<Int32AggregateState>;
const Int64ProcessManagerStateSchema = messageDesc(
  fileEntityMetadataFixture,
  11,
) as GenMessage<Int64ProcessManagerState>;
const RepeatedIdCommandSchema = messageDesc(
  fileEntityMetadataFixture,
  12,
) as GenMessage<RepeatedIdCommand>;
const MapIdCommandSchema = messageDesc(fileEntityMetadataFixture, 13) as GenMessage<MapIdCommand>;
const fileEntityVisibilityFixture = createFixtureFileDescriptor(
  serverEntityMetadataTestFixtures.visibility.descriptorSetBase64,
);
const ProcessManagerStateSchema = messageDesc(
  fileEntityVisibilityFixture,
  0,
) as GenMessage<ProcessManagerState>;
const fileCompositeRouteProcessManagerFixture = (() => {
  const descriptor = clone(FileDescriptorProtoSchema, ProcessManagerStateSchema.file.proto);
  const state = descriptor.messageType[0];
  if (state === undefined) throw new Error("Process-manager state declaration is missing.");
  const stateId = state.field[0];
  if (stateId === undefined) throw new Error("Process-manager state ID field is missing.");
  descriptor.name = "composite_route_process_manager.proto";
  descriptor.dependency.push(fileCompositeRouteFixture.proto.name);
  state.name = "CompositeRouteProcessManagerState";
  stateId.type = FieldDescriptorProto_Type.MESSAGE;
  stateId.typeName = ".CompositeRouteId";
  return fileDesc(Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"), [
    file_spine_options,
    fileCompositeRouteFixture,
  ]);
})();
const CompositeRouteProcessManagerStateSchema = messageDesc(
  fileCompositeRouteProcessManagerFixture,
  0,
) as GenMessage<CompositeRouteProcessManagerState>;
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
const fileTaskEventsFixture = TodoEvents.TaskCreatedSchema.file;
const fileNumberRouteFixture = fileDesc(
  Buffer.from(
    toBinary(
      FileDescriptorProtoSchema,
      create(FileDescriptorProtoSchema, {
        name: "spine_ts/test/number_route.proto",
        package: "spine_ts.test",
        syntax: "proto3",
        messageType: [
          {
            name: "NumberRouteEvent",
            field: [
              {
                name: "id",
                number: 1,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.DOUBLE,
                jsonName: "id",
              },
            ],
          },
        ],
      }),
    ),
  ).toString("base64"),
);
const fileWrongIdRouteFixture = fileDesc(
  Buffer.from(
    toBinary(
      FileDescriptorProtoSchema,
      create(FileDescriptorProtoSchema, {
        name: "spine_ts/test/wrong_id_route.proto",
        package: "spine_ts.test",
        syntax: "proto3",
        messageType: [
          {
            name: "WrongIdRouteEvent",
            field: [
              {
                name: "id",
                number: 1,
                label: FieldDescriptorProto_Label.OPTIONAL,
                type: FieldDescriptorProto_Type.MESSAGE,
                typeName: ".spine.core.UserId",
                jsonName: "id",
              },
            ],
          },
        ],
      }),
    ),
  ).toString("base64"),
  [UserIdSchema.file],
);
const TaskIdSchema = messageDesc(fileTaskIdFixture, 0) as GenMessage<TaskId>;
const TaskSchema = messageDesc(fileTaskFixture, 0) as GenMessage<Task>;
const TaskCreatedSchema = messageDesc(fileTaskEventsFixture, 0) as GenMessage<TaskCreated>;
const NumberRouteEventSchema = messageDesc(
  fileNumberRouteFixture,
  0,
) as GenMessage<NumberRouteEvent>;
const WrongIdRouteEventSchema = messageDesc(
  fileWrongIdRouteFixture,
  0,
) as GenMessage<WrongIdRouteEvent>;
const Int64ProjectionIdSchema = messageDesc(
  fileInt64MessageIdFixture,
  8,
) as GenMessage<Int64ProjectionId>;
const Int64MessageIdProjectionStateSchema = messageDesc(
  fileInt64MessageIdFixture,
  9,
) as GenMessage<Int64MessageIdProjectionState>;
const Int64MessageIdSourceStateSchema = messageDesc(
  fileInt64MessageIdSourceFixture,
  0,
) as GenMessage<Int64MessageIdSourceState>;
const Int64MessageIdProjectionEventSchema = messageDesc(
  fileInt64MessageIdEventFixture,
  1,
) as GenMessage<Int64MessageIdProjectionEvent>;
const CompositeRouteIdSchema = messageDesc(
  fileCompositeRouteFixture,
  8,
) as GenMessage<CompositeRouteId>;
const CompositeRouteStateSchema = messageDesc(
  fileCompositeRouteFixture,
  9,
) as GenMessage<CompositeRouteState>;
const CompositeRouteEventSchema = messageDesc(
  fileCompositeRouteFixture,
  14,
) as GenMessage<CompositeRouteEvent>;
const CompositeRouteSourceStateSchema = messageDesc(
  fileCompositeRouteFixture,
  15,
) as GenMessage<CompositeRouteSourceState>;

class TaskAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(command: AggregateState): void {
    void command;
  }

  reactToProjection(event: ProjectionEvent): void {
    void event;
  }
}

class ImplicitIdAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static calls = 0;

  static reset(): void {
    this.calls = 0;
  }

  assign(command: ImplicitTaskCommand): void {
    void command;
    ImplicitIdAggregate.calls += 1;
  }
}

class BlankStateIdAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static calls = 0;

  assign(command: AggregateState): void {
    this.update((draft) => Object.assign(draft, command, { id: "" }));
    BlankStateIdAggregate.calls += 1;
  }
}

class BlankStateIdProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  static calls = 0;

  assign(command: AggregateState): void {
    this.update((draft) => {
      draft.id = "";
      draft.queue = command.name;
    });
    BlankStateIdProcessManager.calls += 1;
  }
}

class BlankStateIdProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static calls = 0;

  subscribe(event: ProjectionEvent): void {
    this.update((draft) => {
      draft.id = "";
      draft.name = event.name;
    });
    BlankStateIdProjection.calls += 1;
  }
}

class Int64MessageIdProjection extends Projection<
  Int64ProjectionId,
  typeof Int64MessageIdProjectionStateSchema,
  number
> {
  static calls = 0;

  subscribeState(event: Int64MessageIdProjectionEvent): void {
    void event;
    Int64MessageIdProjection.calls += 1;
  }
}

class CompositeRouteProjection extends Projection<
  CompositeRouteId,
  typeof CompositeRouteStateSchema,
  number
> {
  assign(command: CompositeRouteEvent): void {
    this.update((draft) => Object.assign(draft, command));
  }

  subscribe(event: CompositeRouteEvent | CompositeRouteSourceState): void {
    this.update((draft) => Object.assign(draft, event));
  }
}

class CompositeRouteProcessManager extends ProcessManager<
  CompositeRouteId,
  typeof CompositeRouteProcessManagerStateSchema,
  number
> {
  static calls = 0;
  static ids: CompositeRouteId[] = [];

  static reset(): void {
    this.calls = 0;
    this.ids = [];
  }

  react(event: CompositeRouteEvent): void {
    CompositeRouteProcessManager.calls += 1;
    CompositeRouteProcessManager.ids.push(this.id);
    this.update((draft) =>
      Object.assign(
        draft,
        create(CompositeRouteProcessManagerStateSchema, {
          id: this.id,
          queue: event.name,
        }),
      ),
    );
  }

  assignAndProduce(command: CompositeRouteEvent): CompositeRouteEvent {
    this.update((draft) =>
      Object.assign(
        draft,
        create(CompositeRouteProcessManagerStateSchema, {
          id: this.id,
          queue: command.name,
        }),
      ),
    );
    return create(CompositeRouteEventSchema, {
      id: this.id,
      name: `${command.name} produced`,
    });
  }
}

class Int32RoutingAggregate extends ProcessManager<
  number,
  typeof Int32AggregateStateSchema,
  number
> {
  assign(command: Int32AggregateState): void {
    this.update((draft) => Object.assign(draft, command));
  }

  react(event: Int32AggregateState): void {
    void event;
  }
}

class Int64RoutingProcessManager extends ProcessManager<
  bigint,
  typeof Int64ProcessManagerStateSchema,
  number
> {
  assign(command: Int64ProcessManagerState): void {
    this.update((draft) => Object.assign(draft, command));
  }

  react(event: Int64ProcessManagerState): void {
    void event;
  }
}

class MalformedFirstFieldAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignRepeated(command: RepeatedIdCommand): void {
    void command;
  }

  assignMap(command: MapIdCommand): void {
    void command;
  }
}

class ExecutingTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static assigneeCalls = 0;
  static directUpdateCalls = 0;
  static failure: Error | undefined;

  static reset(failure?: Error): void {
    this.assigneeCalls = 0;
    this.directUpdateCalls = 0;
    this.failure = failure;
  }

  assignTask(command: AggregateState) {
    ExecutingTaskAggregate.assigneeCalls++;

    if (ExecutingTaskAggregate.failure !== undefined) {
      throw ExecutingTaskAggregate.failure;
    }

    if (command.name.startsWith("archive-lifecycle")) this.archiveDraft();
    if (command.name.startsWith("unarchive-lifecycle")) this.unarchiveDraft();
    if (command.name.startsWith("delete-lifecycle")) this.markDraftDeleted();
    if (command.name.startsWith("restore-lifecycle")) this.restoreDraft();

    if (command.name.includes("-lifecycle")) {
      return SignalEnvelopes.event({
        id: create(EventIdSchema, { value: `event-${command.name}` }),
        context: create(EventContextSchema),
        schema: AggregateStateSchema,
        message: command,
      });
    }

    const name = command.name === "Multi" ? "Multi two" : command.name;
    ExecutingTaskAggregate.directUpdateCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: command.id,
          name: `${name} (applied)`,
          archived: true,
        }),
      ),
    );

    if (command.name === "Multi") {
      return [
        createAggregateEvent("event-Multi-1", command.id, 0, "Multi one"),
        createAggregateEvent("event-Multi-2", command.id, 0, "Multi two"),
      ];
    }

    return SignalEnvelopes.event({
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
}

class ManagedTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static assigneeCalls = 0;
  static failure: Error | undefined;

  static reset(failure?: Error): void {
    this.assigneeCalls = 0;
    this.failure = failure;
  }

  assignTask(command: AggregateState): AggregateState {
    ManagedTaskAggregate.assigneeCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: command.id,
          name: `${command.name} (assigned)`,
          archived: false,
        }),
      ),
    );
    if (ManagedTaskAggregate.failure !== undefined) {
      throw ManagedTaskAggregate.failure;
    }
    return create(AggregateStateSchema, {
      id: command.id,
      name: `${command.name} event`,
      archived: false,
    });
  }
}

class MessageIdRejectingAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  static failure: unknown;

  assignTask(): never {
    throw MessageIdRejectingAggregate.failure;
  }
}

class GeneratedTwoArgAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static argumentCounts: number[] = [];
  static contexts: CommandContext[] = [];
  static observedStateNames: string[] = [];
  static observedLifecycles: { readonly archived: boolean; readonly deleted: boolean }[] = [];
  static rejectWhenStatePresent = false;
  static assigneeStarted = 0;
  static #releaseAssignee: (() => void) | undefined;
  static #assigneeCanFinish: Promise<void> | undefined;

  static reset(options: { readonly pauseAssignee?: boolean } = {}): void {
    this.argumentCounts = [];
    this.contexts = [];
    this.observedStateNames = [];
    this.observedLifecycles = [];
    this.rejectWhenStatePresent = false;
    this.assigneeStarted = 0;
    this.#releaseAssignee = undefined;
    this.#assigneeCanFinish =
      options.pauseAssignee === true
        ? new Promise<void>((resolve) => {
            this.#releaseAssignee = resolve;
          })
        : undefined;
  }

  static releaseAssignee(): void {
    const release = this.#releaseAssignee;
    this.#releaseAssignee = undefined;
    this.#assigneeCanFinish = undefined;
    release?.();
  }

  async assignTask(command: AggregateState, context: CommandContext): Promise<AggregateState> {
    GeneratedTwoArgAggregate.argumentCounts.push(arguments.length);
    GeneratedTwoArgAggregate.contexts.push(context);
    GeneratedTwoArgAggregate.observedStateNames.push(this.state.name);
    GeneratedTwoArgAggregate.observedLifecycles.push(this.lifecycle);
    GeneratedTwoArgAggregate.assigneeStarted++;
    await GeneratedTwoArgAggregate.#assigneeCanFinish;
    if (GeneratedTwoArgAggregate.rejectWhenStatePresent && this.state.name.length > 0) {
      throw TaskAlreadyDone.create({ id: create(GeneratedTaskIdSchema, { value: command.id }) });
    }
    if (this.isArchived || this.isDeleted) {
      return create(AggregateStateSchema, {
        id: command.id,
        name: `${command.name} event`,
        archived: false,
      });
    }
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: command.id,
          name: `${command.name} (generated)`,
          archived: false,
        }),
      ),
    );
    return create(AggregateStateSchema, {
      id: command.id,
      name: `${command.name} event`,
      archived: false,
    });
  }
}

class GeneratedReactorAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static argumentCounts: number[] = [];
  static contexts: EventContext[] = [];
  static failure: Error | undefined;

  static reset(failure?: Error): void {
    this.argumentCounts = [];
    this.contexts = [];
    this.failure = failure;
  }

  reactProjection(event: ProjectionEvent, context: EventContext): AggregateState {
    GeneratedReactorAggregate.argumentCounts.push(arguments.length);
    GeneratedReactorAggregate.contexts.push(context);
    if (GeneratedReactorAggregate.failure !== undefined) {
      throw GeneratedReactorAggregate.failure;
    }
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: event.id,
          name: `${event.name} (reacted)`,
          archived: false,
        }),
      ),
    );
    return create(AggregateStateSchema, {
      id: event.id,
      name: `${event.name} reacted event`,
      archived: false,
    });
  }
}

class GuardedAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static calls = 0;

  static reset(): void {
    this.calls = 0;
  }

  reactProjection(event: ProjectionEvent): void {
    GuardedAggregate.calls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: this.id,
          name: `${event.name} (guarded)`,
          archived: false,
        }),
      ),
    );
  }
}

class ProducingGuardedAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static calls = 0;

  static reset(): void {
    this.calls = 0;
  }

  reactProjection(event: ProjectionEvent): AggregateState {
    ProducingGuardedAggregate.calls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: this.id,
          name: `${event.name} (producing guarded)`,
          archived: false,
        }),
      ),
    );
    return create(AggregateStateSchema, {
      id: this.id,
      name: `${event.name} produced`,
      archived: false,
    });
  }
}

class GeneratedCommandingAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static argumentCounts: number[] = [];
  static contexts: EventContext[] = [];
  static commandProjectionStarted = 0;
  static #releaseCommandProjection: (() => void) | undefined;
  static #commandProjectionCanFinish: Promise<void> | undefined;

  static reset(options: { readonly pauseCommandProjection?: boolean } = {}): void {
    this.argumentCounts = [];
    this.contexts = [];
    this.commandProjectionStarted = 0;
    this.#releaseCommandProjection = undefined;
    this.#commandProjectionCanFinish =
      options.pauseCommandProjection === true
        ? new Promise<void>((resolve) => {
            this.#releaseCommandProjection = resolve;
          })
        : undefined;
  }

  static releaseCommandProjection(): void {
    const release = this.#releaseCommandProjection;
    this.#releaseCommandProjection = undefined;
    this.#commandProjectionCanFinish = undefined;
    release?.();
  }

  async commandProjection(event: ProjectionEvent, context: EventContext): Promise<AggregateState> {
    GeneratedCommandingAggregate.argumentCounts.push(arguments.length);
    GeneratedCommandingAggregate.contexts.push(context);
    GeneratedCommandingAggregate.commandProjectionStarted++;
    await GeneratedCommandingAggregate.#commandProjectionCanFinish;
    return create(AggregateStateSchema, {
      id: event.id,
      name: `${event.name} command`,
      archived: false,
    });
  }
}

class MultiManagedAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(command: AggregateState): readonly AggregateState[] {
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: command.id,
          name: `${command.name} two (assigned)`,
          archived: false,
        }),
      ),
    );
    return [
      create(AggregateStateSchema, {
        id: command.id,
        name: `${command.name} one event`,
        archived: false,
      }),
      create(AggregateStateSchema, {
        id: command.id,
        name: `${command.name} two event`,
        archived: false,
      }),
    ];
  }
}

class EmptyManagedAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(command: AggregateState): undefined {
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: command.id,
          name: command.name,
          archived: false,
        }),
      ),
    );
    return undefined;
  }
}

class EnvelopeManagedAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(command: AggregateState): SpineEvent {
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: command.id,
          name: command.name,
          archived: false,
        }),
      ),
    );
    return createAggregateEvent("spoofed-event", command.id, 0, command.name);
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

class ValidatingProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  static commandCalls = 0;

  static reset(): void {
    this.commandCalls = 0;
  }

  assignTask(command: ValidatedTaskCommand): ProjectionEvent {
    ValidatingProcessManager.commandCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: command.id,
          queue: `${command.name} assigned`,
        }),
      ),
    );
    return create(ProjectionEventSchema, {
      id: command.id,
      name: `${command.name} event`,
      priority: 1,
    });
  }
}

class TransitionViolatingAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
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
    return createAggregateEvent("event-transition-invalid", command.id, 0, command.name);
  }
}

class RecoveringTransitionAggregate extends TransitionViolatingAggregate {
  override assignTask(command: AggregateState) {
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: command.id,
          name: `${command.name} recovered`,
          archived: command.archived,
        }),
      ),
    );
    return createAggregateEvent("event-transition-recovers", command.id, 0, command.name);
  }
}

class AsyncAssigneeAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static resolveCommand: ((eventName: string) => void) | undefined;

  assignTask(command: AggregateState): Promise<SpineEvent> {
    return new Promise((resolve) => {
      AsyncAssigneeAggregate.resolveCommand = (eventName) => {
        this.update((draft) =>
          Object.assign(
            draft,
            create(AggregateStateSchema, {
              id: command.id,
              name: `${eventName} (applied)`,
              archived: command.archived,
            }),
          ),
        );
        resolve(createAggregateEvent(`event-${eventName}`, command.id, 0, eventName));
      };
    });
  }
}

class NoApplierAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(command: AggregateState): AggregateState {
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: command.id,
          name: `${command.name} (reaction metadata)`,
          archived: false,
        }),
      ),
    );
    return create(AggregateStateSchema, {
      id: command.id,
      name: `${command.name} event`,
      archived: false,
    });
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
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: event.id,
          name: event.name,
          archived: event.archived,
        }),
      ),
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

  applyProjection(event: ProjectionEvent): void {
    this.startTransaction();
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: event.id,
          name: event.name,
          archived: false,
        }),
      ),
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

  applyProjection(event: ProjectionEvent): void {
    this.startTransaction();
    this.update((draft) =>
      Object.assign(
        draft,
        create(AggregateStateSchema, {
          id: event.id,
          name: event.name,
          archived: false,
        }),
      ),
    );
    this.commitTransaction();
  }
}

class ExecutingTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeTask(event: ProjectionEvent): void {
    ExecutingTaskProjection.subscriberCalls++;
    if (event.name.endsWith("-lifecycle")) {
      if (event.name === "archive-lifecycle") this.archiveDraft();
      if (event.name === "unarchive-lifecycle") this.unarchiveDraft();
      if (event.name === "delete-lifecycle") this.markDraftDeleted();
      if (event.name === "restore-lifecycle") this.restoreDraft();
      return;
    }
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectionStateSchema, {
          id: event.id,
          name: `${event.name} (projected)`,
          priority: event.priority + 1,
        }),
      ),
    );
  }
}

class FilteredTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static calls: string[] = [];

  static reset(): void {
    this.calls = [];
  }

  subscribeAnnouncements(event: ProjectionEvent): void {
    FilteredTaskProjection.calls.push(`announcements:${event.name}`);
  }

  subscribeFallback(event: ProjectionEvent): void {
    FilteredTaskProjection.calls.push(`fallback:${event.name}`);
  }
}

class FilteredEventAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static calls: string[] = [];

  static reset(): void {
    this.calls = [];
  }

  reactAnnouncements(event: ProjectionEvent): AggregateState {
    FilteredEventAggregate.calls.push(`announcements:${event.name}`);
    return this.result(event);
  }

  reactFallback(event: ProjectionEvent): AggregateState {
    FilteredEventAggregate.calls.push(`fallback:${event.name}`);
    return this.result(event);
  }

  private result(event: ProjectionEvent): AggregateState {
    this.update((draft) => {
      draft.id = event.id;
      draft.name = event.name;
    });
    return create(AggregateStateSchema, { id: event.id, name: event.name });
  }
}

class ManagedTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeTask(event: ProjectionEvent): void {
    ManagedTaskProjection.subscriberCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectionStateSchema, {
          id: event.id,
          name: `${event.name} (managed)`,
          priority: event.priority + 1,
        }),
      ),
    );
  }
}

class AlternateCatchUpProjection extends Projection<TaskListId, typeof TaskListSchema, number> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeAggregate(event: TaskCreated): void {
    AlternateCatchUpProjection.subscriberCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskListSchema, {
          id: create(TodoTaskListIdSchema, { value: "task-alternate" }),
          openTaskCount: event.taskListId === undefined ? 0 : 1,
        }),
      ),
    );
  }
}

class BlockingCatchUpProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static startedCalls = 0;
  static completedCalls = 0;
  static block = false;
  static gates: ReturnType<typeof createSignal>[] = [];

  static reset(gateCount = 0): void {
    this.startedCalls = 0;
    this.completedCalls = 0;
    this.block = gateCount > 0;
    this.gates = Array.from({ length: gateCount }, () => createSignal());
  }

  static release(index: number): void {
    const gate = this.gates[index];

    if (gate === undefined) {
      throw new Error(`Missing catch-up gate ${String(index)}.`);
    }

    gate.resolve();
  }

  async subscribeTask(event: ProjectionEvent): Promise<void> {
    if (BlockingCatchUpProjection.block) {
      const index = BlockingCatchUpProjection.startedCalls;
      const gate = BlockingCatchUpProjection.gates[index];

      BlockingCatchUpProjection.startedCalls++;

      if (gate !== undefined) {
        await gate.promise;
      }
    }

    BlockingCatchUpProjection.completedCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectionStateSchema, {
          id: event.id,
          name: `${event.name} (blocking)`,
          priority: event.priority + 1,
        }),
      ),
    );
  }
}

class GeneratedTwoArgProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static argumentCounts: number[] = [];
  static contexts: EventContext[] = [];

  static reset(): void {
    this.argumentCounts = [];
    this.contexts = [];
  }

  subscribeTask(event: ProjectionEvent, context: EventContext): void {
    GeneratedTwoArgProjection.argumentCounts.push(arguments.length);
    GeneratedTwoArgProjection.contexts.push(context);
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectionStateSchema, {
          id: event.id,
          name: `${event.name} (generated)`,
          priority: event.priority + 1,
        }),
      ),
    );
  }
}

class RejectionObservingProjection extends Projection<
  string,
  typeof ProjectionStateSchema,
  number
> {
  static messages: TaskAlreadyDoneMessage[] = [];
  static contexts: EventContext[] = [];
  static argumentCounts: number[] = [];

  static reset(): void {
    this.messages = [];
    this.contexts = [];
    this.argumentCounts = [];
  }

  mutate(rejection: TaskAlreadyDoneMessage, context: EventContext): void {
    RejectionObservingProjection.argumentCounts.push(arguments.length);
    if (rejection.id !== undefined) {
      rejection.id.value = "mutated-subscriber-rejection";
    }
    if (context.rejection?.command?.id !== undefined) {
      context.rejection.command.id.uuid = "mutated-subscriber-command";
      context.rejection.stacktrace = "mutated subscriber stack";
    }
  }

  observe(rejection: TaskAlreadyDoneMessage, context: EventContext): void {
    RejectionObservingProjection.argumentCounts.push(arguments.length);
    RejectionObservingProjection.messages.push(rejection);
    RejectionObservingProjection.contexts.push(context);
  }
}

class ContextMutatingGeneratedProjection extends Projection<
  string,
  typeof ProjectionStateSchema,
  number
> {
  static firstContext: EventContext | undefined;
  static observerSawSameContext = false;
  static observedVersions: (number | undefined)[] = [];

  static reset(): void {
    this.firstContext = undefined;
    this.observerSawSameContext = false;
    this.observedVersions = [];
  }

  mutateContext(event: ProjectionEvent, context: EventContext): void {
    void event;
    ContextMutatingGeneratedProjection.firstContext = context;
    context.version = create(VersionSchema, { number: 99 });
  }

  observeContext(event: ProjectionEvent, context: EventContext): void {
    ContextMutatingGeneratedProjection.observerSawSameContext =
      context === ContextMutatingGeneratedProjection.firstContext;
    ContextMutatingGeneratedProjection.observedVersions.push(context.version?.number);
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectionStateSchema, {
          id: event.id,
          name: `${event.name} (observed)`,
          priority: event.priority + 1,
        }),
      ),
    );
  }
}

class PassiveTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeTask(event: ProjectionEvent): void {
    PassiveTaskProjection.subscriberCalls++;
    void event;
  }

  subscribeState(state: AggregateState): void {
    PassiveTaskProjection.subscriberCalls++;
    void state;
  }
}

class AccumulatingTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  subscribeTask(event: ProjectionEvent): void {
    this.update((draft) => {
      draft.name = event.name;
      draft.priority += event.priority;
    });
  }
}

class StateObservingProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeState(state: AggregateState): void {
    StateObservingProjection.subscriberCalls++;
    this.update((draft) => {
      draft.name = `${state.name} (projected)`;
      draft.priority = state.archived ? 2 : 1;
    });
  }
}

class OriginStateProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static calls: string[] = [];

  static reset(): void {
    this.calls = [];
  }

  domesticState(state: AggregateState): void {
    OriginStateProjection.calls.push(`domestic:${state.id}`);
  }

  externalState(state: AggregateState): void {
    OriginStateProjection.calls.push(`external:${state.id}`);
  }
}

class NeutralStateObservingProjection extends Projection<
  string,
  typeof NeutralProjectionStateSchema,
  number
> {
  subscribeState(state: ProjectionState): void {
    void state;
  }
}

class ReactingTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  reactTask(event: ProjectionEvent): void {
    void event;
  }
}

class UserIdProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  subscribeUser(event: UserId): void {
    void event;
  }
}

class NonFiniteRouteProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  subscribeNumber(event: NumberRouteEvent): void {
    void event;
  }
}

class MessageIdTaskAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  applyTaskCreated(event: TaskCreated): void {
    void event;
  }

  applyWrongId(event: WrongIdRouteEvent): void {
    void event;
  }
}

class MessageIdProducingAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  assignTask(command: Task): TaskCreated {
    this.update((draft) => Object.assign(draft, command));
    return create(TaskCreatedSchema, {
      ...(command.id === undefined ? {} : { id: command.id }),
      taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
      title: command.title,
    });
  }
}

class TaskCreatedScalarProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  subscribeTaskCreated(event: TaskCreated): void {
    void event;
  }
}

class MissingSubscriberMethodProjection extends Projection<
  string,
  typeof ProjectionStateSchema,
  number
> {
  missingSubscriber(event: ProjectionEvent): void {
    void event;
  }
}

class ThrowingTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static failure: unknown = new Error("projection subscriber failed");

  static reset(failure: unknown = new Error("projection subscriber failed")): void {
    this.failure = failure;
  }

  subscribeTask(event: ProjectionEvent): void {
    void event;
    throw ThrowingTaskProjection.failure;
  }
}

class RoutingProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  static commandCalls = 0;
  static eventCalls = 0;
  static commandReactionCalls = 0;
  static failure: Error | undefined;

  static reset(failure?: Error): void {
    this.commandCalls = 0;
    this.eventCalls = 0;
    this.commandReactionCalls = 0;
    this.failure = failure;
  }

  assignTask(command: AggregateState): ProjectionEvent {
    RoutingProcessManager.commandCalls++;
    if (command.name.endsWith("-lifecycle")) {
      if (command.name === "archive-lifecycle") this.archiveDraft();
      if (command.name === "unarchive-lifecycle") this.unarchiveDraft();
      if (command.name === "delete-lifecycle") this.markDraftDeleted();
      if (command.name === "restore-lifecycle") this.restoreDraft();
      return create(ProjectionEventSchema, { id: command.id, name: command.name, priority: 1 });
    }
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: command.id,
          queue: `${command.name} assigned`,
        }),
      ),
    );
    if (RoutingProcessManager.failure !== undefined) {
      throw RoutingProcessManager.failure;
    }
    return create(ProjectionEventSchema, {
      id: command.id,
      name: `${command.name} event`,
      priority: 1,
    });
  }

  reactTask(event: ProjectionEvent): void {
    RoutingProcessManager.eventCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: event.id,
          queue: `${event.name} reacted`,
        }),
      ),
    );
    if (RoutingProcessManager.failure !== undefined) {
      throw RoutingProcessManager.failure;
    }
  }

  commandTask(event: ProjectionEvent): AggregateState {
    RoutingProcessManager.commandReactionCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: event.id,
          queue: `${event.name} commanded`,
        }),
      ),
    );
    return create(AggregateStateSchema, {
      id: event.id,
      name: `${event.name} follow-up command`,
      archived: false,
    });
  }

  reactTaskWithEvent(event: ProjectionEvent): AggregateState {
    RoutingProcessManager.eventCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: event.id,
          queue: `${event.name} evented`,
        }),
      ),
    );
    return create(AggregateStateSchema, {
      id: event.id,
      name: `${event.name} produced event`,
      archived: false,
    });
  }
}

class FilteredProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  static calls: string[] = [];

  static reset(): void {
    this.calls = [];
  }

  reactAnnouncements(event: ProjectionEvent): void {
    FilteredProcessManager.calls.push(`react-announcements:${event.name}`);
  }

  reactFallback(event: ProjectionEvent): void {
    FilteredProcessManager.calls.push(`react-fallback:${event.name}`);
  }

  commandAnnouncements(event: ProjectionEvent): AggregateState {
    FilteredProcessManager.calls.push(`command-announcements:${event.name}`);
    return create(AggregateStateSchema, { id: event.id, name: event.name });
  }

  commandFallback(event: ProjectionEvent): AggregateState {
    FilteredProcessManager.calls.push(`command-fallback:${event.name}`);
    return create(AggregateStateSchema, { id: event.id, name: event.name });
  }
}

class DiagnosticOnlyProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  static calls = 0;

  assignTask(command: AggregateState): ProjectionEvent {
    DiagnosticOnlyProcessManager.calls += 1;
    return create(ProjectionEventSchema, {
      id: command.id,
      name: `${command.name} diagnostic`,
      priority: 1,
    });
  }
}

class InboxCheckingProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  static delivery: Delivery | undefined;
  static sawPendingRow = false;
  static eventCalls = 0;

  static reset(delivery?: Delivery): void {
    this.delivery = delivery;
    this.sawPendingRow = false;
    this.eventCalls = 0;
  }

  async reactTask(event: ProjectionEvent): Promise<void> {
    const delivery = InboxCheckingProcessManager.delivery;

    if (delivery === undefined) {
      throw new Error("Expected inbox-checking process-manager delivery.");
    }

    const pending = await delivery.inbox.read(ShardIndex.single(), {
      statuses: ["TO_DELIVER"],
    });

    InboxCheckingProcessManager.sawPendingRow = pending.some(
      (message) =>
        message.signalId === "event-pm-inbox-first" &&
        message.label === "REACT_UPON_EVENT" &&
        Identifiers.unpack("string", message.inboxId.targetId) === event.id,
    );
    InboxCheckingProcessManager.eventCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: event.id,
          queue: `${event.name} checked`,
        }),
      ),
    );
  }
}

class BlockingProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  static startedCalls = 0;
  static completedCalls = 0;
  static blockingId: string | undefined;
  static gate = createSignal();

  static reset(): void {
    this.startedCalls = 0;
    this.completedCalls = 0;
    this.blockingId = undefined;
    this.gate = createSignal();
  }

  static release(): void {
    this.gate.resolve();
  }

  async reactTask(event: ProjectionEvent): Promise<void> {
    BlockingProcessManager.startedCalls++;
    if (
      BlockingProcessManager.blockingId === undefined ||
      BlockingProcessManager.blockingId === this.id
    ) {
      await BlockingProcessManager.gate.promise;
    }
    BlockingProcessManager.completedCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: event.id,
          queue: `${event.name} blocked`,
        }),
      ),
    );
  }
}

class SplitRouteProcessManager extends ProcessManager<
  string,
  typeof ProcessManagerStateSchema,
  number
> {
  static startedIds: string[] = [];
  static completedIds: string[] = [];

  static reset(): void {
    this.startedIds = [];
    this.completedIds = [];
  }

  reactTask(event: ProjectionEvent): void {
    SplitRouteProcessManager.startedIds.push(this.id);

    if (this.id === "pm-fail") {
      throw new Error("pm-fail replay failed");
    }

    SplitRouteProcessManager.completedIds.push(this.id);
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProcessManagerStateSchema, {
          id: this.id,
          queue: `${event.name} split`,
        }),
      ),
    );
  }
}

describe("repository signal routing", () => {
  it("uses the current Todo descriptor type names in routing fixtures", () => {
    expect(TaskIdSchema.typeName).toBe("spine.examples.todo.TaskId");
    expect(TaskSchema.typeName).toBe("spine.examples.todo.Task");
    expect(TaskCreatedSchema.typeName).toBe("spine.examples.todo.TaskCreated");
  });

  it("derives stable current-record identity from every supported ID representation", () => {
    new Repository({ entityType: ExecutingTaskProjection, schema: ProjectionStateSchema });
    const spec = SpecScanner.scan(ExecutingTaskProjection as never);
    const descriptor = entityStorageDescriptor({ name: "Tasks", multitenant: false }, spec);
    const structured = { value: "task-1" };
    const record = EntityRecords.pack(
      ProjectionStateSchema,
      "task-1",
      create(ProjectionStateSchema, { id: "state-id-must-not-route", name: "First" }),
      1n,
      { archived: false, deleted: false },
    );

    expect(spec.sourceType).toBe(ProjectionStateSchema);
    expect(spec.recordType.typeName).toBe("spine.server.entity.EntityRecord");
    expect(spec.idValueIn(record)).toBe("task-1");
    expect(record.entityId).toBeDefined();
    expect(descriptor.id.unpack(record.entityId as NonNullable<typeof record.entityId>)).toBe(
      "task-1",
    );
    expect(descriptor.id.key("task-1")).toBe(
      InboxTargets.key(Identifiers.pack("string", "task-1")),
    );
    expect(descriptor.id.key("task-1")).not.toBe(descriptor.id.key("task-2"));
    expect(descriptor.id.clone(structured as never)).toEqual(structured);
    expect(descriptor.id.clone(structured as never)).not.toBe(structured);
  });

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
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventHistory: true,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    const completion = context
      .commandBus()
      .post(createAggregateCommand("command-exec", "task-exec", "TaskExec"));

    expect(ExecutingTaskAggregate.assigneeCalls).toBe(0);
    expect(observed).toEqual([]);

    await completion;

    expect(ExecutingTaskAggregate.assigneeCalls).toBe(1);
    expect(ExecutingTaskAggregate.directUpdateCalls).toBe(1);
    await expect(eventStore.read()).resolves.toMatchObject([{ id: { value: "event-TaskExec" } }]);
    await expect(storage.readEvents("task-exec")).resolves.toMatchObject([
      { id: { value: "event-TaskExec" } },
    ]);
    await expect(storage.readCurrent("task-exec")).resolves.toMatchObject({
      entityId: "task-exec",
      version: 1n,
      state: { id: "task-exec", name: "TaskExec (applied)", archived: true },
    });
    expect(observed).toEqual(["event-TaskExec"]);
  });

  it("keeps state-history retention disabled by default across repository families", async () => {
    const aggregateFactory = new InMemoryStorageFactory();
    const aggregateContext = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .withStorageFactory(aggregateFactory)
      .build();
    const aggregateStorage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: aggregateFactory,
      stateSchema: AggregateStateSchema,
    });

    try {
      await aggregateContext
        .commandBus()
        .post(createAggregateCommand("command-history-default-aggregate", "history-aggregate"));
      await expect(aggregateStorage.readStates("history-aggregate")).resolves.toEqual([]);
    } finally {
      await aggregateContext.close();
    }

    const projectionFactory = new InMemoryStorageFactory();
    const projectionContext = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .withStorageFactory(projectionFactory)
      .build();
    const projectionStorage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: projectionFactory,
      stateSchema: ProjectionStateSchema,
    });

    try {
      await projectionContext
        .eventBus()
        .post(createProjectionEvent("event-history-default-projection", "history-projection"));
      await expect(projectionStorage.readStates("history-projection")).resolves.toEqual([]);
    } finally {
      await projectionContext.close();
    }

    const processManagerFactory = new InMemoryStorageFactory();
    const processManagerContext = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerReactRepository())
      .withStorageFactory(processManagerFactory)
      .build();
    const processManagerStorage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: processManagerFactory,
      stateSchema: ProcessManagerStateSchema,
    });

    try {
      await processManagerContext
        .eventBus()
        .post(createProjectionEvent("event-history-default-pm", "history-pm"));
      await expect(processManagerStorage.readStates("history-pm")).resolves.toEqual([]);
    } finally {
      await processManagerContext.close();
    }
  });

  it("keeps aggregate persistence committed when a Stand subscriber throws", async () => {
    const factory = new InMemoryStorageFactory();
    const repository = createExecutingRepository();
    repository.setStateHistoryEnabled(true);
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      stateHistory: true,
      eventHistory: true,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    let attempts = 0;
    context.stand().subscribe(AggregateStateSchema, () => {
      attempts += 1;
      throw new Error("subscriber failure");
    });

    try {
      await expect(
        context.commandBus().post(createAggregateCommand("command-subscriber", "subscriber-id")),
      ).resolves.toBeUndefined();
      expect(attempts).toBe(1);
      await expect(storage.readCurrent("subscriber-id")).resolves.toMatchObject({
        version: 1n,
        state: { id: "subscriber-id", name: "Task (applied)", archived: true },
      });
      await expect(storage.readStates("subscriber-id")).resolves.toMatchObject([{ version: 1n }]);
      await expect(storage.readEvents("subscriber-id")).resolves.toMatchObject([
        { id: { value: "event-Task" } },
      ]);
      await expect(eventStore.read()).resolves.toMatchObject([{ id: { value: "event-Task" } }]);
      expect(context.storedEventDispatchFailures()).toMatchObject([
        { event: { id: { value: "event-Task" } }, error: { message: "subscriber failure" } },
      ]);
    } finally {
      eventStore.close();
      await context.close();
    }
  });

  it("keeps committed process-manager command transitions usable when a Stand subscriber throws", async () => {
    RoutingProcessManager.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .build();
    let notifications = 0;
    context.stand().subscribe(ProcessManagerStateSchema, () => {
      notifications++;
      throw new Error("process-manager command subscriber failed");
    });

    try {
      await expect(
        context
          .commandBus()
          .post(createAggregateCommand("command-pm-subscriber-1", "pm-subscriber")),
      ).resolves.toBeUndefined();
      await expect(
        context
          .commandBus()
          .post(createAggregateCommand("command-pm-subscriber-2", "pm-subscriber", "Follow-up")),
      ).resolves.toBeUndefined();

      expect(RoutingProcessManager.commandCalls).toBe(2);
      expect(notifications).toBe(2);
      await expect(
        context.stand().read(ProcessManagerStateSchema, "pm-subscriber"),
      ).resolves.toEqual(
        create(ProcessManagerStateSchema, {
          id: "pm-subscriber",
          queue: "Follow-up assigned",
        }),
      );
      expect(context.storedEventDispatchFailures()).toMatchObject([
        {
          error: { message: "process-manager command subscriber failed" },
        },
        {
          error: { message: "process-manager command subscriber failed" },
        },
      ]);
    } finally {
      await context.close();
    }
  });

  it("delivers deferred aggregate updates only to subscribers present at the current write", async () => {
    const factory = new GatedAggregateEventStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .withStorageFactory(factory)
      .build();
    let original = 0;
    let late = 0;
    context.stand().subscribe(AggregateStateSchema, () => {
      original += 1;
    });
    const command = context.commandBus().post(createAggregateCommand("command-late", "late-id"));
    await factory.reached;
    context.stand().subscribe(AggregateStateSchema, () => {
      late += 1;
    });
    factory.release();
    try {
      await command;
      expect(original).toBe(1);
      expect(late).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("retains state history while enabled and preserves existing rows after disablement", async () => {
    const aggregateFactory = new InMemoryStorageFactory();
    const aggregateRepository = createExecutingRepository();
    aggregateRepository.setStateHistoryEnabled(true);
    const aggregateContext = BoundedContext.singleTenant("Tasks")
      .add(aggregateRepository)
      .withStorageFactory(aggregateFactory)
      .build();
    const aggregateStorage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: aggregateFactory,
      stateSchema: AggregateStateSchema,
      stateHistory: true,
    });

    try {
      await aggregateContext
        .commandBus()
        .post(
          createAggregateCommand(
            "command-history-enabled-aggregate",
            "history-aggregate",
            "History first",
          ),
        );
      aggregateRepository.setStateHistoryEnabled(false);
      await aggregateContext
        .commandBus()
        .post(
          createAggregateCommand(
            "command-history-disabled-aggregate",
            "history-aggregate",
            "History second",
          ),
        );
      await expect(aggregateStorage.readStates("history-aggregate")).resolves.toMatchObject([
        { version: 1n, state: { name: "History first (applied)" } },
      ]);
    } finally {
      await aggregateContext.close();
    }

    const projectionFactory = new InMemoryStorageFactory();
    const projectionRepository = createExecutingProjectionRepository();
    projectionRepository.setStateHistoryEnabled(true);
    const projectionContext = BoundedContext.singleTenant("Tasks")
      .add(projectionRepository)
      .withStorageFactory(projectionFactory)
      .build();
    const projectionStorage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: projectionFactory,
      stateSchema: ProjectionStateSchema,
      stateHistory: true,
    });

    try {
      await projectionContext
        .eventBus()
        .post(createProjectionEvent("event-history-enabled-projection", "history-projection"));
      projectionRepository.setStateHistoryEnabled(false);
      await projectionContext
        .eventBus()
        .post(createProjectionEvent("event-history-disabled-projection", "history-projection"));
      await expect(projectionStorage.readStates("history-projection")).resolves.toEqual([]);
    } finally {
      await projectionContext.close();
    }

    const processManagerFactory = new InMemoryStorageFactory();
    const processManagerRepository = createProcessManagerReactRepository();
    processManagerRepository.setStateHistoryEnabled(true);
    const processManagerContext = BoundedContext.singleTenant("Tasks")
      .add(processManagerRepository)
      .withStorageFactory(processManagerFactory)
      .build();
    const processManagerStorage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: processManagerFactory,
      stateSchema: ProcessManagerStateSchema,
      stateHistory: true,
    });

    try {
      await processManagerContext
        .eventBus()
        .post(createProjectionEvent("event-history-enabled-pm", "history-pm"));
      processManagerRepository.setStateHistoryEnabled(false);
      await processManagerContext
        .eventBus()
        .post(createProjectionEvent("event-history-disabled-pm", "history-pm"));
      await expect(processManagerStorage.readStates("history-pm")).resolves.toMatchObject([
        { version: 1n, state: { queue: "Task reacted" } },
      ]);
    } finally {
      await processManagerContext.close();
    }
  });

  it("opens fresh history storage when aggregate retention is enabled after an initial store", async () => {
    const factory = new InMemoryStorageFactory();
    const repository = createExecutingRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      stateHistory: true,
    });

    try {
      await context
        .commandBus()
        .post(createAggregateCommand("history-off", "history-transition", "First"));
      await expect(storage.readStates("history-transition")).resolves.toEqual([]);
      repository.setStateHistoryEnabled(true);
      await context
        .commandBus()
        .post(createAggregateCommand("history-on", "history-transition", "Second"));
      await expect(storage.readStates("history-transition")).resolves.toMatchObject([
        { version: 2n, state: { name: "Second (applied)" } },
      ]);
      repository.setStateHistoryEnabled(false);
      await context
        .commandBus()
        .post(createAggregateCommand("history-off-again", "history-transition", "Third"));
      await expect(storage.readStates("history-transition")).resolves.toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  it("rejects a non-boolean state-history switch before a storage provider is bound", () => {
    const repository = createExecutingRepository();

    expect(() => {
      repository.setStateHistoryEnabled("enabled" as never);
    }).toThrow("Repository state-history switch requires a boolean.");
  });

  it("packs aggregate-returned domain events and owns the aggregate transaction", async () => {
    ManagedTaskAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createManagedRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await context
      .commandBus()
      .post(createAggregateCommand("command-managed", "task-managed", "Managed"));

    expect(ManagedTaskAggregate.assigneeCalls).toBe(1);
    await expect(eventStore.read()).resolves.toMatchObject([
      {
        id: { value: "command-managed-1" },
        context: { version: { number: 1 } },
      },
    ]);
    const [stored] = await eventStore.read();
    expect(readReadableProducerId(stored)).toBe("task-managed");
    await expect(storage.readCurrent("task-managed")).resolves.toMatchObject({
      entityId: "task-managed",
      version: 1n,
      state: { id: "task-managed", name: "Managed (assigned)", archived: false },
    });
  });

  it("preserves a pre-existing managed aggregate when a command is rejected", async () => {
    const factory = new InMemoryStorageFactory();
    const repository = createManagedRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .addEventDispatcher({
        messageSchemas: () => [TaskAlreadyDoneSchema],
        dispatch: () => Promise.reject(new Error("rejection event dispatch failed")),
      })
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    ManagedTaskAggregate.reset();
    await context
      .commandBus()
      .post(createAggregateCommand("command-existing", "task-rejected", "Persisted"));
    const currentBeforeRejection = await storage.readCurrent("task-rejected");
    const eventsBeforeRejection = await eventStore.read();

    expect(currentBeforeRejection).toEqual({
      entityId: "task-rejected",
      state: create(AggregateStateSchema, {
        id: "task-rejected",
        name: "Persisted (assigned)",
        archived: false,
      }),
      version: 1n,
      lifecycle: { archived: false, deleted: false },
    });
    expect(eventsBeforeRejection).toHaveLength(1);

    const taskId = create(GeneratedTaskIdSchema, { value: "task-rejected" });
    const rejection = TaskAlreadyDone.create({ id: taskId });
    const command = createAggregateCommand("command-rejected", "task-rejected", "Already done");
    const originalCommand = clone(CommandSchema, command);
    ManagedTaskAggregate.reset(rejection);

    await expect(context.commandBus().post(command)).resolves.toBeUndefined();

    if (command.id !== undefined) {
      command.id.uuid = "mutated-command";
    }
    const storedEvents = await waitForStoredEvents(eventStore, 2);
    const rejectionEvents = storedEvents.filter((event) => event.context?.rejection !== undefined);
    const [event] = rejectionEvents;

    expect(storedEvents.slice(0, eventsBeforeRejection.length)).toEqual(eventsBeforeRejection);
    expect(rejectionEvents).toHaveLength(1);
    expect(event?.id?.value).toBe("command-rejected-1");
    expect(event?.message?.typeUrl).toBe(TypeUrls.derive(TaskAlreadyDoneSchema));
    expect(
      event?.message === undefined
        ? undefined
        : AnyMessages.unpack(event.message, TaskAlreadyDoneSchema),
    ).toEqual(create(TaskAlreadyDoneSchema, { id: taskId }));
    expect(event?.context?.rejection?.command).toEqual(originalCommand);
    expect(event?.context?.rejection?.stacktrace).toBe(rejection.stack);
    expect(event?.context?.timestamp).toBeDefined();
    expect(event?.context?.origin).toEqual({
      case: "pastMessage",
      value: create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: AnyMessages.pack(
            CommandIdSchema,
            create(CommandIdSchema, { uuid: "command-rejected" }),
          ),
          typeUrl: TypeUrls.derive(AggregateStateSchema),
        }),
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "user-1" }),
        }),
      }),
    });
    expect(readReadableProducerId(event)).toBe("task-rejected");
    expect(event?.context?.version).toBeUndefined();
    await expect(storage.readCurrent("task-rejected")).resolves.toEqual(currentBeforeRejection);
    const [failure] = await waitForFailures(context, 1);
    expect(failure).toMatchObject({
      event: { id: { value: "command-rejected-1" } },
      error: { name: "Error", message: "rejection event dispatch failed" },
    });
    ManagedTaskAggregate.reset();
  });

  it("posts a rejected aggregate command without directly updating or persisting output", async () => {
    const rejection = TaskAlreadyDone.create({
      id: create(GeneratedTaskIdSchema, { value: "task-applier-rejected" }),
    });
    ExecutingTaskAggregate.reset(rejection);
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-applier-rejected", "task-applier-rejected")),
    ).resolves.toBeUndefined();

    expect(ExecutingTaskAggregate.directUpdateCalls).toBe(0);
    await expect(waitForStoredEvents(eventStore, 1)).resolves.toMatchObject([
      { id: { value: "command-applier-rejected-1" } },
    ]);
    await expect(storage.readCurrent("task-applier-rejected")).resolves.toBeUndefined();
    ExecutingTaskAggregate.reset();
  });

  it.each([
    {
      label: "ordinary errors",
      failure: () => new Error("ordinary aggregate failure"),
    },
    {
      label: "prototype-spoofed rejection errors",
      failure: () => {
        const rejection = TaskAlreadyDone.create({
          id: create(GeneratedTaskIdSchema, { value: "task-forged" }),
        });
        const forged = new Error("forged aggregate failure");
        Reflect.setPrototypeOf(forged, Reflect.getPrototypeOf(rejection));
        return forged;
      },
    },
  ])("keeps $label as technical aggregate failures", async ({ failure }) => {
    const thrown = failure();
    ManagedTaskAggregate.reset(thrown);
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createManagedRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createAggregateCommand("command-technical", "task-technical")),
    ).resolves.toBeUndefined();

    await expect(eventStore.read()).resolves.toEqual([]);
    ManagedTaskAggregate.reset();
  });

  it("uses the typed message-valued entity ID as the rejection producer", async () => {
    RejectionObservingProjection.reset();
    MessageIdRejectingAggregate.failure = TaskAlreadyDone.create({
      id: create(GeneratedTaskIdSchema, { value: "task-message-id" }),
    });
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createMessageIdRejectingRepository())
      .add(createRejectionObservingRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createTaskCommand("command-message-id", "task-message-id")),
    ).resolves.toBeUndefined();

    const [event] = await waitForStoredEvents(eventStore, 1);
    await waitForCondition(() => RejectionObservingProjection.messages.length === 1);
    expect(
      AnyMessages.unpack(event?.context?.producerId as never, GeneratedTaskIdSchema)?.value,
    ).toBe("task-message-id");
    expect(event?.context?.version).toBeUndefined();
    expect(RejectionObservingProjection.messages[0]?.id?.value).toBe("task-message-id");
  });

  it("passes CommandContext to generated-registry two-argument command assignees", async () => {
    GeneratedTwoArgAggregate.reset();
    const context = BoundedContext.multitenant("Tasks")
      .add(createGeneratedTwoArgAggregateRepository())
      .withStorageFactory(new InMemoryStorageFactory())
      .build();

    await context
      .commandBus()
      .post(createAggregateCommand("command-generated", "task-generated", "Generated", "tenant-a"));

    expect(GeneratedTwoArgAggregate.argumentCounts).toEqual([2]);
    expect(GeneratedTwoArgAggregate.contexts).toHaveLength(1);
    expect(GeneratedTwoArgAggregate.contexts[0]?.actorContext?.actor).toEqual(
      create(UserIdSchema, { value: "user-1" }),
    );
    expect(GeneratedTwoArgAggregate.contexts[0]?.actorContext?.tenantId).toEqual(
      createTenantId("tenant-a"),
    );
  });

  it("passes empty CommandContext to generated two-argument assignees when the envelope has none", async () => {
    GeneratedTwoArgAggregate.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedTwoArgAggregateRepository())
      .withStorageFactory(new InMemoryStorageFactory())
      .build();

    await context
      .commandBus()
      .post(createContextlessAggregateCommand("command-empty-context", "task-empty-context"));

    expect(GeneratedTwoArgAggregate.argumentCounts).toEqual([2]);
    expect(GeneratedTwoArgAggregate.contexts).toEqual([create(CommandContextSchema)]);
  });

  it("loads the committed state for each later generated Aggregate command", async () => {
    GeneratedTwoArgAggregate.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedTwoArgAggregateRepository())
      .withStorageFactory(new InMemoryStorageFactory())
      .build();

    await context.commandBus().post(createAggregateCommand("command-first", "same-id", "First"));
    await context.commandBus().post(createAggregateCommand("command-second", "same-id", "Second"));

    expect(GeneratedTwoArgAggregate.observedStateNames).toEqual(["", "First (generated)"]);
  });

  it("processes concurrent same-ID generated commands FIFO and rejects the rehydrated duplicate", async () => {
    GeneratedTwoArgAggregate.reset();
    GeneratedTwoArgAggregate.rejectWhenStatePresent = true;
    const published: string[] = [];
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedTwoArgAggregateRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (event) => {
          published.push(event.id?.value ?? "missing");
          return Promise.resolve();
        },
      })
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      Promise.all([
        context.commandBus().post(createAggregateCommand("concurrent-first", "duplicate", "First")),
        context
          .commandBus()
          .post(createAggregateCommand("concurrent-second", "duplicate", "Second")),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    expect(GeneratedTwoArgAggregate.observedStateNames).toEqual(["", "First (generated)"]);
    await expect(
      context.stand().readVersioned(AggregateStateSchema, "duplicate"),
    ).resolves.toMatchObject({
      state: { name: "First (generated)" },
      version: { number: 1 },
    });
    expect(published).toEqual(["concurrent-first-1"]);
    const storedEvents = await waitForStoredEvents(eventStore, 2);
    const normalEvents = storedEvents.filter((event) => event.context?.rejection === undefined);
    const rejectionEvents = storedEvents.filter((event) => event.context?.rejection !== undefined);
    expect(normalEvents).toHaveLength(1);
    expect(normalEvents[0]?.id?.value).toBe("concurrent-first-1");
    expect(rejectionEvents).toHaveLength(1);
    expect(rejectionEvents[0]?.message?.typeUrl).toBe(TypeUrls.derive(TaskAlreadyDoneSchema));
  });

  it("rehydrates archived and deleted lifecycle flags for generated Aggregate handlers", async () => {
    GeneratedTwoArgAggregate.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedTwoArgAggregateRepository())
      .withStorageFactory(new InMemoryStorageFactory())
      .build();
    await context
      .stand()
      .update(
        AggregateStateSchema,
        create(AggregateStateSchema, { id: "lifecycle-id", name: "Stored", archived: true }),
        {
          version: create(VersionSchema, { number: 7 }),
          lifecycle: { archived: true, deleted: true },
        },
      );

    await context.commandBus().post(createAggregateCommand("command-lifecycle", "lifecycle-id"));

    expect(GeneratedTwoArgAggregate.observedStateNames).toEqual(["Stored"]);
    expect(GeneratedTwoArgAggregate.observedLifecycles).toEqual([
      { archived: true, deleted: true },
    ]);
  });

  it("rehydrates the same Aggregate ID independently in each tenant", async () => {
    GeneratedTwoArgAggregate.reset();
    const context = BoundedContext.multitenant("Tasks")
      .add(createGeneratedTwoArgAggregateRepository())
      .withStorageFactory(new InMemoryStorageFactory())
      .build();
    await context
      .commandBus()
      .post(createAggregateCommand("tenant-a-first", "same", "A", "tenant-a"));
    await context
      .commandBus()
      .post(createAggregateCommand("tenant-b-first", "same", "B", "tenant-b"));
    await context
      .commandBus()
      .post(createAggregateCommand("tenant-a-next", "same", "A2", "tenant-a"));
    await context
      .commandBus()
      .post(createAggregateCommand("tenant-b-next", "same", "B2", "tenant-b"));

    expect(GeneratedTwoArgAggregate.observedStateNames).toEqual([
      "",
      "",
      "A (generated)",
      "B (generated)",
    ]);
  });

  it("keeps lifecycle System event context tenant-scoped", async () => {
    const changes: SpineEvent[] = [];
    const context = BoundedContext.multitenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityCreatedSchema, EntityStateChangedSchema],
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await context
        .commandBus()
        .post(createAggregateCommand("tenant-lifecycle-a", "same", "A", "tenant-a"));
      await context
        .commandBus()
        .post(createAggregateCommand("tenant-lifecycle-b", "same", "B", "tenant-b"));
      await waitForCondition(() => changes.length === 4);
      expect(
        changes.map((event) =>
          event.context?.origin.case === "pastMessage"
            ? event.context.origin.value.actorContext?.tenantId?.kind.value
            : undefined,
        ),
      ).toEqual(["tenant-a", "tenant-a", "tenant-b", "tenant-b"]);
    } finally {
      await context.close();
    }
  });

  it("dispatches events committed by accepted command work before close resolves", async () => {
    GeneratedTwoArgAggregate.reset({ pauseAssignee: true });
    const observed: string[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedTwoArgAggregateRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (event) => {
          observed.push(event.id?.value ?? "missing");
          return Promise.resolve();
        },
      })
      .withStorageFactory(new InMemoryStorageFactory())
      .build();

    const post = context
      .commandBus()
      .post(createAggregateCommand("command-close-event", "task-close-event"));
    await waitForCondition(() => GeneratedTwoArgAggregate.assigneeStarted === 1);

    const close = context.close().then(() => "closed");

    await expect(Promise.race([close, delay(25)])).resolves.toBe("pending");

    GeneratedTwoArgAggregate.releaseAssignee();

    await expect(post).resolves.toBeUndefined();
    await expect(close).resolves.toBe("closed");
    expect(observed).toEqual(["command-close-event-1"]);
  });

  it("runs generated aggregate event reactors and wraps returned domain events after commit", async () => {
    GeneratedReactorAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const observed: string[] = [];
    const context = BoundedContext.multitenant("Tasks")
      .add(createGeneratedReactorRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (event) => {
          observed.push(event.id?.value ?? "missing");
          return Promise.resolve();
        },
      })
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: {
        name: "Tasks",
        multitenant: true,
        tenantId: createTenantId("tenant-b"),
      },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });
    const eventStore = new EventStore(
      { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-b") },
      factory,
    );

    await context.eventBus().post(
      createProjectionEvent("event-reactor-source", "task-reactor", {
        pastMessageTenantId: "tenant-b",
      }),
    );

    expect(GeneratedReactorAggregate.argumentCounts).toEqual([2]);
    expect(GeneratedReactorAggregate.contexts[0]?.origin).toEqual(
      projectionEventOrigin({ pastMessageTenantId: "tenant-b" }),
    );
    const stored = await eventStore.read();

    expect(stored).toMatchObject([
      { id: { value: "event-reactor-source" } },
      {
        id: { value: "event-reactor-source-1" },
        context: {
          version: { number: 1 },
          origin: {
            case: "pastMessage",
          },
        },
      },
    ]);
    expect(stored[1]?.context?.timestamp).toBeDefined();
    expect(readReadableProducerId(stored[1])).toBe("task-reactor");
    expect(stored[1]?.context?.origin).toEqual({
      case: "pastMessage",
      value: create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: AnyMessages.pack(
            EventIdSchema,
            create(EventIdSchema, { value: "event-reactor-source" }),
          ),
          typeUrl: TypeUrls.derive(ProjectionEventSchema),
        }),
        actorContext: create(ActorContextSchema, {
          tenantId: createTenantId("tenant-b"),
        }),
        grandOrigin: create(OriginSchema, {
          message: create(MessageIdSchema, {
            id: AnyMessages.pack(
              CommandIdSchema,
              create(CommandIdSchema, { uuid: "past-command" }),
            ),
            typeUrl: TypeUrls.derive(AggregateStateSchema),
          }),
          actorContext: create(ActorContextSchema, {
            tenantId: createTenantId("tenant-b"),
          }),
        }),
      }),
    });
    await expect(storage.readCurrent("task-reactor")).resolves.toMatchObject({
      entityId: "task-reactor",
      version: 1n,
      state: { id: "task-reactor", name: "Task (reacted)", archived: false },
    });
    await waitForCondition(() => observed.length === 1);
    expect(observed).toEqual(["event-reactor-source-1"]);
  });

  it("emits a System reactor-dispatch diagnostic after aggregate reactor admission", async () => {
    GeneratedReactorAggregate.reset();
    const diagnostics: SpineEvent[] = [];
    const event = createProjectionEvent("aggregate-reactor-diagnostic", "aggregate-reactor-id");
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedReactorRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToReactorSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await context.eventBus().post(event);
      await waitForCondition(() => diagnostics.length === 1);

      const diagnostic = AnyMessages.unpack(
        diagnostics[0]?.message as never,
        EventDispatchedToReactorSchema,
      );
      expect(diagnostic).toMatchObject({
        receiver: { typeUrl: TypeUrls.derive(AggregateStateSchema) },
        payload: event,
        entityType: { impl: { case: "javaClassName", value: "GeneratedReactorAggregate" } },
        whenDispatched: diagnostics[0]?.context?.timestamp,
      });
      expect(diagnostics[0]?.context?.origin).toMatchObject({
        case: "pastMessage",
        value: { message: { typeUrl: TypeUrls.derive(ProjectionEventSchema) } },
      });
      expect(context.eventBus().acceptedEventTypes()).not.toContain(
        TypeUrls.derive(EventDispatchedToReactorSchema),
      );
    } finally {
      await context.close();
    }
  });

  it("retains one reactor diagnostic when an admitted reactor fails", async () => {
    const failure = new Error("admitted reactor failed");
    const diagnostics: SpineEvent[] = [];
    const event = createProjectionEvent("aggregate-reactor-failure", "aggregate-reactor-failure");
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedReactorRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToReactorSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      GeneratedReactorAggregate.reset(failure);
      await expect(context.eventBus().post(event)).rejects.toThrow(failure);
      await waitForCondition(() => diagnostics.length === 1);

      expect(GeneratedReactorAggregate.argumentCounts).toEqual([2]);
      expect(diagnostics).toHaveLength(1);
      expect(
        AnyMessages.unpack(diagnostics[0]?.message as never, EventDispatchedToReactorSchema),
      ).toMatchObject({ payload: event });
    } finally {
      GeneratedReactorAggregate.reset();
      await context.close();
    }
  });

  it("does not emit reactor diagnostics for an event without a matching route", async () => {
    GeneratedReactorAggregate.reset();
    const diagnostics: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedReactorRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToReactorSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await expect(
        context.eventBus().post(
          SignalEnvelopes.event({
            id: create(EventIdSchema, { value: "aggregate-reactor-unmatched" }),
            context: create(EventContextSchema),
            schema: NumberRouteEventSchema,
            message: create(NumberRouteEventSchema, { id: 7 }),
          }),
        ),
      ).rejects.toThrow(/event schema/i);
      await context.close();

      expect(diagnostics).toEqual([]);
      expect(GeneratedReactorAggregate.argumentCounts).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("dispatches produced reactor events before later external posts and drains them on close", async () => {
    const factory = new InMemoryStorageFactory();
    const observed: string[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedReactorRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (event) => {
          observed.push(event.id?.value ?? "missing");
          return Promise.resolve();
        },
      })
      .withStorageFactory(factory)
      .build();

    await context
      .eventBus()
      .post(createProjectionEvent("event-follow-up-source", "task-follow-up"));
    await context
      .eventBus()
      .post(createAggregateEvent("event-later-external", "task-follow-up", 2));
    await context.close();

    expect(observed).toEqual(["event-follow-up-source-1", "event-later-external"]);
  });

  it("runs generated command reactions and wraps returned domain commands after event intake", async () => {
    GeneratedCommandingAggregate.reset();
    const commands: SpineCommand[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedCommandingRepository())
      .addCommandDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();

    await context.eventBus().post(createProjectionEvent("event-command-source", "task-command"));

    expect(GeneratedCommandingAggregate.argumentCounts).toEqual([2]);
    expect(commands).toHaveLength(1);
    const [command] = commands;

    expect(command).toBeDefined();
    expect(command?.id).toEqual(create(CommandIdSchema, { uuid: "event-command-source-1" }));
    if (command?.message === undefined) {
      throw new Error("Expected a produced command message.");
    }
    expect(AnyMessages.unpack(command.message, AggregateStateSchema)).toEqual(
      create(AggregateStateSchema, {
        id: "task-command",
        name: "Task command",
        archived: false,
      }),
    );
  });

  it("wraps commands from generated command reactions with the source event origin", async () => {
    const commands: SpineCommand[] = [];
    const context = BoundedContext.multitenant("Tasks")
      .add(createGeneratedCommandingRepository())
      .addCommandDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();
    const sourceEvent = createProjectionEvent("event-command-origin", "task-command-origin", {
      pastMessageTenantId: "tenant-command",
    });
    const sourceActorContext = create(ActorContextSchema, {
      tenantId: createTenantId("tenant-command"),
    });
    const sourceGrandOrigin = create(OriginSchema, {
      message: create(MessageIdSchema, {
        id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "past-command" })),
        typeUrl: TypeUrls.derive(AggregateStateSchema),
      }),
      actorContext: sourceActorContext,
    });

    await context.eventBus().post(sourceEvent);

    expect(commands[0]?.context?.actorContext).toEqual(sourceActorContext);
    expect(commands[0]?.context?.origin).toEqual(
      create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: AnyMessages.pack(
            EventIdSchema,
            create(EventIdSchema, { value: "event-command-origin" }),
          ),
          typeUrl: TypeUrls.derive(ProjectionEventSchema),
        }),
        actorContext: sourceActorContext,
        grandOrigin: sourceGrandOrigin,
      }),
    );
  });

  it("keeps command bus open until event-side command reactions drain during close", async () => {
    GeneratedCommandingAggregate.reset({ pauseCommandProjection: true });
    const commands: SpineCommand[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedCommandingRepository())
      .addCommandDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();

    const post = context
      .eventBus()
      .post(createProjectionEvent("event-command-close", "task-command-close"));
    await waitForCondition(() => GeneratedCommandingAggregate.commandProjectionStarted === 1);

    const close = context.close().then(() => "closed");

    await expect(Promise.race([close, delay(25)])).resolves.toBe("pending");

    GeneratedCommandingAggregate.releaseCommandProjection();

    await expect(post).resolves.toBeUndefined();
    await expect(close).resolves.toBe("closed");
    expect(commands).toHaveLength(1);
    expect(commands[0]?.id).toEqual(create(CommandIdSchema, { uuid: "event-command-close-1" }));
  });

  it("assigns sequential producer versions to multiple direct aggregate events", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createMultiManagedRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await context
      .commandBus()
      .post(createAggregateCommand("command-managed-multi", "task-managed-multi", "Multi"));

    await expect(eventStore.read()).resolves.toMatchObject([
      { id: { value: "command-managed-multi-1" }, context: { version: { number: 1 } } },
      { id: { value: "command-managed-multi-2" }, context: { version: { number: 2 } } },
    ]);
    await expect(storage.readCurrent("task-managed-multi")).resolves.toMatchObject({
      entityId: "task-managed-multi",
      version: 2n,
      state: { id: "task-managed-multi", name: "Multi two (assigned)", archived: false },
    });
  });

  it("rejects managed aggregate handlers that return no domain event", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createEmptyManagedRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createAggregateCommand("command-empty", "task-empty")),
    ).resolves.toBeUndefined();
    await expect(eventStore.read()).resolves.toEqual([]);
  });

  it("persists explicit framework event envelopes returned by managed aggregate handlers", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createEnvelopeManagedRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createAggregateCommand("command-envelope", "task-envelope")),
    ).resolves.toBeUndefined();
    await expect(eventStore.read()).resolves.toMatchObject([{ id: { value: "spoofed-event" } }]);
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
    expect(ExecutingTaskAggregate.directUpdateCalls).toBe(1);
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
    expect(ExecutingTaskAggregate.directUpdateCalls).toBe(1);
  });

  it("persists array command output with sequential aggregate versions", async () => {
    ExecutingTaskAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });

    await context.commandBus().post(createAggregateCommand("command-multi", "task-multi", "Multi"));

    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(eventStore.read()).resolves.toMatchObject([
      { id: { value: "event-Multi-1" }, context: { version: { number: 1 } } },
      { id: { value: "event-Multi-2" }, context: { version: { number: 2 } } },
    ]);
    await expect(storage.readCurrent("task-multi")).resolves.toMatchObject({
      entityId: "task-multi",
      version: 2n,
      state: { id: "task-multi", name: "Multi two (applied)", archived: true },
    });
  });

  it("awaits async aggregate command assignees before storing produced events", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createAsyncAssigneeRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });

    const completion = context
      .commandBus()
      .post(createAggregateCommand("command-async", "task-async", "Async"));

    await vi.waitFor(() => {
      expect(AsyncAssigneeAggregate.resolveCommand).toBeTypeOf("function");
    });
    await expect(storage.readCurrent("task-async")).resolves.toBeUndefined();

    AsyncAssigneeAggregate.resolveCommand?.("Async");
    await completion;

    await expect(storage.readCurrent("task-async")).resolves.toMatchObject({
      entityId: "task-async",
      version: 1n,
      state: { name: "Async (applied)" },
    });
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
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-dispatch-failure", "task-dispatch")),
    ).resolves.toBeUndefined();

    await expect(eventStore.read()).resolves.toMatchObject([{ id: { value: "event-Task" } }]);
    await expect(storage.readCurrent("task-dispatch")).resolves.toMatchObject({
      entityId: "task-dispatch",
      version: 1n,
    });
    await withTimeout(
      dispatchAttempted.promise,
      "process-manager command produced-event dispatch attempt",
    );

    const [failure] = await waitForFailures(context, 1);
    expect(failure).toMatchObject({
      event: { id: { value: "event-Task" } },
      error: { name: "Error", message: "dispatch failed after commit" },
    });
    expect(failure?.error).not.toBe(dispatchFailure);
  });

  it("allows a causally nested command while the outer stored-event follow-up remains pending", async () => {
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
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(outerResolved).toBe(true);

    nestedGate.resolve();
    await outerCompletion;
    await nestedFinished.promise;
  });

  it("executes managed aggregate commands when only event reaction metadata is registered", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createNoApplierRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createAggregateCommand("command-no-applier", "task-no-applier")),
    ).resolves.toBeUndefined();
    await expect(eventStore.read()).resolves.toMatchObject([
      {
        id: { value: "command-no-applier-1" },
        context: { version: { number: 1 } },
      },
    ]);
  });

  it("preserves a returned framework envelope without reconstructing aggregate state", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createMalformedEventRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createAggregateCommand("command-malformed", "task-malformed")),
    ).resolves.toBeUndefined();
    await expect(eventStore.read()).resolves.toMatchObject([{ id: { value: "event-malformed" } }]);
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
  });

  it("rejects state-transition validation failures before storing aggregate output", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createTransitionViolatingRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-transition-invalid", "task-transition-invalid")),
    ).resolves.toBeUndefined();

    await expect(eventStore.read()).resolves.toEqual([]);
    await expect(storage.readCurrent("task-transition-invalid")).resolves.toBeUndefined();
  });

  it("clears rejected transition markers when a fresh transaction succeeds", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createRecoveringTransitionRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-transition-recovers", "task-recovers")),
    ).resolves.toBeUndefined();

    await expect(storage.readCurrent("task-recovers")).resolves.toMatchObject({
      entityId: "task-recovers",
      version: 1n,
      state: { id: "task-recovers", name: "Task recovered" },
    });
  });

  it("keeps stored aggregate history tenant-scoped for multitenant command execution", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.multitenant("Tasks")
      .add(createExecutingRepository())
      .withStorageFactory(factory)
      .build();
    const tenantAStorage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-a") },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });
    const tenantBStorage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-b") },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });

    await context
      .commandBus()
      .post(createAggregateCommand("command-tenant-a", "shared-task", "TenantA", "tenant-a"));
    await context
      .commandBus()
      .post(createAggregateCommand("command-tenant-b", "shared-task", "TenantB", "tenant-b"));

    await expect(tenantAStorage.readCurrent("shared-task")).resolves.toMatchObject({
      entityId: "shared-task",
      version: 1n,
      state: { name: "TenantA (applied)" },
    });
    await expect(tenantBStorage.readCurrent("shared-task")).resolves.toMatchObject({
      entityId: "shared-task",
      version: 1n,
      state: { name: "TenantB (applied)" },
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
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
    });
    await storage.writeCurrent({
      entityId: "task-overflow",
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
    ).resolves.toBeUndefined();
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

  it("packs a message aggregate ID into its produced event producer ID", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createMessageIdProducingRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const taskId = create(TaskIdSchema, { value: "message-produced-task" });

    await context.commandBus().post(createTaskCommand("command-message-producer", taskId.value));

    const [stored] = await eventStore.read();
    expect(AnyMessages.unpack(stored?.context?.producerId as never, TaskIdSchema)).toEqual(taskId);
  });

  it("routes commands to one aggregate ID by the first command field", () => {
    const repository = createRoutingRepository();
    const command = createAggregateCommand("command-1", "task-1");
    const route = repository.routeCommand(command);

    expect(route).toMatchObject({
      entityId: "task-1",
      messageFullTypeName: AggregateStateSchema.typeName,
      invocation: "deferred",
    });
    expectTypeOf(route.entityId).toEqualTypeOf<string>();

    expect(() => BoundedContext.singleTenant("Tasks").add(repository).build()).not.toThrow();
  });

  it("routes generated nested composite IDs through command, event, and state sources", () => {
    const idA = create(CompositeRouteIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 1,
    });
    const idB = create(CompositeRouteIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 2,
    });
    const repository = createCompositeRouteRepository();
    const message = create(CompositeRouteEventSchema, { id: idA, name: "Composite" });

    expect(
      repository.routeCommand(
        SignalEnvelopes.command({
          id: create(CommandIdSchema, { uuid: "composite-command" }),
          context: create(CommandContextSchema),
          schema: CompositeRouteEventSchema,
          message,
        }),
      ).entityId,
    ).toEqual(idA);
    expect(
      repository.routeEvent(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "composite-producer" }),
          context: create(EventContextSchema, {
            producerId: Identifiers.pack(CompositeRouteIdSchema, idA),
          }),
          schema: CompositeRouteEventSchema,
          message: create(CompositeRouteEventSchema, { id: idB, name: "Producer" }),
        }),
      ).entityIds,
    ).toEqual([idA]);
    expect(
      repository.routeEvent(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "composite-fallback" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "other" })),
          }),
          schema: CompositeRouteEventSchema,
          message: create(CompositeRouteEventSchema, { id: idB, name: "Fallback" }),
        }),
      ).entityIds,
    ).toEqual([idB]);
    expect(
      repositoryAccess.routeStateUpdate(
        repository,
        createStateChangedEvent(
          "composite-state",
          create(CompositeRouteSourceStateSchema, { id: idA, name: "State" }),
        ),
      )?.entityIds,
    ).toEqual([idA]);
  });

  it("deduplicates generated composite route clones without merging their scalar discriminator", () => {
    const idA = create(CompositeRouteIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 1,
    });
    const idB = create(CompositeRouteIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 2,
    });
    const eventRouting = EventRouting.create<CompositeRouteId>().route(
      CompositeRouteEventSchema,
      () => [idA, clone(CompositeRouteIdSchema, idA), idB],
    );
    const stateUpdateRouting = StateUpdateRouting.create<CompositeRouteId>().route(
      CompositeRouteSourceStateSchema,
      () => [idA, clone(CompositeRouteIdSchema, idA), idB],
    );
    const repository = createCompositeRouteRepository(eventRouting, stateUpdateRouting);

    expect(
      repository.routeEvent(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "composite-custom" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "other" })),
          }),
          schema: CompositeRouteEventSchema,
          message: create(CompositeRouteEventSchema, { id: idA, name: "Custom" }),
        }),
      ).entityIds,
    ).toEqual([idA, idB]);
    expect(
      repositoryAccess.routeStateUpdate(
        repository,
        createStateChangedEvent(
          "composite-custom-state",
          create(CompositeRouteSourceStateSchema, { id: idA, name: "State" }),
        ),
      )?.entityIds,
    ).toEqual([idA, idB]);
  });

  it("uses packed descriptor identity for generated composite ID clones", () => {
    const idA = create(CompositeRouteIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 1,
    });
    const idB = create(CompositeRouteIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 2,
    });
    new Repository({ entityType: CompositeRouteProjection, schema: CompositeRouteStateSchema });
    const spec = SpecScanner.scan(CompositeRouteProjection as never);
    const descriptor = entityStorageDescriptor({ name: "Composite", multitenant: false }, spec);

    expect(descriptor.id.key(idA)).toBe(descriptor.id.key(clone(CompositeRouteIdSchema, idA)));
    expect(descriptor.id.key(idA)).not.toBe(descriptor.id.key(idB));
  });

  it("uses an exact Command route instead of the declaration-first field", () => {
    const repository = createRoutingRepository(
      CommandRouting.create<string>().route(AggregateStateSchema, () => "custom-task"),
    );

    expect(
      repository.routeCommand(createAggregateCommand("command-custom", "first-task")),
    ).toMatchObject({
      entityId: "custom-task",
    });
  });

  it("applies exact routes before replacement defaults", () => {
    const exact = createRoutingRepository(
      CommandRouting.create<string>()
        .route(AggregateStateSchema, () => "exact")
        .replaceDefault(() => "replacement"),
    );
    const replacement = createRoutingRepository(
      CommandRouting.create<string>().replaceDefault(() => "replacement"),
    );
    const command = createAggregateCommand("command-precedence", "declaration");

    expect(exact.routeCommand(command).entityId).toBe("exact");
    expect(replacement.routeCommand(command).entityId).toBe("replacement");
  });

  it("selects a Command interface route after exact routes and before the default", () => {
    const token = MessageInterfaces.define<object, readonly [typeof AggregateStateSchema]>([
      AggregateStateSchema,
    ]);
    const repository = createRoutingRepository(
      CommandRouting.create<string>()
        .route(token, () => "interface")
        .replaceDefault(() => "default"),
    );

    expect(
      repository.routeCommand(createAggregateCommand("command-interface", "field")).entityId,
    ).toBe("interface");
    expect(
      createRoutingRepository(
        CommandRouting.create<string>()
          .route(token, () => "interface")
          .route(AggregateStateSchema, () => "exact"),
      ).routeCommand(createAggregateCommand("command-interface-exact", "field")).entityId,
    ).toBe("exact");
  });

  it("rejects a Command interface token with an unregistered member at construction", () => {
    const token = MessageInterfaces.define<
      object,
      readonly [typeof AggregateStateSchema, typeof ProjectionStateSchema]
    >([AggregateStateSchema, ProjectionStateSchema]);

    expect(() =>
      createRoutingRepository(CommandRouting.create<string>().route(token, () => "target")),
    ).toThrow(/unregistered interface member/);
  });

  it("keeps the Command routing snapshot captured by repository construction", () => {
    const routing = CommandRouting.create<string>().replaceDefault(() => "first");
    const repository = createRoutingRepository(routing);
    routing.replaceDefault(() => "second");

    expect(
      repository.routeCommand(createAggregateCommand("command-snapshot", "declaration")).entityId,
    ).toBe("first");
  });

  it("rejects routes that cannot apply to a registered Command", () => {
    expect(() =>
      createRoutingRepository(
        CommandRouting.create<string>().route(ProjectionStateSchema, () => "target"),
      ),
    ).toThrow(/unregistered exact route/);
  });

  it("rejects missing and incompatible custom Command route results", () => {
    expect(() =>
      createRoutingRepository(
        CommandRouting.create<string>().route(AggregateStateSchema, () => "   "),
      ).routeCommand(createAggregateCommand("command-blank-custom", "first")),
    ).toThrow(/ID compatible with the Entity state/);
    expect(() =>
      createRoutingRepository(
        CommandRouting.create<string>().route(AggregateStateSchema, () => 42 as never),
      ).routeCommand(createAggregateCommand("command-number-custom", "first")),
    ).toThrow(/ID compatible with the Entity state/);
    expect(() =>
      createInt32RoutingRepository(
        CommandRouting.create<number>().route(Int32AggregateStateSchema, () => 2 ** 31),
      ).routeCommand(
        SignalEnvelopes.command({
          id: create(CommandIdSchema, { uuid: "command-range-custom" }),
          context: create(CommandContextSchema),
          schema: Int32AggregateStateSchema,
          message: create(Int32AggregateStateSchema, { id: 1, name: "Range" }),
        }),
      ),
    ).toThrow(/ID compatible with the Entity state/);
  });

  it("supplies a default Command context to custom routing", () => {
    let observed: CommandContext | undefined;
    const repository = createRoutingRepository(
      CommandRouting.create<string>().route(AggregateStateSchema, (message, context) => {
        observed = context;
        return message.id;
      }),
    );

    repository.routeCommand(createContextlessAggregateCommand("command-context-route", "task"));

    expect(observed).toEqual(create(CommandContextSchema));
  });

  it("rejects blank first-field command IDs before handler invocation", () => {
    const repository = createRoutingRepository();

    expect(() => repository.routeCommand(createAggregateCommand("command-blank", ""))).toThrow(
      "Repository command routing requires a non-empty first field.",
    );
  });

  it("rejects repeated and map declaration-first Command IDs", () => {
    const repository = createMalformedFirstFieldRepository();
    const repeated = SignalEnvelopes.command({
      id: create(CommandIdSchema, { uuid: "command-repeated-id" }),
      context: create(CommandContextSchema),
      schema: RepeatedIdCommandSchema,
      message: create(RepeatedIdCommandSchema, { id: ["one"] }),
    });
    const mapped = SignalEnvelopes.command({
      id: create(CommandIdSchema, { uuid: "command-map-id" }),
      context: create(CommandContextSchema),
      schema: MapIdCommandSchema,
      message: create(MapIdCommandSchema, { id: { one: "one" } }),
    });

    expect(() => repository.routeCommand(repeated)).toThrow(/singular non-map first field/);
    expect(() => repository.routeCommand(mapped)).toThrow(/singular non-map first field/);
  });

  it("rejects a default-valued declaration-first numeric Command ID", () => {
    const repository = createInt32RoutingRepository();
    const command = SignalEnvelopes.command({
      id: create(CommandIdSchema, { uuid: "command-default-int32" }),
      context: create(CommandContextSchema),
      schema: Int32AggregateStateSchema,
      message: create(Int32AggregateStateSchema, { id: 0, name: "Default" }),
    });

    expect(() => repository.routeCommand(command)).toThrow(/non-default first field/);
  });

  it("prefers a compatible producer ID and falls back for an incompatible producer type", async () => {
    const repository = createRoutingRepository();

    const producerRoute = repository.routeEvent(
      SignalEnvelopes.event({
        id: create(EventIdSchema, { value: "event-1" }),
        context: create(EventContextSchema, {
          producerId: Identifiers.pack("string", "producer-task"),
          version: create(VersionSchema, { number: 1 }),
        }),
        schema: ProjectionEventSchema,
        message: create(ProjectionEventSchema, {
          id: "field-task",
          name: "Task",
          priority: 1,
        }),
      }),
    );
    const firstFieldRoute = repository.routeEvent(
      createProjectionEvent("event-2", "field-task", { producerId: "other-kind" }),
    );

    expect(producerRoute).toMatchObject({
      entityIds: ["producer-task"],
      messageFullTypeName: ProjectionEventSchema.typeName,
      invocation: "deferred",
    });
    expectTypeOf(producerRoute.entityIds).toEqualTypeOf<readonly string[]>();
    expect(firstFieldRoute.entityIds).toEqual(["field-task"]);

    const context = BoundedContext.singleTenant("Tasks").add(repository).build();

    await expect(
      context.eventBus().post(createProjectionEvent("event-3", "posted-task")),
    ).resolves.toBeUndefined();
  });

  it("uses one immutable stable-deduplicated custom Event target plan", () => {
    const returned = ["target-b", "target-a", "target-b"];
    const routing = EventRouting.create<string>().route(ProjectionEventSchema, () => returned);
    const repository = createRoutingRepository(undefined, routing);

    const route = repository.routeEvent(createProjectionEvent("event-custom-targets", "ignored"));
    returned[0] = "mutated";

    expect(route.entityIds).toEqual(["target-b", "target-a"]);
    expect(Object.isFrozen(route.entityIds)).toBe(true);
  });

  it("deduplicates and replays a message target containing an int64 value", async () => {
    Int64MessageIdProjection.calls = 0;
    let routeCalls = 0;
    const eventRouting = EventRouting.create<Int64ProjectionId>().route(
      Int64MessageIdProjectionEventSchema,
      (message) => {
        routeCalls += 1;
        if (message.id === undefined) throw new Error("Expected an int64 message ID.");
        return [message.id, clone(Int64ProjectionIdSchema, message.id)];
      },
    );
    const factory = new InMemoryStorageFactory();
    const repository = createInt64MessageIdProjectionRepository(eventRouting);
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const id = create(Int64ProjectionIdSchema, { value: 42n });
    const event = SignalEnvelopes.event({
      id: create(EventIdSchema, { value: "event-int64-message-id" }),
      context: create(EventContextSchema),
      schema: Int64MessageIdProjectionEventSchema,
      message: create(Int64MessageIdProjectionEventSchema, { id, name: "Int64 ID" }),
    });

    try {
      expect(repository.routeEvent(event).entityIds).toEqual([id]);
      expect(routeCalls).toBe(1);

      await context.eventBus().post(event);
      expect(routeCalls).toBe(2);

      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: factory,
      });
      const rows = await delivery.inbox.read(ShardIndex.single(), {
        statuses: ["TO_DELIVER", "DELIVERED"],
      });
      const stored = rows.find((row) => row.signalId === "event-int64-message-id");
      if (stored === undefined) throw new Error("Expected a delivered int64-ID inbox row.");

      await requireProjectionInboxTarget(repository).replay(stored);
      expect(routeCalls).toBe(2);
      expect(Int64MessageIdProjection.calls).toBe(2);
    } finally {
      await context.close();
    }
  });

  it("hands off, replays, and rehydrates composite Process Manager IDs without rerouting", async () => {
    CompositeRouteProcessManager.reset();
    let routeCalls = 0;
    const routing = EventRouting.create<CompositeRouteId>().route(
      CompositeRouteEventSchema,
      (message) => {
        routeCalls += 1;
        if (message.id === undefined) throw new Error("Expected a composite route ID.");
        return [message.id];
      },
    );
    const factory = new InMemoryStorageFactory();
    const repository = createCompositeRouteProcessManagerRepository(routing);
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const idA = create(CompositeRouteIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 1,
    });
    const idB = create(CompositeRouteIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 2,
    });
    const eventA = SignalEnvelopes.event({
      id: create(EventIdSchema, { value: "event-composite-inbox-a" }),
      context: create(EventContextSchema),
      schema: CompositeRouteEventSchema,
      message: create(CompositeRouteEventSchema, { id: idA, name: "A delivered" }),
    });
    const eventB = SignalEnvelopes.event({
      id: create(EventIdSchema, { value: "event-composite-inbox-b" }),
      context: create(EventContextSchema),
      schema: CompositeRouteEventSchema,
      message: create(CompositeRouteEventSchema, { id: idB, name: "B delivered" }),
    });

    try {
      await context.eventBus().post(eventA);
      await context.eventBus().post(eventB);

      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: factory,
      });
      const rows = await delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] });
      const rowA = rows.find((row) => row.signalId === "event-composite-inbox-a");
      const rowB = rows.find((row) => row.signalId === "event-composite-inbox-b");
      if (rowA === undefined || rowB === undefined) {
        throw new Error("Expected delivered composite Process Manager inbox rows.");
      }

      expect(Identifiers.unpack(CompositeRouteIdSchema, rowA.inboxId.targetId)).toEqual(idA);
      expect(Identifiers.unpack(CompositeRouteIdSchema, rowB.inboxId.targetId)).toEqual(idB);
      expect(routeCalls).toBe(2);

      const target = requireEntityInboxTarget(repository);
      await target.replay(rowA);
      await target.replay(rowB);

      expect(routeCalls).toBe(2);
      expect(CompositeRouteProcessManager.ids).toEqual([idA, idB, idA, idB]);
      await expect(
        context.stand().read(CompositeRouteProcessManagerStateSchema, idA),
      ).resolves.toEqual(
        create(CompositeRouteProcessManagerStateSchema, { id: idA, queue: "A delivered" }),
      );
      await expect(
        context.stand().read(CompositeRouteProcessManagerStateSchema, idB),
      ).resolves.toEqual(
        create(CompositeRouteProcessManagerStateSchema, { id: idB, queue: "B delivered" }),
      );
    } finally {
      await context.close();
    }

    const rehydrated = BoundedContext.singleTenant("Tasks")
      .add(createCompositeRouteProcessManagerRepository(routing))
      .withStorageFactory(factory)
      .build();
    try {
      await expect(
        rehydrated.stand().read(CompositeRouteProcessManagerStateSchema, idA),
      ).resolves.toMatchObject({ id: idA, queue: "A delivered" });
      await expect(
        rehydrated.stand().read(CompositeRouteProcessManagerStateSchema, idB),
      ).resolves.toMatchObject({ id: idB, queue: "B delivered" });
    } finally {
      await rehydrated.close();
    }
  });

  it("packs the complete composite Process Manager ID into produced event context", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createCompositeRouteProcessManagerRepository(undefined, { produces: true }))
      .withStorageFactory(factory)
      .build();
    const id = create(CompositeRouteIdSchema, {
      reader: create(UserIdSchema, { value: "producer" }),
      number: 7,
    });
    const command = SignalEnvelopes.command({
      id: create(CommandIdSchema, { uuid: "command-composite-producer" }),
      context: create(CommandContextSchema),
      schema: CompositeRouteEventSchema,
      message: create(CompositeRouteEventSchema, { id, name: "Produce" }),
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    try {
      await context.commandBus().post(command);

      const [produced] = await waitForStoredEvents(eventStore, 1);
      expect(
        AnyMessages.unpack(produced?.context?.producerId as never, CompositeRouteIdSchema),
      ).toEqual(id);
    } finally {
      await context.close();
    }
  });

  it("rejects malformed composite Entity Inbox targets before invoking the Process Manager", async () => {
    CompositeRouteProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createCompositeRouteProcessManagerRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const event = SignalEnvelopes.event({
      id: create(EventIdSchema, { value: "event-composite-inbox-invalid" }),
      context: create(EventContextSchema),
      schema: CompositeRouteEventSchema,
      message: create(CompositeRouteEventSchema, {
        id: create(CompositeRouteIdSchema, {
          reader: create(UserIdSchema, { value: "valid" }),
          number: 3,
        }),
        name: "Invalid target",
      }),
    });

    try {
      const wrongType = await storePmInboxEvent(
        delivery,
        event,
        new Date("2026-09-03T10:00:00.000Z"),
        1n,
        {
          packedTargetId: Identifiers.pack(UserIdSchema, create(UserIdSchema, { value: "wrong" })),
          targetTypeUrl: TypeUrls.derive(CompositeRouteProcessManagerStateSchema),
        },
      );
      const malformed = await storePmInboxEvent(
        delivery,
        event,
        new Date("2026-09-03T10:00:01.000Z"),
        2n,
        {
          signalId: "event-composite-inbox-malformed",
          packedTargetId: create(AnySchema, {
            typeUrl: TypeUrls.derive(CompositeRouteIdSchema),
            value: new Uint8Array([0xff]),
          }),
          targetTypeUrl: TypeUrls.derive(CompositeRouteProcessManagerStateSchema),
        },
      );
      const target = requireEntityInboxTarget(repository);

      await expect(target.replay(wrongType)).rejects.toThrow(/target ID is incompatible/);
      await expect(target.replay(malformed)).rejects.toThrow(/target ID is incompatible/);
      expect(CompositeRouteProcessManager.calls).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("guards multi-target composite Process Manager delivery by complete ID", async () => {
    CompositeRouteProcessManager.reset();
    let routeCalls = 0;
    const idA = create(CompositeRouteIdSchema, {
      reader: create(UserIdSchema, { value: "guarded" }),
      number: 1,
    });
    const idB = create(CompositeRouteIdSchema, {
      reader: create(UserIdSchema, { value: "guarded" }),
      number: 2,
    });
    const repository = createCompositeRouteProcessManagerRepository(
      EventRouting.create<CompositeRouteId>().route(CompositeRouteEventSchema, () => {
        routeCalls += 1;
        return [idA, clone(CompositeRouteIdSchema, idA), idB];
      }),
      { doubleDispatchGuard: true },
    );
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const dispatcher = repositoryAccess.eventDispatcher(repository);
    if (dispatcher === undefined)
      throw new Error("Expected a composite Process Manager dispatcher.");
    const duplicate = SignalEnvelopes.event({
      id: create(EventIdSchema, { value: "event-composite-guarded" }),
      context: create(EventContextSchema, {
        producerId: Identifiers.pack(CompositeRouteIdSchema, idA),
        version: create(VersionSchema, { number: 1 }),
        timestamp: create(TimestampSchema, { seconds: 1n }),
      }),
      schema: CompositeRouteEventSchema,
      message: create(CompositeRouteEventSchema, { id: idA, name: "Guarded" }),
    });
    const distinct = SignalEnvelopes.event({
      id: create(EventIdSchema, { value: "event-composite-guarded-distinct" }),
      context: create(EventContextSchema, {
        producerId: Identifiers.pack(CompositeRouteIdSchema, idA),
        version: create(VersionSchema, { number: 2 }),
        timestamp: create(TimestampSchema, { seconds: 2n }),
      }),
      schema: CompositeRouteEventSchema,
      message: create(CompositeRouteEventSchema, { id: idA, name: "Distinct" }),
    });

    try {
      await dispatcher.dispatch(duplicate);
      await dispatcher.dispatch(duplicate);
      await dispatcher.dispatch(distinct);

      expect(routeCalls).toBe(3);
      expect(CompositeRouteProcessManager.ids).toEqual([idA, idB, idA, idB]);
    } finally {
      await context.close();
    }
  });

  it("applies exact Event routes before replacement defaults", () => {
    const exact = createRoutingRepository(
      undefined,
      EventRouting.create<string>()
        .route(ProjectionEventSchema, () => ["exact"])
        .replaceDefault(() => ["replacement"]),
    );
    const replacement = createRoutingRepository(
      undefined,
      EventRouting.create<string>().replaceDefault(() => ["replacement"]),
    );
    const event = createProjectionEvent("event-precedence", "declaration");

    expect(exact.routeEvent(event).entityIds).toEqual(["exact"]);
    expect(replacement.routeEvent(event).entityIds).toEqual(["replacement"]);
  });

  it("selects an Event interface route after exact routes and before the default", () => {
    const token = MessageInterfaces.define<object, readonly [typeof ProjectionEventSchema]>([
      ProjectionEventSchema,
    ]);
    const repository = createRoutingRepository(
      undefined,
      EventRouting.create<string>()
        .route(token, () => ["interface"])
        .replaceDefault(() => ["default"]),
    );

    expect(
      repository.routeEvent(createProjectionEvent("event-interface", "field")).entityIds,
    ).toEqual(["interface"]);
    expect(
      createRoutingRepository(
        undefined,
        EventRouting.create<string>()
          .route(token, () => ["interface"])
          .route(ProjectionEventSchema, () => ["exact"]),
      ).routeEvent(createProjectionEvent("event-interface-exact", "field")).entityIds,
    ).toEqual(["exact"]);
  });

  it("keeps the Event routing snapshot captured by repository construction", () => {
    const routing = EventRouting.create<string>().replaceDefault(() => ["first"]);
    const repository = createRoutingRepository(undefined, routing);
    routing.replaceDefault(() => ["second"]);

    expect(
      repository.routeEvent(createProjectionEvent("event-snapshot", "field")).entityIds,
    ).toEqual(["first"]);
  });

  it("accepts an empty custom Event target plan", () => {
    const repository = createRoutingRepository(
      undefined,
      EventRouting.create<string>().route(ProjectionEventSchema, () => []),
    );

    expect(
      repository.routeEvent(createProjectionEvent("event-no-targets", "ignored")).entityIds,
    ).toEqual([]);
  });

  it("suppresses Projection delivery when custom Event routing returns no targets", async () => {
    ExecutingTaskProjection.reset();
    let routeCalls = 0;
    const repository = createExecutingProjectionRepository(
      EventRouting.create<string>().route(ProjectionEventSchema, () => {
        routeCalls += 1;
        return [];
      }),
    );
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();

    try {
      await context.eventBus().post(createProjectionEvent("event-no-delivery", "ignored"));

      expect(routeCalls).toBe(1);
      expect(ExecutingTaskProjection.subscriberCalls).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("uses one custom Event plan for every Aggregate target", async () => {
    GuardedAggregate.reset();
    let routeCalls = 0;
    const repository = createGuardedAggregateRepository(
      EventRouting.create<string>().route(ProjectionEventSchema, () => {
        routeCalls += 1;
        return ["aggregate-one", "aggregate-two"];
      }),
    );
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();

    try {
      await context.eventBus().post(createProjectionEvent("event-aggregate-many", "ignored"));

      expect(routeCalls).toBe(1);
      expect(GuardedAggregate.calls).toBe(2);
    } finally {
      await context.close();
    }
  });

  it("rejects Event routes that cannot apply to a registered receiver", () => {
    expect(() =>
      createRoutingRepository(
        undefined,
        EventRouting.create<string>().route(TaskCreatedSchema, () => ["target"]),
      ),
    ).toThrow(/unregistered exact route/);
  });

  it("validates the complete custom Event target plan before returning it", () => {
    const invalid = createRoutingRepository(
      undefined,
      EventRouting.create<string>().route(ProjectionEventSchema, () => ["valid", "  "]),
    );
    const overflow = createRoutingRepository(
      undefined,
      EventRouting.create<string>().route(ProjectionEventSchema, () =>
        Array.from({ length: 1_001 }, (_, index) => `target-${String(index)}`),
      ),
    );
    const notAnArray = createRoutingRepository(
      undefined,
      EventRouting.create<string>().route(ProjectionEventSchema, () => "target" as never),
    );

    expect(() =>
      invalid.routeEvent(createProjectionEvent("event-invalid-targets", "ignored")),
    ).toThrow(/compatible with the Entity state/);
    expect(() =>
      overflow.routeEvent(createProjectionEvent("event-overflow-targets", "ignored")),
    ).toThrow(/at most 1,000/);
    expect(() =>
      notAnArray.routeEvent(createProjectionEvent("event-non-array-targets", "ignored")),
    ).toThrow(/array of Entity IDs/);
  });

  it("uses a compatible producer without requiring first-field equality", () => {
    const repository = createRoutingRepository();
    const event = SignalEnvelopes.event({
      id: create(EventIdSchema, { value: "event-primitive-unknown" }),
      context: create(EventContextSchema, {
        producerId: AnyMessages.pack(
          StringValueSchema,
          create(StringValueSchema, { value: "Unknown" }),
        ),
        rejection: {},
      }),
      schema: ProjectionEventSchema,
      message: create(ProjectionEventSchema, {
        id: "mismatched-task",
      }),
    });

    expect(repository.routeEvent(event).entityIds).toEqual(["Unknown"]);
  });

  it("routes canonical zero-valued int32 and int64 producer IDs", () => {
    const int32 = createInt32RoutingRepository();
    const int64 = createInt64RoutingRepository();

    expect(
      int32.routeEvent(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "event-int32-producer" }),
          context: create(EventContextSchema, { producerId: Identifiers.pack("int32", 0) }),
          schema: Int32AggregateStateSchema,
          message: create(Int32AggregateStateSchema, { id: 42, name: "Int32" }),
        }),
      ).entityIds,
    ).toEqual([0]);
    expect(
      int64.routeEvent(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "event-int64-producer" }),
          context: create(EventContextSchema, { producerId: Identifiers.pack("int64", 0n) }),
          schema: Int64ProcessManagerStateSchema,
          message: create(Int64ProcessManagerStateSchema, { id: 42n, queue: "Int64" }),
        }),
      ).entityIds,
    ).toEqual([0n]);
  });

  it("routes message-valued event IDs by their primitive value field", () => {
    const repository = createUserIdProjectionRepository();
    const route = repository.routeEvent(
      SignalEnvelopes.event({
        id: create(EventIdSchema, { value: "event-user-id" }),
        context: create(EventContextSchema, {
          producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "producer" })),
          version: create(VersionSchema, { number: 1 }),
        }),
        schema: UserIdSchema,
        message: create(UserIdSchema, { value: "user-id-task" }),
      }),
    );

    expect(route).toMatchObject({
      entityIds: ["user-id-task"],
      messageFullTypeName: UserIdSchema.typeName,
      invocation: "deferred",
    });
  });

  it("routes message-valued event IDs as messages when the entity ID field is a message", () => {
    const repository = createMessageIdTaskRepository();
    const taskId = create(TaskIdSchema, { value: "message-id-task" });
    const route = repository.routeEvent(
      SignalEnvelopes.event({
        id: create(EventIdSchema, { value: "event-message-id-task" }),
        context: create(EventContextSchema, {
          producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "producer" })),
          version: create(VersionSchema, { number: 1 }),
        }),
        schema: TaskCreatedSchema,
        message: create(TaskCreatedSchema, {
          id: taskId,
          taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
          title: "Message ID task",
        }),
      }),
    );

    expect(route).toMatchObject({
      entityIds: [taskId],
      messageFullTypeName: TaskCreatedSchema.typeName,
      invocation: "deferred",
    });
    expectTypeOf(route.entityIds).toEqualTypeOf<readonly TaskId[]>();
  });

  it("routes a message-valued producer ID when it matches the event target ID", () => {
    const repository = createMessageIdTaskRepository();
    const taskId = create(TaskIdSchema, { value: "message-producer-task" });
    const route = repository.routeEvent(
      SignalEnvelopes.event({
        id: create(EventIdSchema, { value: "event-message-producer-task" }),
        context: create(EventContextSchema, {
          producerId: AnyMessages.pack(TaskIdSchema, taskId),
          version: create(VersionSchema, { number: 1 }),
        }),
        schema: TaskCreatedSchema,
        message: create(TaskCreatedSchema, {
          id: taskId,
          taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
          title: "Message producer task",
        }),
      }),
    );

    expect(route.entityIds).toEqual([taskId]);
  });

  it("uses a compatible message-valued producer even when the first field differs", () => {
    const repository = createMessageIdTaskRepository();
    const targetId = create(TaskIdSchema, { value: "message-target-task" });
    const producerId = create(TaskIdSchema, { value: "different-message-producer" });

    expect(
      repository.routeEvent(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "event-message-producer-mismatch" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(TaskIdSchema, producerId),
            version: create(VersionSchema, { number: 1 }),
          }),
          schema: TaskCreatedSchema,
          message: create(TaskCreatedSchema, {
            id: targetId,
            taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
            title: "Mismatched message producer task",
          }),
        }),
      ).entityIds,
    ).toEqual([producerId]);
  });

  it("rejects a malformed producer that claims a compatible message ID type", () => {
    const repository = createMessageIdTaskRepository();

    expect(() =>
      repository.routeEvent(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "event-malformed-message-producer" }),
          context: create(EventContextSchema, {
            producerId: create(AnySchema, {
              typeUrl: TypeUrls.derive(TaskIdSchema),
              value: new Uint8Array([255]),
            }),
          }),
          schema: TaskCreatedSchema,
          message: create(TaskCreatedSchema, {
            id: create(TaskIdSchema, { value: "first-field-task" }),
            taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
            title: "Malformed producer",
          }),
        }),
      ),
    ).toThrow(/readable compatible producer ID/);
  });

  it("falls back to a scalar first field for an incompatible message producer type", () => {
    const repository = createTaskCreatedScalarProjectionRepository();
    const targetId = create(TaskIdSchema, { value: "scalar-target" });

    expect(
      repository.routeEvent(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "event-scalar-producer-mismatch" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(
              TaskIdSchema,
              create(TaskIdSchema, { value: "different-scalar-producer" }),
            ),
            version: create(VersionSchema, { number: 1 }),
          }),
          schema: TaskCreatedSchema,
          message: create(TaskCreatedSchema, {
            id: targetId,
            taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
            title: "Mismatched scalar producer task",
          }),
        }),
      ).entityIds,
    ).toEqual([targetId.value]);
  });

  it("falls back from a message producer to its matching scalar first field", () => {
    const repository = createTaskCreatedScalarProjectionRepository();
    const id = create(TaskIdSchema, { value: "matching-scalar-target" });

    expect(
      repository.routeEvent(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "event-scalar-producer-match" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(TaskIdSchema, id),
            version: create(VersionSchema, { number: 1 }),
          }),
          schema: TaskCreatedSchema,
          message: create(TaskCreatedSchema, {
            id,
            taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
            title: "Matching scalar producer task",
          }),
        }),
      ).entityIds,
    ).toEqual([id.value]);
  });

  it("rejects message-valued event IDs with the wrong message type", () => {
    const repository = createMessageIdTaskRepository();

    expect(() =>
      repository.routeEvent(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "event-wrong-message-id-type" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "producer" })),
            version: create(VersionSchema, { number: 1 }),
          }),
          schema: WrongIdRouteEventSchema,
          message: create(WrongIdRouteEventSchema, {
            id: create(UserIdSchema, { value: "message-id-task" }),
          }),
        }),
      ),
    ).toThrow(/TaskId/);
  });

  it("routes direct repository dispatchers without a bound runtime", async () => {
    ExecutingTaskAggregate.reset();
    ExecutingTaskProjection.reset();
    const aggregate = createExecutingRepository();
    const projection = createExecutingProjectionRepository();
    const commandDispatcher = repositoryAccess.commandDispatcher(aggregate);
    const eventDispatcher = repositoryAccess.eventDispatcher(projection);

    if (commandDispatcher === undefined || eventDispatcher === undefined) {
      throw new Error("Expected repository dispatchers.");
    }

    await commandDispatcher.dispatch(createAggregateCommand("command-direct", "task-direct"));
    await eventDispatcher.dispatch(createProjectionEvent("event-direct", "task-direct"));

    expect(ExecutingTaskAggregate.assigneeCalls).toBe(0);
    expect(ExecutingTaskProjection.subscriberCalls).toBe(0);
  });

  it("executes process-manager command handlers and stores mutated state in Stand", async () => {
    RoutingProcessManager.reset();
    const observed: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [ProjectionEventSchema],
        dispatch: (event) => {
          observed.push(event);
          return Promise.resolve();
        },
      })
      .build();

    await context
      .commandBus()
      .post(createAggregateCommand("command-pm", "pm-task", "ProcessManager"));

    expect(RoutingProcessManager.commandCalls).toBe(1);
    await expect(context.stand().read(ProcessManagerStateSchema, "pm-task")).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-task",
        queue: "ProcessManager assigned",
      }),
    );
    await waitForCondition(() => observed.length === 1);
    expect(observed[0]?.id).toEqual(create(EventIdSchema, { value: "command-pm-1" }));
    const producedMessage = observed[0]?.message;
    if (producedMessage === undefined) {
      throw new Error("Expected a process-manager produced event message.");
    }
    expect(AnyMessages.unpack(producedMessage, ProjectionEventSchema)).toEqual(
      create(ProjectionEventSchema, {
        id: "pm-task",
        name: "ProcessManager event",
        priority: 1,
      }),
    );
  });

  it("retains one command diagnostic when an admitted Process Manager assignment fails", async () => {
    const failure = new Error("admitted Process Manager assignment failed");
    const diagnostics: SpineEvent[] = [];
    const command = createAggregateCommand("pm-command-diagnostic-failure", "pm-command-failure");
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [CommandDispatchedToHandlerSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      RoutingProcessManager.reset(failure);
      await expect(context.commandBus().post(command)).resolves.toBeUndefined();
      await context.close();

      expect(RoutingProcessManager.commandCalls).toBe(1);
      expect(diagnostics).toHaveLength(1);
      expect(
        AnyMessages.unpack(diagnostics[0]?.message as never, CommandDispatchedToHandlerSchema),
      ).toMatchObject({
        receiver: { typeUrl: TypeUrls.derive(ProcessManagerStateSchema) },
        payload: command,
      });
    } finally {
      RoutingProcessManager.reset();
      await context.close();
    }
  });

  it("emits a System command-dispatch diagnostic after aggregate handler admission", async () => {
    const diagnostics: SpineEvent[] = [];
    const command = createAggregateCommand("command-diagnostic", "diagnostic-id", "Diagnostic");
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [CommandDispatchedToHandlerSchema],
        dispatch: (event) => {
          diagnostics.push(event);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await context.commandBus().post(command);
      await waitForCondition(() => diagnostics.length === 1);

      const diagnostic = AnyMessages.unpack(
        diagnostics[0]?.message as never,
        CommandDispatchedToHandlerSchema,
      );
      expect(diagnostic).toMatchObject({
        receiver: { typeUrl: TypeUrls.derive(AggregateStateSchema) },
        payload: command,
        entityType: { impl: { case: "javaClassName", value: "ExecutingTaskAggregate" } },
        whenDispatched: diagnostics[0]?.context?.timestamp,
      });
      expect(diagnostics[0]?.context?.origin).toMatchObject({
        case: "pastMessage",
        value: { message: { typeUrl: TypeUrls.derive(AggregateStateSchema) } },
      });
      expect(context.eventBus().acceptedEventTypes()).not.toContain(
        TypeUrls.derive(CommandDispatchedToHandlerSchema),
      );
    } finally {
      await context.close();
    }
  });

  it("retains one command diagnostic when an admitted handler fails", async () => {
    const failure = new Error("admitted command handler failed");
    const diagnostics: SpineEvent[] = [];
    const command = createAggregateCommand("command-diagnostic-failure", "diagnostic-failure");
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [CommandDispatchedToHandlerSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      ExecutingTaskAggregate.reset(failure);
      await expect(context.commandBus().post(command)).resolves.toBeUndefined();
      await waitForCondition(() => diagnostics.length === 1);

      expect(ExecutingTaskAggregate.assigneeCalls).toBe(1);
      expect(diagnostics).toHaveLength(1);
      expect(
        AnyMessages.unpack(diagnostics[0]?.message as never, CommandDispatchedToHandlerSchema),
      ).toMatchObject({ payload: command });
    } finally {
      ExecutingTaskAggregate.reset();
      await context.close();
    }
  });

  it("does not emit command diagnostics for refused or unroutable commands", async () => {
    const diagnostics: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createValidatingRepository())
      .addEventDispatcher({
        messageSchemas: () => [CommandDispatchedToHandlerSchema],
        dispatch: (event) => {
          diagnostics.push(event);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await expect(
        context.commandBus().post(createValidatedCommand("refused-diagnostic", "refused", "")),
      ).rejects.toThrow(/validation/i);
      await expect(
        context.commandBus().post(createAggregateCommand("unroutable-diagnostic", "unroutable")),
      ).rejects.toThrow(/dispatcher/i);
      await context.close();

      expect(diagnostics).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("preserves tenant context for aggregate and process-manager command diagnostics", async () => {
    const aggregateDiagnostics: SpineEvent[] = [];
    const aggregate = BoundedContext.multitenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [CommandDispatchedToHandlerSchema],
        dispatch: (event) => {
          aggregateDiagnostics.push(event);
          return Promise.resolve();
        },
      })
      .build();
    const processManagerDiagnostics: SpineEvent[] = [];
    const processManager = BoundedContext.multitenant("ProcessManagers")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [CommandDispatchedToHandlerSchema],
        dispatch: (event) => {
          processManagerDiagnostics.push(event);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await aggregate.commandBus().post(createAggregateCommand("diagnostic-a", "same", "A", "a"));
      await aggregate.commandBus().post(createAggregateCommand("diagnostic-b", "same", "B", "b"));
      await processManager
        .commandBus()
        .post(createAggregateCommand("diagnostic-pm", "pm", "PM", "pm-tenant"));
      await waitForCondition(
        () => aggregateDiagnostics.length === 2 && processManagerDiagnostics.length === 1,
      );

      expect(diagnosticTenants(aggregateDiagnostics)).toEqual(["a", "b"]);
      expect(diagnosticTenants(processManagerDiagnostics)).toEqual(["pm-tenant"]);
      expect(
        AnyMessages.unpack(
          processManagerDiagnostics[0]?.message as never,
          CommandDispatchedToHandlerSchema,
        ),
      ).toMatchObject({
        receiver: { typeUrl: TypeUrls.derive(ProcessManagerStateSchema) },
        entityType: { impl: { case: "javaClassName", value: "RoutingProcessManager" } },
      });
    } finally {
      await Promise.all([aggregate.close(), processManager.close()]);
    }
  });

  it("isolates command diagnostic publication failure from admitted handler work", async () => {
    ExecutingTaskAggregate.reset();
    const diagnostics: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [CommandDispatchedToHandlerSchema],
        dispatch: (event) => {
          diagnostics.push(event);
          return Promise.reject(new Error("diagnostic dispatch failed"));
        },
      })
      .build();

    try {
      await expect(
        context.commandBus().post(createAggregateCommand("diagnostic-failure", "failure-id")),
      ).resolves.toBeUndefined();
      await waitForFailures(context, 1);

      expect(ExecutingTaskAggregate.assigneeCalls).toBe(1);
      await expect(context.stand().read(AggregateStateSchema, "failure-id")).resolves.toMatchObject(
        {
          name: "Task (applied)",
        },
      );
      expect(diagnostics).toHaveLength(1);
      expect(context.storedEventDispatchFailures()).toMatchObject([
        { error: { message: "diagnostic dispatch failed" } },
      ]);
    } finally {
      await context.close();
    }
  });

  it("writes process-manager commands to a durable inbox before local delivery", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const observed: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [ProjectionEventSchema],
        dispatch: (event) => {
          observed.push(event);
          return Promise.resolve();
        },
      })
      .withStorageFactory(factory)
      .build();
    const command = createAggregateCommand("command-pm-inbox", "pm-inbox", "ProcessManager");

    await context.commandBus().post(command);

    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });

    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.toEqual([]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toMatchObject([
      {
        signalId: "command-pm-inbox",
        label: "HANDLE_COMMAND",
        status: "DELIVERED",
        inboxId: {
          targetId: Identifiers.pack("string", "pm-inbox"),
          targetTypeUrl: TypeUrls.derive(ProcessManagerStateSchema),
        },
      },
    ]);
    expect(RoutingProcessManager.commandCalls).toBe(1);
    await expect(context.stand().read(ProcessManagerStateSchema, "pm-inbox")).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-inbox",
        queue: "ProcessManager assigned",
      }),
    );
    await waitForCondition(() => observed.length === 1);
    const stored = await delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] });
    const storedCommand = stored[0]?.signal;
    if (storedCommand === undefined) {
      throw new Error("Expected a stored process-manager command signal.");
    }
    const storedEnvelope = AnyMessages.unpack(storedCommand, CommandSchema);
    if (storedEnvelope === undefined) {
      throw new Error("Expected a readable stored process-manager command envelope.");
    }
    expect(storedEnvelope.id).toEqual(command.id);
    expect(storedEnvelope.context).toEqual(command.context);
    expect(storedEnvelope.message?.typeUrl).toBe(command.message?.typeUrl);
    expect(
      storedEnvelope.message === undefined
        ? undefined
        : AnyMessages.unpack(storedEnvelope.message, AggregateStateSchema),
    ).toEqual(
      command.message === undefined
        ? undefined
        : AnyMessages.unpack(command.message, AggregateStateSchema),
    );
  });

  it("rejects process-manager command routing with a missing first-field ID before handler code", async () => {
    RoutingProcessManager.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .build();

    await expect(
      context.commandBus().post(createAggregateCommand("command-pm-missing-id", "")),
    ).rejects.toThrow("Repository command routing requires a non-empty first field.");
    expect(RoutingProcessManager.commandCalls).toBe(0);
    await expect(context.stand().read(ProcessManagerStateSchema, "")).resolves.toBeUndefined();
  });

  it("rejects idless process-manager commands before route, handler, or Stand write", async () => {
    RoutingProcessManager.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .build();

    await expect(
      context.commandBus().post(createIdlessAggregateCommand("pm-idless", "Idless")),
    ).rejects.toThrow("requires command.id");
    expect(RoutingProcessManager.commandCalls).toBe(0);
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-idless"),
    ).resolves.toBeUndefined();
  });

  it("rejects blank process-manager command ids before handler or Stand write", async () => {
    RoutingProcessManager.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .build();

    await expect(
      context.commandBus().post(createAggregateCommand("   ", "pm-blank-id", "BlankId")),
    ).rejects.toThrow(/command\.id/i);
    expect(RoutingProcessManager.commandCalls).toBe(0);
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-blank-id"),
    ).resolves.toBeUndefined();
  });

  it("stores process-manager command state in the command tenant", async () => {
    RoutingProcessManager.reset();
    const context = BoundedContext.multitenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .build();

    await context
      .commandBus()
      .post(createAggregateCommand("command-pm-tenant", "pm-tenant", "Tenant PM", "tenant-a"));

    await expect(
      context
        .stand()
        .read(ProcessManagerStateSchema, "pm-tenant", { tenantId: createTenantId("tenant-a") }),
    ).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-tenant",
        queue: "Tenant PM assigned",
      }),
    );
    await expect(
      context
        .stand()
        .read(ProcessManagerStateSchema, "pm-tenant", { tenantId: createTenantId("tenant-b") }),
    ).resolves.toBeUndefined();
  });

  it("rejects multitenant process-manager handoff without a tenant before inbox write", async () => {
    RoutingProcessManager.reset();
    const factory = new ObservingStorageFactory();
    const context = BoundedContext.multitenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .withStorageFactory(factory)
      .build();
    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-pm-missing-tenant", "pm-no-tenant")),
    ).rejects.toThrow(/tenant/i);

    expect(RoutingProcessManager.commandCalls).toBe(0);
  });

  it("rejects process-manager handoff success when another worker already owns the shard", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .withStorageFactory(factory)
      .build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const shard = ShardIndex.single();
    const session = await delivery.shards.pickUp(
      shard,
      create(WorkerIdSchema, { nodeId: { value: "node-a" }, value: "worker-a" }),
    );

    try {
      await expect(
        context.commandBus().post(createAggregateCommand("command-pm-preclaimed", "pm-preclaimed")),
      ).rejects.toThrow(/deliver/i);

      expect(session).toBeDefined();
      expect(RoutingProcessManager.commandCalls).toBe(0);
      await expect(
        delivery.inbox.read(shard, { statuses: ["TO_DELIVER"], limit: 10 }),
      ).resolves.toMatchObject([{ signalId: "command-pm-preclaimed", status: "TO_DELIVER" }]);
      const s = session;
      if (s === undefined) {
        throw new Error("Expected session.");
      }
    } finally {
      if (session !== undefined) {
        await delivery.shards.release(session);
      }
    }
  });

  it("delivers the exact process-manager row despite older pending backlog", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .withStorageFactory(factory)
      .build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });

    for (let index = 0; index < 100; index += 1) {
      const hh = String(Math.floor(index / 60)).padStart(2, "0");
      const mm = String(index % 60).padStart(2, "0");
      await storeEntityInboxCommand(
        delivery,
        createAggregateCommand(
          `command-backlog-${String(index).padStart(3, "0")}`,
          `pm-backlog-${String(index).padStart(3, "0")}`,
          `Backlog ${String(index).padStart(3, "0")}`,
        ),
        new Date(`2026-07-08T09:${hh}:${mm}.000Z`),
        BigInt(index + 1),
      );
    }

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-pm-page-target", "pm-page-target", "Page target")),
    ).resolves.toBeUndefined();

    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-page-target"),
    ).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-page-target",
        queue: "Page target assigned",
      }),
    );
    await expect(
      delivery.inbox.read(ShardIndex.single(), {
        statuses: ["TO_DELIVER"],
        limit: 200,
      }),
    ).resolves.not.toContainEqual(expect.objectContaining({ signalId: "command-pm-page-target" }));
  });

  it("rejects Entity Inbox replay when the stored command tenant mismatches delivery tenant", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.multitenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-a") },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const received = await storeEntityInboxCommand(
      delivery,
      createAggregateCommand(
        "command-pm-tenant-mismatch",
        "pm-tenant-mismatch",
        "Tenant mismatch",
        "tenant-b",
      ),
      new Date("2026-07-08T09:00:00.000Z"),
      1n,
    );

    await expect(target.replay(received, createTenantId("tenant-a"))).rejects.toThrow(/tenant/i);

    expect(RoutingProcessManager.commandCalls).toBe(0);
  });

  it("uses the persisted Entity Inbox target without rerouting the command", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const command = createAggregateCommand("command-pm-route-mismatch", "pm-routed", "Routed");
    const wrongId = await storeEntityInboxCommand(
      delivery,
      command,
      new Date("2026-07-08T09:01:00.000Z"),
      1n,
      {
        targetId: Identifiers.pack("string", "pm-forged"),
      },
    );
    const wrongType = await storeEntityInboxCommand(
      delivery,
      command,
      new Date("2026-07-08T09:02:00.000Z"),
      2n,
      {
        targetTypeUrl: "type.example.dev/forged.ProcessManager",
      },
    );
    const incompatibleId = await storeEntityInboxCommand(
      delivery,
      command,
      new Date("2026-07-08T09:02:30.000Z"),
      3n,
      {
        targetId: Identifiers.pack("int32", 1),
      },
    );

    await expect(target.replay(wrongId)).resolves.toBeUndefined();
    await expect(target.replay(wrongType)).rejects.toThrow(/target/i);
    await expect(target.replay(incompatibleId)).rejects.toThrow(/target ID is incompatible/);

    expect(RoutingProcessManager.commandCalls).toBe(1);
  });

  it("does not call Command interface routing again during replay", async () => {
    RoutingProcessManager.reset();
    let routeCalls = 0;
    const token = MessageInterfaces.define<object, readonly [typeof AggregateStateSchema]>([
      AggregateStateSchema,
    ]);
    const routing = CommandRouting.create<string>().route(token, (message) => {
      routeCalls += 1;
      return message.id;
    });
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository(routing);
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    try {
      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: factory,
      });
      const target = requireEntityInboxTarget(repository);
      const command = createAggregateCommand("command-pm-count", "pm-count", "Counted");
      await context.commandBus().post(command);
      await waitForCondition(() => RoutingProcessManager.commandCalls === 1);
      expect(routeCalls).toBe(1);
      const replayCommand = createAggregateCommand(
        "command-pm-count-replay",
        "pm-count",
        "Counted replay",
      );
      const received = await storeEntityInboxCommand(
        delivery,
        replayCommand,
        new Date("2026-07-08T09:02:15.000Z"),
        1n,
        { targetId: Identifiers.pack("string", "pm-count") },
      );

      await expect(target.replay(received)).resolves.toBeUndefined();

      expect(routeCalls).toBe(1);
      expect(RoutingProcessManager.commandCalls).toBe(2);
    } finally {
      await context.close();
    }
  });

  it("does not call custom Aggregate routing again for a stored message ID", async () => {
    let routeCalls = 0;
    const routing = CommandRouting.create<TaskId>().route(TaskSchema, (message) => {
      routeCalls += 1;
      if (message.id === undefined) throw new Error("Expected a Task ID.");
      return message.id;
    });
    const factory = new InMemoryStorageFactory();
    const repository = createMessageIdProducingRepository(routing);
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    try {
      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: factory,
      });
      const target = requireEntityInboxTarget(repository);
      const command = createTaskCommand("command-message-count", "message-count", "Counted");
      await context.commandBus().post(command);
      await expect(
        context.stand().read(TaskSchema, create(TaskIdSchema, { value: "message-count" })),
      ).resolves.toBeDefined();
      expect(routeCalls).toBe(1);
      const replayCommand = createTaskCommand(
        "command-message-count-replay",
        "message-count",
        "Counted replay",
      );
      const received = await storeEntityInboxCommand(
        delivery,
        replayCommand,
        new Date("2026-07-08T09:02:20.000Z"),
        1n,
        {
          targetId: Identifiers.pack(
            TaskIdSchema,
            create(TaskIdSchema, { value: "message-count" }),
          ),
          targetTypeUrl: TypeUrls.derive(TaskSchema),
        },
      );

      await expect(target.replay(received)).resolves.toBeDefined();

      expect(routeCalls).toBe(1);
    } finally {
      await context.close();
    }
  });

  it("rejects an empty implicit Command ID during durable Aggregate replay", async () => {
    ImplicitIdAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createImplicitIdAggregateRepository();
    const context = BoundedContext.singleTenant("Implicit replay")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    try {
      const delivery = new Delivery({
        context: { name: "Implicit replay", multitenant: false },
        storageFactory: factory,
      });
      const received = await storeEntityInboxCommand(
        delivery,
        createImplicitTaskCommand("implicit-replay", ""),
        new Date("2026-08-11T10:00:00.000Z"),
        1n,
        {
          targetId: Identifiers.pack("string", "target"),
          targetTypeUrl: TypeUrls.derive(AggregateStateSchema),
        },
      );

      await expect(requireEntityInboxTarget(repository).replay(received)).rejects.toBeInstanceOf(
        CommandValidationError,
      );
      expect(ImplicitIdAggregate.calls).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("rejects empty implicit state IDs before every Entity-family commit", async () => {
    BlankStateIdAggregate.calls = 0;
    BlankStateIdProcessManager.calls = 0;
    BlankStateIdProjection.calls = 0;
    const aggregate = BoundedContext.singleTenant("Blank aggregate ID")
      .add(createBlankStateIdAggregateRepository())
      .build();
    const processManager = BoundedContext.singleTenant("Blank PM ID")
      .add(createBlankStateIdProcessManagerRepository())
      .build();
    const projection = BoundedContext.singleTenant("Blank projection ID")
      .add(createBlankStateIdProjectionRepository())
      .build();
    try {
      await expect(
        aggregate.commandBus().post(createAggregateCommand("blank-aggregate", "aggregate-id")),
      ).resolves.toBeUndefined();
      await expect(
        processManager.commandBus().post(createAggregateCommand("blank-pm", "pm-id")),
      ).resolves.toBeUndefined();
      await expect(
        projection.eventBus().post(createProjectionEvent("blank-projection", "projection-id")),
      ).resolves.toBeUndefined();

      expect(BlankStateIdAggregate.calls).toBe(1);
      expect(BlankStateIdProcessManager.calls).toBe(1);
      expect(BlankStateIdProjection.calls).toBe(1);
      await expect(
        aggregate.stand().read(AggregateStateSchema, "aggregate-id"),
      ).resolves.toBeUndefined();
      await expect(
        processManager.stand().read(ProcessManagerStateSchema, "pm-id"),
      ).resolves.toBeUndefined();
      await expect(
        projection.stand().read(ProjectionStateSchema, "projection-id"),
      ).resolves.toBeUndefined();
    } finally {
      await Promise.all([aggregate.close(), processManager.close(), projection.close()]);
    }
  });

  it("reconstructs stored int32 and int64 targets without rerouting", async () => {
    const int32Factory = new InMemoryStorageFactory();
    const int32Repository = createInt32RoutingRepository();
    BoundedContext.singleTenant("Numeric int32")
      .add(int32Repository)
      .withStorageFactory(int32Factory)
      .build();
    const int32Command = SignalEnvelopes.command({
      id: create(CommandIdSchema, { uuid: "command-numeric-int32" }),
      context: create(CommandContextSchema),
      schema: Int32AggregateStateSchema,
      message: create(Int32AggregateStateSchema, { id: 42, name: "Int32" }),
    });
    const int32Message = await storeEntityInboxCommand(
      new Delivery({
        context: { name: "Numeric int32", multitenant: false },
        storageFactory: int32Factory,
      }),
      int32Command,
      new Date("2026-07-08T09:02:21.000Z"),
      1n,
      {
        targetId: Identifiers.pack("int32", 42),
        targetTypeUrl: TypeUrls.derive(Int32AggregateStateSchema),
      },
    );

    expect(int32Repository.routeCommand(int32Command).entityId).toBe(42);
    await expect(
      requireEntityInboxTarget(int32Repository).replay(int32Message),
    ).resolves.toBeUndefined();

    const int64Factory = new InMemoryStorageFactory();
    const int64Repository = createInt64RoutingRepository();
    BoundedContext.singleTenant("Numeric int64")
      .add(int64Repository)
      .withStorageFactory(int64Factory)
      .build();
    const int64Command = SignalEnvelopes.command({
      id: create(CommandIdSchema, { uuid: "command-numeric-int64" }),
      context: create(CommandContextSchema),
      schema: Int64ProcessManagerStateSchema,
      message: create(Int64ProcessManagerStateSchema, { id: 42n, queue: "Int64" }),
    });
    const int64Message = await storeEntityInboxCommand(
      new Delivery({
        context: { name: "Numeric int64", multitenant: false },
        storageFactory: int64Factory,
      }),
      int64Command,
      new Date("2026-07-08T09:02:22.000Z"),
      1n,
      {
        targetId: Identifiers.pack("int64", 42n),
        targetTypeUrl: TypeUrls.derive(Int64ProcessManagerStateSchema),
      },
    );

    expect(int64Repository.routeCommand(int64Command).entityId).toBe(42n);
    await expect(
      requireEntityInboxTarget(int64Repository).replay(int64Message),
    ).resolves.toBeUndefined();
  });

  it("publishes descriptor-typed numeric Entity IDs in system event contexts", async () => {
    const int32Events: SpineEvent[] = [];
    const int32Context = BoundedContext.singleTenant("Numeric int32 producer")
      .add(createInt32RoutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityCreatedSchema, EntityStateChangedSchema],
        dispatch: (event) => {
          int32Events.push(event);
          return Promise.resolve();
        },
      })
      .build();
    const int64Events: SpineEvent[] = [];
    const int64Context = BoundedContext.singleTenant("Numeric int64 producer")
      .add(createInt64RoutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityCreatedSchema, EntityStateChangedSchema],
        dispatch: (event) => {
          int64Events.push(event);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await int32Context.commandBus().post(
        SignalEnvelopes.command({
          id: create(CommandIdSchema, { uuid: "command-int32-producer" }),
          context: create(CommandContextSchema),
          schema: Int32AggregateStateSchema,
          message: create(Int32AggregateStateSchema, { id: 42, name: "Int32" }),
        }),
      );
      await int64Context.commandBus().post(
        SignalEnvelopes.command({
          id: create(CommandIdSchema, { uuid: "command-int64-producer" }),
          context: create(CommandContextSchema),
          schema: Int64ProcessManagerStateSchema,
          message: create(Int64ProcessManagerStateSchema, { id: 42n, queue: "Int64" }),
        }),
      );
      await waitForCondition(() => int32Events.length === 2 && int64Events.length === 2);

      expect(
        int32Events.map(
          (event) =>
            AnyMessages.unpack(event.context?.producerId as never, Int32ValueSchema)?.value,
        ),
      ).toEqual([42, 42]);
      expect(
        int64Events.map(
          (event) =>
            AnyMessages.unpack(event.context?.producerId as never, Int64ValueSchema)?.value,
        ),
      ).toEqual([42n, 42n]);
    } finally {
      await Promise.all([int32Context.close(), int64Context.close()]);
    }
  });

  it("rejects Entity Inbox replay before the repository is bound to a runtime", async () => {
    const repository = createProcessManagerAssignRepository();
    const target = requireEntityInboxTarget(repository);

    await expect(
      target.replay({
        id: {
          value: "message-pm-unbound",
          shard: ShardIndex.single(),
        },
        inboxId: {
          targetId: Identifiers.pack("string", "pm-unbound"),
          targetTypeUrl: TypeUrls.derive(ProcessManagerStateSchema),
        },
        signalId: "command-pm-unbound",
        label: "HANDLE_COMMAND",
        status: "DELIVERED",
        shard: ShardIndex.single(),
        whenReceived: new Date("2026-07-08T09:02:30.000Z"),
        version: 1n,
      }),
    ).rejects.toThrow("Entity Inbox replay requires a bound repository runtime.");
  });

  it("rejects Entity Inbox replay for UPDATE_SUBSCRIBER messages before handler code", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const received = await storeEntityInboxCommand(
      delivery,
      createAggregateCommand("command-pm-update-subscriber", "pm-update-subscriber", "Update"),
      new Date("2026-07-08T09:03:00.000Z"),
      1n,
    );

    await expect(
      target.replay({
        ...received,
        label: "UPDATE_SUBSCRIBER",
      }),
    ).rejects.toThrow(/does not handle/);

    expect(RoutingProcessManager.commandCalls).toBe(0);
  });

  it("rejects Entity Inbox replay without a signal as invalid payload before handler code", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const received = await storeEntityInboxCommand(
      delivery,
      createAggregateCommand("command-pm-no-signal", "pm-no-signal", "No signal"),
      new Date("2026-07-08T09:03:30.000Z"),
      1n,
    );

    const withoutSignal: InboxMessage = {
      id: received.id,
      inboxId: received.inboxId,
      signalId: received.signalId,
      label: received.label,
      status: received.status,
      shard: received.shard,
      whenReceived: received.whenReceived,
      version: received.version,
      ...(received.keepUntil === undefined ? {} : { keepUntil: received.keepUntil }),
    };

    await expect(target.replay(withoutSignal)).rejects.toThrow(/validation/i);

    expect(RoutingProcessManager.commandCalls).toBe(0);
  });

  it("rejects multitenant Entity Inbox replay without delivery tenant", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.multitenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-a") },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const received = await storeEntityInboxCommand(
      delivery,
      createAggregateCommand(
        "command-pm-missing-delivery-tenant",
        "pm-missing-delivery-tenant",
        "Tenant metadata",
        "tenant-a",
      ),
      new Date("2026-07-08T09:04:00.000Z"),
      1n,
    );

    await expect(target.replay(received)).rejects.toThrow(/requires tenantId/);

    expect(RoutingProcessManager.commandCalls).toBe(0);
  });

  it("rejects multitenant Entity Inbox replay when stored command tenant metadata is missing", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.multitenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-a") },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const received = await storeEntityInboxCommand(
      delivery,
      createAggregateCommand(
        "command-pm-missing-stored-tenant",
        "pm-missing-stored-tenant",
        "Missing tenant metadata",
      ),
      new Date("2026-07-08T09:04:30.000Z"),
      1n,
    );

    await expect(target.replay(received, createTenantId("tenant-a"))).rejects.toThrow(
      /stored command tenant metadata/,
    );

    expect(RoutingProcessManager.commandCalls).toBe(0);
  });

  it("rejects invalid stored process-manager command payloads before handler code", async () => {
    ValidatingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createValidatingProcessManagerRepository();
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const received = await storeEntityInboxCommand(
      delivery,
      createValidatedCommand("command-pm-invalid-replay", "pm-invalid-replay", ""),
      new Date("2026-07-08T09:03:00.000Z"),
      1n,
      {
        targetTypeUrl: TypeUrls.derive(ProcessManagerStateSchema),
      },
    );

    await expect(target.replay(received)).rejects.toThrow(/validation/i);

    expect(ValidatingProcessManager.commandCalls).toBe(0);
  });

  it("rejects idless Entity Inbox replay before handler or Stand write", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const received = await storeEntityInboxCommand(
      delivery,
      createIdlessAggregateCommand("pm-idless-replay", "Idless replay"),
      new Date("2026-07-08T09:03:15.000Z"),
      1n,
    );

    await expect(target.replay(received)).rejects.toThrow("requires command.id");

    expect(RoutingProcessManager.commandCalls).toBe(0);
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-idless-replay"),
    ).resolves.toBeUndefined();
  });

  it("rejects blank Entity Inbox replay command ids before handler or Stand write", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const received = await storeEntityInboxCommand(
      delivery,
      createAggregateCommand("   ", "pm-blank-replay", "Blank replay"),
      new Date("2026-07-08T09:03:15.000Z"),
      1n,
      { signalId: "pm-blank-replay-signal" },
    );

    await expect(target.replay(received)).rejects.toThrow(/command\.id/i);

    expect(RoutingProcessManager.commandCalls).toBe(0);
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-blank-replay"),
    ).resolves.toBeUndefined();
  });

  it("appends process-manager command-produced events and records later dispatch failures", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const dispatchAttempted = createSignal();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [ProjectionEventSchema],
        dispatch: () => {
          dispatchAttempted.resolve();
          return Promise.reject(new Error("process-manager command event dispatch failed"));
        },
      })
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createAggregateCommand("command-pm-dispatch", "pm-dispatch")),
    ).resolves.toBeUndefined();

    expect(RoutingProcessManager.commandCalls).toBe(1);
    await expect(context.stand().read(ProcessManagerStateSchema, "pm-dispatch")).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-dispatch",
        queue: "Task assigned",
      }),
    );
    const stored = await eventStore.read();

    expect(stored).toMatchObject([{ id: { value: "command-pm-dispatch-1" } }]);
    expect(stored[0]?.context?.timestamp).toBeDefined();
    expect(readReadableProducerId(stored[0])).toBe("pm-dispatch");
    expect(stored[0]?.context?.version).toEqual(create(VersionSchema, { number: 1 }));
    expect(stored[0]?.context?.origin).toEqual({
      case: "pastMessage",
      value: create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: AnyMessages.pack(
            CommandIdSchema,
            create(CommandIdSchema, { uuid: "command-pm-dispatch" }),
          ),
          typeUrl: TypeUrls.derive(AggregateStateSchema),
        }),
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "user-1" }),
        }),
      }),
    });
    await withTimeout(
      dispatchAttempted.promise,
      "process-manager command produced-event dispatch attempt",
    );
    const [failure] = await waitForFailures(context, 1);
    expect(failure).toMatchObject({
      event: { id: { value: "command-pm-dispatch-1" } },
      error: { name: "Error", message: "process-manager command event dispatch failed" },
    });
  });

  it("preserves a pre-existing process manager when a command is rejected", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });

    await context
      .commandBus()
      .post(createAggregateCommand("command-pm-existing", "pm-rejected", "Persisted"));
    const stateBeforeRejection = await context
      .stand()
      .readVersioned(ProcessManagerStateSchema, "pm-rejected");
    const eventsBeforeRejection = await eventStore.read();

    expect(stateBeforeRejection).toEqual({
      state: create(ProcessManagerStateSchema, {
        id: "pm-rejected",
        queue: "Persisted assigned",
      }),
      version: create(VersionSchema, { number: 1 }),
    });
    expect(eventsBeforeRejection).toHaveLength(1);

    RoutingProcessManager.reset(
      TaskAlreadyDone.create({
        id: create(GeneratedTaskIdSchema, { value: "pm-rejected" }),
      }),
    );

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-pm-rejected", "pm-rejected", "Already done")),
    ).resolves.toBeUndefined();

    await expect(
      context.stand().readVersioned(ProcessManagerStateSchema, "pm-rejected"),
    ).resolves.toEqual(stateBeforeRejection);
    const storedEvents = await waitForStoredEvents(eventStore, 2);
    const rejectionEvents = storedEvents.filter((event) => event.context?.rejection !== undefined);
    const [event] = rejectionEvents;

    expect(storedEvents.slice(0, eventsBeforeRejection.length)).toEqual(eventsBeforeRejection);
    expect(rejectionEvents).toHaveLength(1);
    expect(event).toMatchObject({
      id: { value: "command-pm-rejected-1" },
      context: {
        rejection: {
          command: { id: { uuid: "command-pm-rejected" } },
        },
      },
    });
    expect(readReadableProducerId(event)).toBe("pm-rejected");
    expect(event?.context?.version).toBeUndefined();
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["TO_DELIVER"] }),
    ).resolves.not.toContainEqual(expect.objectContaining({ signalId: "command-pm-rejected" }));
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        signalId: "command-pm-rejected",
        label: "HANDLE_COMMAND",
        status: "DELIVERED",
      }),
    );
  });

  it("marks technical process-manager failures delivered after reporting them", async () => {
    RoutingProcessManager.reset(new Error("technical process-manager failure"));
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });

    await expect(
      context.commandBus().post(createAggregateCommand("command-pm-technical", "pm-technical")),
    ).resolves.toBeUndefined();

    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-technical"),
    ).resolves.toBeUndefined();
    await expect(eventStore.read()).resolves.toEqual([]);
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        signalId: "command-pm-technical",
        label: "HANDLE_COMMAND",
        status: "DELIVERED",
      }),
    );
    RoutingProcessManager.reset();
  });

  it("stores process-manager event inbox rows before invoking event reactors", async () => {
    const factory = new InMemoryStorageFactory();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    InboxCheckingProcessManager.reset(delivery);
    const context = BoundedContext.singleTenant("Tasks")
      .add(createInboxCheckRepo())
      .withStorageFactory(factory)
      .build();

    await delivery.inbox.receive({
      inboxId: {
        targetId: Identifiers.pack("string", "pm-older"),
        targetTypeUrl: TypeUrls.derive(ProcessManagerStateSchema),
      },
      signalId: "event-older",
      signal: AnyMessages.pack(EventSchema, createProjectionEvent("event-older", "pm-older"), {
        validate: false,
      }),
      label: "REACT_UPON_EVENT",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
    });

    await context.eventBus().post(createProjectionEvent("event-pm-inbox-first", "pm-inbox-first"));

    expect(InboxCheckingProcessManager.eventCalls).toBe(2);
    expect(InboxCheckingProcessManager.sawPendingRow).toBe(true);
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-inbox-first"),
    ).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-inbox-first",
        queue: "Task checked",
      }),
    );
    const delivered = await delivery.inbox.read(ShardIndex.single(), {
      statuses: ["DELIVERED"],
    });
    expect(delivered).not.toContainEqual(
      expect.objectContaining({
        signalId: "event-older",
        label: "REACT_UPON_EVENT",
        status: "DELIVERED",
      }),
    );
    expect(delivered).toContainEqual(
      expect.objectContaining({
        signalId: "event-pm-inbox-first",
        label: "REACT_UPON_EVENT",
        status: "DELIVERED",
      }),
    );
  });

  it("deduplicates duplicate live process-manager event delivery locally", async () => {
    BlockingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createBlockingPmRepo();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const dispatcher = repositoryAccess.eventDispatcher(repository);
    const event = createProjectionEvent("event-pm-duplicate", "pm-duplicate");
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });

    if (dispatcher === undefined) {
      throw new Error("Expected a process-manager event dispatcher.");
    }

    const first = dispatcher.dispatch(event);
    await waitForCondition(() => BlockingProcessManager.startedCalls === 1);

    const duplicate = dispatcher.dispatch(event);

    await expect(Promise.race([duplicate.then(() => "resolved"), delay(150)])).resolves.toBe(
      "pending",
    );
    expect(BlockingProcessManager.completedCalls).toBe(0);

    BlockingProcessManager.release();

    await expect(Promise.all([first, duplicate])).resolves.toEqual([undefined, undefined]);
    expect(BlockingProcessManager.startedCalls).toBe(1);
    expect(BlockingProcessManager.completedCalls).toBe(1);
    await expect(context.stand().read(ProcessManagerStateSchema, "pm-duplicate")).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-duplicate",
        queue: "Task blocked",
      }),
    );
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toMatchObject([
      {
        signalId: "event-pm-duplicate",
        label: "REACT_UPON_EVENT",
        status: "DELIVERED",
      },
    ]);
  });

  it("exact-drains later process-manager event rows while retaining an earlier routed failure", async () => {
    SplitRouteProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createSplitPmRepo();
    const routeEvent = repository.routeEvent.bind(repository);
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });

    Object.assign(repository, {
      routeEvent(event: SpineEvent) {
        const route = routeEvent(event);
        return {
          ...route,
          entityIds: Object.freeze(["pm-fail", "pm-later"]),
        };
      },
    });

    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const dispatcher = repositoryAccess.eventDispatcher(repository);

    if (dispatcher === undefined) {
      throw new Error("Expected a process-manager event dispatcher.");
    }

    const posted = dispatcher.dispatch(createProjectionEvent("event-pm-split", "pm-source"));

    await expect(posted).resolves.toBeUndefined();
    expect(SplitRouteProcessManager.startedIds).toEqual(["pm-fail", "pm-later"]);
    expect(SplitRouteProcessManager.completedIds).toEqual(["pm-later"]);

    const delivered = await delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] });
    const failed = delivered.find(
      (message) =>
        message.signalId === "event-pm-split" &&
        message.label === "REACT_UPON_EVENT" &&
        message.status === "DELIVERED" &&
        Identifiers.unpack("string", message.inboxId.targetId) === "pm-fail",
    );
    expect(failed?.inboxId.targetTypeUrl).toBe(TypeUrls.derive(ProcessManagerStateSchema));
    expect(
      delivered.some(
        (message) => Identifiers.unpack("string", message.inboxId.targetId) === "pm-later",
      ),
    ).toBe(true);

    const later = delivered.find(
      (message) =>
        message.signalId === "event-pm-split" &&
        message.label === "REACT_UPON_EVENT" &&
        message.status === "DELIVERED" &&
        Identifiers.unpack("string", message.inboxId.targetId) === "pm-later",
    );
    expect(later?.inboxId.targetTypeUrl).toBe(TypeUrls.derive(ProcessManagerStateSchema));
  });

  it("guards each target of a multi-target Process Manager route independently", async () => {
    SplitRouteProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createGuardedSplitPmRepo(
      EventRouting.create<string>().route(ProjectionEventSchema, () => ["pm-one", "pm-two"]),
    );
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const dispatcher = repositoryAccess.eventDispatcher(repository);
    if (dispatcher === undefined) throw new Error("Expected a process-manager event dispatcher.");

    const event = createProjectionEvent("event-pm-guarded-many", "pm-source");
    await dispatcher.dispatch(event);
    await dispatcher.dispatch(event);

    expect(SplitRouteProcessManager.startedIds).toEqual(["pm-one", "pm-two"]);
    expect(SplitRouteProcessManager.completedIds).toEqual(["pm-one", "pm-two"]);
  });

  it("routes every Aggregate delivery without a durable marker after lane eviction", async () => {
    GuardedAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createGuardedAggregateRepository();
    const routeEvent = repository.routeEvent.bind(repository);
    Object.assign(repository, {
      routeEvent(event: SpineEvent) {
        const entityIds =
          event.id?.value === "event-aggregate-guarded-other"
            ? ["aggregate-other"]
            : ["aggregate-one", "aggregate-two"];
        return { ...routeEvent(event), entityIds: Object.freeze(entityIds) };
      },
    });
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const dispatcher = repositoryAccess.eventDispatcher(repository);
    if (dispatcher === undefined) throw new Error("Expected an aggregate event dispatcher.");

    const event = createProjectionEvent("event-aggregate-guarded-many", "aggregate-source");
    await dispatcher.dispatch(event);
    await dispatcher.dispatch(
      createProjectionEvent("event-aggregate-guarded-other", "aggregate-other"),
    );
    await dispatcher.dispatch(event);

    expect(GuardedAggregate.calls).toBe(5);
    await context.close();
  });

  it("does not use durable markers to replay a multi-target producing Aggregate event", async () => {
    ProducingGuardedAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const event = createProjectionEvent("event-aggregate-restart", "aggregate-restart-source");

    const firstRepository = createProducingGuardedAggregateRepository();
    routeAggregateTargets(firstRepository, ["aggregate-restart-one", "aggregate-restart-two"]);
    const firstContext = BoundedContext.singleTenant("Tasks")
      .add(firstRepository)
      .withStorageFactory(factory)
      .build();
    const firstDispatcher = repositoryAccess.eventDispatcher(firstRepository);
    if (firstDispatcher === undefined) throw new Error("Expected an aggregate event dispatcher.");
    await firstDispatcher.dispatch(event);
    await firstContext.close();

    const secondRepository = createProducingGuardedAggregateRepository();
    routeAggregateTargets(secondRepository, ["aggregate-restart-one", "aggregate-restart-two"]);
    const secondContext = BoundedContext.singleTenant("Tasks")
      .add(secondRepository)
      .withStorageFactory(factory)
      .build();
    const secondDispatcher = repositoryAccess.eventDispatcher(secondRepository);
    if (secondDispatcher === undefined) throw new Error("Expected an aggregate event dispatcher.");
    await expect(secondDispatcher.dispatch(event)).rejects.toThrow(
      "Entity commit requires unique delivery-event IDs.",
    );

    expect(ProducingGuardedAggregate.calls).toBe(3);
    await secondContext.close();
  });

  it("closes guard probe handles for both entity kinds on success, duplicates, and failures", async () => {
    const aggregateFactory = new CountingProbeStorageFactory();
    const aggregateRepository = createGuardedAggregateRepository();
    const aggregateContext = BoundedContext.singleTenant("Tasks")
      .add(aggregateRepository)
      .withStorageFactory(aggregateFactory)
      .build();
    const aggregateDispatcher = repositoryAccess.eventDispatcher(aggregateRepository);
    if (aggregateDispatcher === undefined)
      throw new Error("Expected an aggregate event dispatcher.");
    const aggregateEvent = createProjectionEvent("event-aggregate-probe", "aggregate-probe");

    await aggregateDispatcher.dispatch(aggregateEvent);
    expect(aggregateFactory.closedProbes).toBe(1);
    await aggregateDispatcher.dispatch(
      createProjectionEvent("event-aggregate-probe-other", "aggregate-probe-other"),
    );
    expect(aggregateFactory.closedProbes).toBe(2);
    await aggregateDispatcher.dispatch(aggregateEvent);
    expect(aggregateFactory.closedProbes).toBe(3);
    await aggregateContext.close();

    const pmFactory = new CountingProbeStorageFactory();
    const pmRepository = createGuardedProcessManagerReactRepository(1);
    const pmContext = BoundedContext.singleTenant("Tasks")
      .add(pmRepository)
      .withStorageFactory(pmFactory)
      .build();
    const pmDispatcher = repositoryAccess.eventDispatcher(pmRepository);
    if (pmDispatcher === undefined) throw new Error("Expected a process-manager event dispatcher.");
    const pmEvent = createProjectionEvent("event-pm-probe", "pm-probe");

    await pmDispatcher.dispatch(pmEvent);
    expect(pmFactory.closedProbes).toBe(1);
    await pmDispatcher.dispatch(createProjectionEvent("event-pm-probe-other", "pm-probe-other"));
    expect(pmFactory.closedProbes).toBe(2);
    await pmDispatcher.dispatch(pmEvent);
    expect(pmFactory.closedProbes).toBe(3);
    await pmContext.close();

    const failingFactory = new CountingProbeStorageFactory(true);
    const failingRepository = createGuardedAggregateRepository();
    const failingContext = BoundedContext.singleTenant("Tasks")
      .add(failingRepository)
      .withStorageFactory(failingFactory)
      .build();
    const failingDispatcher = repositoryAccess.eventDispatcher(failingRepository);
    if (failingDispatcher === undefined) throw new Error("Expected an aggregate event dispatcher.");

    await expect(
      failingDispatcher.dispatch(
        createProjectionEvent("event-aggregate-probe-fail", "aggregate-probe-fail"),
      ),
    ).rejects.toThrow("guard probe read failed");
    expect(failingFactory).toMatchObject({ opened: 1, closed: 1, closedProbes: 1 });
    await failingContext.close();
  });

  it("bounds delivery lanes while delivered Inbox rows suppress a duplicate after lane eviction", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createGuardedProcessManagerReactRepository(1);
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const dispatcher = repositoryAccess.eventDispatcher(repository);
    if (dispatcher === undefined) throw new Error("Expected a process-manager event dispatcher.");

    const first = createProjectionEvent("event-guard-depth-first", "pm-guard-depth-first");
    const second = createProjectionEvent("event-guard-depth-second", "pm-guard-depth-second");
    await dispatcher.dispatch(first);
    await dispatcher.dispatch(second);
    await dispatcher.dispatch(first);

    expect(RoutingProcessManager.eventCalls).toBe(2);
  });

  it("keeps delivered Inbox deduplication scoped to its bound runtime", async () => {
    RoutingProcessManager.reset();
    const repository = createGuardedProcessManagerReactRepository();
    const firstFactory = new InMemoryStorageFactory();
    const firstContext = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(firstFactory)
      .build();
    const event = createProjectionEvent("event-guard-rebind", "pm-guard-rebind");

    const firstDispatcher = repositoryAccess.eventDispatcher(repository);
    if (firstDispatcher === undefined)
      throw new Error("Expected a process-manager event dispatcher.");
    await firstDispatcher.dispatch(event);
    await firstContext.close();

    const secondFactory = new InMemoryStorageFactory();
    const secondContext = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(secondFactory)
      .build();
    const secondDispatcher = repositoryAccess.eventDispatcher(repository);
    if (secondDispatcher === undefined)
      throw new Error("Expected a process-manager event dispatcher.");
    await secondDispatcher.dispatch(event);
    await secondDispatcher.dispatch(event);

    expect(RoutingProcessManager.eventCalls).toBe(2);
    await secondContext.close();
  });

  it("marks default-handled delivery failures without retaining journal markers", async () => {
    const preJournalFactory = new InMemoryStorageFactory();
    const preJournalRepository = createGuardedProcessManagerReactRepository();
    RoutingProcessManager.reset(new Error("handler failed before journal"));
    const preJournalContext = BoundedContext.singleTenant("Tasks")
      .add(preJournalRepository)
      .withStorageFactory(preJournalFactory)
      .build();
    const preJournalDispatcher = repositoryAccess.eventDispatcher(preJournalRepository);
    if (preJournalDispatcher === undefined)
      throw new Error("Expected a process-manager event dispatcher.");
    const preJournalEvent = createProjectionEvent(
      "event-guard-before-journal",
      "pm-guard-before-journal",
    );

    await expect(preJournalDispatcher.dispatch(preJournalEvent)).resolves.toBeUndefined();
    const preJournal = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: preJournalFactory,
      stateSchema: ProcessManagerStateSchema,
    });
    await expect(preJournal.readEvents("pm-guard-before-journal")).resolves.toEqual([]);
    RoutingProcessManager.reset();
    await preJournalDispatcher.dispatch(preJournalEvent);
    expect(RoutingProcessManager.eventCalls).toBe(1);
    await expect(preJournal.readEvents("pm-guard-before-journal")).resolves.toEqual([]);
    await preJournalContext.close();

    const postJournalFactory = new InMemoryStorageFactory();
    const postJournalRepository = createGuardedProcessManagerCommandOnlyRepository();
    let publicationAttempts = 0;
    const postJournalContext = BoundedContext.singleTenant("Tasks")
      .add(postJournalRepository)
      .addCommandDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: () => {
          publicationAttempts++;
          return Promise.reject(new Error("publication failed after journal"));
        },
      })
      .withStorageFactory(postJournalFactory)
      .build();
    const postJournalDispatcher = repositoryAccess.eventDispatcher(postJournalRepository);
    if (postJournalDispatcher === undefined)
      throw new Error("Expected a process-manager event dispatcher.");
    const postJournalEvent = createProjectionEvent(
      "event-guard-after-journal",
      "pm-guard-after-journal",
    );

    RoutingProcessManager.reset();
    await expect(postJournalDispatcher.dispatch(postJournalEvent)).resolves.toBeUndefined();
    await postJournalDispatcher.dispatch(postJournalEvent);
    expect(RoutingProcessManager.commandReactionCalls).toBe(1);
    expect(publicationAttempts).toBe(1);
    const postJournal = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: postJournalFactory,
      stateSchema: ProcessManagerStateSchema,
    });
    await expect(postJournal.readEvents("pm-guard-after-journal")).resolves.toEqual([]);
    await postJournalContext.close();
  });

  it("runs unrelated guarded entity lanes concurrently", async () => {
    BlockingProcessManager.reset();
    BlockingProcessManager.blockingId = "pm-guard-lane-one";
    const factory = new InMemoryStorageFactory();
    const repository = createGuardedBlockingPmRepo();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const blockedRow = await storePmInboxEvent(
      delivery,
      createProjectionEvent("event-guard-lane-one", "pm-guard-lane-one"),
      new Date("2026-07-24T19:00:00.000Z"),
      1n,
    );
    const unrelatedRow = await storePmInboxEvent(
      delivery,
      createProjectionEvent("event-guard-lane-two", "pm-guard-lane-two"),
      new Date("2026-07-24T19:00:01.000Z"),
      2n,
    );

    const blocked = target.replay(blockedRow);
    await waitForCondition(() => BlockingProcessManager.startedCalls === 1);
    const unrelated = target.replay(unrelatedRow);

    await waitForCondition(() => BlockingProcessManager.startedCalls === 2);
    await expect(Promise.race([unrelated.then(() => "resolved"), delay(150)])).resolves.toBe(
      "resolved",
    );
    BlockingProcessManager.release();
    await expect(Promise.all([blocked, unrelated])).resolves.toEqual([undefined, undefined]);
    expect(BlockingProcessManager.completedCalls).toBe(2);
    await context.close();
  });

  it("uses the stored process-manager target and rejects other invalid replay rows", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerReactRepository();
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const event = createProjectionEvent("event-pm-replay", "pm-replay");
    const wrongId = await storePmInboxEvent(
      delivery,
      event,
      new Date("2026-07-08T09:05:00.000Z"),
      1n,
      { targetId: "pm-other" },
    );
    const wrongType = await storePmInboxEvent(
      delivery,
      event,
      new Date("2026-07-08T09:05:01.000Z"),
      2n,
      { signalId: "event-pm-replay-type", targetTypeUrl: "type.example.dev/OtherPm" },
    );
    await expect(
      storePmInboxEvent(delivery, event, new Date("2026-07-08T09:05:02.000Z"), 3n, {
        signalId: "event-pm-replay-malformed",
        signal: AnyMessages.pack(
          AggregateStateSchema,
          create(AggregateStateSchema, {
            id: "pm-replay",
            name: "Wrong envelope",
            archived: false,
          }),
        ),
      }),
    ).rejects.toThrow("Inbox delivery label does not match its signal payload.");
    const wrongLabel = await storePmInboxEvent(
      delivery,
      event,
      new Date("2026-07-08T09:05:03.000Z"),
      4n,
      { signalId: "event-pm-replay-label", label: "UPDATE_SUBSCRIBER" },
    );

    await expect(target.replay(wrongId)).resolves.toBeUndefined();
    await expect(target.replay(wrongType)).rejects.toThrow(
      "Entity Inbox replay stored target type does not match the routed repository.",
    );
    await expect(target.replay(wrongLabel)).rejects.toThrow(
      'Entity Inbox replay does not handle "UPDATE_SUBSCRIBER" messages.',
    );

    expect(RoutingProcessManager.eventCalls).toBe(1);
  });

  it("routes a Process Manager Event interface once at admission and not during replay", async () => {
    RoutingProcessManager.reset();
    let routeCalls = 0;
    const token = MessageInterfaces.define<object, readonly [typeof ProjectionEventSchema]>([
      ProjectionEventSchema,
    ]);
    const eventRouting = EventRouting.create<string>().route(token, (message) => {
      routeCalls += 1;
      return [message.id];
    });
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerReactRepository(eventRouting);
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();

    try {
      await context.eventBus().post(createProjectionEvent("event-pm-admission", "pm-admission"));
      await waitForCondition(() => RoutingProcessManager.eventCalls === 1);
      expect(routeCalls).toBe(1);

      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: factory,
      });
      const replay = await storePmInboxEvent(
        delivery,
        createProjectionEvent("event-pm-replay-count", "pm-admission"),
        new Date("2026-08-11T04:55:00.000Z"),
        1n,
      );

      await expect(requireEntityInboxTarget(repository).replay(replay)).resolves.toBeUndefined();
      expect(routeCalls).toBe(1);
      expect(RoutingProcessManager.eventCalls).toBe(2);
    } finally {
      await context.close();
    }
  });

  it("guards repeated Process Manager inbox replay per target with the retained source event", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createGuardedProcessManagerReactRepository();
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const stored = await storePmInboxEvent(
      delivery,
      createProjectionEvent("event-pm-guarded-replay", "pm-guarded-replay"),
      new Date("2026-07-08T09:05:30.000Z"),
      1n,
    );

    await target.replay(stored);
    await target.replay(stored);

    expect(RoutingProcessManager.eventCalls).toBe(1);
  });

  it("executes process-manager event reactors and stores mutated state in Stand", async () => {
    RoutingProcessManager.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerReactRepository())
      .build();

    await context.eventBus().post(
      createProjectionEvent("event-pm-react", "pm-event-react", {
        producerId: "different-producer",
      }),
    );

    expect(RoutingProcessManager.eventCalls).toBe(1);
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-event-react"),
    ).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-event-react",
        queue: "Task reacted",
      }),
    );
  });

  it("retains one reactor diagnostic when an admitted Process Manager reactor fails", async () => {
    const failure = new Error("admitted Process Manager reactor failed");
    const diagnostics: SpineEvent[] = [];
    const event = createProjectionEvent("pm-reactor-diagnostic-failure", "pm-reactor-failure");
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerReactRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToReactorSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      RoutingProcessManager.reset(failure);
      await expect(context.eventBus().post(event)).resolves.toBeUndefined();
      await context.close();

      expect(RoutingProcessManager.eventCalls).toBe(1);
      expect(diagnostics).toHaveLength(1);
      expect(
        AnyMessages.unpack(diagnostics[0]?.message as never, EventDispatchedToReactorSchema),
      ).toMatchObject({
        receiver: { typeUrl: TypeUrls.derive(ProcessManagerStateSchema) },
        payload: event,
      });
    } finally {
      RoutingProcessManager.reset();
      await context.close();
    }
  });

  it("emits distinct command and reactor diagnostics for a routed Process Manager", async () => {
    RoutingProcessManager.reset();
    const diagnostics: SpineEvent[] = [];
    const context = BoundedContext.multitenant("Tasks")
      .add(createProcessManagerCommandAndReactRepository())
      .addEventDispatcher({
        messageSchemas: () => [CommandDispatchedToHandlerSchema, EventDispatchedToReactorSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();
    const command = createAggregateCommand(
      "pm-diagnostic-command",
      "pm-diagnostic",
      "Command",
      "a",
    );
    const event = createProjectionEvent("pm-diagnostic-event", "pm-diagnostic", {
      pastMessageTenantId: "a",
    });

    try {
      await context.commandBus().post(command);
      await context.eventBus().post(event);
      await waitForCondition(() => diagnostics.length >= 2);

      expect(diagnosticTenants(diagnostics).every((tenantId) => tenantId === "a")).toBe(true);
      const reactor = diagnostics.find(
        (diagnostic) =>
          diagnostic.message?.typeUrl === TypeUrls.derive(EventDispatchedToReactorSchema) &&
          AnyMessages.unpack(diagnostic.message, EventDispatchedToReactorSchema)?.payload?.id
            ?.value === event.id?.value,
      );
      expect(
        AnyMessages.unpack(reactor?.message as never, EventDispatchedToReactorSchema),
      ).toMatchObject({
        receiver: { typeUrl: TypeUrls.derive(ProcessManagerStateSchema) },
        payload: event,
        entityType: { impl: { case: "javaClassName", value: "RoutingProcessManager" } },
        whenDispatched: reactor?.context?.timestamp,
      });
      await expect(
        context
          .stand()
          .read(ProcessManagerStateSchema, "pm-diagnostic", { tenantId: createTenantId("a") }),
      ).resolves.toMatchObject({
        queue: "Task reacted",
      });
    } finally {
      await context.close();
    }
  });

  it("does not emit reactor diagnostics without a matched reactor", async () => {
    const diagnostics: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToReactorSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await context.eventBus().post(createProjectionEvent("pm-no-reactor", "pm-no-reactor"));
      await context.close();

      expect(diagnostics).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("isolates reactor diagnostic publication failure from Process Manager work", async () => {
    RoutingProcessManager.reset();
    const diagnostics: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerReactRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToReactorSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.reject(new Error("reactor diagnostic dispatch failed"));
        },
      })
      .build();

    try {
      await expect(
        context.eventBus().post(createProjectionEvent("pm-reactor-failure", "pm-reactor-failure")),
      ).resolves.toBeUndefined();
      await waitForFailures(context, 1);

      expect(RoutingProcessManager.eventCalls).toBe(1);
      await expect(
        context.stand().read(ProcessManagerStateSchema, "pm-reactor-failure"),
      ).resolves.toMatchObject({
        queue: "Task reacted",
      });
      expect(diagnostics).toHaveLength(1);
      expect(context.storedEventDispatchFailures()).toMatchObject([
        { error: { message: "reactor diagnostic dispatch failed" } },
      ]);
    } finally {
      await context.close();
    }
  });

  it("keeps committed process-manager event transitions usable when a Stand subscriber throws", async () => {
    RoutingProcessManager.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerReactRepository())
      .build();
    let notifications = 0;
    context.stand().subscribe(ProcessManagerStateSchema, () => {
      notifications++;
      throw new Error("process-manager event subscriber failed");
    });

    try {
      await expect(
        context.eventBus().post(createProjectionEvent("event-pm-subscriber-1", "pm-subscriber")),
      ).resolves.toBeUndefined();
      await expect(
        context
          .eventBus()
          .post(
            createProjectionEvent("event-pm-subscriber-2", "pm-subscriber", { name: "Follow-up" }),
          ),
      ).resolves.toBeUndefined();

      expect(RoutingProcessManager.eventCalls).toBe(2);
      expect(notifications).toBe(2);
      await expect(
        context.stand().read(ProcessManagerStateSchema, "pm-subscriber"),
      ).resolves.toEqual(
        create(ProcessManagerStateSchema, {
          id: "pm-subscriber",
          queue: "Follow-up reacted",
        }),
      );
      expect(context.storedEventDispatchFailures()).toMatchObject([
        {
          error: { message: "process-manager event subscriber failed" },
        },
        {
          error: { message: "process-manager event subscriber failed" },
        },
      ]);
    } finally {
      await context.close();
    }
  });

  it("posts commands produced by process-manager event commanding after state commit", async () => {
    RoutingProcessManager.reset();
    const commands: SpineCommand[] = [];
    const context = BoundedContext.multitenant("Tasks")
      .add(createProcessManagerEventRepository())
      .addCommandDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();
    const sourceActorContext = create(ActorContextSchema, {
      tenantId: createTenantId("tenant-command"),
    });
    const sourceGrandOrigin = create(OriginSchema, {
      message: create(MessageIdSchema, {
        id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "past-command" })),
        typeUrl: TypeUrls.derive(AggregateStateSchema),
      }),
      actorContext: sourceActorContext,
    });

    await context.eventBus().post(
      createProjectionEvent("event-pm-command", "pm-event-command", {
        pastMessageTenantId: "tenant-command",
      }),
    );

    expect(RoutingProcessManager.commandReactionCalls).toBe(1);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.id).toEqual(create(CommandIdSchema, { uuid: "event-pm-command-1" }));
    expect(commands[0]?.context?.actorContext).toEqual(sourceActorContext);
    expect(commands[0]?.context?.origin).toEqual(
      create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: AnyMessages.pack(EventIdSchema, create(EventIdSchema, { value: "event-pm-command" })),
          typeUrl: TypeUrls.derive(ProjectionEventSchema),
        }),
        actorContext: sourceActorContext,
        grandOrigin: sourceGrandOrigin,
      }),
    );
    const producedMessage = commands[0]?.message;
    if (producedMessage === undefined) {
      throw new Error("Expected a process-manager produced command message.");
    }
    expect(AnyMessages.unpack(producedMessage, AggregateStateSchema)).toEqual(
      create(AggregateStateSchema, {
        id: "pm-event-command",
        name: "Task follow-up command",
        archived: false,
      }),
    );
  });

  it("rejects missing source event ids before process-manager command reactions mutate state", async () => {
    RoutingProcessManager.reset();
    const commands: SpineCommand[] = [];
    const repository = createProcessManagerEventRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .addCommandDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();
    const eventDispatcher = repositoryAccess.eventDispatcher(repository);
    const sourceEvent = createProjectionEvent("event-unused", "pm-event-command-missing-id");
    const idlessEvent = create(EventSchema, {
      context: sourceEvent.context,
      message: sourceEvent.message,
    });

    if (eventDispatcher === undefined) {
      throw new Error("Expected a process-manager event dispatcher.");
    }

    await expect(eventDispatcher.dispatch(idlessEvent)).rejects.toThrow(/event(?:\.id| ID)/i);

    expect(RoutingProcessManager.eventCalls).toBe(0);
    expect(RoutingProcessManager.commandReactionCalls).toBe(0);
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-event-command-missing-id"),
    ).resolves.toBeUndefined();
    expect(commands).toEqual([]);
  });

  it("routes process-manager command reactions by the first event field even when producer ID differs", async () => {
    RoutingProcessManager.reset();
    const commands: SpineCommand[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerCommandOnlyRepository())
      .addCommandDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();

    await context.eventBus().post(
      createProjectionEvent("event-pm-command-producer", "pm-first-field", {
        producerId: "different-producer",
      }),
    );

    expect(RoutingProcessManager.eventCalls).toBe(0);
    expect(RoutingProcessManager.commandReactionCalls).toBe(1);
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-first-field"),
    ).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-first-field",
        queue: "Task commanded",
      }),
    );
    expect(commands).toHaveLength(1);
    const producedMessage = commands[0]?.message;
    if (producedMessage === undefined) {
      throw new Error("Expected a process-manager produced command message.");
    }
    expect(AnyMessages.unpack(producedMessage, AggregateStateSchema)).toEqual(
      create(AggregateStateSchema, {
        id: "pm-first-field",
        name: "Task follow-up command",
        archived: false,
      }),
    );
  });

  it("appends process-manager event-produced events and records later dispatch failures", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const dispatchAttempted = createSignal();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerEventProducingRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: () => {
          dispatchAttempted.resolve();
          return Promise.reject(new Error("process-manager event dispatch failed"));
        },
      })
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const errors: { readonly message: string; readonly facts: Record<string, unknown> }[] = [];
    boundedContextAccess.installLogger(context, {
      withMetadata: (facts: Record<string, unknown>) => ({
        error: (message: string) => errors.push({ message, facts }),
      }),
    } as unknown as ILogLayer);

    await expect(
      context.eventBus().post(createProjectionEvent("event-pm-produce", "pm-event-produce")),
    ).resolves.toBeUndefined();

    expect(RoutingProcessManager.eventCalls).toBe(1);
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-event-produce"),
    ).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-event-produce",
        queue: "Task evented",
      }),
    );
    await withTimeout(
      dispatchAttempted.promise,
      "process-manager event produced-event dispatch attempt",
    );
    await expect(eventStore.read()).resolves.toMatchObject([
      { id: { value: "event-pm-produce" } },
      { id: { value: "event-pm-produce-1" } },
    ]);
    const [failure] = await waitForFailures(context, 1);
    expect(failure).toMatchObject({
      event: { id: { value: "event-pm-produce-1" } },
      error: { name: "Error", message: "process-manager event dispatch failed" },
    });
    expect(errors).toEqual([
      {
        message: "Repository follow-up dispatch failed.",
        facts: {
          eventType: TypeUrls.derive(AggregateStateSchema),
          operation: "repository.follow_up",
          reasonCode: "dispatch_failed",
        },
      },
    ]);
  });

  it("rejects blank source event ids before process-manager event reactions mutate state", async () => {
    RoutingProcessManager.reset();
    const dispatchedEventIds: string[] = [];
    const repository = createProcessManagerEventProducingRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (event) => {
          dispatchedEventIds.push(event.id?.value ?? "");
          return Promise.resolve();
        },
      })
      .build();
    const eventDispatcher = repositoryAccess.eventDispatcher(repository);

    if (eventDispatcher === undefined) {
      throw new Error("Expected a process-manager event dispatcher.");
    }

    await expect(
      eventDispatcher.dispatch(createProjectionEvent("   ", "pm-event-produce-blank-id")),
    ).rejects.toThrow(/event ID/i);

    expect(RoutingProcessManager.eventCalls).toBe(0);
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-event-produce-blank-id"),
    ).resolves.toBeUndefined();
    expect(dispatchedEventIds).toEqual([]);
  });

  it("stores process-manager state and produced events when a later produced command fails", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const eventDispatches: string[] = [];
    const commandDispatches: string[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerMixedEventRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (event) => {
          eventDispatches.push(event.id?.value ?? "");
          return Promise.resolve();
        },
      })
      .addCommandDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (command) => {
          commandDispatches.push(command.id?.uuid ?? "");
          return Promise.reject(new Error("mixed process-manager command dispatch failed"));
        },
      })
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.eventBus().post(createProjectionEvent("event-pm-mixed", "pm-event-mixed")),
    ).resolves.toBeUndefined();

    expect(RoutingProcessManager.eventCalls).toBe(1);
    expect(RoutingProcessManager.commandReactionCalls).toBe(1);
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-event-mixed"),
    ).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-event-mixed",
        queue: "Task commanded",
      }),
    );
    expect(commandDispatches).toEqual(["event-pm-mixed-1"]);
    await waitForCondition(() => eventDispatches.includes("event-pm-mixed-1"));
    await expect(eventStore.read()).resolves.toMatchObject([
      { id: { value: "event-pm-mixed" } },
      { id: { value: "event-pm-mixed-1" } },
    ]);
    expect(context.storedEventDispatchFailures()).toHaveLength(0);
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

  it("selects one filtered projection subscriber before its fallback", async () => {
    FilteredTaskProjection.reset();
    const context = BoundedContext.singleTenant("Filtered projections")
      .add(createFilteredProjectionRepository())
      .build();

    try {
      await context.eventBus().post(
        createProjectionEvent("event-filtered-announcements", "filtered-announcements", {
          name: "announcements",
        }),
      );
      await context
        .eventBus()
        .post(
          createProjectionEvent("event-filtered-general", "filtered-general", { name: "general" }),
        );

      expect(FilteredTaskProjection.calls).toEqual([
        "announcements:announcements",
        "fallback:general",
      ]);
    } finally {
      await context.close();
    }
  });

  it("constructs Event filters with a snapshotted custom message stringifier", () => {
    const stringifiers = new StringifierRegistry();
    stringifiers.register(Int64ProjectionIdSchema, {
      fromString: (value) =>
        create(Int64ProjectionIdSchema, { value: BigInt(value.replace(/^id:/, "")) }),
      toString: (value) => `id:${String(value.value)}`,
    });
    const handlers = HandlerMetadataValues.defineArity(
      Int64MessageIdProjection,
      Int64MessageIdProjectionStateSchema,
      (builder) => [builder.subscribe(Int64MessageIdProjectionEventSchema, "subscribeState")],
      [
        {
          kind: "event-subscription",
          methodName: "subscribeState",
          parameterCount: 1,
          origin: "domestic",
          where: { eventField: "id", equals: "id:42" },
        },
      ],
    );

    expect(
      () =>
        new Repository({
          entityType: Int64MessageIdProjection,
          schema: Int64MessageIdProjectionStateSchema,
          handlers,
          stringifierRegistry: stringifiers,
        }),
    ).not.toThrow();
  });

  it("selects one filtered Aggregate Event reactor before its fallback", async () => {
    FilteredEventAggregate.reset();
    const context = BoundedContext.singleTenant("Filtered aggregates")
      .add(createFilteredAggregateRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: () => Promise.resolve(),
      })
      .build();

    try {
      await context.eventBus().post(
        createProjectionEvent("event-filtered-aggregate-one", "filtered-aggregate-one", {
          name: "announcements",
        }),
      );
      await context.eventBus().post(
        createProjectionEvent("event-filtered-aggregate-two", "filtered-aggregate-two", {
          name: "general",
        }),
      );

      expect(FilteredEventAggregate.calls).toEqual([
        "announcements:announcements",
        "fallback:general",
      ]);
    } finally {
      await context.close();
    }
  });

  it("filters Process Manager Event and command reactions independently", async () => {
    FilteredProcessManager.reset();
    const commands: SpineCommand[] = [];
    const context = BoundedContext.singleTenant("Filtered process managers")
      .add(createFilteredProcessManagerRepository())
      .addCommandDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await context.eventBus().post(
        createProjectionEvent("event-filtered-pm-one", "filtered-pm-one", {
          name: "announcements",
        }),
      );
      await context
        .eventBus()
        .post(
          createProjectionEvent("event-filtered-pm-two", "filtered-pm-two", { name: "general" }),
        );

      expect(FilteredProcessManager.calls).toEqual([
        "react-announcements:announcements",
        "command-announcements:announcements",
        "react-fallback:general",
        "command-fallback:general",
      ]);
      expect(commands).toHaveLength(2);
    } finally {
      await context.close();
    }
  });

  it("emits a System subscriber-dispatch diagnostic after projection admission", async () => {
    const diagnostics: SpineEvent[] = [];
    const event = createProjectionEvent("subscriber-diagnostic", "subscriber-id");
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToSubscriberSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await context.eventBus().post(event);
      await waitForCondition(() => diagnostics.length === 1);

      const diagnostic = AnyMessages.unpack(
        diagnostics[0]?.message as never,
        EventDispatchedToSubscriberSchema,
      );
      expect(diagnostic).toMatchObject({
        receiver: { typeUrl: TypeUrls.derive(ProjectionStateSchema) },
        payload: event,
        entityType: { impl: { case: "javaClassName", value: "ExecutingTaskProjection" } },
        whenDispatched: diagnostics[0]?.context?.timestamp,
      });
      expect(diagnostics[0]?.context?.origin).toMatchObject({
        case: "pastMessage",
        value: { message: { typeUrl: TypeUrls.derive(ProjectionEventSchema) } },
      });
      expect(context.eventBus().acceptedEventTypes()).not.toContain(
        TypeUrls.derive(EventDispatchedToSubscriberSchema),
      );
    } finally {
      await context.close();
    }
  });

  it("retains one subscriber diagnostic when an admitted subscriber fails", async () => {
    const failure = new Error("admitted projection subscriber failed");
    const diagnostics: SpineEvent[] = [];
    const event = createProjectionEvent(
      "subscriber-diagnostic-failure",
      "subscriber-diagnostic-failure",
    );
    const context = BoundedContext.singleTenant("Tasks")
      .add(createThrowingProjectionRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToSubscriberSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      ThrowingTaskProjection.reset(failure);
      await expect(context.eventBus().post(event)).resolves.toBeUndefined();
      await waitForCondition(() => diagnostics.length === 1);

      expect(diagnostics).toHaveLength(1);
      expect(
        AnyMessages.unpack(diagnostics[0]?.message as never, EventDispatchedToSubscriberSchema),
      ).toMatchObject({ payload: event });
    } finally {
      ThrowingTaskProjection.reset();
      await context.close();
    }
  });

  it("keeps subscriber diagnostics tenant-scoped and emits them for catch-up replay", async () => {
    const diagnostics: SpineEvent[] = [];
    const context = BoundedContext.multitenant("Tasks")
      .add(createExecutingProjectionRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToSubscriberSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await context.eventBus().post(
        createProjectionEvent("subscriber-tenant", "subscriber-id", {
          pastMessageTenantId: "tenant-a",
        }),
      );
      await waitForCondition(() => diagnostics.length === 1);
      expect(diagnosticTenants(diagnostics)).toEqual(["tenant-a"]);

      diagnostics.splice(0);
      ExecutingTaskProjection.reset();
      await expect(
        context.catchUpReadSide({ tenantId: createTenantId("tenant-a") }),
      ).resolves.toMatchObject({
        replayedEventCount: 1,
      });
      await waitForCondition(() => diagnostics.length === 1);
      expect(diagnosticTenants(diagnostics)).toEqual(["tenant-a"]);
      expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
    } finally {
      await context.close();
    }
  });

  it("does not emit subscriber diagnostics before projection subscriber admission", async () => {
    const diagnostics: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToSubscriberSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await context.eventBus().post(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "subscriber-unmatched" }),
          context: create(EventContextSchema),
          schema: NumberRouteEventSchema,
          message: create(NumberRouteEventSchema, { id: 7 }),
        }),
      );
      await context.close();

      expect(diagnostics).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("does not emit subscriber diagnostics when a default Event has no producer", async () => {
    ExecutingTaskProjection.reset();
    const diagnostics: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createRoutingRepository())
      .add(createExecutingProjectionRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToSubscriberSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await expect(
        context
          .eventBus()
          .post(createContextlessProjectionEvent("subscriber-routing-refusal", "first-field-task")),
      ).rejects.toThrow(/producer ID/i);
      await context.close();

      expect(diagnostics).toEqual([]);
      expect(ExecutingTaskProjection.subscriberCalls).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("isolates subscriber diagnostic publication failure from projection work", async () => {
    ExecutingTaskProjection.reset();
    const diagnostics: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .addEventDispatcher({
        messageSchemas: () => [EventDispatchedToSubscriberSchema],
        dispatch: (diagnostic) => {
          diagnostics.push(diagnostic);
          return Promise.reject(new Error("subscriber diagnostic dispatch failed"));
        },
      })
      .build();

    try {
      await expect(
        context.eventBus().post(createProjectionEvent("subscriber-failure", "subscriber-failure")),
      ).resolves.toBeUndefined();
      await waitForFailures(context, 1);

      expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
      await expect(
        context.stand().read(ProjectionStateSchema, "subscriber-failure"),
      ).resolves.toMatchObject({
        name: "Task (projected)",
      });
      expect(diagnostics).toHaveLength(1);
      expect(context.storedEventDispatchFailures()).toMatchObject([
        { error: { message: "subscriber diagnostic dispatch failed" } },
      ]);
    } finally {
      await context.close();
    }
  });

  it("does not expose projection state when its atomic commit fails", async () => {
    ExecutingTaskProjection.reset();
    const factory = new FailingEntityCommitStorageFactory();
    const changes: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .addEventDispatcher({
        messageSchemas: () => [
          EntityCreatedSchema,
          EntityStateChangedSchema,
          EntityArchivedSchema,
          EntityUnarchivedSchema,
          EntityDeletedSchema,
          EntityRestoredSchema,
        ],
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .withStorageFactory(factory)
      .build();

    await expect(
      context.eventBus().post(createProjectionEvent("projection-commit-fails", "projection-fails")),
    ).resolves.toBeUndefined();
    await expect(
      context.stand().read(ProjectionStateSchema, "projection-fails"),
    ).resolves.toBeUndefined();
    expect(changes).toEqual([]);
  });

  it("does not expose aggregate state or state notifications when its atomic commit throws", async () => {
    const changes: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [
          EntityCreatedSchema,
          EntityStateChangedSchema,
          EntityArchivedSchema,
          EntityUnarchivedSchema,
          EntityDeletedSchema,
          EntityRestoredSchema,
        ],
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .withStorageFactory(new FailingEntityCommitStorageFactory())
      .build();

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("aggregate-commit-fails", "aggregate-fails")),
    ).resolves.toBeUndefined();
    await expect(
      context.stand().read(AggregateStateSchema, "aggregate-fails"),
    ).resolves.toBeUndefined();
    expect(changes).toEqual([]);
  });

  it("cancels aggregate, projection, and process-manager delivery when atomic storage replays", async () => {
    const aggregateChanges: SpineEvent[] = [];
    const aggregate = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityStateChangedSchema],
        dispatch: (event) => {
          aggregateChanges.push(event);
          return Promise.resolve();
        },
      })
      .withStorageFactory(new OutcomeEntityCommitStorageFactory(["conflict"]))
      .build();
    const projection = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .withStorageFactory(new OutcomeEntityCommitStorageFactory(["conflict"]))
      .build();
    const processManager = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .withStorageFactory(new OutcomeEntityCommitStorageFactory(["conflict"]))
      .build();

    try {
      await aggregate
        .commandBus()
        .post(createAggregateCommand("aggregate-replay", "aggregate-replay"));
      await projection
        .eventBus()
        .post(createProjectionEvent("projection-replay", "projection-replay"));
      await processManager.commandBus().post(createAggregateCommand("pm-replay", "pm-replay"));

      await expect(
        aggregate.stand().read(AggregateStateSchema, "aggregate-replay"),
      ).resolves.toBeUndefined();
      await expect(
        projection.stand().read(ProjectionStateSchema, "projection-replay"),
      ).resolves.toBeUndefined();
      await expect(
        processManager.stand().read(ProcessManagerStateSchema, "pm-replay"),
      ).resolves.toBeUndefined();
      expect(aggregateChanges).toEqual([]);
    } finally {
      await Promise.all([aggregate.close(), projection.close(), processManager.close()]);
    }
  });

  it("rejects aggregate, projection, and process-manager delivery on atomic commit conflicts", async () => {
    const lifecycleEvents: SpineEvent[] = [];
    const aggregate = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [
          EntityCreatedSchema,
          EntityStateChangedSchema,
          EntityArchivedSchema,
          EntityUnarchivedSchema,
          EntityDeletedSchema,
          EntityRestoredSchema,
        ],
        dispatch: (event) => {
          lifecycleEvents.push(event);
          return Promise.resolve();
        },
      })
      .withStorageFactory(new OutcomeEntityCommitStorageFactory(["conflict"]))
      .build();
    const projection = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .withStorageFactory(new OutcomeEntityCommitStorageFactory(["conflict"]))
      .build();
    const processManager = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .withStorageFactory(new OutcomeEntityCommitStorageFactory(["conflict"]))
      .build();

    try {
      await expect(
        aggregate
          .commandBus()
          .post(createAggregateCommand("aggregate-conflict", "aggregate-conflict")),
      ).resolves.toBeUndefined();
      await expect(
        projection
          .eventBus()
          .post(createProjectionEvent("projection-conflict", "projection-conflict")),
      ).resolves.toBeUndefined();
      await expect(
        processManager.commandBus().post(createAggregateCommand("pm-conflict", "pm-conflict")),
      ).resolves.toBeUndefined();

      await expect(
        aggregate.stand().read(AggregateStateSchema, "aggregate-conflict"),
      ).resolves.toBeUndefined();
      await expect(
        projection.stand().read(ProjectionStateSchema, "projection-conflict"),
      ).resolves.toBeUndefined();
      await expect(
        processManager.stand().read(ProcessManagerStateSchema, "pm-conflict"),
      ).resolves.toBeUndefined();
      expect(lifecycleEvents).toEqual([]);
    } finally {
      await Promise.all([aggregate.close(), projection.close(), processManager.close()]);
    }
  });

  it("does not expose process-manager state or follow-ups when its atomic commit fails", async () => {
    RoutingProcessManager.reset();
    const factory = new FailingEntityCommitStorageFactory();
    const dispatched: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [AggregateStateSchema],
        dispatch: (event) => {
          dispatched.push(event);
          return Promise.resolve();
        },
      })
      .addEventDispatcher({
        messageSchemas: () => [EntityStateChangedSchema],
        dispatch: (event) => {
          dispatched.push(event);
          return Promise.resolve();
        },
      })
      .withStorageFactory(factory)
      .build();

    await expect(
      context.commandBus().post(createAggregateCommand("pm-commit-fails", "pm-fails")),
    ).resolves.toBeUndefined();
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-fails"),
    ).resolves.toBeUndefined();
    expect(dispatched).toEqual([]);
  });

  it("publishes a committed aggregate state change after durable persistence", async () => {
    const changes: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityStateChangedSchema],
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await context.commandBus().post(createAggregateCommand("command-state-change", "changed"));

      await waitForCondition(() => changes.length === 1);
      expect(changes).toHaveLength(1);
      expect(changes[0]).toMatchObject({
        message: { typeUrl: TypeUrls.derive(EntityStateChangedSchema) },
        context: { origin: { case: "pastMessage" } },
      });
      const event = changes[0];
      if (event?.message === undefined) {
        throw new Error("Expected the committed state change event.");
      }
      const change = AnyMessages.unpack(event.message, EntityStateChangedSchema);
      expect(change).toMatchObject({
        entity: { typeUrl: TypeUrls.derive(AggregateStateSchema) },
        signalId: [{ typeUrl: TypeUrls.derive(AggregateStateSchema) }],
        newState: { typeUrl: TypeUrls.derive(AggregateStateSchema) },
        newVersion: { number: 1 },
      });
      if (change?.newState === undefined) {
        throw new Error("Expected the committed state in the change event.");
      }
      expect(AnyMessages.unpack(change.newState, AggregateStateSchema)).toMatchObject({
        id: "changed",
        name: "Task (applied)",
      });
      expect(context.eventBus().acceptedEventTypes()).not.toContain(
        TypeUrls.derive(EntityStateChangedSchema),
      );
    } finally {
      await context.close();
    }
  });

  it("publishes created before state-changed after the first committed aggregate transition", async () => {
    const changes: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityCreatedSchema, EntityStateChangedSchema],
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await context.commandBus().post(createAggregateCommand("created-first", "created-id"));
      await waitForCondition(() => changes.length === 2);

      expect(changes.map((event) => event.message?.typeUrl)).toEqual([
        TypeUrls.derive(EntityCreatedSchema),
        TypeUrls.derive(EntityStateChangedSchema),
      ]);
      expect(AnyMessages.unpack(changes[0]?.message as never, EntityCreatedSchema)).toMatchObject({
        entity: { typeUrl: TypeUrls.derive(AggregateStateSchema) },
        kind: 1,
      });
    } finally {
      await context.close();
    }
  });

  it("uses each lifecycle envelope timestamp for its payload under an advancing clock", async () => {
    const changes: SpineEvent[] = [];
    let clockTick = 0;
    const clock = vi
      .spyOn(SystemClock.prototype, "now")
      .mockImplementation(() => new Date(1_000 + clockTick++ * 1_000));
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityCreatedSchema, EntityStateChangedSchema, EntityArchivedSchema],
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await context.commandBus().post(createAggregateCommand("clock-created", "clock-id"));
      await waitForCondition(() => changes.length === 2);
      expect(changes.map((event) => event.message?.typeUrl)).toEqual([
        TypeUrls.derive(EntityCreatedSchema),
        TypeUrls.derive(EntityStateChangedSchema),
      ]);
      const stateChanged = AnyMessages.unpack(
        changes[1]?.message as never,
        EntityStateChangedSchema,
      );
      expect(stateChanged?.when).toEqual(changes[1]?.context?.timestamp);
      changes.splice(0);
      await context
        .commandBus()
        .post(createAggregateCommand("clock-archive", "clock-id", "archive-lifecycle"));
      await waitForCondition(() => changes.length === 1);
      const archived = AnyMessages.unpack(changes[0]?.message as never, EntityArchivedSchema);
      expect(archived?.when).toEqual(changes[0]?.context?.timestamp);
    } finally {
      clock.mockRestore();
      await context.close();
    }
  });

  it("emits lifecycle-only aggregate transitions without EntityStateChanged", async () => {
    const changes: SpineEvent[] = [];
    const schemas = [
      EntityCreatedSchema,
      EntityStateChangedSchema,
      EntityArchivedSchema,
      EntityUnarchivedSchema,
      EntityDeletedSchema,
      EntityRestoredSchema,
    ];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => schemas,
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await context.commandBus().post(createAggregateCommand("seed-lifecycle", "lifecycle-id"));
      await waitForCondition(() => changes.length === 2);
      changes.splice(0);
      for (const name of [
        "archive-lifecycle",
        "archive-lifecycle",
        "unarchive-lifecycle",
        "delete-lifecycle",
        "restore-lifecycle",
      ]) {
        await context
          .commandBus()
          .post(createAggregateCommand(name, "lifecycle-id", `${name}-${String(changes.length)}`));
      }
      await waitForCondition(() => changes.length === 4);
      expect(changes.map((event) => event.message?.typeUrl)).toEqual([
        TypeUrls.derive(EntityArchivedSchema),
        TypeUrls.derive(EntityUnarchivedSchema),
        TypeUrls.derive(EntityDeletedSchema),
        TypeUrls.derive(EntityRestoredSchema),
      ]);
      for (const [index, schema] of [
        EntityArchivedSchema,
        EntityUnarchivedSchema,
        EntityDeletedSchema,
        EntityRestoredSchema,
      ].entries()) {
        const lifecycle = AnyMessages.unpack(changes[index]?.message as never, schema);
        expect(lifecycle).toMatchObject({
          entity: { typeUrl: TypeUrls.derive(AggregateStateSchema) },
          signalId: [{ typeUrl: TypeUrls.derive(AggregateStateSchema) }],
        });
        expect(lifecycle?.version?.number).toBeGreaterThan(0);
      }
    } finally {
      await context.close();
    }
  });

  it("emits lifecycle-only projection transitions across delete and restore", async () => {
    const changes: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .addEventDispatcher({
        messageSchemas: () => [
          EntityCreatedSchema,
          EntityStateChangedSchema,
          EntityArchivedSchema,
          EntityUnarchivedSchema,
          EntityDeletedSchema,
          EntityRestoredSchema,
        ],
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await context
        .eventBus()
        .post(createProjectionEvent("projection-seed", "projection-lifecycle"));
      await waitForCondition(() => changes.length === 2);
      changes.splice(0);
      for (const [index, name] of [
        "archive-lifecycle",
        "archive-lifecycle",
        "unarchive-lifecycle",
        "delete-lifecycle",
        "restore-lifecycle",
      ].entries()) {
        await context
          .eventBus()
          .post(
            createProjectionEvent(`projection-${String(index)}`, "projection-lifecycle", { name }),
          );
      }
      await waitForCondition(() => changes.length === 4);
      expect(changes.map((event) => event.message?.typeUrl)).toEqual([
        TypeUrls.derive(EntityArchivedSchema),
        TypeUrls.derive(EntityUnarchivedSchema),
        TypeUrls.derive(EntityDeletedSchema),
        TypeUrls.derive(EntityRestoredSchema),
      ]);
      await expect(
        standAccess.readCurrent(context.stand(), ProjectionStateSchema, "projection-lifecycle", {}),
      ).resolves.toMatchObject({
        archived: false,
        deleted: false,
        state: { name: "Task (projected)" },
      });
    } finally {
      await context.close();
    }
  });

  it("emits EntityArchived after a seeded process-manager archive", async () => {
    RoutingProcessManager.reset();
    const changes: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityCreatedSchema, EntityStateChangedSchema, EntityArchivedSchema],
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await context.commandBus().post(createAggregateCommand("pm-seed", "pm-archive"));
      await waitForCondition(() => changes.length === 2);
      changes.splice(0);
      await context
        .commandBus()
        .post(createAggregateCommand("pm-archive", "pm-archive", "archive-lifecycle"));
      expect(RoutingProcessManager.commandCalls).toBe(2);
      await waitForCondition(() => changes.length === 1);
      expect(changes[0]?.message?.typeUrl).toBe(TypeUrls.derive(EntityArchivedSchema));
    } finally {
      await context.close();
    }
  });

  it("rehydrates archived process managers for a lifecycle-only unarchive", async () => {
    RoutingProcessManager.reset();
    const changes: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [
          EntityCreatedSchema,
          EntityStateChangedSchema,
          EntityArchivedSchema,
          EntityUnarchivedSchema,
          EntityDeletedSchema,
          EntityRestoredSchema,
        ],
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await context.commandBus().post(createAggregateCommand("pm-seed-all", "pm-all"));
      await waitForCondition(() => changes.length === 2);
      changes.splice(0);
      await context
        .commandBus()
        .post(createAggregateCommand("pm-archive-all", "pm-all", "archive-lifecycle"));
      await waitForCondition(() => changes.length === 1);
      await expect(
        standAccess.readCurrent(context.stand(), ProcessManagerStateSchema, "pm-all", {}),
      ).resolves.toMatchObject({ archived: true });
      changes.splice(0);
      await context
        .commandBus()
        .post(createAggregateCommand("pm-unarchive-all", "pm-all", "unarchive-lifecycle"));
      expect(RoutingProcessManager.commandCalls).toBe(3);
      await expect(
        standAccess.readCurrent(context.stand(), ProcessManagerStateSchema, "pm-all", {}),
      ).resolves.toMatchObject({ archived: false });
      await waitForCondition(() => changes.length === 1);
      expect(changes[0]?.message?.typeUrl).toBe(TypeUrls.derive(EntityUnarchivedSchema));
      changes.splice(0);
      await context
        .commandBus()
        .post(createAggregateCommand("pm-delete-all", "pm-all", "delete-lifecycle"));
      await expect(
        standAccess.readCurrent(context.stand(), ProcessManagerStateSchema, "pm-all", {}),
      ).resolves.toMatchObject({ deleted: true });
      await waitForCondition(() => changes.length === 1);
      expect(changes[0]?.message?.typeUrl).toBe(TypeUrls.derive(EntityDeletedSchema));
      changes.splice(0);
      await context
        .commandBus()
        .post(createAggregateCommand("pm-restore-all", "pm-all", "restore-lifecycle"));
      await expect(
        standAccess.readCurrent(context.stand(), ProcessManagerStateSchema, "pm-all", {}),
      ).resolves.toMatchObject({ deleted: false, state: { queue: "Task assigned" } });
      await waitForCondition(() => changes.length === 1);
      expect(changes[0]?.message?.typeUrl).toBe(TypeUrls.derive(EntityRestoredSchema));
    } finally {
      await context.close();
    }
  });

  it("records failed state-change follow-ups with absent and present prior state", async () => {
    const changes: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityStateChangedSchema],
        dispatch: (event) => {
          changes.push(event);
          return Promise.reject(new Error("state-change follow-up failed"));
        },
      })
      .build();

    try {
      await context.commandBus().post(createAggregateCommand("state-change-first", "state-change"));
      await context
        .commandBus()
        .post(createAggregateCommand("state-change-second", "state-change", "Second"));
      await waitForFailures(context, 2);

      expect(changes).toHaveLength(2);
      await expect(
        context.stand().readVersioned(AggregateStateSchema, "state-change"),
      ).resolves.toMatchObject({ state: { name: "Second (applied)" }, version: { number: 2 } });
      expect(readStateChange(changes[0])?.oldState).toBeUndefined();
      const oldState = readStateChange(changes[1])?.oldState;
      if (oldState === undefined) {
        throw new Error("Expected a prior state on the second state-change notification.");
      }
      expect(AnyMessages.unpack(oldState, AggregateStateSchema)).toMatchObject({
        id: "state-change",
        name: "Task (applied)",
      });
      expect(context.storedEventDispatchFailures()).toMatchObject([
        { error: { message: "state-change follow-up failed" } },
        { error: { message: "state-change follow-up failed" } },
      ]);
      expect(changes).toHaveLength(2);
    } finally {
      await context.close();
    }
  });

  it("publishes one causally linked change for aggregate reactors, projections, and process managers", async () => {
    const aggregateChanges: SpineEvent[] = [];
    const aggregate = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedReactorRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityStateChangedSchema],
        dispatch: (event) => {
          aggregateChanges.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await aggregate.eventBus().post(createProjectionEvent("reactor-source", "reactor-id"));
      await waitForCondition(() => aggregateChanges.length === 1);
      expect(readStateChange(aggregateChanges[0])).toMatchObject({
        entity: { typeUrl: TypeUrls.derive(AggregateStateSchema) },
        signalId: [{ typeUrl: TypeUrls.derive(ProjectionEventSchema) }],
        newVersion: { number: 1 },
      });
      expect(aggregateChanges[0]?.context?.origin.case).toBe("pastMessage");
    } finally {
      await aggregate.close();
    }

    const projectionChanges: SpineEvent[] = [];
    const projection = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityStateChangedSchema],
        dispatch: (event) => {
          projectionChanges.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await projection.eventBus().post(createProjectionEvent("projection-source", "projection-id"));
      await waitForCondition(() => projectionChanges.length === 1);
      expect(readStateChange(projectionChanges[0])).toMatchObject({
        entity: { typeUrl: TypeUrls.derive(ProjectionStateSchema) },
        signalId: [{ typeUrl: TypeUrls.derive(ProjectionEventSchema) }],
        newVersion: { number: 1 },
      });
    } finally {
      await projection.close();
    }

    const pmChanges: SpineEvent[] = [];
    const processManager = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityStateChangedSchema],
        dispatch: (event) => {
          pmChanges.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await processManager.commandBus().post(createAggregateCommand("pm-command", "pm-command-id"));
      await waitForCondition(() => pmChanges.length === 1);
      expect(readStateChange(pmChanges[0])).toMatchObject({
        entity: { typeUrl: TypeUrls.derive(ProcessManagerStateSchema) },
        signalId: [{ typeUrl: TypeUrls.derive(AggregateStateSchema) }],
      });
    } finally {
      await processManager.close();
    }

    const pmEventChanges: SpineEvent[] = [];
    const eventProcessManager = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerReactRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityStateChangedSchema],
        dispatch: (event) => {
          pmEventChanges.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await eventProcessManager.eventBus().post(createProjectionEvent("pm-event", "pm-event-id"));
      await waitForCondition(() => pmEventChanges.length === 1);
      expect(readStateChange(pmEventChanges[0])).toMatchObject({
        entity: { typeUrl: TypeUrls.derive(ProcessManagerStateSchema) },
        signalId: [{ typeUrl: TypeUrls.derive(ProjectionEventSchema) }],
      });
    } finally {
      await eventProcessManager.close();
    }
  });

  it("does not publish a state change when a projection leaves state unchanged", async () => {
    const changes: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createPassiveProjectionRepository())
      .addEventDispatcher({
        messageSchemas: () => [EntityStateChangedSchema],
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await context.eventBus().post(createProjectionEvent("unchanged", "unchanged-id"));
      await context.close();
      expect(changes).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("does not publish when aggregate transition validation rejects the handler mutation", async () => {
    const changes: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createTransitionViolatingRepository())
      .addEventDispatcher({
        messageSchemas: () => [
          EntityCreatedSchema,
          EntityStateChangedSchema,
          EntityArchivedSchema,
          EntityUnarchivedSchema,
          EntityDeletedSchema,
          EntityRestoredSchema,
        ],
        dispatch: (event) => {
          changes.push(event);
          return Promise.resolve();
        },
      })
      .build();
    try {
      await expect(
        context.commandBus().post(createAggregateCommand("rejected-change", "rejected-id")),
      ).resolves.toBeUndefined();
      await context.close();
      expect(changes).toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("rebuilds projection state from stored events without re-appending them", async () => {
    ExecutingTaskProjection.reset();
    const storageFactory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(createExecutingProjectionRepository())
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, storageFactory);

    await context.eventBus().post(createProjectionEvent("event-catch-up", "task-catch-up"));
    await context.stand().update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-catch-up",
        name: "Wrong",
        priority: 99,
      }),
    );
    await context.stand().update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-stale",
        name: "Stale",
        priority: 7,
      }),
    );

    const storedBefore = await eventStore.read();
    ExecutingTaskProjection.reset();

    await expect(context.catchUpReadSide()).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 2,
      clearedStateTypes: [TypeUrls.derive(ProjectionStateSchema)],
    });
    await expect(
      context.stand().readVersioned(ProjectionStateSchema, "task-catch-up"),
    ).resolves.toEqual({
      state: create(ProjectionStateSchema, {
        id: "task-catch-up",
        name: "Task (projected)",
        priority: 2,
      }),
      version: create(VersionSchema, { number: 1 }),
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-stale"),
    ).resolves.toBeUndefined();
    await expect(eventStore.read()).resolves.toEqual(storedBefore);
    expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
  });

  it("keeps read-side catch-up tenant-scoped", async () => {
    ExecutingTaskProjection.reset();
    const context = BoundedContext.multitenant("Tasks")
      .add(createProjectionProducingRepository())
      .add(createExecutingProjectionRepository())
      .build();

    await context
      .commandBus()
      .post(
        createAggregateCommand(
          "command-catch-up-tenant-a",
          "task-catch-up-tenant",
          "A",
          "tenant-a",
        ),
      );
    await context
      .commandBus()
      .post(
        createAggregateCommand(
          "command-catch-up-tenant-b",
          "task-catch-up-tenant",
          "B",
          "tenant-b",
        ),
      );
    await waitForProjectionState(context, "task-catch-up-tenant", "tenant-a");
    const tenantBBefore = await waitForProjectionState(context, "task-catch-up-tenant", "tenant-b");

    await context.stand().update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-catch-up-tenant",
        name: "Wrong tenant-a",
        priority: 99,
      }),
      { tenantId: createTenantId("tenant-a") },
    );
    ExecutingTaskProjection.reset();

    await expect(
      context.catchUpReadSide({ tenantId: createTenantId("tenant-a") }),
    ).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [TypeUrls.derive(ProjectionStateSchema)],
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-catch-up-tenant", {
        tenantId: createTenantId("tenant-a"),
      }),
    ).resolves.toEqual(
      create(ProjectionStateSchema, {
        id: "task-catch-up-tenant",
        name: "Task (projected)",
        priority: 2,
      }),
    );
    await expect(
      context.stand().read(ProjectionStateSchema, "task-catch-up-tenant", {
        tenantId: createTenantId("tenant-b"),
      }),
    ).resolves.toEqual(tenantBBefore);
    expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
  });

  it("rejects read-side catch-up tenant options that do not match the context mode", async () => {
    const singleTenant = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .build();
    const multitenant = BoundedContext.multitenant("Tasks")
      .add(createExecutingProjectionRepository())
      .build();

    await expect(
      singleTenant.catchUpReadSide({ tenantId: createTenantId("tenant-a") }),
    ).rejects.toThrow('Single-tenant read-side catch-up for "Tasks" does not accept tenantId.');
    await expect(multitenant.catchUpReadSide()).rejects.toThrow(
      'Multitenant read-side catch-up for "Tasks" requires tenantId.',
    );
    await expect(multitenant.catchUpReadSide({ tenantId: createTenantId(" \t ") })).rejects.toThrow(
      /non-empty TenantId/,
    );
  });

  it("replays stored events only to matching projection dispatchers during catch-up", async () => {
    ExecutingTaskProjection.reset();
    AlternateCatchUpProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .add(createAlternateCatchUpProjectionRepository())
      .build();

    await context.eventBus().post(createProjectionEvent("event-primary", "task-primary"));
    await context.eventBus().post(
      SignalEnvelopes.event({
        id: create(EventIdSchema, { value: "event-alternate" }),
        context: create(EventContextSchema),
        schema: TaskCreatedSchema,
        message: create(TaskCreatedSchema, {
          id: create(TodoIdSchema, { value: "task-alternate" }),
          taskListId: create(TodoTaskListIdSchema, { value: "task-alternate" }),
          title: "Alternate task",
        }),
      }),
    );
    await context.stand().update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-primary",
        name: "Wrong primary",
        priority: 99,
      }),
    );
    await context.stand().update(
      TaskListSchema,
      create(TaskListSchema, {
        id: create(TodoTaskListIdSchema, { value: "task-alternate" }),
        openTaskCount: 99,
      }),
    );
    ExecutingTaskProjection.reset();
    AlternateCatchUpProjection.reset();

    await expect(context.catchUpReadSide()).resolves.toEqual({
      replayedEventCount: 2,
      clearedEntityCount: 2,
      clearedStateTypes: [TypeUrls.derive(ProjectionStateSchema), TypeUrls.derive(TaskListSchema)],
    });
    await expect(context.stand().read(ProjectionStateSchema, "task-primary")).resolves.toEqual(
      create(ProjectionStateSchema, {
        id: "task-primary",
        name: "Task (projected)",
        priority: 2,
      }),
    );
    await expect(
      context
        .stand()
        .read(TaskListSchema, create(TodoTaskListIdSchema, { value: "task-alternate" })),
    ).resolves.toEqual(
      create(TaskListSchema, {
        id: create(TodoTaskListIdSchema, { value: "task-alternate" }),
        openTaskCount: 1,
      }),
    );
    expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
    expect(AlternateCatchUpProjection.subscriberCalls).toBe(1);
  });

  it("counts only matched replay events during catch-up", async () => {
    ExecutingTaskProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .build();

    await context.eventBus().post(createProjectionEvent("event-shared-state", "task-shared-state"));
    await context.eventBus().post(
      SignalEnvelopes.event({
        id: create(EventIdSchema, { value: "event-unmatched-state" }),
        context: create(EventContextSchema, {
          version: create(VersionSchema, { number: 1 }),
        }),
        schema: NumberRouteEventSchema,
        message: create(NumberRouteEventSchema, {
          id: 7,
        }),
      }),
    );
    await context.stand().update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-shared-state",
        name: "Wrong shared state",
        priority: 99,
      }),
    );
    ExecutingTaskProjection.reset();

    await expect(context.catchUpReadSide()).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [TypeUrls.derive(ProjectionStateSchema)],
    });
    expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
  });

  it("preserves exact multitenant catch-up tenant IDs instead of trimming them", async () => {
    ExecutingTaskProjection.reset();
    const rawTenantId = " tenant-a ";
    const trimmedTenantId = "tenant-a";
    const context = BoundedContext.multitenant("Tasks")
      .add(createProjectionProducingRepository())
      .add(createExecutingProjectionRepository())
      .build();

    await context
      .commandBus()
      .post(createAggregateCommand("command-space-raw", "task-space-tenant", "Raw", rawTenantId));
    await context
      .commandBus()
      .post(
        createAggregateCommand(
          "command-space-trimmed",
          "task-space-tenant",
          "Trimmed",
          trimmedTenantId,
        ),
      );
    await waitForProjectionState(context, "task-space-tenant", rawTenantId);
    const trimmedBefore = await waitForProjectionState(
      context,
      "task-space-tenant",
      trimmedTenantId,
    );

    await context.stand().update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-space-tenant",
        name: "Wrong raw tenant",
        priority: 99,
      }),
      { tenantId: createTenantId(rawTenantId) },
    );
    ExecutingTaskProjection.reset();

    await expect(
      context.catchUpReadSide({ tenantId: createTenantId(rawTenantId) }),
    ).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [TypeUrls.derive(ProjectionStateSchema)],
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-space-tenant", {
        tenantId: createTenantId(rawTenantId),
      }),
    ).resolves.toEqual(
      create(ProjectionStateSchema, {
        id: "task-space-tenant",
        name: "Task (projected)",
        priority: 2,
      }),
    );
    await expect(
      context.stand().read(ProjectionStateSchema, "task-space-tenant", {
        tenantId: createTenantId(trimmedTenantId),
      }),
    ).resolves.toEqual(trimmedBefore);
    expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
  });

  it("accepts import-context domain tenant IDs during multitenant catch-up", async () => {
    ExecutingTaskProjection.reset();
    const storageFactory = new InMemoryStorageFactory();
    const context = BoundedContext.multitenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(createExecutingProjectionRepository())
      .build();
    const eventStore = new EventStore(
      { name: "Tasks", multitenant: true, tenantId: createTenantId("example.com", "domain") },
      storageFactory,
    );

    await eventStore.append(
      createProjectionEvent("event-domain-tenant", "task-domain-tenant", {
        importTenantId: "example.com",
        importTenantKind: "domain",
      }),
    );

    await expect(
      context.catchUpReadSide({ tenantId: createTenantId("example.com", "domain") }),
    ).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 0,
      clearedStateTypes: [TypeUrls.derive(ProjectionStateSchema)],
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-domain-tenant", {
        tenantId: createTenantId("example.com", "domain"),
      }),
    ).resolves.toEqual(
      create(ProjectionStateSchema, {
        id: "task-domain-tenant",
        name: "Task (projected)",
        priority: 2,
      }),
    );
  });

  it("accepts past-message email tenant IDs during multitenant catch-up", async () => {
    ExecutingTaskProjection.reset();
    const storageFactory = new InMemoryStorageFactory();
    const context = BoundedContext.multitenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(createExecutingProjectionRepository())
      .build();
    const eventStore = new EventStore(
      {
        name: "Tasks",
        multitenant: true,
        tenantId: createTenantId("owner@example.com", "email"),
      },
      storageFactory,
    );

    await eventStore.append(
      createProjectionEvent("event-email-tenant", "task-email-tenant", {
        pastMessageTenantId: "owner@example.com",
        pastMessageTenantKind: "email",
      }),
    );

    await expect(
      context.catchUpReadSide({ tenantId: createTenantId("owner@example.com", "email") }),
    ).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 0,
      clearedStateTypes: [TypeUrls.derive(ProjectionStateSchema)],
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-email-tenant", {
        tenantId: createTenantId("owner@example.com", "email"),
      }),
    ).resolves.toEqual(
      create(ProjectionStateSchema, {
        id: "task-email-tenant",
        name: "Task (projected)",
        priority: 2,
      }),
    );
  });

  it("stores multitenant events in the tenant selected by their envelope", async () => {
    ExecutingTaskProjection.reset();
    const storageFactory = new InMemoryStorageFactory();
    const context = BoundedContext.multitenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(createExecutingProjectionRepository())
      .build();
    const tenantBState = create(ProjectionStateSchema, {
      id: "task-corrupt-tenant",
      name: "Tenant B before catch-up",
      priority: 7,
    });
    const eventStore = new EventStore(
      { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-a") },
      storageFactory,
    );

    await eventStore.appendAll([
      createProjectionEvent("event-corrupt-tenant", "task-corrupt-tenant", {
        pastMessageTenantId: "tenant-b",
      }),
    ]);
    await context.stand().update(ProjectionStateSchema, tenantBState, {
      tenantId: createTenantId("tenant-b"),
    });

    await expect(
      context.catchUpReadSide({ tenantId: createTenantId("tenant-a") }),
    ).resolves.toMatchObject({
      replayedEventCount: 0,
    });
    await expect(
      context.catchUpReadSide({ tenantId: createTenantId("tenant-b") }),
    ).resolves.toMatchObject({
      replayedEventCount: 1,
      clearedEntityCount: 1,
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-corrupt-tenant", {
        tenantId: createTenantId("tenant-b"),
      }),
    ).resolves.toMatchObject({ name: "Task (projected)", priority: 2 });
    expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
  });

  it("rejects multitenant catch-up events without an envelope tenant", async () => {
    ExecutingTaskProjection.reset();
    const storageFactory = new InMemoryStorageFactory();
    const context = BoundedContext.multitenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(createExecutingProjectionRepository())
      .build();
    const eventStore = new EventStore(
      { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-a") },
      storageFactory,
    );

    await eventStore.append(createProjectionEvent("event-missing-tenant", "task-missing-tenant"));

    await expect(
      context.catchUpReadSide({ tenantId: createTenantId("tenant-a") }),
    ).rejects.toMatchObject({
      name: "ReadCatchUpReplayError",
      code: "READ_SIDE_CATCH_UP_REPLAY_FAILED",
      eventId: "event-missing-tenant",
      detail: {
        name: "Error",
        message: "Read-side catch-up requires stored event envelope tenant.",
      },
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-missing-tenant", {
        tenantId: createTenantId("tenant-a"),
      }),
    ).resolves.toBeUndefined();
    expect(ExecutingTaskProjection.subscriberCalls).toBe(0);
  });

  it("serializes concurrent read-side catch-up calls", async () => {
    BlockingCatchUpProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createBlockingCatchUpProjectionRepository())
      .build();

    await context.eventBus().post(createProjectionEvent("event-blocking", "task-blocking"));
    await context.stand().update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-blocking",
        name: "Wrong blocking",
        priority: 99,
      }),
    );
    BlockingCatchUpProjection.reset(2);

    const first = context.catchUpReadSide();
    const second = context.catchUpReadSide();

    await waitForCondition(() => BlockingCatchUpProjection.startedCalls === 1);
    expect(BlockingCatchUpProjection.completedCalls).toBe(0);
    BlockingCatchUpProjection.release(0);

    await expect(first).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [TypeUrls.derive(ProjectionStateSchema)],
    });
    await waitForCondition(() => BlockingCatchUpProjection.startedCalls === 2);
    expect(BlockingCatchUpProjection.completedCalls).toBe(1);
    BlockingCatchUpProjection.release(1);

    await expect(second).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [TypeUrls.derive(ProjectionStateSchema)],
    });
    expect(BlockingCatchUpProjection.completedCalls).toBe(2);
  });

  it("serializes read-side catch-up with live event intake on the EventBus queue", async () => {
    BlockingCatchUpProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createBlockingCatchUpProjectionRepository())
      .build();

    await context.eventBus().post(createProjectionEvent("event-queued-catch-up", "task-queued"));
    await context.stand().update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-queued",
        name: "Wrong queued",
        priority: 99,
      }),
    );
    BlockingCatchUpProjection.reset(2);

    const catchUp = context.catchUpReadSide();
    await waitForCondition(() => BlockingCatchUpProjection.startedCalls === 1);

    const livePost = context
      .eventBus()
      .post(createProjectionEvent("event-queued-live", "task-live"));

    await expect(Promise.race([livePost.then(() => "posted"), delay(25)])).resolves.toBe("pending");
    expect(BlockingCatchUpProjection.completedCalls).toBe(0);
    await expect(context.stand().read(ProjectionStateSchema, "task-live")).resolves.toBeUndefined();

    BlockingCatchUpProjection.release(0);

    await expect(catchUp).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [TypeUrls.derive(ProjectionStateSchema)],
    });
    await waitForCondition(() => BlockingCatchUpProjection.startedCalls === 2);
    expect(BlockingCatchUpProjection.completedCalls).toBe(1);

    BlockingCatchUpProjection.release(1);

    await expect(livePost).resolves.toBeUndefined();
    expect(BlockingCatchUpProjection.completedCalls).toBe(2);
    await expect(context.stand().read(ProjectionStateSchema, "task-live")).resolves.toEqual(
      create(ProjectionStateSchema, {
        id: "task-live",
        name: "Task (blocking)",
        priority: 2,
      }),
    );
  });

  it("waits for active read-side catch-up before closing the context", async () => {
    BlockingCatchUpProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createBlockingCatchUpProjectionRepository())
      .build();

    await context.eventBus().post(createProjectionEvent("event-close", "task-close"));
    await context.stand().update(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
        id: "task-close",
        name: "Wrong close",
        priority: 99,
      }),
    );
    BlockingCatchUpProjection.reset(1);

    const catchUp = context.catchUpReadSide();
    await waitForCondition(() => BlockingCatchUpProjection.startedCalls === 1);

    const close = context.close().then(() => "closed");

    await expect(Promise.race([close, delay(25)])).resolves.toBe("pending");

    BlockingCatchUpProjection.release(0);

    await expect(catchUp).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [TypeUrls.derive(ProjectionStateSchema)],
    });
    await expect(close).resolves.toBe("closed");
  });

  it("reports a stable error when stored projection replay fails during catch-up", async () => {
    ThrowingTaskProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createThrowingProjectionRepository())
      .build();

    await expect(
      context
        .eventBus()
        .post(createProjectionEvent("event-catch-up-failure", "task-catch-up-failure")),
    ).resolves.toBeUndefined();

    await expect(context.catchUpReadSide()).rejects.toMatchObject({
      name: "ReadCatchUpReplayError",
      code: "READ_SIDE_CATCH_UP_REPLAY_FAILED",
      eventId: "event-catch-up-failure",
      detail: {
        name: "Error",
        message: "projection subscriber failed",
      },
      message: 'Read-side catch-up failed for stored event "event-catch-up-failure".',
    });
    await context.catchUpReadSide().catch((error: unknown) => {
      expect(error).not.toHaveProperty("cause");
      expect(error).not.toHaveProperty("detail.stack");
    });
  });

  it("reports bounded non-error throw detail during read-side catch-up", async () => {
    ThrowingTaskProjection.reset("projection subscriber failed without Error");
    const context = BoundedContext.singleTenant("Tasks")
      .add(createThrowingProjectionRepository())
      .build();

    try {
      await expect(
        context
          .eventBus()
          .post(createProjectionEvent("event-catch-up-string-failure", "task-string-failure")),
      ).resolves.toBeUndefined();

      await expect(context.catchUpReadSide()).rejects.toMatchObject({
        name: "ReadCatchUpReplayError",
        code: "READ_SIDE_CATCH_UP_REPLAY_FAILED",
        eventId: "event-catch-up-string-failure",
        detail: {
          name: "NonErrorThrow",
          message: "projection subscriber failed without Error",
        },
      });
    } finally {
      ThrowingTaskProjection.reset();
    }
  });

  it("reports a stable error when stored catch-up events have no message type", async () => {
    const storageFactory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(createExecutingProjectionRepository())
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, storageFactory);

    await eventStore.append(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "event-without-message" }),
      }),
    );

    await expect(context.catchUpReadSide()).rejects.toMatchObject({
      name: "ReadCatchUpReplayError",
      code: "READ_SIDE_CATCH_UP_REPLAY_FAILED",
      eventId: "event-without-message",
      detail: {
        name: "Error",
        message: "Read-side catch-up requires stored event.message.typeUrl.",
      },
    });
  });

  it("passes EventContext to generated-registry two-argument event subscribers", async () => {
    GeneratedTwoArgProjection.reset();
    const context = BoundedContext.multitenant("Tasks")
      .add(createGeneratedTwoArgProjectionRepository())
      .build();

    await context.eventBus().post(
      createProjectionEvent("event-generated", "task-generated", {
        pastMessageTenantId: "tenant-b",
      }),
    );

    expect(GeneratedTwoArgProjection.argumentCounts).toEqual([2]);
    expect(GeneratedTwoArgProjection.contexts).toHaveLength(1);
    expect(GeneratedTwoArgProjection.contexts[0]?.origin).toEqual(
      projectionEventOrigin({ pastMessageTenantId: "tenant-b" }),
    );
    expect(GeneratedTwoArgProjection.contexts[0]?.version).toEqual(
      create(VersionSchema, { number: 1 }),
    );
  });

  it("delivers a typed rejection and defensive rejection context to event subscribers", async () => {
    RejectionObservingProjection.reset();
    const factory = new InMemoryStorageFactory();
    const rejection = TaskAlreadyDone.create({
      id: create(GeneratedTaskIdSchema, { value: "task-observed-rejection" }),
    });
    const expectedPayload = create(TaskAlreadyDoneSchema, {
      id: create(GeneratedTaskIdSchema, { value: "task-observed-rejection" }),
    });
    const command = createAggregateCommand(
      "command-observed-rejection",
      "task-observed-rejection",
      "Already done",
    );
    const originalCommand = clone(CommandSchema, command);
    ManagedTaskAggregate.reset(rejection);
    const context = BoundedContext.singleTenant("Tasks")
      .add(createManagedRepository())
      .add(createRejectionObservingRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(context.commandBus().post(command)).resolves.toBeUndefined();
    await waitForCondition(() => RejectionObservingProjection.messages.length === 1);

    expect(RejectionObservingProjection.argumentCounts).toEqual([2, 2]);
    expect(RejectionObservingProjection.messages).toEqual([expectedPayload]);
    expect(RejectionObservingProjection.messages[0]?.$typeName).toBe(
      TaskAlreadyDoneSchema.typeName,
    );
    expect(RejectionObservingProjection.messages[0]).not.toHaveProperty("message");
    const receivedContext = RejectionObservingProjection.contexts[0];
    expect(receivedContext?.rejection?.command).toEqual(originalCommand);
    expect(receivedContext?.rejection?.stacktrace).toBe(rejection.stack);

    const [stored] = (await eventStore.read()).filter(
      (event) => event.context?.rejection !== undefined,
    );
    expect(
      stored?.message === undefined
        ? undefined
        : AnyMessages.unpack(stored.message, TaskAlreadyDoneSchema),
    ).toEqual(expectedPayload);
    expect(stored?.context?.rejection?.command).toEqual(originalCommand);
    expect(stored?.context?.rejection?.stacktrace).toBe(rejection.stack);
    ManagedTaskAggregate.reset();
  });

  it("passes empty EventContext to a custom-routed two-argument subscriber", async () => {
    GeneratedTwoArgProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(
        createGeneratedTwoArgProjectionRepository(
          EventRouting.create<string>().route(ProjectionEventSchema, () => ["task-empty"]),
        ),
      )
      .build();

    await context.eventBus().post(createContextlessProjectionEvent("event-empty", "task-empty"));

    expect(GeneratedTwoArgProjection.argumentCounts).toEqual([2]);
    expect(GeneratedTwoArgProjection.contexts).toEqual([create(EventContextSchema)]);
  });

  it("isolates EventContext mutations between generated two-argument subscribers", async () => {
    ContextMutatingGeneratedProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createContextMutatingGeneratedProjectionRepository())
      .build();

    await context.eventBus().post(createProjectionEvent("event-mutating", "task-mutating"));

    expect(ContextMutatingGeneratedProjection.observerSawSameContext).toBe(false);
    expect(ContextMutatingGeneratedProjection.observedVersions).toEqual([1]);
  });

  it("owns the projection transaction when subscribers only update draft state", async () => {
    ManagedTaskProjection.reset();
    const context = BoundedContext.singleTenant("Tasks").add(createManagedProjection()).build();

    await context.eventBus().post(createProjectionEvent("event-managed", "task-managed"));

    expect(ManagedTaskProjection.subscriberCalls).toBe(1);
    await expect(
      context.stand().readVersioned(ProjectionStateSchema, "task-managed"),
    ).resolves.toMatchObject({
      state: {
        id: "task-managed",
        name: "Task (managed)",
        priority: 2,
      },
      version: { number: 1 },
    });
  });

  it("writes live projection subscriber delivery through a durable inbox row", async () => {
    ExecutingTaskProjection.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .withStorageFactory(factory)
      .build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });

    await context.eventBus().post(createProjectionEvent("event-inbox", "task-inbox"));

    expect(ExecutingTaskProjection.subscriberCalls).toBe(1);

    const delivered = await delivery.inbox.read(ShardIndex.single(), {
      statuses: ["DELIVERED"],
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      inboxId: {
        targetId: Identifiers.pack("string", "task-inbox"),
        targetTypeUrl: TypeUrls.derive(ProjectionStateSchema),
      },
      signalId: "event-inbox",
      label: "UPDATE_SUBSCRIBER",
      status: "DELIVERED",
    });
    expect(delivered[0]?.keepUntil).toBeInstanceOf(Date);

    const storedEvent =
      delivered[0]?.signal === undefined
        ? undefined
        : AnyMessages.unpack(delivered[0].signal, EventSchema);

    expect(storedEvent?.id?.value).toBe("event-inbox");
  });

  it("rejects malformed durable projection inbox rows before subscriber execution", async () => {
    ExecutingTaskProjection.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createExecutingProjectionRepository();
    const context = BoundedContext.multitenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-a") },
      storageFactory: factory,
    });
    const target = requireProjectionInboxTarget(repository);
    const event = createProjectionEvent("event-projection-replay", "projection-replay", {
      importTenantId: "tenant-a",
    });
    const valid = await storePmInboxEvent(
      delivery,
      event,
      new Date("2026-07-24T21:20:00.000Z"),
      1n,
      {
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl: TypeUrls.derive(ProjectionStateSchema),
      },
    );
    const { signal: ignoredSignal, ...missingSignal } = valid;
    void ignoredSignal;
    const tenantAOrigin = projectionEventOrigin({ importTenantId: "tenant-a" });
    await expect(
      storePmInboxEvent(delivery, event, new Date("2026-07-24T21:20:01.000Z"), 2n, {
        label: "UPDATE_SUBSCRIBER",
        signalId: "event-projection-replay-undecodable",
        signal: create(AnySchema, {
          typeUrl: TypeUrls.derive(EventSchema),
          value: new Uint8Array([0]),
        }),
        targetTypeUrl: TypeUrls.derive(ProjectionStateSchema),
      }),
    ).rejects.toThrow();
    const invalidPayload = await storePmInboxEvent(
      delivery,
      SignalEnvelopes.event({
        id: create(EventIdSchema, { value: "event-projection-invalid-payload" }),
        context: create(EventContextSchema, {
          ...(tenantAOrigin === undefined ? {} : { origin: tenantAOrigin }),
        }),
        schema: ProjectionEventSchema,
        message: create(ProjectionEventSchema, { id: "projection-replay", name: "Task" }),
      }),
      new Date("2026-07-24T21:20:02.000Z"),
      3n,
      {
        label: "UPDATE_SUBSCRIBER",
        targetId: "projection-replay",
        signalId: "event-projection-replay-invalid-payload",
        signal: AnyMessages.pack(
          EventSchema,
          create(EventSchema, {
            id: create(EventIdSchema, { value: "event-projection-invalid-payload" }),
            context: create(EventContextSchema, {
              ...(tenantAOrigin === undefined ? {} : { origin: tenantAOrigin }),
            }),
            message: create(AnySchema, {
              typeUrl: TypeUrls.derive(ProjectionEventSchema),
              value: new Uint8Array([255]),
            }),
          }),
          { validate: false },
        ),
        targetTypeUrl: TypeUrls.derive(ProjectionStateSchema),
      },
    );
    const missingTenant = await storePmInboxEvent(
      delivery,
      createProjectionEvent("event-projection-missing-tenant", "projection-replay"),
      new Date("2026-07-24T21:20:03.000Z"),
      4n,
      {
        label: "UPDATE_SUBSCRIBER",
        signalId: "event-projection-replay-missing-tenant",
        targetTypeUrl: TypeUrls.derive(ProjectionStateSchema),
      },
    );
    const mismatchedTenant = await storePmInboxEvent(
      delivery,
      createProjectionEvent("event-projection-mismatched-tenant", "projection-replay", {
        importTenantId: "tenant-b",
      }),
      new Date("2026-07-24T21:20:04.000Z"),
      5n,
      {
        label: "UPDATE_SUBSCRIBER",
        signalId: "event-projection-replay-mismatched-tenant",
        targetTypeUrl: TypeUrls.derive(ProjectionStateSchema),
      },
    );
    try {
      await expect(target.replay({ ...valid, label: "REACT_UPON_EVENT" } as never)).rejects.toThrow(
        'Projection inbox replay does not handle "REACT_UPON_EVENT" messages.',
      );
      await expect(
        target.replay(missingSignal as never, createTenantId("tenant-a")),
      ).rejects.toThrow("Projection inbox replay requires a readable stored event.");
      await expect(
        target.replay(invalidPayload as never, createTenantId("tenant-a")),
      ).rejects.toThrow("Projection inbox replay requires a readable event payload.");
      await expect(
        target.replay(missingTenant as never, createTenantId("tenant-a")),
      ).rejects.toThrow("Projection inbox replay requires stored event tenant metadata.");
      await expect(
        target.replay(mismatchedTenant as never, createTenantId("tenant-a")),
      ).rejects.toThrow("Projection inbox replay stored event tenant does not match.");
      expect(ExecutingTaskProjection.subscriberCalls).toBe(0);
      await expect(
        context.stand().read(ProjectionStateSchema, "projection-replay", {
          tenantId: createTenantId("tenant-a"),
        }),
      ).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });

  it("routes a Projection Event once at admission and not during replay", async () => {
    ExecutingTaskProjection.reset();
    let routeCalls = 0;
    const eventRouting = EventRouting.create<string>().route(ProjectionEventSchema, (message) => {
      routeCalls += 1;
      return [message.id];
    });
    const factory = new InMemoryStorageFactory();
    const repository = createExecutingProjectionRepository(eventRouting);
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();

    try {
      await context
        .eventBus()
        .post(createProjectionEvent("event-projection-admission", "projection-admission"));
      await waitForCondition(() => ExecutingTaskProjection.subscriberCalls === 1);
      expect(routeCalls).toBe(1);

      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: factory,
      });
      const replay = await storePmInboxEvent(
        delivery,
        createProjectionEvent("event-projection-replay-count", "projection-admission"),
        new Date("2026-08-11T04:56:00.000Z"),
        1n,
        { label: "UPDATE_SUBSCRIBER", targetTypeUrl: TypeUrls.derive(ProjectionStateSchema) },
      );

      await expect(
        requireProjectionInboxTarget(repository).replay(replay),
      ).resolves.toBeUndefined();
      expect(routeCalls).toBe(1);
      expect(ExecutingTaskProjection.subscriberCalls).toBe(2);
    } finally {
      await context.close();
    }
  });

  it("delivers duplicate live projection messages without a local retention cache", async () => {
    ExecutingTaskProjection.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createExecutingProjectionRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const dispatcher = repositoryAccess.eventDispatcher(repository);
    const event = createProjectionEvent("event-duplicate-inbox", "task-duplicate-inbox");
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });

    if (dispatcher === undefined) {
      throw new Error("Expected projection repository to expose an event dispatcher.");
    }

    await dispatcher.dispatch(event);
    await dispatcher.dispatch(event);

    expect(ExecutingTaskProjection.subscriberCalls).toBe(2);
    await expect(
      context.stand().read(ProjectionStateSchema, "task-duplicate-inbox"),
    ).resolves.toMatchObject({
      name: "Task (projected)",
      priority: 2,
    });
    const delivered = await delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] });
    expect(delivered).toHaveLength(2);
    expect(
      delivered.every(
        (message) =>
          message.signalId === "event-duplicate-inbox" &&
          message.label === "UPDATE_SUBSCRIBER" &&
          message.status === "DELIVERED",
      ),
    ).toBe(true);
  });

  it("waits for concurrent duplicate live projection delivery on the repository handoff path", async () => {
    BlockingCatchUpProjection.reset(1);
    const factory = new InMemoryStorageFactory();
    const repository = createBlockingCatchUpProjectionRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const dispatcher = repositoryAccess.eventDispatcher(repository);
    const event = createProjectionEvent("event-concurrent-inbox", "task-concurrent-inbox");
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });

    if (dispatcher === undefined) {
      throw new Error("Expected projection repository to expose an event dispatcher.");
    }

    const first = dispatcher.dispatch(event);
    await waitForCondition(() => BlockingCatchUpProjection.startedCalls === 1);

    const duplicate = dispatcher.dispatch(event);

    await expect(Promise.race([duplicate.then(() => "resolved"), delay(150)])).resolves.toBe(
      "pending",
    );
    expect(BlockingCatchUpProjection.completedCalls).toBe(0);

    BlockingCatchUpProjection.release(0);

    await expect(Promise.all([first, duplicate])).resolves.toEqual([undefined, undefined]);
    expect(BlockingCatchUpProjection.startedCalls).toBe(1);
    expect(BlockingCatchUpProjection.completedCalls).toBe(1);
    await expect(
      context.stand().read(ProjectionStateSchema, "task-concurrent-inbox"),
    ).resolves.toMatchObject({
      name: "Task (blocking)",
      priority: 2,
    });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toMatchObject([
      {
        signalId: "event-concurrent-inbox",
        label: "UPDATE_SUBSCRIBER",
        status: "DELIVERED",
      },
    ]);
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

  it("atomically retains process-manager diagnostics without creating unchanged state", async () => {
    DiagnosticOnlyProcessManager.calls = 0;
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createDiagnosticOnlyProcessManagerRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: ProcessManagerStateSchema,
      eventHistory: true,
    });

    try {
      const existing = create(ProcessManagerStateSchema, {
        id: "pm-diagnostic",
        queue: "already persisted",
      });
      await storage.writeCurrent({
        entityId: "pm-diagnostic",
        lifecycle: { archived: false, deleted: false },
        state: existing,
        version: 1n,
      });
      await context.stand().update(ProcessManagerStateSchema, existing, {
        version: create(VersionSchema, { number: 1 }),
      });
      await context.commandBus().post(createAggregateCommand("pm-diagnostic", "pm-diagnostic"));

      expect(DiagnosticOnlyProcessManager.calls).toBe(1);
      await expect(
        context.stand().read(ProcessManagerStateSchema, "pm-diagnostic"),
      ).resolves.toEqual(existing);
      await expect(storage.readEvents("pm-diagnostic")).resolves.toMatchObject([
        { message: { typeUrl: TypeUrls.derive(ProjectionEventSchema) } },
      ]);
    } finally {
      await context.close();
    }
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

  it("atomically updates a timestamped current Version after repository read-modify-write", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .withStorageFactory(factory)
      .build();
    const initialVersion = create(VersionSchema, {
      number: 1,
      timestamp: create(TimestampSchema, { seconds: 41n, nanos: 7 }),
    });
    const nextVersion = create(VersionSchema, {
      number: 2,
      timestamp: create(TimestampSchema, { seconds: 42n, nanos: 8 }),
    });

    try {
      await context.stand().update(
        ProjectionStateSchema,
        create(ProjectionStateSchema, {
          id: "timestamped-cas",
          name: "Before",
          priority: 1,
        }),
        { version: initialVersion },
      );

      await expect(
        context.eventBus().post(
          createProjectionEvent("timestamped-cas-event", "timestamped-cas", {
            version: nextVersion,
          }),
        ),
      ).resolves.toBeUndefined();

      await expect(
        context.stand().readVersioned(ProjectionStateSchema, "timestamped-cas"),
      ).resolves.toEqual({
        state: create(ProjectionStateSchema, {
          id: "timestamped-cas",
          name: "Task (projected)",
          priority: 2,
        }),
        version: nextVersion,
      });
    } finally {
      await context.close();
    }
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

  it("delivers an Aggregate-produced Projection update after the shared inbox shard is released", async () => {
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
      context
        .stand()
        .read(ProjectionStateSchema, "task-tenant", { tenantId: createTenantId("tenant-b") }),
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
        tenantId: createTenantId("tenant-b"),
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
        tenantId: createTenantId("tenant-a"),
      }),
    ).resolves.toBeUndefined();
    await expect(
      context.stand().read(ProjectionStateSchema, "task-no-id-tenant", {
        tenantId: createTenantId("tenant-b"),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects aggregate commands with blank ids before tenant projection updates", async () => {
    const context = BoundedContext.multitenant("Tasks")
      .add(createProjectionProducingRepository())
      .add(createExecutingProjectionRepository())
      .build();

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("   ", "task-blank-id-tenant", "BlankId", "tenant-a")),
    ).rejects.toThrow(/command\.id/i);
    await expect(
      context.stand().read(ProjectionStateSchema, "task-blank-id-tenant", {
        tenantId: createTenantId("tenant-a"),
      }),
    ).resolves.toBeUndefined();
    await expect(
      context.stand().read(ProjectionStateSchema, "task-blank-id-tenant", {
        tenantId: createTenantId("tenant-b"),
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
      { tenantId: createTenantId("tenant-a") },
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
      context.stand().read(ProjectionStateSchema, "task-command-tenant", {
        tenantId: createTenantId("tenant-b"),
      }),
    ).resolves.toBeUndefined();
  });

  it("does not retain default-handled projection subscriber failures", async () => {
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

    expect(context.storedEventDispatchFailures()).toEqual([]);
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

  it("does not retain default-handled projection failures as dispatch diagnostics", async () => {
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

    const failures = context.storedEventDispatchFailures();

    expect(failures).toEqual([]);
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

  it("rejects a default-routed Event without a producer ID", () => {
    const repository = createRoutingRepository();

    expect(() =>
      repository.routeEvent(createContextlessProjectionEvent("event-no-producer", "field-task")),
    ).toThrow(/producer ID/);
  });

  it("rejects a malformed producer that claims the compatible target type", () => {
    const repository = createRoutingRepository();
    const event = createProjectionEvent("event-unreadable-producer", "first-field-task");
    if (event.context === undefined) throw new Error("Expected Event context.");
    event.context.producerId = create(AnySchema, {
      typeUrl: TypeUrls.derive(StringValueSchema),
      value: new Uint8Array([255]),
    });

    expect(() => repository.routeEvent(event)).toThrow(/readable compatible producer ID/);
  });

  it("falls back from an incompatible non-finite numeric producer", () => {
    const repository = createRoutingRepository();

    expect(
      repository.routeEvent(
        createProjectionEvent("event-non-finite-producer", "first-field-task", {
          producerNumber: Number.NaN,
        }),
      ).entityIds,
    ).toEqual(["first-field-task"]);
  });

  it("rejects non-finite first-field event IDs", () => {
    const repository = createNonFiniteRouteRepository();

    expect(() =>
      repository.routeEvent(
        SignalEnvelopes.event({
          id: create(EventIdSchema, { value: "event-non-finite-field" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "source" })),
            version: create(VersionSchema, { number: 1 }),
          }),
          schema: NumberRouteEventSchema,
          message: create(NumberRouteEventSchema, { id: Number.POSITIVE_INFINITY }),
        }),
      ),
    ).toThrow(/ID compatible with the Entity state/);
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
      context
        .eventBus()
        .post(createContextlessProjectionEvent("event-not-stored", "first-field-task")),
    ).rejects.toThrow(/producer ID/);
    await expect(eventStore.read()).resolves.toEqual([]);
  });

  it("runs repository event acceptance before custom dispatcher acceptance", async () => {
    const factory = new InMemoryStorageFactory();
    const observed: string[] = [];
    const customDispatcher: EventDispatcher = {
      messageSchemas: () => [ProjectionEventSchema],
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
      context
        .eventBus()
        .post(createContextlessProjectionEvent("event-rejected-before-custom", "first-field-task")),
    ).rejects.toThrow(/producer ID/);
    expect(observed).toEqual([]);
  });

  it("rejects structurally fabricated handler metadata", () => {
    const handlers = EntityHandlers.define(TaskAggregate, AggregateStateSchema, (builder) => [
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
      ).resolves.toBeUndefined();
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

function createRoutingRepository(
  commandRouting?: CommandRouting<string>,
  eventRouting?: EventRouting<string>,
): Repository<typeof TaskAggregate> {
  const handlers = EntityHandlers.define(TaskAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
    builder.react(ProjectionEventSchema, "reactToProjection"),
  ]);

  return new Repository({
    entityType: TaskAggregate,
    schema: AggregateStateSchema,
    handlers,
    ...(commandRouting === undefined ? {} : { commandRouting }),
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createImplicitIdAggregateRepository(): Repository<typeof ImplicitIdAggregate> {
  const handlers = EntityHandlers.define(ImplicitIdAggregate, AggregateStateSchema, (builder) => [
    builder.assign(ImplicitTaskCommandSchema, "assign"),
  ]);
  return new Repository({
    entityType: ImplicitIdAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createBlankStateIdAggregateRepository(): Repository<typeof BlankStateIdAggregate> {
  return new Repository({
    entityType: BlankStateIdAggregate,
    schema: AggregateStateSchema,
    handlers: EntityHandlers.define(BlankStateIdAggregate, AggregateStateSchema, (builder) => [
      builder.assign(AggregateStateSchema, "assign"),
    ]),
  });
}

function createBlankStateIdProcessManagerRepository(): Repository<
  typeof BlankStateIdProcessManager
> {
  return new Repository({
    entityType: BlankStateIdProcessManager,
    schema: ProcessManagerStateSchema,
    handlers: EntityHandlers.define(
      BlankStateIdProcessManager,
      ProcessManagerStateSchema,
      (builder) => [builder.assign(AggregateStateSchema, "assign")],
    ),
  });
}

function createBlankStateIdProjectionRepository(): Repository<typeof BlankStateIdProjection> {
  return new Repository({
    entityType: BlankStateIdProjection,
    schema: ProjectionStateSchema,
    handlers: EntityHandlers.define(BlankStateIdProjection, ProjectionStateSchema, (builder) => [
      builder.subscribe(ProjectionEventSchema, "subscribe"),
    ]),
  });
}

function createExecutingProjectionRepository(
  eventRouting?: EventRouting<string>,
): Repository<typeof ExecutingTaskProjection> {
  const handlers = EntityHandlers.define(
    ExecutingTaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionEventSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: ExecutingTaskProjection,
    schema: ProjectionStateSchema,
    handlers,
    events: [NumberRouteEventSchema],
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createFilteredProjectionRepository(): Repository<typeof FilteredTaskProjection> {
  const handlers = HandlerMetadataValues.defineArity(
    FilteredTaskProjection,
    ProjectionStateSchema,
    (builder) => [
      builder.subscribe(ProjectionEventSchema, "subscribeAnnouncements"),
      builder.subscribe(ProjectionEventSchema, "subscribeFallback"),
    ],
    [
      {
        kind: "event-subscription",
        methodName: "subscribeAnnouncements",
        parameterCount: 1,
        origin: "domestic",
        where: { eventField: "name", equals: "announcements" },
      },
      {
        kind: "event-subscription",
        methodName: "subscribeFallback",
        parameterCount: 1,
        origin: "domestic",
      },
    ],
  );

  return new Repository({
    entityType: FilteredTaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createFilteredAggregateRepository(): Repository<typeof FilteredEventAggregate> {
  const handlers = HandlerMetadataValues.defineArity(
    FilteredEventAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.react(ProjectionEventSchema, "reactAnnouncements"),
      builder.react(ProjectionEventSchema, "reactFallback"),
    ],
    [
      {
        kind: "event-reaction",
        methodName: "reactAnnouncements",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
        where: { eventField: "name", equals: "announcements" },
      },
      {
        kind: "event-reaction",
        methodName: "reactFallback",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
      },
    ],
  );

  return new Repository({
    entityType: FilteredEventAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createFilteredProcessManagerRepository(): Repository<typeof FilteredProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    FilteredProcessManager,
    ProcessManagerStateSchema,
    (builder) => [
      builder.react(ProjectionEventSchema, "reactAnnouncements"),
      builder.react(ProjectionEventSchema, "reactFallback"),
      builder.command(ProjectionEventSchema, "commandAnnouncements"),
      builder.command(ProjectionEventSchema, "commandFallback"),
    ],
    [
      {
        kind: "event-reaction",
        methodName: "reactAnnouncements",
        parameterCount: 1,
        origin: "domestic",
        where: { eventField: "name", equals: "announcements" },
      },
      {
        kind: "event-reaction",
        methodName: "reactFallback",
        parameterCount: 1,
        origin: "domestic",
      },
      {
        kind: "command-reaction",
        methodName: "commandAnnouncements",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
        where: { eventField: "name", equals: "announcements" },
      },
      {
        kind: "command-reaction",
        methodName: "commandFallback",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
      },
    ],
  );

  return new Repository({
    entityType: FilteredProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createInt64MessageIdProjectionRepository(
  eventRouting: EventRouting<Int64ProjectionId>,
): Repository<typeof Int64MessageIdProjection> {
  const handlers = EntityHandlers.define(
    Int64MessageIdProjection,
    Int64MessageIdProjectionStateSchema,
    (builder) => [builder.subscribe(Int64MessageIdProjectionEventSchema, "subscribeState")],
  );

  return new Repository({
    entityType: Int64MessageIdProjection,
    schema: Int64MessageIdProjectionStateSchema,
    handlers,
    eventRouting,
  });
}

function createCompositeRouteRepository(
  eventRouting?: EventRouting<CompositeRouteId>,
  stateUpdateRouting?: StateUpdateRouting<CompositeRouteId>,
): Repository<typeof CompositeRouteProjection> {
  const handlers = EntityHandlers.define(
    CompositeRouteProjection,
    CompositeRouteStateSchema,
    (builder) => [
      builder.assign(CompositeRouteEventSchema, "assign"),
      builder.subscribe(CompositeRouteEventSchema, "subscribe"),
      builder.subscribe(CompositeRouteSourceStateSchema, "subscribe"),
    ],
  );
  return new Repository({
    entityType: CompositeRouteProjection,
    schema: CompositeRouteStateSchema,
    handlers,
    ...(eventRouting === undefined ? {} : { eventRouting }),
    ...(stateUpdateRouting === undefined ? {} : { stateUpdateRouting }),
  });
}

function createCompositeRouteProcessManagerRepository(
  eventRouting?: EventRouting<CompositeRouteId>,
  options: { readonly doubleDispatchGuard?: boolean; readonly produces?: boolean } = {},
): Repository<typeof CompositeRouteProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    CompositeRouteProcessManager,
    CompositeRouteProcessManagerStateSchema,
    (builder) =>
      options.produces === true
        ? [
            builder.assign(CompositeRouteEventSchema, "assignAndProduce"),
            builder.react(CompositeRouteEventSchema, "react"),
          ]
        : [builder.react(CompositeRouteEventSchema, "react")],
    options.produces === true
      ? [
          {
            kind: "command-assignment",
            methodName: "assignAndProduce",
            parameterCount: 1,
            origin: "domestic",
            emittedSchemas: [CompositeRouteEventSchema],
          },
          {
            kind: "event-reaction",
            methodName: "react",
            parameterCount: 1,
            origin: "domestic",
          },
        ]
      : [
          {
            kind: "event-reaction",
            methodName: "react",
            parameterCount: 1,
            origin: "domestic",
          },
        ],
  );

  return new Repository({
    entityType: CompositeRouteProcessManager,
    schema: CompositeRouteProcessManagerStateSchema,
    handlers,
    ...(eventRouting === undefined ? {} : { eventRouting }),
    ...(options.doubleDispatchGuard === true
      ? { processManagerEventHistory: true, doubleDispatchGuard: true }
      : {}),
  });
}

function createManagedProjection(): Repository<typeof ManagedTaskProjection> {
  const handlers = EntityHandlers.define(
    ManagedTaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionEventSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: ManagedTaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createAlternateCatchUpProjectionRepository(): Repository<
  typeof AlternateCatchUpProjection
> {
  const handlers = EntityHandlers.define(AlternateCatchUpProjection, TaskListSchema, (builder) => [
    builder.subscribe(TaskCreatedSchema, "subscribeAggregate"),
  ]);

  return new Repository({
    entityType: AlternateCatchUpProjection,
    schema: TaskListSchema,
    handlers,
    eventRouting: EventRouting.create<TaskListId>().route(TaskCreatedSchema, (event) =>
      event.taskListId === undefined
        ? []
        : [create(TodoTaskListIdSchema, { value: event.taskListId.value })],
    ),
  });
}

function createBlockingCatchUpProjectionRepository(): Repository<typeof BlockingCatchUpProjection> {
  const handlers = EntityHandlers.define(
    BlockingCatchUpProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionEventSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: BlockingCatchUpProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createGeneratedTwoArgProjectionRepository(
  eventRouting?: EventRouting<string>,
): Repository<typeof GeneratedTwoArgProjection> {
  const handlers = new HandlerRegistryIngestor().ingest({
    version: 3,
    entities: [
      {
        entityType: GeneratedTwoArgProjection,
        stateSchema: ProjectionStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "subscribeTask",
            signalSchema: ProjectionEventSchema,
            emittedSchemas: [],
            parameterCount: 2,
            origin: "domestic",
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<GeneratedTwoArgProjection, typeof ProjectionStateSchema>;

  return new Repository({
    entityType: GeneratedTwoArgProjection,
    schema: ProjectionStateSchema,
    handlers,
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createRejectionObservingRepository(): Repository<typeof RejectionObservingProjection> {
  const handlers = new HandlerRegistryIngestor().ingest({
    version: 3,
    entities: [
      {
        entityType: RejectionObservingProjection,
        stateSchema: ProjectionStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "mutate",
            signalSchema: TaskAlreadyDoneSchema,
            emittedSchemas: [],
            parameterCount: 2,
            origin: "domestic",
          },
          {
            kind: "event-subscription",
            methodName: "observe",
            signalSchema: TaskAlreadyDoneSchema,
            emittedSchemas: [],
            parameterCount: 2,
            origin: "domestic",
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<RejectionObservingProjection, typeof ProjectionStateSchema>;

  return new Repository({
    entityType: RejectionObservingProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createContextMutatingGeneratedProjectionRepository(): Repository<
  typeof ContextMutatingGeneratedProjection
> {
  const handlers = new HandlerRegistryIngestor().ingest({
    version: 3,
    entities: [
      {
        entityType: ContextMutatingGeneratedProjection,
        stateSchema: ProjectionStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "mutateContext",
            signalSchema: ProjectionEventSchema,
            emittedSchemas: [],
            parameterCount: 2,
            origin: "domestic",
          },
          {
            kind: "event-subscription",
            methodName: "observeContext",
            signalSchema: ProjectionEventSchema,
            emittedSchemas: [],
            parameterCount: 2,
            origin: "domestic",
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<ContextMutatingGeneratedProjection, typeof ProjectionStateSchema>;

  return new Repository({
    entityType: ContextMutatingGeneratedProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createUserIdProjectionRepository(): Repository<typeof UserIdProjection> {
  const handlers = EntityHandlers.define(UserIdProjection, ProjectionStateSchema, (builder) => [
    builder.subscribe(UserIdSchema, "subscribeUser"),
  ]);

  return new Repository({
    entityType: UserIdProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createNonFiniteRouteRepository(): Repository<typeof NonFiniteRouteProjection> {
  const handlers = EntityHandlers.define(
    NonFiniteRouteProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(NumberRouteEventSchema, "subscribeNumber")],
  );

  return new Repository({
    entityType: NonFiniteRouteProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createMessageIdTaskRepository(): Repository<typeof MessageIdTaskAggregate> {
  const handlers = EntityHandlers.define(MessageIdTaskAggregate, TaskSchema, (builder) => [
    builder.apply(TaskCreatedSchema, "applyTaskCreated"),
    builder.apply(WrongIdRouteEventSchema, "applyWrongId"),
  ]);

  return new Repository({
    entityType: MessageIdTaskAggregate,
    schema: TaskSchema,
    handlers,
  });
}

function createInt32RoutingRepository(
  commandRouting?: CommandRouting<number>,
): Repository<typeof Int32RoutingAggregate> {
  const handlers = EntityHandlers.define(
    Int32RoutingAggregate,
    Int32AggregateStateSchema,
    (builder) => [
      builder.assign(Int32AggregateStateSchema, "assign"),
      builder.react(Int32AggregateStateSchema, "react"),
    ],
  );
  return new Repository({
    entityType: Int32RoutingAggregate,
    schema: Int32AggregateStateSchema,
    handlers,
    ...(commandRouting === undefined ? {} : { commandRouting }),
  });
}

function createInt64RoutingRepository(): Repository<typeof Int64RoutingProcessManager> {
  const handlers = EntityHandlers.define(
    Int64RoutingProcessManager,
    Int64ProcessManagerStateSchema,
    (builder) => [
      builder.assign(Int64ProcessManagerStateSchema, "assign"),
      builder.react(Int64ProcessManagerStateSchema, "react"),
    ],
  );
  return new Repository({
    entityType: Int64RoutingProcessManager,
    schema: Int64ProcessManagerStateSchema,
    handlers,
  });
}

function createMalformedFirstFieldRepository(): Repository<typeof MalformedFirstFieldAggregate> {
  const handlers = EntityHandlers.define(
    MalformedFirstFieldAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(RepeatedIdCommandSchema, "assignRepeated"),
      builder.assign(MapIdCommandSchema, "assignMap"),
    ],
  );
  return new Repository({
    entityType: MalformedFirstFieldAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createMessageIdProducingRepository(
  commandRouting?: CommandRouting<TaskId>,
): Repository<typeof MessageIdProducingAggregate> {
  const handlers = EntityHandlers.define(MessageIdProducingAggregate, TaskSchema, (builder) => [
    builder.assign(TaskSchema, "assignTask"),
  ]);

  return new Repository({
    entityType: MessageIdProducingAggregate,
    schema: TaskSchema,
    handlers,
    events: [TaskCreatedSchema],
    ...(commandRouting === undefined ? {} : { commandRouting }),
  });
}

function createTaskCreatedScalarProjectionRepository(): Repository<
  typeof TaskCreatedScalarProjection
> {
  const handlers = EntityHandlers.define(
    TaskCreatedScalarProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(TaskCreatedSchema, "subscribeTaskCreated")],
  );

  return new Repository({
    entityType: TaskCreatedScalarProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createPassiveProjectionRepository(): Repository<typeof PassiveTaskProjection> {
  const handlers = EntityHandlers.define(
    PassiveTaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionEventSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: PassiveTaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createAccumulatingProjectionRepository(): Repository<typeof AccumulatingTaskProjection> {
  const handlers = EntityHandlers.define(
    AccumulatingTaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionEventSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: AccumulatingTaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createReactingProjectionRepository(): Repository<typeof ReactingTaskProjection> {
  const handlers = EntityHandlers.define(
    ReactingTaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.react(ProjectionEventSchema, "reactTask")],
  );

  return new Repository({
    entityType: ReactingTaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createExecutingRepository(): Repository<typeof ExecutingTaskAggregate> {
  const handlers = EntityHandlers.define(
    ExecutingTaskAggregate,
    AggregateStateSchema,
    (builder) => [builder.assign(AggregateStateSchema, "assignTask")],
  );

  return new Repository({
    entityType: ExecutingTaskAggregate,
    schema: AggregateStateSchema,
    handlers,
    events: [AggregateStateSchema, TaskAlreadyDoneSchema],
  });
}

function createManagedRepository(): Repository<typeof ManagedTaskAggregate> {
  const handlers = EntityHandlers.define(ManagedTaskAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
  ]);

  return new Repository({
    entityType: ManagedTaskAggregate,
    schema: AggregateStateSchema,
    handlers,
    events: [AggregateStateSchema, TaskAlreadyDoneSchema],
  });
}

function createMessageIdRejectingRepository(): Repository<typeof MessageIdRejectingAggregate> {
  const handlers = EntityHandlers.define(MessageIdRejectingAggregate, TaskSchema, (builder) => [
    builder.assign(TaskSchema, "assignTask"),
  ]);

  return new Repository({
    entityType: MessageIdRejectingAggregate,
    schema: TaskSchema,
    handlers,
    events: [TaskCreatedSchema],
  });
}

function createGeneratedTwoArgAggregateRepository(): Repository<typeof GeneratedTwoArgAggregate> {
  const handlers = new HandlerRegistryIngestor().ingest({
    version: 3,
    entities: [
      {
        entityType: GeneratedTwoArgAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "assignTask",
            signalSchema: AggregateStateSchema,
            emittedSchemas: [AggregateStateSchema],
            parameterCount: 2,
            origin: "domestic",
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<GeneratedTwoArgAggregate, typeof AggregateStateSchema>;

  return new Repository({
    entityType: GeneratedTwoArgAggregate,
    schema: AggregateStateSchema,
    handlers,
    events: [AggregateStateSchema, TaskAlreadyDoneSchema],
  });
}

function createGeneratedReactorRepository(
  guarded = false,
): Repository<typeof GeneratedReactorAggregate> {
  const handlers = new HandlerRegistryIngestor().ingest({
    version: 3,
    entities: [
      {
        entityType: GeneratedReactorAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [
          {
            kind: "event-reaction",
            methodName: "reactProjection",
            signalSchema: ProjectionEventSchema,
            emittedSchemas: [AggregateStateSchema],
            parameterCount: 2,
            origin: "domestic",
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<GeneratedReactorAggregate, typeof AggregateStateSchema>;

  return new Repository({
    entityType: GeneratedReactorAggregate,
    schema: AggregateStateSchema,
    handlers,
    ...(guarded ? { doubleDispatchGuard: { depth: 1 } } : {}),
  });
}

function createGuardedAggregateRepository(
  eventRouting?: EventRouting<string>,
): Repository<typeof GuardedAggregate> {
  const handlers = HandlerMetadataValues.defineArity(
    GuardedAggregate,
    AggregateStateSchema,
    (builder) => [builder.react(ProjectionEventSchema, "reactProjection")],
    [
      {
        kind: "event-reaction",
        methodName: "reactProjection",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
      },
    ],
  );

  return new Repository({
    entityType: GuardedAggregate,
    schema: AggregateStateSchema,
    handlers,
    doubleDispatchGuard: { depth: 1 },
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createProducingGuardedAggregateRepository(): Repository<typeof ProducingGuardedAggregate> {
  const handlers = HandlerMetadataValues.defineArity(
    ProducingGuardedAggregate,
    AggregateStateSchema,
    (builder) => [builder.react(ProjectionEventSchema, "reactProjection")],
    [
      {
        kind: "event-reaction",
        methodName: "reactProjection",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
      },
    ],
  );

  return new Repository({
    entityType: ProducingGuardedAggregate,
    schema: AggregateStateSchema,
    handlers,
    events: [AggregateStateSchema],
    doubleDispatchGuard: true,
  });
}

function routeAggregateTargets(
  repository: Repository<typeof ProducingGuardedAggregate>,
  entityIds: readonly string[],
): void {
  const routeEvent = repository.routeEvent.bind(repository);
  Object.assign(repository, {
    routeEvent(event: SpineEvent) {
      return { ...routeEvent(event), entityIds: Object.freeze([...entityIds]) };
    },
  });
}

function createGeneratedCommandingRepository(): Repository<typeof GeneratedCommandingAggregate> {
  const handlers = new HandlerRegistryIngestor().ingest({
    version: 3,
    entities: [
      {
        entityType: GeneratedCommandingAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [
          {
            kind: "command-reaction",
            methodName: "commandProjection",
            signalSchema: ProjectionEventSchema,
            emittedSchemas: [AggregateStateSchema],
            parameterCount: 2,
            origin: "domestic",
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<GeneratedCommandingAggregate, typeof AggregateStateSchema>;

  return new Repository({
    entityType: GeneratedCommandingAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createMultiManagedRepository(): Repository<typeof MultiManagedAggregate> {
  const handlers = EntityHandlers.define(MultiManagedAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
  ]);

  return new Repository({
    entityType: MultiManagedAggregate,
    schema: AggregateStateSchema,
    handlers,
    events: [AggregateStateSchema],
  });
}

function createEmptyManagedRepository(): Repository<typeof EmptyManagedAggregate> {
  const handlers = EntityHandlers.define(EmptyManagedAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
  ]);

  return new Repository({
    entityType: EmptyManagedAggregate,
    schema: AggregateStateSchema,
    handlers,
    events: [AggregateStateSchema],
  });
}

function createEnvelopeManagedRepository(): Repository<typeof EnvelopeManagedAggregate> {
  const handlers = EntityHandlers.define(
    EnvelopeManagedAggregate,
    AggregateStateSchema,
    (builder) => [builder.assign(AggregateStateSchema, "assignTask")],
  );

  return new Repository({
    entityType: EnvelopeManagedAggregate,
    schema: AggregateStateSchema,
    handlers,
    events: [AggregateStateSchema],
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

function createValidatingProcessManagerRepository(): Repository<typeof ValidatingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    ValidatingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.assign(ValidatedTaskCommandSchema, "assignTask")],
    [
      {
        kind: "command-assignment",
        methodName: "assignTask",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [ProjectionEventSchema],
      },
    ],
  );

  return new Repository({
    entityType: ValidatingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createTransitionViolatingRepository(): Repository<typeof TransitionViolatingAggregate> {
  const handlers = EntityHandlers.define(
    TransitionViolatingAggregate,
    AggregateStateSchema,
    (builder) => [builder.assign(AggregateStateSchema, "assignTask")],
  );

  return new Repository({
    entityType: TransitionViolatingAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createRecoveringTransitionRepository(): Repository<typeof RecoveringTransitionAggregate> {
  const handlers = EntityHandlers.define(
    RecoveringTransitionAggregate,
    AggregateStateSchema,
    (builder) => [builder.assign(AggregateStateSchema, "assignTask")],
  );

  return new Repository({
    entityType: RecoveringTransitionAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createAsyncAssigneeRepository(): Repository<typeof AsyncAssigneeAggregate> {
  const handlers = EntityHandlers.define(
    AsyncAssigneeAggregate,
    AggregateStateSchema,
    (builder) => [builder.assign(AggregateStateSchema, "assignTask")],
  );

  return new Repository({
    entityType: AsyncAssigneeAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createBigintVersionRepository(): Repository<typeof BigintVersionAggregate> {
  const handlers = EntityHandlers.define(
    BigintVersionAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(AggregateStateSchema, "applyTask"),
    ],
  );

  return new Repository({
    entityType: BigintVersionAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createProjectionProducingRepository(): Repository<typeof ProjectionProducingAggregate> {
  const handlers = EntityHandlers.define(
    ProjectionProducingAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(ProjectionEventSchema, "applyProjection"),
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
  const handlers = EntityHandlers.define(
    CommandTenantProjectionProducingAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(ProjectionEventSchema, "applyProjection"),
    ],
  );

  return new Repository({
    entityType: CommandTenantProjectionProducingAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createProcessManagerAssignRepository(
  commandRouting?: CommandRouting<string>,
): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.assign(AggregateStateSchema, "assignTask")],
    [
      {
        kind: "command-assignment",
        methodName: "assignTask",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [ProjectionEventSchema],
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
    events: [ProjectionEventSchema, TaskAlreadyDoneSchema],
    ...(commandRouting === undefined ? {} : { commandRouting }),
  });
}

function createProcessManagerReactRepository(
  eventRouting?: EventRouting<string>,
): Repository<typeof RoutingProcessManager> {
  const handlers = EntityHandlers.define(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.react(ProjectionEventSchema, "reactTask")],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createProcessManagerCommandAndReactRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.react(ProjectionEventSchema, "reactTask"),
    ],
    [
      {
        kind: "command-assignment",
        methodName: "assignTask",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [ProjectionEventSchema],
      },
      {
        kind: "event-reaction",
        methodName: "reactTask",
        parameterCount: 1,
        origin: "domestic",
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createDiagnosticOnlyProcessManagerRepository(): Repository<
  typeof DiagnosticOnlyProcessManager
> {
  const handlers = HandlerMetadataValues.defineArity(
    DiagnosticOnlyProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.assign(AggregateStateSchema, "assignTask")],
    [
      {
        kind: "command-assignment",
        methodName: "assignTask",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [ProjectionEventSchema],
      },
    ],
  );

  return new Repository({
    entityType: DiagnosticOnlyProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
    events: [ProjectionEventSchema],
    processManagerEventHistory: true,
  });
}

function createGuardedProcessManagerReactRepository(
  depth = 100,
): Repository<typeof RoutingProcessManager> {
  const handlers = EntityHandlers.define(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.react(ProjectionEventSchema, "reactTask")],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
    processManagerEventHistory: true,
    doubleDispatchGuard: { depth },
  });
}

function createInboxCheckRepo(): Repository<typeof InboxCheckingProcessManager> {
  const handlers = EntityHandlers.define(
    InboxCheckingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.react(ProjectionEventSchema, "reactTask")],
  );

  return new Repository({
    entityType: InboxCheckingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createBlockingPmRepo(): Repository<typeof BlockingProcessManager> {
  const handlers = EntityHandlers.define(
    BlockingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.react(ProjectionEventSchema, "reactTask")],
  );

  return new Repository({
    entityType: BlockingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createGuardedBlockingPmRepo(): Repository<typeof BlockingProcessManager> {
  const handlers = EntityHandlers.define(
    BlockingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.react(ProjectionEventSchema, "reactTask")],
  );

  return new Repository({
    entityType: BlockingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
    processManagerEventHistory: true,
    doubleDispatchGuard: true,
  });
}

function createSplitPmRepo(): Repository<typeof SplitRouteProcessManager> {
  const handlers = EntityHandlers.define(
    SplitRouteProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.react(ProjectionEventSchema, "reactTask")],
  );

  return new Repository({
    entityType: SplitRouteProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createGuardedSplitPmRepo(
  eventRouting?: EventRouting<string>,
): Repository<typeof SplitRouteProcessManager> {
  const handlers = EntityHandlers.define(
    SplitRouteProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.react(ProjectionEventSchema, "reactTask")],
  );
  return new Repository({
    entityType: SplitRouteProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
    processManagerEventHistory: true,
    doubleDispatchGuard: true,
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createProcessManagerEventRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [
      builder.react(ProjectionEventSchema, "reactTask"),
      builder.command(ProjectionEventSchema, "commandTask"),
    ],
    [
      {
        kind: "event-reaction",
        methodName: "reactTask",
        parameterCount: 1,
        origin: "domestic",
      },
      {
        kind: "command-reaction",
        methodName: "commandTask",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createProcessManagerEventProducingRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.react(ProjectionEventSchema, "reactTaskWithEvent")],
    [
      {
        kind: "event-reaction",
        methodName: "reactTaskWithEvent",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createProcessManagerCommandOnlyRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.command(ProjectionEventSchema, "commandTask")],
    [
      {
        kind: "command-reaction",
        methodName: "commandTask",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createGuardedProcessManagerCommandOnlyRepository(): Repository<
  typeof RoutingProcessManager
> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.command(ProjectionEventSchema, "commandTask")],
    [
      {
        kind: "command-reaction",
        methodName: "commandTask",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
    processManagerEventHistory: true,
    doubleDispatchGuard: true,
  });
}

function createProcessManagerMixedEventRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [
      builder.react(ProjectionEventSchema, "reactTaskWithEvent"),
      builder.command(ProjectionEventSchema, "commandTask"),
    ],
    [
      {
        kind: "event-reaction",
        methodName: "reactTaskWithEvent",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
      },
      {
        kind: "command-reaction",
        methodName: "commandTask",
        parameterCount: 1,
        origin: "domestic",
        emittedSchemas: [AggregateStateSchema],
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createMissingSubscriberRepo(): Repository<typeof MissingSubscriberMethodProjection> {
  const handlers = EntityHandlers.define(
    MissingSubscriberMethodProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionEventSchema, "missingSubscriber")],
  );

  return new Repository({
    entityType: MissingSubscriberMethodProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createThrowingProjectionRepository(): Repository<typeof ThrowingTaskProjection> {
  const handlers = EntityHandlers.define(
    ThrowingTaskProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionEventSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: ThrowingTaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createNoApplierRepository(): Repository<typeof NoApplierAggregate> {
  const handlers = EntityHandlers.define(NoApplierAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
    builder.react(AggregateStateSchema, "reactTask"),
  ]);

  return new Repository({
    entityType: NoApplierAggregate,
    schema: AggregateStateSchema,
    handlers,
    events: [AggregateStateSchema],
  });
}

function createMalformedEventRepository(): Repository<typeof MalformedEventAggregate> {
  const handlers = EntityHandlers.define(
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
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(
        StringValueSchema,
        create(StringValueSchema, { value: aggregateId }),
      ),
      timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
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
  return SignalEnvelopes.command({
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

function createImplicitTaskCommand(commandId: string, entityId: string) {
  return SignalEnvelopes.command({
    id: create(CommandIdSchema, { uuid: commandId }),
    context: create(CommandContextSchema),
    schema: ImplicitTaskCommandSchema,
    message: create(ImplicitTaskCommandSchema, { id: entityId, name: "Implicit" }),
  });
}

function readStateChange(event: SpineEvent | undefined) {
  if (event?.message === undefined) {
    throw new Error("Expected an Entity state change event.");
  }
  return AnyMessages.unpack(event.message, EntityStateChangedSchema);
}

function diagnosticTenants(events: readonly SpineEvent[]): readonly string[] {
  return events.map((event) => {
    const origin = event.context?.origin;
    if (origin?.case !== "pastMessage") {
      throw new Error("Expected diagnostic event origin.");
    }
    const tenant = origin.value.actorContext?.tenantId?.kind;
    return tenant?.case === "value" ? tenant.value : "";
  });
}

function createContextlessAggregateCommand(id: string, aggregateId: string, name = "Task") {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: id }),
    message: AnyMessages.pack(
      AggregateStateSchema,
      create(AggregateStateSchema, {
        id: aggregateId,
        name,
        archived: false,
      }),
    ),
  });
}

function createTaskCommand(id: string, taskId: string, title = "Task") {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    message: AnyMessages.pack(
      TaskSchema,
      create(TaskSchema, {
        id: create(TaskIdSchema, { value: taskId }),
        taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
        title,
        completed: false,
      }),
    ),
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
    message: AnyMessages.pack(
      AggregateStateSchema,
      create(AggregateStateSchema, {
        id: aggregateId,
        name,
        archived: false,
      }),
    ),
  });
}

function requireEntityInboxTarget(repository: RepositoryView): {
  replay(message: InboxMessage, tenantId?: TenantId): Promise<unknown>;
} {
  const target = repositoryAccess.entityInboxTarget(repository);
  if (target === undefined) {
    throw new Error("Expected a Entity Inbox target.");
  }

  return target;
}

function requireProjectionInboxTarget(repository: RepositoryView): {
  replay(message: InboxMessage, tenantId?: TenantId): Promise<void>;
} {
  const target = repositoryAccess.projectionInboxTarget(repository);
  if (target === undefined) {
    throw new Error("Expected a projection inbox target.");
  }

  return target;
}

async function storeEntityInboxCommand(
  delivery: Delivery,
  command: SpineCommand,
  whenReceived: Date,
  version: bigint,
  overrides: {
    readonly signalId?: string;
    readonly targetId?: Any;
    readonly targetTypeUrl?: string;
  } = {},
) {
  const message = await delivery.inbox.receive({
    inboxId: {
      targetId: overrides.targetId ?? Identifiers.pack("string", readAggregateId(command)),
      targetTypeUrl: overrides.targetTypeUrl ?? TypeUrls.derive(ProcessManagerStateSchema),
    },
    signalId: overrides.signalId ?? command.id?.uuid ?? "missing-command-id",
    signal: AnyMessages.pack(CommandSchema, command, { validate: false }),
    label: "HANDLE_COMMAND",
    status: "TO_DELIVER",
    shard: ShardIndex.single(),
    whenReceived,
    version,
  });

  return message.message;
}

async function storePmInboxEvent(
  delivery: Delivery,
  event: SpineEvent,
  whenReceived: Date,
  version: bigint,
  overrides: {
    readonly signalId?: string;
    readonly targetId?: string;
    readonly packedTargetId?: Any;
    readonly targetTypeUrl?: string;
    readonly label?: InboxMessage["label"];
    readonly signal?: NonNullable<InboxMessage["signal"]>;
  } = {},
) {
  const message = await delivery.inbox.receive({
    inboxId: {
      targetId:
        overrides.packedTargetId ??
        Identifiers.pack("string", overrides.targetId ?? readProjectionId(event)),
      targetTypeUrl: overrides.targetTypeUrl ?? TypeUrls.derive(ProcessManagerStateSchema),
    },
    signalId: overrides.signalId ?? event.id?.value ?? "missing-event-id",
    signal: overrides.signal ?? AnyMessages.pack(EventSchema, event, { validate: false }),
    label: overrides.label ?? "REACT_UPON_EVENT",
    status: "TO_DELIVER",
    shard: ShardIndex.single(),
    whenReceived,
    version,
  });

  return message.message;
}

function readAggregateId(command: SpineCommand): string {
  const message =
    command.message === undefined
      ? undefined
      : AnyMessages.unpack(command.message, AggregateStateSchema);

  if (message === undefined) {
    const validated =
      command.message === undefined
        ? undefined
        : AnyMessages.unpack(command.message, ValidatedTaskCommandSchema);
    if (validated === undefined) {
      throw new Error("Expected a readable process-manager command payload.");
    }
    return validated.id;
  }

  return message.id;
}

function readProjectionId(event: SpineEvent): string {
  const message =
    event.message === undefined
      ? undefined
      : AnyMessages.unpack(event.message, ProjectionEventSchema);

  if (message === undefined) {
    throw new Error("Expected a readable process-manager event payload.");
  }

  return message.id;
}

function createValidatedEvent(id: string, aggregateId: string, name: string): SpineEvent {
  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(
        StringValueSchema,
        create(StringValueSchema, { value: aggregateId }),
      ),
      timestamp: create(TimestampSchema, { seconds: 1n }),
      version: create(VersionSchema, { number: 1 }),
    }),
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
    readonly name?: string;
    readonly producerNumber?: number;
    readonly producerMessage?: AggregateState;
    readonly importTenantId?: string;
    readonly importTenantKind?: TenantKind;
    readonly pastMessageTenantId?: string;
    readonly pastMessageTenantKind?: TenantKind;
    readonly includeVersion?: boolean;
    readonly version?: import("@spine-event-engine/proto").Version;
  } = {},
) {
  const origin = projectionEventOrigin(options);

  return SignalEnvelopes.event({
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      ...(origin === undefined ? {} : { origin }),
      producerId:
        projectionProducerId(options) ??
        AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: entityId })),
      timestamp: create(TimestampSchema, { seconds: 1n }),
      ...(options.includeVersion === false
        ? {}
        : { version: options.version ?? create(VersionSchema, { number: 1 }) }),
    }),
    schema: ProjectionEventSchema,
    message: create(ProjectionEventSchema, {
      id: entityId,
      name: options.name ?? "Task",
      priority: 1,
    }),
  });
}

function createContextlessProjectionEvent(id: string, entityId: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: AnyMessages.pack(
      ProjectionEventSchema,
      create(ProjectionEventSchema, {
        id: entityId,
        name: "Task",
        priority: 1,
      }),
    ),
  });
}

function projectionEventOrigin(options: {
  readonly importTenantId?: string;
  readonly importTenantKind?: TenantKind;
  readonly pastMessageTenantId?: string;
  readonly pastMessageTenantKind?: TenantKind;
}) {
  if (options.importTenantId !== undefined) {
    return {
      case: "importContext" as const,
      value: create(ActorContextSchema, {
        tenantId: createTenantId(options.importTenantId, options.importTenantKind),
      }),
    };
  }
  if (options.pastMessageTenantId !== undefined) {
    return {
      case: "pastMessage" as const,
      value: create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "past-command" })),
          typeUrl: TypeUrls.derive(AggregateStateSchema),
        }),
        actorContext: create(ActorContextSchema, {
          tenantId: createTenantId(options.pastMessageTenantId, options.pastMessageTenantKind),
        }),
      }),
    };
  }
  return undefined;
}

type TenantKind = "value" | "domain" | "email";

function createTenantId(value: string, kind: TenantKind = "value") {
  if (kind === "domain") {
    return create(TenantIdSchema, {
      kind: {
        case: "domain",
        value: create(InternetDomainSchema, { value }),
      },
    });
  }
  if (kind === "email") {
    return create(TenantIdSchema, {
      kind: {
        case: "email",
        value: create(EmailAddressSchema, { value }),
      },
    });
  }

  return create(TenantIdSchema, {
    kind: {
      case: "value",
      value,
    },
  });
}

function projectionProducerId(options: {
  readonly producerId?: string;
  readonly producerNumber?: number;
  readonly producerMessage?: AggregateState;
}) {
  if (options.producerMessage !== undefined) {
    return AnyMessages.pack(AggregateStateSchema, options.producerMessage);
  }
  if (options.producerNumber !== undefined) {
    return AnyMessages.pack(
      DoubleValueSchema,
      create(DoubleValueSchema, { value: options.producerNumber }),
    );
  }
  if (options.producerId !== undefined) {
    return AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: options.producerId }));
  }
  return undefined;
}

function readReadableProducerId(event: { readonly context?: unknown } | undefined) {
  const producerId = (
    event?.context as
      { readonly producerId?: ReturnType<typeof AnyMessages.pack> | undefined } | undefined
  )?.producerId;

  if (producerId === undefined) {
    return undefined;
  }

  return (
    AnyMessages.unpack(producerId, DoubleValueSchema)?.value ??
    AnyMessages.unpack(producerId, UserIdSchema)?.value ??
    AnyMessages.unpack(producerId, StringValueSchema)?.value ??
    AnyMessages.unpack(producerId, BoolValueSchema)?.value
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

function delay(ms: number): Promise<"pending"> {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("pending");
    }, ms);
  });
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 500;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  throw new Error("Timed out waiting for condition.");
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
      .read(
        ProjectionStateSchema,
        id,
        tenantId === undefined ? {} : { tenantId: createTenantId(tenantId) },
      );
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

async function waitForStoredEvents(
  eventStore: EventStore,
  count: number,
): Promise<readonly SpineEvent[]> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const events = await eventStore.read();
    if (events.length >= count) {
      return events;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return await eventStore.read();
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

/**
 * Test-only view of the shared current-record and diagnostic-event storage seam.
 */
class CurrentRecordTestStorage<S extends Message = Message> {
  readonly #factory: InMemoryStorageFactory;
  readonly #input: EntityStorageInput<unknown, S>;
  readonly #stateSchema: GenMessage<S>;

  constructor(options: {
    readonly context: StorageContext;
    readonly storageFactory: InMemoryStorageFactory;
    readonly stateSchema: GenMessage<S>;
    readonly stateHistory?: boolean;
    readonly eventHistory?: boolean;
  }) {
    this.#factory = options.storageFactory;
    this.#stateSchema = options.stateSchema;
    const metadata = describeEntityMetadata(options.stateSchema);
    this.#input = {
      ...standEntityStorageDescriptor(
        options.context,
        options.stateSchema,
        metadata.columns.map(
          (field) =>
            new RecordColumn(
              field.name,
              ColumnTypes.fromField(field.descriptor),
              (state) => (state as Record<string, unknown>)[field.localName],
            ),
        ),
      ),
      stateHistory: options.stateHistory ?? false,
      eventHistory: options.eventHistory ?? false,
    } as EntityStorageInput<unknown, S>;
  }

  async readCurrent(id: unknown): Promise<
    | {
        readonly entityId: unknown;
        readonly lifecycle: { readonly archived: boolean; readonly deleted: boolean };
        readonly state: S;
        readonly version: bigint;
      }
    | undefined
  > {
    const storage = this.#open();
    try {
      const current = await storage.current.read(id);
      if (current === undefined) return undefined;
      if (current.entityId === undefined)
        throw new Error("EntityRecord current record has no packed entity ID.");
      const entityId = this.#input.id.unpack(current.entityId);
      if (entityId === undefined)
        throw new Error("EntityRecord current record ID does not match its Entity schema.");
      const unpacked = EntityRecords.unpack(this.#stateSchema, current);
      return {
        entityId,
        lifecycle: { archived: unpacked.archived, deleted: unpacked.deleted },
        state: unpacked.state as S,
        version: unpacked.version,
      };
    } finally {
      storage.close();
    }
  }

  async readEvents(id: unknown): Promise<readonly SpineEvent[]> {
    const storage = this.#open();
    try {
      return await storage.events.backward(id, 10_000);
    } finally {
      storage.close();
    }
  }

  async readStates(id: unknown): Promise<
    readonly {
      readonly entityId: unknown;
      readonly state: S;
      readonly version: bigint;
    }[]
  > {
    const storage = this.#open();
    try {
      return (await storage.states.backward(id, 10_000)).map((record) => {
        if (record.entityId === undefined) {
          throw new Error("EntityRecord state-history row has no packed entity ID.");
        }
        const entityId = this.#input.id.unpack(record.entityId);
        if (entityId === undefined) {
          throw new Error("EntityRecord state-history ID does not match its Entity schema.");
        }
        const unpacked = EntityRecords.unpack(this.#stateSchema, record);
        return { entityId, state: unpacked.state as S, version: unpacked.version };
      });
    } finally {
      storage.close();
    }
  }

  async writeCurrent(current: {
    readonly entityId: unknown;
    readonly lifecycle: { readonly archived: boolean; readonly deleted: boolean };
    readonly state: S;
    readonly version: bigint;
  }): Promise<void> {
    const storage = this.#open();
    try {
      await storage.current.write(
        EntityRecords.pack(
          this.#stateSchema,
          current.entityId,
          current.state,
          current.version,
          current.lifecycle,
        ),
      );
    } finally {
      storage.close();
    }
  }

  #open() {
    return this.#factory.createEntityStorage(this.#input) as {
      readonly current: {
        read(id: unknown): Promise<EntityRecord | undefined>;
        write(record: EntityRecord): Promise<void>;
      };
      readonly events: {
        backward(id: unknown, depth: number): Promise<readonly SpineEvent[]>;
      };
      readonly states: {
        backward(id: unknown, depth: number): Promise<readonly EntityRecord[]>;
      };
      close(): void;
    };
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

class CountingProbeStorageFactory extends InMemoryStorageFactory {
  opened = 0;
  closed = 0;
  closedProbes = 0;

  constructor(private readonly failRead = false) {
    super();
  }

  override createEntityStorage(input: unknown): unknown {
    const storage = super.createEntityStorage(input) as {
      readonly current: unknown;
      readonly states: unknown;
      readonly events: {
        append(record: {
          readonly entityId: unknown;
          readonly event: SpineEvent;
          readonly producerVersion: bigint;
          readonly createdAt: Message;
        }): Promise<void>;
        backward(
          entityId: unknown,
          depth: number,
          startingFromVersion?: bigint,
        ): Promise<readonly SpineEvent[]>;
      };
      close(): void;
    };
    this.opened++;
    let closed = false;
    let probed = false;

    return {
      current: storage.current,
      states: storage.states,
      events: {
        append: (record: {
          readonly entityId: unknown;
          readonly event: SpineEvent;
          readonly producerVersion: bigint;
          readonly createdAt: Message;
        }) => storage.events.append(record),
        backward: (
          entityId: unknown,
          depth: number,
          startingFromVersion?: bigint,
        ): Promise<readonly SpineEvent[]> => {
          probed = true;
          if (this.failRead) return Promise.reject(new Error("guard probe read failed"));
          return storage.events.backward(entityId, depth, startingFromVersion);
        },
      },
      close: () => {
        if (!closed) {
          closed = true;
          this.closed++;
          if (probed) this.closedProbes++;
        }
        storage.close();
      },
    };
  }
}

class GatedAggregateEventStorageFactory extends InMemoryStorageFactory {
  #release!: () => void;
  #reached!: () => void;
  readonly reached = new Promise<void>((resolve) => {
    this.#reached = resolve;
  });
  readonly #gate = new Promise<void>((resolve) => {
    this.#release = resolve;
  });

  release(): void {
    this.#release();
  }

  override createEntityStorage(input: unknown): unknown {
    const storage = super.createEntityStorage(input) as {
      readonly current: unknown;
      readonly states: unknown;
      readonly events: { append(record: unknown): Promise<void>; backward: unknown };
      close(): void;
    };
    return {
      ...storage,
      close: () => {
        storage.close();
      },
      events: {
        ...storage.events,
        append: async (record: unknown) => {
          this.#reached();
          await this.#gate;
          await storage.events.append(record);
        },
      },
    };
  }

  protected override createEntityCommitStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    const storage = super.createEntityCommitStorage(input);
    return {
      commit: async <I, S extends Message>(
        unit: EntityCommitInput<I, S>,
      ): Promise<EntityCommitResult> => {
        this.#reached();
        await this.#gate;
        return await storage.commit(unit);
      },
      close: () => {
        storage.close();
      },
    } satisfies EntityCommitStorage;
  }
}

class FailingEntityCommitStorageFactory extends InMemoryStorageFactory {
  #remainingFailures = 1;

  protected override createEntityCommitStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    const storage = super.createEntityCommitStorage(input);
    return {
      commit: async <I, S extends Message>(
        unit: EntityCommitInput<I, S>,
      ): Promise<EntityCommitResult> => {
        if (this.#remainingFailures > 0) {
          this.#remainingFailures -= 1;
          throw new Error("forced Entity commit failure");
        }
        return await storage.commit(unit);
      },
      close: () => {
        storage.close();
      },
    } satisfies EntityCommitStorage;
  }
}

class OutcomeEntityCommitStorageFactory extends InMemoryStorageFactory {
  #outcomes: EntityCommitResult[];

  constructor(outcomes: readonly EntityCommitResult[]) {
    super();
    this.#outcomes = [...outcomes];
  }

  protected override createEntityCommitStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    const storage = super.createEntityCommitStorage(input);
    return {
      commit: async <I, S extends Message>(
        unit: EntityCommitInput<I, S>,
      ): Promise<EntityCommitResult> => this.#outcomes.shift() ?? (await storage.commit(unit)),
      close: () => {
        storage.close();
      },
    } satisfies EntityCommitStorage;
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
  override readonly atomicCompareAndSet = true;

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

it("rejects state-update routing for Aggregate repositories", () => {
  expectTypeOf<
    RepositoryOptions<typeof TaskAggregate>["stateUpdateRouting"]
  >().toEqualTypeOf<undefined>();
  expect(
    () =>
      new Repository({
        entityType: TaskAggregate,
        schema: AggregateStateSchema,
        stateUpdateRouting: StateUpdateRouting.create<string>(),
      } as never),
  ).toThrow(/State-update routing is supported only by Projection repositories/);
});

it("rejects state-update routing for Process Manager repositories", () => {
  expectTypeOf<
    RepositoryOptions<typeof RoutingProcessManager>["stateUpdateRouting"]
  >().toEqualTypeOf<undefined>();
  expect(
    () =>
      new Repository({
        entityType: RoutingProcessManager,
        schema: ProcessManagerStateSchema,
        stateUpdateRouting: StateUpdateRouting.create<string>(),
      } as never),
  ).toThrow(/State-update routing is supported only by Projection repositories/);
});

it("rejects Entity state subscribers outside Projection repositories", () => {
  const aggregateHandlers = EntityHandlers.define(
    TaskAggregate,
    AggregateStateSchema,
    (builder) => [builder.subscribe(ProjectionStateSchema, "reactToProjection")],
  );
  const processManagerHandlers = EntityHandlers.define(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.subscribe(ProjectionStateSchema, "reactTask")],
  );

  expect(
    () =>
      new Repository({
        entityType: TaskAggregate,
        schema: AggregateStateSchema,
        handlers: aggregateHandlers,
      }),
  ).toThrow(/Entity state subscriptions are supported only by Projection repositories/);
  expect(
    () =>
      new Repository({
        entityType: RoutingProcessManager,
        schema: ProcessManagerStateSchema,
        handlers: processManagerHandlers,
      }),
  ).toThrow(/Entity state subscriptions are supported only by Projection repositories/);
});

describe("Projection state-update routing", () => {
  it("rejects a recursive subscription to the repository state", () => {
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(ProjectionStateSchema, "subscribeState")],
    );

    expect(
      () =>
        new Repository({
          entityType: StateObservingProjection,
          schema: ProjectionStateSchema,
          handlers,
        }),
    ).toThrow(/cannot subscribe to updates of its repository state/);
  });

  it("rejects a feedback cycle between Projection state subscriptions", () => {
    const projectionHandlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(NeutralProjectionStateSchema, "subscribeState")],
    );
    const neutralProjectionHandlers = EntityHandlers.define(
      NeutralStateObservingProjection,
      NeutralProjectionStateSchema,
      (builder) => [builder.subscribe(ProjectionStateSchema, "subscribeState")],
    );
    const projection = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectionStateSchema,
      handlers: projectionHandlers,
    });
    const neutralProjection = new Repository({
      entityType: NeutralStateObservingProjection,
      schema: NeutralProjectionStateSchema,
      handlers: neutralProjectionHandlers,
    });

    expect(() =>
      BoundedContext.singleTenant("State subscription cycle")
        .add(projection)
        .add(neutralProjection)
        .build(),
    ).toThrow(/Projection state subscriptions form a feedback cycle/);
  });

  it("allows a one-way dependency between Projection state subscriptions", async () => {
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(NeutralProjectionStateSchema, "subscribeState")],
    );
    const context = BoundedContext.singleTenant("One-way state subscription")
      .add(
        new Repository({
          entityType: StateObservingProjection,
          schema: ProjectionStateSchema,
          handlers,
        }),
      )
      .add(
        new Repository({
          entityType: NeutralStateObservingProjection,
          schema: NeutralProjectionStateSchema,
        }),
      )
      .build();

    await context.close();
  });

  it("uses the first compatible state field and ignores unrelated state types", () => {
    const handlers = EntityHandlers.define(
      ExecutingTaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeTask")],
    );
    const repository = new Repository({
      entityType: ExecutingTaskProjection,
      schema: ProjectionStateSchema,
      handlers,
    });

    expect(
      repositoryAccess.routeStateUpdate(repository, createStateChangedEvent("state-1")),
    ).toMatchObject({
      entityIds: ["state-1"],
      messageFullTypeName: AggregateStateSchema.typeName,
    });
    expect(
      repositoryAccess.routeStateUpdate(
        repository,
        createStateChangedEvent("other", create(ProjectionStateSchema, { id: "other" })),
      ),
    ).toBeUndefined();
  });

  it("rejects an empty first compatible field instead of routing by a later field", () => {
    const handlers = EntityHandlers.define(
      ExecutingTaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeTask")],
    );
    const repository = new Repository({
      entityType: ExecutingTaskProjection,
      schema: ProjectionStateSchema,
      handlers,
    });

    expect(() =>
      repositoryAccess.routeStateUpdate(
        repository,
        createStateChangedEvent(
          "empty-id",
          create(AggregateStateSchema, { id: "", name: "not-an-id" }),
        ),
      ),
    ).toThrow(/state update routing requires an ID compatible with the Entity state/);
  });

  it("rejects construction when the built-in route has no compatible state field", () => {
    const handlers = EntityHandlers.define(
      Int64MessageIdProjection,
      Int64MessageIdProjectionStateSchema,
      (builder) => [builder.subscribe(Int32AggregateStateSchema, "subscribeState")],
    );

    expect(
      () =>
        new Repository({
          entityType: Int64MessageIdProjection,
          schema: Int64MessageIdProjectionStateSchema,
          handlers,
        }),
    ).toThrow(/no compatible field.*Int32AggregateState/i);
  });

  it("uses a declaration-first message ID compatible with the Projection ID", () => {
    const handlers = EntityHandlers.define(
      Int64MessageIdProjection,
      Int64MessageIdProjectionStateSchema,
      (builder) => [builder.subscribe(Int64MessageIdSourceStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: Int64MessageIdProjection,
      schema: Int64MessageIdProjectionStateSchema,
      handlers,
    });
    const id = create(Int64ProjectionIdSchema, { value: 42n });

    expect(
      repositoryAccess.routeStateUpdate(
        repository,
        createStateChangedEvent(
          "int64-message",
          create(Int64MessageIdSourceStateSchema, { id, name: "Message ID" }),
        ),
      )?.entityIds,
    ).toEqual([id]);
  });

  it("evaluates an exact multicast route once and stably deduplicates targets", () => {
    const route = vi.fn(() => ["second", "first", "second"]);
    const handlers = EntityHandlers.define(
      ExecutingTaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeTask")],
    );
    const repository = new Repository({
      entityType: ExecutingTaskProjection,
      schema: ProjectionStateSchema,
      handlers,
      stateUpdateRouting: StateUpdateRouting.create<string>().route(AggregateStateSchema, route),
    });

    const result = repositoryAccess.routeStateUpdate(repository, createStateChangedEvent("source"));

    expect(route).toHaveBeenCalledOnce();
    expect(result?.entityIds).toEqual(["second", "first"]);
    expect(Object.isFrozen(result?.entityIds)).toBe(true);
  });

  it("selects exact state routes before replacement defaults", () => {
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeState")],
    );
    const event = createStateChangedEvent("built-in");
    const cases = [
      StateUpdateRouting.create<string>()
        .route(AggregateStateSchema, () => ["exact"])
        .replaceDefault(() => ["replacement"]),
      StateUpdateRouting.create<string>().replaceDefault(() => ["replacement"]),
    ];

    expect(
      cases.map(
        (stateUpdateRouting) =>
          repositoryAccess.routeStateUpdate(
            new Repository({
              entityType: StateObservingProjection,
              schema: ProjectionStateSchema,
              handlers,
              stateUpdateRouting,
            }),
            event,
          )?.entityIds,
      ),
    ).toEqual([["exact"], ["replacement"]]);
  });

  it("selects a state interface route after exact routes and before the default", () => {
    const token = MessageInterfaces.define<object, readonly [typeof AggregateStateSchema]>([
      AggregateStateSchema,
    ]);
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectionStateSchema,
      handlers,
      stateUpdateRouting: StateUpdateRouting.create<string>()
        .route(token, () => ["interface"])
        .replaceDefault(() => ["default"]),
    });

    expect(
      repositoryAccess.routeStateUpdate(repository, createStateChangedEvent("interface"))
        ?.entityIds,
    ).toEqual(["interface"]);
  });

  it("fails closed for malformed System events", () => {
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectionStateSchema,
      handlers,
    });
    expect(() =>
      repositoryAccess.routeStateUpdate(repository, createProjectionEvent("domain", "target")),
    ).toThrow(/requires an EntityStateChanged System event/);
    const missingState = create(EventSchema, {
      id: create(EventIdSchema, { value: "missing-state" }),
      message: AnyMessages.pack(EntityStateChangedSchema, create(EntityStateChangedSchema), {
        validate: false,
      }),
    });
    expect(() => repositoryAccess.routeStateUpdate(repository, missingState)).toThrow(
      /requires.*newState/,
    );
    const unreadableState = create(EventSchema, {
      id: create(EventIdSchema, { value: "unreadable-state" }),
      message: AnyMessages.pack(
        EntityStateChangedSchema,
        create(EntityStateChangedSchema, {
          newState: create(AnySchema, {
            typeUrl: TypeUrls.derive(AggregateStateSchema),
            value: new Uint8Array([255]),
          }),
        }),
        { validate: false },
      ),
    });
    expect(() => repositoryAccess.routeStateUpdate(repository, unreadableState)).toThrow();
  });

  it("normalizes a missing EventContext before invoking a custom route", () => {
    const route = vi.fn(() => ["target"]);
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectionStateSchema,
      handlers,
      stateUpdateRouting: StateUpdateRouting.create<string>().route(AggregateStateSchema, route),
    });
    const event = createStateChangedEvent("source");
    event.context = undefined;

    repositoryAccess.routeStateUpdate(repository, event);

    expect(route).toHaveBeenCalledWith(
      expect.objectContaining({ id: "source" }),
      create(EventContextSchema),
    );
  });

  it("admits one durable state-interface row per selected target", async () => {
    StateObservingProjection.reset();
    const route = vi.fn(() => ["second", "first", "second"]);
    const token = MessageInterfaces.define<object, readonly [typeof AggregateStateSchema]>([
      AggregateStateSchema,
    ]);
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectionStateSchema,
      handlers,
      stateUpdateRouting: StateUpdateRouting.create<string>().route(token, route),
    });
    const context = BoundedContext.singleTenant("State updates").add(repository).build();

    try {
      await boundedContextAccess.postSystemEvent(
        context,
        createStateChangedEvent(
          "source",
          create(AggregateStateSchema, { id: "source", name: "Source" }),
        ),
      );

      expect(route).toHaveBeenCalledOnce();
      expect(StateObservingProjection.subscriberCalls).toBe(2);
      await expect(context.stand().read(ProjectionStateSchema, "first")).resolves.toMatchObject({
        id: "first",
        name: "Source (projected)",
        priority: 1,
      });
      await expect(context.stand().read(ProjectionStateSchema, "second")).resolves.toMatchObject({
        id: "second",
        name: "Source (projected)",
        priority: 1,
      });
    } finally {
      await context.close();
    }
  });

  it("selects state subscribers exclusively by EntityStateChanged origin during delivery and replay", async () => {
    OriginStateProjection.reset();
    const factory = new InMemoryStorageFactory();
    const handlers = HandlerMetadataValues.defineArity(
      OriginStateProjection,
      ProjectionStateSchema,
      (builder) => [
        builder.subscribe(AggregateStateSchema, "domesticState"),
        builder.subscribe(AggregateStateSchema, "externalState"),
      ],
      [
        {
          kind: "state-subscription",
          methodName: "domesticState",
          parameterCount: 1,
          origin: "domestic",
        },
        {
          kind: "state-subscription",
          methodName: "externalState",
          parameterCount: 1,
          origin: "external",
        },
      ],
    );
    const repository = new Repository({
      entityType: OriginStateProjection,
      schema: ProjectionStateSchema,
      handlers,
    });
    const context = BoundedContext.singleTenant("State origins")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const domestic = createStateChangedEvent("domestic-state");
    const external = createStateChangedEvent("external-state");
    external.context = create(EventContextSchema, { external: true });

    try {
      await boundedContextAccess.postSystemEvent(context, domestic);
      await boundedContextAccess.postSystemEvent(context, external);

      expect(OriginStateProjection.calls).toEqual([
        "domestic:domestic-state",
        "external:external-state",
      ]);

      const delivery = new Delivery({
        context: { name: "State origins", multitenant: false },
        storageFactory: factory,
      });
      const stored = await delivery.inbox.read(ShardIndex.single(), {
        statuses: ["TO_DELIVER", "DELIVERED"],
      });
      const target = requireProjectionInboxTarget(repository);
      OriginStateProjection.reset();
      for (const message of stored) await target.replay(message);

      expect(OriginStateProjection.calls.toSorted()).toEqual([
        "domestic:domestic-state",
        "external:external-state",
      ]);
    } finally {
      await context.close();
    }
  });

  it("rejects corrupted durable state-update routes without rerouting", async () => {
    PassiveTaskProjection.reset();
    const route = vi.fn(() => ["target"]);
    const token = MessageInterfaces.define<object, readonly [typeof AggregateStateSchema]>([
      AggregateStateSchema,
    ]);
    const factory = new InMemoryStorageFactory();
    const handlers = EntityHandlers.define(
      PassiveTaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: PassiveTaskProjection,
      schema: ProjectionStateSchema,
      handlers,
      stateUpdateRouting: StateUpdateRouting.create<string>().route(token, route),
    });
    const context = BoundedContext.singleTenant("Stored state updates")
      .add(repository)
      .withStorageFactory(factory)
      .build();

    try {
      await boundedContextAccess.postSystemEvent(context, createStateChangedEvent("source"));
      const delivery = new Delivery({
        context: { name: "Stored state updates", multitenant: false },
        storageFactory: factory,
      });
      const [stored] = await delivery.inbox.read(ShardIndex.single(), {
        statuses: ["TO_DELIVER", "DELIVERED"],
      });
      if (stored?.signal === undefined) {
        throw new Error("Expected a durable state-update inbox row.");
      }
      const target = requireProjectionInboxTarget(repository);
      const routeCallsBeforeReplay = route.mock.calls.length;
      await expect(target.replay(stored)).resolves.toBeUndefined();
      expect(route).toHaveBeenCalledTimes(routeCallsBeforeReplay);
      await expect(
        target.replay({
          ...stored,
          inboxId: { ...stored.inboxId, targetTypeUrl: TypeUrls.derive(AggregateStateSchema) },
        }),
      ).rejects.toThrow(/stored target type/);
      const event = AnyMessages.unpack(stored.signal, EventSchema);
      if (event === undefined) throw new Error("Expected a readable stored state-update Event.");
      await expect(
        target.replay({
          ...stored,
          signal: AnyMessages.pack(
            EventSchema,
            create(EventSchema, {
              id: event.id,
              context: event.context,
              message: AnyMessages.pack(
                EntityStateChangedSchema,
                create(EntityStateChangedSchema),
                { validate: false },
              ),
            }),
            { validate: false },
          ),
        }),
      ).rejects.toThrow(/Projection inbox replay requires EntityStateChanged\.newState/);
      expect(route).toHaveBeenCalledTimes(routeCallsBeforeReplay);
    } finally {
      await context.close();
    }
  });

  it("does not persist or invoke state subscribers when the route has no targets", async () => {
    StateObservingProjection.reset();
    const route = vi.fn(() => []);
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectionStateSchema,
      handlers,
      stateUpdateRouting: StateUpdateRouting.create<string>().route(AggregateStateSchema, route),
    });
    const context = BoundedContext.singleTenant("Empty state updates").add(repository).build();

    try {
      await boundedContextAccess.postSystemEvent(context, createStateChangedEvent("source"));

      expect(route).toHaveBeenCalledOnce();
      expect(StateObservingProjection.subscriberCalls).toBe(0);
      await expect(context.stand().read(ProjectionStateSchema, "source")).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });

  it("handles direct System dispatch before binding and suppresses unrelated state after binding", async () => {
    PassiveTaskProjection.reset();
    const handlers = EntityHandlers.define(
      PassiveTaskProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: PassiveTaskProjection,
      schema: ProjectionStateSchema,
      handlers,
    });
    const dispatcher = repositoryAccess.systemEventDispatcher(repository);
    if (dispatcher === undefined) throw new Error("Expected a repository System dispatcher.");
    const accept = dispatcher.accept?.bind(dispatcher);
    if (accept === undefined) throw new Error("Expected System dispatcher admission.");
    const related = createStateChangedEvent("direct-system");

    await dispatcher.dispatch(related);
    await accept(related);
    await dispatcher.dispatch(related);

    const context = BoundedContext.singleTenant("Direct state updates").add(repository).build();
    try {
      await dispatcher.dispatch(related);
      const unrelated = createStateChangedEvent(
        "unrelated-system",
        create(ProjectionStateSchema, { id: "unrelated-system" }),
      );
      await dispatcher.dispatch(unrelated);
      await accept(unrelated);
      await dispatcher.dispatch(unrelated);

      expect(PassiveTaskProjection.subscriberCalls).toBe(1);
    } finally {
      await context.close();
    }
  });

  it("rejects invalid route collections before invoking a subscriber", async () => {
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeState")],
    );
    const event = createStateChangedEvent("source");

    for (const route of [
      (() => new Set(["target"])) as never,
      () => Array.from({ length: 1_001 }, (_, index) => `target-${String(index)}`),
      () => ["valid", "   "],
    ]) {
      StateObservingProjection.reset();
      const repository = new Repository({
        entityType: StateObservingProjection,
        schema: ProjectionStateSchema,
        handlers,
        stateUpdateRouting: StateUpdateRouting.create<string>().route(AggregateStateSchema, route),
      });
      const context = BoundedContext.singleTenant("Invalid state route").add(repository).build();
      try {
        await expect(boundedContextAccess.postSystemEvent(context, event)).rejects.toThrow(
          /array of Entity IDs|at most 1,000 Entity IDs|compatible with the Entity state/,
        );
        expect(StateObservingProjection.subscriberCalls).toBe(0);
        await expect(context.stand().read(ProjectionStateSchema, "valid")).resolves.toBeUndefined();
      } finally {
        await context.close();
      }
    }
  });

  it("rejects exact routes for state schemas without a subscriber", () => {
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeState")],
    );

    expect(
      () =>
        new Repository({
          entityType: StateObservingProjection,
          schema: ProjectionStateSchema,
          handlers,
          stateUpdateRouting: StateUpdateRouting.create<string>().route(
            Int32AggregateStateSchema,
            () => ["target"],
          ),
        }),
    ).toThrow(/unregistered exact route/);
  });

  it("keeps durable state updates within the originating tenant", async () => {
    StateObservingProjection.reset();
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectionStateSchema,
      (builder) => [builder.subscribe(AggregateStateSchema, "subscribeState")],
    );
    const context = BoundedContext.multitenant("Tenant state updates")
      .add(
        new Repository({
          entityType: StateObservingProjection,
          schema: ProjectionStateSchema,
          handlers,
        }),
      )
      .withStorageFactory(new InMemoryStorageFactory())
      .build();

    try {
      await boundedContextAccess.postSystemEvent(
        context,
        createStateChangedEvent(
          "shared",
          create(AggregateStateSchema, { id: "shared", name: "Tenant A" }),
          "tenant-a",
        ),
      );
      await expect(
        context
          .stand()
          .read(ProjectionStateSchema, "shared", { tenantId: createTenantId("tenant-a") }),
      ).resolves.toMatchObject({ name: "Tenant A (projected)" });
      await expect(
        context
          .stand()
          .read(ProjectionStateSchema, "shared", { tenantId: createTenantId("tenant-b") }),
      ).resolves.toBeUndefined();
      await expect(
        boundedContextAccess.postSystemEvent(context, createStateChangedEvent("missing-tenant")),
      ).rejects.toThrow(/requires tenantId/);
    } finally {
      await context.close();
    }
  });
});

function createStateChangedEvent(
  id: string,
  state: Message = create(AggregateStateSchema, { id }),
  tenantId?: string,
) {
  const stateSchema =
    state.$typeName === AggregateStateSchema.typeName
      ? AggregateStateSchema
      : state.$typeName === Int64MessageIdSourceStateSchema.typeName
        ? Int64MessageIdSourceStateSchema
        : state.$typeName === CompositeRouteSourceStateSchema.typeName
          ? CompositeRouteSourceStateSchema
          : ProjectionStateSchema;
  const origin =
    tenantId === undefined ? undefined : projectionEventOrigin({ pastMessageTenantId: tenantId });
  if (tenantId !== undefined && origin === undefined) {
    throw new Error("Expected a state-update tenant origin.");
  }
  return create(EventSchema, {
    id: create(EventIdSchema, { value: `state-change-${id}` }),
    message: AnyMessages.pack(
      EntityStateChangedSchema,
      create(EntityStateChangedSchema, {
        entity: create(MessageIdSchema, {
          id: AnyMessages.pack(StringValueSchema, create(StringValueSchema, { value: id })),
          typeUrl: TypeUrls.derive(stateSchema),
        }),
        newState: AnyMessages.pack(stateSchema, state as never, { validate: false }),
        signalId: [
          create(MessageIdSchema, {
            id: AnyMessages.pack(
              StringValueSchema,
              create(StringValueSchema, { value: `signal-${id}` }),
            ),
            typeUrl: TypeUrls.derive(StringValueSchema),
          }),
        ],
      }),
    ),
    ...(origin === undefined ? {} : { context: create(EventContextSchema, { origin }) }),
  });
}
