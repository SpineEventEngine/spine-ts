import { fork, type ChildProcess } from "node:child_process";
import { chmod, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import { fileDesc, messageDesc, type GenMessage } from "@bufbuild/protobuf/codegenv2";
import { FileDescriptorProtoSchema, FileDescriptorSetSchema } from "@bufbuild/protobuf/wkt";
import { deriveTypeUrl, packCommand, packEvent } from "@spine-ts/core";
import {
  EventContextSchema,
  EventIdSchema,
  type Command,
  type Event,
  UserIdSchema,
  VersionSchema,
  file_spine_options,
} from "@spine-ts/proto";
import { SignalMetadata } from "@spine-ts/server";
import { createTransportTopic, type SignalTransport } from "@spine-ts/transport";
import { createZeroMqAdapterConfig, createZeroMqTransport } from "@spine-ts/transport/zeromq";
import { describe, expect, it } from "vitest";

import { serverEntityMetadataTestFixtures } from "../../test-fixtures/entity-metadata-fixtures.js";

const transportTimeoutMs = 2_000;
const phaseTimeoutMs = 5_000;
const shutdownGraceMs = 1_000;
const observationQuietMs = 200;
const adapterIdentity = "t0038b-parent-context-transport";
const commandEntityId = "cross-process-command";
const inboundEventEntityId = "cross-process-inbound-event";
const childPath = fileURLToPath(new URL("./server-context-transport-child.mjs", import.meta.url));

type AggregateState = Message<"AggregateState"> & {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
};
type ProjectionState = Message<"ProjectionState"> & {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
};
type ObservationBehavior = "command-handled" | "primary-projected" | "secondary-projected";
type ObservationSource = "command" | "inbound-event";
interface ReadyMessage {
  readonly type: "ready";
  readonly host: "127.0.0.1";
  readonly port: number;
}
interface FailureMessage {
  readonly type: "failure";
  readonly phase: string;
  readonly message: string;
}
interface ObservationMessage {
  readonly type: "observed";
  readonly behavior: ObservationBehavior;
  readonly source: ObservationSource;
  readonly entityId: string;
}
interface StoppedMessage {
  readonly type: "stopped";
}
interface DuplicateCommandObservationAppliedMessage {
  readonly type: "duplicate-command-observation-applied";
}
interface ShutdownMessage {
  readonly type: "shutdown";
}
interface DuplicateCommandObservationMessage {
  readonly type: "duplicate-command-observation";
}
type ParentMessage = DuplicateCommandObservationMessage | ShutdownMessage;
type ChildMessage =
  | DuplicateCommandObservationAppliedMessage
  | FailureMessage
  | ObservationMessage
  | ReadyMessage
  | StoppedMessage;
interface ChildExitState {
  readonly code: number | null;
  readonly signal: string | null;
}
interface FixtureOptions {
  readonly backgroundFailures: string[];
  readonly classifyDuplicateCommandObservationAppliedAt: (receivedAt: number) => number;
  readonly injectCommandDuplicateInQuietWindow: boolean;
  readonly ipcDirectory: string;
  readonly parentTransport: SignalTransport;
  readonly trackedChild: TrackedChild;
}
interface FixtureCreateOptions {
  readonly beforeFixtureConstruction?: (resources: FixtureSetupResources) => void;
  readonly classifyDuplicateCommandObservationAppliedAt?: (receivedAt: number) => number;
  readonly closeParentTransport?: (
    transport: SignalTransport,
    ipcDirectory: string,
  ) => Promise<void>;
  readonly injectCommandDuplicateInQuietWindow?: boolean;
}
interface FixtureSetupResources {
  readonly ipcDirectory: string;
  readonly parentTransport: SignalTransport;
  readonly trackedChild: TrackedChild;
}
interface FailedFixtureSetup {
  readonly closeParentTransport: FixtureCreateOptions["closeParentTransport"];
  readonly ipcDirectory: string;
  readonly parentTransport: SignalTransport | undefined;
  readonly trackedChild: TrackedChild | undefined;
}
interface TrackedChild {
  readonly child: ChildProcess;
  readonly exit: Promise<ChildExitState>;
  readonly state: () => ChildExitState | undefined;
}
interface ChildCloseResult {
  readonly exitState: ChildExitState;
  readonly forcedTermination: boolean;
}
interface ChildBoundaryResult {
  readonly diagnostics: string;
  readonly exitState: ChildExitState;
  readonly outcome: "exited" | "ready";
  readonly stderr: string;
}
interface CleanupResult {
  readonly childExitCode: number | null;
  readonly childExitSignal: string | null;
  readonly forcedTermination: boolean;
  readonly listenerClosed: boolean;
  readonly ipcDirectoryRemoved: boolean;
}
interface CommandIntakeResponse {
  readonly status: "accepted";
  readonly signalKind: "command";
  readonly acceptedFor: "async-work";
}

const { AggregateStateSchema, ProjectionStateSchema } = fixtureSchemas();
const signalMetadata = new SignalMetadata();

describe("Server context transport across Node processes", () => {
  it("executes command and event projection behavior through same-host ZeroMQ", async () => {
    const fixture = await CrossProcessFixture.create();
    let primaryFailure: Error | undefined;
    let cleanup: CleanupResult | undefined;

    try {
      await fixture.ready();

      const response = await fixture.requestCommand(createTaskCommand());
      expect(response).toEqual({
        status: "accepted",
        signalKind: "command",
        acceptedFor: "async-work",
      });
      expect(await fixture.observeCommand(commandEntityId)).toEqual([
        "command-handled",
        "primary-projected",
        "secondary-projected",
      ]);
      expect(
        await fixture.publishEventUntilObserved(createInboundEvent(), inboundEventEntityId),
      ).toEqual(["primary-projected", "secondary-projected"]);
    } catch (error) {
      primaryFailure = toError(error);
    } finally {
      try {
        cleanup = await fixture.close();
      } catch (error) {
        if (primaryFailure === undefined) {
          primaryFailure = toError(error);
        } else {
          primaryFailure = new AggregateError(
            [primaryFailure, toError(error)],
            "Cross-process proof and cleanup both failed.",
          );
        }
      }
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

  it("rejects a non-normalized adapter identity at the child boundary", async () => {
    const result = await runChildBoundary({
      SPINE_T0038B_ADAPTER_IDENTITY: ` ${adapterIdentity} `,
    });

    expect(result.outcome).toBe("exited");
    expect(result.exitState.code).toBe(1);
    expect(`${result.diagnostics} ${result.stderr}`).toContain("SPINE_T0038B_ADAPTER_IDENTITY");
  });

  it("rejects a controlled fourth command observation during the quiet window", async () => {
    const fixture = await CrossProcessFixture.create({
      injectCommandDuplicateInQuietWindow: true,
    });

    try {
      await fixture.ready();
      await fixture.requestCommand(createTaskCommand());

      await expect(fixture.observeCommand(commandEntityId)).rejects.toThrow(
        "expected exactly 3 observations but received 4",
      );
    } finally {
      await fixture.close();
    }
  });

  it("rejects a processed acknowledgment classified after the quiet deadline", async () => {
    const receivedAtValues: number[] = [];
    const fixture = await CrossProcessFixture.create({
      classifyDuplicateCommandObservationAppliedAt: (receivedAt) => {
        receivedAtValues.push(receivedAt);
        return Number.MAX_SAFE_INTEGER;
      },
      injectCommandDuplicateInQuietWindow: true,
    });

    try {
      await fixture.ready();
      await fixture.requestCommand(createTaskCommand());

      await expect(fixture.observeCommand(commandEntityId)).rejects.toThrow(
        "Cross-process command duplicate control was not applied within the bounded quiet window.",
      );
      expect(receivedAtValues).toHaveLength(1);
      expect(Number.isFinite(receivedAtValues[0] ?? Number.NaN)).toBe(true);
    } finally {
      await fixture.close();
    }
  });

  it("rejects a non-decimal transport timeout at the child boundary", async () => {
    const result = await runChildBoundary({
      SPINE_T0038B_TRANSPORT_TIMEOUT_MS: "2e3",
    });

    expect(result.outcome).toBe("exited");
    expect(result.exitState.code).toBe(1);
    expect(`${result.diagnostics} ${result.stderr}`).toContain("SPINE_T0038B_TRANSPORT_TIMEOUT_MS");
  });

  it("cleans created resources when fixture setup fails", async () => {
    let setupResources: FixtureSetupResources | undefined;
    let setupError: Error | undefined;
    let rejection: unknown;
    let parentCloseCalls = 0;
    let observedCleanup = {
      childExited: false,
      directoryRemoved: false,
    };

    try {
      await CrossProcessFixture.create({
        beforeFixtureConstruction: (resources) => {
          setupResources = resources;
          setupError = new Error("Injected cross-process fixture setup failure.");
          throw setupError;
        },
        closeParentTransport: async (transport, ipcDirectory) => {
          parentCloseCalls++;
          await transport.close();
          throw new Error(`Injected parent close failure at ${ipcDirectory}.`);
        },
      });
    } catch (error) {
      rejection = error;
      if (setupResources !== undefined) {
        observedCleanup = {
          childExited: await exitsWithin(setupResources.trackedChild, 200),
          directoryRemoved: await pathIsAbsent(setupResources.ipcDirectory),
        };
      }
    } finally {
      await emergencySetupCleanup(setupResources);
    }

    expect(rejection).toBeInstanceOf(AggregateError);
    if (!(rejection instanceof AggregateError)) {
      throw new Error("Fixture setup failure did not retain combined diagnostics.");
    }
    expect(rejection.errors[0]).toBe(setupError);
    expect(rejection.errors[1]).toBeInstanceOf(Error);
    expect((rejection.errors[1] as Error).message).toContain(
      "Injected parent close failure at <ipc-directory>",
    );
    expect((rejection.errors[1] as Error).message).not.toContain(
      setupResources?.ipcDirectory ?? "unavailable-ipc-directory",
    );
    expect({ parentCloseCalls, ...observedCleanup }).toEqual({
      parentCloseCalls: 1,
      childExited: true,
      directoryRemoved: true,
    });
  }, 10_000);

  it("reports retained IPC entries before removing the directory", async () => {
    const ipcDirectory = await mkdtemp(path.join(tmpdir(), "spine-t0038b-leak-"));
    await writeFile(path.join(ipcDirectory, "retained.sock"), "retained");
    const failures: Error[] = [];

    try {
      const removed = await inspectAndRemoveIpcDirectory(ipcDirectory, failures);

      expect(removed).toBe(true);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.message).toBe(
        "Cross-process IPC directory retained 1 entry after child and transports closed.",
      );
      expect(await pathIsAbsent(ipcDirectory)).toBe(true);
    } finally {
      await rm(ipcDirectory, { recursive: true, force: true });
    }
  });
});

class CrossProcessFixture {
  #backgroundFailures: string[];
  #childFailure: Error | undefined;
  #classifyDuplicateCommandObservationAppliedAt: (receivedAt: number) => number;
  #closed = false;
  #duplicateCommandObservationAppliedAt: number | undefined;
  #injectCommandDuplicateInQuietWindow: boolean;
  #ipcDirectory: string;
  #observations: ObservationMessage[] = [];
  #parentTransport: SignalTransport;
  #readyState: ReadyMessage | undefined;
  #stderr = "";
  #stopped = false;
  #trackedChild: TrackedChild;

  static async create(options: FixtureCreateOptions = {}): Promise<CrossProcessFixture> {
    const ipcDirectory = await mkdtemp(path.join(tmpdir(), "spine-t0038b-"));
    let parentTransport: SignalTransport | undefined;
    let child: ChildProcess | undefined;
    let trackedChild: TrackedChild | undefined;

    try {
      await chmod(ipcDirectory, 0o700);
      const directory = await stat(ipcDirectory);
      expect(directory.isDirectory()).toBe(true);
      expect(directory.mode & 0o077).toBe(0);

      const config = createZeroMqAdapterConfig({ ipcDirectory, adapterIdentity });
      const backgroundFailures: string[] = [];
      parentTransport = createZeroMqTransport(config, {
        requestTimeoutMs: transportTimeoutMs,
        receiveTimeoutMs: 100,
        onBackgroundFailure: (error) => backgroundFailures.push(safeMessage(error, ipcDirectory)),
      });
      child = fork(childPath, [], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SPINE_T0038B_ADAPTER_IDENTITY: adapterIdentity,
          SPINE_T0038B_IPC_DIRECTORY: ipcDirectory,
          SPINE_T0038B_TRANSPORT_TIMEOUT_MS: String(transportTimeoutMs),
        },
        serialization: "json",
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      trackedChild = trackChild(child);
      options.beforeFixtureConstruction?.({ ipcDirectory, parentTransport, trackedChild });

      return new CrossProcessFixture({
        backgroundFailures,
        classifyDuplicateCommandObservationAppliedAt:
          options.classifyDuplicateCommandObservationAppliedAt ?? ((receivedAt) => receivedAt),
        injectCommandDuplicateInQuietWindow: options.injectCommandDuplicateInQuietWindow ?? false,
        ipcDirectory,
        parentTransport,
        trackedChild,
      });
    } catch (error) {
      trackedChild ??= child === undefined ? undefined : trackChild(child);
      const cleanupFailures = await cleanupFailedFixtureSetup({
        ipcDirectory,
        parentTransport,
        trackedChild,
        closeParentTransport: options.closeParentTransport,
      });
      throwSetupFailure(error, cleanupFailures);
    }
  }

  constructor({
    backgroundFailures,
    classifyDuplicateCommandObservationAppliedAt,
    injectCommandDuplicateInQuietWindow,
    ipcDirectory,
    parentTransport,
    trackedChild,
  }: FixtureOptions) {
    this.#backgroundFailures = backgroundFailures;
    this.#classifyDuplicateCommandObservationAppliedAt =
      classifyDuplicateCommandObservationAppliedAt;
    this.#injectCommandDuplicateInQuietWindow = injectCommandDuplicateInQuietWindow;
    this.#ipcDirectory = ipcDirectory;
    this.#parentTransport = parentTransport;
    this.#trackedChild = trackedChild;
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

  async ready(): Promise<void> {
    await this.#eventually(() => this.#readyState !== undefined, "child readiness");
  }

  async requestCommand(command: Command): Promise<CommandIntakeResponse> {
    const topic = createTransportTopic({
      signalKind: "command",
      messageTypeUrl: deriveTypeUrl(AggregateStateSchema),
    });

    return await withinPhase(
      this.#parentTransport.request<Command, CommandIntakeResponse, "command">({
        topic,
        envelope: command,
      }),
      transportTimeoutMs,
      "command request/reply",
    );
  }

  async observeCommand(entityId: string): Promise<ObservationBehavior[]> {
    await this.#eventually(
      () => this.#commandObservations(entityId).length >= 3,
      "command handling and projection observation",
    );
    this.#requireExpectedCommandObservations(entityId);

    const quietDeadline = Date.now() + observationQuietMs;
    if (this.#injectCommandDuplicateInQuietWindow) {
      await withinPhase(
        sendChildMessage(this.#trackedChild.child, { type: "duplicate-command-observation" }),
        observationQuietMs,
        "command duplicate control",
      );
      await this.#awaitDuplicateCommandObservationApplied(quietDeadline);
      this.#requireExpectedCommandObservations(entityId);
    }
    await this.#holdCommandObservationQuietWindow(entityId, quietDeadline);

    return this.#commandObservations(entityId)
      .map((observation) => observation.behavior)
      .sort();
  }

  #commandObservations(entityId: string): ObservationMessage[] {
    return this.#observations.filter(
      (observation) => observation.source === "command" && observation.entityId === entityId,
    );
  }

  #requireExpectedCommandObservations(entityId: string): void {
    const observations = this.#commandObservations(entityId);
    if (observations.length !== 3) {
      throw new Error(
        "Cross-process command observation expected exactly 3 observations but received " +
          `${String(observations.length)} during the bounded quiet window.`,
      );
    }
  }

  async #holdCommandObservationQuietWindow(entityId: string, deadline: number): Promise<void> {
    while (Date.now() < deadline) {
      this.#throwChildFailure("command observation quiet window");
      this.#requireExpectedCommandObservations(entityId);
      await waitFor(Math.min(10, Math.max(1, deadline - Date.now())));
    }
    this.#requireExpectedCommandObservations(entityId);
  }

  async #awaitDuplicateCommandObservationApplied(deadline: number): Promise<void> {
    while (this.#duplicateCommandObservationAppliedAt === undefined && Date.now() < deadline) {
      this.#throwChildFailure("command duplicate application barrier");
      await waitFor(Math.min(10, Math.max(1, deadline - Date.now())));
    }
    if (
      this.#duplicateCommandObservationAppliedAt === undefined ||
      this.#duplicateCommandObservationAppliedAt >= deadline
    ) {
      throw new Error(
        "Cross-process command duplicate control was not applied within the bounded quiet window.",
      );
    }
  }

  async publishEventUntilObserved(event: Event, entityId: string): Promise<ObservationBehavior[]> {
    const topic = createTransportTopic({
      signalKind: "event",
      messageTypeUrl: deriveTypeUrl(ProjectionStateSchema),
    });
    const deadline = Date.now() + phaseTimeoutMs;

    while (Date.now() < deadline) {
      await withinPhase(
        this.#parentTransport.publish<Event, "event">({ topic, envelope: event }),
        transportTimeoutMs,
        "event publish",
      );
      await waitFor(20);
      if (this.#inboundObservations(entityId).length >= 2) {
        await waitFor(observationQuietMs);
        break;
      }
      this.#throwChildFailure("inbound event observation");
    }

    const observations = this.#inboundObservations(entityId);
    if (observations.length < 2) {
      const observedBehaviors = this.#observations
        .map(
          (observation) => `${observation.source}:${observation.behavior}:${observation.entityId}`,
        )
        .join(", ")
        .slice(0, 480);
      throw new Error(
        `Cross-process inbound event observation timed out after ${String(phaseTimeoutMs)}ms; ` +
          `observed [${observedBehaviors}].`,
      );
    }
    return observations.map((observation) => observation.behavior).sort();
  }

  async close(): Promise<CleanupResult> {
    if (this.#closed) {
      throw new Error("Cross-process fixture close must run exactly once.");
    }
    this.#closed = true;
    const failures: Error[] = [];

    await captureCleanupFailure(
      () => this.#parentTransport.close(),
      "parent transport close",
      failures,
      this.#ipcDirectory,
    );

    if (this.#trackedChild.state() === undefined) {
      await captureCleanupFailure(
        () => sendChildMessage(this.#trackedChild.child, { type: "shutdown" }),
        "child shutdown request",
        failures,
        this.#ipcDirectory,
      );
    }

    if (this.#readyState !== undefined) {
      await captureCleanupFailure(
        () => this.#eventually(() => this.#stopped, "child graceful shutdown"),
        "child graceful shutdown",
        failures,
        this.#ipcDirectory,
      );
    }

    const { exitState, forcedTermination } = await awaitChildExitOrTerminate(
      this.#trackedChild,
      failures,
      this.#ipcDirectory,
    );

    let listenerClosed = this.#readyState === undefined;
    const readyState = this.#readyState;
    if (readyState !== undefined) {
      await captureCleanupFailure(
        async () => {
          await expectListenerClosed(readyState.host, readyState.port);
          listenerClosed = true;
        },
        "listener leak check",
        failures,
        this.#ipcDirectory,
      );
    }

    const ipcDirectoryRemoved = await inspectAndRemoveIpcDirectory(this.#ipcDirectory, failures);
    if (this.#backgroundFailures.length > 0) {
      failures.push(
        new Error(`Parent transport background failure: ${this.#backgroundFailures.join("; ")}`),
      );
    }
    if (failures.length > 0) {
      throw new AggregateError(failures, "Cross-process fixture cleanup failed.");
    }

    return {
      childExitCode: exitState.code,
      childExitSignal: exitState.signal,
      forcedTermination,
      listenerClosed,
      ipcDirectoryRemoved,
    };
  }

  async #eventually(predicate: () => boolean, phase: string): Promise<void> {
    const deadline = Date.now() + phaseTimeoutMs;

    while (Date.now() < deadline) {
      this.#throwChildFailure(phase);
      if (predicate()) {
        return;
      }
      await waitFor(10);
    }

    throw new Error(`Cross-process ${phase} timed out after ${String(phaseTimeoutMs)}ms.`);
  }

  #throwChildFailure(phase: string): void {
    if (this.#childFailure !== undefined) {
      throw this.#childFailure;
    }
    const exitState = this.#trackedChild.state();
    if (exitState !== undefined && !this.#stopped) {
      const stderr = safeMessage(this.#stderr, this.#ipcDirectory);
      throw new Error(
        `Cross-process ${phase} failed: child exited with code ${String(exitState.code)}` +
          (stderr.length === 0 ? "." : ` (${stderr}).`),
      );
    }
  }

  #inboundObservations(entityId: string): ObservationMessage[] {
    return this.#observations.filter(
      (observation) => observation.source === "inbound-event" && observation.entityId === entityId,
    );
  }

  #acceptMessage(message: unknown): void {
    if (!isChildMessage(message)) {
      this.#childFailure = new Error("Cross-process child sent an invalid control message.");
      return;
    }

    if (message.type === "ready") {
      this.#readyState = message;
    } else if (message.type === "observed") {
      this.#observations.push(message);
    } else if (message.type === "duplicate-command-observation-applied") {
      this.#duplicateCommandObservationAppliedAt =
        this.#classifyDuplicateCommandObservationAppliedAt(Date.now());
    } else if (message.type === "failure") {
      this.#childFailure = new Error(
        `Cross-process child ${message.phase} failed: ${safeMessage(message.message, this.#ipcDirectory)}.`,
      );
    } else {
      this.#stopped = true;
    }
  }
}

