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

import { clone, create } from "@bufbuild/protobuf";
import {
  Aggregate,
  Assign,
  BoundedContext,
  EventRouting,
  Projection,
  Server,
  Subscribe,
  type RunningServer,
} from "@spine-event-engine/server";
import { type EventContext, UserIdSchema, type UserId } from "@spine-event-engine/proto";

import {
  type CompleteTask,
  type CreateTask,
  type AssignTask,
  type ReassignTask,
  type RenameTask,
  type ReopenTask,
  type UnassignTask,
} from "../generated/spine/examples/todo/task_commands_pb.js";
import {
  TaskCreatedSchema,
  TaskAssignedSchema,
  TaskCompletedSchema,
  TaskReassignedSchema,
  TaskRenamedSchema,
  TaskReopenedSchema,
  TaskUnassignedSchema,
  type TaskAssigned as TaskAssignedEvent,
  type TaskCompleted,
  type TaskCreated,
  type TaskReassigned as TaskReassignedEvent,
  type TaskRenamed,
  type TaskReopened,
  type TaskUnassigned as TaskUnassignedEvent,
} from "../generated/spine/examples/todo/task_events_pb.js";
import {
  TaskIdSchema,
  TaskListIdSchema,
  type TaskId,
  type TaskListId,
} from "../generated/spine/examples/todo/task_id_pb.js";
import { TaskAssigneeSchema } from "../generated/spine/examples/todo/task_assignee_pb.js";
import { TaskListSchema } from "../generated/spine/examples/todo/task_list_pb.js";
import {
  TaskAlreadyAssigned,
  TaskAlreadyDone,
  TaskNotAssigned,
  TaskNotDone,
} from "../generated/spine/examples/todo/task_rejections.js";
import type {
  TaskAlreadyAssigned as TaskAlreadyAssignedMessage,
  TaskAlreadyDone as TaskAlreadyDoneMessage,
  TaskNotAssigned as TaskNotAssignedMessage,
  TaskNotDone as TaskNotDoneMessage,
} from "../generated/spine/examples/todo/task_rejections_pb.js";
import {
  TaskAlreadyAssignedSchema,
  TaskAlreadyDoneSchema,
  TaskNotAssignedSchema,
  TaskNotDoneSchema,
} from "../generated/spine/examples/todo/task_rejections_pb.js";
import { TaskSchema } from "../generated/spine/examples/todo/tasks_pb.js";
import { TaskAssignmentEvent as TaskAssignmentEventToken } from "../generated/interfaces/task-assignment-event.js";
import { TaskEvent } from "../generated/interfaces/task-event.js";
import { TodoProcessSignals } from "./process.js";

export { todoProtoModule } from "../generated/proto-module.js";

/**
 * Common authored shape for task-assignment lifecycle Events.
 *
 * Assignment and unassignment use the same assignee target, while reassignment
 * remains an exact-schema two-target route.
 */
export interface TaskAssignmentEvent {
  // prettier-ignore

  /**
   * Describes the assignee selected by the assignment lifecycle Event.
   */
  readonly assignee?: UserId | undefined;
}

/**
 * Task aggregate for the create-task example flow.
 */
