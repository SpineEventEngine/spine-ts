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

import { fork, type ChildProcess } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { create } from "@bufbuild/protobuf";
import { createClient, type Interceptor } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { TypeUrls, AnyMessages, SignalEnvelopes } from "@spine-event-engine/core";
import { UserIdSchema } from "@spine-event-engine/proto";
import {
  QueryIdSchema,
  QueryResponseSchema,
  QuerySchema,
  type Query,
  type QueryResponse,
} from "@spine-event-engine/proto/client";
import { QueryService } from "@spine-event-engine/proto/client";
import { TargetFiltersSchema, TargetSchema } from "@spine-event-engine/proto/client";
import { SignalMetadata } from "@spine-event-engine/server";
import { TransportTopics, type SignalTransport } from "@spine-event-engine/transport";
import { createZeroMqTransport, ZeroMqConfig } from "@spine-event-engine/transport/zeromq";
import { describe, expect, it, vi } from "vitest";

import { CreateTaskSchema } from "../generated/spine/examples/todo/task_commands_pb.js";
import { TaskIdSchema } from "../generated/spine/examples/todo/task_id_pb.js";
import { TaskListSchema, type TaskList } from "../generated/spine/examples/todo/task_list_pb.js";
import { TaskListIdSchema } from "../generated/spine/examples/todo/task_id_pb.js";

const requestTimeoutMs = 2_000;
const receiveTimeoutMs = 100;
const readinessTimeoutMs = 5_000;
const observationTimeoutMs = 5_000;
const queryRetryDelayMs = 20;
const controlTimeoutMs = 1_000;
const gracefulShutdownTimeoutMs = 5_000;
const terminateTimeoutMs = 1_000;
const outerTestTimeoutMs = 25_000;
const maxDiagnosticLength = 480;
const maxDiagnosticRowIds = 4;
const maxDiagnosticIdLength = 64;
const adapterIdentity = "todo-local-multi-process";
const startupPendingMarker = "startup-pending";
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

type ChildCloseResource = "running server" | "environment";
type WorkerMode = "default" | "exit-after-ready" | "ignore-stop" | "no-ready" | "pending-startup";

interface FixtureCreateOptions {
  readonly workerPath?: string;
  readonly workerMode?: WorkerMode;
  readonly immediateQueryErrors?: boolean;
  readonly statelessQueryRows?: boolean;
  readonly stallQueries?: boolean;
  readonly childCloseFailures?: readonly ChildCloseResource[];
  readonly onResourcesAcquired?: (resources: FixtureSetupResources) => void;
  readonly onCloseParentTransport?: (transport: SignalTransport) => Promise<void>;
  readonly onRemoveIpcDirectory?: (ipcDirectory: string) => Promise<void>;
  readonly onStatIpcDirectory?: (ipcDirectory: string) => Promise<unknown>;
}

interface TrackedChild {
  readonly child: ChildProcess;
  readonly exit: Promise<ChildExitState>;
  readonly state: () => ChildExitState | undefined;
}