function fixtureSchemas(): {
  readonly AggregateStateSchema: GenMessage<AggregateState>;
  readonly ProjectionStateSchema: GenMessage<ProjectionState>;
} {
  const descriptorSet = fromBinary(
    FileDescriptorSetSchema,
    Buffer.from(serverEntityMetadataTestFixtures.main.descriptorSetBase64, "base64"),
  );
  const descriptor = descriptorSet.file[0];
  if (descriptor === undefined) {
    throw new Error("Cross-process fixture descriptor set is empty.");
  }
  const file = fileDesc(
    Buffer.from(toBinary(FileDescriptorProtoSchema, descriptor)).toString("base64"),
    [file_spine_options],
  );

  return {
    AggregateStateSchema: messageDesc(file, 1),
    ProjectionStateSchema: messageDesc(file, 0),
  };
}

function createTaskCommand(): Command {
  return packCommand({
    id: signalMetadata.commandId("cross-process-command-id"),
    context: signalMetadata.commandContext({
      actorContext: signalMetadata.actorContext({
        actor: create(UserIdSchema, { value: "cross-process-parent" }),
      }),
    }),
    schema: AggregateStateSchema,
    message: create(AggregateStateSchema, {
      id: commandEntityId,
      name: "Transported command",
      archived: false,
    }),
  });
}