export class TaskAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  // prettier-ignore

  /**
   * Creates a task and produces its stored domain event.
   *
   * @param command The command that supplies the task title.
   * @returns The event that records the created task.
   */
  @Assign
  createTask(command: CreateTask): TaskCreated {
    const id = clone(TaskIdSchema, this.id);
    const taskListId = taskListIds.require(command.taskListId);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskSchema, {
          id,
          title: command.title,
          completed: false,
          taskListId,
        }),
      ),
    );
    return create(TaskCreatedSchema, {
      id,
      taskListId,
      title: command.title,
    });
  }

  /**
   * Updates a task title and produces its stored domain event.
   *
   * @param command The command that supplies the replacement title.
   * @returns The event that records the task rename.
   */
  @Assign
  renameTask(command: RenameTask): TaskRenamed {
    const id = clone(TaskIdSchema, this.id);
    const taskListId = taskListIds.require(this.state.taskListId);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskSchema, {
          id,
          title: command.title,
          completed: draft.completed,
          taskListId,
          assignee: draft.assignee,
        }),
      ),
    );
    return create(TaskRenamedSchema, {
      id,
      taskListId,
      title: command.title,
    });
  }

  /**
   * Completes a task and produces its stored domain event.
   *
   * @param command The command that requests task completion.
   * @returns The event that records the task completion.
   */
  @Assign
  completeTask(command: CompleteTask): TaskCompleted {
    void command;
    const id = clone(TaskIdSchema, this.id);
    const taskListId = taskListIds.require(this.state.taskListId);
    if (this.state.completed) {
      throw TaskAlreadyDone.create({ id });
    }

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskSchema, {
          id,
          title: draft.title,
          completed: true,
          taskListId,
          assignee: draft.assignee,
        }),
      ),
    );
    return create(TaskCompletedSchema, { id, taskListId });
  }

  /**
   * Marks a task open and produces its stored domain event.
   *
   * @param command The command that requests task reopening.
   * @returns The event that records the task reopening.
   */
  @Assign
  reopenTask(command: ReopenTask): TaskReopened {
    void command;
    const id = clone(TaskIdSchema, this.id);
    const taskListId = taskListIds.require(this.state.taskListId);
    if (!this.state.completed) {
      throw TaskNotDone.create({ id });
    }

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskSchema, {
          id,
          title: draft.title,
          completed: false,
          taskListId,
          assignee: draft.assignee,
        }),
      ),
    );
    return create(TaskReopenedSchema, { id, taskListId });
  }

  /**
   * Records a task assignment and its assignee.
   *
   * @param command The command that selects the assignee.
   * @returns The event that records the assignment.
   */
  @Assign
  assignTask(command: AssignTask): TaskAssignedEvent {
    const id = clone(TaskIdSchema, this.id);
    const taskListId = taskListIds.require(this.state.taskListId);
    const assignee = assignees.require(command.assignee);
    if (this.state.completed) throw TaskAlreadyDone.create({ id });
    if (this.state.assignee !== undefined) {
      throw TaskAlreadyAssigned.create({ id, assignee: this.state.assignee, taskListId });
    }
    this.update((draft) =>
      Object.assign(draft, create(TaskSchema, { ...draft, id, taskListId, assignee })),
    );
    return create(TaskAssignedSchema, { id, taskListId, assignee });
  }

  /**
   * Records a task reassignment and both assignee targets.
   *
   * @param command The command that selects the replacement assignee.
   * @returns The event that records the reassignment.
   */
  @Assign
  reassignTask(command: ReassignTask): TaskReassignedEvent {
    const id = clone(TaskIdSchema, this.id);
    const taskListId = taskListIds.require(this.state.taskListId);
    const assignee = assignees.require(command.assignee);
    if (this.state.completed) throw TaskAlreadyDone.create({ id });
    if (this.state.assignee === undefined) throw TaskNotAssigned.create({ id, taskListId });
    const previousAssignee = assignees.require(this.state.assignee);
    if (previousAssignee.value === assignee.value) {
      throw TaskAlreadyAssigned.create({ id, assignee: previousAssignee, taskListId });
    }
    this.update((draft) =>
      Object.assign(draft, create(TaskSchema, { ...draft, id, taskListId, assignee })),
    );
    return create(TaskReassignedSchema, { id, taskListId, previousAssignee, assignee });
  }

  /**
   * Removes a task assignee and records the former target.
   *
   * @param command The command that requests unassignment.
   * @returns The event that records the unassignment.
   */
  @Assign
  unassignTask(command: UnassignTask): TaskUnassignedEvent {
    void command;
    const id = clone(TaskIdSchema, this.id);
    const taskListId = taskListIds.require(this.state.taskListId);
    if (this.state.completed) throw TaskAlreadyDone.create({ id });
    if (this.state.assignee === undefined) throw TaskNotAssigned.create({ id, taskListId });
    const assignee = assignees.require(this.state.assignee);
    this.update((draft) =>
      Object.assign(draft, create(TaskSchema, { ...draft, id, taskListId, assignee: undefined })),
    );
    return create(TaskUnassignedSchema, { id, taskListId, assignee });
  }
}

