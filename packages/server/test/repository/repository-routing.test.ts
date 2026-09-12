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

import { clone, create, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import {
  type Any,
  AnySchema,
  BoolValueSchema,
  DoubleValueSchema,
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
} from "@spine-event-engine/proto";
import { WorkerIdSchema } from "@spine-event-engine/proto/delivery";
import { TaskListSchema } from "../../../../examples/todo/generated/spine/examples/todo/task_list_pb.js";
import {
  type CreateTask,
  CreateTaskSchema,
} from "../../../../examples/todo/generated/spine/examples/todo/task_commands_pb.js";
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
import {
  type AddProjectMilestone,
  AddProjectMilestoneSchema,
  type AssignProjectAttributes,
  AssignProjectAttributesSchema,
  type CreateNumberedProject,
  CreateNumberedProjectSchema,
  type CreateProject,
  CreateProjectSchema,
  type DraftProject,
  DraftProjectSchema,
  type InviteProjectMembers,
  InviteProjectMembersSchema,
  type RegisterProject,
  RegisterProjectSchema,
  type ScheduleProjectWorkflow,
  ScheduleProjectWorkflowSchema,
} from "../../test-fixtures/generated/repository-routing/project_commands_pb.js";
import {
  type NumberedProjectCreated,
  NumberedProjectCreatedSchema,
  type ProjectCreated,
  ProjectCreatedSchema,
  type ProjectMilestoneAdded,
  ProjectMilestoneAddedSchema,
  type ProjectRegistered,
  ProjectRegisteredSchema,
  type ProjectWorkflowScheduled,
  ProjectWorkflowScheduledSchema,
  type SequencedProjectOverviewCreated,
  SequencedProjectOverviewCreatedSchema,
} from "../../test-fixtures/generated/repository-routing/project_events_pb.js";
import {
  type ProjectId as RepositoryProjectId,
  ProjectIdSchema,
  type ProjectMilestoneId,
  ProjectMilestoneIdSchema,
  type ProjectSequenceId,
  ProjectSequenceIdSchema,
} from "../../test-fixtures/generated/repository-routing/project_identifiers_pb.js";
import {
  type ProjectMemberChanged,
  ProjectMemberChangedSchema,
  type ProjectPriorityChanged,
  ProjectPriorityChangedSchema,
} from "../../test-fixtures/generated/repository-routing/project_routing_events_pb.js";
import {
  ProjectBacklogStateSchema,
  ProjectMilestoneOverviewStateSchema,
  type ProjectMilestoneSourceState,
  ProjectMilestoneSourceStateSchema,
  ProjectMilestoneStateSchema,
  ProjectMilestoneWorkflowStateSchema,
  type ProjectOverviewState,
  ProjectOverviewStateSchema,
  ProjectQueueStateSchema,
  type ProjectState,
  ProjectStateSchema,
  ProjectWorkflowStateSchema,
  RegisteredProjectStateSchema,
  NumberedProjectStateSchema,
  SequencedProjectOverviewStateSchema,
  SequencedProjectSourceStateSchema,
} from "../../test-fixtures/generated/repository-routing/project_states_pb.js";
import {
  type CreateFollowUpProject,
  CreateFollowUpProjectSchema,
  type CreateProjectSubmission,
  CreateProjectSubmissionSchema,
} from "../../test-fixtures/generated/repository-routing/project_validation_commands_pb.js";
import {
  type ProjectSubmissionCreated,
  ProjectSubmissionCreatedSchema,
} from "../../test-fixtures/generated/repository-routing/project_validation_events_pb.js";
import {
  type ProjectSubmissionId,
  ProjectSubmissionIdSchema,
} from "../../test-fixtures/generated/repository-routing/project_validation_identifiers_pb.js";
import {
  AcceptedProjectSubmissionStateSchema,
  ProjectSubmissionStateSchema,
} from "../../test-fixtures/generated/repository-routing/project_validation_states_pb.js";

const GeneratedTaskIdSchema = TodoIdSchema;

type TaskId =
  import("../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js").TaskId;
type TaskCreated =
  import("../../../../examples/todo/generated/spine/examples/todo/task_events_pb.js").TaskCreated;
type TaskListId =
  import("../../../../examples/todo/generated/spine/examples/todo/task_id_pb.js").TaskListId;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storedSourceAndFreshChild(
  stored: readonly SpineEvent[],
  sourceId: string,
): { readonly source: SpineEvent; readonly child: SpineEvent } {
  expect(stored).toHaveLength(2);
  const source = stored.find((event) => event.id?.value === sourceId);
  const children = stored.filter((event) => UUID_PATTERN.test(event.id?.value ?? ""));

  expect(source).toBeDefined();
  expect(children).toHaveLength(1);
  const child = children[0];
  if (source === undefined || child === undefined) {
    throw new Error("Expected one stored source event and one fresh child event.");
  }
  expect(child.id?.value).not.toBe(sourceId);

  return { source, child };
}
const TaskIdSchema = TodoIdSchema;
const TaskSchema = TodoTaskSchema;
const TaskCreatedSchema = TodoEvents.TaskCreatedSchema;
const ProjectSubmissionIdStateSchema = AcceptedProjectSubmissionStateSchema;

class ProjectAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  createProject(command: CreateProject): void {
    void command;
  }

  reactToProjection(event: ProjectCreated): void {
    void event;
  }
}

class CreateProjectRoutingAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  createProject(command: CreateProject): void {
    void command;
  }
}

class IdlessCommandProcessManager extends ProcessManager<
  string,
  typeof ProjectQueueStateSchema,
  number
> {
  createProject(command: CreateProject): void {
    void command;
  }
}

class IdlessCommandProjectionAggregate extends Aggregate<
  string,
  typeof ProjectStateSchema,
  bigint
> {
  createProject(command: CreateProject): void {
    void command;
  }
}

class DraftProjectAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  static calls = 0;

  static reset(): void {
    this.calls = 0;
  }

  assign(command: DraftProject): void {
    void command;
    DraftProjectAggregate.calls += 1;
  }
}

class BlankStateIdAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  static calls = 0;

  assign(command: CreateProject): void {
    BlankStateIdAggregate.calls += 1;
    this.update((draft) => Object.assign(draft, command, { id: "" }));
  }
}

class BlankStateIdProcessManager extends ProcessManager<
  string,
  typeof ProjectQueueStateSchema,
  number
> {
  static calls = 0;

  assign(command: CreateProject): void {
    BlankStateIdProcessManager.calls += 1;
    this.update((draft) => {
      draft.id = "";
      draft.queue = command.name;
    });
  }
}

class BlankStateIdProjection extends Projection<string, typeof ProjectOverviewStateSchema, number> {
  static calls = 0;

  subscribe(event: ProjectCreated): void {
    BlankStateIdProjection.calls += 1;
    this.update((draft) => {
      draft.id = "";
      draft.name = event.name;
    });
  }
}

class SequencedProjectOverview extends Projection<
  ProjectSequenceId,
  typeof SequencedProjectOverviewStateSchema,
  number
> {
  static calls = 0;

  subscribeState(event: SequencedProjectOverviewCreated): void {
    void event;
    SequencedProjectOverview.calls += 1;
  }
}

class RegisteredProjectAggregate extends Aggregate<
  RepositoryProjectId,
  typeof RegisteredProjectStateSchema,
  bigint
> {
  assign(command: RegisterProject): void {
    this.update((draft) => Object.assign(draft, command));
  }
}

class ProjectMilestoneProjection extends Projection<
  ProjectMilestoneId,
  typeof ProjectMilestoneOverviewStateSchema,
  number
> {
  subscribe(event: ProjectMilestoneAdded | ProjectMilestoneSourceState): void {
    this.update((draft) => Object.assign(draft, event));
  }
}

class ProjectMilestoneAggregate extends Aggregate<
  ProjectMilestoneId,
  typeof ProjectMilestoneStateSchema,
  bigint
> {
  assign(command: AddProjectMilestone): void {
    this.update((draft) => Object.assign(draft, command));
  }
}

class ProjectMilestoneProcessManager extends ProcessManager<
  ProjectMilestoneId,
  typeof ProjectMilestoneWorkflowStateSchema,
  number
> {
  static calls = 0;
  static ids: ProjectMilestoneId[] = [];

  static reset(): void {
    this.calls = 0;
    this.ids = [];
  }

  react(event: ProjectMilestoneAdded): void {
    ProjectMilestoneProcessManager.calls += 1;
    ProjectMilestoneProcessManager.ids.push(this.id);
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectMilestoneWorkflowStateSchema, {
          id: this.id,
          queue: event.name,
        }),
      ),
    );
  }

  assignAndProduce(command: AddProjectMilestone): ProjectMilestoneAdded {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectMilestoneWorkflowStateSchema, {
          id: this.id,
          queue: command.name,
        }),
      ),
    );
    return create(ProjectMilestoneAddedSchema, {
      id: this.id,
      name: `${command.name} produced`,
    });
  }
}

class NumberedProjectAggregate extends Aggregate<
  number,
  typeof NumberedProjectStateSchema,
  bigint
> {
  assign(command: CreateNumberedProject): NumberedProjectCreated {
    this.update((draft) => {
      draft.id = command.id;
      draft.name = command.name;
    });
    return create(NumberedProjectCreatedSchema, { id: command.id, name: command.name });
  }

  react(event: NumberedProjectCreated): void {
    void event;
  }
}

class ProjectWorkflow extends ProcessManager<bigint, typeof ProjectWorkflowStateSchema, number> {
  assign(command: ScheduleProjectWorkflow): void {
    this.update((draft) => {
      draft.id = command.id;
      draft.queue = command.queue;
    });
  }

  react(event: ProjectWorkflowScheduled): void {
    void event;
  }
}

class MalformedFirstFieldAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  assignRepeated(command: InviteProjectMembers): void {
    void command;
  }

  assignMap(command: AssignProjectAttributes): void {
    void command;
  }
}

class ExecutingProjectAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  static assigneeCalls = 0;
  static directUpdateCalls = 0;
  static failure: Error | undefined;

  static reset(failure?: Error): void {
    this.assigneeCalls = 0;
    this.directUpdateCalls = 0;
    this.failure = failure;
  }

  createProject(command: CreateProject) {
    ExecutingProjectAggregate.assigneeCalls++;

    if (ExecutingProjectAggregate.failure !== undefined) {
      throw ExecutingProjectAggregate.failure;
    }

    if (command.name.startsWith("archive-lifecycle")) this.archiveDraft();
    if (command.name.startsWith("unarchive-lifecycle")) this.unarchiveDraft();
    if (command.name.startsWith("delete-lifecycle")) this.markDraftDeleted();
    if (command.name.startsWith("restore-lifecycle")) this.restoreDraft();

    if (command.name.includes("-lifecycle")) {
      return create(EventSchema, {
        id: create(EventIdSchema, { value: `event-${command.name}` }),
        context: create(EventContextSchema),
        message: AnyMessages.pack(
          ProjectCreatedSchema,
          create(ProjectCreatedSchema, {
            id: command.id,
            name: command.name,
            priority: 1,
          }),
        ),
      });
    }

    const name = command.name === "Multi" ? "Multi two" : command.name;
    ExecutingProjectAggregate.directUpdateCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
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

    return create(EventSchema, {
      id: create(EventIdSchema, { value: `event-${command.name}` }),
      context: create(EventContextSchema),
      message: AnyMessages.pack(
        ProjectCreatedSchema,
        create(ProjectCreatedSchema, {
          id: command.id,
          name: command.name,
          priority: 1,
        }),
      ),
    });
  }
}

class ManagedProjectAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  static assigneeCalls = 0;
  static failure: Error | undefined;

  static reset(failure?: Error): void {
    this.assigneeCalls = 0;
    this.failure = failure;
  }

  createProject(command: CreateProject): ProjectCreated {
    ManagedProjectAggregate.assigneeCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: command.id,
          name: `${command.name} (assigned)`,
          archived: false,
        }),
      ),
    );
    if (ManagedProjectAggregate.failure !== undefined) {
      throw ManagedProjectAggregate.failure;
    }
    return create(ProjectCreatedSchema, {
      id: command.id,
      name: `${command.name} event`,
    });
  }
}

class ProjectIdRejectingAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  static failure: unknown;

  createProject(): never {
    throw ProjectIdRejectingAggregate.failure;
  }
}

class GeneratedTwoArgAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
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

  async createProject(command: CreateProject, context: CommandContext): Promise<ProjectCreated> {
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
      return create(ProjectCreatedSchema, {
        id: command.id,
        name: `${command.name} event`,
      });
    }
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: command.id,
          name: `${command.name} (generated)`,
          archived: false,
        }),
      ),
    );
    return create(ProjectCreatedSchema, {
      id: command.id,
      name: `${command.name} event`,
    });
  }
}

class ProjectRegistrationReactorAggregate extends Aggregate<
  string,
  typeof ProjectStateSchema,
  bigint
> {
  static argumentCounts: number[] = [];
  static contexts: EventContext[] = [];
  static failure: Error | undefined;

  static reset(failure?: Error): void {
    this.argumentCounts = [];
    this.contexts = [];
    this.failure = failure;
  }

  reactProjection(
    event: ProjectCreated,
    context: EventContext,
  ): ProjectRegistered | ProjectRegistered[] {
    ProjectRegistrationReactorAggregate.argumentCounts.push(arguments.length);
    ProjectRegistrationReactorAggregate.contexts.push(context);
    if (ProjectRegistrationReactorAggregate.failure !== undefined) {
      throw ProjectRegistrationReactorAggregate.failure;
    }
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: event.id,
          name: `${event.name} (reacted)`,
          archived: false,
        }),
      ),
    );
    const produced = create(ProjectRegisteredSchema, {
      id: event.id,
      name: `${event.name} reacted event`,
    });
    return event.name === "two events"
      ? [produced, clone(ProjectRegisteredSchema, produced)]
      : produced;
  }
}

class GuardedAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  static calls = 0;

  static reset(): void {
    this.calls = 0;
  }

  reactProjection(event: ProjectCreated): void {
    GuardedAggregate.calls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: this.id,
          name: `${event.name} (guarded)`,
          archived: false,
        }),
      ),
    );
  }
}

class ProducingGuardedAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  static calls = 0;

  static reset(): void {
    this.calls = 0;
  }

  reactProjection(event: ProjectCreated): ProjectRegistered {
    ProducingGuardedAggregate.calls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: this.id,
          name: `${event.name} (producing guarded)`,
          archived: false,
        }),
      ),
    );
    return create(ProjectRegisteredSchema, {
      id: this.id,
      name: `${event.name} produced`,
      priority: 1,
    });
  }
}

class GeneratedCommandingProcessManager extends ProcessManager<
  string,
  typeof ProjectQueueStateSchema,
  number
> {
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

  async commandProjection(
    event: ProjectCreated,
    context: EventContext,
  ): Promise<CreateFollowUpProject> {
    GeneratedCommandingProcessManager.argumentCounts.push(arguments.length);
    GeneratedCommandingProcessManager.contexts.push(context);
    GeneratedCommandingProcessManager.commandProjectionStarted++;
    await GeneratedCommandingProcessManager.#commandProjectionCanFinish;
    return create(CreateFollowUpProjectSchema, {
      id: event.id,
      name: `${event.name} command`,
    });
  }
}

class MultiManagedAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  createProject(command: CreateProject): readonly ProjectCreated[] {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: command.id,
          name: `${command.name} two (assigned)`,
          archived: false,
        }),
      ),
    );
    return [
      create(ProjectCreatedSchema, {
        id: command.id,
        name: `${command.name} one event`,
        priority: 1,
      }),
      create(ProjectCreatedSchema, {
        id: command.id,
        name: `${command.name} two event`,
        priority: 1,
      }),
    ];
  }
}

class EmptyManagedAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  createProject(command: CreateProject): undefined {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: command.id,
          name: command.name,
          archived: false,
        }),
      ),
    );
    return undefined;
  }
}

class EnvelopeManagedAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  createProject(command: CreateProject): SpineEvent {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: command.id,
          name: command.name,
          archived: false,
        }),
      ),
    );
    return createAggregateEvent("spoofed-event", command.id, 0, command.name);
  }
}

class ValidatingProjectAggregate extends Aggregate<
  string,
  typeof ProjectSubmissionStateSchema,
  bigint
> {
  static assigneeCalls = 0;
  static applierCalls = 0;

  static reset(): void {
    this.assigneeCalls = 0;
    this.applierCalls = 0;
  }

  createProject(command: CreateProjectSubmission) {
    ValidatingProjectAggregate.assigneeCalls++;
    return createValidatedEvent(`event-${command.id}`, command.id, command.name);
  }

  applyTask(event: ProjectSubmissionCreated): void {
    ValidatingProjectAggregate.applierCalls++;
    this.startTransaction();
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectSubmissionStateSchema, {
          id: event.id,
          name: event.name,
        }),
      ),
    );
    this.commitTransaction();
  }
}

class ProjectSubmissionIdRouteAggregate extends Aggregate<
  ProjectSubmissionId,
  typeof ProjectSubmissionIdStateSchema,
  bigint
> {
  static calls = 0;

  static reset(): void {
    this.calls = 0;
  }

  createProject(): void {
    ProjectSubmissionIdRouteAggregate.calls += 1;
  }
}

class ValidatingProcessManager extends ProcessManager<
  string,
  typeof ProjectQueueStateSchema,
  number
> {
  static commandCalls = 0;

  static reset(): void {
    this.commandCalls = 0;
  }

  createProject(command: CreateProjectSubmission): ProjectCreated {
    ValidatingProcessManager.commandCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectQueueStateSchema, {
          id: command.id,
          queue: `${command.name} assigned`,
        }),
      ),
    );
    return create(ProjectCreatedSchema, {
      id: command.id,
      name: `${command.name} event`,
      priority: 1,
    });
  }
}

class TransitionViolatingAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  createProject(command: CreateProject) {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: `${command.id}-changed`,
          name: command.name,
          archived: false,
        }),
      ),
    );
    return createAggregateEvent("event-transition-invalid", command.id, 0, command.name);
  }
}

class RecoveringTransitionAggregate extends TransitionViolatingAggregate {
  override createProject(command: CreateProject) {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: command.id,
          name: `${command.name} recovered`,
          archived: false,
        }),
      ),
    );
    return createAggregateEvent("event-transition-recovers", command.id, 0, command.name);
  }
}

class AsyncAssigneeAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  static resolveCommand: ((eventName: string) => void) | undefined;

  createProject(command: CreateProject): Promise<SpineEvent> {
    return new Promise((resolve) => {
      AsyncAssigneeAggregate.resolveCommand = (eventName) => {
        this.update((draft) =>
          Object.assign(
            draft,
            create(ProjectStateSchema, {
              id: command.id,
              name: `${eventName} (applied)`,
              archived: false,
            }),
          ),
        );
        resolve(createAggregateEvent(`event-${eventName}`, command.id, 0, eventName));
      };
    });
  }
}

class RejectedAsyncAssigneeAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  static rejectCommand: ((error: Error) => void) | undefined;

  static reset(): void {
    this.rejectCommand = undefined;
  }

  createProject(command: CreateProject): Promise<SpineEvent> {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: command.id,
          name: `${command.name} provisional`,
          archived: false,
        }),
      ),
    );
    return new Promise((_resolve, reject) => {
      RejectedAsyncAssigneeAggregate.rejectCommand = reject;
    });
  }
}

class SerialAsyncAssigneeAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  static readonly started: string[] = [];
  static readonly releases: (() => void)[] = [];

  static reset(): void {
    this.started.splice(0);
    this.releases.splice(0);
  }

  static releaseNext(): void {
    const release = this.releases.shift();
    if (release === undefined) throw new Error("Expected a pending async assignment.");
    release();
  }

  createProject(command: CreateProject): Promise<SpineEvent> {
    SerialAsyncAssigneeAggregate.started.push(command.name);
    return new Promise<void>((resolve) => {
      SerialAsyncAssigneeAggregate.releases.push(resolve);
    }).then(() => {
      this.update((draft) =>
        Object.assign(
          draft,
          create(ProjectStateSchema, {
            id: command.id,
            name: `${command.name} (applied)`,
            archived: false,
          }),
        ),
      );
      return createAggregateEvent(`event-${command.name}`, command.id, 0, command.name);
    });
  }
}

class NoApplierAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  createProject(command: CreateProject): ProjectCreated {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: command.id,
          name: `${command.name} (reaction metadata)`,
          archived: false,
        }),
      ),
    );
    return create(ProjectCreatedSchema, {
      id: command.id,
      name: `${command.name} event`,
    });
  }

  reactTask(event: ProjectCreated): void {
    void event;
  }
}

class MalformedEventAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  createProject(): unknown {
    return create(EventSchema, {
      id: create(EventIdSchema, { value: "event-malformed" }),
      context: create(EventContextSchema),
    });
  }

  applyTask(event: ProjectCreated): void {
    void event;
  }
}

class BigintVersionAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  static observedVersions: unknown[] = [];

  static reset(): void {
    this.observedVersions = [];
  }

  createProject(command: CreateProject) {
    BigintVersionAggregate.observedVersions.push(this.version);
    return createAggregateEvent(`event-bigint-${command.name}`, command.id, 0, command.name);
  }

  applyTask(event: ProjectCreated): void {
    this.startTransaction();
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: event.id,
          name: event.name,
          archived: false,
        }),
      ),
    );
    this.commitTransaction();
  }
}

class ProjectionProducingAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  createProject(command: CreateProject) {
    return createProjectCreated(
      `event-${command.name}`,
      command.id,
      command.name === "PastMessageTenant"
        ? { pastMessageTenantId: "tenant-b" }
        : { importTenantId: "tenant-b" },
    );
  }

  applyProjection(event: ProjectCreated): void {
    this.startTransaction();
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
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
  typeof ProjectStateSchema,
  bigint
> {
  createProject(command: CreateProject) {
    return createProjectCreated(`event-${command.name}`, command.id);
  }

  applyProjection(event: ProjectCreated): void {
    this.startTransaction();
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectStateSchema, {
          id: event.id,
          name: event.name,
          archived: false,
        }),
      ),
    );
    this.commitTransaction();
  }
}

class ExecutingTaskProjection extends Projection<
  string,
  typeof ProjectOverviewStateSchema,
  number
> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeTask(event: ProjectCreated): void {
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
        create(ProjectOverviewStateSchema, {
          id: event.id,
          name: `${event.name} (projected)`,
          priority: event.priority + 1,
        }),
      ),
    );
  }
}

class FilteredTaskProjection extends Projection<string, typeof ProjectOverviewStateSchema, number> {
  static calls: string[] = [];

  static reset(): void {
    this.calls = [];
  }

  subscribeAnnouncements(event: ProjectCreated): void {
    FilteredTaskProjection.calls.push(`announcements:${event.name}`);
  }

  subscribeFallback(event: ProjectCreated): void {
    FilteredTaskProjection.calls.push(`fallback:${event.name}`);
  }
}

class FilteredEventAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  static calls: string[] = [];

  static reset(): void {
    this.calls = [];
  }

  reactAnnouncements(event: ProjectCreated): ProjectRegistered {
    FilteredEventAggregate.calls.push(`announcements:${event.name}`);
    return this.result(event);
  }

  reactFallback(event: ProjectCreated): ProjectRegistered {
    FilteredEventAggregate.calls.push(`fallback:${event.name}`);
    return this.result(event);
  }

  private result(event: ProjectCreated): ProjectRegistered {
    this.update((draft) => {
      draft.id = event.id;
      draft.name = event.name;
    });
    return create(ProjectRegisteredSchema, { id: event.id, name: event.name, priority: 1 });
  }
}

class ManagedTaskProjection extends Projection<string, typeof ProjectOverviewStateSchema, number> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeTask(event: ProjectCreated): void {
    ManagedTaskProjection.subscriberCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectOverviewStateSchema, {
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

class BlockingCatchUpProjection extends Projection<
  string,
  typeof ProjectOverviewStateSchema,
  number
> {
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

  async subscribeTask(event: ProjectCreated): Promise<void> {
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
        create(ProjectOverviewStateSchema, {
          id: event.id,
          name: `${event.name} (blocking)`,
          priority: event.priority + 1,
        }),
      ),
    );
  }
}

class GeneratedTwoArgProjection extends Projection<
  string,
  typeof ProjectOverviewStateSchema,
  number
> {
  static argumentCounts: number[] = [];
  static contexts: EventContext[] = [];

  static reset(): void {
    this.argumentCounts = [];
    this.contexts = [];
  }

  subscribeTask(event: ProjectCreated, context: EventContext): void {
    GeneratedTwoArgProjection.argumentCounts.push(arguments.length);
    GeneratedTwoArgProjection.contexts.push(context);
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectOverviewStateSchema, {
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
  typeof ProjectOverviewStateSchema,
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
  typeof ProjectOverviewStateSchema,
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

  mutateContext(event: ProjectCreated, context: EventContext): void {
    void event;
    ContextMutatingGeneratedProjection.firstContext = context;
    context.version = create(VersionSchema, { number: 99 });
  }

  observeContext(event: ProjectCreated, context: EventContext): void {
    ContextMutatingGeneratedProjection.observerSawSameContext =
      context === ContextMutatingGeneratedProjection.firstContext;
    ContextMutatingGeneratedProjection.observedVersions.push(context.version?.number);
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectOverviewStateSchema, {
          id: event.id,
          name: `${event.name} (observed)`,
          priority: event.priority + 1,
        }),
      ),
    );
  }
}

class PassiveTaskProjection extends Projection<string, typeof ProjectOverviewStateSchema, number> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeTask(event: ProjectCreated): void {
    PassiveTaskProjection.subscriberCalls++;
    void event;
  }

  subscribeState(state: ProjectState): void {
    PassiveTaskProjection.subscriberCalls++;
    void state;
  }
}

class AccumulatingTaskProjection extends Projection<
  string,
  typeof ProjectOverviewStateSchema,
  number
> {
  subscribeTask(event: ProjectCreated): void {
    this.update((draft) => {
      draft.name = event.name;
      draft.priority += event.priority;
    });
  }
}

class StateObservingProjection extends Projection<
  string,
  typeof ProjectOverviewStateSchema,
  number
> {
  static subscriberCalls = 0;

  static reset(): void {
    this.subscriberCalls = 0;
  }

  subscribeState(state: ProjectState): void {
    StateObservingProjection.subscriberCalls++;
    this.update((draft) => {
      draft.name = `${state.name} (projected)`;
      draft.priority = state.archived ? 2 : 1;
    });
  }
}

class OriginStateProjection extends Projection<string, typeof ProjectOverviewStateSchema, number> {
  static calls: string[] = [];

  static reset(): void {
    this.calls = [];
  }

  domesticState(state: ProjectState): void {
    OriginStateProjection.calls.push(`domestic:${state.id}`);
  }

  externalState(state: ProjectState): void {
    OriginStateProjection.calls.push(`external:${state.id}`);
  }
}

class ProjectBacklogProjection extends Projection<
  string,
  typeof ProjectBacklogStateSchema,
  number
> {
  subscribeState(state: ProjectOverviewState): void {
    void state;
  }
}

class ReactingTaskProjection extends Projection<string, typeof ProjectOverviewStateSchema, number> {
  reactTask(event: ProjectCreated): void {
    void event;
  }
}

class UserIdProjection extends Projection<string, typeof ProjectOverviewStateSchema, number> {
  subscribeUser(event: ProjectCreated): void {
    void event;
  }
}

class NonFiniteRouteProjection extends Projection<
  string,
  typeof ProjectOverviewStateSchema,
  number
> {
  subscribeNumber(event: ProjectPriorityChanged): void {
    void event;
  }
}

class ProjectIdProjectAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  applyTaskCreated(event: TaskCreated): void {
    void event;
  }

  applyWrongId(event: ProjectMemberChanged): void {
    void event;
  }
}

class ProjectIdProducingAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  assignTask(command: CreateTask): TaskCreated {
    this.update((draft) =>
      Object.assign(draft, {
        id: command.id,
        taskListId: command.taskListId,
        title: command.title,
      }),
    );
    return create(TaskCreatedSchema, {
      ...(command.id === undefined ? {} : { id: command.id }),
      taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
      title: command.title,
    });
  }
}

class TaskCreatedScalarProjection extends Projection<
  string,
  typeof ProjectOverviewStateSchema,
  number
> {
  subscribeTaskCreated(event: TaskCreated): void {
    void event;
  }
}

class CreateTaskScalarAggregate extends Aggregate<string, typeof ProjectStateSchema, bigint> {
  assignCreateTask(command: CreateTask): void {
    void command;
  }
}

class MissingSubscriberMethodProjection extends Projection<
  string,
  typeof ProjectOverviewStateSchema,
  number
> {
  missingSubscriber(event: ProjectCreated): void {
    void event;
  }
}

class ThrowingTaskProjection extends Projection<string, typeof ProjectOverviewStateSchema, number> {
  static failure: unknown = new Error("projection subscriber failed");

  static reset(failure: unknown = new Error("projection subscriber failed")): void {
    this.failure = failure;
  }

  subscribeTask(event: ProjectCreated): void {
    void event;
    throw ThrowingTaskProjection.failure;
  }
}

class RoutingProcessManager extends ProcessManager<string, typeof ProjectQueueStateSchema, number> {
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

  createProject(command: CreateProject): ProjectCreated {
    RoutingProcessManager.commandCalls++;
    if (command.name.endsWith("-lifecycle")) {
      if (command.name === "archive-lifecycle") this.archiveDraft();
      if (command.name === "unarchive-lifecycle") this.unarchiveDraft();
      if (command.name === "delete-lifecycle") this.markDraftDeleted();
      if (command.name === "restore-lifecycle") this.restoreDraft();
      return create(ProjectCreatedSchema, { id: command.id, name: command.name, priority: 1 });
    }
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectQueueStateSchema, {
          id: command.id,
          queue: `${command.name} assigned`,
        }),
      ),
    );
    if (RoutingProcessManager.failure !== undefined) {
      throw RoutingProcessManager.failure;
    }
    return create(ProjectCreatedSchema, {
      id: command.id,
      name: `${command.name} event`,
      priority: 1,
    });
  }

  reactTask(event: ProjectCreated): void {
    RoutingProcessManager.eventCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectQueueStateSchema, {
          id: event.id,
          queue: `${event.name} reacted`,
        }),
      ),
    );
    if (RoutingProcessManager.failure !== undefined) {
      throw RoutingProcessManager.failure;
    }
  }

  commandProject(event: ProjectCreated): CreateProject {
    RoutingProcessManager.commandReactionCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectQueueStateSchema, {
          id: event.id,
          queue: `${event.name} commanded`,
        }),
      ),
    );
    return create(CreateProjectSchema, {
      id: event.id,
      name: `${event.name} follow-up command`,
    });
  }

  reactTaskWithEvent(event: ProjectCreated): ProjectRegistered {
    RoutingProcessManager.eventCalls++;
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectQueueStateSchema, {
          id: event.id,
          queue: `${event.name} evented`,
        }),
      ),
    );
    return create(ProjectRegisteredSchema, {
      id: event.id,
      name: `${event.name} produced event`,
      priority: 1,
    });
  }
}

class CommandSubstitutingProcessManager extends ProcessManager<
  string,
  typeof ProjectQueueStateSchema,
  number
> {
  static siblingOutputs = false;

  static reset(): void {
    this.siblingOutputs = false;
  }

  substitute(
    command: CreateProjectSubmission,
    context: CommandContext,
  ): CreateFollowUpProject | readonly CreateFollowUpProject[] {
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectQueueStateSchema, {
          id: this.id,
          queue: `${command.name}:${context.actorContext?.actor?.value ?? "anonymous"}`,
        }),
      ),
    );
    const first = create(CreateFollowUpProjectSchema, {
      id: command.id,
      name: `${command.name} follow-up`,
    });
    return CommandSubstitutingProcessManager.siblingOutputs
      ? [first, create(CreateFollowUpProjectSchema, { ...first, name: `${command.name} sibling` })]
      : first;
  }
}

class FilteredProcessManager extends ProcessManager<
  string,
  typeof ProjectQueueStateSchema,
  number
> {
  static calls: string[] = [];

  static reset(): void {
    this.calls = [];
  }

  reactAnnouncements(event: ProjectCreated): void {
    FilteredProcessManager.calls.push(`react-announcements:${event.name}`);
  }

  reactFallback(event: ProjectCreated): void {
    FilteredProcessManager.calls.push(`react-fallback:${event.name}`);
  }

  commandAnnouncements(event: ProjectCreated): CreateProject {
    FilteredProcessManager.calls.push(`command-announcements:${event.name}`);
    return create(CreateProjectSchema, { id: event.id, name: event.name });
  }

  commandFallback(event: ProjectCreated): CreateProject {
    FilteredProcessManager.calls.push(`command-fallback:${event.name}`);
    return create(CreateProjectSchema, { id: event.id, name: event.name });
  }
}

class DiagnosticOnlyProcessManager extends ProcessManager<
  string,
  typeof ProjectQueueStateSchema,
  number
> {
  static calls = 0;

  createProject(command: CreateProject): ProjectCreated {
    DiagnosticOnlyProcessManager.calls += 1;
    return create(ProjectCreatedSchema, {
      id: command.id,
      name: `${command.name} diagnostic`,
      priority: 1,
    });
  }
}

class InboxCheckingProcessManager extends ProcessManager<
  string,
  typeof ProjectQueueStateSchema,
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

  async reactTask(event: ProjectCreated): Promise<void> {
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
        create(ProjectQueueStateSchema, {
          id: event.id,
          queue: `${event.name} checked`,
        }),
      ),
    );
  }
}

class BlockingProcessManager extends ProcessManager<
  string,
  typeof ProjectQueueStateSchema,
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

  async reactTask(event: ProjectCreated): Promise<void> {
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
        create(ProjectQueueStateSchema, {
          id: event.id,
          queue: `${event.name} blocked`,
        }),
      ),
    );
  }
}

class SplitRouteProcessManager extends ProcessManager<
  string,
  typeof ProjectQueueStateSchema,
  number
