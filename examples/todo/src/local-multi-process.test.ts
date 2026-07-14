import { fork, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { create } from "@bufbuild/protobuf";
import { createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { deriveTypeUrl, packCommand, unpackAny } from "@spine-ts/core";
import { UserIdSchema } from "@spine-ts/proto";
import {
  QueryIdSchema,
  QuerySchema,
  type Query,
  type QueryResponse,
} from "@spine-ts/proto/generated/spine/client/query_pb.js";
import { QueryService } from "@spine-ts/proto/generated/spine/client/query_service_pb.js";
import { TargetSchema } from "@spine-ts/proto/generated/spine/client/filters_pb.js";
import { SignalMetadata } from "@spine-ts/server";
import { createTransportTopic, type SignalTransport } from "@spine-ts/transport";
import { createZeroMqAdapterConfig, createZeroMqTransport } from "@spine-ts/transport/zeromq";
import { describe, expect, it } from "vitest";

import { CreateTaskSchema } from "../generated/spine/example/todo/v1/task_commands_pb.js";
import { TaskIdSchema } from "../generated/spine/example/todo/v1/task_id_pb.js";
import { TaskListSchema, type TaskList } from "../generated/spine/example/todo/v1/task_list_pb.js";

const requestTimeoutMs = 2_000;
const readinessTimeoutMs = 5_000;
const observationTimeoutMs = 5_000;
const controlTimeoutMs = 1_000;
const gracefulShutdownTimeoutMs = 5_000;
const terminateTimeoutMs = 1_000;
const adapterIdentity = "todo-local-multi-process";
const workerPath = fileURLToPath(
  new URL("../test-fixtures/local-multi-process-worker.mjs", import.meta.url),
);
const signalMetadata = new SignalMetadata();

interface ReadyMessage {
  readonly type: "ready";
  readonly pid: number;
  readonly host: "127.0.0.1";
  readonly port: number;
}

interface FailureMessage {
  readonly type: "failure";
  readonly phase: string;
  readonly message: string;
}

interface StoppedMessage {
  readonly type: "stopped";
}

interface ShutdownMessage {
  readonly type: "shutdown";
}

type ChildMessage = ReadyMessage | FailureMessage | StoppedMessage;
interface ChildExitState {
  readonly code: number | null;
  readonly signal: string | null;
}

interface CleanupResult {
  readonly childExitCode: number | null;
  readonly childExitSignal: string | null;
  readonly forcedTermination: boolean;
  readonly listenerClosed: boolean;
  readonly ipcDirectoryRemoved: boolean;
}

interface FixtureSetupResources {
  readonly ipcDirectory: string;
  readonly childExit: Promise<ChildExitState>;
}

type ChildCloseResource = "running server" | "environment" | "transport";

interface FixtureCreateOptions {
  readonly workerPath?: string;
  readonly childCloseFailures?: readonly ChildCloseResource[];
  readonly afterResourcesAcquired?: (resources: FixtureSetupResources) => void;
  readonly closeParentTransport?: (transport: SignalTransport) => Promise<void>;
  readonly removeIpcDirectory?: (ipcDirectory: string) => Promise<void>;
}

interface TrackedChild {
  readonly child: ChildProcess;
  readonly exit: Promise<ChildExitState>;
  readonly state: () => ChildExitState | undefined;
}

describe("local multi-process to-do mode", () => {
  it("routes one generated CreateTask to the child and observes its exact projected state", async () => {
    const fixture = await LocalMultiProcessFixture.create();
    let primaryFailure: Error | undefined;
    let cleanup: CleanupResult | undefined;

    try {
      const ready = await fixture.ready();
      expect(ready.pid).toBe(fixture.pid);
      expect(ready.pid).not.toBe(process.pid);

      await fixture.requestCreateTask();
      expect(await fixture.readTaskListEventually()).toEqual(
        create(TaskListSchema, {
          id: "local-multi-process-task",
          tasks: [
            {
              id: create(TaskIdSchema, { value: "local-multi-process-task" }),
              title: "Handled by child process",
              completed: false,
            },
          ],
          openTaskCount: 1,
        }),
      );
    } catch (error) {
      primaryFailure = asError(error);
    } finally {
      cleanup = await fixture.close(primaryFailure);
    }

    if (primaryFailure !== undefined) {
      throw primaryFailure;
    }

    expect(cleanup).toEqual({
      childExitCode: 0,
      childExitSignal: null,
      forcedTermination: false,
      listenerClosed: true,
      ipcDirectoryRemoved: true,
    });
  }, 20_000);

  it("reports an early child exit before readiness and removes acquired local resources", async () => {
    const fixture = await LocalMultiProcessFixture.create({
      workerPath: `${workerPath}.missing-for-test`,
    });
    let primaryFailure: Error | undefined;
    let cleanup: CleanupResult | undefined;

    try {
      await fixture.ready();
    } catch (error) {
      primaryFailure = asError(error);
    } finally {
      cleanup = await fixture.close(primaryFailure);
    }

    expect(primaryFailure?.message).toContain("child exited before readiness");
    expect(cleanup.listenerClosed).toBe(true);
    expect(cleanup.ipcDirectoryRemoved).toBe(true);
  }, 15_000);

  it("cleans child, listener, transport, and IPC directory after an assertion-path failure", async () => {
    const fixture = await LocalMultiProcessFixture.create();
    let primaryFailure: Error | undefined;
    let cleanup: CleanupResult | undefined;

    try {
      await fixture.ready();
      throw new Error("Injected assertion-path failure.");
    } catch (error) {
      primaryFailure = asError(error);
    } finally {
      cleanup = await fixture.close(primaryFailure);
    }

    expect(primaryFailure.message).toBe("Injected assertion-path failure.");
    expect(cleanup).toMatchObject({
      childExitCode: 0,
      childExitSignal: null,
      forcedTermination: false,
      listenerClosed: true,
      ipcDirectoryRemoved: true,
    });
  }, 15_000);

  it("attempts every child close in order and still stops after shutdown failures", async () => {
    let resources: FixtureSetupResources | undefined;
    const fixture = await LocalMultiProcessFixture.create({
      afterResourcesAcquired: (acquired: FixtureSetupResources) => {
        resources = acquired;
      },
      childCloseFailures: ["running server", "environment", "transport"],
    });

    await fixture.ready();
    const rejection = await fixture.close(undefined).catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(AggregateError);
    expect(asError(rejection).message).toBe("Local multi-process fixture cleanup failed.");
    expect(aggregateMessages(rejection)).toEqual([
      expect.stringContaining(
        "running server close failed: Injected running server close failure.; " +
          "environment close failed: Injected environment close failure.; " +
          "transport close failed: Injected transport close failure.",
      ),
    ]);
    expect(await resources?.childExit).toEqual({ code: 1, signal: null });
    expect(await isAbsent(resources?.ipcDirectory ?? "")).toBe(true);
  }, 15_000);

  it("preserves partial-setup primary and cleanup failures while releasing every resource", async () => {
    const setupFailure = new Error("Injected partial fixture setup failure.");
    const parentCloseFailure = new Error("Injected setup parent transport close failure.");
    const directoryRemovalFailure = new Error("Injected setup directory removal failure.");
    let resources: FixtureSetupResources | undefined;
    let unexpectedFixture: LocalMultiProcessFixture | undefined;
    let rejection: unknown;

    try {
      unexpectedFixture = await LocalMultiProcessFixture.create({
        afterResourcesAcquired: (acquired: FixtureSetupResources) => {
          resources = acquired;
          throw setupFailure;
        },
        closeParentTransport: async (transport: SignalTransport) => {
          await transport.close();
          throw parentCloseFailure;
        },
        removeIpcDirectory: async (ipcDirectory: string) => {
          await rm(ipcDirectory, { recursive: true, force: true });
          throw directoryRemovalFailure;
        },
      });
    } catch (error) {
      rejection = error;
    } finally {
      await unexpectedFixture?.close(undefined);
    }

    expect(rejection).toBeInstanceOf(AggregateError);
    if (!(rejection instanceof AggregateError)) {
      throw new Error("Partial fixture setup did not preserve aggregate diagnostics.");
    }
    expect(rejection.errors[0]).toBe(setupFailure);
    expect(rejection.errors[1]).toBe(parentCloseFailure);
    expect(rejection.errors[2]).toBe(directoryRemovalFailure);
    expect(await resources?.childExit).toEqual({ code: 0, signal: null });
    expect(await isAbsent(resources?.ipcDirectory ?? "")).toBe(true);
  }, 15_000);
});

class LocalMultiProcessFixture {
  #backgroundFailures: string[];
  #childFailure: Error | undefined;
  #closed = false;
  #ipcDirectory: string;
  #parentTransport: SignalTransport;
  #ready: ReadyMessage | undefined;
  #stderr = "";
  #stopped = false;
  #trackedChild: TrackedChild;

  static async create(options: FixtureCreateOptions = {}): Promise<LocalMultiProcessFixture> {
    const ipcDirectory = await mkdtemp(path.join(tmpdir(), "stmp-"));
    let parentTransport: SignalTransport | undefined;
    let trackedChild: TrackedChild | undefined;
    const backgroundFailures: string[] = [];

    try {
      await chmod(ipcDirectory, 0o700);
      const directory = await stat(ipcDirectory);
      expect(directory.isDirectory()).toBe(true);
      expect(directory.mode & 0o077).toBe(0);
      parentTransport = createZeroMqTransport(
        createZeroMqAdapterConfig({ ipcDirectory, adapterIdentity }),
        {
          requestTimeoutMs,
          receiveTimeoutMs: 100,
          onBackgroundFailure: (error) => backgroundFailures.push(sanitize(error.message, ipcDirectory)),
        },
      );
      const child = fork(options.workerPath ?? workerPath, [], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SPINE_TODO_MULTI_PROCESS_ADAPTER_IDENTITY: adapterIdentity,
          SPINE_TODO_MULTI_PROCESS_IPC_DIRECTORY: ipcDirectory,
          SPINE_TODO_MULTI_PROCESS_REQUEST_TIMEOUT_MS: String(requestTimeoutMs),
          ...(options.childCloseFailures === undefined
            ? {}
            : {
                SPINE_TODO_MULTI_PROCESS_CLOSE_FAILURES:
                  options.childCloseFailures.join(","),
              }),
        },
        serialization: "json",
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      trackedChild = trackChild(child);
      options.afterResourcesAcquired?.({
        ipcDirectory,
        childExit: trackedChild.exit,
      });
      return new LocalMultiProcessFixture(
        ipcDirectory,
        parentTransport,
        trackedChild,
        backgroundFailures,
      );
    } catch (error) {
      const cleanupFailures = await cleanupFailedFixtureSetup({
        ipcDirectory,
        parentTransport,
        trackedChild,
        closeParentTransport: options.closeParentTransport,
        removeIpcDirectory: options.removeIpcDirectory,
      });
      if (cleanupFailures.length === 0) {
        throw error;
      }
      throw new AggregateError(
        [error, ...cleanupFailures],
        "Local multi-process fixture setup and cleanup failed.",
      );
    }
  }

  private constructor(
    ipcDirectory: string,
    parentTransport: SignalTransport,
    trackedChild: TrackedChild,
    backgroundFailures: string[],
  ) {
    this.#ipcDirectory = ipcDirectory;
    this.#parentTransport = parentTransport;
    this.#trackedChild = trackedChild;
    this.#backgroundFailures = backgroundFailures;
    const { child } = trackedChild;
    child.once("error", (error) => {
      this.#childFailure = phaseError("child process", error, this.#ipcDirectory);
    });
    child.stderr?.on("data", (chunk) => {
      this.#stderr = `${this.#stderr}${String(chunk)}`.slice(-1_024);
    });
    child.on("message", (message) => {
      this.#acceptMessage(message);
    });
  }

  get pid(): number | undefined {
    return this.#trackedChild.child.pid;
  }

  async ready(): Promise<ReadyMessage> {
    await this.#eventually(() => this.#ready !== undefined, "child readiness", readinessTimeoutMs);
    const ready = this.#ready;
    if (ready === undefined) {
      throw new Error("Local multi-process child became unready after readiness completed.");
    }
    return ready;
  }

  async requestCreateTask(): Promise<void> {
    await within(
      this.#parentTransport.request({
        topic: createTransportTopic({
          signalKind: "command",
          messageTypeUrl: deriveTypeUrl(CreateTaskSchema),
        }),
        envelope: packCommand({
          id: signalMetadata.commandId("local-multi-process-create-command"),
          context: signalMetadata.commandContext({
            actorContext: signalMetadata.actorContext({
              actor: create(UserIdSchema, { value: "local-multi-process-parent" }),
            }),
          }),
          schema: CreateTaskSchema,
          message: create(CreateTaskSchema, {
            id: create(TaskIdSchema, { value: "local-multi-process-task" }),
            title: "Handled by child process",
          }),
        }),
      }),
      "transport request/reply",
      requestTimeoutMs,
    );
  }

  async readTaskListEventually(): Promise<TaskList> {
    const ready = await this.ready();
    const queries = createClient(
      QueryService,
      createGrpcTransport({ baseUrl: `http://${ready.host}:${String(ready.port)}` }),
    );
    let lastRowIds = "";
    const deadline = Date.now() + observationTimeoutMs;

    while (Date.now() < deadline) {
      this.#throwChildFailure("projected task observation");
      const response = await within(queries.read(createTaskListQuery()), "QueryService read", requestTimeoutMs);
      const list = findTaskList(response, "local-multi-process-task");
      lastRowIds = response.message
        .map((message) => unpackAny(message.state, TaskListSchema)?.id ?? "<unreadable>")
        .join(",");
      if (list !== undefined && isExpectedTaskList(list)) {
        return list;
      }
      await delay(20);
    }

    throw new Error(
      `Local multi-process projected task observation timed out after ${String(observationTimeoutMs)}ms; ` +
        `last row IDs [${lastRowIds}].`,
    );
  }

  async close(primaryFailure: Error | undefined): Promise<CleanupResult> {
    if (this.#closed) {
      throw new Error("Local multi-process fixture close must run exactly once.");
    }
    this.#closed = true;
    const failures: Error[] = [];
    const childFailureBeforeShutdown = this.#childFailure;
    await capture(() => this.#parentTransport.close(), "parent transport close", failures, this.#ipcDirectory);

    const { child } = this.#trackedChild;
    if (this.#trackedChild.state() === undefined && child.connected) {
      await capture(
        () => sendControl(child, { type: "shutdown" }, "child shutdown control"),
        "child shutdown control",
        failures,
        this.#ipcDirectory,
      );
    }

    const { exitState, forcedTermination } = await awaitChildExitOrTerminate(
      this.#trackedChild,
      failures,
      this.#ipcDirectory,
    );
    if (
      this.#childFailure !== undefined &&
      this.#childFailure !== childFailureBeforeShutdown
    ) {
      failures.push(this.#childFailure);
    }

    const ready = this.#ready;
    let listenerClosed = ready === undefined;
    if (ready !== undefined) {
      await capture(
        async () => {
          await expectListenerClosed(ready, controlTimeoutMs);
          listenerClosed = true;
        },
        "listener closure",
        failures,
        this.#ipcDirectory,
      );
    }
    const retainedEntries = await readdir(this.#ipcDirectory).catch(() => [] as string[]);
    await capture(() => rm(this.#ipcDirectory, { recursive: true, force: true }), "IPC directory removal", failures, this.#ipcDirectory);
    const ipcDirectoryRemoved = await isAbsent(this.#ipcDirectory);
    if (retainedEntries.length > 0) {
      failures.push(new Error(`Retained IPC entries before removal: ${retainedEntries.join(", ")}.`));
    }
    if (!ipcDirectoryRemoved) {
      failures.push(new Error("Private IPC directory remains after cleanup."));
    }
    if (this.#backgroundFailures.length > 0) {
      failures.push(new Error(`Parent transport background failures: ${this.#backgroundFailures.join("; ")}.`));
    }
    if (failures.length > 0) {
      const cleanupFailure = new AggregateError(failures, "Local multi-process fixture cleanup failed.");
      if (primaryFailure !== undefined) {
        throw new AggregateError([primaryFailure, cleanupFailure], "Primary operation and cleanup failed.");
      }
      throw cleanupFailure;
    }
    return {
      childExitCode: exitState.code,
      childExitSignal: exitState.signal,
      forcedTermination,
      listenerClosed,
      ipcDirectoryRemoved,
    };
  }

  async #eventually(predicate: () => boolean, phase: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.#throwChildFailure(phase);
      if (predicate()) {
        return;
      }
      await delay(10);
    }
    this.#throwChildFailure(phase);
    throw new Error(`Local multi-process ${phase} timed out after ${String(timeoutMs)}ms.`);
  }

  #throwChildFailure(phase: string): void {
    if (this.#childFailure !== undefined) {
      throw this.#childFailure;
    }
    const exitState = this.#trackedChild.state();
    if (exitState !== undefined && !this.#stopped) {
      const stderr = sanitize(this.#stderr, this.#ipcDirectory);
      throw new Error(
        `Local multi-process child exited before readiness during ${phase}: code ${String(exitState.code)}, ` +
          `signal ${String(exitState.signal)}${stderr === "" ? "." : `; stderr ${stderr}.`}`,
      );
    }
  }

  #acceptMessage(message: unknown): void {
    if (!isChildMessage(message)) {
      this.#childFailure = new Error("Local multi-process child sent an invalid lifecycle message.");
    } else if (message.type === "ready") {
      this.#ready = message;
    } else if (message.type === "failure") {
      this.#childFailure = new Error(
        `Local multi-process child ${message.phase} failed: ${sanitize(message.message, this.#ipcDirectory)}.`,
      );
    } else {
      this.#stopped = true;
    }
  }
}

function trackChild(child: ChildProcess): TrackedChild {
  let exitState: ChildExitState | undefined;
  const exit = new Promise<ChildExitState>((resolve) => {
    child.once("exit", (code, signal) => {
      exitState = { code, signal };
      resolve(exitState);
    });
  });

  return {
    child,
    exit,
    state: () => exitState,
  };
}

async function cleanupFailedFixtureSetup(options: {
  readonly ipcDirectory: string;
  readonly parentTransport: SignalTransport | undefined;
  readonly trackedChild: TrackedChild | undefined;
  readonly closeParentTransport: FixtureCreateOptions["closeParentTransport"];
  readonly removeIpcDirectory: FixtureCreateOptions["removeIpcDirectory"];
}): Promise<Error[]> {
  const failures: Error[] = [];
  if (options.parentTransport !== undefined) {
    try {
      await (options.closeParentTransport ?? closeTransport)(options.parentTransport);
    } catch (error) {
      failures.push(asError(error));
    }
  }

  const trackedChild = options.trackedChild;
  if (trackedChild !== undefined) {
    if (trackedChild.state() === undefined && trackedChild.child.connected) {
      await capture(
        () => sendControl(trackedChild.child, { type: "shutdown" }, "setup child shutdown control"),
        "setup child shutdown control",
        failures,
        options.ipcDirectory,
      );
    }
    await awaitChildExitOrTerminate(trackedChild, failures, options.ipcDirectory);
  }

  try {
    await (options.removeIpcDirectory ?? removeDirectory)(options.ipcDirectory);
  } catch (error) {
    failures.push(asError(error));
  }
  return failures;
}

async function awaitChildExitOrTerminate(
  trackedChild: TrackedChild,
  failures: Error[],
  ipcDirectory: string,
): Promise<{ readonly exitState: ChildExitState; readonly forcedTermination: boolean }> {
  let exitState = trackedChild.state();
  let forcedTermination = false;
  if (exitState === undefined && (await settles(trackedChild.exit, gracefulShutdownTimeoutMs))) {
    exitState = trackedChild.state();
  }
  if (exitState === undefined) {
    forcedTermination = true;
    trackedChild.child.kill("SIGTERM");
    if (await settles(trackedChild.exit, terminateTimeoutMs)) {
      exitState = trackedChild.state();
    }
  }
  if (exitState === undefined) {
    trackedChild.child.kill("SIGKILL");
    try {
      exitState = await within(
        trackedChild.exit,
        "child exit after SIGKILL",
        terminateTimeoutMs,
      );
    } catch (error) {
      failures.push(phaseError("child exit after SIGKILL", error, ipcDirectory));
      exitState = trackedChild.state() ?? {
        code: trackedChild.child.exitCode,
        signal: trackedChild.child.signalCode,
      };
    }
  }
  return { exitState, forcedTermination };
}

async function closeTransport(transport: SignalTransport): Promise<void> {
  await transport.close();
}

async function removeDirectory(ipcDirectory: string): Promise<void> {
  await rm(ipcDirectory, { recursive: true, force: true });
}

function createTaskListQuery(): Query {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "local-multi-process-query" }),
    target: create(TargetSchema, {
      type: deriveTypeUrl(TaskListSchema),
      criterion: { case: "includeAll", value: true },
    }),
    context: signalMetadata.actorContext({
      actor: create(UserIdSchema, { value: "local-multi-process-parent" }),
    }),
  });
}

