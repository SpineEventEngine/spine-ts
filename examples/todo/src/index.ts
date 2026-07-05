import { clone, create } from "@bufbuild/protobuf";
import { packEvent } from "@spine-ts/core";
import { EventContextSchema, EventIdSchema, type Event } from "@spine-ts/proto";
import {
  Aggregate,
  Apply,
  Assign,
  BoundedContext,
  CommandRefusalError,
  Projection,
  Repository,
  Subscribe,
  materializeDecoratedEntityHandlers,
} from "@spine-ts/server";

import {
  CompleteTaskSchema,
  CreateTaskSchema,
  RenameTaskSchema,
  ReopenTaskSchema,
  type CompleteTask,
  type CreateTask,
  type RenameTask,
  type ReopenTask,
} from "../generated/spine/example/todo/v1/task_commands_pb.js";
import {
  TaskCreatedSchema,
  TaskCompletedSchema,
  TaskRenamedSchema,
  TaskReopenedSchema,
  type TaskCompleted,
  type TaskCreated,
  type TaskRenamed,
  type TaskReopened,
} from "../generated/spine/example/todo/v1/task_events_pb.js";
import { TaskIdSchema, type TaskId } from "../generated/spine/example/todo/v1/task_id_pb.js";
import { TaskListSchema } from "../generated/spine/example/todo/v1/task_list_pb.js";
import { TaskSchema } from "../generated/spine/example/todo/v1/tasks_pb.js";

/** Event-sourced task aggregate for the create-task example flow. */
export class TaskAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  /** Handle `CreateTask` and produce the domain event stored by the context. */
  @Assign(CreateTaskSchema)
  createTask(command: CreateTask): Event {
    const id = requireTaskId(command.id);

    return packEvent({
      id: create(EventIdSchema, { value: this.nextEventId("task-created", id) }),
      context: create(EventContextSchema),
      schema: TaskCreatedSchema,
      message: create(TaskCreatedSchema, {
        id,
        title: command.title,
      }),
    });
  }

  /** Handle `RenameTask` and produce the event stored by the context. */
  @Assign(RenameTaskSchema)
  renameTask(command: RenameTask): Event {
    const id = requireTaskId(command.id);

    return packEvent({
      id: create(EventIdSchema, { value: this.nextEventId("task-renamed", id) }),
      context: create(EventContextSchema),
      schema: TaskRenamedSchema,
      message: create(TaskRenamedSchema, {
        id,
        title: command.title,
      }),
    });
  }

  /** Handle `CompleteTask` and produce the event stored by the context. */
  @Assign(CompleteTaskSchema)
  completeTask(command: CompleteTask): Event {
    const id = requireTaskId(command.id);
    if (this.state.completed) {
      throw new CommandRefusalError("TASK_ALREADY_DONE", "Task is already done.");
    }

    return packEvent({
      id: create(EventIdSchema, { value: this.nextEventId("task-completed", id) }),
      context: create(EventContextSchema),
      schema: TaskCompletedSchema,
      message: create(TaskCompletedSchema, {
        id,
      }),
    });
  }

  /** Handle `ReopenTask` and produce the event stored by the context. */
  @Assign(ReopenTaskSchema)
  reopenTask(command: ReopenTask): Event {
    const id = requireTaskId(command.id);
    if (!this.state.completed) {
      throw new CommandRefusalError("TASK_NOT_DONE", "Task is not done.");
    }

    return packEvent({
      id: create(EventIdSchema, { value: this.nextEventId("task-reopened", id) }),
      context: create(EventContextSchema),
      schema: TaskReopenedSchema,
      message: create(TaskReopenedSchema, {
        id,
      }),
    });
  }

  /** Apply `TaskCreated` to the aggregate state. */
  @Apply(TaskCreatedSchema)
  onTaskCreated(event: TaskCreated): void {
    const id = requireTaskId(event.id);

    this.startTransaction();
    this.updateDraftState(() =>
      create(TaskSchema, {
        id,
        title: event.title,
        completed: false,
      }),
    );
    this.commitTransaction();
  }

  /** Apply `TaskRenamed` to the aggregate state. */
  @Apply(TaskRenamedSchema)
  onTaskRenamed(event: TaskRenamed): void {
    const id = requireTaskId(event.id);

    this.startTransaction();
    this.updateDraftState((state) =>
      create(TaskSchema, {
        id,
        title: event.title,
        completed: state.completed,
      }),
    );
    this.commitTransaction();
  }

  /** Apply `TaskCompleted` to the aggregate state. */
  @Apply(TaskCompletedSchema)
  onTaskCompleted(event: TaskCompleted): void {
    const id = requireTaskId(event.id);

    this.startTransaction();
    this.updateDraftState((state) =>
      create(TaskSchema, {
        id,
        title: state.title,
        completed: true,
      }),
    );
    this.commitTransaction();
  }

  /** Apply `TaskReopened` to the aggregate state. */
  @Apply(TaskReopenedSchema)
  onTaskReopened(event: TaskReopened): void {
    const id = requireTaskId(event.id);

    this.startTransaction();
    this.updateDraftState((state) =>
      create(TaskSchema, {
        id,
        title: state.title,
        completed: false,
      }),
    );
    this.commitTransaction();
  }

  private nextEventId(prefix: string, id: TaskId): string {
    return `${prefix}-${id.value}-${String(this.version + 1n)}`;
  }
}