/**
 * Read-side task list projection for visible task queries.
 */
export class TaskListProjection extends Projection<TaskListId, typeof TaskListSchema, number> {
  // prettier-ignore

  /**
   * Observes a rejection for completing an already complete task.
   *
   * @param rejection The rejection that identifies the completed task.
   * @param context The event context that marks the rejection.
   */
  @Subscribe
  onTaskAlreadyDone(rejection: TaskAlreadyDoneMessage, context: EventContext): void {
    void taskIds.require(rejection.id);
    void context.rejection;
  }

  /**
   * Observes a rejection for reopening an open task.
   *
   * @param rejection The rejection that identifies the open task.
   */
  @Subscribe
  onTaskNotDone(rejection: TaskNotDoneMessage): void {
    void taskIds.require(rejection.id);
  }

  /**
   * Observes an assignment request that conflicts with the current assignee.
   *
   * @param rejection The rejection that identifies the task, assignee, and list.
   */
  @Subscribe
  onTaskAlreadyAssigned(rejection: TaskAlreadyAssignedMessage): void {
    void taskIds.require(rejection.id);
    void taskListIds.require(rejection.taskListId);
  }

  /**
   * Observes an assignment operation for a task without an assignee.
   *
   * @param rejection The rejection that identifies the task and list.
   */
  @Subscribe
  onTaskNotAssigned(rejection: TaskNotAssignedMessage): void {
    void taskIds.require(rejection.id);
    void taskListIds.require(rejection.taskListId);
  }