function findTaskList(response: QueryResponse, id: string): TaskList | undefined {
  return response.message
    .map((message) => unpackAny(message.state, TaskListSchema))
    .find((list) => list?.id === id);
}

function isExpectedTaskList(list: TaskList): boolean {
  return (
    list.id === "local-multi-process-task" &&
    list.openTaskCount === 1 &&
    list.tasks.length === 1 &&
    list.tasks[0]?.id?.value === "local-multi-process-task" &&
    list.tasks[0].title === "Handled by child process" &&
    !list.tasks[0].completed
  );
}

function isChildMessage(message: unknown): message is ChildMessage {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return false;
  }
  const candidate = message as Record<string, unknown>;
  if (candidate.type === "ready") {
    return (
      Object.keys(candidate).length === 4 &&
      typeof candidate.pid === "number" &&
      Number.isInteger(candidate.pid) &&
      candidate.pid > 0 &&
      candidate.host === "127.0.0.1" &&
      typeof candidate.port === "number" &&
      Number.isInteger(candidate.port) &&
      candidate.port > 0
    );
  }
  if (candidate.type === "failure") {
    return (
      Object.keys(candidate).length === 3 &&
      typeof candidate.phase === "string" &&
      typeof candidate.message === "string" &&
      candidate.message.length <= 240
    );
  }
  return candidate.type === "stopped" && Object.keys(candidate).length === 1;
}

