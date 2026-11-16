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

import type { RunningServer } from "./server.js";
import type { Application } from "./application.js";
import { applicationAccess } from "./application.js";
import type { ILogLayer } from "loglayer";

import { emitServerError } from "./server-log.js";

interface RunRecord {
  readonly server: RunningServer;
  readonly application: Application | undefined;
  readonly logger: ILogLayer | undefined;
  retirement: Promise<void> | undefined;
}

const running: RunRecord[] = [];
let signalsInstalled = false;
let closingRunning: Promise<void> | undefined;

/**
 * Coordinates process-owned server shutdown without exposing lifecycle seams.
 *
 * @internal
 */
export const ProcessServerCoordinator: Readonly<{
  add(
    server: RunningServer,
    application: Application | undefined,
    logger: ILogLayer | undefined,
    onRetired: () => void,
  ): RunningServer;
  installSignals(): void;
  onSignal(): void;
  closeRunning(): Promise<void>;
}> = Object.freeze({
  add(
    server: RunningServer,
    application: Application | undefined,
    logger: ILogLayer | undefined,
    onRetired: () => void,
  ): RunningServer {
    const record: RunRecord = { server, application, logger, retirement: undefined };
    running.push(record);
    ProcessServerCoordinator.installSignals();
    return {
      host: server.host,
      port: server.port,
      baseUrl: server.baseUrl,
      close: async () => {
        await server.close();
        await ProcessServerCoordinatorValues.retire(record);
        onRetired();
      },
    };
  },
  installSignals(): void {
    if (signalsInstalled) return;
    signalsInstalled = true;
    process.on("SIGINT", ProcessServerCoordinator.onSignal);
    process.on("SIGTERM", ProcessServerCoordinator.onSignal);
  },

  onSignal(): void {
    void ProcessServerCoordinator.closeRunning();
  },

  closeRunning(): Promise<void> {
    closingRunning ??= ProcessServerCoordinatorValues.closeRunning().finally(() => {
      closingRunning = undefined;
    });
    return closingRunning;
  },
});

/**
 * Groups private process-owned run retirement operations.
 *
 * @internal
 */
const ProcessServerCoordinatorValues = Object.freeze({
  /**
   * Closes managed endpoints in reverse registration order on a process signal.
   *
   * @returns Completion after each endpoint retirement is attempted.
   */
  async closeRunning(): Promise<void> {
    for (const record of [...running].reverse()) {
      try {
        await record.server.close();
        await ProcessServerCoordinatorValues.retire(record);
        // spine-log-boundary: server.process_shutdown_close
      } catch {
        process.exitCode = 1;
        if (record.logger !== undefined) {
          emitServerError(record.logger, "Process-owned server shutdown failed.", {
            operation: "server.process_shutdown",
            reasonCode: "close_failed",
          });
        }
      }
    }
  },

  /**
   * Removes a retired endpoint and uninstalls signals after the final one.
   *
   * @param record Managed endpoint to remove.
   */
  remove(record: RunRecord): void {
    const index = running.indexOf(record);
    if (index >= 0) running.splice(index, 1);
    if (running.length > 0) return;
    process.off("SIGINT", ProcessServerCoordinator.onSignal);
    process.off("SIGTERM", ProcessServerCoordinator.onSignal);
    signalsInstalled = false;
  },

  /**
   * Closes the shared Application after its final managed endpoint retires.
   *
   * @param record Managed endpoint completing shutdown.
   * @returns Completion after Application closure when this is its final endpoint.
   */
  retire(record: RunRecord): Promise<void> {
    const current = record.retirement;
    if (current !== undefined) return current;
    const retirement = Promise.resolve()
      .then(async () => {
        if (!running.includes(record)) return;
        if (record.application !== undefined)
          await applicationAccess.whenManagedStartsIdle(record.application);
        if (
          record.application !== undefined &&
          !running.some(
            (candidate) => candidate !== record && candidate.application === record.application,
          )
        )
          await record.application.close();
        ProcessServerCoordinatorValues.remove(record);
      })
      .catch((error: unknown) => {
        record.retirement = undefined;
        throw error;
      });
    record.retirement = retirement;
    return retirement;
  },
});