  /**
   * Adds a created task to the read-side list.
   *
   * @param event The event that supplies the new task details.
   */
  @Subscribe
  onTaskCreated(event: TaskCreated): void {
    const id = taskIds.require(event.id);
    const taskListId = taskListIds.require(event.taskListId);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskListSchema, {
          id: clone(TaskListIdSchema, taskListId),
          tasks: [
            ...draft.tasks,
            create(TaskSchema, {
              id: clone(TaskIdSchema, id),
              title: event.title,
              completed: false,
              taskListId: clone(TaskListIdSchema, taskListId),
            }),
          ],
          openTaskCount: draft.openTaskCount + 1,
        }),
      ),
    );
  }

  /**
   * Updates an existing task in the read-side list.
   *
   * @param event The event that supplies the replacement title.
   */
  @Subscribe
  onTaskRenamed(event: TaskRenamed): void {
    const id = taskIds.require(event.id);
    const taskListId = taskListIds.require(event.taskListId);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskListSchema, {
          id: clone(TaskListIdSchema, taskListId),
          tasks: draft.tasks.map((task) =>
            task.id?.value === id.value
              ? create(TaskSchema, {
                  id: clone(TaskIdSchema, id),
                  title: event.title,
                  completed: task.completed,
                  taskListId: clone(TaskListIdSchema, taskListId),
                  assignee: task.assignee,
                })
              : task,
          ),
          openTaskCount: draft.openTaskCount,
        }),
      ),
    );
  }

  /**
   * Marks an existing task completed in the read-side list.
   *
   * @param event The event that identifies the completed task.
   */
  @Subscribe
  onTaskCompleted(event: TaskCompleted): void {
    const id = taskIds.require(event.id);
    const taskListId = taskListIds.require(event.taskListId);

    this.update((draft) => {
      const tasks = draft.tasks.map((task) =>
        task.id?.value === id.value
          ? create(TaskSchema, {
              id: clone(TaskIdSchema, id),
              title: task.title,
              completed: true,
              taskListId: clone(TaskListIdSchema, taskListId),
              assignee: task.assignee,
            })
          : clone(TaskSchema, task),
      );
      Object.assign(
        draft,
        create(TaskListSchema, {
          id: clone(TaskListIdSchema, taskListId),
          tasks,
          openTaskCount: tasks.filter((task) => !task.completed).length,
        }),
      );
    });
  }

  /**
   * Marks an existing task open in the read-side list.
   *
   * @param event The event that identifies the reopened task.
   */
  @Subscribe
  onTaskReopened(event: TaskReopened): void {
    const id = taskIds.require(event.id);
    const taskListId = taskListIds.require(event.taskListId);

    this.update((draft) => {
      const tasks = draft.tasks.map((task) =>
        task.id?.value === id.value
          ? create(TaskSchema, {
              id: clone(TaskIdSchema, id),
              title: task.title,
              completed: false,
              taskListId: clone(TaskListIdSchema, taskListId),
              assignee: task.assignee,
            })
          : clone(TaskSchema, task),
      );
      Object.assign(
        draft,
        create(TaskListSchema, {
          id: clone(TaskListIdSchema, taskListId),
          tasks,
          openTaskCount: tasks.filter((task) => !task.completed).length,
        }),
      );
    });
  }

  /**
   * Records an assignment in the list view.
   *
   * @param event The assignment event to apply.
   */
  @Subscribe
  onTaskAssigned(event: TaskAssignedEvent): void {
    this.updateTaskAssignee(event.id, event.taskListId, event.assignee);
  }

  /**
   * Records a reassignment in the list view.
   *
   * @param event The reassignment event to apply.
   */
  @Subscribe
  onTaskReassigned(event: TaskReassignedEvent): void {
    this.updateTaskAssignee(event.id, event.taskListId, event.assignee);
  }

  /**
   * Removes an assignee in the list view.
   *
   * @param event The unassignment event to apply.
   */
  @Subscribe
  onTaskUnassigned(event: TaskUnassignedEvent): void {
    this.updateTaskAssignee(event.id, event.taskListId, undefined);
  }

  private updateTaskAssignee(
    id: TaskId | undefined,
    taskListId: TaskListId | undefined,
    assignee: UserId | undefined,
  ): void {
    const taskId = taskIds.require(id);
    const listId = taskListIds.require(taskListId);
    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskListSchema, {
          id: clone(TaskListIdSchema, listId),
          tasks: draft.tasks.map((task) =>
            task.id?.value === taskId.value
              ? create(TaskSchema, {
                  id: clone(TaskIdSchema, taskId),
                  title: task.title,
                  completed: task.completed,
                  taskListId: clone(TaskListIdSchema, listId),
                  assignee: assignee === undefined ? undefined : clone(UserIdSchema, assignee),
                })
              : clone(TaskSchema, task),
          ),
          openTaskCount: draft.openTaskCount,
        }),
      ),
    );
  }
}

/**
 * Tracks task identifiers currently assigned to one user.
 */
export class TaskAssigneeProjection extends Projection<UserId, typeof TaskAssigneeSchema, number> {
  // prettier-ignore

  /**
   * Adds a task to the assignee view.
   *
   * @param event The assignment event to apply.
   */
  @Subscribe
  onTaskAssigned(event: TaskAssignedEvent): void {
    const id = taskIds.require(event.id);
    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskAssigneeSchema, {
          id: clone(UserIdSchema, this.id),
          taskIds: [...draft.taskIds, id],
        }),
      ),
    );
  }

  /**
   * Removes a task from the former assignee view.
   *
   * @param event The unassignment event to apply.
   */
  @Subscribe
  onTaskUnassigned(event: TaskUnassignedEvent): void {
    this.remove(event.id);
  }

  /**
   * Adds or removes a task according to the exact reassignment target.
   *
   * @param event The reassignment event to apply.
   */
  @Subscribe
  onTaskReassigned(event: TaskReassignedEvent): void {
    const id = taskIds.require(event.id);
    const isReplacement = this.id.value === event.assignee?.value;
    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskAssigneeSchema, {
          id: clone(UserIdSchema, this.id),
          taskIds: isReplacement
            ? [...draft.taskIds, id]
            : draft.taskIds.filter((taskId) => taskId.value !== id.value),
        }),
      ),
    );
  }

  private remove(id: TaskId | undefined): void {
    const taskId = taskIds.require(id);
    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskAssigneeSchema, {
          id: clone(UserIdSchema, this.id),
          taskIds: draft.taskIds.filter((value) => value.value !== taskId.value),
        }),
      ),
    );
  }
}

