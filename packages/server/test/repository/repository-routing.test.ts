import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { fileDesc, messageDesc } from "@bufbuild/protobuf/codegenv2";
import {
  BoolValueSchema,
  DoubleValueSchema,
  FieldDescriptorProto_Label,
  FieldDescriptorProto_Type,
  FileDescriptorProtoSchema,
  FileDescriptorSetSchema,
  StringValueSchema,
} from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packAny, packCommand, packEvent, unpackAny } from "@spine-ts/core";
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
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import type { UserId } from "@spine-ts/proto/generated/spine/core/user_id_pb.js";
import { TaskListSchema } from "../../../../examples/todo/generated/spine/example/todo/v1/task_list_pb.js";
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
  Delivery,
  ProcessManager,
  Projection,
  Repository,
  RepositoryIdentityError,
  ShardIndex,
  defineEntityHandlers,
  HandlerRegistryIngestor,
  type EntityHandlersMetadata,
  type EventDispatcher,
  type InboxMessage,
} from "../../src/index.js";
import { handlerMetadataAccess } from "../../src/handler/handler-metadata.js";
import { repositoryAccess, type RepositoryView } from "../../src/repository/repository.js";
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

type ValidatedAggregateState = Message<"example.validation_refusal.ValidatedAggregateState"> & {
  id: string;
  name: string;
};

type ValidatedTaskCommand = Message<"example.validation_refusal.ValidatedTaskCommand"> & {
  id: string;
  name: string;
};

type TaskId = Message<"spine.example.todo.v1.TaskId"> & {
  value: string;
};

type Task = Message<"spine.example.todo.v1.Task"> & {
  id?: TaskId;
  title: string;
  completed: boolean;
};

type TaskCreated = Message<"spine.example.todo.v1.TaskCreated"> & {
  id?: TaskId;
  title: string;
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
const fileTaskEventsFixture = fileDesc(
  "CidzcGluZS9leGFtcGxlL3RvZG8vdjEvdGFza19ldmVudHMucHJvdG8SFXNwaW5lLmV4YW1wbGUu" +
    "dG9kby52MSJXCgtUYXNrQ3JlYXRlZBIzCgJpZBgBIAEoCzIdLnNwaW5lLmV4YW1wbGUudG9kby52" +
    "MS5UYXNrSWRCCKCFJAHohSQBEhMKBXRpdGxlGAIgASgJQgSghSQBIlcKC1Rhc2tSZW5hbWVkEjMK" +
    "AmlkGAEgASgLMh0uc3BpbmUuZXhhbXBsZS50b2RvLnYxLlRhc2tJZEIIoIUkAeiFJAESEwoFdGl0" +
    "bGUYAiABKAlCBKCFJAEiRAoNVGFza0NvbXBsZXRlZBIzCgJpZBgBIAEoCzIdLnNwaW5lLmV4YW1w" +
    "bGUudG9kby52MS5UYXNrSWRCCKCFJAHohSQBIkMKDFRhc2tSZW9wZW5lZBIzCgJpZBgBIAEoCzId" +
    "LnNwaW5lLmV4YW1wbGUudG9kby52MS5UYXNrSWRCCKCFJAHohSQBQhuqjSQXdHlwZS5zcGluZS5l" +
    "eGFtcGxlLnRvZG9iBnByb3RvMw",
  [fileTaskIdFixture, file_spine_options],
);
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

class ManagedTaskAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static assigneeCalls = 0;

  static reset(): void {
    this.assigneeCalls = 0;
  }

  assignTask(command: AggregateState): AggregateState {
    ManagedTaskAggregate.assigneeCalls++;
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: command.id,
        name: `${command.name} (assigned)`,
        archived: false,
      }),
    );
    return create(AggregateStateSchema, {
      id: command.id,
      name: `${command.name} event`,
      archived: false,
    });
  }
}

class GeneratedTwoArgAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  static argumentCounts: number[] = [];
  static contexts: CommandContext[] = [];
  static assigneeStarted = 0;
  static #releaseAssignee: (() => void) | undefined;
  static #assigneeCanFinish: Promise<void> | undefined;

  static reset(options: { readonly pauseAssignee?: boolean } = {}): void {
    this.argumentCounts = [];
    this.contexts = [];
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
    GeneratedTwoArgAggregate.assigneeStarted++;
    await GeneratedTwoArgAggregate.#assigneeCanFinish;
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: command.id,
        name: `${command.name} (generated)`,
        archived: false,
      }),
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

  static reset(): void {
    this.argumentCounts = [];
    this.contexts = [];
  }

  reactProjection(event: ProjectionState, context: EventContext): AggregateState {
    GeneratedReactorAggregate.argumentCounts.push(arguments.length);
    GeneratedReactorAggregate.contexts.push(context);
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: event.id,
        name: `${event.name} (reacted)`,
        archived: false,
      }),
    );
    return create(AggregateStateSchema, {
      id: event.id,
      name: `${event.name} reacted event`,
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

  async commandProjection(event: ProjectionState, context: EventContext): Promise<AggregateState> {
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
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: command.id,
        name: `${command.name} two (assigned)`,
        archived: false,
      }),
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
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: command.id,
        name: command.name,
        archived: false,
      }),
    );
    return undefined;
  }
}