function createInboundEvent(): Event {
  return packEvent({
    id: create(EventIdSchema, { value: "fixed-cross-process-inbound-event" }),
    context: create(EventContextSchema, {
      version: create(VersionSchema, { number: 1 }),
    }),
    schema: ProjectionStateSchema,
    message: create(ProjectionStateSchema, {
      id: inboundEventEntityId,
      name: "Transported event",
      priority: 7,
    }),
  });
}

function isChildMessage(message: unknown): message is ChildMessage {
  if (!isRecord(message) || typeof message.type !== "string") {
    return false;
  }

  if (message.type === "ready") {
    return (
      Object.keys(message).length === 3 &&
      message.host === "127.0.0.1" &&
      typeof message.port === "number" &&
      Number.isInteger(message.port) &&
      message.port > 0
    );
  }
  if (message.type === "failure") {
    return (
      Object.keys(message).length === 3 &&
      typeof message.phase === "string" &&
      message.phase.length <= 40 &&
      typeof message.message === "string" &&
      message.message.length <= 240
    );
  }
  if (message.type === "observed") {
    return (
      Object.keys(message).length === 4 &&
      typeof message.behavior === "string" &&
      observationBehaviors.has(message.behavior) &&
      typeof message.source === "string" &&
      observationSources.has(message.source) &&
      typeof message.entityId === "string" &&
      message.entityId.length > 0 &&
      message.entityId.length <= 80
    );
  }
  if (message.type === "duplicate-command-observation-applied") {
    return Object.keys(message).length === 1;
  }

  return message.type === "stopped" && Object.keys(message).length === 1;
}

