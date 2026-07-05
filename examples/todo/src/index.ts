import { clone, create } from "@bufbuild/protobuf";
import { packEvent } from "@spine-ts/core";
import { EventContextSchema, EventIdSchema, type Event } from "@spine-ts/proto";
import {
  Aggregate,
  Apply,
  Assign,
  BoundedContext,
  Projection,
  Repository,
  Subscribe,
  materializeDecoratedEntityHandlers,
} from "@spine-ts/server";

import {
  CreateTaskSchema,
  type CreateTask,
} from "../generated/spine/example/todo/v1/task_commands_pb.js";
import {
  TaskCreatedSchema,
  type TaskCreated,
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
      id: create(EventIdSchema, { value: `task-created-${id.value}` }),
      context: create(EventContextSchema),
      schema: TaskCreatedSchema,
      message: create(TaskCreatedSchema, {
        id,
        title: command.title,
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