> {
  static startedIds: string[] = [];
  static completedIds: string[] = [];

  static reset(): void {
    this.startedIds = [];
    this.completedIds = [];
  }

  reactTask(event: ProjectCreated): void {
    SplitRouteProcessManager.startedIds.push(this.id);

    if (this.id === "pm-fail") {
      throw new Error("pm-fail replay failed");
    }

    SplitRouteProcessManager.completedIds.push(this.id);
    this.update((draft) =>
      Object.assign(
        draft,
        create(ProjectQueueStateSchema, {
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
    new Repository({ entityType: ExecutingTaskProjection, schema: ProjectOverviewStateSchema });
    const spec = SpecScanner.scan(ExecutingTaskProjection as never);
    const descriptor = entityStorageDescriptor({ name: "Tasks", multitenant: false }, spec);
    const structured = { value: "task-1" };
    const record = EntityRecords.pack(
      ProjectOverviewStateSchema,
      "task-1",
      create(ProjectOverviewStateSchema, { id: "state-id-must-not-route", name: "First" }),
      1n,
      { archived: false, deleted: false },
    );

    expect(spec.sourceType).toBe(ProjectOverviewStateSchema);
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
    ExecutingProjectAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const observed: string[] = [];
    const repository = createExecutingRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .addEventDispatcher({
        messageSchemas: () => [ProjectCreatedSchema],
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
      stateSchema: ProjectStateSchema,
      eventHistory: true,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    const completion = context
      .commandBus()
      .post(createAggregateCommand("command-exec", "task-exec", "TaskExec"));

    expect(ExecutingProjectAggregate.assigneeCalls).toBe(0);
    expect(observed).toEqual([]);

    await completion;

    expect(ExecutingProjectAggregate.assigneeCalls).toBe(1);
    expect(ExecutingProjectAggregate.directUpdateCalls).toBe(1);
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
      stateSchema: ProjectStateSchema,
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
      stateSchema: ProjectOverviewStateSchema,
    });

    try {
      await projectionContext
        .eventBus()
        .post(createProjectCreated("event-history-default-projection", "history-projection"));
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
      stateSchema: ProjectQueueStateSchema,
    });

    try {
      await processManagerContext
        .eventBus()
        .post(createProjectCreated("event-history-default-pm", "history-pm"));
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
      stateSchema: ProjectStateSchema,
      stateHistory: true,
      eventHistory: true,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    let attempts = 0;
    context.stand().subscribe(ProjectStateSchema, () => {
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
      expect("storedEventDispatchFailures" in context).toBe(false);
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
    context.stand().subscribe(ProjectQueueStateSchema, () => {
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
      await expect(context.stand().read(ProjectQueueStateSchema, "pm-subscriber")).resolves.toEqual(
        create(ProjectQueueStateSchema, {
          id: "pm-subscriber",
          queue: "Follow-up assigned",
        }),
      );
      expect("storedEventDispatchFailures" in context).toBe(false);
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
    context.stand().subscribe(ProjectStateSchema, () => {
      original += 1;
    });
    const command = context.commandBus().post(createAggregateCommand("command-late", "late-id"));
    await factory.reached;
    context.stand().subscribe(ProjectStateSchema, () => {
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
      stateSchema: ProjectStateSchema,
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
      stateSchema: ProjectOverviewStateSchema,
      stateHistory: true,
    });

    try {
      await projectionContext
        .eventBus()
        .post(createProjectCreated("event-history-enabled-projection", "history-projection"));
      projectionRepository.setStateHistoryEnabled(false);
      await projectionContext
        .eventBus()
        .post(createProjectCreated("event-history-disabled-projection", "history-projection"));
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
      stateSchema: ProjectQueueStateSchema,
      stateHistory: true,
    });

    try {
      await processManagerContext
        .eventBus()
        .post(createProjectCreated("event-history-enabled-pm", "history-pm"));
      processManagerRepository.setStateHistoryEnabled(false);
      await processManagerContext
        .eventBus()
        .post(createProjectCreated("event-history-disabled-pm", "history-pm"));
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
      stateSchema: ProjectStateSchema,
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
    ManagedProjectAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createManagedRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: ProjectStateSchema,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await context
      .commandBus()
      .post(createAggregateCommand("command-managed", "task-managed", "Managed"));

    expect(ManagedProjectAggregate.assigneeCalls).toBe(1);
    await expect(eventStore.read()).resolves.toMatchObject([
      {
        context: { version: { number: 0 } },
      },
    ]);
    const [stored] = await eventStore.read();
    expect(stored?.id?.value).toMatch(UUID_PATTERN);
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
      stateSchema: ProjectStateSchema,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    ManagedProjectAggregate.reset();
    await context
      .commandBus()
      .post(createAggregateCommand("command-existing", "task-rejected", "Persisted"));
    const currentBeforeRejection = await storage.readCurrent("task-rejected");
    const eventsBeforeRejection = await eventStore.read();

    expect(currentBeforeRejection).toEqual({
      entityId: "task-rejected",
      state: create(ProjectStateSchema, {
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
    ManagedProjectAggregate.reset(rejection);

    await expect(context.commandBus().post(command)).resolves.toBeUndefined();

    if (command.id !== undefined) {
      command.id.uuid = "mutated-command";
    }
    const storedEvents = await waitForStoredEvents(eventStore, 2);
    const rejectionEvents = storedEvents.filter((event) => event.context?.rejection !== undefined);
    const [event] = rejectionEvents;

    expect(storedEvents).toHaveLength(eventsBeforeRejection.length + 1);
    expect(rejectionEvents).toHaveLength(1);
    expect(event?.id?.value).toMatch(/.+/);
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
          typeUrl: TypeUrls.derive(CreateProjectSchema),
        }),
        actorContext: create(ActorContextSchema, {
          actor: create(UserIdSchema, { value: "user-1" }),
        }),
      }),
    });
    expect(readReadableProducerId(event)).toBe("task-rejected");
    expect(event?.context?.version).toBeUndefined();
    await expect(storage.readCurrent("task-rejected")).resolves.toEqual(currentBeforeRejection);
    expect("storedEventDispatchFailures" in context).toBe(false);
    ManagedProjectAggregate.reset();
  });

  it("posts a rejected aggregate command without directly updating or persisting output", async () => {
    const rejection = TaskAlreadyDone.create({
      id: create(GeneratedTaskIdSchema, { value: "task-applier-rejected" }),
    });
    ExecutingProjectAggregate.reset(rejection);
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: ProjectStateSchema,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-applier-rejected", "task-applier-rejected")),
    ).resolves.toBeUndefined();

    expect(ExecutingProjectAggregate.directUpdateCalls).toBe(0);
    const [stored] = await waitForStoredEvents(eventStore, 1);
    expect(stored?.id?.value).toMatch(UUID_PATTERN);
    await expect(storage.readCurrent("task-applier-rejected")).resolves.toBeUndefined();
    ExecutingProjectAggregate.reset();
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
    ManagedProjectAggregate.reset(thrown);
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
    ManagedProjectAggregate.reset();
  });

  it("uses the typed message-valued entity ID as the rejection producer", async () => {
    RejectionObservingProjection.reset();
    ProjectIdRejectingAggregate.failure = TaskAlreadyDone.create({
      id: create(GeneratedTaskIdSchema, { value: "task-message-id" }),
    });
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProjectIdRejectingRepository())
      .add(
        createRejectionObservingRepository(
          EventRouting.create<string>().route(TaskAlreadyDoneSchema, (message) => {
            if (message.id === undefined) throw new Error("Expected a Task ID.");
            return [message.id.value];
          }),
        ),
      )
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.commandBus().post(createCreateProject("command-message-id", "task-message-id")),
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
      .post(
        createGeneratedCreateProject(
          "command-generated",
          "task-generated",
          "Generated",
          "tenant-a",
        ),
      );

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
      .post(createContextlessGeneratedCreateProject("command-empty-context", "task-empty-context"));

    expect(GeneratedTwoArgAggregate.argumentCounts).toEqual([2]);
    expect(GeneratedTwoArgAggregate.contexts).toEqual([create(CommandContextSchema)]);
  });

  it("loads the committed state for each later generated Aggregate command", async () => {
    GeneratedTwoArgAggregate.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedTwoArgAggregateRepository())
      .withStorageFactory(new InMemoryStorageFactory())
      .build();

    await context
      .commandBus()
      .post(createGeneratedCreateProject("command-first", "same-id", "First"));
    await context
      .commandBus()
      .post(createGeneratedCreateProject("command-second", "same-id", "Second"));

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
        messageSchemas: () => [ProjectCreatedSchema],
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
        context
          .commandBus()
          .post(createGeneratedCreateProject("concurrent-first", "duplicate", "First")),
        context
          .commandBus()
          .post(createGeneratedCreateProject("concurrent-second", "duplicate", "Second")),
      ]),
    ).resolves.toEqual([undefined, undefined]);

    expect(GeneratedTwoArgAggregate.observedStateNames).toEqual(["", "First (generated)"]);
    await expect(
      context.stand().readVersioned(ProjectStateSchema, "duplicate"),
    ).resolves.toMatchObject({
      state: { name: "First (generated)" },
      version: { number: 1 },
    });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatch(/.+/);
    const storedEvents = await waitForStoredEvents(eventStore, 2);
    const normalEvents = storedEvents.filter((event) => event.context?.rejection === undefined);
    const rejectionEvents = storedEvents.filter((event) => event.context?.rejection !== undefined);
    expect(normalEvents).toHaveLength(1);
    expect(normalEvents[0]?.id?.value).toMatch(/.+/);
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
        ProjectStateSchema,
        create(ProjectStateSchema, { id: "lifecycle-id", name: "Stored", archived: true }),
        {
          version: create(VersionSchema, { number: 7 }),
          lifecycle: { archived: true, deleted: true },
        },
      );

    await context
      .commandBus()
      .post(createGeneratedCreateProject("command-lifecycle", "lifecycle-id"));

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
      .post(createGeneratedCreateProject("tenant-a-first", "same", "A", "tenant-a"));
    await context
      .commandBus()
      .post(createGeneratedCreateProject("tenant-b-first", "same", "B", "tenant-b"));
    await context
      .commandBus()
      .post(createGeneratedCreateProject("tenant-a-next", "same", "A2", "tenant-a"));
    await context
      .commandBus()
      .post(createGeneratedCreateProject("tenant-b-next", "same", "B2", "tenant-b"));

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
        messageSchemas: () => [ProjectCreatedSchema],
        dispatch: (event) => {
          observed.push(event.id?.value ?? "missing");
          return Promise.resolve();
        },
      })
      .withStorageFactory(new InMemoryStorageFactory())
      .build();

    const post = context
      .commandBus()
      .post(createGeneratedCreateProject("command-close-event", "task-close-event"));
    await waitForCondition(() => GeneratedTwoArgAggregate.assigneeStarted === 1);

    const close = context.close().then(() => "closed");

    await expect(Promise.race([close, delay(25)])).resolves.toBe("pending");

    GeneratedTwoArgAggregate.releaseAssignee();

    await expect(post).resolves.toBeUndefined();
    await expect(close).resolves.toBe("closed");
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatch(/.+/);
  });

  it("runs generated aggregate event reactors and wraps returned domain events after commit", async () => {
    ProjectRegistrationReactorAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const observed: string[] = [];
    const context = BoundedContext.multitenant("Tasks")
      .add(createGeneratedReactorRepository())
      .addEventDispatcher({
        messageSchemas: () => [ProjectRegisteredSchema],
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
      stateSchema: ProjectStateSchema,
    });
    const eventStore = new EventStore(
      { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-b") },
      factory,
    );

    await context.eventBus().post(
      createProjectCreated("event-reactor-source", "task-reactor", {
        pastMessageTenantId: "tenant-b",
      }),
    );

    expect(ProjectRegistrationReactorAggregate.argumentCounts).toEqual([2]);
    expect(ProjectRegistrationReactorAggregate.contexts[0]?.origin).toEqual(
      projectionEventOrigin({ pastMessageTenantId: "tenant-b" }),
    );
    const stored = await eventStore.read();
    const { source, child } = storedSourceAndFreshChild(stored, "event-reactor-source");

    expect(child.context?.origin).toMatchObject({ case: "pastMessage" });
    expect(source).toMatchObject({
      id: { value: "event-reactor-source" },
      context: {
        version: { number: 1 },
        origin: {
          case: "pastMessage",
        },
      },
    });
    expect(source.context?.timestamp).toBeDefined();
    expect(readReadableProducerId(source)).toBe("task-reactor");
    expect(source.context?.origin).toEqual({
      case: "pastMessage",
      value: create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "past-command" })),
          typeUrl: TypeUrls.derive(CreateProjectSchema),
        }),
        actorContext: create(ActorContextSchema, {
          tenantId: createTenantId("tenant-b"),
        }),
      }),
    });
    await expect(storage.readCurrent("task-reactor")).resolves.toMatchObject({
      entityId: "task-reactor",
      version: 1n,
      state: { id: "task-reactor", name: "Task (reacted)", archived: false },
    });
    await waitForCondition(() => observed.length === 1);
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatch(/.+/);
  });

  it("uses one committed version for every event and state from an aggregate event reaction", async () => {
    ProjectRegistrationReactorAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedReactorRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: ProjectStateSchema,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    try {
      await context.eventBus().post(
        createProjectCreated("event-reactor-multi", "task-reactor-multi", {
          name: "two events",
        }),
      );

      const stored = await eventStore.read();
      expect(
        stored.filter(
          (event) =>
            event.context?.version?.number === 0 &&
            AnyMessages.unpack(event.message as never, ProjectRegisteredSchema) !== undefined,
        ),
      ).toHaveLength(2);
      await expect(storage.readCurrent("task-reactor-multi")).resolves.toMatchObject({
        entityId: "task-reactor-multi",
        version: 1n,
      });
    } finally {
      await context.close();
    }
  });

  it("emits a System reactor-dispatch diagnostic after aggregate reactor admission", async () => {
    ProjectRegistrationReactorAggregate.reset();
    const diagnostics: SpineEvent[] = [];
    const event = createProjectCreated("aggregate-reactor-diagnostic", "aggregate-reactor-id");
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
        receiver: { typeUrl: TypeUrls.derive(ProjectStateSchema) },
        payload: event,
        entityType: {
          impl: { case: "javaClassName", value: "ProjectRegistrationReactorAggregate" },
        },
        whenDispatched: diagnostics[0]?.context?.timestamp,
      });
      expect(diagnostics[0]?.context?.origin).toMatchObject({
        case: "pastMessage",
        value: { message: { typeUrl: TypeUrls.derive(ProjectCreatedSchema) } },
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
    const event = createProjectCreated("aggregate-reactor-failure", "aggregate-reactor-failure");
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
      ProjectRegistrationReactorAggregate.reset(failure);
      await expect(context.eventBus().post(event)).rejects.toThrow(failure);
      await waitForCondition(() => diagnostics.length === 1);

      expect(ProjectRegistrationReactorAggregate.argumentCounts).toEqual([2]);
      expect(diagnostics).toHaveLength(1);
      expect(
        AnyMessages.unpack(diagnostics[0]?.message as never, EventDispatchedToReactorSchema),
      ).toMatchObject({ payload: event });
    } finally {
      ProjectRegistrationReactorAggregate.reset();
      await context.close();
    }
  });

  it("does not emit reactor diagnostics for an event without a matching route", async () => {
    ProjectRegistrationReactorAggregate.reset();
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
          create(EventSchema, {
            id: create(EventIdSchema, { value: "aggregate-reactor-unmatched" }),
            context: create(EventContextSchema),
            message: AnyMessages.pack(
              ProjectPriorityChangedSchema,
              create(ProjectPriorityChangedSchema, { id: 7 }),
            ),
          }),
        ),
      ).rejects.toThrow(/event schema/i);
      await context.close();

      expect(diagnostics).toEqual([]);
      expect(ProjectRegistrationReactorAggregate.argumentCounts).toEqual([]);
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
        messageSchemas: () => [ProjectRegisteredSchema],
        dispatch: (event) => {
          observed.push(event.id?.value ?? "missing");
          return Promise.resolve();
        },
      })
      .withStorageFactory(factory)
      .build();

    await context.eventBus().post(createProjectCreated("event-follow-up-source", "task-follow-up"));
    await context
      .eventBus()
      .post(createProjectRegistered("event-later-external", "task-follow-up", 2));
    await context.close();

    expect(observed).toHaveLength(2);
    expect(observed[0]).toMatch(/.+/);
    expect(observed[0]).not.toBe("event-later-external");
    expect(observed[1]).toBe("event-later-external");
  });

  it("runs generated command reactions and wraps returned domain commands after event intake", async () => {
    GeneratedCommandingProcessManager.reset();
    const commands: SpineCommand[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedCommandingRepository())
      .addCommandDispatcher({
        messageSchemas: () => [CreateFollowUpProjectSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();

    await context.eventBus().post(createProjectCreated("event-command-source", "task-command"));

    expect(GeneratedCommandingProcessManager.argumentCounts).toEqual([2]);
    expect(commands).toHaveLength(1);
    const [command] = commands;

    expect(command).toBeDefined();
    expect(command?.id?.uuid).toMatch(/.+/);
    if (command?.message === undefined) {
      throw new Error("Expected a produced command message.");
    }
    expect(AnyMessages.unpack(command.message, CreateFollowUpProjectSchema)).toEqual(
      create(CreateFollowUpProjectSchema, {
        id: "task-command",
        name: "Task command",
      }),
    );
  });

  it("wraps commands from generated command reactions with the source event origin", async () => {
    const commands: SpineCommand[] = [];
    const context = BoundedContext.multitenant("Tasks")
      .add(createGeneratedCommandingRepository())
      .addCommandDispatcher({
        messageSchemas: () => [CreateFollowUpProjectSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();
    const sourceEvent = createProjectCreated("event-command-origin", "task-command-origin", {
      pastMessageTenantId: "tenant-command",
    });
    const sourceActorContext = create(ActorContextSchema, {
      tenantId: createTenantId("tenant-command"),
    });
    const sourceGrandOrigin = create(OriginSchema, {
      message: create(MessageIdSchema, {
        id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "past-command" })),
        typeUrl: TypeUrls.derive(CreateProjectSchema),
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
          typeUrl: TypeUrls.derive(ProjectCreatedSchema),
        }),
        actorContext: sourceActorContext,
        grandOrigin: sourceGrandOrigin,
      }),
    );
  });

  it("keeps command bus open until event-side command reactions drain during close", async () => {
    GeneratedCommandingProcessManager.reset({ pauseCommandProjection: true });
    const commands: SpineCommand[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createGeneratedCommandingRepository())
      .addCommandDispatcher({
        messageSchemas: () => [CreateFollowUpProjectSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();

    const post = context
      .eventBus()
      .post(createProjectCreated("event-command-close", "task-command-close"));
    await waitForCondition(() => GeneratedCommandingProcessManager.commandProjectionStarted === 1);

    const close = context.close().then(() => "closed");

    await expect(Promise.race([close, delay(25)])).resolves.toBe("pending");

    GeneratedCommandingProcessManager.releaseCommandProjection();

    await expect(post).resolves.toBeUndefined();
    await expect(close).resolves.toBe("closed");
    expect(commands).toHaveLength(1);
    expect(commands[0]?.id?.uuid).toMatch(/.+/);
  });

  it("assigns one producer version to all events from an aggregate dispatch", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createMultiManagedRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: ProjectStateSchema,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await context
      .commandBus()
      .post(createAggregateCommand("command-managed-multi", "task-managed-multi", "Multi"));

    const storedEvents = await eventStore.read();
    expect(storedEvents).toHaveLength(2);
    expect(storedEvents.map((event) => event.context?.version?.number).sort()).toEqual([0, 0]);
    expect(storedEvents.map((event) => event.id?.value)).toEqual([
      expect.stringMatching(/.+/),
      expect.stringMatching(/.+/),
    ]);
    expect(storedEvents[0]?.id?.value).not.toBe(storedEvents[1]?.id?.value);
    await expect(storage.readCurrent("task-managed-multi")).resolves.toMatchObject({
      entityId: "task-managed-multi",
      version: 1n,
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
    ExecutingProjectAggregate.reset();
    const repository = createExecutingRepository();
    const firstContext = BoundedContext.singleTenant("Tasks").add(repository).build();

    expect(() => BoundedContext.singleTenant("OtherTasks").add(repository).build()).toThrow(
      "already registered with Bounded Context",
    );

    await firstContext
      .commandBus()
      .post(createAggregateCommand("command-after-registration-failure", "task-after-failure"));

    expect(ExecutingProjectAggregate.assigneeCalls).toBe(1);
    expect(ExecutingProjectAggregate.directUpdateCalls).toBe(1);
  });

  it("keeps a reentrantly registered repository executable after failed outer cleanup", async () => {
    ExecutingProjectAggregate.reset();
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

    expect(ExecutingProjectAggregate.assigneeCalls).toBe(1);
    expect(ExecutingProjectAggregate.directUpdateCalls).toBe(1);
  });

  it("uses one committed version for every event and state from an aggregate command dispatch", async () => {
    ExecutingProjectAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: ProjectStateSchema,
    });

    await context.commandBus().post(createAggregateCommand("command-multi", "task-multi", "Multi"));

    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(eventStore.read()).resolves.toMatchObject([
      { id: { value: "event-Multi-1" }, context: { version: { number: 0 } } },
      { id: { value: "event-Multi-2" }, context: { version: { number: 0 } } },
    ]);
    await expect(storage.readCurrent("task-multi")).resolves.toMatchObject({
      entityId: "task-multi",
      version: 1n,
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
      stateSchema: ProjectStateSchema,
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

  it("rolls back a rejected async aggregate assignment without publishing output", async () => {
    RejectedAsyncAssigneeAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createRejectedAsyncAssigneeRepository())
      .withStorageFactory(factory)
      .build();
    const storage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
      stateSchema: ProjectStateSchema,
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const failure = new Error("async assignment failed");
    const completion = context
      .commandBus()
      .post(createAggregateCommand("command-async-rejected", "task-async-rejected", "Async"));

    await vi.waitFor(() => {
      expect(RejectedAsyncAssigneeAggregate.rejectCommand).toBeTypeOf("function");
    });
    await expect(storage.readCurrent("task-async-rejected")).resolves.toBeUndefined();

    RejectedAsyncAssigneeAggregate.rejectCommand?.(failure);
    await expect(completion).resolves.toBeUndefined();
    await expect(storage.readCurrent("task-async-rejected")).resolves.toBeUndefined();
    await expect(eventStore.read()).resolves.toEqual([]);
  });

  it("serializes same-aggregate commands until each async assignment settles", async () => {
    SerialAsyncAssigneeAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createSerialAsyncAssigneeRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const first = context
      .commandBus()
      .post(createAggregateCommand("command-first", "task-serial", "First"));

    await vi.waitFor(() => {
      expect(SerialAsyncAssigneeAggregate.started).toEqual(["First"]);
    });
    const second = context
      .commandBus()
      .post(createAggregateCommand("command-second", "task-serial", "Second"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(SerialAsyncAssigneeAggregate.started).toEqual(["First"]);

    SerialAsyncAssigneeAggregate.releaseNext();
    await vi.waitFor(() => {
      expect(SerialAsyncAssigneeAggregate.started).toEqual(["First", "Second"]);
    });
    SerialAsyncAssigneeAggregate.releaseNext();
    await Promise.all([first, second]);

    await expect(eventStore.read()).resolves.toMatchObject([
      { id: { value: "event-First" }, context: { version: { number: 0 } } },
      { id: { value: "event-Second" }, context: { version: { number: 1 } } },
    ]);
  });

  it("resolves aggregate command execution after commit when stored-event dispatch later throws", async () => {
    const factory = new InMemoryStorageFactory();
    const dispatchAttempted = createSignal();
    const dispatchFailure = new Error("dispatch failed after commit");
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [ProjectCreatedSchema],
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
      stateSchema: ProjectStateSchema,
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

    expect("storedEventDispatchFailures" in context).toBe(false);
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
        messageSchemas: () => [ProjectCreatedSchema],
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
        context: { version: { number: 0 } },
      },
    ]);
    expect((await eventStore.read())[0]?.id?.value).toMatch(UUID_PATTERN);
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
    ValidatingProjectAggregate.reset();
    const factory = new ObservingStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createValidatingRepository())
      .withStorageFactory(factory)
      .build();
    await expect(
      context.commandBus().post(createValidatedCommand("command-invalid", "task-invalid", "")),
    ).rejects.toThrow(/validation/i);

    expect(ValidatingProjectAggregate.assigneeCalls).toBe(0);
    expect(ValidatingProjectAggregate.applierCalls).toBe(0);
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
      stateSchema: ProjectStateSchema,
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
      stateSchema: ProjectStateSchema,
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
      stateSchema: ProjectStateSchema,
    });
    const tenantBStorage = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-b") },
      storageFactory: factory,
      stateSchema: ProjectStateSchema,
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
      stateSchema: ProjectStateSchema,
    });
    await storage.writeCurrent({
      entityId: "task-overflow",
      state: create(ProjectStateSchema, {
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
      .add(createProjectIdProducingRepository())
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);
    const taskId = create(TaskIdSchema, { value: "message-produced-task" });

    await context.commandBus().post(createCreateProject("command-message-producer", taskId.value));

    const [stored] = await eventStore.read();
    expect(AnyMessages.unpack(stored?.context?.producerId as never, TaskIdSchema)).toEqual(taskId);
  });

  it("routes command substitutions within their tenant and preserves command lineage", async () => {
    const produced: SpineCommand[] = [];
    const context = BoundedContext.multitenant("Command substitutions")
      .add(createCommandSubstitutingProcessManagerRepository())
      .addCommandDispatcher({
        messageSchemas: () => [CreateFollowUpProjectSchema],
        dispatch: (command) => {
          produced.push(command);
          return Promise.resolve();
        },
      })
      .build();
    const tenant = createTenantId("tenant-transform");
    const actorContext = create(ActorContextSchema, {
      actor: create(UserIdSchema, { value: "transformer" }),
      tenantId: tenant,
    });
    const grandOrigin = create(OriginSchema, {
      message: create(MessageIdSchema, {
        id: AnyMessages.pack(CommandIdSchema, create(CommandIdSchema, { uuid: "grandparent" })),
        typeUrl: TypeUrls.derive(CreateProjectSubmissionSchema),
      }),
      actorContext,
    });
    const source = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "transform-source" }),
      context: create(CommandContextSchema, { actorContext, origin: grandOrigin }),
      message: AnyMessages.pack(
        CreateProjectSubmissionSchema,
        create(CreateProjectSubmissionSchema, {
          id: "declared-source-id",
          name: "Transform",
        }),
      ),
    });

    await context.commandBus().post(source);
    await waitForCondition(() => produced.length === 1);

    expect(
      await context.stand().read(ProjectQueueStateSchema, "transform-target", { tenantId: tenant }),
    ).toEqual(
      create(ProjectQueueStateSchema, {
        id: "transform-target",
        queue: "Transform:transformer",
      }),
    );
    await expect(
      context.stand().read(ProjectQueueStateSchema, "transform-target", {
        tenantId: createTenantId("tenant-other"),
      }),
    ).resolves.toBeUndefined();
    const producedCommand = produced.at(0);
    if (producedCommand === undefined) throw new Error("Expected a produced command.");
    expect(producedCommand).toMatchObject({
      context: create(CommandContextSchema, {
        actorContext,
        origin: create(OriginSchema, {
          message: create(MessageIdSchema, {
            id: AnyMessages.pack(
              CommandIdSchema,
              create(CommandIdSchema, { uuid: "transform-source" }),
            ),
            typeUrl: TypeUrls.derive(CreateProjectSubmissionSchema),
          }),
          actorContext,
          grandOrigin,
        }),
      }),
    });
    expect(producedCommand.id?.uuid).toMatch(UUID_PATTERN);
    if (producedCommand.message === undefined) throw new Error("Expected a produced payload.");
    expect(AnyMessages.unpack(producedCommand.message, CreateFollowUpProjectSchema)).toEqual(
      create(CreateFollowUpProjectSchema, {
        id: "declared-source-id",
        name: "Transform follow-up",
      }),
    );
  });

  it("starts every sibling produced command in declaration order when one child rejects", async () => {
    CommandSubstitutingProcessManager.siblingOutputs = true;
    const observed: string[] = [];
    const errors: { readonly message: string; readonly facts: Record<string, unknown> }[] = [];
    const context = BoundedContext.singleTenant("Command substitution siblings")
      .add(createCommandSubstitutingProcessManagerRepository())
      .addCommandDispatcher({
        messageSchemas: () => [CreateFollowUpProjectSchema],
        dispatch: (command) => {
          if (command.message === undefined) throw new Error("Expected a produced payload.");
          const message = AnyMessages.unpack(command.message, CreateFollowUpProjectSchema);
          if (message === undefined) throw new Error("Expected a produced command.");
          observed.push(message.name);
          if (message.name === "Siblings follow-up") throw new Error("first child failed");
          return Promise.resolve();
        },
      })
      .build();
    boundedContextAccess.installLogger(context, {
      withMetadata: (facts: Record<string, unknown>) => ({
        error: (message: string) => errors.push({ message, facts }),
      }),
    } as unknown as ILogLayer);
    try {
      await context.commandBus().post(
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: "siblings-source" }),
          context: create(CommandContextSchema),
          message: AnyMessages.pack(
            CreateProjectSubmissionSchema,
            create(CreateProjectSubmissionSchema, {
              id: "source",
              name: "Siblings",
            }),
          ),
        }),
      );
      await context.close();
      expect(observed).toEqual(["Siblings follow-up", "Siblings sibling"]);
      expect(errors).toEqual([
        {
          message: "Produced signal handling failed.",
          facts: {
            operation: "signal_publisher.handle",
            reasonCode: "handled_failure",
          },
        },
        {
          message: "Produced signal handling failed.",
          facts: {
            operation: "signal_publisher.handle",
            reasonCode: "handled_failure",
          },
        },
      ]);
    } finally {
      CommandSubstitutingProcessManager.reset();
    }
  });

  it("routes commands to one aggregate ID by the first command field", () => {
    const repository = createRoutingRepository();
    const command = createAggregateCommand("command-1", "task-1");
    const route = repository.routeCommand(command);

    expect(route).toMatchObject({
      entityId: "task-1",
      messageFullTypeName: CreateProjectSchema.typeName,
      invocation: "deferred",
    });
    expectTypeOf(route.entityId).toEqualTypeOf<string>();

    expect(() => BoundedContext.singleTenant("Tasks").add(repository).build()).not.toThrow();
  });

  it("routes a generated UUID message ID", () => {
    const id = create(ProjectIdSchema, { value: "uuid-message-id" });
    const publicProjectId: RepositoryProjectId = id;
    const repository = createRegisteredProjectAggregateRepository();

    expect(publicProjectId).toBe(id);
    expect(id).toEqual({
      $typeName: ProjectIdSchema.typeName,
      value: "uuid-message-id",
    });
    expect(
      repository.routeCommand(
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: "command-uuid-message-id" }),
          context: create(CommandContextSchema),
          message: AnyMessages.pack(
            RegisterProjectSchema,
            create(RegisterProjectSchema, { id, name: "UUID", priority: 1 }),
          ),
        }),
      ).entityId,
    ).toEqual(id);
  });

  it("routes generated nested composite IDs through command, event, and state sources", () => {
    const idA = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 1,
    });
    const idB = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 2,
    });
    const commandRepository = createProjectMilestoneAggregateRepository();
    const projectionRepository = createProjectMilestoneProjectionRepository();
    const message = create(AddProjectMilestoneSchema, { id: idA, name: "Composite" });

    expect(
      commandRepository.routeCommand(
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: "composite-command" }),
          context: create(CommandContextSchema),
          message: AnyMessages.pack(AddProjectMilestoneSchema, message),
        }),
      ).entityId,
    ).toEqual(idA);
    expect(
      projectionRepository.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "composite-producer" }),
          context: create(EventContextSchema, {
            producerId: Identifiers.pack(ProjectMilestoneIdSchema, idA),
          }),
          message: AnyMessages.pack(
            ProjectMilestoneAddedSchema,
            create(ProjectMilestoneAddedSchema, { id: idB, name: "Producer" }),
          ),
        }),
      ).entityIds,
    ).toEqual([idA]);
    expect(
      projectionRepository.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "composite-fallback" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "other" })),
          }),
          message: AnyMessages.pack(
            ProjectMilestoneAddedSchema,
            create(ProjectMilestoneAddedSchema, { id: idB, name: "Fallback" }),
          ),
        }),
      ).entityIds,
    ).toEqual([idB]);
    expect(
      repositoryAccess.routeStateUpdate(
        projectionRepository,
        createStateChangedEvent(
          "composite-state",
          create(ProjectMilestoneSourceStateSchema, { id: idA, name: "State" }),
        ),
      )?.entityIds,
    ).toEqual([idA]);
  });

  it("uses the complete composite ID returned by a custom Command route", () => {
    const declarationId = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "declaration" }),
      number: 1,
    });
    const routedId = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "custom" }),
      number: 2,
    });
    let routeCalls = 0;
    const repository = createProjectMilestoneAggregateRepository(
      CommandRouting.create<ProjectMilestoneId>().route(AddProjectMilestoneSchema, () => {
        routeCalls += 1;
        return routedId;
      }),
    );

    expect(
      repository.routeCommand(
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: "command-composite-custom" }),
          context: create(CommandContextSchema),
          message: AnyMessages.pack(
            AddProjectMilestoneSchema,
            create(AddProjectMilestoneSchema, {
              id: declarationId,
              name: "Custom",
            }),
          ),
        }),
      ).entityId,
    ).toEqual(routedId);
    expect(routeCalls).toBe(1);
  });

  it("deduplicates generated composite route clones without merging their scalar discriminator", () => {
    const idA = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 1,
    });
    const idB = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 2,
    });
    const eventRouting = EventRouting.create<ProjectMilestoneId>().route(
      ProjectMilestoneAddedSchema,
      () => [idA, clone(ProjectMilestoneIdSchema, idA), idB],
    );
    const stateUpdateRouting = StateUpdateRouting.create<ProjectMilestoneId>().route(
      ProjectMilestoneSourceStateSchema,
      () => [idA, clone(ProjectMilestoneIdSchema, idA), idB],
    );
    const repository = createProjectMilestoneProjectionRepository(eventRouting, stateUpdateRouting);

    expect(
      repository.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "composite-custom" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "other" })),
          }),
          message: AnyMessages.pack(
            ProjectMilestoneAddedSchema,
            create(ProjectMilestoneAddedSchema, { id: idA, name: "Custom" }),
          ),
        }),
      ).entityIds,
    ).toEqual([idA, idB]);
    expect(
      repositoryAccess.routeStateUpdate(
        repository,
        createStateChangedEvent(
          "composite-custom-state",
          create(ProjectMilestoneSourceStateSchema, { id: idA, name: "State" }),
        ),
      )?.entityIds,
    ).toEqual([idA, idB]);
  });

  it("uses packed descriptor identity for generated composite ID clones", () => {
    const idA = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 1,
    });
    const idB = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 2,
    });
    new Repository({
      entityType: ProjectMilestoneProjection,
      schema: ProjectMilestoneOverviewStateSchema,
    });
    const spec = SpecScanner.scan(ProjectMilestoneProjection as never);
    const descriptor = entityStorageDescriptor({ name: "Composite", multitenant: false }, spec);

    expect(descriptor.id.key(idA)).toBe(descriptor.id.key(clone(ProjectMilestoneIdSchema, idA)));
    expect(descriptor.id.key(idA)).not.toBe(descriptor.id.key(idB));
  });

  it("uses an exact Command route instead of the declaration-first field", () => {
    const repository = createRoutingRepository(
      CommandRouting.create<string>().route(CreateProjectSchema, () => "custom-task"),
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
        .route(CreateProjectSchema, () => "exact")
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
    const token = MessageInterfaces.define<object, readonly [typeof CreateProjectSchema]>([
      CreateProjectSchema,
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
          .route(CreateProjectSchema, () => "exact"),
      ).routeCommand(createAggregateCommand("command-interface-exact", "field")).entityId,
    ).toBe("exact");
  });

  it("rejects a Command interface token with an unregistered member at construction", () => {
    const token = MessageInterfaces.define<
      object,
      readonly [typeof CreateProjectSchema, typeof CreateProjectSubmissionSchema]
    >([CreateProjectSchema, CreateProjectSubmissionSchema]);

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
        CommandRouting.create<string>().route(CreateProjectSubmissionSchema, () => "target"),
      ),
    ).toThrow(/unregistered exact route/);
  });

  it("rejects missing and incompatible custom Command route results", () => {
    expect(() =>
      createRoutingRepository(
        CommandRouting.create<string>().route(CreateProjectSchema, () => "   "),
      ).routeCommand(createAggregateCommand("command-blank-custom", "first")),
    ).toThrow(/ID compatible with the Entity state/);
    expect(() =>
      createRoutingRepository(
        CommandRouting.create<string>().route(CreateProjectSchema, () => 42 as never),
      ).routeCommand(createAggregateCommand("command-number-custom", "first")),
    ).toThrow(/ID compatible with the Entity state/);
    expect(() =>
      createInt32RoutingRepository(
        CommandRouting.create<number>().route(CreateNumberedProjectSchema, () => 2 ** 31),
      ).routeCommand(
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: "command-range-custom" }),
          context: create(CommandContextSchema),
          message: AnyMessages.pack(
            CreateNumberedProjectSchema,
            create(CreateNumberedProjectSchema, { id: 1, name: "Range" }),
          ),
        }),
      ),
    ).toThrow(/ID compatible with the Entity state/);
  });

  it("rejects a non-message custom Command ID before dispatch", () => {
    const repository = createProjectIdProducingRepository(
      CommandRouting.create<TaskId>().route(CreateTaskSchema, () => undefined as never),
    );

    expect(() =>
      repository.routeCommand(createCreateProject("command-missing-message-id", "task")),
    ).toThrow(`Repository command routing requires a "${TaskIdSchema.typeName}" ID.`);
  });

  it("rejects a validation-invalid custom message Command ID before durable dispatch", async () => {
    ProjectSubmissionIdRouteAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Project submission ID")
      .add(
        createProjectSubmissionIdRouteRepository(
          CommandRouting.create<ProjectSubmissionId>().route(CreateProjectSubmissionSchema, () =>
            create(ProjectSubmissionIdSchema, { value: "" }),
          ),
        ),
      )
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore(
      { name: "Project submission ID", multitenant: false },
      factory,
    );
    try {
      await expect(
        context
          .commandBus()
          .post(createValidatedCommand("command-invalid-route-id", "task", "Valid")),
      ).rejects.toThrow(/valid.*ID/i);

      expect(ProjectSubmissionIdRouteAggregate.calls).toBe(0);
      await expect(eventStore.read()).resolves.toEqual([]);
    } finally {
      await context.close();
    }
  });

  it("supplies a default Command context to custom routing", () => {
    let observed: CommandContext | undefined;
    const repository = createCreateProjectRoutingRepository(
      CommandRouting.create<string>().route(CreateProjectSchema, (message, context) => {
        observed = context;
        return message.id;
      }),
    );

    repository.routeCommand(
      createContextlessGeneratedCreateProject("command-context-route", "task"),
    );

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
    const repeated = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "command-repeated-id" }),
      context: create(CommandContextSchema),
      message: AnyMessages.pack(
        InviteProjectMembersSchema,
        create(InviteProjectMembersSchema, { id: ["one"] }),
      ),
    });
    const mapped = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "command-map-id" }),
      context: create(CommandContextSchema),
      message: AnyMessages.pack(
        AssignProjectAttributesSchema,
        create(AssignProjectAttributesSchema, { id: { one: "one" } }),
      ),
    });

    expect(() => repository.routeCommand(repeated)).toThrow(/singular non-map first field/);
    expect(() => repository.routeCommand(mapped)).toThrow(/singular non-map first field/);
  });

  it("rejects a default-valued declaration-first numeric Command ID", () => {
    const repository = createInt32RoutingRepository();
    const command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "command-default-int32" }),
      context: create(CommandContextSchema),
      message: AnyMessages.pack(
        CreateNumberedProjectSchema,
        create(CreateNumberedProjectSchema, { id: 0, name: "Default" }),
      ),
    });

    expect(() => repository.routeCommand(command)).toThrow(/non-default first field/);
  });

  it("prefers a compatible producer ID and falls back for an incompatible producer type", async () => {
    const repository = createRoutingRepository();

    const producerRoute = repository.routeEvent(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "event-1" }),
        context: create(EventContextSchema, {
          producerId: Identifiers.pack("string", "producer-task"),
          version: create(VersionSchema, { number: 1 }),
        }),
        message: AnyMessages.pack(
          ProjectCreatedSchema,
          create(ProjectCreatedSchema, {
            id: "field-task",
            name: "Task",
            priority: 1,
          }),
        ),
      }),
    );
    const firstFieldRoute = repository.routeEvent(
      createProjectCreated("event-2", "field-task", { producerId: "other-kind" }),
    );

    expect(producerRoute).toMatchObject({
      entityIds: ["producer-task"],
      messageFullTypeName: ProjectCreatedSchema.typeName,
      invocation: "deferred",
    });
    expectTypeOf(producerRoute.entityIds).toEqualTypeOf<readonly string[]>();
    expect(firstFieldRoute.entityIds).toEqual(["field-task"]);

    const context = BoundedContext.singleTenant("Tasks").add(repository).build();

    await expect(
      context.eventBus().post(createProjectCreated("event-3", "posted-task")),
    ).resolves.toBeUndefined();
  });

  it("uses one immutable stable-deduplicated custom Event target plan", () => {
    const returned = ["target-b", "target-a", "target-b"];
    const routing = EventRouting.create<string>().route(ProjectCreatedSchema, () => returned);
    const repository = createRoutingRepository(undefined, routing);

    const route = repository.routeEvent(createProjectCreated("event-custom-targets", "ignored"));
    returned[0] = "mutated";

    expect(route.entityIds).toEqual(["target-b", "target-a"]);
    expect(Object.isFrozen(route.entityIds)).toBe(true);
  });

  it("deduplicates and replays a message target containing an int64 value", async () => {
    SequencedProjectOverview.calls = 0;
    let routeCalls = 0;
    const eventRouting = EventRouting.create<ProjectSequenceId>().route(
      SequencedProjectOverviewCreatedSchema,
      (message) => {
        routeCalls += 1;
        if (message.id === undefined) throw new Error("Expected an int64 message ID.");
        return [message.id, clone(ProjectSequenceIdSchema, message.id)];
      },
    );
    const factory = new InMemoryStorageFactory();
    const repository = createSequencedProjectOverviewRepository(eventRouting);
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const id = create(ProjectSequenceIdSchema, { value: 42n });
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "event-int64-message-id" }),
      context: create(EventContextSchema),
      message: AnyMessages.pack(
        SequencedProjectOverviewCreatedSchema,
        create(SequencedProjectOverviewCreatedSchema, { id, name: "Int64 ID" }),
      ),
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
      expect(SequencedProjectOverview.calls).toBe(2);
    } finally {
      await context.close();
    }
  });

  it("hands off, replays, and rehydrates composite Process Manager IDs without rerouting", async () => {
    ProjectMilestoneProcessManager.reset();
    let routeCalls = 0;
    const routing = EventRouting.create<ProjectMilestoneId>().route(
      ProjectMilestoneAddedSchema,
      (message) => {
        routeCalls += 1;
        if (message.id === undefined) throw new Error("Expected a composite route ID.");
        return [message.id];
      },
    );
    const factory = new InMemoryStorageFactory();
    const repository = createProjectMilestoneProcessManagerRepository(routing);
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const idA = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 1,
    });
    const idB = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "reader" }),
      number: 2,
    });
    const eventA = create(EventSchema, {
      id: create(EventIdSchema, { value: "event-composite-inbox-a" }),
      context: create(EventContextSchema),
      message: AnyMessages.pack(
        ProjectMilestoneAddedSchema,
        create(ProjectMilestoneAddedSchema, { id: idA, name: "A delivered" }),
      ),
    });
    const eventB = create(EventSchema, {
      id: create(EventIdSchema, { value: "event-composite-inbox-b" }),
      context: create(EventContextSchema),
      message: AnyMessages.pack(
        ProjectMilestoneAddedSchema,
        create(ProjectMilestoneAddedSchema, { id: idB, name: "B delivered" }),
      ),
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

      expect(Identifiers.unpack(ProjectMilestoneIdSchema, rowA.inboxId.targetId)).toEqual(idA);
      expect(Identifiers.unpack(ProjectMilestoneIdSchema, rowB.inboxId.targetId)).toEqual(idB);
      expect(routeCalls).toBe(2);

      const target = requireEntityInboxTarget(repository);
      await target.replay(rowA);
      await target.replay(rowB);

      expect(routeCalls).toBe(2);
      expect(ProjectMilestoneProcessManager.ids).toEqual([idA, idB, idA, idB]);
      await expect(context.stand().read(ProjectMilestoneWorkflowStateSchema, idA)).resolves.toEqual(
        create(ProjectMilestoneWorkflowStateSchema, { id: idA, queue: "A delivered" }),
      );
      await expect(context.stand().read(ProjectMilestoneWorkflowStateSchema, idB)).resolves.toEqual(
        create(ProjectMilestoneWorkflowStateSchema, { id: idB, queue: "B delivered" }),
      );
    } finally {
      await context.close();
    }

    const rehydrated = BoundedContext.singleTenant("Tasks")
      .add(createProjectMilestoneProcessManagerRepository(routing))
      .withStorageFactory(factory)
      .build();
    try {
      await expect(
        rehydrated.stand().read(ProjectMilestoneWorkflowStateSchema, idA),
      ).resolves.toMatchObject({ id: idA, queue: "A delivered" });
      await expect(
        rehydrated.stand().read(ProjectMilestoneWorkflowStateSchema, idB),
      ).resolves.toMatchObject({ id: idB, queue: "B delivered" });
    } finally {
      await rehydrated.close();
    }
  });

  it("packs the complete composite Process Manager ID into produced event context", async () => {
    const factory = new InMemoryStorageFactory();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProjectMilestoneProcessManagerRepository(undefined, { produces: true }))
      .withStorageFactory(factory)
      .build();
    const id = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "producer" }),
      number: 7,
    });
    const command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "command-composite-producer" }),
      context: create(CommandContextSchema),
      message: AnyMessages.pack(
        AddProjectMilestoneSchema,
        create(AddProjectMilestoneSchema, { id, name: "Produce" }),
      ),
    });
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    try {
      await context.commandBus().post(command);

      const [produced] = await waitForStoredEvents(eventStore, 1);
      expect(
        AnyMessages.unpack(produced?.context?.producerId as never, ProjectMilestoneIdSchema),
      ).toEqual(id);
    } finally {
      await context.close();
    }
  });

  it("rejects malformed composite Entity Inbox targets before invoking the Process Manager", async () => {
    ProjectMilestoneProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createProjectMilestoneProcessManagerRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "event-composite-inbox-invalid" }),
      context: create(EventContextSchema),
      message: AnyMessages.pack(
        ProjectMilestoneAddedSchema,
        create(ProjectMilestoneAddedSchema, {
          id: create(ProjectMilestoneIdSchema, {
            reader: create(UserIdSchema, { value: "valid" }),
            number: 3,
          }),
          name: "Invalid target",
        }),
      ),
    });

    try {
      const wrongType = await storePmInboxEvent(
        delivery,
        event,
        new Date("2026-09-03T10:00:00.000Z"),
        1n,
        {
          packedTargetId: Identifiers.pack(UserIdSchema, create(UserIdSchema, { value: "wrong" })),
          targetTypeUrl: TypeUrls.derive(ProjectMilestoneWorkflowStateSchema),
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
            typeUrl: TypeUrls.derive(ProjectMilestoneIdSchema),
            value: new Uint8Array([0xff]),
          }),
          targetTypeUrl: TypeUrls.derive(ProjectMilestoneWorkflowStateSchema),
        },
      );
      const target = requireEntityInboxTarget(repository);

      await expect(target.replay(wrongType)).rejects.toThrow(/target ID is incompatible/);
      await expect(target.replay(malformed)).rejects.toThrow(/target ID is incompatible/);
      expect(ProjectMilestoneProcessManager.calls).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("guards multi-target composite Process Manager delivery by complete ID", async () => {
    ProjectMilestoneProcessManager.reset();
    let routeCalls = 0;
    const idA = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "guarded" }),
      number: 1,
    });
    const idB = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "guarded" }),
      number: 2,
    });
    const repository = createProjectMilestoneProcessManagerRepository(
      EventRouting.create<ProjectMilestoneId>().route(ProjectMilestoneAddedSchema, () => {
        routeCalls += 1;
        return [idA, clone(ProjectMilestoneIdSchema, idA), idB];
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
    const duplicate = create(EventSchema, {
      id: create(EventIdSchema, { value: "event-composite-guarded" }),
      context: create(EventContextSchema, {
        producerId: Identifiers.pack(ProjectMilestoneIdSchema, idA),
        version: create(VersionSchema, { number: 1 }),
        timestamp: create(TimestampSchema, { seconds: 1n }),
      }),
      message: AnyMessages.pack(
        ProjectMilestoneAddedSchema,
        create(ProjectMilestoneAddedSchema, { id: idA, name: "Guarded" }),
      ),
    });
    const distinct = create(EventSchema, {
      id: create(EventIdSchema, { value: "event-composite-guarded-distinct" }),
      context: create(EventContextSchema, {
        producerId: Identifiers.pack(ProjectMilestoneIdSchema, idA),
        version: create(VersionSchema, { number: 2 }),
        timestamp: create(TimestampSchema, { seconds: 2n }),
      }),
      message: AnyMessages.pack(
        ProjectMilestoneAddedSchema,
        create(ProjectMilestoneAddedSchema, { id: idA, name: "Distinct" }),
      ),
    });

    try {
      await dispatcher.dispatch(duplicate);
      await dispatcher.dispatch(duplicate);
      await dispatcher.dispatch(distinct);

      expect(routeCalls).toBe(3);
      expect(ProjectMilestoneProcessManager.ids).toEqual([idA, idB, idA, idB]);
    } finally {
      await context.close();
    }
  });

  it("applies exact Event routes before replacement defaults", () => {
    const exact = createRoutingRepository(
      undefined,
      EventRouting.create<string>()
        .route(ProjectCreatedSchema, () => ["exact"])
        .replaceDefault(() => ["replacement"]),
    );
    const replacement = createRoutingRepository(
      undefined,
      EventRouting.create<string>().replaceDefault(() => ["replacement"]),
    );
    const event = createProjectCreated("event-precedence", "declaration");

    expect(exact.routeEvent(event).entityIds).toEqual(["exact"]);
    expect(replacement.routeEvent(event).entityIds).toEqual(["replacement"]);
  });

  it("selects an Event interface route after exact routes and before the default", () => {
    const token = MessageInterfaces.define<object, readonly [typeof ProjectCreatedSchema]>([
      ProjectCreatedSchema,
    ]);
    const repository = createRoutingRepository(
      undefined,
      EventRouting.create<string>()
        .route(token, () => ["interface"])
        .replaceDefault(() => ["default"]),
    );

    expect(
      repository.routeEvent(createProjectCreated("event-interface", "field")).entityIds,
    ).toEqual(["interface"]);
    expect(
      createRoutingRepository(
        undefined,
        EventRouting.create<string>()
          .route(token, () => ["interface"])
          .route(ProjectCreatedSchema, () => ["exact"]),
      ).routeEvent(createProjectCreated("event-interface-exact", "field")).entityIds,
    ).toEqual(["exact"]);
  });

  it("keeps the Event routing snapshot captured by repository construction", () => {
    const routing = EventRouting.create<string>().replaceDefault(() => ["first"]);
    const repository = createRoutingRepository(undefined, routing);
    routing.replaceDefault(() => ["second"]);

    expect(
      repository.routeEvent(createProjectCreated("event-snapshot", "field")).entityIds,
    ).toEqual(["first"]);
  });

  it("accepts an empty custom Event target plan", () => {
    const repository = createRoutingRepository(
      undefined,
      EventRouting.create<string>().route(ProjectCreatedSchema, () => []),
    );

    expect(
      repository.routeEvent(createProjectCreated("event-no-targets", "ignored")).entityIds,
    ).toEqual([]);
  });

  it("suppresses Projection delivery when custom Event routing returns no targets", async () => {
    ExecutingTaskProjection.reset();
    let routeCalls = 0;
    const repository = createExecutingProjectionRepository(
      EventRouting.create<string>().route(ProjectCreatedSchema, () => {
        routeCalls += 1;
        return [];
      }),
    );
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();

    try {
      await context.eventBus().post(createProjectCreated("event-no-delivery", "ignored"));

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
      EventRouting.create<string>().route(ProjectCreatedSchema, () => {
        routeCalls += 1;
        return ["aggregate-one", "aggregate-two"];
      }),
    );
    const context = BoundedContext.singleTenant("Tasks").add(repository).build();

    try {
      await context.eventBus().post(createProjectCreated("event-aggregate-many", "ignored"));

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
      EventRouting.create<string>().route(ProjectCreatedSchema, () => ["valid", "  "]),
    );
    const overflow = createRoutingRepository(
      undefined,
      EventRouting.create<string>().route(ProjectCreatedSchema, () =>
        Array.from({ length: 1_001 }, (_, index) => `target-${String(index)}`),
      ),
    );
    const notAnArray = createRoutingRepository(
      undefined,
      EventRouting.create<string>().route(ProjectCreatedSchema, () => "target" as never),
    );

    expect(() =>
      invalid.routeEvent(createProjectCreated("event-invalid-targets", "ignored")),
    ).toThrow(/compatible with the Entity state/);
    expect(() =>
      overflow.routeEvent(createProjectCreated("event-overflow-targets", "ignored")),
    ).toThrow(/at most 1,000/);
    expect(() =>
      notAnArray.routeEvent(createProjectCreated("event-non-array-targets", "ignored")),
    ).toThrow(/array of Entity IDs/);
  });

  it("uses a compatible producer without requiring first-field equality", () => {
    const repository = createRoutingRepository();
    const event = create(EventSchema, {
      id: create(EventIdSchema, { value: "event-primitive-unknown" }),
      context: create(EventContextSchema, {
        producerId: AnyMessages.pack(
          StringValueSchema,
          create(StringValueSchema, { value: "Unknown" }),
        ),
        rejection: {},
      }),
      message: AnyMessages.pack(
        ProjectCreatedSchema,
        create(ProjectCreatedSchema, {
          id: "mismatched-task",
        }),
      ),
    });

    expect(repository.routeEvent(event).entityIds).toEqual(["Unknown"]);
  });

  it("routes canonical zero-valued int32 and int64 producer IDs", () => {
    const int32 = createInt32RoutingRepository();
    const int64 = createInt64RoutingRepository();

    expect(
      int32.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-int32-producer" }),
          context: create(EventContextSchema, { producerId: Identifiers.pack("int32", 0) }),
          message: AnyMessages.pack(
            NumberedProjectCreatedSchema,
            create(NumberedProjectCreatedSchema, { id: 42, name: "Int32" }),
          ),
        }),
      ).entityIds,
    ).toEqual([0]);
    expect(
      int64.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-int64-producer" }),
          context: create(EventContextSchema, { producerId: Identifiers.pack("int64", 0n) }),
          message: AnyMessages.pack(
            ProjectWorkflowScheduledSchema,
            create(ProjectWorkflowScheduledSchema, { id: 42n, queue: "Int64" }),
          ),
        }),
      ).entityIds,
    ).toEqual([0n]);
  });

  it("routes a primitive first field from a message signal to a primitive Entity target", () => {
    const repository = createUserIdProjectionRepository();
    const route = repository.routeEvent(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "event-user-id" }),
        context: create(EventContextSchema, {
          producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "producer" })),
          version: create(VersionSchema, { number: 1 }),
        }),
        message: AnyMessages.pack(
          ProjectCreatedSchema,
          create(ProjectCreatedSchema, { id: "user-id-task", name: "User route", priority: 1 }),
        ),
      }),
    );

    expect(route).toMatchObject({
      entityIds: ["user-id-task"],
      messageFullTypeName: ProjectCreatedSchema.typeName,
      invocation: "deferred",
    });
  });

  it("rejects a generated TaskId for a primitive Entity target without a custom route", () => {
    const repository = createTaskCreatedScalarProjectionRepository();
    const id = create(TaskIdSchema, { value: "implicit-scalar-task" });

    expect(() =>
      repository.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-implicit-scalar-task" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "producer" })),
            version: create(VersionSchema, { number: 1 }),
          }),
          message: AnyMessages.pack(
            TaskCreatedSchema,
            create(TaskCreatedSchema, {
              id,
              taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
              title: "Implicit scalar task",
            }),
          ),
        }),
      ),
    ).toThrow(/compatible with the Entity state/);
  });

  it("routes a generated TaskId to a primitive Entity target through an explicit custom route", () => {
    const repository = createCreateTaskScalarAggregateRepository(
      CommandRouting.create<string>().route(CreateTaskSchema, (message) => {
        if (message.id === undefined) throw new Error("Expected a Task ID.");
        return message.id.value;
      }),
    );
    const id = create(TaskIdSchema, { value: "explicit-scalar-task" });

    expect(
      repository.routeCommand(
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: "command-explicit-scalar-task" }),
          context: create(CommandContextSchema),
          message: AnyMessages.pack(
            CreateTaskSchema,
            create(CreateTaskSchema, {
              id,
              taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
              title: "Explicit scalar task",
            }),
          ),
        }),
      ).entityId,
    ).toBe(id.value);
  });

  it("routes message-valued event IDs as messages when the entity ID field is a message", () => {
    const repository = createProjectIdTaskRepository();
    const taskId = create(TaskIdSchema, { value: "message-id-task" });
    const route = repository.routeEvent(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "event-message-id-task" }),
        context: create(EventContextSchema, {
          producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "producer" })),
          version: create(VersionSchema, { number: 1 }),
        }),
        message: AnyMessages.pack(
          TaskCreatedSchema,
          create(TaskCreatedSchema, {
            id: taskId,
            taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
            title: "Message ID task",
          }),
        ),
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
    const repository = createProjectIdTaskRepository();
    const taskId = create(TaskIdSchema, { value: "message-producer-task" });
    const route = repository.routeEvent(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "event-message-producer-task" }),
        context: create(EventContextSchema, {
          producerId: AnyMessages.pack(TaskIdSchema, taskId),
          version: create(VersionSchema, { number: 1 }),
        }),
        message: AnyMessages.pack(
          TaskCreatedSchema,
          create(TaskCreatedSchema, {
            id: taskId,
            taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
            title: "Message producer task",
          }),
        ),
      }),
    );

    expect(route.entityIds).toEqual([taskId]);
  });

  it("uses a compatible message-valued producer even when the first field differs", () => {
    const repository = createProjectIdTaskRepository();
    const targetId = create(TaskIdSchema, { value: "message-target-task" });
    const producerId = create(TaskIdSchema, { value: "different-message-producer" });

    expect(
      repository.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-message-producer-mismatch" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(TaskIdSchema, producerId),
            version: create(VersionSchema, { number: 1 }),
          }),
          message: AnyMessages.pack(
            TaskCreatedSchema,
            create(TaskCreatedSchema, {
              id: targetId,
              taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
              title: "Mismatched message producer task",
            }),
          ),
        }),
      ).entityIds,
    ).toEqual([producerId]);
  });

  it("rejects a malformed producer that claims a compatible message ID type", () => {
    const repository = createProjectIdTaskRepository();

    expect(() =>
      repository.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-malformed-message-producer" }),
          context: create(EventContextSchema, {
            producerId: create(AnySchema, {
              typeUrl: TypeUrls.derive(TaskIdSchema),
              value: new Uint8Array([255]),
            }),
          }),
          message: AnyMessages.pack(
            TaskCreatedSchema,
            create(TaskCreatedSchema, {
              id: create(TaskIdSchema, { value: "first-field-task" }),
              taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
              title: "Malformed producer",
            }),
          ),
        }),
      ),
    ).toThrow(/readable compatible producer ID/);
  });

  it("rejects an incompatible message producer for a scalar Entity target", () => {
    const repository = createTaskCreatedScalarProjectionRepository();
    const targetId = create(TaskIdSchema, { value: "scalar-target" });

    expect(() =>
      repository.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-scalar-producer-mismatch" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(
              TaskIdSchema,
              create(TaskIdSchema, { value: "different-scalar-producer" }),
            ),
            version: create(VersionSchema, { number: 1 }),
          }),
          message: AnyMessages.pack(
            TaskCreatedSchema,
            create(TaskCreatedSchema, {
              id: targetId,
              taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
              title: "Mismatched scalar producer task",
            }),
          ),
        }),
      ),
    ).toThrow(/compatible with the Entity state/);
  });

  it("rejects a matching message producer for a scalar Entity target", () => {
    const repository = createTaskCreatedScalarProjectionRepository();
    const id = create(TaskIdSchema, { value: "matching-scalar-target" });

    expect(() =>
      repository.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-scalar-producer-match" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(TaskIdSchema, id),
            version: create(VersionSchema, { number: 1 }),
          }),
          message: AnyMessages.pack(
            TaskCreatedSchema,
            create(TaskCreatedSchema, {
              id,
              taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
              title: "Matching scalar producer task",
            }),
          ),
        }),
      ),
    ).toThrow(/compatible with the Entity state/);
  });

  it("rejects message-valued event IDs with the wrong message type", () => {
    const repository = createProjectIdTaskRepository();

    expect(() =>
      repository.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-wrong-message-id-type" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "producer" })),
            version: create(VersionSchema, { number: 1 }),
          }),
          message: AnyMessages.pack(
            ProjectMemberChangedSchema,
            create(ProjectMemberChangedSchema, {
              id: create(UserIdSchema, { value: "message-id-task" }),
            }),
          ),
        }),
      ),
    ).toThrow(/TaskId/);
  });

  it("routes direct repository dispatchers without a bound runtime", async () => {
    ExecutingProjectAggregate.reset();
    ExecutingTaskProjection.reset();
    const aggregate = createExecutingRepository();
    const projection = createExecutingProjectionRepository();
    const commandDispatcher = repositoryAccess.commandDispatcher(aggregate);
    const eventDispatcher = repositoryAccess.eventDispatcher(projection);

    if (commandDispatcher === undefined || eventDispatcher === undefined) {
      throw new Error("Expected repository dispatchers.");
    }

    await commandDispatcher.dispatch(createAggregateCommand("command-direct", "task-direct"));
    await eventDispatcher.dispatch(createProjectCreated("event-direct", "task-direct"));

    expect(ExecutingProjectAggregate.assigneeCalls).toBe(0);
    expect(ExecutingTaskProjection.subscriberCalls).toBe(0);
  });

  it("executes process-manager command handlers and stores mutated state in Stand", async () => {
    RoutingProcessManager.reset();
    const observed: SpineEvent[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [ProjectCreatedSchema],
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
    await expect(context.stand().read(ProjectQueueStateSchema, "pm-task")).resolves.toEqual(
      create(ProjectQueueStateSchema, {
        id: "pm-task",
        queue: "ProcessManager assigned",
      }),
    );
    await waitForCondition(() => observed.length === 1);
    expect(observed[0]?.id?.value).toMatch(/.+/);
    const producedMessage = observed[0]?.message;
    if (producedMessage === undefined) {
      throw new Error("Expected a process-manager produced event message.");
    }
    expect(AnyMessages.unpack(producedMessage, ProjectCreatedSchema)).toEqual(
      create(ProjectCreatedSchema, {
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
        receiver: { typeUrl: TypeUrls.derive(ProjectQueueStateSchema) },
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
        receiver: { typeUrl: TypeUrls.derive(ProjectStateSchema) },
        payload: command,
        entityType: { impl: { case: "javaClassName", value: "ExecutingProjectAggregate" } },
        whenDispatched: diagnostics[0]?.context?.timestamp,
      });
      expect(diagnostics[0]?.context?.origin).toMatchObject({
        case: "pastMessage",
        value: { message: { typeUrl: TypeUrls.derive(CreateProjectSchema) } },
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
      ExecutingProjectAggregate.reset(failure);
      await expect(context.commandBus().post(command)).resolves.toBeUndefined();
      await waitForCondition(() => diagnostics.length === 1);

      expect(ExecutingProjectAggregate.assigneeCalls).toBe(1);
      expect(diagnostics).toHaveLength(1);
      expect(
        AnyMessages.unpack(diagnostics[0]?.message as never, CommandDispatchedToHandlerSchema),
      ).toMatchObject({ payload: command });
    } finally {
      ExecutingProjectAggregate.reset();
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
        receiver: { typeUrl: TypeUrls.derive(ProjectQueueStateSchema) },
        entityType: { impl: { case: "javaClassName", value: "RoutingProcessManager" } },
      });
    } finally {
      await Promise.all([aggregate.close(), processManager.close()]);
    }
  });

  it("isolates command diagnostic publication failure from admitted handler work", async () => {
    ExecutingProjectAggregate.reset();
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

      expect(ExecutingProjectAggregate.assigneeCalls).toBe(1);
      await expect(context.stand().read(ProjectStateSchema, "failure-id")).resolves.toMatchObject({
        name: "Task (applied)",
      });
      expect(diagnostics).toHaveLength(1);
      expect("storedEventDispatchFailures" in context).toBe(false);
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
        messageSchemas: () => [ProjectCreatedSchema],
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
          targetTypeUrl: TypeUrls.derive(ProjectQueueStateSchema),
        },
      },
    ]);
    expect(RoutingProcessManager.commandCalls).toBe(1);
    await expect(context.stand().read(ProjectQueueStateSchema, "pm-inbox")).resolves.toEqual(
      create(ProjectQueueStateSchema, {
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
        : AnyMessages.unpack(storedEnvelope.message, CreateProjectSchema),
    ).toEqual(
      command.message === undefined
        ? undefined
        : AnyMessages.unpack(command.message, CreateProjectSchema),
    );
  });

  it("rejects a process-manager command with a missing domain ID before handler code", async () => {
    RoutingProcessManager.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .build();

    await expect(
      context.commandBus().post(createAggregateCommand("command-pm-missing-id", "")),
    ).rejects.toBeInstanceOf(CommandValidationError);
    expect(RoutingProcessManager.commandCalls).toBe(0);
    await expect(context.stand().read(ProjectQueueStateSchema, "")).resolves.toBeUndefined();
  });

  it("rejects idless process-manager commands before route, handler, or Stand write", async () => {
    RoutingProcessManager.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createIdlessCommandProcessManagerRepository())
      .build();

    await expect(
      context.commandBus().post(createIdlessAggregateCommand("pm-idless", "Idless")),
    ).rejects.toThrow("requires command.id");
    expect(RoutingProcessManager.commandCalls).toBe(0);
    await expect(
      context.stand().read(ProjectQueueStateSchema, "pm-idless"),
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
      context.stand().read(ProjectQueueStateSchema, "pm-blank-id"),
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
        .read(ProjectQueueStateSchema, "pm-tenant", { tenantId: createTenantId("tenant-a") }),
    ).resolves.toEqual(
      create(ProjectQueueStateSchema, {
        id: "pm-tenant",
        queue: "Tenant PM assigned",
      }),
    );
    await expect(
      context
        .stand()
        .read(ProjectQueueStateSchema, "pm-tenant", { tenantId: createTenantId("tenant-b") }),
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

    await expect(context.stand().read(ProjectQueueStateSchema, "pm-page-target")).resolves.toEqual(
      create(ProjectQueueStateSchema, {
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
    const token = MessageInterfaces.define<object, readonly [typeof CreateProjectSchema]>([
      CreateProjectSchema,
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
    const routing = CommandRouting.create<TaskId>().route(CreateTaskSchema, (message) => {
      routeCalls += 1;
      if (message.id === undefined) throw new Error("Expected a Task ID.");
      return message.id;
    });
    const factory = new InMemoryStorageFactory();
    const repository = createProjectIdProducingRepository(routing);
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
      const command = createCreateProject("command-message-count", "message-count", "Counted");
      await context.commandBus().post(command);
      await expect(
        context.stand().read(TaskSchema, create(TaskIdSchema, { value: "message-count" })),
      ).resolves.toBeDefined();
      expect(routeCalls).toBe(1);
      const replayCommand = createCreateProject(
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

  it("hands off and replays a composite Command target without rerouting", async () => {
    const id = create(ProjectMilestoneIdSchema, {
      reader: create(UserIdSchema, { value: "command-reader" }),
      number: 42,
    });
    let routeCalls = 0;
    const commandRouting = CommandRouting.create<ProjectMilestoneId>().route(
      AddProjectMilestoneSchema,
      (message) => {
        routeCalls += 1;
        if (message.id === undefined) throw new Error("Expected a composite Command ID.");
        return message.id;
      },
    );
    const factory = new InMemoryStorageFactory();
    const repository = createProjectMilestoneProcessManagerRepository(
      undefined,
      { produces: true },
      commandRouting,
    );
    const context = BoundedContext.singleTenant("Composite command")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "command-composite-handoff" }),
      context: create(CommandContextSchema),
      message: AnyMessages.pack(
        AddProjectMilestoneSchema,
        create(AddProjectMilestoneSchema, { id, name: "Composite command" }),
      ),
    });
    try {
      await context.commandBus().post(command);

      const delivery = new Delivery({
        context: { name: "Composite command", multitenant: false },
        storageFactory: factory,
      });
      const rows = await delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] });
      const stored = rows.find((row) => row.signalId === "command-composite-handoff");
      if (stored === undefined)
        throw new Error("Expected a delivered composite Command inbox row.");

      expect(stored.inboxId.targetTypeUrl).toBe(
        TypeUrls.derive(ProjectMilestoneWorkflowStateSchema),
      );
      expect(stored.inboxId.targetId).toEqual(Identifiers.pack(ProjectMilestoneIdSchema, id));
      expect(routeCalls).toBe(1);

      await expect(requireEntityInboxTarget(repository).replay(stored)).resolves.toBeUndefined();

      expect(routeCalls).toBe(1);
      await expect(context.stand().read(ProjectMilestoneWorkflowStateSchema, id)).resolves.toEqual(
        create(ProjectMilestoneWorkflowStateSchema, { id, queue: "Composite command" }),
      );
    } finally {
      await context.close();
    }
  });

  it("rejects an empty implicit Command ID during durable Aggregate replay", async () => {
    DraftProjectAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createDraftProjectAggregateRepository();
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
        createDraftProject("implicit-replay", ""),
        new Date("2026-08-11T10:00:00.000Z"),
        1n,
        {
          targetId: Identifiers.pack("string", "target"),
          targetTypeUrl: TypeUrls.derive(ProjectStateSchema),
        },
      );

      await expect(requireEntityInboxTarget(repository).replay(received)).rejects.toBeInstanceOf(
        CommandValidationError,
      );
      expect(DraftProjectAggregate.calls).toBe(0);
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
        projection.eventBus().post(createProjectCreated("blank-projection", "projection-id")),
      ).resolves.toBeUndefined();

      expect(BlankStateIdAggregate.calls).toBe(1);
      expect(BlankStateIdProcessManager.calls).toBe(1);
      expect(BlankStateIdProjection.calls).toBe(1);
      await expect(
        aggregate.stand().read(ProjectStateSchema, "aggregate-id"),
      ).resolves.toBeUndefined();
      await expect(
        processManager.stand().read(ProjectQueueStateSchema, "pm-id"),
      ).resolves.toBeUndefined();
      await expect(
        projection.stand().read(ProjectOverviewStateSchema, "projection-id"),
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
    const int32Command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "command-numeric-int32" }),
      context: create(CommandContextSchema),
      message: AnyMessages.pack(
        CreateNumberedProjectSchema,
        create(CreateNumberedProjectSchema, { id: 42, name: "Int32" }),
      ),
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
        targetTypeUrl: TypeUrls.derive(NumberedProjectStateSchema),
      },
    );

    expect(int32Repository.routeCommand(int32Command).entityId).toBe(42);
    await expect(
      requireEntityInboxTarget(int32Repository).replay(int32Message),
    ).resolves.toBeTypeOf("function");

    const int64Factory = new InMemoryStorageFactory();
    const int64Repository = createInt64RoutingRepository();
    BoundedContext.singleTenant("Numeric int64")
      .add(int64Repository)
      .withStorageFactory(int64Factory)
      .build();
    const int64Command = create(CommandSchema, {
      id: create(CommandIdSchema, { uuid: "command-numeric-int64" }),
      context: create(CommandContextSchema),
      message: AnyMessages.pack(
        ScheduleProjectWorkflowSchema,
        create(ScheduleProjectWorkflowSchema, { id: 42n, queue: "Int64" }),
      ),
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
        targetTypeUrl: TypeUrls.derive(ProjectWorkflowStateSchema),
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
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: "command-int32-producer" }),
          context: create(CommandContextSchema),
          message: AnyMessages.pack(
            CreateNumberedProjectSchema,
            create(CreateNumberedProjectSchema, { id: 42, name: "Int32" }),
          ),
        }),
      );
      await int64Context.commandBus().post(
        create(CommandSchema, {
          id: create(CommandIdSchema, { uuid: "command-int64-producer" }),
          context: create(CommandContextSchema),
          message: AnyMessages.pack(
            ScheduleProjectWorkflowSchema,
            create(ScheduleProjectWorkflowSchema, { id: 42n, queue: "Int64" }),
          ),
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
          targetTypeUrl: TypeUrls.derive(ProjectQueueStateSchema),
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
        targetTypeUrl: TypeUrls.derive(ProjectQueueStateSchema),
      },
    );

    await expect(target.replay(received)).rejects.toThrow(/validation/i);

    expect(ValidatingProcessManager.commandCalls).toBe(0);
  });

  it("rejects idless Entity Inbox replay before handler or Stand write", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createIdlessCommandProcessManagerRepository();
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
      context.stand().read(ProjectQueueStateSchema, "pm-idless-replay"),
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
      context.stand().read(ProjectQueueStateSchema, "pm-blank-replay"),
    ).resolves.toBeUndefined();
  });

  it("appends process-manager command-produced events and records later dispatch failures", async () => {
    RoutingProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const dispatchAttempted = createSignal();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerAssignRepository())
      .addEventDispatcher({
        messageSchemas: () => [ProjectCreatedSchema],
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
    await expect(context.stand().read(ProjectQueueStateSchema, "pm-dispatch")).resolves.toEqual(
      create(ProjectQueueStateSchema, {
        id: "pm-dispatch",
        queue: "Task assigned",
      }),
    );
    const stored = await eventStore.read();

    expect(stored).toHaveLength(1);
    expect(stored[0]?.id?.value).toMatch(UUID_PATTERN);
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
          typeUrl: TypeUrls.derive(CreateProjectSchema),
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
    expect("storedEventDispatchFailures" in context).toBe(false);
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
      .readVersioned(ProjectQueueStateSchema, "pm-rejected");
    const eventsBeforeRejection = await eventStore.read();

    expect(stateBeforeRejection).toEqual({
      state: create(ProjectQueueStateSchema, {
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
      context.stand().readVersioned(ProjectQueueStateSchema, "pm-rejected"),
    ).resolves.toEqual(stateBeforeRejection);
    const storedEvents = await waitForStoredEvents(eventStore, 2);
    const rejectionEvents = storedEvents.filter((event) => event.context?.rejection !== undefined);
    const [event] = rejectionEvents;

    expect(storedEvents).toHaveLength(eventsBeforeRejection.length + 1);
    expect(rejectionEvents).toHaveLength(1);
    expect(event).toMatchObject({
      context: {
        rejection: {
          command: { id: { uuid: "command-pm-rejected" } },
        },
      },
    });
    expect(event?.id?.value).toMatch(UUID_PATTERN);
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
      context.stand().read(ProjectQueueStateSchema, "pm-technical"),
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
        targetTypeUrl: TypeUrls.derive(ProjectQueueStateSchema),
      },
      signalId: "event-older",
      signal: AnyMessages.pack(EventSchema, createProjectCreated("event-older", "pm-older"), {
        validate: false,
      }),
      label: "REACT_UPON_EVENT",
      status: "TO_DELIVER",
      shard: ShardIndex.single(),
      whenReceived: new Date("2026-07-08T09:00:00.000Z"),
      version: 1n,
    });

    await context.eventBus().post(createProjectCreated("event-pm-inbox-first", "pm-inbox-first"));

    expect(InboxCheckingProcessManager.eventCalls).toBe(2);
    expect(InboxCheckingProcessManager.sawPendingRow).toBe(true);
    await expect(context.stand().read(ProjectQueueStateSchema, "pm-inbox-first")).resolves.toEqual(
      create(ProjectQueueStateSchema, {
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
    const event = createProjectCreated("event-pm-duplicate", "pm-duplicate");
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
    await expect(context.stand().read(ProjectQueueStateSchema, "pm-duplicate")).resolves.toEqual(
      create(ProjectQueueStateSchema, {
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

    const posted = dispatcher.dispatch(createProjectCreated("event-pm-split", "pm-source"));

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
    expect(failed?.inboxId.targetTypeUrl).toBe(TypeUrls.derive(ProjectQueueStateSchema));
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
    expect(later?.inboxId.targetTypeUrl).toBe(TypeUrls.derive(ProjectQueueStateSchema));
  });

  it("guards each target of a multi-target Process Manager route independently", async () => {
    SplitRouteProcessManager.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createGuardedSplitPmRepo(
      EventRouting.create<string>().route(ProjectCreatedSchema, () => ["pm-one", "pm-two"]),
    );
    BoundedContext.singleTenant("Tasks").add(repository).withStorageFactory(factory).build();
    const dispatcher = repositoryAccess.eventDispatcher(repository);
    if (dispatcher === undefined) throw new Error("Expected a process-manager event dispatcher.");

    const event = createProjectCreated("event-pm-guarded-many", "pm-source");
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

    const event = createProjectCreated("event-aggregate-guarded-many", "aggregate-source");
    await dispatcher.dispatch(event);
    await dispatcher.dispatch(
      createProjectCreated("event-aggregate-guarded-other", "aggregate-other"),
    );
    await dispatcher.dispatch(event);

    expect(GuardedAggregate.calls).toBe(5);
    await context.close();
  });

  it("does not use durable markers to replay a multi-target producing Aggregate event", async () => {
    ProducingGuardedAggregate.reset();
    const factory = new InMemoryStorageFactory();
    const event = createProjectCreated("event-aggregate-restart", "aggregate-restart-source");

    const firstRepository = createProducingGuardedAggregateRepository();
    routeAggregateTargets(firstRepository, ["aggregate-restart-one", "aggregate-restart-two"]);
    const firstContext = BoundedContext.singleTenant("Tasks")
      .add(firstRepository)
      .withStorageFactory(factory)
      .build();
    const firstDispatcher = repositoryAccess.eventDispatcher(firstRepository);
    if (firstDispatcher === undefined) throw new Error("Expected an aggregate event dispatcher.");
    await firstDispatcher.dispatch(event);
    const firstChildren = (
      await new EventStore({ name: "Tasks", multitenant: false }, factory).read()
    ).filter((stored) => UUID_PATTERN.test(stored.id?.value ?? ""));
    expect(firstChildren).toHaveLength(2);
    expect(firstChildren.map((child) => child.id?.value)).toEqual(
      expect.arrayContaining([expect.any(String), expect.any(String)]),
    );
    const [firstChild, secondChild] = firstChildren;
    expect(firstChild?.id?.value).not.toBe(event.id?.value);
    expect(secondChild?.id?.value).not.toBe(event.id?.value);
    expect(firstChild?.id?.value).not.toBe(secondChild?.id?.value);
    await firstContext.close();

    const secondRepository = createProducingGuardedAggregateRepository();
    routeAggregateTargets(secondRepository, ["aggregate-restart-one", "aggregate-restart-two"]);
    const secondContext = BoundedContext.singleTenant("Tasks")
      .add(secondRepository)
      .withStorageFactory(factory)
      .build();
    const secondDispatcher = repositoryAccess.eventDispatcher(secondRepository);
    if (secondDispatcher === undefined) throw new Error("Expected an aggregate event dispatcher.");
    await expect(secondDispatcher.dispatch(event)).resolves.toBeUndefined();

    expect(ProducingGuardedAggregate.calls).toBe(4);
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
    const aggregateEvent = createProjectCreated("event-aggregate-probe", "aggregate-probe");

    await aggregateDispatcher.dispatch(aggregateEvent);
    expect(aggregateFactory.closedProbes).toBe(1);
    await aggregateDispatcher.dispatch(
      createProjectCreated("event-aggregate-probe-other", "aggregate-probe-other"),
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
    const pmEvent = createProjectCreated("event-pm-probe", "pm-probe");

    await pmDispatcher.dispatch(createProjectCreated("event-pm-probe-retry", "pm-probe"));
    expect(pmFactory.closedProbes).toBe(1);
    await pmDispatcher.dispatch(createProjectCreated("event-pm-probe-other", "pm-probe-other"));
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
        createProjectCreated("event-aggregate-probe-fail", "aggregate-probe-fail"),
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

    const first = createProjectCreated("event-guard-depth-first", "pm-guard-depth-first");
    const second = createProjectCreated("event-guard-depth-second", "pm-guard-depth-second");
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
    const event = createProjectCreated("event-guard-rebind", "pm-guard-rebind");

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
    const preJournalEvent = createProjectCreated(
      "event-guard-before-journal",
      "pm-guard-before-journal",
    );

    await expect(preJournalDispatcher.dispatch(preJournalEvent)).resolves.toBeUndefined();
    const preJournal = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: preJournalFactory,
      stateSchema: ProjectQueueStateSchema,
    });
    await expect(preJournal.readEvents("pm-guard-before-journal")).resolves.toEqual([]);
    RoutingProcessManager.reset();
    await preJournalDispatcher.dispatch(
      createProjectCreated("event-guard-before-journal-retry", "pm-guard-before-journal"),
    );
    expect(RoutingProcessManager.eventCalls).toBe(1);
    await expect(preJournal.readEvents("pm-guard-before-journal")).resolves.toEqual([]);
    await preJournalContext.close();

    const postJournalFactory = new InMemoryStorageFactory();
    const postJournalRepository = createGuardedProcessManagerCommandOnlyRepository();
    let publicationAttempts = 0;
    const postJournalContext = BoundedContext.singleTenant("Tasks")
      .add(postJournalRepository)
      .addCommandDispatcher({
        messageSchemas: () => [CreateProjectSchema],
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
    const postJournalEvent = createProjectCreated(
      "event-guard-after-journal",
      "pm-guard-after-journal",
    );

    RoutingProcessManager.reset();
    await expect(postJournalDispatcher.dispatch(postJournalEvent)).resolves.toBeUndefined();
    await postJournalDispatcher.dispatch(
      createProjectCreated("event-guard-after-journal-retry", "pm-guard-after-journal"),
    );
    expect(RoutingProcessManager.commandReactionCalls).toBe(2);
    expect(publicationAttempts).toBe(2);
    const postJournal = new CurrentRecordTestStorage({
      context: { name: "Tasks", multitenant: false },
      storageFactory: postJournalFactory,
      stateSchema: ProjectQueueStateSchema,
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
      createProjectCreated("event-guard-lane-one", "pm-guard-lane-one"),
      new Date("2026-07-24T19:00:00.000Z"),
      1n,
    );
    const unrelatedRow = await storePmInboxEvent(
      delivery,
      createProjectCreated("event-guard-lane-two", "pm-guard-lane-two"),
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

  it("trims completed lanes behind an active lane without breaking its serialization", async () => {
    BlockingProcessManager.reset();
    BlockingProcessManager.blockingId = "pm-guard-trim-active";
    const factory = new CountingProbeStorageFactory(false, true);
    const repository = createGuardedBlockingPmRepo(1);
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const delivery = new Delivery({
      context: { name: "Tasks", multitenant: false },
      storageFactory: factory,
    });
    const target = requireEntityInboxTarget(repository);
    const active = createProjectCreated("event-guard-trim-active", "pm-guard-trim-active");
    const evicted = createProjectCreated("event-guard-trim-evicted", "pm-guard-trim-evicted");
    const first = target.replay(
      await storePmInboxEvent(delivery, active, new Date("2026-07-24T20:00:00.000Z"), 1n),
    );
    await waitForCondition(() => BlockingProcessManager.startedCalls === 1);
    await target.replay(
      await storePmInboxEvent(delivery, evicted, new Date("2026-07-24T20:00:01.000Z"), 2n),
    );
    await target.replay(
      await storePmInboxEvent(
        delivery,
        createProjectCreated("event-guard-trim-two", "pm-guard-trim-two"),
        new Date("2026-07-24T20:00:02.000Z"),
        3n,
      ),
    );
    await target.replay(
      await storePmInboxEvent(
        delivery,
        createProjectCreated("event-guard-trim-three", "pm-guard-trim-three"),
        new Date("2026-07-24T20:00:03.000Z"),
        4n,
      ),
    );
    await target.replay(
      await storePmInboxEvent(delivery, evicted, new Date("2026-07-24T20:00:04.000Z"), 5n, {
        signalId: "delivery-row-guard-trim-evicted",
      }),
    );
    await waitForCondition(() => BlockingProcessManager.startedCalls === 5);

    const duplicateActive = target.replay(
      await storePmInboxEvent(delivery, active, new Date("2026-07-24T20:00:05.000Z"), 6n, {
        signalId: "delivery-row-guard-trim-active",
      }),
    );
    await expect(Promise.race([duplicateActive.then(() => "resolved"), delay(150)])).resolves.toBe(
      "pending",
    );
    BlockingProcessManager.release();
    await expect(Promise.all([first, duplicateActive])).resolves.toEqual([undefined, undefined]);
    expect(BlockingProcessManager.completedCalls).toBe(5);
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
    const event = createProjectCreated("event-pm-replay", "pm-replay");
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
          ProjectStateSchema,
          create(ProjectStateSchema, {
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
    const token = MessageInterfaces.define<object, readonly [typeof ProjectCreatedSchema]>([
      ProjectCreatedSchema,
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
      await context.eventBus().post(createProjectCreated("event-pm-admission", "pm-admission"));
      await waitForCondition(() => RoutingProcessManager.eventCalls === 1);
      expect(routeCalls).toBe(1);

      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: factory,
      });
      const replay = await storePmInboxEvent(
        delivery,
        createProjectCreated("event-pm-replay-count", "pm-admission"),
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
      createProjectCreated("event-pm-guarded-replay", "pm-guarded-replay"),
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
      createProjectCreated("event-pm-react", "pm-event-react", {
        producerId: "different-producer",
      }),
    );

    expect(RoutingProcessManager.eventCalls).toBe(1);
    await expect(context.stand().read(ProjectQueueStateSchema, "pm-event-react")).resolves.toEqual(
      create(ProjectQueueStateSchema, {
        id: "pm-event-react",
        queue: "Task reacted",
      }),
    );
  });

  it("retains one reactor diagnostic when an admitted Process Manager reactor fails", async () => {
    const failure = new Error("admitted Process Manager reactor failed");
    const diagnostics: SpineEvent[] = [];
    const event = createProjectCreated("pm-reactor-diagnostic-failure", "pm-reactor-failure");
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
        receiver: { typeUrl: TypeUrls.derive(ProjectQueueStateSchema) },
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
    const event = createProjectCreated("pm-diagnostic-event", "pm-diagnostic", {
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
        receiver: { typeUrl: TypeUrls.derive(ProjectQueueStateSchema) },
        payload: event,
        entityType: { impl: { case: "javaClassName", value: "RoutingProcessManager" } },
        whenDispatched: reactor?.context?.timestamp,
      });
      await expect(
        context
          .stand()
          .read(ProjectQueueStateSchema, "pm-diagnostic", { tenantId: createTenantId("a") }),
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
      await context.eventBus().post(createProjectCreated("pm-no-reactor", "pm-no-reactor"));
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
        context.eventBus().post(createProjectCreated("pm-reactor-failure", "pm-reactor-failure")),
      ).resolves.toBeUndefined();

      expect(RoutingProcessManager.eventCalls).toBe(1);
      await expect(
        context.stand().read(ProjectQueueStateSchema, "pm-reactor-failure"),
      ).resolves.toMatchObject({
        queue: "Task reacted",
      });
      expect(diagnostics).toHaveLength(1);
      expect("storedEventDispatchFailures" in context).toBe(false);
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
    context.stand().subscribe(ProjectQueueStateSchema, () => {
      notifications++;
      throw new Error("process-manager event subscriber failed");
    });

    try {
      await expect(
        context.eventBus().post(createProjectCreated("event-pm-subscriber-1", "pm-subscriber")),
      ).resolves.toBeUndefined();
      await expect(
        context
          .eventBus()
          .post(
            createProjectCreated("event-pm-subscriber-2", "pm-subscriber", { name: "Follow-up" }),
          ),
      ).resolves.toBeUndefined();

      expect(RoutingProcessManager.eventCalls).toBe(2);
      expect(notifications).toBe(2);
      await expect(context.stand().read(ProjectQueueStateSchema, "pm-subscriber")).resolves.toEqual(
        create(ProjectQueueStateSchema, {
          id: "pm-subscriber",
          queue: "Follow-up reacted",
        }),
      );
      expect("storedEventDispatchFailures" in context).toBe(false);
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
        messageSchemas: () => [CreateProjectSchema],
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
        typeUrl: TypeUrls.derive(CreateProjectSchema),
      }),
      actorContext: sourceActorContext,
    });

    await context.eventBus().post(
      createProjectCreated("event-pm-command", "pm-event-command", {
        pastMessageTenantId: "tenant-command",
      }),
    );

    expect(RoutingProcessManager.commandReactionCalls).toBe(1);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.id?.uuid).toMatch(/.+/);
    expect(commands[0]?.context?.actorContext).toEqual(sourceActorContext);
    expect(commands[0]?.context?.origin).toEqual(
      create(OriginSchema, {
        message: create(MessageIdSchema, {
          id: AnyMessages.pack(EventIdSchema, create(EventIdSchema, { value: "event-pm-command" })),
          typeUrl: TypeUrls.derive(ProjectCreatedSchema),
        }),
        actorContext: sourceActorContext,
        grandOrigin: sourceGrandOrigin,
      }),
    );
    const producedMessage = commands[0]?.message;
    if (producedMessage === undefined) {
      throw new Error("Expected a process-manager produced command message.");
    }
    expect(AnyMessages.unpack(producedMessage, CreateProjectSchema)).toEqual(
      create(CreateProjectSchema, {
        id: "pm-event-command",
        name: "Task follow-up command",
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
        messageSchemas: () => [CreateProjectSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();
    const eventDispatcher = repositoryAccess.eventDispatcher(repository);
    const sourceEvent = createProjectCreated("event-unused", "pm-event-command-missing-id");
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
      context.stand().read(ProjectQueueStateSchema, "pm-event-command-missing-id"),
    ).resolves.toBeUndefined();
    expect(commands).toEqual([]);
  });

  it("routes process-manager command reactions by the first event field even when producer ID differs", async () => {
    RoutingProcessManager.reset();
    const commands: SpineCommand[] = [];
    const context = BoundedContext.singleTenant("Tasks")
      .add(createProcessManagerCommandOnlyRepository())
      .addCommandDispatcher({
        messageSchemas: () => [CreateProjectSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();

    await context.eventBus().post(
      createProjectCreated("event-pm-command-producer", "pm-first-field", {
        producerId: "different-producer",
      }),
    );

    expect(RoutingProcessManager.eventCalls).toBe(0);
    expect(RoutingProcessManager.commandReactionCalls).toBe(1);
    await expect(context.stand().read(ProjectQueueStateSchema, "pm-first-field")).resolves.toEqual(
      create(ProjectQueueStateSchema, {
        id: "pm-first-field",
        queue: "Task commanded",
      }),
    );
    expect(commands).toHaveLength(1);
    const producedMessage = commands[0]?.message;
    if (producedMessage === undefined) {
      throw new Error("Expected a process-manager produced command message.");
    }
    expect(AnyMessages.unpack(producedMessage, CreateProjectSchema)).toEqual(
      create(CreateProjectSchema, {
        id: "pm-first-field",
        name: "Task follow-up command",
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
        messageSchemas: () => [ProjectRegisteredSchema],
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
      context.eventBus().post(createProjectCreated("event-pm-produce", "pm-event-produce")),
    ).resolves.toBeUndefined();

    expect(RoutingProcessManager.eventCalls).toBe(1);
    await expect(
      context.stand().read(ProjectQueueStateSchema, "pm-event-produce"),
    ).resolves.toEqual(
      create(ProjectQueueStateSchema, {
        id: "pm-event-produce",
        queue: "Task evented",
      }),
    );
    await withTimeout(
      dispatchAttempted.promise,
      "process-manager event produced-event dispatch attempt",
    );
    const stored = await eventStore.read();
    storedSourceAndFreshChild(stored, "event-pm-produce");
    expect("storedEventDispatchFailures" in context).toBe(false);
    await waitForCondition(() => errors.length === 1);
    expect(errors).toEqual([
      {
        message: "Produced signal handling failed.",
        facts: {
          operation: "signal_publisher.handle",
          reasonCode: "handled_failure",
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
        messageSchemas: () => [ProjectRegisteredSchema],
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
      eventDispatcher.dispatch(createProjectCreated("   ", "pm-event-produce-blank-id")),
    ).rejects.toThrow(/event ID/i);

    expect(RoutingProcessManager.eventCalls).toBe(0);
    await expect(
      context.stand().read(ProjectQueueStateSchema, "pm-event-produce-blank-id"),
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
        messageSchemas: () => [ProjectRegisteredSchema],
        dispatch: (event) => {
          eventDispatches.push(event.id?.value ?? "");
          return Promise.resolve();
        },
      })
      .addCommandDispatcher({
        messageSchemas: () => [CreateProjectSchema],
        dispatch: (command) => {
          commandDispatches.push(command.id?.uuid ?? "");
          return Promise.reject(new Error("mixed process-manager command dispatch failed"));
        },
      })
      .withStorageFactory(factory)
      .build();
    const eventStore = new EventStore({ name: "Tasks", multitenant: false }, factory);

    await expect(
      context.eventBus().post(createProjectCreated("event-pm-mixed", "pm-event-mixed")),
    ).resolves.toBeUndefined();

    expect(RoutingProcessManager.eventCalls).toBe(1);
    expect(RoutingProcessManager.commandReactionCalls).toBe(1);
    await expect(context.stand().read(ProjectQueueStateSchema, "pm-event-mixed")).resolves.toEqual(
      create(ProjectQueueStateSchema, {
        id: "pm-event-mixed",
        queue: "Task commanded",
      }),
    );
    expect(commandDispatches).toHaveLength(1);
    expect(commandDispatches[0]).toMatch(/.+/);
    await waitForCondition(() => eventDispatches.length === 1);
    const stored = await eventStore.read();
    storedSourceAndFreshChild(stored, "event-pm-mixed");
    expect("storedEventDispatchFailures" in context).toBe(false);
  });

  it("executes projection event subscribers and records latest state in Stand", async () => {
    ExecutingTaskProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .build();

    await context.eventBus().post(createProjectCreated("event-projected", "task-projected"));

    expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
    await expect(
      context.stand().readVersioned(ProjectOverviewStateSchema, "task-projected"),
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
        createProjectCreated("event-filtered-announcements", "filtered-announcements", {
          name: "announcements",
        }),
      );
      await context
        .eventBus()
        .post(
          createProjectCreated("event-filtered-general", "filtered-general", { name: "general" }),
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
    stringifiers.register(ProjectSequenceIdSchema, {
      fromString: (value) =>
        create(ProjectSequenceIdSchema, { value: BigInt(value.replace(/^id:/, "")) }),
      toString: (value) => `id:${String(value.value)}`,
    });
    const handlers = HandlerMetadataValues.defineArity(
      SequencedProjectOverview,
      SequencedProjectOverviewStateSchema,
      (builder) => [builder.subscribe(SequencedProjectOverviewCreatedSchema, "subscribeState")],
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
          entityType: SequencedProjectOverview,
          schema: SequencedProjectOverviewStateSchema,
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
        messageSchemas: () => [ProjectRegisteredSchema],
        dispatch: () => Promise.resolve(),
      })
      .build();

    try {
      await context.eventBus().post(
        createProjectCreated("event-filtered-aggregate-one", "filtered-aggregate-one", {
          name: "announcements",
        }),
      );
      await context.eventBus().post(
        createProjectCreated("event-filtered-aggregate-two", "filtered-aggregate-two", {
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
        messageSchemas: () => [CreateProjectSchema],
        dispatch: (command) => {
          commands.push(command);
          return Promise.resolve();
        },
      })
      .build();

    try {
      await context.eventBus().post(
        createProjectCreated("event-filtered-pm-one", "filtered-pm-one", {
          name: "announcements",
        }),
      );
      await context
        .eventBus()
        .post(
          createProjectCreated("event-filtered-pm-two", "filtered-pm-two", { name: "general" }),
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
    const event = createProjectCreated("subscriber-diagnostic", "subscriber-id");
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
        receiver: { typeUrl: TypeUrls.derive(ProjectOverviewStateSchema) },
        payload: event,
        entityType: { impl: { case: "javaClassName", value: "ExecutingTaskProjection" } },
        whenDispatched: diagnostics[0]?.context?.timestamp,
      });
      expect(diagnostics[0]?.context?.origin).toMatchObject({
        case: "pastMessage",
        value: { message: { typeUrl: TypeUrls.derive(ProjectCreatedSchema) } },
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
    const event = createProjectCreated(
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
        createProjectCreated("subscriber-tenant", "subscriber-id", {
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
        create(EventSchema, {
          id: create(EventIdSchema, { value: "subscriber-unmatched" }),
          context: create(EventContextSchema),
          message: AnyMessages.pack(
            ProjectPriorityChangedSchema,
            create(ProjectPriorityChangedSchema, { id: 7 }),
          ),
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
          .post(createContextlessProjectCreated("subscriber-routing-refusal", "first-field-task")),
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
        context.eventBus().post(createProjectCreated("subscriber-failure", "subscriber-failure")),
      ).resolves.toBeUndefined();

      expect(ExecutingTaskProjection.subscriberCalls).toBe(1);
      await expect(
        context.stand().read(ProjectOverviewStateSchema, "subscriber-failure"),
      ).resolves.toMatchObject({
        name: "Task (projected)",
      });
      expect(diagnostics).toHaveLength(1);
      expect("storedEventDispatchFailures" in context).toBe(false);
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
      context.eventBus().post(createProjectCreated("projection-commit-fails", "projection-fails")),
    ).resolves.toBeUndefined();
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "projection-fails"),
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
      context.stand().read(ProjectStateSchema, "aggregate-fails"),
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
        .post(createProjectCreated("projection-replay", "projection-replay"));
      await processManager.commandBus().post(createAggregateCommand("pm-replay", "pm-replay"));

      await expect(
        aggregate.stand().read(ProjectStateSchema, "aggregate-replay"),
      ).resolves.toBeUndefined();
      await expect(
        projection.stand().read(ProjectOverviewStateSchema, "projection-replay"),
      ).resolves.toBeUndefined();
      await expect(
        processManager.stand().read(ProjectQueueStateSchema, "pm-replay"),
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
          .post(createProjectCreated("projection-conflict", "projection-conflict")),
      ).resolves.toBeUndefined();
      await expect(
        processManager.commandBus().post(createAggregateCommand("pm-conflict", "pm-conflict")),
      ).resolves.toBeUndefined();

      await expect(
        aggregate.stand().read(ProjectStateSchema, "aggregate-conflict"),
      ).resolves.toBeUndefined();
      await expect(
        projection.stand().read(ProjectOverviewStateSchema, "projection-conflict"),
      ).resolves.toBeUndefined();
      await expect(
        processManager.stand().read(ProjectQueueStateSchema, "pm-conflict"),
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
        messageSchemas: () => [ProjectCreatedSchema],
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
      context.stand().read(ProjectQueueStateSchema, "pm-fails"),
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

      await waitForCondition(() => changes.length >= 1);
      expect(changes.map((event) => event.message?.typeUrl)).toEqual([
        TypeUrls.derive(EntityStateChangedSchema),
      ]);
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
        entity: { typeUrl: TypeUrls.derive(ProjectStateSchema) },
        signalId: [{ typeUrl: TypeUrls.derive(CreateProjectSchema) }],
        newState: { typeUrl: TypeUrls.derive(ProjectStateSchema) },
        newVersion: { number: 1 },
      });
      if (change?.newState === undefined) {
        throw new Error("Expected the committed state in the change event.");
      }
      expect(AnyMessages.unpack(change.newState, ProjectStateSchema)).toMatchObject({
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
        entity: { typeUrl: TypeUrls.derive(ProjectStateSchema) },
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
      .mockImplementation(() => new Date(1_000 + clockTick++));
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
      await waitForCondition(() => changes.length >= 1);
      expect(changes.map((event) => event.message?.typeUrl)).toEqual([
        TypeUrls.derive(EntityArchivedSchema),
      ]);
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
          entity: { typeUrl: TypeUrls.derive(ProjectStateSchema) },
          signalId: [{ typeUrl: TypeUrls.derive(CreateProjectSchema) }],
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
        .post(createProjectCreated("projection-seed", "projection-lifecycle"));
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
            createProjectCreated(`projection-${String(index)}`, "projection-lifecycle", { name }),
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
        standAccess.readCurrent(
          context.stand(),
          ProjectOverviewStateSchema,
          "projection-lifecycle",
          {},
        ),
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
        standAccess.readCurrent(context.stand(), ProjectQueueStateSchema, "pm-all", {}),
      ).resolves.toMatchObject({ archived: true });
      changes.splice(0);
      await context
        .commandBus()
        .post(createAggregateCommand("pm-unarchive-all", "pm-all", "unarchive-lifecycle"));
      expect(RoutingProcessManager.commandCalls).toBe(3);
      await expect(
        standAccess.readCurrent(context.stand(), ProjectQueueStateSchema, "pm-all", {}),
      ).resolves.toMatchObject({ archived: false });
      await waitForCondition(() => changes.length === 1);
      expect(changes[0]?.message?.typeUrl).toBe(TypeUrls.derive(EntityUnarchivedSchema));
      changes.splice(0);
      await context
        .commandBus()
        .post(createAggregateCommand("pm-delete-all", "pm-all", "delete-lifecycle"));
      await expect(
        standAccess.readCurrent(context.stand(), ProjectQueueStateSchema, "pm-all", {}),
      ).resolves.toMatchObject({ deleted: true });
      await waitForCondition(() => changes.length === 1);
      expect(changes[0]?.message?.typeUrl).toBe(TypeUrls.derive(EntityDeletedSchema));
      changes.splice(0);
      await context
        .commandBus()
        .post(createAggregateCommand("pm-restore-all", "pm-all", "restore-lifecycle"));
      await expect(
        standAccess.readCurrent(context.stand(), ProjectQueueStateSchema, "pm-all", {}),
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

      expect(changes).toHaveLength(2);
      await expect(
        context.stand().readVersioned(ProjectStateSchema, "state-change"),
      ).resolves.toMatchObject({ state: { name: "Second (applied)" }, version: { number: 2 } });
      expect(readStateChange(changes[0])?.oldState).toBeUndefined();
      const oldState = readStateChange(changes[1])?.oldState;
      if (oldState === undefined) {
        throw new Error("Expected a prior state on the second state-change notification.");
      }
      expect(AnyMessages.unpack(oldState, ProjectStateSchema)).toMatchObject({
        id: "state-change",
        name: "Task (applied)",
      });
      expect("storedEventDispatchFailures" in context).toBe(false);
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
      await aggregate.eventBus().post(createProjectCreated("reactor-source", "reactor-id"));
      await waitForCondition(() => aggregateChanges.length === 1);
      expect(readStateChange(aggregateChanges[0])).toMatchObject({
        entity: { typeUrl: TypeUrls.derive(ProjectStateSchema) },
        signalId: [{ typeUrl: TypeUrls.derive(ProjectCreatedSchema) }],
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
      await projection.eventBus().post(createProjectCreated("projection-source", "projection-id"));
      await waitForCondition(() => projectionChanges.length === 1);
      expect(readStateChange(projectionChanges[0])).toMatchObject({
        entity: { typeUrl: TypeUrls.derive(ProjectOverviewStateSchema) },
        signalId: [{ typeUrl: TypeUrls.derive(ProjectCreatedSchema) }],
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
        entity: { typeUrl: TypeUrls.derive(ProjectQueueStateSchema) },
        signalId: [{ typeUrl: TypeUrls.derive(CreateProjectSchema) }],
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
      await eventProcessManager.eventBus().post(createProjectCreated("pm-event", "pm-event-id"));
      await waitForCondition(() => pmEventChanges.length === 1);
      expect(readStateChange(pmEventChanges[0])).toMatchObject({
        entity: { typeUrl: TypeUrls.derive(ProjectQueueStateSchema) },
        signalId: [{ typeUrl: TypeUrls.derive(ProjectCreatedSchema) }],
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
      await context.eventBus().post(createProjectCreated("unchanged", "unchanged-id"));
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

    await context.eventBus().post(createProjectCreated("event-catch-up", "task-catch-up"));
    await context.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "task-catch-up",
        name: "Wrong",
        priority: 99,
      }),
    );
    await context.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
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
      clearedStateTypes: [TypeUrls.derive(ProjectOverviewStateSchema)],
    });
    await expect(
      context.stand().readVersioned(ProjectOverviewStateSchema, "task-catch-up"),
    ).resolves.toEqual({
      state: create(ProjectOverviewStateSchema, {
        id: "task-catch-up",
        name: "Task (projected)",
        priority: 2,
      }),
      version: create(VersionSchema, { number: 1 }),
    });
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-stale"),
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
    await waitForProjectOverviewState(context, "task-catch-up-tenant", "tenant-a");
    const tenantBBefore = await waitForProjectOverviewState(
      context,
      "task-catch-up-tenant",
      "tenant-b",
    );

    await context.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
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
      clearedStateTypes: [TypeUrls.derive(ProjectOverviewStateSchema)],
    });
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-catch-up-tenant", {
        tenantId: createTenantId("tenant-a"),
      }),
    ).resolves.toEqual(
      create(ProjectOverviewStateSchema, {
        id: "task-catch-up-tenant",
        name: "Task (projected)",
        priority: 2,
      }),
    );
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-catch-up-tenant", {
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

    await context.eventBus().post(createProjectCreated("event-primary", "task-primary"));
    await context.eventBus().post(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "event-alternate" }),
        context: create(EventContextSchema),
        message: AnyMessages.pack(
          TaskCreatedSchema,
          create(TaskCreatedSchema, {
            id: create(TodoIdSchema, { value: "task-alternate" }),
            taskListId: create(TodoTaskListIdSchema, { value: "task-alternate" }),
            title: "Alternate task",
          }),
        ),
      }),
    );
    await context.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
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
      clearedStateTypes: [
        TypeUrls.derive(ProjectOverviewStateSchema),
        TypeUrls.derive(TaskListSchema),
      ],
    });
    await expect(context.stand().read(ProjectOverviewStateSchema, "task-primary")).resolves.toEqual(
      create(ProjectOverviewStateSchema, {
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

    await context.eventBus().post(createProjectCreated("event-shared-state", "task-shared-state"));
    await context.eventBus().post(
      create(EventSchema, {
        id: create(EventIdSchema, { value: "event-unmatched-state" }),
        context: create(EventContextSchema, {
          version: create(VersionSchema, { number: 1 }),
        }),
        message: AnyMessages.pack(
          ProjectPriorityChangedSchema,
          create(ProjectPriorityChangedSchema, {
            id: 7,
          }),
        ),
      }),
    );
    await context.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
        id: "task-shared-state",
        name: "Wrong shared state",
        priority: 99,
      }),
    );
    ExecutingTaskProjection.reset();

    await expect(context.catchUpReadSide()).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [TypeUrls.derive(ProjectOverviewStateSchema)],
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
    await waitForProjectOverviewState(context, "task-space-tenant", rawTenantId);
    const trimmedBefore = await waitForProjectOverviewState(
      context,
      "task-space-tenant",
      trimmedTenantId,
    );

    await context.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
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
      clearedStateTypes: [TypeUrls.derive(ProjectOverviewStateSchema)],
    });
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-space-tenant", {
        tenantId: createTenantId(rawTenantId),
      }),
    ).resolves.toEqual(
      create(ProjectOverviewStateSchema, {
        id: "task-space-tenant",
        name: "Task (projected)",
        priority: 2,
      }),
    );
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-space-tenant", {
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
      createProjectCreated("event-domain-tenant", "task-domain-tenant", {
        importTenantId: "example.com",
        importTenantKind: "domain",
      }),
    );

    await expect(
      context.catchUpReadSide({ tenantId: createTenantId("example.com", "domain") }),
    ).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 0,
      clearedStateTypes: [TypeUrls.derive(ProjectOverviewStateSchema)],
    });
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-domain-tenant", {
        tenantId: createTenantId("example.com", "domain"),
      }),
    ).resolves.toEqual(
      create(ProjectOverviewStateSchema, {
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
      createProjectCreated("event-email-tenant", "task-email-tenant", {
        pastMessageTenantId: "owner@example.com",
        pastMessageTenantKind: "email",
      }),
    );

    await expect(
      context.catchUpReadSide({ tenantId: createTenantId("owner@example.com", "email") }),
    ).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 0,
      clearedStateTypes: [TypeUrls.derive(ProjectOverviewStateSchema)],
    });
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-email-tenant", {
        tenantId: createTenantId("owner@example.com", "email"),
      }),
    ).resolves.toEqual(
      create(ProjectOverviewStateSchema, {
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
    const tenantBState = create(ProjectOverviewStateSchema, {
      id: "task-corrupt-tenant",
      name: "Tenant B before catch-up",
      priority: 7,
    });
    const eventStore = new EventStore(
      { name: "Tasks", multitenant: true, tenantId: createTenantId("tenant-a") },
      storageFactory,
    );

    await eventStore.appendAll([
      createProjectCreated("event-corrupt-tenant", "task-corrupt-tenant", {
        pastMessageTenantId: "tenant-b",
      }),
    ]);
    await context.stand().update(ProjectOverviewStateSchema, tenantBState, {
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
      context.stand().read(ProjectOverviewStateSchema, "task-corrupt-tenant", {
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

    await eventStore.append(createProjectCreated("event-missing-tenant", "task-missing-tenant"));

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
      context.stand().read(ProjectOverviewStateSchema, "task-missing-tenant", {
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

    await context.eventBus().post(createProjectCreated("event-blocking", "task-blocking"));
    await context.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
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
      clearedStateTypes: [TypeUrls.derive(ProjectOverviewStateSchema)],
    });
    await waitForCondition(() => BlockingCatchUpProjection.startedCalls === 2);
    expect(BlockingCatchUpProjection.completedCalls).toBe(1);
    BlockingCatchUpProjection.release(1);

    await expect(second).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [TypeUrls.derive(ProjectOverviewStateSchema)],
    });
    expect(BlockingCatchUpProjection.completedCalls).toBe(2);
  });

  it("serializes read-side catch-up with live event intake on the EventBus queue", async () => {
    BlockingCatchUpProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createBlockingCatchUpProjectionRepository())
      .build();

    await context.eventBus().post(createProjectCreated("event-queued-catch-up", "task-queued"));
    await context.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
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
      .post(createProjectCreated("event-queued-live", "task-live"));

    await expect(Promise.race([livePost.then(() => "posted"), delay(25)])).resolves.toBe("pending");
    expect(BlockingCatchUpProjection.completedCalls).toBe(0);
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-live"),
    ).resolves.toBeUndefined();

    BlockingCatchUpProjection.release(0);

    await expect(catchUp).resolves.toEqual({
      replayedEventCount: 1,
      clearedEntityCount: 1,
      clearedStateTypes: [TypeUrls.derive(ProjectOverviewStateSchema)],
    });
    await waitForCondition(() => BlockingCatchUpProjection.startedCalls === 2);
    expect(BlockingCatchUpProjection.completedCalls).toBe(1);

    BlockingCatchUpProjection.release(1);

    await expect(livePost).resolves.toBeUndefined();
    expect(BlockingCatchUpProjection.completedCalls).toBe(2);
    await expect(context.stand().read(ProjectOverviewStateSchema, "task-live")).resolves.toEqual(
      create(ProjectOverviewStateSchema, {
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

    await context.eventBus().post(createProjectCreated("event-close", "task-close"));
    await context.stand().update(
      ProjectOverviewStateSchema,
      create(ProjectOverviewStateSchema, {
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
      clearedStateTypes: [TypeUrls.derive(ProjectOverviewStateSchema)],
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
        .post(createProjectCreated("event-catch-up-failure", "task-catch-up-failure")),
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
          .post(createProjectCreated("event-catch-up-string-failure", "task-string-failure")),
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
      createProjectCreated("event-generated", "task-generated", {
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
    ManagedProjectAggregate.reset(rejection);
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
    ManagedProjectAggregate.reset();
  });

  it("passes empty EventContext to a custom-routed two-argument subscriber", async () => {
    GeneratedTwoArgProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(
        createGeneratedTwoArgProjectionRepository(
          EventRouting.create<string>().route(ProjectCreatedSchema, () => ["task-empty"]),
        ),
      )
      .build();

    await context.eventBus().post(createContextlessProjectCreated("event-empty", "task-empty"));

    expect(GeneratedTwoArgProjection.argumentCounts).toEqual([2]);
    expect(GeneratedTwoArgProjection.contexts).toEqual([create(EventContextSchema)]);
  });

  it("isolates EventContext mutations between generated two-argument subscribers", async () => {
    ContextMutatingGeneratedProjection.reset();
    const context = BoundedContext.singleTenant("Tasks")
      .add(createContextMutatingGeneratedProjectionRepository())
      .build();

    await context.eventBus().post(createProjectCreated("event-mutating", "task-mutating"));

    expect(ContextMutatingGeneratedProjection.observerSawSameContext).toBe(false);
    expect(ContextMutatingGeneratedProjection.observedVersions).toEqual([1]);
  });

  it("owns the projection transaction when subscribers only update draft state", async () => {
    ManagedTaskProjection.reset();
    const context = BoundedContext.singleTenant("Tasks").add(createManagedProjection()).build();

    await context.eventBus().post(createProjectCreated("event-managed", "task-managed"));

    expect(ManagedTaskProjection.subscriberCalls).toBe(1);
    await expect(
      context.stand().readVersioned(ProjectOverviewStateSchema, "task-managed"),
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

    await context.eventBus().post(createProjectCreated("event-inbox", "task-inbox"));

    expect(ExecutingTaskProjection.subscriberCalls).toBe(1);

    const delivered = await delivery.inbox.read(ShardIndex.single(), {
      statuses: ["DELIVERED"],
    });

    expect(delivered).toHaveLength(1);
    expect(delivered[0]).toMatchObject({
      inboxId: {
        targetId: Identifiers.pack("string", "task-inbox"),
        targetTypeUrl: TypeUrls.derive(ProjectOverviewStateSchema),
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
    const event = createProjectCreated("event-projection-replay", "projection-replay", {
      importTenantId: "tenant-a",
    });
    const valid = await storePmInboxEvent(
      delivery,
      event,
      new Date("2026-07-24T21:20:00.000Z"),
      1n,
      {
        label: "UPDATE_SUBSCRIBER",
        targetTypeUrl: TypeUrls.derive(ProjectOverviewStateSchema),
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
        targetTypeUrl: TypeUrls.derive(ProjectOverviewStateSchema),
      }),
    ).rejects.toThrow();
    const invalidPayload = await storePmInboxEvent(
      delivery,
      create(EventSchema, {
        id: create(EventIdSchema, { value: "event-projection-invalid-payload" }),
        context: create(EventContextSchema, {
          ...(tenantAOrigin === undefined ? {} : { origin: tenantAOrigin }),
        }),
        message: AnyMessages.pack(
          ProjectCreatedSchema,
          create(ProjectCreatedSchema, { id: "projection-replay", name: "Task" }),
        ),
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
              typeUrl: TypeUrls.derive(ProjectCreatedSchema),
              value: new Uint8Array([255]),
            }),
          }),
          { validate: false },
        ),
        targetTypeUrl: TypeUrls.derive(ProjectOverviewStateSchema),
      },
    );
    const missingTenant = await storePmInboxEvent(
      delivery,
      createProjectCreated("event-projection-missing-tenant", "projection-replay"),
      new Date("2026-07-24T21:20:03.000Z"),
      4n,
      {
        label: "UPDATE_SUBSCRIBER",
        signalId: "event-projection-replay-missing-tenant",
        targetTypeUrl: TypeUrls.derive(ProjectOverviewStateSchema),
      },
    );
    const mismatchedTenant = await storePmInboxEvent(
      delivery,
      createProjectCreated("event-projection-mismatched-tenant", "projection-replay", {
        importTenantId: "tenant-b",
      }),
      new Date("2026-07-24T21:20:04.000Z"),
      5n,
      {
        label: "UPDATE_SUBSCRIBER",
        signalId: "event-projection-replay-mismatched-tenant",
        targetTypeUrl: TypeUrls.derive(ProjectOverviewStateSchema),
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
        context.stand().read(ProjectOverviewStateSchema, "projection-replay", {
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
    const eventRouting = EventRouting.create<string>().route(ProjectCreatedSchema, (message) => {
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
        .post(createProjectCreated("event-projection-admission", "projection-admission"));
      await waitForCondition(() => ExecutingTaskProjection.subscriberCalls === 1);
      expect(routeCalls).toBe(1);

      const delivery = new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: factory,
      });
      const replay = await storePmInboxEvent(
        delivery,
        createProjectCreated("event-projection-replay-count", "projection-admission"),
        new Date("2026-08-11T04:56:00.000Z"),
        1n,
        { label: "UPDATE_SUBSCRIBER", targetTypeUrl: TypeUrls.derive(ProjectOverviewStateSchema) },
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

  it("suppresses duplicate live projection messages during retained delivery", async () => {
    ExecutingTaskProjection.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createExecutingProjectionRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const dispatcher = repositoryAccess.eventDispatcher(repository);
    const event = createProjectCreated("event-duplicate-inbox", "task-duplicate-inbox");
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
      context.stand().read(ProjectOverviewStateSchema, "task-duplicate-inbox"),
    ).resolves.toMatchObject({
      name: "Task (projected)",
      priority: 2,
    });
    const delivered = await delivery.inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] });
    expect(delivered).toHaveLength(1);
    expect(
      delivered.every(
        (message) =>
          message.signalId === "event-duplicate-inbox" &&
          message.label === "UPDATE_SUBSCRIBER" &&
          message.status === "DELIVERED",
      ),
    ).toBe(true);
  });

  it("delivers an independently created matching projection event after suppressing an exact replay", async () => {
    ExecutingTaskProjection.reset();
    const factory = new InMemoryStorageFactory();
    const repository = createExecutingProjectionRepository();
    const context = BoundedContext.singleTenant("Tasks")
      .add(repository)
      .withStorageFactory(factory)
      .build();
    const dispatcher = repositoryAccess.eventDispatcher(repository);
    if (dispatcher === undefined) {
      throw new Error("Expected projection repository to expose an event dispatcher.");
    }
    const input = {
      context: create(EventContextSchema, {
        producerId: Identifiers.pack("string", "task-distinct-inbox"),
        version: create(VersionSchema, { number: 1 }),
      }),
      schema: ProjectCreatedSchema,
      message: create(ProjectCreatedSchema, {
        id: "task-distinct-inbox",
        name: "Same payload",
        priority: 1,
      }),
    };
    const first = SignalEnvelopes.event(input);
    const second = SignalEnvelopes.event(input);
    const firstId = first.id?.value;
    const secondId = second.id?.value;
    if (firstId === undefined || secondId === undefined) {
      throw new Error("Expected generated event IDs.");
    }

    try {
      expect(firstId).not.toBe(secondId);
      await dispatcher.dispatch(first);
      await dispatcher.dispatch(first);
      await dispatcher.dispatch(second);

      expect(ExecutingTaskProjection.subscriberCalls).toBe(2);
      const delivered = await new Delivery({
        context: { name: "Tasks", multitenant: false },
        storageFactory: factory,
      }).inbox.read(ShardIndex.single(), { statuses: ["DELIVERED"] });
      expect(delivered).toHaveLength(2);
      expect(delivered.filter((row) => row.signalId === firstId)).toHaveLength(1);
      expect(delivered.filter((row) => row.signalId === secondId)).toHaveLength(1);
      expect(
        delivered.every(
          (row) =>
            row.label === "UPDATE_SUBSCRIBER" &&
            row.status === "DELIVERED" &&
            row.inboxId.targetTypeUrl === TypeUrls.derive(ProjectOverviewStateSchema) &&
            Identifiers.unpack("string", row.inboxId.targetId) === "task-distinct-inbox",
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
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
    const event = createProjectCreated("event-concurrent-inbox", "task-concurrent-inbox");
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
      context.stand().read(ProjectOverviewStateSchema, "task-concurrent-inbox"),
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
    const updates: ProjectOverviewState[] = [];
    context.stand().subscribe(ProjectOverviewStateSchema, (update) => {
      updates.push(update.state);
    });

    await context.eventBus().post(createProjectCreated("event-subscribed", "task-subscribed"));

    expect(updates).toEqual([
      create(ProjectOverviewStateSchema, {
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

    await context.eventBus().post(createProjectCreated("event-passive", "task-passive"));

    expect(PassiveTaskProjection.subscriberCalls).toBe(1);
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-passive"),
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
      stateSchema: ProjectQueueStateSchema,
      eventHistory: true,
    });

    try {
      const existing = create(ProjectQueueStateSchema, {
        id: "pm-diagnostic",
        queue: "already persisted",
      });
      await storage.writeCurrent({
        entityId: "pm-diagnostic",
        lifecycle: { archived: false, deleted: false },
        state: existing,
        version: 1n,
      });
      await context.stand().update(ProjectQueueStateSchema, existing, {
        version: create(VersionSchema, { number: 1 }),
      });
      await context.commandBus().post(createAggregateCommand("pm-diagnostic", "pm-diagnostic"));

      expect(DiagnosticOnlyProcessManager.calls).toBe(1);
      await expect(context.stand().read(ProjectQueueStateSchema, "pm-diagnostic")).resolves.toEqual(
        existing,
      );
      await expect(storage.readEvents("pm-diagnostic")).resolves.toMatchObject([
        { message: { typeUrl: TypeUrls.derive(ProjectCreatedSchema) } },
      ]);
    } finally {
      await context.close();
    }
  });

  it("loads existing projection state before applying later delivered events", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createAccumulatingProjectionRepository())
      .build();

    await context.eventBus().post(createProjectCreated("event-accumulated-1", "task-accumulated"));
    await context.eventBus().post(createProjectCreated("event-accumulated-2", "task-accumulated"));

    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-accumulated"),
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
        ProjectOverviewStateSchema,
        create(ProjectOverviewStateSchema, {
          id: "timestamped-cas",
          name: "Before",
          priority: 1,
        }),
        { version: initialVersion },
      );

      await expect(
        context.eventBus().post(
          createProjectCreated("timestamped-cas-event", "timestamped-cas", {
            version: nextVersion,
          }),
        ),
      ).resolves.toBeUndefined();

      await expect(
        context.stand().readVersioned(ProjectOverviewStateSchema, "timestamped-cas"),
      ).resolves.toEqual({
        state: create(ProjectOverviewStateSchema, {
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

    await context.eventBus().post(createProjectCreated("event-reacting", "task-reacting"));

    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-reacting"),
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

    const projected = await waitForProjectOverviewState(context, "task-tenant", "tenant-a");

    expect(projected).toMatchObject({
      name: "Task (projected)",
      priority: 2,
    });
    await expect(
      context
        .stand()
        .read(ProjectOverviewStateSchema, "task-tenant", { tenantId: createTenantId("tenant-b") }),
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

    const projected = await waitForProjectOverviewState(
      context,
      "task-past-message-tenant",
      "tenant-a",
    );

    expect(projected).toMatchObject({
      name: "Task (projected)",
      priority: 2,
    });
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-past-message-tenant", {
        tenantId: createTenantId("tenant-b"),
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects aggregate commands without ids before tenant projection updates", async () => {
    const context = BoundedContext.multitenant("Tasks")
      .add(createIdlessCommandProjectionRepository())
      .add(createExecutingProjectionRepository())
      .build();

    await expect(
      context
        .commandBus()
        .post(createIdlessAggregateCommand("task-no-id-tenant", "NoIdTenant", "tenant-a")),
    ).rejects.toThrow(/requires command\.id/);
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-no-id-tenant", {
        tenantId: createTenantId("tenant-a"),
      }),
    ).resolves.toBeUndefined();
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-no-id-tenant", {
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
      context.stand().read(ProjectOverviewStateSchema, "task-blank-id-tenant", {
        tenantId: createTenantId("tenant-a"),
      }),
    ).resolves.toBeUndefined();
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-blank-id-tenant", {
        tenantId: createTenantId("tenant-b"),
      }),
    ).resolves.toBeUndefined();
  });

  it("uses command tenant metadata when stored aggregate events update projections", async () => {
    const context = BoundedContext.multitenant("Tasks")
      .add(createTenantProjectionRepo())
      .add(createExecutingProjectionRepository())
      .build();
    const updates: ProjectOverviewState[] = [];
    context.stand().subscribe(
      ProjectOverviewStateSchema,
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

    const projected = await waitForProjectOverviewState(context, "task-command-tenant", "tenant-a");

    expect(projected).toMatchObject({
      name: "Task (projected)",
      priority: 2,
    });
    expect(updates).toEqual([
      create(ProjectOverviewStateSchema, {
        id: "task-command-tenant",
        name: "Task (projected)",
        priority: 2,
      }),
    ]);
    await expect(
      context.stand().read(ProjectOverviewStateSchema, "task-command-tenant", {
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

    expect("storedEventDispatchFailures" in context).toBe(false);
  });

  it("snapshots stored-event dispatch failures as bounded diagnostics", async () => {
    const thrown = new Error("x".repeat(600));
    thrown.name = "";
    delete thrown.stack;
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingRepository())
      .addEventDispatcher({
        messageSchemas: () => [ProjectCreatedSchema],
        dispatch: () => Promise.reject(thrown),
      })
      .build();

    await expect(
      context
        .commandBus()
        .post(createAggregateCommand("command-non-error-dispatch", "task-non-error-dispatch")),
    ).resolves.toBeUndefined();

    expect("storedEventDispatchFailures" in context).toBe(false);
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

    expect("storedEventDispatchFailures" in context).toBe(false);
  });

  it("records projection updates without version metadata when the delivered event has none", async () => {
    const context = BoundedContext.singleTenant("Tasks")
      .add(createExecutingProjectionRepository())
      .build();

    await context.eventBus().post(
      createProjectCreated("event-without-version", "task-without-version", {
        includeVersion: false,
      }),
    );

    await expect(
      context.stand().readVersioned(ProjectOverviewStateSchema, "task-without-version"),
    ).resolves.toMatchObject({
      state: { name: "Task (projected)" },
    });
    await expect(
      context.stand().readVersioned(ProjectOverviewStateSchema, "task-without-version"),
    ).resolves.not.toHaveProperty("version");
  });

  it("rejects a default-routed Event without a producer ID", () => {
    const repository = createRoutingRepository();

    expect(() =>
      repository.routeEvent(createContextlessProjectCreated("event-no-producer", "field-task")),
    ).toThrow(/producer ID/);
  });

  it("rejects a malformed producer that claims the compatible target type", () => {
    const repository = createRoutingRepository();
    const event = createProjectCreated("event-unreadable-producer", "first-field-task");
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
        createProjectCreated("event-non-finite-producer", "first-field-task", {
          producerNumber: Number.NaN,
        }),
      ).entityIds,
    ).toEqual(["first-field-task"]);
  });

  it("rejects non-finite first-field event IDs", () => {
    const repository = createNonFiniteRouteRepository();

    expect(() =>
      repository.routeEvent(
        create(EventSchema, {
          id: create(EventIdSchema, { value: "event-non-finite-field" }),
          context: create(EventContextSchema, {
            producerId: AnyMessages.pack(UserIdSchema, create(UserIdSchema, { value: "source" })),
            version: create(VersionSchema, { number: 1 }),
          }),
          message: AnyMessages.pack(
            ProjectPriorityChangedSchema,
            create(ProjectPriorityChangedSchema, { id: Number.POSITIVE_INFINITY }),
          ),
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
        .post(createContextlessProjectCreated("event-not-stored", "first-field-task")),
    ).rejects.toThrow(/producer ID/);
    await expect(eventStore.read()).resolves.toEqual([]);
  });

  it("runs repository event acceptance before custom dispatcher acceptance", async () => {
    const factory = new InMemoryStorageFactory();
    const observed: string[] = [];
    const customDispatcher: EventDispatcher = {
      messageSchemas: () => [ProjectCreatedSchema],
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
        .post(createContextlessProjectCreated("event-rejected-before-custom", "first-field-task")),
    ).rejects.toThrow(/producer ID/);
    expect(observed).toEqual([]);
  });

  it("rejects structurally fabricated handler metadata", () => {
    const handlers = EntityHandlers.define(ProjectAggregate, ProjectStateSchema, (builder) => [
      builder.assign(CreateProjectSchema, "createProject"),
    ]);
    const fabricated = { ...handlers } as unknown as EntityHandlersMetadata<
      ProjectAggregate,
      typeof ProjectStateSchema
    >;

    expect(
      () =>
        new Repository({
          entityType: ProjectAggregate,
          schema: ProjectStateSchema,
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
          .post(createProjectCreated("event-missing-method", "task-missing-method")),
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
): Repository<typeof ProjectAggregate> {
  const handlers = EntityHandlers.define(ProjectAggregate, ProjectStateSchema, (builder) => [
    builder.assign(CreateProjectSchema, "createProject"),
    builder.react(ProjectCreatedSchema, "reactToProjection"),
  ]);

  return new Repository({
    entityType: ProjectAggregate,
    schema: ProjectStateSchema,
    handlers,
    ...(commandRouting === undefined ? {} : { commandRouting }),
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createCreateProjectRoutingRepository(
  commandRouting?: CommandRouting<string>,
): Repository<typeof CreateProjectRoutingAggregate> {
  return new Repository({
    entityType: CreateProjectRoutingAggregate,
    schema: ProjectStateSchema,
    handlers: EntityHandlers.define(
      CreateProjectRoutingAggregate,
      ProjectStateSchema,
      (builder) => [builder.assign(CreateProjectSchema, "createProject")],
    ),
    ...(commandRouting === undefined ? {} : { commandRouting }),
  });
}

function createDraftProjectAggregateRepository(): Repository<typeof DraftProjectAggregate> {
  const handlers = EntityHandlers.define(DraftProjectAggregate, ProjectStateSchema, (builder) => [
    builder.assign(DraftProjectSchema, "assign"),
  ]);
  return new Repository({
    entityType: DraftProjectAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createBlankStateIdAggregateRepository(): Repository<typeof BlankStateIdAggregate> {
  return new Repository({
    entityType: BlankStateIdAggregate,
    schema: ProjectStateSchema,
    handlers: EntityHandlers.define(BlankStateIdAggregate, ProjectStateSchema, (builder) => [
      builder.assign(CreateProjectSchema, "assign"),
    ]),
  });
}

function createBlankStateIdProcessManagerRepository(): Repository<
  typeof BlankStateIdProcessManager
> {
  return new Repository({
    entityType: BlankStateIdProcessManager,
    schema: ProjectQueueStateSchema,
    handlers: EntityHandlers.define(
      BlankStateIdProcessManager,
      ProjectQueueStateSchema,
      (builder) => [builder.assign(CreateProjectSchema, "assign")],
    ),
  });
}

function createBlankStateIdProjectionRepository(): Repository<typeof BlankStateIdProjection> {
  return new Repository({
    entityType: BlankStateIdProjection,
    schema: ProjectOverviewStateSchema,
    handlers: EntityHandlers.define(
      BlankStateIdProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectCreatedSchema, "subscribe")],
    ),
  });
}

function createExecutingProjectionRepository(
  eventRouting?: EventRouting<string>,
): Repository<typeof ExecutingTaskProjection> {
  const handlers = EntityHandlers.define(
    ExecutingTaskProjection,
    ProjectOverviewStateSchema,
    (builder) => [builder.subscribe(ProjectCreatedSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: ExecutingTaskProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
    events: [ProjectPriorityChangedSchema],
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function handlerOutcomes(
  returned: readonly GenMessage<Message>[],
  thrown: readonly GenMessage<Message>[] = [],
) {
  return { returned, thrown };
}

function createFilteredProjectionRepository(): Repository<typeof FilteredTaskProjection> {
  const handlers = HandlerMetadataValues.defineArity(
    FilteredTaskProjection,
    ProjectOverviewStateSchema,
    (builder) => [
      builder.subscribe(ProjectCreatedSchema, "subscribeAnnouncements"),
      builder.subscribe(ProjectCreatedSchema, "subscribeFallback"),
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
    schema: ProjectOverviewStateSchema,
    handlers,
  });
}

function createFilteredAggregateRepository(): Repository<typeof FilteredEventAggregate> {
  const handlers = HandlerMetadataValues.defineArity(
    FilteredEventAggregate,
    ProjectStateSchema,
    (builder) => [
      builder.react(ProjectCreatedSchema, "reactAnnouncements"),
      builder.react(ProjectCreatedSchema, "reactFallback"),
    ],
    [
      {
        kind: "event-reaction",
        methodName: "reactAnnouncements",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([ProjectRegisteredSchema]),
        where: { eventField: "name", equals: "announcements" },
      },
      {
        kind: "event-reaction",
        methodName: "reactFallback",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([ProjectRegisteredSchema]),
      },
    ],
  );

  return new Repository({
    entityType: FilteredEventAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createFilteredProcessManagerRepository(): Repository<typeof FilteredProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    FilteredProcessManager,
    ProjectQueueStateSchema,
    (builder) => [
      builder.react(ProjectCreatedSchema, "reactAnnouncements"),
      builder.react(ProjectCreatedSchema, "reactFallback"),
      builder.command(ProjectCreatedSchema, "commandAnnouncements"),
      builder.command(ProjectCreatedSchema, "commandFallback"),
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
        outcomes: handlerOutcomes([CreateProjectSchema]),
        where: { eventField: "name", equals: "announcements" },
      },
      {
        kind: "command-reaction",
        methodName: "commandFallback",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([CreateProjectSchema]),
      },
    ],
  );

  return new Repository({
    entityType: FilteredProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
  });
}

function createSequencedProjectOverviewRepository(
  eventRouting: EventRouting<ProjectSequenceId>,
): Repository<typeof SequencedProjectOverview> {
  const handlers = EntityHandlers.define(
    SequencedProjectOverview,
    SequencedProjectOverviewStateSchema,
    (builder) => [builder.subscribe(SequencedProjectOverviewCreatedSchema, "subscribeState")],
  );

  return new Repository({
    entityType: SequencedProjectOverview,
    schema: SequencedProjectOverviewStateSchema,
    handlers,
    eventRouting,
  });
}

function createProjectMilestoneProjectionRepository(
  eventRouting?: EventRouting<ProjectMilestoneId>,
  stateUpdateRouting?: StateUpdateRouting<ProjectMilestoneId>,
): Repository<typeof ProjectMilestoneProjection> {
  const handlers = EntityHandlers.define(
    ProjectMilestoneProjection,
    ProjectMilestoneOverviewStateSchema,
    (builder) => [
      builder.subscribe(ProjectMilestoneAddedSchema, "subscribe"),
      builder.subscribe(ProjectMilestoneSourceStateSchema, "subscribe"),
    ],
  );
  return new Repository({
    entityType: ProjectMilestoneProjection,
    schema: ProjectMilestoneOverviewStateSchema,
    handlers,
    ...(eventRouting === undefined ? {} : { eventRouting }),
    ...(stateUpdateRouting === undefined ? {} : { stateUpdateRouting }),
  });
}

function createProjectMilestoneAggregateRepository(
  commandRouting?: CommandRouting<ProjectMilestoneId>,
): Repository<typeof ProjectMilestoneAggregate> {
  const handlers = EntityHandlers.define(
    ProjectMilestoneAggregate,
    ProjectMilestoneStateSchema,
    (builder) => [builder.assign(AddProjectMilestoneSchema, "assign")],
  );

  return new Repository({
    entityType: ProjectMilestoneAggregate,
    schema: ProjectMilestoneStateSchema,
    handlers,
    ...(commandRouting === undefined ? {} : { commandRouting }),
  });
}

function createRegisteredProjectAggregateRepository(): Repository<
  typeof RegisteredProjectAggregate
> {
  const handlers = EntityHandlers.define(
    RegisteredProjectAggregate,
    RegisteredProjectStateSchema,
    (builder) => [builder.assign(RegisterProjectSchema, "assign")],
  );

  return new Repository({
    entityType: RegisteredProjectAggregate,
    schema: RegisteredProjectStateSchema,
    handlers,
  });
}

function createProjectMilestoneProcessManagerRepository(
  eventRouting?: EventRouting<ProjectMilestoneId>,
  options: { readonly doubleDispatchGuard?: boolean; readonly produces?: boolean } = {},
  commandRouting?: CommandRouting<ProjectMilestoneId>,
): Repository<typeof ProjectMilestoneProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    ProjectMilestoneProcessManager,
    ProjectMilestoneWorkflowStateSchema,
    (builder) =>
      options.produces === true
        ? [
            builder.assign(AddProjectMilestoneSchema, "assignAndProduce"),
            builder.react(ProjectMilestoneAddedSchema, "react"),
          ]
        : [builder.react(ProjectMilestoneAddedSchema, "react")],
    options.produces === true
      ? [
          {
            kind: "command-assignment",
            methodName: "assignAndProduce",
            parameterCount: 1,
            origin: "domestic",
            outcomes: handlerOutcomes([ProjectMilestoneAddedSchema]),
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
    entityType: ProjectMilestoneProcessManager,
    schema: ProjectMilestoneWorkflowStateSchema,
    handlers,
    ...(eventRouting === undefined ? {} : { eventRouting }),
    ...(commandRouting === undefined ? {} : { commandRouting }),
    ...(options.doubleDispatchGuard === true
      ? { processManagerEventHistory: true, doubleDispatchGuard: true }
      : {}),
  });
}

function createManagedProjection(): Repository<typeof ManagedTaskProjection> {
  const handlers = EntityHandlers.define(
    ManagedTaskProjection,
    ProjectOverviewStateSchema,
    (builder) => [builder.subscribe(ProjectCreatedSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: ManagedTaskProjection,
    schema: ProjectOverviewStateSchema,
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
    ProjectOverviewStateSchema,
    (builder) => [builder.subscribe(ProjectCreatedSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: BlockingCatchUpProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
  });
}

function createGeneratedTwoArgProjectionRepository(
  eventRouting?: EventRouting<string>,
): Repository<typeof GeneratedTwoArgProjection> {
  const handlers = new HandlerRegistryIngestor().ingest({
    receivers: [
      {
        receiverKind: "entity",
        receiverType: GeneratedTwoArgProjection,
        stateSchema: ProjectOverviewStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "subscribeTask",
            input: { schema: ProjectCreatedSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 2,
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<GeneratedTwoArgProjection, typeof ProjectOverviewStateSchema>;

  return new Repository({
    entityType: GeneratedTwoArgProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createRejectionObservingRepository(
  eventRouting?: EventRouting<string>,
): Repository<typeof RejectionObservingProjection> {
  const handlers = new HandlerRegistryIngestor().ingest({
    receivers: [
      {
        receiverKind: "entity",
        receiverType: RejectionObservingProjection,
        stateSchema: ProjectOverviewStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "mutate",
            input: { schema: TaskAlreadyDoneSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 2,
          },
          {
            kind: "event-subscription",
            methodName: "observe",
            input: { schema: TaskAlreadyDoneSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 2,
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<RejectionObservingProjection, typeof ProjectOverviewStateSchema>;

  return new Repository({
    entityType: RejectionObservingProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createContextMutatingGeneratedProjectionRepository(): Repository<
  typeof ContextMutatingGeneratedProjection
> {
  const handlers = new HandlerRegistryIngestor().ingest({
    receivers: [
      {
        receiverKind: "entity",
        receiverType: ContextMutatingGeneratedProjection,
        stateSchema: ProjectOverviewStateSchema,
        handlers: [
          {
            kind: "event-subscription",
            methodName: "mutateContext",
            input: { schema: ProjectCreatedSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 2,
          },
          {
            kind: "event-subscription",
            methodName: "observeContext",
            input: { schema: ProjectCreatedSchema, origin: "domestic" },
            outcomes: { returned: [], thrown: [] },
            parameterCount: 2,
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<
    ContextMutatingGeneratedProjection,
    typeof ProjectOverviewStateSchema
  >;

  return new Repository({
    entityType: ContextMutatingGeneratedProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
  });
}

function createUserIdProjectionRepository(): Repository<typeof UserIdProjection> {
  const handlers = EntityHandlers.define(
    UserIdProjection,
    ProjectOverviewStateSchema,
    (builder) => [builder.subscribe(ProjectCreatedSchema, "subscribeUser")],
  );

  return new Repository({
    entityType: UserIdProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
  });
}

function createNonFiniteRouteRepository(): Repository<typeof NonFiniteRouteProjection> {
  const handlers = EntityHandlers.define(
    NonFiniteRouteProjection,
    ProjectOverviewStateSchema,
    (builder) => [builder.subscribe(ProjectPriorityChangedSchema, "subscribeNumber")],
  );

  return new Repository({
    entityType: NonFiniteRouteProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
  });
}

function createProjectIdTaskRepository(): Repository<typeof ProjectIdProjectAggregate> {
  const handlers = EntityHandlers.define(ProjectIdProjectAggregate, TaskSchema, (builder) => [
    builder.apply(TaskCreatedSchema, "applyTaskCreated"),
    builder.apply(ProjectMemberChangedSchema, "applyWrongId"),
  ]);

  return new Repository({
    entityType: ProjectIdProjectAggregate,
    schema: TaskSchema,
    handlers,
  });
}

function createInt32RoutingRepository(
  commandRouting?: CommandRouting<number>,
): Repository<typeof NumberedProjectAggregate> {
  const handlers = EntityHandlers.define(
    NumberedProjectAggregate,
    NumberedProjectStateSchema,
    (builder) => [
      builder.assign(CreateNumberedProjectSchema, "assign"),
      builder.react(NumberedProjectCreatedSchema, "react"),
    ],
  );
  return new Repository({
    entityType: NumberedProjectAggregate,
    schema: NumberedProjectStateSchema,
    handlers,
    events: [NumberedProjectCreatedSchema],
    ...(commandRouting === undefined ? {} : { commandRouting }),
  });
}

function createInt64RoutingRepository(): Repository<typeof ProjectWorkflow> {
  const handlers = EntityHandlers.define(ProjectWorkflow, ProjectWorkflowStateSchema, (builder) => [
    builder.assign(ScheduleProjectWorkflowSchema, "assign"),
    builder.react(ProjectWorkflowScheduledSchema, "react"),
  ]);
  return new Repository({
    entityType: ProjectWorkflow,
    schema: ProjectWorkflowStateSchema,
    handlers,
  });
}

function createMalformedFirstFieldRepository(): Repository<typeof MalformedFirstFieldAggregate> {
  const handlers = EntityHandlers.define(
    MalformedFirstFieldAggregate,
    ProjectStateSchema,
    (builder) => [
      builder.assign(InviteProjectMembersSchema, "assignRepeated"),
      builder.assign(AssignProjectAttributesSchema, "assignMap"),
    ],
  );
  return new Repository({
    entityType: MalformedFirstFieldAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createProjectIdProducingRepository(
  commandRouting?: CommandRouting<TaskId>,
): Repository<typeof ProjectIdProducingAggregate> {
  const handlers = EntityHandlers.define(ProjectIdProducingAggregate, TaskSchema, (builder) => [
    builder.assign(CreateTaskSchema, "assignTask"),
  ]);

  return new Repository({
    entityType: ProjectIdProducingAggregate,
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
    ProjectOverviewStateSchema,
    (builder) => [builder.subscribe(TaskCreatedSchema, "subscribeTaskCreated")],
  );

  return new Repository({
    entityType: TaskCreatedScalarProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
  });
}

function createCreateTaskScalarAggregateRepository(
  commandRouting?: CommandRouting<string>,
): Repository<typeof CreateTaskScalarAggregate> {
  const handlers = EntityHandlers.define(
    CreateTaskScalarAggregate,
    ProjectStateSchema,
    (builder) => [builder.assign(CreateTaskSchema, "assignCreateTask")],
  );

  return new Repository({
    entityType: CreateTaskScalarAggregate,
    schema: ProjectStateSchema,
    handlers,
    ...(commandRouting === undefined ? {} : { commandRouting }),
  });
}

function createPassiveProjectionRepository(): Repository<typeof PassiveTaskProjection> {
  const handlers = EntityHandlers.define(
    PassiveTaskProjection,
    ProjectOverviewStateSchema,
    (builder) => [builder.subscribe(ProjectCreatedSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: PassiveTaskProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
  });
}

function createAccumulatingProjectionRepository(): Repository<typeof AccumulatingTaskProjection> {
  const handlers = EntityHandlers.define(
    AccumulatingTaskProjection,
    ProjectOverviewStateSchema,
    (builder) => [builder.subscribe(ProjectCreatedSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: AccumulatingTaskProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
  });
}

function createReactingProjectionRepository(): Repository<typeof ReactingTaskProjection> {
  const handlers = EntityHandlers.define(
    ReactingTaskProjection,
    ProjectOverviewStateSchema,
    (builder) => [builder.react(ProjectCreatedSchema, "reactTask")],
  );

  return new Repository({
    entityType: ReactingTaskProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
  });
}

function createExecutingRepository(): Repository<typeof ExecutingProjectAggregate> {
  const handlers = HandlerMetadataValues.defineArity(
    ExecutingProjectAggregate,
    ProjectStateSchema,
    (builder) => [builder.assign(CreateProjectSchema, "createProject")],
    [
      {
        kind: "command-assignment",
        methodName: "createProject",
        parameterCount: 1,
        outcomes: handlerOutcomes([ProjectCreatedSchema], [TaskAlreadyDoneSchema]),
      },
    ],
  );

  return new Repository({
    entityType: ExecutingProjectAggregate,
    schema: ProjectStateSchema,
    handlers,
    events: [ProjectCreatedSchema, TaskAlreadyDoneSchema],
  });
}

function createManagedRepository(): Repository<typeof ManagedProjectAggregate> {
  const handlers = HandlerMetadataValues.defineArity(
    ManagedProjectAggregate,
    ProjectStateSchema,
    (builder) => [builder.assign(CreateProjectSchema, "createProject")],
    [
      {
        kind: "command-assignment",
        methodName: "createProject",
        parameterCount: 1,
        outcomes: handlerOutcomes([ProjectCreatedSchema], [TaskAlreadyDoneSchema]),
      },
    ],
  );

  return new Repository({
    entityType: ManagedProjectAggregate,
    schema: ProjectStateSchema,
    handlers,
    events: [ProjectCreatedSchema, TaskAlreadyDoneSchema],
  });
}

function createProjectIdRejectingRepository(): Repository<typeof ProjectIdRejectingAggregate> {
  const handlers = HandlerMetadataValues.defineArity(
    ProjectIdRejectingAggregate,
    TaskSchema,
    (builder) => [builder.assign(CreateTaskSchema, "createProject")],
    [
      {
        kind: "command-assignment",
        methodName: "createProject",
        parameterCount: 1,
        outcomes: handlerOutcomes([], [TaskAlreadyDoneSchema]),
      },
    ],
  );

  return new Repository({
    entityType: ProjectIdRejectingAggregate,
    schema: TaskSchema,
    handlers,
    events: [TaskCreatedSchema],
  });
}

function createGeneratedTwoArgAggregateRepository(): Repository<typeof GeneratedTwoArgAggregate> {
  const handlers = new HandlerRegistryIngestor().ingest({
    receivers: [
      {
        receiverKind: "entity",
        receiverType: GeneratedTwoArgAggregate,
        stateSchema: ProjectStateSchema,
        handlers: [
          {
            kind: "command-assignment",
            methodName: "createProject",
            input: { schema: CreateProjectSchema, origin: "domestic" },
            outcomes: handlerOutcomes([ProjectCreatedSchema], [TaskAlreadyDoneSchema]),
            parameterCount: 2,
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<GeneratedTwoArgAggregate, typeof ProjectStateSchema>;

  return new Repository({
    entityType: GeneratedTwoArgAggregate,
    schema: ProjectStateSchema,
    handlers,
    events: [ProjectCreatedSchema, TaskAlreadyDoneSchema],
  });
}

function createGeneratedReactorRepository(
  guarded = false,
): Repository<typeof ProjectRegistrationReactorAggregate> {
  const handlers = new HandlerRegistryIngestor().ingest({
    receivers: [
      {
        receiverKind: "entity",
        receiverType: ProjectRegistrationReactorAggregate,
        stateSchema: ProjectStateSchema,
        handlers: [
          {
            kind: "event-reaction",
            methodName: "reactProjection",
            input: { schema: ProjectCreatedSchema, origin: "domestic" },
            outcomes: { returned: [ProjectRegisteredSchema], thrown: [] },
            parameterCount: 2,
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<ProjectRegistrationReactorAggregate, typeof ProjectStateSchema>;

  return new Repository({
    entityType: ProjectRegistrationReactorAggregate,
    schema: ProjectStateSchema,
    handlers,
    events: [ProjectRegisteredSchema],
    ...(guarded ? { doubleDispatchGuard: { depth: 1 } } : {}),
  });
}

function createGuardedAggregateRepository(
  eventRouting?: EventRouting<string>,
): Repository<typeof GuardedAggregate> {
  const handlers = HandlerMetadataValues.defineArity(
    GuardedAggregate,
    ProjectStateSchema,
    (builder) => [builder.react(ProjectCreatedSchema, "reactProjection")],
    [
      {
        kind: "event-reaction",
        methodName: "reactProjection",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([ProjectCreatedSchema]),
      },
    ],
  );

  return new Repository({
    entityType: GuardedAggregate,
    schema: ProjectStateSchema,
    handlers,
    doubleDispatchGuard: { depth: 1 },
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createProducingGuardedAggregateRepository(): Repository<typeof ProducingGuardedAggregate> {
  const handlers = HandlerMetadataValues.defineArity(
    ProducingGuardedAggregate,
    ProjectStateSchema,
    (builder) => [builder.react(ProjectCreatedSchema, "reactProjection")],
    [
      {
        kind: "event-reaction",
        methodName: "reactProjection",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([ProjectRegisteredSchema]),
      },
    ],
  );

  return new Repository({
    entityType: ProducingGuardedAggregate,
    schema: ProjectStateSchema,
    handlers,
    events: [ProjectRegisteredSchema],
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

function createGeneratedCommandingRepository(): Repository<
  typeof GeneratedCommandingProcessManager
> {
  const handlers = new HandlerRegistryIngestor().ingest({
    receivers: [
      {
        receiverKind: "entity",
        receiverType: GeneratedCommandingProcessManager,
        stateSchema: ProjectQueueStateSchema,
        handlers: [
          {
            kind: "command-reaction",
            methodName: "commandProjection",
            input: { schema: ProjectCreatedSchema, origin: "domestic" },
            outcomes: { returned: [CreateFollowUpProjectSchema], thrown: [] },
            parameterCount: 2,
          },
        ],
      },
    ],
  })[0] as EntityHandlersMetadata<
    GeneratedCommandingProcessManager,
    typeof ProjectQueueStateSchema
  >;

  return new Repository({
    entityType: GeneratedCommandingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
  });
}

function createMultiManagedRepository(): Repository<typeof MultiManagedAggregate> {
  const handlers = EntityHandlers.define(MultiManagedAggregate, ProjectStateSchema, (builder) => [
    builder.assign(CreateProjectSchema, "createProject"),
  ]);

  return new Repository({
    entityType: MultiManagedAggregate,
    schema: ProjectStateSchema,
    handlers,
    events: [ProjectCreatedSchema],
  });
}

function createEmptyManagedRepository(): Repository<typeof EmptyManagedAggregate> {
  const handlers = EntityHandlers.define(EmptyManagedAggregate, ProjectStateSchema, (builder) => [
    builder.assign(CreateProjectSchema, "createProject"),
  ]);

  return new Repository({
    entityType: EmptyManagedAggregate,
    schema: ProjectStateSchema,
    handlers,
    events: [ProjectCreatedSchema],
  });
}

function createEnvelopeManagedRepository(): Repository<typeof EnvelopeManagedAggregate> {
  const handlers = EntityHandlers.define(
    EnvelopeManagedAggregate,
    ProjectStateSchema,
    (builder) => [builder.assign(CreateProjectSchema, "createProject")],
  );

  return new Repository({
    entityType: EnvelopeManagedAggregate,
    schema: ProjectStateSchema,
    handlers,
    events: [ProjectCreatedSchema],
  });
}

function createValidatingRepository(): Repository<typeof ValidatingProjectAggregate> {
  const handlers = EntityHandlers.define(
    ValidatingProjectAggregate,
    ProjectSubmissionStateSchema,
    (builder) => [
      builder.assign(CreateProjectSubmissionSchema, "createProject"),
      builder.apply(ProjectSubmissionCreatedSchema, "applyTask"),
    ],
  );

  return new Repository({
    entityType: ValidatingProjectAggregate,
    schema: ProjectSubmissionStateSchema,
    handlers,
  });
}

function createProjectSubmissionIdRouteRepository(
  commandRouting?: CommandRouting<ProjectSubmissionId>,
): Repository<typeof ProjectSubmissionIdRouteAggregate> {
  const handlers = EntityHandlers.define(
    ProjectSubmissionIdRouteAggregate,
    ProjectSubmissionIdStateSchema,
    (builder) => [builder.assign(CreateProjectSubmissionSchema, "createProject")],
  );

  return new Repository({
    entityType: ProjectSubmissionIdRouteAggregate,
    schema: ProjectSubmissionIdStateSchema,
    handlers,
    ...(commandRouting === undefined ? {} : { commandRouting }),
  });
}

function createValidatingProcessManagerRepository(): Repository<typeof ValidatingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    ValidatingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.assign(CreateProjectSubmissionSchema, "createProject")],
    [
      {
        kind: "command-assignment",
        methodName: "createProject",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([ProjectCreatedSchema]),
      },
    ],
  );

  return new Repository({
    entityType: ValidatingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
  });
}

function createTransitionViolatingRepository(): Repository<typeof TransitionViolatingAggregate> {
  const handlers = EntityHandlers.define(
    TransitionViolatingAggregate,
    ProjectStateSchema,
    (builder) => [builder.assign(CreateProjectSchema, "createProject")],
  );

  return new Repository({
    entityType: TransitionViolatingAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createRecoveringTransitionRepository(): Repository<typeof RecoveringTransitionAggregate> {
  const handlers = EntityHandlers.define(
    RecoveringTransitionAggregate,
    ProjectStateSchema,
    (builder) => [builder.assign(CreateProjectSchema, "createProject")],
  );

  return new Repository({
    entityType: RecoveringTransitionAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createAsyncAssigneeRepository(): Repository<typeof AsyncAssigneeAggregate> {
  const handlers = EntityHandlers.define(AsyncAssigneeAggregate, ProjectStateSchema, (builder) => [
    builder.assign(CreateProjectSchema, "createProject"),
  ]);

  return new Repository({
    entityType: AsyncAssigneeAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createRejectedAsyncAssigneeRepository(): Repository<
  typeof RejectedAsyncAssigneeAggregate
> {
  const handlers = EntityHandlers.define(
    RejectedAsyncAssigneeAggregate,
    ProjectStateSchema,
    (builder) => [builder.assign(CreateProjectSchema, "createProject")],
  );

  return new Repository({
    entityType: RejectedAsyncAssigneeAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createSerialAsyncAssigneeRepository(): Repository<typeof SerialAsyncAssigneeAggregate> {
  const handlers = EntityHandlers.define(
    SerialAsyncAssigneeAggregate,
    ProjectStateSchema,
    (builder) => [builder.assign(CreateProjectSchema, "createProject")],
  );

  return new Repository({
    entityType: SerialAsyncAssigneeAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createBigintVersionRepository(): Repository<typeof BigintVersionAggregate> {
  const handlers = EntityHandlers.define(BigintVersionAggregate, ProjectStateSchema, (builder) => [
    builder.assign(CreateProjectSchema, "createProject"),
    builder.apply(ProjectCreatedSchema, "applyTask"),
  ]);

  return new Repository({
    entityType: BigintVersionAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createProjectionProducingRepository(): Repository<typeof ProjectionProducingAggregate> {
  const handlers = EntityHandlers.define(
    ProjectionProducingAggregate,
    ProjectStateSchema,
    (builder) => [
      builder.assign(CreateProjectSchema, "createProject"),
      builder.apply(ProjectCreatedSchema, "applyProjection"),
    ],
  );

  return new Repository({
    entityType: ProjectionProducingAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createTenantProjectionRepo(): Repository<
  typeof CommandTenantProjectionProducingAggregate
> {
  const handlers = EntityHandlers.define(
    CommandTenantProjectionProducingAggregate,
    ProjectStateSchema,
    (builder) => [
      builder.assign(CreateProjectSchema, "createProject"),
      builder.apply(ProjectCreatedSchema, "applyProjection"),
    ],
  );

  return new Repository({
    entityType: CommandTenantProjectionProducingAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createProcessManagerAssignRepository(
  commandRouting?: CommandRouting<string>,
): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.assign(CreateProjectSchema, "createProject")],
    [
      {
        kind: "command-assignment",
        methodName: "createProject",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([ProjectCreatedSchema], [TaskAlreadyDoneSchema]),
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
    events: [ProjectCreatedSchema, TaskAlreadyDoneSchema],
    ...(commandRouting === undefined ? {} : { commandRouting }),
  });
}

function createIdlessCommandProcessManagerRepository(): Repository<
  typeof IdlessCommandProcessManager
> {
  return new Repository({
    entityType: IdlessCommandProcessManager,
    schema: ProjectQueueStateSchema,
    handlers: EntityHandlers.define(
      IdlessCommandProcessManager,
      ProjectQueueStateSchema,
      (builder) => [builder.assign(CreateProjectSchema, "createProject")],
    ),
  });
}

function createIdlessCommandProjectionRepository(): Repository<
  typeof IdlessCommandProjectionAggregate
> {
  return new Repository({
    entityType: IdlessCommandProjectionAggregate,
    schema: ProjectStateSchema,
    handlers: EntityHandlers.define(
      IdlessCommandProjectionAggregate,
      ProjectStateSchema,
      (builder) => [builder.assign(CreateProjectSchema, "createProject")],
    ),
  });
}

function createProcessManagerReactRepository(
  eventRouting?: EventRouting<string>,
): Repository<typeof RoutingProcessManager> {
  const handlers = EntityHandlers.define(
    RoutingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.react(ProjectCreatedSchema, "reactTask")],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createProcessManagerCommandAndReactRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [
      builder.assign(CreateProjectSchema, "createProject"),
      builder.react(ProjectCreatedSchema, "reactTask"),
    ],
    [
      {
        kind: "command-assignment",
        methodName: "createProject",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([ProjectCreatedSchema]),
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
    schema: ProjectQueueStateSchema,
    handlers,
  });
}

function createDiagnosticOnlyProcessManagerRepository(): Repository<
  typeof DiagnosticOnlyProcessManager
> {
  const handlers = HandlerMetadataValues.defineArity(
    DiagnosticOnlyProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.assign(CreateProjectSchema, "createProject")],
    [
      {
        kind: "command-assignment",
        methodName: "createProject",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([ProjectCreatedSchema]),
      },
    ],
  );

  return new Repository({
    entityType: DiagnosticOnlyProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
    events: [ProjectCreatedSchema],
    processManagerEventHistory: true,
  });
}

function createGuardedProcessManagerReactRepository(
  depth = 100,
): Repository<typeof RoutingProcessManager> {
  const handlers = EntityHandlers.define(
    RoutingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.react(ProjectCreatedSchema, "reactTask")],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
    processManagerEventHistory: true,
    doubleDispatchGuard: { depth },
  });
}

function createInboxCheckRepo(): Repository<typeof InboxCheckingProcessManager> {
  const handlers = EntityHandlers.define(
    InboxCheckingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.react(ProjectCreatedSchema, "reactTask")],
  );

  return new Repository({
    entityType: InboxCheckingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
  });
}

function createBlockingPmRepo(): Repository<typeof BlockingProcessManager> {
  const handlers = EntityHandlers.define(
    BlockingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.react(ProjectCreatedSchema, "reactTask")],
  );

  return new Repository({
    entityType: BlockingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
  });
}

function createGuardedBlockingPmRepo(depth = 100): Repository<typeof BlockingProcessManager> {
  const handlers = EntityHandlers.define(
    BlockingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.react(ProjectCreatedSchema, "reactTask")],
  );

  return new Repository({
    entityType: BlockingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
    processManagerEventHistory: true,
    doubleDispatchGuard: { depth },
  });
}

function createSplitPmRepo(): Repository<typeof SplitRouteProcessManager> {
  const handlers = EntityHandlers.define(
    SplitRouteProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.react(ProjectCreatedSchema, "reactTask")],
  );

  return new Repository({
    entityType: SplitRouteProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
  });
}

function createGuardedSplitPmRepo(
  eventRouting?: EventRouting<string>,
): Repository<typeof SplitRouteProcessManager> {
  const handlers = EntityHandlers.define(
    SplitRouteProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.react(ProjectCreatedSchema, "reactTask")],
  );
  return new Repository({
    entityType: SplitRouteProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
    processManagerEventHistory: true,
    doubleDispatchGuard: true,
    ...(eventRouting === undefined ? {} : { eventRouting }),
  });
}

function createProcessManagerEventRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [
      builder.react(ProjectCreatedSchema, "reactTask"),
      builder.command(ProjectCreatedSchema, "commandProject"),
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
        methodName: "commandProject",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([CreateProjectSchema]),
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
  });
}

function createProcessManagerEventProducingRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.react(ProjectCreatedSchema, "reactTaskWithEvent")],
    [
      {
        kind: "event-reaction",
        methodName: "reactTaskWithEvent",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([ProjectRegisteredSchema]),
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
  });
}

function createProcessManagerCommandOnlyRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.command(ProjectCreatedSchema, "commandProject")],
    [
      {
        kind: "command-reaction",
        methodName: "commandProject",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([CreateProjectSchema]),
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
  });
}

function createCommandSubstitutingProcessManagerRepository(): Repository<
  typeof CommandSubstitutingProcessManager
> {
  const handlers = HandlerMetadataValues.defineArity(
    CommandSubstitutingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.substitute(CreateProjectSubmissionSchema, "substitute")],
    [
      {
        kind: "command-substitution",
        methodName: "substitute",
        parameterCount: 2,
        origin: "domestic",
        outcomes: handlerOutcomes([CreateFollowUpProjectSchema]),
      },
    ],
  );

  return new Repository({
    entityType: CommandSubstitutingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
    commandRouting: CommandRouting.create<string>().route(
      CreateProjectSubmissionSchema,
      () => "transform-target",
    ),
  });
}

function createGuardedProcessManagerCommandOnlyRepository(): Repository<
  typeof RoutingProcessManager
> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.command(ProjectCreatedSchema, "commandProject")],
    [
      {
        kind: "command-reaction",
        methodName: "commandProject",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([CreateProjectSchema]),
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
    processManagerEventHistory: true,
    doubleDispatchGuard: true,
  });
}

function createProcessManagerMixedEventRepository(): Repository<typeof RoutingProcessManager> {
  const handlers = HandlerMetadataValues.defineArity(
    RoutingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [
      builder.react(ProjectCreatedSchema, "reactTaskWithEvent"),
      builder.command(ProjectCreatedSchema, "commandProject"),
    ],
    [
      {
        kind: "event-reaction",
        methodName: "reactTaskWithEvent",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([ProjectRegisteredSchema]),
      },
      {
        kind: "command-reaction",
        methodName: "commandProject",
        parameterCount: 1,
        origin: "domestic",
        outcomes: handlerOutcomes([CreateProjectSchema]),
      },
    ],
  );

  return new Repository({
    entityType: RoutingProcessManager,
    schema: ProjectQueueStateSchema,
    handlers,
  });
}

function createMissingSubscriberRepo(): Repository<typeof MissingSubscriberMethodProjection> {
  const handlers = EntityHandlers.define(
    MissingSubscriberMethodProjection,
    ProjectOverviewStateSchema,
    (builder) => [builder.subscribe(ProjectCreatedSchema, "missingSubscriber")],
  );

  return new Repository({
    entityType: MissingSubscriberMethodProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
  });
}

function createThrowingProjectionRepository(): Repository<typeof ThrowingTaskProjection> {
  const handlers = EntityHandlers.define(
    ThrowingTaskProjection,
    ProjectOverviewStateSchema,
    (builder) => [builder.subscribe(ProjectCreatedSchema, "subscribeTask")],
  );

  return new Repository({
    entityType: ThrowingTaskProjection,
    schema: ProjectOverviewStateSchema,
    handlers,
  });
}

function createNoApplierRepository(): Repository<typeof NoApplierAggregate> {
  const handlers = EntityHandlers.define(NoApplierAggregate, ProjectStateSchema, (builder) => [
    builder.assign(CreateProjectSchema, "createProject"),
    builder.react(ProjectCreatedSchema, "reactTask"),
  ]);

  return new Repository({
    entityType: NoApplierAggregate,
    schema: ProjectStateSchema,
    handlers,
    events: [ProjectCreatedSchema],
  });
}

function createMalformedEventRepository(): Repository<typeof MalformedEventAggregate> {
  const handlers = EntityHandlers.define(MalformedEventAggregate, ProjectStateSchema, (builder) => [
    builder.assign(CreateProjectSchema, "createProject"),
    builder.apply(ProjectCreatedSchema, "applyTask"),
  ]);

  return new Repository({
    entityType: MalformedEventAggregate,
    schema: ProjectStateSchema,
    handlers,
  });
}

function createAggregateEvent(
  id: string,
  aggregateId: string,
  version: number,
  name = "Task",
): SpineEvent {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(
        StringValueSchema,
        create(StringValueSchema, { value: aggregateId }),
      ),
      timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
      version: create(VersionSchema, { number: version }),
    }),
    message: AnyMessages.pack(
      ProjectCreatedSchema,
      create(ProjectCreatedSchema, {
        id: aggregateId,
        name,
        priority: 1,
      }),
    ),
  });
}

function createProjectRegistered(
  id: string,
  aggregateId: string,
  version: number,
  name = "Task",
): SpineEvent {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(
        StringValueSchema,
        create(StringValueSchema, { value: aggregateId }),
      ),
      timestamp: create(TimestampSchema, { seconds: BigInt(version) }),
      version: create(VersionSchema, { number: version }),
    }),
    message: AnyMessages.pack(
      ProjectRegisteredSchema,
      create(ProjectRegisteredSchema, { id: aggregateId, name, priority: 1 }),
    ),
  });
}

function createAggregateCommand(id: string, aggregateId: string, name = "Task", tenantId?: string) {
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
      CreateProjectSchema,
      create(CreateProjectSchema, {
        id: aggregateId,
        name,
      }),
    ),
  });
}

function createGeneratedCreateProject(
  id: string,
  aggregateId: string,
  name = "Task",
  tenantId?: string,
) {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        ...(tenantId === undefined
          ? {}
          : { tenantId: create(TenantIdSchema, { kind: { case: "value", value: tenantId } }) }),
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    message: AnyMessages.pack(
      CreateProjectSchema,
      create(CreateProjectSchema, { id: aggregateId, name }),
    ),
  });
}

function createDraftProject(commandId: string, entityId: string) {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: commandId }),
    context: create(CommandContextSchema),
    message: AnyMessages.pack(
      DraftProjectSchema,
      create(DraftProjectSchema, { id: entityId, name: "Implicit" }),
    ),
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

function createContextlessGeneratedCreateProject(id: string, aggregateId: string, name = "Task") {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: id }),
    message: AnyMessages.pack(
      CreateProjectSchema,
      create(CreateProjectSchema, { id: aggregateId, name }),
    ),
  });
}

function createCreateProject(id: string, taskId: string, title = "Task") {
  return create(CommandSchema, {
    id: create(CommandIdSchema, { uuid: id }),
    context: create(CommandContextSchema, {
      actorContext: create(ActorContextSchema, {
        actor: create(UserIdSchema, { value: "user-1" }),
      }),
    }),
    message: AnyMessages.pack(
      CreateTaskSchema,
      create(CreateTaskSchema, {
        id: create(TaskIdSchema, { value: taskId }),
        taskListId: create(TodoTaskListIdSchema, { value: "task-list" }),
        title,
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
      CreateProjectSubmissionSchema,
      create(CreateProjectSubmissionSchema, {
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
      CreateProjectSchema,
      create(CreateProjectSchema, { id: aggregateId, name }),
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
      targetTypeUrl: overrides.targetTypeUrl ?? TypeUrls.derive(ProjectQueueStateSchema),
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
        Identifiers.pack("string", overrides.targetId ?? readProjectOverviewId(event)),
      targetTypeUrl: overrides.targetTypeUrl ?? TypeUrls.derive(ProjectQueueStateSchema),
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
      : AnyMessages.unpack(command.message, CreateProjectSchema);

  if (message === undefined) {
    const validated =
      command.message === undefined
        ? undefined
        : AnyMessages.unpack(command.message, CreateProjectSubmissionSchema);
    if (validated === undefined) {
      throw new Error("Expected a readable process-manager command payload.");
    }
    return validated.id;
  }

  return message.id;
}

function readProjectOverviewId(event: SpineEvent): string {
  const message =
    event.message === undefined
      ? undefined
      : AnyMessages.unpack(event.message, ProjectCreatedSchema);

  if (message === undefined) {
    throw new Error("Expected a readable process-manager event payload.");
  }

  return message.id;
}

function createValidatedEvent(id: string, aggregateId: string, name: string): SpineEvent {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    context: create(EventContextSchema, {
      producerId: AnyMessages.pack(
        StringValueSchema,
        create(StringValueSchema, { value: aggregateId }),
      ),
      timestamp: create(TimestampSchema, { seconds: 1n }),
      version: create(VersionSchema, { number: 1 }),
    }),
    message: AnyMessages.pack(
      ProjectSubmissionCreatedSchema,
      create(ProjectSubmissionCreatedSchema, {
        id: aggregateId,
        name,
      }),
    ),
  });
}

function createProjectCreated(
  id: string,
  entityId: string,
  options: {
    readonly producerId?: string;
    readonly name?: string;
    readonly producerNumber?: number;
    readonly importTenantId?: string;
    readonly importTenantKind?: TenantKind;
    readonly pastMessageTenantId?: string;
    readonly pastMessageTenantKind?: TenantKind;
    readonly includeVersion?: boolean;
    readonly version?: import("@spine-event-engine/proto").Version;
  } = {},
) {
  const origin = projectionEventOrigin(options);

  return create(EventSchema, {
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
    message: AnyMessages.pack(
      ProjectCreatedSchema,
      create(ProjectCreatedSchema, {
        id: entityId,
        name: options.name ?? "Task",
        priority: 1,
      }),
    ),
  });
}

function createContextlessProjectCreated(id: string, entityId: string) {
  return create(EventSchema, {
    id: create(EventIdSchema, { value: id }),
    message: AnyMessages.pack(
      ProjectCreatedSchema,
      create(ProjectCreatedSchema, {
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
          typeUrl: TypeUrls.derive(CreateProjectSchema),
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
}) {
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

async function waitForProjectOverviewState(
  context: BoundedContext,
  id: string,
  tenantId?: string,
): Promise<ProjectOverviewState | undefined> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    const state = await context
      .stand()
      .read(
        ProjectOverviewStateSchema,
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

  constructor(
    private readonly failRead = false,
    private readonly hideGuardHistory = false,
  ) {
    super();
  }

  override createEntityStorage(input: unknown): unknown {
    const storage = super.createEntityStorage(input) as {
      readonly current: {
        read(id: unknown): Promise<unknown>;
        write(record: unknown): Promise<void>;
      };
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
    let readCurrent = false;

    return {
      current: {
        read: async (id: unknown) => {
          readCurrent = true;
          return storage.current.read(id);
        },
        write: (record: unknown) => storage.current.write(record),
      },
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
          if (this.hideGuardHistory && !readCurrent) return Promise.resolve([]);
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
    RepositoryOptions<typeof ProjectAggregate>["stateUpdateRouting"]
  >().toEqualTypeOf<undefined>();
  expect(
    () =>
      new Repository({
        entityType: ProjectAggregate,
        schema: ProjectStateSchema,
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
        schema: ProjectQueueStateSchema,
        stateUpdateRouting: StateUpdateRouting.create<string>(),
      } as never),
  ).toThrow(/State-update routing is supported only by Projection repositories/);
});

it("rejects Entity state subscribers outside Projection repositories", () => {
  const aggregateHandlers = EntityHandlers.define(
    ProjectAggregate,
    ProjectStateSchema,
    (builder) => [builder.subscribe(ProjectOverviewStateSchema, "reactToProjection")],
  );
  const processManagerHandlers = EntityHandlers.define(
    RoutingProcessManager,
    ProjectQueueStateSchema,
    (builder) => [builder.subscribe(ProjectOverviewStateSchema, "reactTask")],
  );

  expect(
    () =>
      new Repository({
        entityType: ProjectAggregate,
        schema: ProjectStateSchema,
        handlers: aggregateHandlers,
      }),
  ).toThrow(/Entity state subscriptions are supported only by Projection repositories/);
  expect(
    () =>
      new Repository({
        entityType: RoutingProcessManager,
        schema: ProjectQueueStateSchema,
        handlers: processManagerHandlers,
      }),
  ).toThrow(/Entity state subscriptions are supported only by Projection repositories/);
});

describe("Projection state-update routing", () => {
  it("rejects a recursive subscription to the repository state", () => {
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectOverviewStateSchema, "subscribeState")],
    );

    expect(
      () =>
        new Repository({
          entityType: StateObservingProjection,
          schema: ProjectOverviewStateSchema,
          handlers,
        }),
    ).toThrow(/cannot subscribe to updates of its repository state/);
  });

  it("rejects a feedback cycle between Projection state subscriptions", () => {
    const projectionHandlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectBacklogStateSchema, "subscribeState")],
    );
    const neutralProjectionHandlers = EntityHandlers.define(
      ProjectBacklogProjection,
      ProjectBacklogStateSchema,
      (builder) => [builder.subscribe(ProjectOverviewStateSchema, "subscribeState")],
    );
    const projection = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectOverviewStateSchema,
      handlers: projectionHandlers,
    });
    const neutralProjection = new Repository({
      entityType: ProjectBacklogProjection,
      schema: ProjectBacklogStateSchema,
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
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectBacklogStateSchema, "subscribeState")],
    );
    const context = BoundedContext.singleTenant("One-way state subscription")
      .add(
        new Repository({
          entityType: StateObservingProjection,
          schema: ProjectOverviewStateSchema,
          handlers,
        }),
      )
      .add(
        new Repository({
          entityType: ProjectBacklogProjection,
          schema: ProjectBacklogStateSchema,
        }),
      )
      .build();

    await context.close();
  });

  it("uses the first compatible state field and ignores unrelated state types", () => {
    const handlers = EntityHandlers.define(
      ExecutingTaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeTask")],
    );
    const repository = new Repository({
      entityType: ExecutingTaskProjection,
      schema: ProjectOverviewStateSchema,
      handlers,
    });

    expect(
      repositoryAccess.routeStateUpdate(repository, createStateChangedEvent("state-1")),
    ).toMatchObject({
      entityIds: ["state-1"],
      messageFullTypeName: ProjectStateSchema.typeName,
    });
    expect(
      repositoryAccess.routeStateUpdate(
        repository,
        createStateChangedEvent("other", create(ProjectOverviewStateSchema, { id: "other" })),
      ),
    ).toBeUndefined();
  });

  it("rejects an empty first compatible field instead of routing by a later field", () => {
    const handlers = EntityHandlers.define(
      ExecutingTaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeTask")],
    );
    const repository = new Repository({
      entityType: ExecutingTaskProjection,
      schema: ProjectOverviewStateSchema,
      handlers,
    });

    expect(() =>
      repositoryAccess.routeStateUpdate(
        repository,
        createStateChangedEvent(
          "empty-id",
          create(ProjectStateSchema, { id: "", name: "not-an-id" }),
        ),
      ),
    ).toThrow(/state update routing requires an ID compatible with the Entity state/);
  });

  it("rejects construction when the built-in route has no compatible state field", () => {
    const handlers = EntityHandlers.define(
      SequencedProjectOverview,
      SequencedProjectOverviewStateSchema,
      (builder) => [builder.subscribe(NumberedProjectStateSchema, "subscribeState")],
    );

    expect(
      () =>
        new Repository({
          entityType: SequencedProjectOverview,
          schema: SequencedProjectOverviewStateSchema,
          handlers,
        }),
    ).toThrow(/no compatible field.*NumberedProjectState/i);
  });

  it("uses a declaration-first message ID compatible with the Projection ID", () => {
    const handlers = EntityHandlers.define(
      SequencedProjectOverview,
      SequencedProjectOverviewStateSchema,
      (builder) => [builder.subscribe(SequencedProjectSourceStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: SequencedProjectOverview,
      schema: SequencedProjectOverviewStateSchema,
      handlers,
    });
    const id = create(ProjectSequenceIdSchema, { value: 42n });

    expect(
      repositoryAccess.routeStateUpdate(
        repository,
        createStateChangedEvent(
          "int64-message",
          create(SequencedProjectSourceStateSchema, { id, name: "Message ID" }),
        ),
      )?.entityIds,
    ).toEqual([id]);
  });

  it("evaluates an exact multicast route once and stably deduplicates targets", () => {
    const route = vi.fn(() => ["second", "first", "second"]);
    const handlers = EntityHandlers.define(
      ExecutingTaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeTask")],
    );
    const repository = new Repository({
      entityType: ExecutingTaskProjection,
      schema: ProjectOverviewStateSchema,
      handlers,
      stateUpdateRouting: StateUpdateRouting.create<string>().route(ProjectStateSchema, route),
    });

    const result = repositoryAccess.routeStateUpdate(repository, createStateChangedEvent("source"));

    expect(route).toHaveBeenCalledOnce();
    expect(result?.entityIds).toEqual(["second", "first"]);
    expect(Object.isFrozen(result?.entityIds)).toBe(true);
  });

  it("selects exact state routes before replacement defaults", () => {
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeState")],
    );
    const event = createStateChangedEvent("built-in");
    const cases = [
      StateUpdateRouting.create<string>()
        .route(ProjectStateSchema, () => ["exact"])
        .replaceDefault(() => ["replacement"]),
      StateUpdateRouting.create<string>().replaceDefault(() => ["replacement"]),
    ];

    expect(
      cases.map(
        (stateUpdateRouting) =>
          repositoryAccess.routeStateUpdate(
            new Repository({
              entityType: StateObservingProjection,
              schema: ProjectOverviewStateSchema,
              handlers,
              stateUpdateRouting,
            }),
            event,
          )?.entityIds,
      ),
    ).toEqual([["exact"], ["replacement"]]);
  });

  it("selects a state interface route after exact routes and before the default", () => {
    const token = MessageInterfaces.define<object, readonly [typeof ProjectStateSchema]>([
      ProjectStateSchema,
    ]);
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectOverviewStateSchema,
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
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectOverviewStateSchema,
      handlers,
    });
    expect(() =>
      repositoryAccess.routeStateUpdate(repository, createProjectCreated("domain", "target")),
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
            typeUrl: TypeUrls.derive(ProjectStateSchema),
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
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectOverviewStateSchema,
      handlers,
      stateUpdateRouting: StateUpdateRouting.create<string>().route(ProjectStateSchema, route),
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
    const token = MessageInterfaces.define<object, readonly [typeof ProjectStateSchema]>([
      ProjectStateSchema,
    ]);
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectOverviewStateSchema,
      handlers,
      stateUpdateRouting: StateUpdateRouting.create<string>().route(token, route),
    });
    const context = BoundedContext.singleTenant("State updates").add(repository).build();

    try {
      await boundedContextAccess.postSystemEvent(
        context,
        createStateChangedEvent(
          "source",
          create(ProjectStateSchema, { id: "source", name: "Source" }),
        ),
      );

      expect(route).toHaveBeenCalledOnce();
      expect(StateObservingProjection.subscriberCalls).toBe(2);
      await expect(
        context.stand().read(ProjectOverviewStateSchema, "first"),
      ).resolves.toMatchObject({
        id: "first",
        name: "Source (projected)",
        priority: 1,
      });
      await expect(
        context.stand().read(ProjectOverviewStateSchema, "second"),
      ).resolves.toMatchObject({
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
      ProjectOverviewStateSchema,
      (builder) => [
        builder.subscribe(ProjectStateSchema, "domesticState"),
        builder.subscribe(ProjectStateSchema, "externalState"),
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
      schema: ProjectOverviewStateSchema,
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
    const token = MessageInterfaces.define<object, readonly [typeof ProjectStateSchema]>([
      ProjectStateSchema,
    ]);
    const factory = new InMemoryStorageFactory();
    const handlers = EntityHandlers.define(
      PassiveTaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: PassiveTaskProjection,
      schema: ProjectOverviewStateSchema,
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
          inboxId: { ...stored.inboxId, targetTypeUrl: TypeUrls.derive(ProjectStateSchema) },
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
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: StateObservingProjection,
      schema: ProjectOverviewStateSchema,
      handlers,
      stateUpdateRouting: StateUpdateRouting.create<string>().route(ProjectStateSchema, route),
    });
    const context = BoundedContext.singleTenant("Empty state updates").add(repository).build();

    try {
      await boundedContextAccess.postSystemEvent(context, createStateChangedEvent("source"));

      expect(route).toHaveBeenCalledOnce();
      expect(StateObservingProjection.subscriberCalls).toBe(0);
      await expect(
        context.stand().read(ProjectOverviewStateSchema, "source"),
      ).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });

  it("handles direct System dispatch before binding and suppresses unrelated state after binding", async () => {
    PassiveTaskProjection.reset();
    const handlers = EntityHandlers.define(
      PassiveTaskProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeState")],
    );
    const repository = new Repository({
      entityType: PassiveTaskProjection,
      schema: ProjectOverviewStateSchema,
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
        create(ProjectOverviewStateSchema, { id: "unrelated-system" }),
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
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeState")],
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
        schema: ProjectOverviewStateSchema,
        handlers,
        stateUpdateRouting: StateUpdateRouting.create<string>().route(ProjectStateSchema, route),
      });
      const context = BoundedContext.singleTenant("Invalid state route").add(repository).build();
      try {
        await expect(boundedContextAccess.postSystemEvent(context, event)).resolves.toBeUndefined();
        expect(StateObservingProjection.subscriberCalls).toBe(0);
        await expect(
          context.stand().read(ProjectOverviewStateSchema, "valid"),
        ).resolves.toBeUndefined();
      } finally {
        await context.close();
      }
    }
  });

  it("rejects exact routes for state schemas without a subscriber", () => {
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeState")],
    );

    expect(
      () =>
        new Repository({
          entityType: StateObservingProjection,
          schema: ProjectOverviewStateSchema,
          handlers,
          stateUpdateRouting: StateUpdateRouting.create<string>().route(
            NumberedProjectStateSchema,
            () => ["target"],
          ),
        }),
    ).toThrow(/unregistered exact route/);
  });

  it("keeps durable state updates within the originating tenant", async () => {
    StateObservingProjection.reset();
    const handlers = EntityHandlers.define(
      StateObservingProjection,
      ProjectOverviewStateSchema,
      (builder) => [builder.subscribe(ProjectStateSchema, "subscribeState")],
    );
    const context = BoundedContext.multitenant("Tenant state updates")
      .add(
        new Repository({
          entityType: StateObservingProjection,
          schema: ProjectOverviewStateSchema,
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
          create(ProjectStateSchema, { id: "shared", name: "Tenant A" }),
          "tenant-a",
        ),
      );
      await expect(
        context
          .stand()
          .read(ProjectOverviewStateSchema, "shared", { tenantId: createTenantId("tenant-a") }),
      ).resolves.toMatchObject({ name: "Tenant A (projected)" });
      await expect(
        context
          .stand()
          .read(ProjectOverviewStateSchema, "shared", { tenantId: createTenantId("tenant-b") }),
      ).resolves.toBeUndefined();
      await expect(
        boundedContextAccess.postSystemEvent(context, createStateChangedEvent("missing-tenant")),
      ).resolves.toBeUndefined();
    } finally {
      await context.close();
    }
  });
});

function createStateChangedEvent(
  id: string,
  state: Message = create(ProjectStateSchema, { id }),
  tenantId?: string,
) {
  const stateSchema =
    state.$typeName === ProjectStateSchema.typeName
      ? ProjectStateSchema
      : state.$typeName === SequencedProjectSourceStateSchema.typeName
        ? SequencedProjectSourceStateSchema
        : state.$typeName === ProjectMilestoneSourceStateSchema.typeName
          ? ProjectMilestoneSourceStateSchema
          : ProjectOverviewStateSchema;
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