async function withinPhase<Value>(
  promise: Promise<Value>,
  milliseconds: number,
  phase: string,
): Promise<Value> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Cross-process ${phase} timed out after ${String(milliseconds)}ms.`));
        }, milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runChildBoundary(
  environment: Readonly<Record<string, string>>,
): Promise<ChildBoundaryResult> {
  const ipcDirectory = await mkdtemp(path.join(tmpdir(), "szb-"));
  await chmod(ipcDirectory, 0o700);
  const child = fork(childPath, [], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      SPINE_T0038B_ADAPTER_IDENTITY: adapterIdentity,
      SPINE_T0038B_IPC_DIRECTORY: ipcDirectory,
      SPINE_T0038B_TRANSPORT_TIMEOUT_MS: String(transportTimeoutMs),
      ...environment,
    },
    serialization: "json",
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const trackedChild = trackChild(child);
  let diagnostics = "";
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-1_024);
  });
  const ready = new Promise<"ready">((resolve) => {
    child.on("message", (message) => {
      if (isRecord(message) && message.type === "ready") {
        resolve("ready");
      }
      if (
        isRecord(message) &&
        message.type === "failure" &&
        typeof message.phase === "string" &&
        typeof message.message === "string"
      ) {
        diagnostics = `${message.phase}: ${message.message}`;
      }
    });
  });

  let outcome: ChildBoundaryResult["outcome"];
  try {
    outcome = await withinPhase(
      Promise.race([ready, trackedChild.exit.then(() => "exited" as const)]),
      phaseTimeoutMs,
      "child environment boundary",
    );
  } finally {
    if (trackedChild.state() === undefined) {
      child.kill("SIGTERM");
      try {
        await withinPhase(trackedChild.exit, shutdownGraceMs, "boundary child shutdown");
      } catch {
        child.kill("SIGKILL");
        await trackedChild.exit;
      }
    }
    await rm(ipcDirectory, { recursive: true, force: true });
  }

  return {
    diagnostics,
    exitState: await trackedChild.exit,
    outcome,
    stderr,
  };
}

function trackChild(child: ChildProcess): TrackedChild {
  let state = currentChildExitState(child);
  const exit =
    state === undefined
      ? new Promise<ChildExitState>((resolve) => {
          child.once("exit", (code, signal) => {
            state = { code, signal };
            resolve(state);
          });
        })
      : Promise.resolve(state);

  return Object.freeze({
    child,
    exit,
    state: () => state,
  });
}

function currentChildExitState(child: ChildProcess): ChildExitState | undefined {
  if (child.exitCode !== null) {
    return { code: child.exitCode, signal: null };
  }
  if (child.signalCode !== null) {
    return { code: null, signal: child.signalCode };
  }
  return undefined;
}

async function awaitChildExitOrTerminate(
  trackedChild: TrackedChild,
  failures: Error[],
  ipcDirectory: string,
): Promise<ChildCloseResult> {
  try {
    return {
      exitState: await withinPhase(trackedChild.exit, phaseTimeoutMs, "child exit"),
      forcedTermination: false,
    };
  } catch (error) {
    trackedChild.child.kill("SIGTERM");
    let exitState: ChildExitState;
    try {
      exitState = await withinPhase(trackedChild.exit, shutdownGraceMs, "child termination grace");
    } catch (terminationError) {
      trackedChild.child.kill("SIGKILL");
      failures.push(phaseError("child termination", terminationError, ipcDirectory));
      exitState = await trackedChild.exit;
    }
    failures.push(phaseError("child exit", error, ipcDirectory));
    return { exitState, forcedTermination: true };
  }
}

async function removeIpcDirectory(ipcDirectory: string, failures: Error[]): Promise<boolean> {
  await captureCleanupFailure(
    () => rm(ipcDirectory, { recursive: true, force: true }),
    "IPC directory removal",
    failures,
    ipcDirectory,
  );
  const removed = await stat(ipcDirectory).then(
    () => false,
    (error: unknown) => isErrnoException(error) && error.code === "ENOENT",
  );
  if (!removed) {
    failures.push(new Error("Cross-process IPC directory removal was not observable."));
  }
  return removed;
}

async function inspectAndRemoveIpcDirectory(
  ipcDirectory: string,
  failures: Error[],
): Promise<boolean> {
  await captureCleanupFailure(
    async () => {
      const retainedEntries = await readdir(ipcDirectory);
      if (retainedEntries.length > 0) {
        const noun = retainedEntries.length === 1 ? "entry" : "entries";
        failures.push(
          new Error(
            `Cross-process IPC directory retained ${String(retainedEntries.length)} ${noun} ` +
              "after child and transports closed.",
          ),
        );
      }
    },
    "IPC directory inspection",
    failures,
    ipcDirectory,
  );
  return await removeIpcDirectory(ipcDirectory, failures);
}

async function cleanupFailedFixtureSetup(resources: FailedFixtureSetup): Promise<Error[]> {
  const failures: Error[] = [];
  const parentTransport = resources.parentTransport;
  if (parentTransport !== undefined) {
    await captureCleanupFailure(
      () =>
        resources.closeParentTransport?.(parentTransport, resources.ipcDirectory) ??
        parentTransport.close(),
      "parent transport close after setup failure",
      failures,
      resources.ipcDirectory,
    );
  }
  const trackedChild = resources.trackedChild;
  if (trackedChild !== undefined) {
    if (trackedChild.state() === undefined) {
      await captureCleanupFailure(
        () => sendChildMessage(trackedChild.child, { type: "shutdown" }),
        "child shutdown after setup failure",
        failures,
        resources.ipcDirectory,
      );
    }
    await awaitChildExitOrTerminate(trackedChild, failures, resources.ipcDirectory);
  }
  await removeIpcDirectory(resources.ipcDirectory, failures);
  return failures;
}

function throwSetupFailure(primary: unknown, cleanupFailures: readonly Error[]): never {
  const setupError = toError(primary);
  if (cleanupFailures.length === 0) {
    throw setupError;
  }
  throw new AggregateError(
    [setupError, ...cleanupFailures],
    "Cross-process fixture setup and cleanup failed.",
  );
}

async function exitsWithin(trackedChild: TrackedChild, milliseconds: number): Promise<boolean> {
  try {
    await withinPhase(trackedChild.exit, milliseconds, "setup fault child exit evidence");
    return true;
  } catch {
    return false;
  }
}

async function pathIsAbsent(filePath: string): Promise<boolean> {
  return await stat(filePath).then(
    () => false,
    (error: unknown) => isErrnoException(error) && error.code === "ENOENT",
  );
}

async function emergencySetupCleanup(resources: FixtureSetupResources | undefined): Promise<void> {
  if (resources === undefined) {
    return;
  }
  await resources.parentTransport.close().catch(() => undefined);
  if (resources.trackedChild.state() === undefined) {
    resources.trackedChild.child.kill("SIGKILL");
    await resources.trackedChild.exit;
  }
  await rm(resources.ipcDirectory, { recursive: true, force: true });
}

async function sendChildMessage(child: ChildProcess, message: ParentMessage): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    child.send(message, (error) => {
      if (error === null) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

async function captureCleanupFailure(
  run: () => void | Promise<void>,
  phase: string,
  failures: Error[],
  ipcDirectory: string,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    failures.push(phaseError(phase, error, ipcDirectory));
  }
}

function phaseError(phase: string, error: unknown, ipcDirectory: string): Error {
  return new Error(`Cross-process ${phase} failed: ${safeMessage(error, ipcDirectory)}.`);
}

function safeMessage(error: unknown, ipcDirectory: string): string {
  const source = error instanceof Error ? error.message : String(error);
  return source
    .replaceAll(ipcDirectory, "<ipc-directory>")
    .replace(/[\r\n\t]+/gu, " ")
    .slice(0, 240);
}

async function expectListenerClosed(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    socket.setTimeout(500);
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error("Child HTTP/2 listener still accepts connections."));
    });
    socket.once("error", () => {
      socket.destroy();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("Child HTTP/2 listener leak check timed out."));
    });
  });
}

async function waitFor(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

const observationBehaviors = new Set<string>([
  "command-handled",
  "primary-projected",
  "secondary-projected",
]);
const observationSources = new Set<string>(["command", "inbound-event"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isErrnoException(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error;
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