describe("local multi-process to-do mode", () => {
  it("queries only the deterministic task-list ID", () => {
    expect(createTaskListQuery().target?.criterion).toEqual({
      case: "filters",
      value: create(TargetFiltersSchema, {
        idFilter: {
          id: [
            AnyMessages.pack(
              TaskListIdSchema,
              create(TaskListIdSchema, { value: "local-multi-process-task" }),
            ),
          ],
        },
      }),
    });
  });

  it(
    "bounds and sanitizes unreadable query row diagnostics and cleans up",
    async () => {
      const fixture = await LocalMultiProcessFixture.create({ statelessQueryRows: true });
      let primaryFailure: Error | undefined;
      let cleanup: CleanupResult | undefined;
      let observationStartedAt: number | undefined;

      try {
        await fixture.ready();
        observationStartedAt = Date.now();
        await fixture.readTaskListEventually();
      } catch (error) {
        primaryFailure = asError(error);
      } finally {
        cleanup = await fixture.close(primaryFailure);
      }

      const elapsedMs = Date.now() - (observationStartedAt ?? Date.now());
      const failureMessage = primaryFailure?.message ?? "";
      expect(failureMessage).toContain(
        `projected task observation timed out after ${String(observationTimeoutMs)}ms`,
      );
      expect(failureMessage).toContain("last row IDs [<unreadable>,unsafe row ");
      expect(failureMessage).toContain("<3 rows omitted>");
      expect(failureMessage).not.toContain("extra-row-2");
      expect(failureMessage).not.toContain("TypeError");
      expect(failureMessage).not.toMatch(/[\r\n\t]/u);
      expect(failureMessage.length).toBeLessThanOrEqual(maxDiagnosticLength);
      expect(elapsedMs).toBeGreaterThanOrEqual(observationTimeoutMs - 250);
      expect(elapsedMs).toBeLessThan(observationTimeoutMs + 1_500);
      expect(cleanup).toEqual({
        childExitCode: 0,
        childExitSignal: null,
        forcedTermination: false,
        listenerClosed: true,
        ipcDirectoryRemoved: true,
      });
    },
    outerTestTimeoutMs,
  );

  it("stops waiting for a path at its own deadline", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "stmp-path-wait-"));
    const marker = path.join(directory, "late-marker");
    const markerDelayMs = 100;
    const timeoutMs = 25;
    const startedAt = Date.now();
    const lateMarker = delay(markerDelayMs).then(async () => writeFile(marker, "late", "utf8"));

    try {
      const rejection = await waitForPath(marker, "controlled path wait", timeoutMs).catch(
        (error: unknown) => error,
      );
      const elapsedMs = Date.now() - startedAt;
      await lateMarker;

      expect(asError(rejection).message).toBe(
        `Local multi-process controlled path wait timed out after ${String(timeoutMs)}ms.`,
      );
      expect(elapsedMs).toBeLessThan(markerDelayMs);
    } finally {
      await lateMarker;
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("surfaces a path polling stat failure before its deadline", async () => {
    const timeoutMs = 1_000;
    const statFailure = Object.assign(new Error("Injected path stat failure."), {
      code: "EACCES",
    });
    let statAttempts = 0;
    const startedAt = Date.now();

    const rejection = await waitForPath(
      "controlled-path",
      "controlled path wait",
      timeoutMs,
      () => {
        statAttempts += 1;
        return Promise.reject(statFailure);
      },
    ).catch((error: unknown) => error);
    const elapsedMs = Date.now() - startedAt;

    expect(rejection).toBe(statFailure);
    expect(asError(rejection).message).toBe("Injected path stat failure.");
    expect(statAttempts).toBe(1);
    expect(elapsedMs).toBeLessThan(250);
  });

  it("clears the child-exit timeout when the child settles early", async () => {
    vi.useFakeTimers();
    try {
      expect(await settles(Promise.resolve(), gracefulShutdownTimeoutMs)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it(
    "routes one generated CreateTask to the child and observes its exact projected state",
    async () => {
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
            id: create(TaskListIdSchema, { value: "local-multi-process-task" }),
            tasks: [
              {
                id: create(TaskIdSchema, { value: "local-multi-process-task" }),
                taskListId: create(TaskListIdSchema, { value: "local-multi-process-task" }),
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
    },
    outerTestTimeoutMs,
  );

  it(
    "reports an early child exit before readiness and removes acquired local resources",
    async () => {
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
    },
    outerTestTimeoutMs,
  );

  it(
    "reports a child exit after readiness and removes acquired local resources",
    async () => {
      let resources: FixtureSetupResources | undefined;
      const fixture = await LocalMultiProcessFixture.create({
        workerMode: "exit-after-ready",
        onResourcesAcquired: (acquired) => {
          resources = acquired;
        },
      });
      let primaryFailure: Error | undefined;
      let cleanup: CleanupResult | undefined;

      try {
        await fixture.ready();
        await requireSetupResources(resources).childExit;
        await fixture.readTaskListEventually();
      } catch (error) {
        primaryFailure = asError(error);
      } finally {
        cleanup = await fixture.close(primaryFailure);
      }

      expect(primaryFailure?.message).toContain("child exited after readiness");
      expect(primaryFailure?.message).not.toContain("before readiness");
      expect(cleanup).toEqual({
        childExitCode: 23,
        childExitSignal: null,
        forcedTermination: false,
        listenerClosed: true,
        ipcDirectoryRemoved: true,
      });
    },
    outerTestTimeoutMs,
  );

  it(
    "cleans child, listener, transport, and IPC directory after an assertion-path failure",
    async () => {
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
    },
    outerTestTimeoutMs,
  );

  it(
    "reports only IPC entries retained after normal recursive removal",
    async () => {
      const staleEntry = "stale-before-removal";
      const postRemovalEntry = "retained-after-removal";
      let resources: FixtureSetupResources | undefined;
      const fixture = await LocalMultiProcessFixture.create({
        onResourcesAcquired: (acquired) => {
          resources = acquired;
        },
        onRemoveIpcDirectory: async (ipcDirectory) => {
          await rm(ipcDirectory, { recursive: true, force: true });
          await mkdir(ipcDirectory, { mode: 0o700 });
          await writeFile(path.join(ipcDirectory, postRemovalEntry), "retained", "utf8");
        },
      });
      const acquired = requireSetupResources(resources);
      let closeAttempted = false;

      try {
        await fixture.ready();
        await writeFile(path.join(acquired.ipcDirectory, staleEntry), "stale", "utf8");
        closeAttempted = true;
        const rejection = await fixture.close(undefined).catch((error: unknown) => error);

        expect(rejection).toBeInstanceOf(AggregateError);
        const messages = aggregateMessages(rejection);
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain(postRemovalEntry);
        expect(messages[0]).not.toContain(staleEntry);
        expect(await acquired.childExit).toEqual({ code: 0, signal: null });
        expect(await isAbsent(acquired.ipcDirectory)).toBe(false);
      } finally {
        try {
          if (!closeAttempted) {
            await fixture.close(undefined).catch(() => undefined);
          }
        } finally {
          await rm(acquired.ipcDirectory, { recursive: true, force: true });
        }
      }
      expect(await isAbsent(acquired.ipcDirectory)).toBe(true);
    },
    outerTestTimeoutMs,
  );

  it(
    "attempts every owned child close in order and still stops after shutdown failures",
    async () => {
      let resources: FixtureSetupResources | undefined;
      const fixture = await LocalMultiProcessFixture.create({
        onResourcesAcquired: (acquired: FixtureSetupResources) => {
          resources = acquired;
        },
        childCloseFailures: ["running server", "environment"],
      });

      await fixture.ready();
      const rejection = await fixture.close(undefined).catch((error: unknown) => error);

      expect(rejection).toBeInstanceOf(AggregateError);
      expect(asError(rejection).message).toBe("Local multi-process fixture cleanup failed.");
      expect(aggregateMessages(rejection)).toEqual([
        expect.stringContaining(
          "running server close failed: Injected running server close failure.; " +
            "environment close failed: Injected environment close failure.",
        ),
      ]);
      expect(await resources?.childExit).toEqual({ code: 1, signal: null });
      expect(await isAbsent(resources?.ipcDirectory ?? "")).toBe(true);
    },
    outerTestTimeoutMs,
  );

  it(
    "preserves partial-setup primary and cleanup failures while releasing every resource",
    async () => {
      const setupFailure = new Error("Injected partial fixture setup failure.");
      const parentCloseFailure = new Error("Injected setup parent transport close failure.");
      const directoryRemovalFailure = new Error("Injected setup directory removal failure.");
      const verificationFailure = Object.assign(
        new Error("Injected setup directory stat failure"),
        { code: "EACCES" },
      );
      let resources: FixtureSetupResources | undefined;
      let unexpectedFixture: LocalMultiProcessFixture | undefined;
      let rejection: unknown;

      try {
        unexpectedFixture = await LocalMultiProcessFixture.create({
          onResourcesAcquired: (acquired: FixtureSetupResources) => {
            resources = acquired;
            throw setupFailure;
          },
          onCloseParentTransport: async (transport: SignalTransport) => {
            await transport.close();
            throw parentCloseFailure;
          },
          onRemoveIpcDirectory: async (ipcDirectory: string) => {
            await rm(ipcDirectory, { recursive: true, force: true });
            throw directoryRemovalFailure;
          },
          onStatIpcDirectory: () => Promise.reject(verificationFailure),
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
      expect(asError(rejection.errors[3]).message).toBe(
        "Local multi-process setup IPC directory absence verification failed: " +
          "Injected setup directory stat failure.",
      );
      expect(await resources?.childExit).toEqual({ code: 0, signal: null });
      expect(await isAbsent(resources?.ipcDirectory ?? "")).toBe(true);
    },
    outerTestTimeoutMs,
  );

  it(
    "reports retained IPC entries when partial-setup removal leaves the directory present",
    async () => {
      const setupFailure = new Error("Injected retained-directory setup failure.");
      const retainedEntry = "retained-marker";
      let resources: FixtureSetupResources | undefined;
      let unexpectedFixture: LocalMultiProcessFixture | undefined;
      let rejection: unknown;

      try {
        unexpectedFixture = await LocalMultiProcessFixture.create({
          onResourcesAcquired: (acquired) => {
            resources = acquired;
            throw setupFailure;
          },
          onRemoveIpcDirectory: async (ipcDirectory) => {
            await writeFile(path.join(ipcDirectory, retainedEntry), "retained", "utf8");
          },
        });
      } catch (error) {
        rejection = error;
      }

      const acquired = requireSetupResources(resources);
      try {
        expect(rejection).toBeInstanceOf(AggregateError);
        if (!(rejection instanceof AggregateError)) {
          throw new Error("Partial fixture setup did not diagnose its retained directory.");
        }
        expect(rejection.errors[0]).toBe(setupFailure);
        expect(asError(rejection.errors[1]).message).toContain(
          "Private IPC directory remains after setup cleanup; retained entries [",
        );
        expect(asError(rejection.errors[1]).message).toContain(retainedEntry);
        expect(await acquired.childExit).toEqual({ code: 0, signal: null });
        expect(await isAbsent(acquired.ipcDirectory)).toBe(false);
      } finally {
        try {
          await unexpectedFixture?.close(undefined);
        } finally {
          await rm(acquired.ipcDirectory, { recursive: true, force: true });
        }
      }
      expect(await isAbsent(acquired.ipcDirectory)).toBe(true);
    },
    outerTestTimeoutMs,
  );

  it(
    "preserves a primary failure when IPC directory absence verification fails",
    async () => {
      const primaryFailure = new Error("Injected primary operation failure.");
      const verificationFailure = Object.assign(new Error("Injected IPC directory stat failure"), {
        code: "EACCES",
      });
      let resources: FixtureSetupResources | undefined;
      const fixture = await LocalMultiProcessFixture.create({
        onResourcesAcquired: (acquired) => {
          resources = acquired;
        },
        onStatIpcDirectory: () => Promise.reject(verificationFailure),
      });
      let cleanup: CleanupResult | undefined;
      let rejection: unknown;

      await fixture.ready();
      try {
        cleanup = await fixture.close(primaryFailure);
      } catch (error) {
        rejection = error;
      }

      expect(cleanup).toBeUndefined();
      expect(rejection).toBeInstanceOf(AggregateError);
      if (!(rejection instanceof AggregateError)) {
        throw new Error("Directory verification did not preserve aggregate diagnostics.");
      }
      expect(rejection.message).toBe("Primary operation and cleanup failed.");
      expect(rejection.errors[0]).toBe(primaryFailure);
      expect(rejection.errors[1]).toBeInstanceOf(AggregateError);
      expect(aggregateMessages(rejection.errors[1])).toEqual([
        "Local multi-process IPC directory absence verification failed: " +
          "Injected IPC directory stat failure.",
      ]);
      expect(await requireSetupResources(resources).childExit).toEqual({ code: 0, signal: null });
      expect(await isAbsent(requireSetupResources(resources).ipcDirectory)).toBe(true);
    },
    outerTestTimeoutMs,
  );

  it(
    "suppresses readiness and closes without force when shutdown arrives during startup",
    async () => {
      let resources: FixtureSetupResources | undefined;
      const fixture = await LocalMultiProcessFixture.create({
        workerMode: "pending-startup",
        onResourcesAcquired: (acquired) => {
          resources = acquired;
        },
      });
      let closed = false;
      let cleanup: CleanupResult | undefined;

      try {
        const acquired = requireSetupResources(resources);
        await waitForPath(
          path.join(acquired.ipcDirectory, startupPendingMarker),
          "controlled pending startup",
          readinessTimeoutMs,
        );
        cleanup = await fixture.close(undefined);
        closed = true;
      } finally {
        if (!closed) {
          await fixture.close(undefined);
        }
      }

      expect(fixture.readyReceived).toBe(false);
      expect(cleanup).toEqual({
        childExitCode: 0,
        childExitSignal: null,
        forcedTermination: false,
        listenerClosed: true,
        ipcDirectoryRemoved: true,
      });
    },
    outerTestTimeoutMs,
  );

  it(
    "cancels stalled QueryService reads at the five-second observation deadline and cleans up",
    async () => {
      const fixture = await LocalMultiProcessFixture.create({ stallQueries: true });
      let primaryFailure: Error | undefined;
      let cleanup: CleanupResult | undefined;
      let observationStartedAt: number | undefined;

      try {
        await fixture.ready();
        await fixture.requestCreateTask();
        observationStartedAt = Date.now();
        await fixture.readTaskListEventually();
      } catch (error) {
        primaryFailure = asError(error);
      } finally {
        cleanup = await fixture.close(primaryFailure);
      }

      const elapsedMs = Date.now() - (observationStartedAt ?? Date.now());
      expect(primaryFailure?.message).toContain(
        `projected task observation timed out after ${String(observationTimeoutMs)}ms`,
      );
      expect(elapsedMs).toBeGreaterThanOrEqual(observationTimeoutMs - 250);
      expect(elapsedMs).toBeLessThan(observationTimeoutMs + 1_500);
      expect(fixture.stalledQueryAbortCount).toBeGreaterThan(0);
      expect(cleanup).toMatchObject({
        childExitCode: 0,
        forcedTermination: false,
        listenerClosed: true,
        ipcDirectoryRemoved: true,
      });
    },
    outerTestTimeoutMs,
  );

  it(
    "paces immediate QueryService failures for the observation phase and cleans up",
    async () => {
      const fixture = await LocalMultiProcessFixture.create({ immediateQueryErrors: true });
      let primaryFailure: Error | undefined;
      let cleanup: CleanupResult | undefined;
      let observationStartedAt: number | undefined;

      try {
        await fixture.ready();
        await fixture.requestCreateTask();
        observationStartedAt = Date.now();
        await fixture.readTaskListEventually();
      } catch (error) {
        primaryFailure = asError(error);
      } finally {
        cleanup = await fixture.close(primaryFailure);
      }

      const elapsedMs = Date.now() - (observationStartedAt ?? Date.now());
      expect(primaryFailure?.message).toContain(
        `projected task observation timed out after ${String(observationTimeoutMs)}ms`,
      );
      expect(elapsedMs).toBeGreaterThanOrEqual(observationTimeoutMs - 250);
      expect(elapsedMs).toBeLessThan(observationTimeoutMs + 1_500);
      expect(fixture.immediateQueryErrorCount).toBeGreaterThan(1);
      expect(fixture.immediateQueryErrorCount).toBeLessThanOrEqual(
        Math.ceil(observationTimeoutMs / queryRetryDelayMs) + 1,
      );
      expect(cleanup).toMatchObject({
        childExitCode: 0,
        forcedTermination: false,
        listenerClosed: true,
        ipcDirectoryRemoved: true,
      });
    },
    outerTestTimeoutMs,
  );

  it(
    "times out a no-ready worker and releases its process and IPC directory",
    async () => {
      const fixture = await LocalMultiProcessFixture.create({ workerMode: "no-ready" });
      let primaryFailure: Error | undefined;
      let cleanup: CleanupResult | undefined;
      const readinessStartedAt = Date.now();
      let readinessElapsedMs: number | undefined;

      try {
        await fixture.ready();
      } catch (error) {
        readinessElapsedMs = Date.now() - readinessStartedAt;
        primaryFailure = asError(error);
      } finally {
        cleanup = await fixture.close(primaryFailure);
      }

      expect(primaryFailure?.message).toBe(
        `Local multi-process child readiness timed out after ${String(readinessTimeoutMs)}ms.`,
      );
      const elapsedMs = readinessElapsedMs ?? 0;
      expect(elapsedMs).toBeGreaterThanOrEqual(readinessTimeoutMs - 250);
      expect(elapsedMs).toBeLessThan(readinessTimeoutMs + 1_500);
      expect(cleanup).toMatchObject({
        childExitCode: 0,
        forcedTermination: false,
        listenerClosed: true,
        ipcDirectoryRemoved: true,
      });
    },
    outerTestTimeoutMs,
  );

  it(
    "uses SIGKILL within budget when the worker ignores shutdown and SIGTERM",
    async () => {
      let resources: FixtureSetupResources | undefined;
      const fixture = await LocalMultiProcessFixture.create({
        workerMode: "ignore-stop",
        onResourcesAcquired: (acquired) => {
          resources = acquired;
        },
      });
      const startedAt = Date.now();

      await fixture.ready();
      const cleanup = await fixture.close(undefined);

      expect(Date.now() - startedAt).toBeLessThan(
        gracefulShutdownTimeoutMs + terminateTimeoutMs + terminateTimeoutMs + 1_500,
      );
      expect(cleanup).toEqual({
        childExitCode: null,
        childExitSignal: "SIGKILL",
        forcedTermination: true,
        listenerClosed: true,
        ipcDirectoryRemoved: true,
      });
      expect(await requireSetupResources(resources).childExit).toEqual({
        code: null,
        signal: "SIGKILL",
      });
      expect(await isAbsent(requireSetupResources(resources).ipcDirectory)).toBe(true);
    },
    outerTestTimeoutMs,
  );
});

class LocalMultiProcessFixture {
  #childFailure: Error | undefined;
  #closed = false;
  #immediateQueryErrorCount = 0;
  #immediateQueryErrors: boolean;
  #ipcDirectory: string;
  #parentTransport: SignalTransport;
  #ready: ReadyMessage | undefined;
  #onRemoveIpcDirectory: FixtureCreateOptions["onRemoveIpcDirectory"];
  #onStatIpcDirectory: FixtureCreateOptions["onStatIpcDirectory"];
  #stallQueries: boolean;
  #statelessQueryRows: boolean;
  #stalledQueryAbortCount = 0;
  #stderr = "";
  #stopped = false;
  #trackedChild: TrackedChild;

  static async create(options: FixtureCreateOptions = {}): Promise<LocalMultiProcessFixture> {
    const ipcDirectory = await mkdtemp(path.join(tmpdir(), "stmp-"));
    let parentTransport: SignalTransport | undefined;
    let trackedChild: TrackedChild | undefined;

    try {
      await chmod(ipcDirectory, 0o700);
      const directory = await stat(ipcDirectory);
      expect(directory.isDirectory()).toBe(true);
      expect(directory.mode & 0o077).toBe(0);
      parentTransport = createZeroMqTransport(
        ZeroMqConfig.create({ ipcDirectory, adapterIdentity }),
        {
          requestTimeoutMs,
          receiveTimeoutMs,
        },
      );
      const child = fork(options.workerPath ?? workerPath, [], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SPINE_TODO_MULTI_PROCESS_ADAPTER_IDENTITY: adapterIdentity,
          SPINE_TODO_MULTI_PROCESS_CONTROL_TIMEOUT_MS: String(controlTimeoutMs),
          SPINE_TODO_MULTI_PROCESS_IPC_DIRECTORY: ipcDirectory,
          SPINE_TODO_MULTI_PROCESS_REQUEST_TIMEOUT_MS: String(requestTimeoutMs),
          SPINE_TODO_MULTI_PROCESS_RECEIVE_TIMEOUT_MS: String(receiveTimeoutMs),
          SPINE_TODO_MULTI_PROCESS_WORKER_MODE: options.workerMode ?? "default",
          ...(options.childCloseFailures === undefined
            ? {}
            : {
                SPINE_TODO_MULTI_PROCESS_CLOSE_FAILURES: options.childCloseFailures.join(","),
              }),
        },
        serialization: "json",
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      trackedChild = trackChild(child);
      options.onResourcesAcquired?.({
        ipcDirectory,
        childExit: trackedChild.exit,
      });
      return new LocalMultiProcessFixture(
        ipcDirectory,
        parentTransport,
        trackedChild,
        options.immediateQueryErrors ?? false,
        options.statelessQueryRows ?? false,
        options.stallQueries ?? false,
        options.onRemoveIpcDirectory,
        options.onStatIpcDirectory,
      );
    } catch (error) {
      const cleanupFailures = await cleanupFailedFixtureSetup({
        ipcDirectory,
        parentTransport,
        trackedChild,
        onCloseParentTransport: options.onCloseParentTransport,
        onRemoveIpcDirectory: options.onRemoveIpcDirectory,
        onStatIpcDirectory: options.onStatIpcDirectory,
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
    immediateQueryErrors: boolean,
    statelessQueryRows: boolean,
    stallQueries: boolean,
    onRemoveIpcDirectory: FixtureCreateOptions["onRemoveIpcDirectory"],
    onStatIpcDirectory: FixtureCreateOptions["onStatIpcDirectory"],
  ) {
    this.#ipcDirectory = ipcDirectory;
    this.#parentTransport = parentTransport;
    this.#trackedChild = trackedChild;
    this.#immediateQueryErrors = immediateQueryErrors;
    this.#statelessQueryRows = statelessQueryRows;
    this.#stallQueries = stallQueries;
    this.#onRemoveIpcDirectory = onRemoveIpcDirectory;
    this.#onStatIpcDirectory = onStatIpcDirectory;
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

  get immediateQueryErrorCount(): number {
    return this.#immediateQueryErrorCount;
  }

  get readyReceived(): boolean {
    return this.#ready !== undefined;
  }

  get stalledQueryAbortCount(): number {
    return this.#stalledQueryAbortCount;
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
        topic: TransportTopics.create({
          signalKind: "command",
          messageTypeUrl: TypeUrls.derive(CreateTaskSchema),
        }),
        envelope: SignalEnvelopes.command({
          id: signalMetadata.commandId("local-multi-process-create-command"),
          context: signalMetadata.commandContext({
            actorContext: signalMetadata.actorContext({
              actor: create(UserIdSchema, { value: "local-multi-process-parent" }),
            }),
          }),
          schema: CreateTaskSchema,
          message: create(CreateTaskSchema, {
            id: create(TaskIdSchema, { value: "local-multi-process-task" }),
            taskListId: create(TaskListIdSchema, { value: "local-multi-process-task" }),
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
      createGrpcTransport({
        baseUrl: `http://${ready.host}:${String(ready.port)}`,
        interceptors: [
          ...(this.#stallQueries
            ? [
                stalledQueryInterceptor(() => {
                  this.#stalledQueryAbortCount++;
                }),
              ]
            : []),
          ...(this.#immediateQueryErrors
            ? [
                immediateErrorQueryInterceptor(() => {
                  this.#immediateQueryErrorCount++;
                }),
              ]
            : []),
          ...(this.#statelessQueryRows ? [statelessQueryRowInterceptor()] : []),
        ],
      }),
    );
    let lastRowIds = "";
    let lastQueryStatus = "not attempted";
    const deadline = Date.now() + observationTimeoutMs;

    while (Date.now() < deadline) {
      this.#throwChildFailure("projected task observation");
      const remainingMs = Math.max(1, deadline - Date.now());
      const attemptTimeoutMs = Math.min(requestTimeoutMs, remainingMs);
      let response: QueryResponse;
      try {
        response = await within(
          queries.read(createTaskListQuery(), { timeoutMs: attemptTimeoutMs }),
          "QueryService read",
          attemptTimeoutMs,
        );
        lastQueryStatus = response.response?.status?.status.case ?? "missing status";
      } catch (error) {
        lastQueryStatus = sanitize(asError(error).message, this.#ipcDirectory);
        await delayBeforeQueryRetry(deadline);
        continue;
      }
      const list = findTaskList(response, "local-multi-process-task");
      lastRowIds = summarizeRowIds(response, this.#ipcDirectory);
      if (list !== undefined && isExpectedTaskList(list)) {
        return list;
      }
      await delayBeforeQueryRetry(deadline);
    }

    throw new Error(
      sanitize(
        `Local multi-process projected task observation timed out after ${String(observationTimeoutMs)}ms; ` +
          `last query status [${lastQueryStatus}]; last row IDs [${lastRowIds}].`,
        this.#ipcDirectory,
      ),
    );
  }

  async close(primaryFailure: Error | undefined): Promise<CleanupResult> {
    if (this.#closed) {
      throw new Error("Local multi-process fixture close must run exactly once.");
    }
    this.#closed = true;
    const failures: Error[] = [];
    const childFailureBeforeShutdown = this.#childFailure;
    await capture(
      () => this.#parentTransport.close(),
      "parent transport close",
      failures,
      this.#ipcDirectory,
    );

    const { child } = this.#trackedChild;
    if (this.#trackedChild.state() === undefined && child.connected) {
      await capture(
        () => sendControl(child, { type: "shutdown" }, "child shutdown control"),
        "child shutdown control",
        failures,
        this.#ipcDirectory,
      );
    }

    const { exitState, forcedTermination } = await stopChild(
      this.#trackedChild,
      failures,
      this.#ipcDirectory,
    );
    if (this.#childFailure !== undefined && this.#childFailure !== childFailureBeforeShutdown) {
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
    await capture(
      () => (this.#onRemoveIpcDirectory ?? removeDirectory)(this.#ipcDirectory),
      "IPC directory removal",
      failures,
      this.#ipcDirectory,
    );
    let ipcDirectoryRemoved: boolean | undefined;
    try {
      ipcDirectoryRemoved = await isAbsent(this.#ipcDirectory, this.#onStatIpcDirectory);
    } catch (error) {
      failures.push(phaseError("IPC directory absence verification", error, this.#ipcDirectory));
    }
    if (ipcDirectoryRemoved === false) {
      const retainedEntries = await readdir(this.#ipcDirectory).catch(() => [] as string[]);
      failures.push(
        new Error(
          `Private IPC directory remains after cleanup; retained entries [${retainedEntries.join(", ")}].`,
        ),
      );
    }
    if (failures.length > 0) {
      const cleanupFailure = new AggregateError(
        failures,
        "Local multi-process fixture cleanup failed.",
      );
      if (primaryFailure !== undefined) {
        throw new AggregateError(
          [primaryFailure, cleanupFailure],
          "Primary operation and cleanup failed.",
        );
      }
      throw cleanupFailure;
    }
    return {
      childExitCode: exitState.code,
      childExitSignal: exitState.signal,
      forcedTermination,
      listenerClosed,
      ipcDirectoryRemoved: ipcDirectoryRemoved ?? false,
    };
  }

  async #eventually(onPredicate: () => boolean, phase: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.#throwChildFailure(phase);
      if (onPredicate()) {
        return;
      }
      const remainingMs = deadline - Date.now();
      if (remainingMs > 0) {
        await delay(Math.min(10, remainingMs));
      }
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
      const readiness = this.#ready === undefined ? "before readiness" : "after readiness";
      throw new Error(
        `Local multi-process child exited ${readiness} during ${phase}: code ${String(exitState.code)}, ` +
          `signal ${String(exitState.signal)}${stderr === "" ? "." : `; stderr ${stderr}.`}`,
      );
    }
  }

  #acceptMessage(message: unknown): void {
    if (!isChildMessage(message)) {
      this.#childFailure = new Error(
        "Local multi-process child sent an invalid lifecycle message.",
      );
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
  readonly onCloseParentTransport: FixtureCreateOptions["onCloseParentTransport"];
  readonly onRemoveIpcDirectory: FixtureCreateOptions["onRemoveIpcDirectory"];
  readonly onStatIpcDirectory: FixtureCreateOptions["onStatIpcDirectory"];
}): Promise<Error[]> {
  const failures: Error[] = [];
  if (options.parentTransport !== undefined) {
    try {
      await (options.onCloseParentTransport ?? closeTransport)(options.parentTransport);
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
    await stopChild(trackedChild, failures, options.ipcDirectory);
  }

  try {
    await (options.onRemoveIpcDirectory ?? removeDirectory)(options.ipcDirectory);
  } catch (error) {
    failures.push(asError(error));
  }
  let ipcDirectoryRemoved: boolean | undefined;
  try {
    ipcDirectoryRemoved = await isAbsent(options.ipcDirectory, options.onStatIpcDirectory);
  } catch (error) {
    failures.push(
      phaseError("setup IPC directory absence verification", error, options.ipcDirectory),
    );
  }
  if (ipcDirectoryRemoved === false) {
    const retainedEntries = await readdir(options.ipcDirectory).catch(() => [] as string[]);
    failures.push(
      new Error(
        `Private IPC directory remains after setup cleanup; retained entries [${retainedEntries.join(", ")}].`,
      ),
    );
  }
  return failures;
}

async function stopChild(
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
      exitState = await within(trackedChild.exit, "child exit after SIGKILL", terminateTimeoutMs);
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

function stalledQueryInterceptor(onAbort: () => void): Interceptor {
  return () => async (request) =>
    await new Promise<never>((_, reject) => {
      const abort = () => {
        onAbort();
        reject(new Error("Controlled stalled QueryService read was canceled."));
      };
      if (request.signal.aborted) {
        abort();
      } else {
        request.signal.addEventListener("abort", abort, { once: true });
      }
    });
}

function immediateErrorQueryInterceptor(onAttempt: () => void): Interceptor {
  return () => () => {
    onAttempt();
    return Promise.reject(new Error("Controlled immediate QueryService read failure."));
  };
}

function statelessQueryRowInterceptor(): Interceptor {
  return (onNext) => async (request) => {
    const response = await onNext(request);
    if (response.stream) {
      return response;
    }
    return {
      ...response,
      message: controlledDiagnosticQueryResponse(),
    };
  };
}

function controlledDiagnosticQueryResponse(): QueryResponse {
  return create(QueryResponseSchema, {
    message: [
      {},
      {
        state: AnyMessages.pack(
          TaskListSchema,
          create(TaskListSchema, {
            id: create(TaskListIdSchema, {
              value: `unsafe\nrow\t${"x".repeat(maxDiagnosticLength)}`,
            }),
          }),
        ),
      },
      ...Array.from({ length: maxDiagnosticRowIds + 1 }, (_, index) => ({
        state: AnyMessages.pack(
          TaskListSchema,
          create(TaskListSchema, {
            id: create(TaskListIdSchema, { value: `extra-row-${String(index)}` }),
          }),
        ),
      })),
    ],
  });
}

async function delayBeforeQueryRetry(deadline: number): Promise<void> {
  const remainingMs = deadline - Date.now();
  if (remainingMs > 0) {
    await delay(Math.min(queryRetryDelayMs, remainingMs));
  }
}

function createTaskListQuery(): Query {
  return create(QuerySchema, {
    id: create(QueryIdSchema, { value: "local-multi-process-query" }),
    target: create(TargetSchema, {
      type: TypeUrls.derive(TaskListSchema),
      criterion: {
        case: "filters",
        value: create(TargetFiltersSchema, {
          idFilter: {
            id: [
              AnyMessages.pack(
                TaskListIdSchema,
                create(TaskListIdSchema, { value: "local-multi-process-task" }),
              ),
            ],
          },
        }),
      },
    }),
    context: signalMetadata.actorContext({
      actor: create(UserIdSchema, { value: "local-multi-process-parent" }),
    }),
  });
}

function findTaskList(response: QueryResponse, id: string): TaskList | undefined {
  for (const message of response.message) {
    if (message.state === undefined) {
      continue;
    }
    const list = AnyMessages.unpack(message.state, TaskListSchema);
    if (list?.id?.value === id) {
      return list;
    }
  }
  return undefined;
}

function summarizeRowIds(response: QueryResponse, ipcDirectory: string): string {
  const inspectedRows = response.message.slice(0, maxDiagnosticRowIds);
  const rowIds = inspectedRows.map((message) => {
    if (message.state === undefined) {
      return "<unreadable>";
    }
    const id = AnyMessages.unpack(message.state, TaskListSchema)?.id?.value;
    return id === undefined ? "<unreadable>" : sanitizeRowId(id, ipcDirectory);
  });
  const omittedRows = response.message.length - inspectedRows.length;
  if (omittedRows > 0) {
    rowIds.push(`<${String(omittedRows)} rows omitted>`);
  }
  return sanitize(rowIds.join(","), ipcDirectory);
}

function sanitizeRowId(id: string, ipcDirectory: string): string {
  const sanitized = sanitize(id, ipcDirectory);
  if (sanitized.length <= maxDiagnosticIdLength) {
    return sanitized;
  }
  return `${sanitized.slice(0, maxDiagnosticIdLength - 3)}...`;
}

function isExpectedTaskList(list: TaskList): boolean {
  const task = list.tasks[0];
  if (
    task === undefined ||
    list.id === undefined ||
    task.id === undefined ||
    task.taskListId === undefined
  ) {
    return false;
  }
  return (
    list.id.value === "local-multi-process-task" &&
    list.openTaskCount === 1 &&
    list.tasks.length === 1 &&
    task.id.value === "local-multi-process-task" &&
    task.taskListId.value === "local-multi-process-task" &&
    task.title === "Handled by child process" &&
    !task.completed
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
        new Error(`Local multi-process ${phase} timed out after ${String(controlTimeoutMs)}ms.`),
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
        timeout = setTimeout(() => {
          reject(new Error(`Local multi-process ${phase} timed out after ${String(timeoutMs)}ms.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function settles(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<boolean>((resolve) => {
        timeout = setTimeout(() => {
          resolve(false);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function capture(
  onOperation: () => Promise<void>,
  phase: string,
  failures: Error[],
  ipcDirectory: string,
): Promise<void> {
  try {
    await onOperation();
  } catch (error) {
    failures.push(phaseError(phase, error, ipcDirectory));
  }
}

async function isAbsent(
  target: string,
  onStat: (target: string) => Promise<unknown> = stat,
): Promise<boolean> {
  try {
    await onStat(target);
    return false;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function phaseError(phase: string, error: unknown, ipcDirectory: string): Error {
  return new Error(
    `Local multi-process ${phase} failed: ${sanitize(asError(error).message, ipcDirectory)}.`,
  );
}

function sanitize(value: string, ipcDirectory: string): string {
  return value
    .replaceAll(ipcDirectory, "<ipc-directory>")
    .replaceAll(/[\r\n\t]+/gu, " ")
    .slice(0, maxDiagnosticLength);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function aggregateMessages(error: unknown): string[] {
  return error instanceof AggregateError ? error.errors.map((entry) => asError(entry).message) : [];
}

function requireSetupResources(
  resources: FixtureSetupResources | undefined,
): FixtureSetupResources {
  if (resources === undefined) {
    throw new Error("Expected local multi-process setup resources.");
  }
  return resources;
}

async function waitForPath(
  target: string,
  phase: string,
  timeoutMs: number,
  onStat: (target: string) => Promise<unknown> = stat,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isAbsent(target, onStat))) {
      return;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) {
      await delay(Math.min(10, remainingMs));
    }
  }
  throw new Error(`Local multi-process ${phase} timed out after ${String(timeoutMs)}ms.`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