/**
 * Creates the in-memory single-tenant Tasks bounded context.
 *
 * @param options Optionally supplies the application-owned subscription registry.
 * @returns The assembled Tasks bounded context.
 */
export async function createTodoContext(
  options: {
    readonly subscriptionRegistry?: import("@spine-event-engine/server").StandSubscriptionRegistry;
  } = {},
): Promise<BoundedContext> {
  const taskListRouting = EventRouting.create<TaskListId>()
    .route(TaskEvent, (event) => [taskListIds.require(event.taskListId)])
    .route(TaskAlreadyDoneSchema, (event) => taskListIds.fromTaskId(event.id))
    .route(TaskNotDoneSchema, (event) => taskListIds.fromTaskId(event.id))
    .route(TaskAlreadyAssignedSchema, (event) => [taskListIds.require(event.taskListId)])
    .route(TaskNotAssignedSchema, (event) => [taskListIds.require(event.taskListId)]);
  const assigneeRouting = EventRouting.create<UserId>()
    .route(TaskAssignmentEventToken, (event) => [assignees.require(event.assignee)])
    .route(TaskReassignedSchema, (event) => {
      return [assignees.require(event.previousAssignee), assignees.require(event.assignee)];
    });
  const builder = BoundedContext.singleTenant("Tasks")
    .withGeneratedRegistryRoot(new URL("..", import.meta.url))
    .add(TaskAggregate)
    .add(TaskListProjection, { eventRouting: taskListRouting })
    .add(TaskAssigneeProjection, { eventRouting: assigneeRouting });
  if (options.subscriptionRegistry !== undefined)
    builder.withSubscriptionRegistry(options.subscriptionRegistry);
  return builder.buildAsync();
}

/**
 * Options for the standalone to-do example server.
 */
export interface TodoServerOptions {
  // prettier-ignore

  /**
   * Host passed to Node's HTTP/2 listener. Defaults to `127.0.0.1`.
   */
  readonly host?: string;

  /**
   * Port passed to Node's HTTP/2 listener. Defaults to `8080`; use `0` for a free port.
   */
  readonly port?: number;
}

/**
 * Running standalone to-do example server.
 */
export type TodoServer = RunningServer;

/**
 * Starts the standalone to-do example server with in-memory storage.
 *
 * @param options Optional listener host and port overrides.
 * @returns The running server, which callers must close when finished.
 */
export async function startTodoServer(options: TodoServerOptions = {}): Promise<TodoServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8080;
  return Server.atPort(port, { host })
    .add(await createTodoContext())
    .start();
}

const taskIds = {
  require(id: TaskId | undefined): TaskId {
    if (id === undefined) {
      throw new Error("Framework-provided task ID is missing.");
    }

    return clone(TaskIdSchema, id);
  },
};

const taskListIds = {
  require(id: TaskListId | undefined): TaskListId {
    if (id === undefined) throw new Error("Task list ID is missing.");
    return clone(TaskListIdSchema, id);
  },

  fromTaskId(id: TaskId | undefined): readonly TaskListId[] {
    if (id === undefined) return [];
    return [create(TaskListIdSchema, { value: id.value })];
  },
};

const assignees = {
  require(id: UserId | undefined): UserId {
    if (id === undefined) throw new Error("Task assignee is missing.");
    return clone(UserIdSchema, id);
  },
};

const todoEntrypoint = {
  isCurrentModule(): boolean {
    return (
      process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], "file:").href
    );
  },
};

if (todoEntrypoint.isCurrentModule()) {
  startTodoServer()
    .then((server) => {
      console.log(`To-do example server listening at ${server.baseUrl}`);
      TodoProcessSignals.install(server);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