async function sendControl(
  child: ChildProcess,
  message: ShutdownMessage,
  phase: string,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(
        new Error(
          `Local multi-process ${phase} timed out after ${String(controlTimeoutMs)}ms.`,
        ),
      );
    }, controlTimeoutMs);
    try {
      child.send(message, (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        if (error === null) {
          resolve();
        } else {
          reject(error);
        }
      });
    } catch (error) {
      settled = true;
      clearTimeout(timeout);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

async function expectListenerClosed(ready: ReadyMessage, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.connect({ host: ready.host, port: ready.port });
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      socket.destroy();
      reject(
        new Error(
          `Local multi-process listener closure connect timed out after ${String(timeoutMs)}ms.`,
        ),
      );
    }, timeoutMs);
    socket.once("connect", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      reject(new Error("Child listener remains reachable after shutdown."));
    });
    socket.once("error", () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function within<T>(promise: Promise<T>, phase: string, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => {
            reject(new Error(`Local multi-process ${phase} timed out after ${String(timeoutMs)}ms.`));
          },
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function settles(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  return await Promise.race([
    promise.then(() => true),
    delay(timeoutMs).then(() => false),
  ]);
}

async function capture(
  operation: () => Promise<void>,
  phase: string,
  failures: Error[],
  ipcDirectory: string,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    failures.push(phaseError(phase, error, ipcDirectory));
  }
}

async function isAbsent(target: string): Promise<boolean> {
  return await stat(target).then(() => false, () => true);
}

function phaseError(phase: string, error: unknown, ipcDirectory: string): Error {
  return new Error(`Local multi-process ${phase} failed: ${sanitize(asError(error).message, ipcDirectory)}.`);
}

function sanitize(value: string, ipcDirectory: string): string {
  return value.replaceAll(ipcDirectory, "<ipc-directory>").replaceAll(/[\r\n\t]+/gu, " ").slice(0, 480);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function aggregateMessages(error: unknown): string[] {
  return error instanceof AggregateError ? error.errors.map((entry) => asError(entry).message) : [];
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
