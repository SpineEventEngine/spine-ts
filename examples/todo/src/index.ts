import * as http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";

import { clone, create } from "@bufbuild/protobuf";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import {
  Aggregate,
  Assign,
  BoundedContext,
  CommandRefusalError,
  Projection,
  Repository,
  SpineServices,
  Subscribe,
  defineEntityHandlers,
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

/** Task aggregate for the create-task example flow. */
export class TaskAggregate extends Aggregate<TaskId, typeof TaskSchema, bigint> {
  /** Handle `CreateTask` and produce the domain event stored by the context. */
  @Assign
  createTask(command: CreateTask): TaskCreated {
    const id = clone(TaskIdSchema, this.id);

    this.updateDraftState(() =>
      create(TaskSchema, {
        id,
        title: command.title,
        completed: false,
      }),
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

    this.updateDraftState((state) =>
      create(TaskSchema, {
        id,
        title: command.title,
        completed: state.completed,
      }),
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
      throw new CommandRefusalError("TASK_ALREADY_DONE", "Task is already done.");
    }

    this.updateDraftState((state) =>
      create(TaskSchema, {
        id,
        title: state.title,
        completed: true,
      }),
    );
    return create(TaskCompletedSchema, { id });
  }

  /** Handle `ReopenTask` and produce the event stored by the context. */
  @Assign
  reopenTask(command: ReopenTask): TaskReopened {
    void command;
    const id = clone(TaskIdSchema, this.id);
    if (!this.state.completed) {
      throw new CommandRefusalError("TASK_NOT_DONE", "Task is not done.");
    }

    this.updateDraftState((state) =>
      create(TaskSchema, {
        id,
        title: state.title,
        completed: false,
      }),
    );
    return create(TaskReopenedSchema, { id });
  }
}

/** Read-side task list projection for visible task queries. */
export class TaskListProjection extends Projection<string, typeof TaskListSchema, number> {
  /** Add newly created tasks to the read-side list. */
  @Subscribe
  onTaskCreated(event: TaskCreated): void {
    const id = taskId(event.id);

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
  }

  /** Rename an existing task in the read-side list. */
  @Subscribe
  onTaskRenamed(event: TaskRenamed): void {
    const id = taskId(event.id);

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
  }

  /** Mark an existing task completed in the read-side list. */
  @Subscribe
  onTaskCompleted(event: TaskCompleted): void {
    const id = taskId(event.id);

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
  }

  /** Mark an existing task open in the read-side list. */
  @Subscribe
  onTaskReopened(event: TaskReopened): void {
    const id = taskId(event.id);

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
    baseUrl: `http://${formatHostForUrl(boundHost)}:${address.port.toString()}`,
    close: () => closeServer(server, sessions),
  };
}

function createTaskRepository(): Repository<typeof TaskAggregate> {
  return new Repository({
    entityType: TaskAggregate,
    schema: TaskSchema,
    handlers: defineEntityHandlers(TaskAggregate, TaskSchema, (builder) => [
      builder.assign(CreateTaskSchema, "createTask"),
      builder.assign(RenameTaskSchema, "renameTask"),
      builder.assign(CompleteTaskSchema, "completeTask"),
      builder.assign(ReopenTaskSchema, "reopenTask"),
    ]),
    events: [TaskCreatedSchema, TaskRenamedSchema, TaskCompletedSchema, TaskReopenedSchema],
  });
}

function createTaskListRepository(): Repository<typeof TaskListProjection> {
  return new Repository({
    entityType: TaskListProjection,
    schema: TaskListSchema,
    handlers: defineEntityHandlers(TaskListProjection, TaskListSchema, (builder) => [
      builder.subscribe(TaskCreatedSchema, "onTaskCreated"),
      builder.subscribe(TaskRenamedSchema, "onTaskRenamed"),
      builder.subscribe(TaskCompletedSchema, "onTaskCompleted"),
      builder.subscribe(TaskReopenedSchema, "onTaskReopened"),
    ]),
  });
}

function taskId(id: TaskId | undefined): TaskId {
  if (id === undefined) {
    throw new Error("Framework-provided task ID is missing.");
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

function formatHostForUrl(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
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