/** Read-side task list projection for visible task queries. */
export class TaskListProjection extends Projection<string, typeof TaskListSchema, number> {
  /** Add newly created tasks to the read-side list. */
  @Subscribe(TaskCreatedSchema)
  onTaskCreated(event: TaskCreated): void {
    const id = requireTaskId(event.id);

    this.startTransaction();
    this.updateDraftState((state) =>
      create(TaskListSchema, {
        id: id.value,
        tasks: [
          ...state.tasks,
          create(TaskSchema, {
            id: clone(TaskIdSchema, id),
            title: event.title,
            completed: false,
          }),
        ],
        openTaskCount: state.openTaskCount + 1,
      }),
    );
    this.commitTransaction();
  }

  /** Rename an existing task in the read-side list. */
  @Subscribe(TaskRenamedSchema)
  onTaskRenamed(event: TaskRenamed): void {
    const id = requireTaskId(event.id);

    this.startTransaction();
    this.updateDraftState((state) =>
      create(TaskListSchema, {
        id: id.value,
        tasks: state.tasks.map((task) =>
          task.id?.value === id.value
            ? create(TaskSchema, {
                id: clone(TaskIdSchema, id),
                title: event.title,
                completed: task.completed,
              })
            : task,
        ),
        openTaskCount: state.openTaskCount,
      }),
    );
    this.commitTransaction();
  }

  /** Mark an existing task completed in the read-side list. */
  @Subscribe(TaskCompletedSchema)
  onTaskCompleted(event: TaskCompleted): void {
    const id = requireTaskId(event.id);

    this.startTransaction();
    this.updateDraftState((state) => {
      const tasks = state.tasks.map((task) =>
        task.id?.value === id.value
          ? create(TaskSchema, {
              id: clone(TaskIdSchema, id),
              title: task.title,
              completed: true,
            })
          : clone(TaskSchema, task),
      );

      return create(TaskListSchema, {
        id: id.value,
        tasks,
        openTaskCount: tasks.filter((task) => !task.completed).length,
      });
    });
    this.commitTransaction();
  }

  /** Mark an existing task open in the read-side list. */
  @Subscribe(TaskReopenedSchema)
  onTaskReopened(event: TaskReopened): void {
    const id = requireTaskId(event.id);

    this.startTransaction();
    this.updateDraftState((state) => {
      const tasks = state.tasks.map((task) =>
        task.id?.value === id.value
          ? create(TaskSchema, {
              id: clone(TaskIdSchema, id),
              title: task.title,
              completed: false,
            })
          : clone(TaskSchema, task),
      );

      return create(TaskListSchema, {
        id: id.value,
        tasks,
        openTaskCount: tasks.filter((task) => !task.completed).length,
      });
    });
    this.commitTransaction();
  }
}

/** Assemble the in-memory single-tenant Tasks bounded context. */
export function createTodoContext(): BoundedContext {
  return BoundedContext.singleTenant("Tasks")
    .add(createTaskRepository())
    .add(createTaskListRepository())
    .build();
}

function createTaskRepository(): Repository<typeof TaskAggregate> {
  return new Repository({
    entityType: TaskAggregate,
    schema: TaskSchema,
    handlers: materializeDecoratedEntityHandlers(TaskAggregate, TaskSchema),
  });
}

function createTaskListRepository(): Repository<typeof TaskListProjection> {
  return new Repository({
    entityType: TaskListProjection,
    schema: TaskListSchema,
    handlers: materializeDecoratedEntityHandlers(TaskListProjection, TaskListSchema),
  });
}

function requireTaskId(id: TaskId | undefined): TaskId {
  if (id === undefined || id.value.trim().length === 0) {
    throw new Error("Task ID is required.");
  }

  return clone(TaskIdSchema, id);
}
