import { clone, create } from "@bufbuild/protobuf";
import {
  Aggregate,
  Assign,
  BoundedContext,
  Projection,
  Server,
  Subscribe,
  type RunningServer,
} from "@spine-event-engine/server";
import type { EventContext } from "@spine-event-engine/proto";

import {
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
import {
  TaskAlreadyDone,
  TaskNotDone,
} from "../generated/spine/example/todo/v1/task_rejections.js";
import type {
  TaskAlreadyDone as TaskAlreadyDoneMessage,
  TaskNotDone as TaskNotDoneMessage,
} from "../generated/spine/example/todo/v1/task_rejections_pb.js";
import { TaskSchema } from "../generated/spine/example/todo/v1/tasks_pb.js";

/** Task aggregate for the create-task example flow. */
export class TaskAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  /** Handle `CreateTask` and produce the domain event stored by the context. */
  @Assign
  createTask(command: CreateTask): TaskCreated {
    const id = clone(TaskIdSchema, this.id);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskSchema, {
          id,
          title: command.title,
          completed: false,
        }),
      ),
    );
    return create(TaskCreatedSchema, {
      id,
      title: command.title,
    });
  }

  /** Handle `RenameTask` and produce the event stored by the context. */
  @Assign
  renameTask(command: RenameTask): TaskRenamed {
    const id = clone(TaskIdSchema, this.id);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskSchema, {
          id,
          title: command.title,
          completed: draft.completed,
        }),
      ),
    );
    return create(TaskRenamedSchema, {
      id,
      title: command.title,
    });
  }

  /** Handle `CompleteTask` and produce the event stored by the context. */
  @Assign
  completeTask(command: CompleteTask): TaskCompleted {
    void command;
    const id = clone(TaskIdSchema, this.id);
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
        }),
      ),
    );
    return create(TaskCompletedSchema, { id });
  }

  /** Handle `ReopenTask` and produce the event stored by the context. */
  @Assign
  reopenTask(command: ReopenTask): TaskReopened {
    void command;
    const id = clone(TaskIdSchema, this.id);
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
        }),
      ),
    );
    return create(TaskReopenedSchema, { id });
  }
}

/** Read-side task list projection for visible task queries. */
export class TaskListProjection extends Projection<string, typeof TaskListSchema, number> {
  /** Observe attempts to complete a task that is already complete. */
  @Subscribe
  onTaskAlreadyDone(rejection: TaskAlreadyDoneMessage, context: EventContext): void {
    void taskId(rejection.id);
    void context.rejection;
  }

  /** Observe attempts to reopen a task that is still open. */
  @Subscribe
  onTaskNotDone(rejection: TaskNotDoneMessage): void {
    void taskId(rejection.id);
  }

  /** Add newly created tasks to the read-side list. */
  @Subscribe
  onTaskCreated(event: TaskCreated): void {
    const id = taskId(event.id);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskListSchema, {
          id: id.value,
          tasks: [
            ...draft.tasks,
            create(TaskSchema, {
              id: clone(TaskIdSchema, id),
              title: event.title,
              completed: false,
            }),
          ],
          openTaskCount: draft.openTaskCount + 1,
        }),
      ),
    );
  }

  /** Rename an existing task in the read-side list. */
  @Subscribe
  onTaskRenamed(event: TaskRenamed): void {
    const id = taskId(event.id);

    this.update((draft) =>
      Object.assign(
        draft,
        create(TaskListSchema, {
          id: id.value,
          tasks: draft.tasks.map((task) =>
            task.id?.value === id.value
              ? create(TaskSchema, {
                  id: clone(TaskIdSchema, id),
                  title: event.title,
                  completed: task.completed,
                })
              : task,
          ),
          openTaskCount: draft.openTaskCount,
        }),
      ),
    );
  }

  /** Mark an existing task completed in the read-side list. */
  @Subscribe
  onTaskCompleted(event: TaskCompleted): void {
    const id = taskId(event.id);

    this.update((draft) => {
      const tasks = draft.tasks.map((task) =>
        task.id?.value === id.value
          ? create(TaskSchema, {
              id: clone(TaskIdSchema, id),
              title: task.title,
              completed: true,
            })
          : clone(TaskSchema, task),
      );
      Object.assign(
        draft,
        create(TaskListSchema, {
          id: id.value,
          tasks,
          openTaskCount: tasks.filter((task) => !task.completed).length,
        }),
      );
    });
  }

  /** Mark an existing task open in the read-side list. */
  @Subscribe
  onTaskReopened(event: TaskReopened): void {
    const id = taskId(event.id);

    this.update((draft) => {
      const tasks = draft.tasks.map((task) =>
        task.id?.value === id.value
          ? create(TaskSchema, {
              id: clone(TaskIdSchema, id),
              title: task.title,
              completed: false,
            })
          : clone(TaskSchema, task),
      );
      Object.assign(
        draft,
        create(TaskListSchema, {
          id: id.value,
          tasks,
          openTaskCount: tasks.filter((task) => !task.completed).length,
        }),
      );
    });
  }
}

/** Assemble the in-memory single-tenant Tasks bounded context. */
export async function createTodoContext(): Promise<BoundedContext> {
  return BoundedContext.singleTenant("Tasks")
    .withGeneratedRegistryRoot(new URL("..", import.meta.url))
    .add(TaskAggregate)
    .add(TaskListProjection)
    .buildAsync();
}

/** Options for the standalone to-do example server. */
export interface TodoServerOptions {
  /** Host passed to Node's HTTP/2 listener. Defaults to `127.0.0.1`. */
  readonly host?: string;
  /** Port passed to Node's HTTP/2 listener. Defaults to `8080`; use `0` for a free port. */
  readonly port?: number;
}

/** Running standalone to-do example server. */
export type TodoServer = RunningServer;

/** Start the standalone to-do example server with in-memory storage. */
export async function startTodoServer(options: TodoServerOptions = {}): Promise<TodoServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8080;
  return Server.atPort(port, { host })
    .add(await createTodoContext())
    .start();
}

function taskId(id: TaskId | undefined): TaskId {
  if (id === undefined) {
    throw new Error("Framework-provided task ID is missing.");
  }

  return clone(TaskIdSchema, id);
}

function isEntrypoint(): boolean {
  return (
    process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], "file:").href
  );
}

if (isEntrypoint()) {
  startTodoServer()
    .then((server) => {
      console.log(`To-do example server listening at ${server.baseUrl}`);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
