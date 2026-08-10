import type { RunningServer } from "./server.js";
import type { ServerEnvironment } from "./server-environment.js";
import type { ILogLayer } from "loglayer";

import { emitServerError } from "./server-log.js";

interface RunRecord {
  readonly server: RunningServer;
  readonly environment: ServerEnvironment | undefined;
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
    environment: ServerEnvironment | undefined,
    logger: ILogLayer | undefined,
    onRetired: () => void,
  ): RunningServer;
  installSignals(): void;
  onSignal(): void;
  closeRunning(): Promise<void>;
}> = Object.freeze({
  add(
    server: RunningServer,
    environment: ServerEnvironment | undefined,
    logger: ILogLayer | undefined,
    onRetired: () => void,
  ): RunningServer {
    const record: RunRecord = { server, environment, logger, retirement: undefined };
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
  remove(record: RunRecord): void {
    const index = running.indexOf(record);
    if (index >= 0) running.splice(index, 1);
    if (running.length > 0) return;
    process.off("SIGINT", ProcessServerCoordinator.onSignal);
    process.off("SIGTERM", ProcessServerCoordinator.onSignal);
    signalsInstalled = false;
  },
  retire(record: RunRecord): Promise<void> {
    const current = record.retirement;
    if (current !== undefined) return current;
    const retirement = Promise.resolve()
      .then(async () => {
        if (!running.includes(record)) return;
        if (
          record.environment !== undefined &&
          !running.some((candidate) => candidate !== record && candidate.environment !== undefined)
        ) {
          await record.environment.close();
        }
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