class EnvelopeManagedAggregate extends Aggregate<string, typeof AggregateStateSchema, bigint> {
  assignTask(command: AggregateState): SpineEvent {
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: command.id,
        name: command.name,
        archived: false,
      }),
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
    this.updateDraftState(() =>
      create(ValidatedAggregateStateSchema, {
        id: event.id,
        name: event.name,
      }),
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

  assignTask(command: ValidatedTaskCommand): ProjectionState {
    ValidatingProcessManager.commandCalls++;
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

class RestartingTransitionAggregate extends TransitionViolatingAggregate {
  override assignTask(command: AggregateState) {
    return createAggregateEvent("event-transition-restart", command.id, 0, command.name);
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
      this.startTransaction();
    }
  }
}

class MutatingRejectedAggregate extends TransitionViolatingAggregate {
  override assignTask(command: AggregateState) {
    return createAggregateEvent("event-transition-mutated", command.id, 0, command.name);
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
      result.validation.error.constraintViolation.length = 0;
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
  assignTask(command: AggregateState): AggregateState {
    this.updateDraftState(() =>
      create(AggregateStateSchema, {
        id: command.id,
        name: `${command.name} (reaction metadata)`,
        archived: false,
      }),
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
    this.updateDraftState(() =>
      create(ProjectionStateSchema, {
        id: event.id,
        name: `${event.name} (projected)`,
        priority: event.priority + 1,
      }),
    );
  }
}

class ManagedTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeTask(event: ProjectionState): void {
    ManagedTaskProjection.subscriberCalls++;
    this.updateDraftState(() =>
      create(ProjectionStateSchema, {
        id: event.id,
        name: `${event.name} (managed)`,
        priority: event.priority + 1,
      }),
    );
  }
}

class AlternateCatchUpProjection extends Projection<string, typeof TaskListSchema, number> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeAggregate(event: AggregateState): void {
    AlternateCatchUpProjection.subscriberCalls++;
    this.updateDraftState(() =>
      create(TaskListSchema, {
        id: event.id,
        openTaskCount: event.archived ? 0 : 1,
      }),
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

  async subscribeTask(event: ProjectionState): Promise<void> {
    if (BlockingCatchUpProjection.block) {
      const index = BlockingCatchUpProjection.startedCalls;
      const gate = BlockingCatchUpProjection.gates[index];

      BlockingCatchUpProjection.startedCalls++;

      if (gate !== undefined) {
        await gate.promise;
      }
    }

    BlockingCatchUpProjection.completedCalls++;
    this.updateDraftState(() =>
      create(ProjectionStateSchema, {
        id: event.id,
        name: `${event.name} (blocking)`,
        priority: event.priority + 1,
      }),
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

  subscribeTask(event: ProjectionState, context: EventContext): void {
    GeneratedTwoArgProjection.argumentCounts.push(arguments.length);
    GeneratedTwoArgProjection.contexts.push(context);
    this.updateDraftState(() =>
      create(ProjectionStateSchema, {
        id: event.id,
        name: `${event.name} (generated)`,
        priority: event.priority + 1,
      }),
    );
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

  mutateContext(event: ProjectionState, context: EventContext): void {
    void event;
    ContextMutatingGeneratedProjection.firstContext = context;
    context.version = create(VersionSchema, { number: 99 });
  }

  observeContext(event: ProjectionState, context: EventContext): void {
    ContextMutatingGeneratedProjection.observerSawSameContext =
      context === ContextMutatingGeneratedProjection.firstContext;
    ContextMutatingGeneratedProjection.observedVersions.push(context.version?.number);
    this.updateDraftState(() =>
      create(ProjectionStateSchema, {
        id: event.id,
        name: `${event.name} (observed)`,
        priority: event.priority + 1,
      }),
    );
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
    this.updateDraftState((draft) => {
      draft.name = event.name;
      draft.priority += event.priority;
      return draft;
    });
  }
}

class ReactingTaskProjection extends Projection<string, typeof ProjectionStateSchema, number> {
  reactTask(event: ProjectionState): void {
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
  static failure: unknown = new Error("projection subscriber failed");

  static reset(failure: unknown = new Error("projection subscriber failed")): void {
    this.failure = failure;
  }

  subscribeTask(event: ProjectionState): void {
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

  static reset(): void {
    this.commandCalls = 0;
    this.eventCalls = 0;
    this.commandReactionCalls = 0;
  }

  assignTask(command: AggregateState): ProjectionState {
    RoutingProcessManager.commandCalls++;
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

  reactTask(event: ProjectionState): void {
    RoutingProcessManager.eventCalls++;
    this.updateDraftState(() =>
      create(ProcessManagerStateSchema, {
        id: event.id,
        queue: `${event.name} reacted`,
      }),
    );
  }

  commandTask(event: ProjectionState): AggregateState {
    RoutingProcessManager.commandReactionCalls++;
    this.updateDraftState(() =>
      create(ProcessManagerStateSchema, {
        id: event.id,
        queue: `${event.name} commanded`,
      }),
    );
    return create(AggregateStateSchema, {
      id: event.id,
      name: `${event.name} follow-up command`,
      archived: false,
    });
  }

  reactTaskWithEvent(event: ProjectionState): AggregateState {
    RoutingProcessManager.eventCalls++;
    this.updateDraftState(() =>
      create(ProcessManagerStateSchema, {
        id: event.id,
        queue: `${event.name} evented`,
      }),
    );
    return create(AggregateStateSchema, {
      id: event.id,
      name: `${event.name} produced event`,
      archived: false,
    });
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

  it("packs aggregate-returned domain events and owns the aggregate transaction", async () => {
    ManagedTaskAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createManagedRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
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
    await expect(storage.readHistory("task-managed")).resolves.toMatchObject({
      snapshot: {
        aggregateId: "task-managed",
        version: 1n,
        state: {
          id: "task-managed",
          name: "Managed (assigned)",
          archived: false,
        },
      },
      events: [],
    });
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
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

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
          id: packAny(EventIdSchema, create(EventIdSchema, { value: "event-reactor-source" })),
          typeUrl: deriveTypeUrl(ProjectionStateSchema),
        }),
        actorContext: create(ActorContextSchema, {
          tenantId: createTenantId("tenant-b"),
        }),
        grandOrigin: create(OriginSchema, {
          message: create(MessageIdSchema, {
            id: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: "past-command" })),
            typeUrl: deriveTypeUrl(AggregateStateSchema),
          }),
          actorContext: create(ActorContextSchema, {
            tenantId: createTenantId("tenant-b"),
          }),
        }),
      }),
    });
    await expect(storage.readHistory("task-reactor")).resolves.toMatchObject({
      snapshot: {
        aggregateId: "task-reactor",
        version: 1n,
        state: {
          id: "task-reactor",
          name: "Task (reacted)",
          archived: false,
        },
      },
      events: [],
    });
    await waitForCondition(() => observed.length === 1);
    expect(observed).toEqual(["event-reactor-source-1"]);
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
    expect(unpackAny(command.message, AggregateStateSchema)).toEqual(
      create(AggregateStateSchema, {
        id: "task-command",
        name: "Task command",
        archived: false,
      }),
    );
  });

  it("wraps commands from generated command reactions with the source event origin", async () => {
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
    const sourceEvent = createProjectionEvent("event-command-origin", "task-command-origin", {
      pastMessageTenantId: "tenant-command",
    });
    const sourceActorContext = create(ActorContextSchema, {
      tenantId: createTenantId("tenant-command"),
    });
    const sourceGrandOrigin = create(OriginSchema, {
      message: create(MessageIdSchema, {
        id: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: "past-command" })),
        typeUrl: deriveTypeUrl(AggregateStateSchema),
      }),
      actorContext: sourceActorContext,
    });

    await context.eventBus().post(sourceEvent);

    expect(commands[0]?.context?.actorContext).toEqual(sourceActorContext);
    expect(commands[0]?.context?.origin).toEqual(
      create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: packAny(EventIdSchema, create(EventIdSchema, { value: "event-command-origin" })),
          typeUrl: deriveTypeUrl(ProjectionStateSchema),
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

  it("rejects managed aggregate event reactors with unsnapshotted history", async () => {
    const factory = new InMemoryStorageFactory();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });
    await storage.appendEvents("task-reactor-history", [
      createAggregateEvent("event-existing-unsnapshotted", "task-reactor-history", 1),
    ]);
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedReactorRepository())
      .withStorageFactory(factory)
      .build();

    await expect(
      context
        .eventBus()
        .post(createProjectionEvent("event-reactor-history", "task-reactor-history")),
    ).rejects.toThrow("Managed aggregate history has unsnapshotted events.");
  });

  it("uses one dispatch version for multiple managed aggregate events", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createMultiManagedRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await context
      .commandBus()
      .post(createAggregateCommand("command-managed-multi", "task-managed-multi", "Multi"));

    await expect(eventStore.read()).resolves.toMatchObject([
      { id: { value: "command-managed-multi-1" }, context: { version: { number: 1 } } },
      { id: { value: "command-managed-multi-2" }, context: { version: { number: 1 } } },
    ]);
    await expect(storage.readHistory("task-managed-multi")).resolves.toMatchObject({
      snapshot: {
        aggregateId: "task-managed-multi",
        version: 1n,
        state: {
          id: "task-managed-multi",
          name: "Multi two (assigned)",
          archived: false,
        },
      },
      events: [],
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
    ).rejects.toThrow("must return at least one event");
    await expect(eventStore.read()).resolves.toEqual([]);
  });

  it("rejects framework event envelopes returned from managed aggregate handlers", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createEnvelopeManagedRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createAggregateCommand("command-envelope", "task-envelope")),
    ).rejects.toThrow(/cannot pack event message "spine\.core\.Event"/);
    await expect(eventStore.read()).resolves.toEqual([]);
  });

  it("does not append or dispatch managed aggregate events when snapshot writing fails", async () => {
    const factory = new SnapshotFailingStorageFactory();
    const observed: string[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createManagedRepository())
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
        .post(createAggregateCommand("command-managed-fails", "task-managed-fails")),
    ).rejects.toThrow("Cannot write aggregate snapshot.");

    await expect(eventStore.read()).resolves.toEqual([]);
    expect(observed).toEqual([]);
  });

  it("does not write managed aggregate snapshots when event append validation fails", async () => {
    const factory = new InMemoryStorageFactory();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    await eventStore.append(createAggregateEvent("command-duplicate-1", "other-task", 1, "Other"));
    const context = BoundedContext.singleTenant("Tasks")
      .add(createManagedRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await expect(
      context.commandBus().post(createAggregateCommand("command-duplicate", "task-duplicate")),
    ).rejects.toThrow("Aggregate event IDs must be unique before append.");

    await expect(storage.readHistory("task-duplicate")).resolves.toMatchObject({
      snapshot: undefined,
      events: [],
    });
    await expect(eventStore.read()).resolves.toMatchObject([
      { id: { value: "command-duplicate-1" } },
    ]);
  });

  it("does not write managed aggregate snapshots when event append storage fails", async () => {
    const factory = new EventFailingFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createManagedRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });

    await expect(
      context.commandBus().post(createAggregateCommand("command-append-fails", "task-append")),
    ).rejects.toThrow("Cannot append aggregate event.");

    await expect(storage.readHistory("task-append")).resolves.toMatchObject({
      snapshot: undefined,
      events: [],
    });
  });

  it("reports snapshot and rollback failures for multi-event managed aggregates", async () => {
    const factory = new DeleteFailingFactory("command-rollback-2");
    const context = BoundedContext.singleTenant("Tasks")
      .add(createMultiManagedRepository())
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
      context.commandBus().post(createAggregateCommand("command-rollback", "task-rollback")),
    ).rejects.toMatchObject({
      message: "Managed aggregate persistence failed and event rollback failed.",
      errors: [
        expect.objectContaining({ message: "Cannot write aggregate snapshot." }),
        expect.objectContaining({ message: "Cannot delete aggregate event." }),
      ],
    });

    await expect(storage.readHistory("task-rollback")).resolves.toMatchObject({
      snapshot: undefined,
      events: [{ id: { value: "command-rollback-2" }, context: { version: { number: 1 } } }],
    });
    await expect(eventStore.read()).resolves.toMatchObject([
      { id: { value: "command-rollback-2" } },
    ]);
    await expect(
      context.commandBus().post(createAggregateCommand("command-after-rollback", "task-rollback")),
    ).rejects.toThrow("Managed aggregate history has unsnapshotted events.");
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

  it("rejects restarted transition failures before storage", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createRestartingTransitionRepository())
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
        .post(createAggregateCommand("command-transition-restart", "task-transition-restart")),
    ).rejects.toMatchObject({
      type: "COMMAND_STATE_TRANSITION_VALIDATION_FAILED",
      clientMessage: "Command state transition validation failed.",
    });

    await expect(eventStore.read()).resolves.toEqual([]);
    await expect(storage.readHistory("task-transition-restart")).resolves.toMatchObject({
      snapshot: undefined,
      events: [],
    });
  });

  it("protects transition validation details from handler mutation", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createMutatingRejectedRepository())
      .build();

    let rejection: unknown;
    try {
      await context
        .commandBus()
        .post(createAggregateCommand("command-transition-mutated", "task-transition-mutated"));
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toMatchObject({
      type: "COMMAND_STATE_TRANSITION_VALIDATION_FAILED",
      clientMessage: "Command state transition validation failed.",
    });
    expect(readTransitionViolations(rejection)).toBeGreaterThan(0);
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

  it("reports restarted replay failures as aggregate replay failure", async () => {
    const factory = new InMemoryStorageFactory();
    const storage = new AggregateStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: AggregateStateSchema,
      eventSchemas: [AggregateStateSchema],
    });
    const context = BoundedContext.singleTenant("Tasks")
      .add(createRestartingTransitionRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await storage.appendEvents("task-replay-restart", [
      createAggregateEvent("event-replay-restart", "task-replay-restart", 1, "BrokenHistory"),
    ]);

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-after-restart-history", "task-replay-restart")),
    ).rejects.toMatchObject({ name: "ReplayError" });

    await expect(eventStore.read()).resolves.toHaveLength(1);
    await expect(storage.readHistory("task-replay-restart")).resolves.toMatchObject({
      snapshot: undefined,
      events: [{ id: { value: "event-replay-restart" } }],
    });
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

  it("rejects blank first-field command IDs before handler invocation", () => {
    const repository = createRoutingRepository();

    expect(() => repository.routeCommand(createAggregateCommand("command-blank", ""))).toThrow(
      "Repository command routing requires a non-empty first field.",
    );
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

  it("routes message-valued event IDs by their primitive value field", () => {
    const repository = createUserIdProjectionRepository();
    const route = repository.routeEvent(
      packEvent({
        id: create(EventIdSchema, { value: "event-user-id" }),
        context: create(EventContextSchema, {
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
      packEvent({
        id: create(EventIdSchema, { value: "event-message-id-task" }),
        context: create(EventContextSchema, {
          version: create(VersionSchema, { number: 1 }),
        }),
        schema: TaskCreatedSchema,
        message: create(TaskCreatedSchema, {
          id: taskId,
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

  it("rejects message-valued event IDs with the wrong message type", () => {
    const repository = createMessageIdTaskRepository();

    expect(() =>
      repository.routeEvent(
        packEvent({
          id: create(EventIdSchema, { value: "event-wrong-message-id-type" }),
          context: create(EventContextSchema, {
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
        messageSchemas: () => [ProjectionStateSchema],
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
    expect(unpackAny(producedMessage, ProjectionStateSchema)).toEqual(
      create(ProjectionStateSchema, {
        id: "pm-task",
        name: "ProcessManager event",
        priority: 1,
      }),
    );
  });

  it("writes process-manager commands to a durable inbox before local delivery", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const observed: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [ProjectionStateSchema],
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
          targetId: "pm-inbox",
          targetTypeUrl: deriveTypeUrl(ProcessManagerStateSchema),
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
    const storedEnvelope = unpackAny(storedCommand, CommandSchema);
    if (storedEnvelope === undefined) {
      throw new Error("Expected a readable stored process-manager command envelope.");
    }
    expect(storedEnvelope.id).toEqual(command.id);
    expect(storedEnvelope.context).toEqual(command.context);
    expect(storedEnvelope.message?.typeUrl).toBe(command.message?.typeUrl);
    expect(
      storedEnvelope.message === undefined
        ? undefined
        : unpackAny(storedEnvelope.message, AggregateStateSchema),
    ).toEqual(
      command.message === undefined ? undefined : unpackAny(command.message, AggregateStateSchema),
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
      context.stand().read(ProcessManagerStateSchema, "pm-tenant", { tenantId: "tenant-a" }),
    ).resolves.toEqual(
      create(ProcessManagerStateSchema, {
        id: "pm-tenant",
        queue: "Tenant PM assigned",
      }),
    );
    await expect(
      context.stand().read(ProcessManagerStateSchema, "pm-tenant", { tenantId: "tenant-b" }),
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
    expect(factory.operations).toEqual([]);
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
    const session = await delivery.shards.pickUp(shard, "node-a");

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

  it("keeps draining process-manager handoff backlog until the received row is delivered", async () => {
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
      await storeProcessManagerInboxCommand(
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

  it("rejects process-manager inbox replay when the stored command tenant mismatches delivery tenant", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.multitenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: "tenant-a" },
      storageFactory: factory,
    });
    const target = requireProcessManagerInboxTarget(repository);
    const received = await storeProcessManagerInboxCommand(
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

    await expect(target.replay(received, "tenant-a")).rejects.toThrow(/tenant/i);

    expect(RoutingProcessManager.commandCalls).toBe(0);
  });

  it("rejects process-manager inbox replay when stored target metadata does not match the routed command", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireProcessManagerInboxTarget(repository);
    const command = createAggregateCommand("command-pm-route-mismatch", "pm-routed", "Routed");
    const wrongId = await storeProcessManagerInboxCommand(
      delivery,
      command,
      new Date("2026-07-08T09:01:00.000Z"),
      1n,
      {
        targetId: "pm-forged",
      },
    );
    const wrongType = await storeProcessManagerInboxCommand(
      delivery,
      command,
      new Date("2026-07-08T09:02:00.000Z"),
      2n,
      {
        targetTypeUrl: "type.example.dev/forged.ProcessManager",
      },
    );

    await expect(target.replay(wrongId)).rejects.toThrow(/target/i);
    await expect(target.replay(wrongType)).rejects.toThrow(/target/i);

    expect(RoutingProcessManager.commandCalls).toBe(0);
  });

  it("rejects process-manager inbox replay before the repository is bound to a runtime", async () => {
    const repository = createProcessManagerAssignRepository();
    const target = requireProcessManagerInboxTarget(repository);

    await expect(
      target.replay({
        id: {
          value: "message-pm-unbound",
          shard: ShardIndex.single(),
        },
        inboxId: {
          targetId: "pm-unbound",
          targetTypeUrl: deriveTypeUrl(ProcessManagerStateSchema),
        },
        signalId: "command-pm-unbound",
        label: "HANDLE_COMMAND",
        status: "TO_DELIVER",
        shard: ShardIndex.single(),
        whenReceived: new Date("2026-07-08T09:02:30.000Z"),
        version: 1n,
      }),
    ).rejects.toThrow("Process-manager inbox replay requires a bound repository runtime.");
  });

  it("rejects process-manager inbox replay for UPDATE_SUBSCRIBER messages before handler code", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireProcessManagerInboxTarget(repository);
    const received = await storeProcessManagerInboxCommand(
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

  it("rejects process-manager inbox replay without a signal as invalid payload before handler code", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireProcessManagerInboxTarget(repository);
    const received = await storeProcessManagerInboxCommand(
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

  it("rejects multitenant process-manager inbox replay without delivery tenant", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.multitenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: "tenant-a" },
      storageFactory: factory,
    });
    const target = requireProcessManagerInboxTarget(repository);
    const received = await storeProcessManagerInboxCommand(
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

  it("rejects multitenant process-manager inbox replay when stored command tenant metadata is missing", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProcessManagerAssignRepository();
    BoundedContext.multitenant("Tasks").add(repository).withStorageFactory(factory).build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: true, tenantId: "tenant-a" },
      storageFactory: factory,
    });
    const target = requireProcessManagerInboxTarget(repository);
    const received = await storeProcessManagerInboxCommand(
      delivery,
      createAggregateCommand(
        "command-pm-missing-stored-tenant",
        "pm-missing-stored-tenant",
        "Missing tenant metadata",
      ),
      new Date("2026-07-08T09:04:30.000Z"),
      1n,
    );

    await expect(target.replay(received, "tenant-a")).rejects.toThrow(
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
    const target = requireProcessManagerInboxTarget(repository);
    const received = await storeProcessManagerInboxCommand(
      delivery,
      createValidatedCommand("command-pm-invalid-replay", "pm-invalid-replay", ""),
      new Date("2026-07-08T09:03:00.000Z"),
      1n,
      {
        targetTypeUrl: deriveTypeUrl(ProcessManagerStateSchema),
      },
    );

    await expect(target.replay(received)).rejects.toThrow(/validation/i);

    expect(ValidatingProcessManager.commandCalls).toBe(0);
  });

  it("rejects idless process-manager inbox replay before handler or Stand write", async () => {
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
    const target = requireProcessManagerInboxTarget(repository);
    const received = await storeProcessManagerInboxCommand(
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

  it("rejects blank process-manager inbox replay command ids before handler or Stand write", async () => {
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
    const target = requireProcessManagerInboxTarget(repository);
    const received = await storeProcessManagerInboxCommand(
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
        messageSchemas: () => [ProjectionStateSchema],
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
          id: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: "command-pm-dispatch" })),
          typeUrl: deriveTypeUrl(AggregateStateSchema),
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

  it("posts commands produced by process-manager event commanding after state commit", async () => {
    RoutingProcessManager.reset();
    const commands: SpineCommand[] = [];
    const context = BoundedContext.singleTenant("Tasks")
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
        id: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: "past-command" })),
        typeUrl: deriveTypeUrl(AggregateStateSchema),
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
          id: packAny(EventIdSchema, create(EventIdSchema, { value: "event-pm-command" })),
          typeUrl: deriveTypeUrl(ProjectionStateSchema),
        }),
        actorContext: sourceActorContext,
        grandOrigin: sourceGrandOrigin,
      }),
    );
    const producedMessage = commands[0]?.message;
    if (producedMessage === undefined) {
      throw new Error("Expected a process-manager produced command message.");
    }
    expect(unpackAny(producedMessage, AggregateStateSchema)).toEqual(
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

    await expect(eventDispatcher.dispatch(idlessEvent)).rejects.toThrow(/event ID/i);

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
    expect(unpackAny(producedMessage, AggregateStateSchema)).toEqual(
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
    ).rejects.toThrow("mixed process-manager command dispatch failed");

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
      clearedStateTypes: [deriveTypeUrl(ProjectionStateSchema)],
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
      { tenantId: "tenant-a" },
    );
    ExecutingTaskProjection.reset();

    await expect(context.catchUpReadSide({ tenantId: "tenant-a" })).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [deriveTypeUrl(ProjectionStateSchema)],
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-catch-up-tenant", {
        tenantId: "tenant-a",
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
        tenantId: "tenant-b",
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

    await expect(singleTenant.catchUpReadSide({ tenantId: "tenant-a" })).rejects.toThrow(
      'Single-tenant read-side catch-up for "Tasks" does not accept tenantId.',
    );
    await expect(multitenant.catchUpReadSide()).rejects.toThrow(
      'Multitenant read-side catch-up for "Tasks" requires tenantId.',
    );
    await expect(multitenant.catchUpReadSide({ tenantId: " \t " })).rejects.toThrow(
      'Multitenant read-side catch-up for "Tasks" requires tenantId.',
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
    await context
      .eventBus()
      .post(createAggregateEvent("event-alternate", "task-alternate", 0, "Alt"));
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
        id: "task-alternate",
        openTaskCount: 99,
      }),
    );
    ExecutingTaskProjection.reset();
    AlternateCatchUpProjection.reset();

    await expect(context.catchUpReadSide()).resolves.toEqual({
      replayedEventCount: 2,
      clearedEntityCount: 2,
      clearedStateTypes: [deriveTypeUrl(ProjectionStateSchema), deriveTypeUrl(TaskListSchema)],
    });
    await expect(context.stand().read(ProjectionStateSchema, "task-primary")).resolves.toEqual(
      create(ProjectionStateSchema, {
        id: "task-primary",
        name: "Task (projected)",
        priority: 2,
      }),
    );
    await expect(context.stand().read(TaskListSchema, "task-alternate")).resolves.toEqual(
      create(TaskListSchema, {
        id: "task-alternate",
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
      packEvent({
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
      clearedStateTypes: [deriveTypeUrl(ProjectionStateSchema)],
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
      { tenantId: rawTenantId },
    );
    ExecutingTaskProjection.reset();

    await expect(context.catchUpReadSide({ tenantId: rawTenantId })).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [deriveTypeUrl(ProjectionStateSchema)],
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-space-tenant", {
        tenantId: rawTenantId,
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
        tenantId: trimmedTenantId,
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
      { name: "Tasks", multitenant: true, tenantId: "domain:example.com" },
      storageFactory,
    );

    await eventStore.append(
      createProjectionEvent("event-domain-tenant", "task-domain-tenant", {
        importTenantId: "example.com",
        importTenantKind: "domain",
      }),
    );

    await expect(context.catchUpReadSide({ tenantId: "domain:example.com" })).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 0,
      clearedStateTypes: [deriveTypeUrl(ProjectionStateSchema)],
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-domain-tenant", {
        tenantId: "domain:example.com",
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
      { name: "Tasks", multitenant: true, tenantId: "email:owner@example.com" },
      storageFactory,
    );

    await eventStore.append(
      createProjectionEvent("event-email-tenant", "task-email-tenant", {
        pastMessageTenantId: "owner@example.com",
        pastMessageTenantKind: "email",
      }),
    );

    await expect(context.catchUpReadSide({ tenantId: "email:owner@example.com" })).resolves.toEqual(
      {
        replayedEventCount: 1,
        clearedEntityCount: 0,
        clearedStateTypes: [deriveTypeUrl(ProjectionStateSchema)],
      },
    );
    await expect(
      context.stand().read(ProjectionStateSchema, "task-email-tenant", {
        tenantId: "email:owner@example.com",
      }),
    ).resolves.toEqual(
      create(ProjectionStateSchema, {
        id: "task-email-tenant",
        name: "Task (projected)",
        priority: 2,
      }),
    );
  });

  it("rejects multitenant catch-up events whose envelope tenant mismatches storage", async () => {
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
      { name: "Tasks", multitenant: true, tenantId: "tenant-a" },
      storageFactory,
    );

    await eventStore.appendAll([
      createProjectionEvent("event-corrupt-tenant", "task-corrupt-tenant", {
        pastMessageTenantId: "tenant-b",
      }),
    ]);
    await context.stand().update(ProjectionStateSchema, tenantBState, { tenantId: "tenant-b" });

    await expect(context.catchUpReadSide({ tenantId: "tenant-a" })).rejects.toMatchObject({
      name: "ReadCatchUpReplayError",
      code: "READ_SIDE_CATCH_UP_REPLAY_FAILED",
      eventId: "event-corrupt-tenant",
      detail: {
        name: "Error",
        message: "Read-side catch-up stored event envelope tenant does not match.",
      },
    });
    await context.catchUpReadSide({ tenantId: "tenant-a" }).catch((error: unknown) => {
      const detail = (error as { readonly detail?: { readonly message?: string } }).detail;

      expect(detail?.message).not.toContain("tenant-a");
      expect(detail?.message).not.toContain("tenant-b");
    });
    await expect(
      context.stand().read(ProjectionStateSchema, "task-corrupt-tenant", {
        tenantId: "tenant-b",
      }),
    ).resolves.toEqual(tenantBState);
    expect(ExecutingTaskProjection.subscriberCalls).toBe(0);
  });

  it("rejects multitenant catch-up events without an envelope tenant", async () => {
    ExecutingTaskProjection.reset();
    const storageFactory = new InMemoryStorageFactory();
    const context = BoundedContext.multitenant("Tasks")
      .withStorageFactory(storageFactory)
      .add(createExecutingProjectionRepository())
      .build();
    const eventStore = new EventStore(
      { name: "Tasks", multitenant: true, tenantId: "tenant-a" },
      storageFactory,
    );

    await eventStore.append(createProjectionEvent("event-missing-tenant", "task-missing-tenant"));

    await expect(context.catchUpReadSide({ tenantId: "tenant-a" })).rejects.toMatchObject({
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
        tenantId: "tenant-a",
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
      clearedStateTypes: [deriveTypeUrl(ProjectionStateSchema)],
    });
    await waitForCondition(() => BlockingCatchUpProjection.startedCalls === 2);
    expect(BlockingCatchUpProjection.completedCalls).toBe(1);
    BlockingCatchUpProjection.release(1);

    await expect(second).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [deriveTypeUrl(ProjectionStateSchema)],
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
      clearedStateTypes: [deriveTypeUrl(ProjectionStateSchema)],
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
      clearedStateTypes: [deriveTypeUrl(ProjectionStateSchema)],
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
    ).rejects.toThrow("projection subscriber failed");

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
      ).rejects.toMatchObject({
        message: "Projection inbox replay failed.",
        cause: "projection subscriber failed without Error",
      });

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
    const context = BoundedContext.singleTenant("Tasks")
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

  it("passes empty EventContext to generated two-argument subscribers when the envelope has none", async () => {
    GeneratedTwoArgProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedTwoArgProjectionRepository())
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
        targetId: "task-inbox",
        targetTypeUrl: deriveTypeUrl(ProjectionStateSchema),
      },
      signalId: "event-inbox",
      label: "UPDATE_SUBSCRIBER",
      status: "DELIVERED",
    });
    expect(delivered[0]?.keepUntil).toBeInstanceOf(Date);

    const storedEvent =
      delivered[0]?.signal === undefined ? undefined : unpackAny(delivered[0].signal, EventSchema);

    expect(storedEvent?.id?.value).toBe("event-inbox");
  });

  it("deduplicates duplicate live projection delivery by event and target inbox", async () => {
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

    expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
    await expect(
      context.stand().read(ProjectionStateSchema, "task-duplicate-inbox"),
    ).resolves.toMatchObject({
      name: "Task (projected)",
      priority: 2,
    });
    await expect(
      delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] }),
    ).resolves.toMatchObject([
      {
        signalId: "event-duplicate-inbox",
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
        tenantId: "tenant-a",
      }),
    ).resolves.toBeUndefined();
    await expect(
      context.stand().read(ProjectionStateSchema, "task-blank-id-tenant", {
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

  it("rejects non-finite producer IDs", () => {
    const repository = createRoutingRepository();

    expect(() =>
      repository.routeEvent(
        createProjectionEvent("event-non-finite-producer", "first-field-task", {
          producerNumber: Number.NaN,
        }),
      ),
    ).toThrow(/finite producer ID/);
  });

  it("rejects non-finite first-field event IDs", () => {
    const repository = createNonFiniteRouteRepository();

    expect(() =>
      repository.routeEvent(
        packEvent({
          id: create(EventIdSchema, { value: "event-non-finite-field" }),
          context: create(EventContextSchema, {
            version: create(VersionSchema, { number: 1 }),
          }),
          schema: NumberRouteEventSchema,
          message: create(NumberRouteEventSchema, { id: Number.POSITIVE_INFINITY }),
        }),
      ),
    ).toThrow(/finite primitive or single-field message ID/);
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

function createManagedProjection(): Repository<typeof ManagedTaskProjection> {
  const handlers = defineEntityHandlers(ManagedTaskProjection, ProjectionStateSchema, (builder) => [
    builder.subscribe(ProjectionStateSchema, "subscribeTask"),
  ]);

  return new Repository({
    entityType: ManagedTaskProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createAlternateCatchUpProjectionRepository(): Repository<
  typeof AlternateCatchUpProjection
> {
  const handlers = defineEntityHandlers(AlternateCatchUpProjection, TaskListSchema, (builder) => [
    builder.subscribe(AggregateStateSchema, "subscribeAggregate"),
  ]);

  return new Repository({
    entityType: AlternateCatchUpProjection,
    schema: TaskListSchema,
    handlers,
  });
}

function createBlockingCatchUpProjectionRepository(): Repository<typeof BlockingCatchUpProjection> {
  const handlers = defineEntityHandlers(
    BlockingCatchUpProjection,
    ProjectionStateSchema,
    (builder) => [builder.subscribe(ProjectionStateSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: BlockingCatchUpProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createGeneratedTwoArgProjectionRepository(): Repository<typeof GeneratedTwoArgProjection> {
  const handlers = new HandlerRegistryIngestor().ingest({
    version: 1,
    entities: [
      {
        entityType: GeneratedTwoArgProjection,
        stateSchema: ProjectionStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "subscribeTask",
            signalSchema: ProjectionStateSchema,
            emittedSchemas: [],
            parameterCount: 2,
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<GeneratedTwoArgProjection, typeof ProjectionStateSchema>;

  return new Repository({
    entityType: GeneratedTwoArgProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createContextMutatingGeneratedProjectionRepository(): Repository<
  typeof ContextMutatingGeneratedProjection
> {
  const handlers = new HandlerRegistryIngestor().ingest({
    version: 1,
    entities: [
      {
        entityType: ContextMutatingGeneratedProjection,
        stateSchema: ProjectionStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "mutateContext",
            signalSchema: ProjectionStateSchema,
            emittedSchemas: [],
            parameterCount: 2,
          },
          {
            kind: "event-subscription",
            methodName: "observeContext",
            signalSchema: ProjectionStateSchema,
            emittedSchemas: [],
            parameterCount: 2,
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
  const handlers = defineEntityHandlers(UserIdProjection, ProjectionStateSchema, (builder) => [
    builder.subscribe(UserIdSchema, "subscribeUser"),
  ]);

  return new Repository({
    entityType: UserIdProjection,
    schema: ProjectionStateSchema,
    handlers,
  });
}

function createNonFiniteRouteRepository(): Repository<typeof NonFiniteRouteProjection> {
  const handlers = defineEntityHandlers(
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
  const handlers = defineEntityHandlers(MessageIdTaskAggregate, TaskSchema, (builder) => [
    builder.apply(TaskCreatedSchema, "applyTaskCreated"),
    builder.apply(WrongIdRouteEventSchema, "applyWrongId"),
  ]);

  return new Repository({
    entityType: MessageIdTaskAggregate,
    schema: TaskSchema,
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

function createManagedRepository(): Repository<typeof ManagedTaskAggregate> {
  const handlers = defineEntityHandlers(ManagedTaskAggregate, AggregateStateSchema, (builder) => [
    builder.assign(AggregateStateSchema, "assignTask"),
  ]);

  return new Repository({
    entityType: ManagedTaskAggregate,
    schema: AggregateStateSchema,
    handlers,
    events: [AggregateStateSchema],
  });
}

function createGeneratedTwoArgAggregateRepository(): Repository<typeof GeneratedTwoArgAggregate> {
  const handlers = new HandlerRegistryIngestor().ingest({
    version: 1,
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
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<GeneratedTwoArgAggregate, typeof AggregateStateSchema>;

  return new Repository({
    entityType: GeneratedTwoArgAggregate,
    schema: AggregateStateSchema,
    handlers,
    events: [AggregateStateSchema],
  });
}

function createGeneratedReactorRepository(): Repository<typeof GeneratedReactorAggregate> {
  const handlers = new HandlerRegistryIngestor().ingest({
    version: 1,
    entities: [
      {
        entityType: GeneratedReactorAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [
          {
            kind: "event-reaction",
            methodName: "reactProjection",
            signalSchema: ProjectionStateSchema,
            emittedSchemas: [AggregateStateSchema],
            parameterCount: 2,
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<GeneratedReactorAggregate, typeof AggregateStateSchema>;

  return new Repository({
    entityType: GeneratedReactorAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createGeneratedCommandingRepository(): Repository<typeof GeneratedCommandingAggregate> {
  const handlers = new HandlerRegistryIngestor().ingest({
    version: 1,
    entities: [
      {
        entityType: GeneratedCommandingAggregate,
        stateSchema: AggregateStateSchema,
        handlers: [
          {
            kind: "command-reaction",
            methodName: "commandProjection",
            signalSchema: ProjectionStateSchema,
            emittedSchemas: [AggregateStateSchema],
            parameterCount: 2,
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
  const handlers = defineEntityHandlers(MultiManagedAggregate, AggregateStateSchema, (builder) => [
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
  const handlers = defineEntityHandlers(EmptyManagedAggregate, AggregateStateSchema, (builder) => [
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
  const handlers = defineEntityHandlers(
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

function createValidatingProcessManagerRepository(): Repository<typeof ValidatingProcessManager> {
  const handlers = handlerMetadataAccess.defineArity(
    ValidatingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.assign(ValidatedTaskCommandSchema, "assignTask")],
    [
      {
        kind: "command-assignment",
        methodName: "assignTask",
        parameterCount: 1,
        emittedSchemas: [ProjectionStateSchema],
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

function createRestartingTransitionRepository(): Repository<typeof RestartingTransitionAggregate> {
  const handlers = defineEntityHandlers(
    RestartingTransitionAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(AggregateStateSchema, "applyTask"),
    ],
  );

  return new Repository({
    entityType: RestartingTransitionAggregate,
    schema: AggregateStateSchema,
    handlers,
  });
}

function createMutatingRejectedRepository(): Repository<typeof MutatingRejectedAggregate> {
  const handlers = defineEntityHandlers(
    MutatingRejectedAggregate,
    AggregateStateSchema,
    (builder) => [
      builder.assign(AggregateStateSchema, "assignTask"),
      builder.apply(AggregateStateSchema, "applyTask"),
    ],
  );

  return new Repository({
    entityType: MutatingRejectedAggregate,
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

function createProcessManagerAssignRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = handlerMetadataAccess.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.assign(AggregateStateSchema, "assignTask")],
    [
      {
        kind: "command-assignment",
        methodName: "assignTask",
        parameterCount: 1,
        emittedSchemas: [ProjectionStateSchema],
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createProcessManagerReactRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = defineEntityHandlers(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.react(ProjectionStateSchema, "reactTask")],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProcessManagerStateSchema,
    handlers,
  });
}

function createProcessManagerEventRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = handlerMetadataAccess.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [
      builder.react(ProjectionStateSchema, "reactTask"),
      builder.command(ProjectionStateSchema, "commandTask"),
    ],
    [
      {
        kind: "event-reaction",
        methodName: "reactTask",
        parameterCount: 1,
      },
      {
        kind: "command-reaction",
        methodName: "commandTask",
        parameterCount: 1,
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
  const handlers = handlerMetadataAccess.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.react(ProjectionStateSchema, "reactTaskWithEvent")],
    [
      {
        kind: "event-reaction",
        methodName: "reactTaskWithEvent",
        parameterCount: 1,
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
  const handlers = handlerMetadataAccess.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [builder.command(ProjectionStateSchema, "commandTask")],
    [
      {
        kind: "command-reaction",
        methodName: "commandTask",
        parameterCount: 1,
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

function createProcessManagerMixedEventRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = handlerMetadataAccess.defineArity(
    RoutingProcessManager,
    ProcessManagerStateSchema,
    (builder) => [
      builder.react(ProjectionStateSchema, "reactTaskWithEvent"),
      builder.command(ProjectionStateSchema, "commandTask"),
    ],
    [
      {
        kind: "event-reaction",
        methodName: "reactTaskWithEvent",
        parameterCount: 1,
        emittedSchemas: [AggregateStateSchema],
      },
      {
        kind: "command-reaction",
        methodName: "commandTask",
        parameterCount: 1,
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
    events: [AggregateStateSchema],
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

function createContextlessAggregateCommand(id: string, aggregateId: string, name = "Task") {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: id }),
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

function requireProcessManagerInboxTarget(repository: RepositoryView): {
  replay(message: InboxMessage, tenantId?: string): Promise<void>;
} {
  const target = repositoryAccess.processManagerInboxTarget(repository);
  if (target === undefined) {
    throw new Error("Expected a process-manager inbox target.");
  }

  return target;
}

async function storeProcessManagerInboxCommand(
  delivery: Delivery,
  command: SpineCommand,
  whenReceived: Date,
  version: bigint,
  overrides: {
    readonly signalId?: string;
    readonly targetId?: string;
    readonly targetTypeUrl?: string;
  } = {},
) {
  const message = await delivery.inbox.receive({
    inboxId: {
      targetId: overrides.targetId ?? readAggregateId(command),
      targetTypeUrl: overrides.targetTypeUrl ?? deriveTypeUrl(ProcessManagerStateSchema),
    },
    signalId: overrides.signalId ?? command.id?.uuid ?? "missing-command-id",
    signal: packAny(CommandSchema, command, { validate: false }),
    label: "HANDLE_COMMAND",
    status: "TO_DELIVER",
    shard: ShardIndex.single(),
    whenReceived,
    version,
  });

  return message.message;
}

function readAggregateId(command: SpineCommand): string {
  const message =
    command.message === undefined ? undefined : unpackAny(command.message, AggregateStateSchema);

  if (message === undefined) {
    const validated =
      command.message === undefined
        ? undefined
        : unpackAny(command.message, ValidatedTaskCommandSchema);
    if (validated === undefined) {
      throw new Error("Expected a readable process-manager command payload.");
    }
    return validated.id;
  }

  return message.id;
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
    readonly producerNumber?: number;
    readonly producerMessage?: AggregateState;
    readonly importTenantId?: string;
    readonly importTenantKind?: TenantKind;
    readonly pastMessageTenantId?: string;
    readonly pastMessageTenantKind?: TenantKind;
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

function createContextlessProjectionEvent(id: string, entityId: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: packAny(
      ProjectionStateSchema,
      create(ProjectionStateSchema, {
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
          id: packAny(CommandIdSchema, create(CommandIdSchema, { uuid: "past-command" })),
          typeUrl: deriveTypeUrl(AggregateStateSchema),
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
    return packAny(AggregateStateSchema, options.producerMessage);
  }
  if (options.producerNumber !== undefined) {
    return packAny(DoubleValueSchema, create(DoubleValueSchema, { value: options.producerNumber }));
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

function readTransitionViolations(error: unknown): number {
  return (
    (error as { readonly validationError?: { readonly constraintViolation?: readonly unknown[] } })
      .validationError?.constraintViolation?.length ?? 0
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

class EventFailingFactory extends InMemoryStorageFactory {
  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new EventFailingStorage(
      context,
      recordSpec,
      super.onCreateRecordStorage(context, recordSpec),
    );
  }
}

class DeleteFailingFactory extends InMemoryStorageFactory {
  constructor(private readonly eventId: string) {
    super();
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    return new DeleteFailingStorage(
      context,
      recordSpec,
      super.onCreateRecordStorage(context, recordSpec),
      this.eventId,
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

class EventFailingStorage<I, R extends Message> extends RecordStorage<I, R> {
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
    if (records.some((record) => record.record.$typeName === EventSchema.typeName)) {
      return Promise.reject(new Error("Cannot append aggregate event."));
    }
    return this.delegate.writeAll(records.map((record) => record.record));
  }

  protected writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    if (record.record.$typeName === EventSchema.typeName) {
      return Promise.reject(new Error("Cannot append aggregate event."));
    }
    return this.delegate.write(record.record);
  }
}

class DeleteFailingStorage<I, R extends Message> extends RecordStorage<I, R> {
  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    private readonly delegate: RecordStorage<I, R>,
    private readonly eventId: string,
  ) {
    super(context, recordSpec);
  }

  protected async deleteRecord(id: I): Promise<boolean> {
    if (this.isTargetEvent(id)) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      throw new Error("Cannot delete aggregate event.");
    }
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

  private isTargetEvent(id: I): boolean {
    return (
      typeof id === "object" &&
      id !== null &&
      !Array.isArray(id) &&
      Reflect.get(id, "value") === this.eventId
    );
  }
}
