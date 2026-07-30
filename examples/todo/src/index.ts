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

export { todoProtoModule } from "../generated/proto-module.js";

/** Task aggregate for the create-task example flow. */
export class TaskAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  /** Creates a task and produces its stored domain event.
   *
   * @param command - The command that supplies the task title.
   * @returns The event that records the created task.
   */
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

  /** Updates a task title and produces its stored domain event.
   *
   * @param command - The command that supplies the replacement title.
   * @returns The event that records the task rename.
   */
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

  /** Completes a task and produces its stored domain event.
   *
   * @param command - The command that requests task completion.
   * @returns The event that records the task completion.
   */
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

  /** Marks a task open and produces its stored domain event.
   *
   * @param command - The command that requests task reopening.
   * @returns The event that records the task reopening.
   */
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
  /** Observes a rejection for completing an already complete task.
   *
   * @param rejection - The rejection that identifies the completed task.
   * @param context - The event context that marks the rejection.
   */
  @Subscribe
  onTaskAlreadyDone(rejection: TaskAlreadyDoneMessage, context: EventContext): void {
    void taskIds.require(rejection.id);
    void context.rejection;
  }

  /** Observes a rejection for reopening an open task.
   *
   * @param rejection - The rejection that identifies the open task.
   */
  @Subscribe
  onTaskNotDone(rejection: TaskNotDoneMessage): void {
    void taskIds.require(rejection.id);
  }

  /** Adds a created task to the read-side list.
   *
   * @param event - The event that supplies the new task details.
   */
  @Subscribe
  onTaskCreated(event: TaskCreated): void {
    const id = taskIds.require(event.id);

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

  /** Updates an existing task in the read-side list.
   *
   * @param event - The event that supplies the replacement title.
   */
  @Subscribe
  onTaskRenamed(event: TaskRenamed): void {
    const id = taskIds.require(event.id);

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

  /** Marks an existing task completed in the read-side list.
   *
   * @param event - The event that identifies the completed task.
   */
  @Subscribe
  onTaskCompleted(event: TaskCompleted): void {
    const id = taskIds.require(event.id);

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

  /** Marks an existing task open in the read-side list.
   *
   * @param event - The event that identifies the reopened task.
   */
  @Subscribe
  onTaskReopened(event: TaskReopened): void {
    const id = taskIds.require(event.id);

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

/** Creates the in-memory single-tenant Tasks bounded context.
 *
 * @returns The assembled Tasks bounded context.
 */
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

/** Starts the standalone to-do example server with in-memory storage.
 *
 * @param options - Optional listener host and port overrides.
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
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
