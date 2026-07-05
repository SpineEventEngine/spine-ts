import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

import { clone, create } from "@bufbuild/protobuf";
import { connectNodeAdapter } from "@connectrpc/connect-node";
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
  SpineServices,
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

/** Options for the standalone to-do example server. */
export interface TodoServerOptions {
  /** Host passed to Node's HTTP/2 listener. Defaults to `127.0.0.1`. */
  readonly host?: string;
  /** Port passed to Node's HTTP/2 listener. Defaults to `8080`; use `0` for a free port. */
  readonly port?: number;
}

/** Running standalone to-do example server. */
export interface TodoServer {
  /** Host accepted by the listener. */
  readonly host: string;
  /** Bound listener port. */
  readonly port: number;
  /** Base URL for Connect gRPC-compatible clients. */
  readonly baseUrl: string;
  /** Stop accepting requests and close active HTTP/2 sessions. */
  close(): Promise<void>;
}

/** Start the standalone to-do example server with in-memory storage. */
export async function startTodoServer(options: TodoServerOptions = {}): Promise<TodoServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8080;
  const services = new SpineServices({ contexts: [createTodoContext()] });
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

  const address = await listen(server, host, port);
  const boundHost = typeof address.address === "string" ? address.address : host;

  return {
    host: boundHost,
    port: address.port,
    baseUrl: `http://${boundHost}:${address.port.toString()}`,
    close: () => closeServer(server, sessions),
  };
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

function listen(server: http2.Http2Server, host: string, port: number): Promise<AddressInfo> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve(server.address() as AddressInfo);
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function closeServer(
  server: http2.Http2Server,
  sessions: Set<http2.ServerHttp2Session>,
): Promise<void> {
  return new Promise((resolve, reject) => {
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
  });
}

function isEntrypoint(): boolean {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
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
