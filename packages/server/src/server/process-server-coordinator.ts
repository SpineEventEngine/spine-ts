import type { RunningServer } from "./server.js";
import type { ServerEnvironment } from "./server-environment.js";

interface RunRecord {
  readonly server: RunningServer;
  readonly environment: ServerEnvironment;
  retirement: Promise<void> | undefined;
  retired: boolean;
}

const running: RunRecord[] = [];
let signalsInstalled = false;

/**
 * Coordinates process-owned server shutdown without exposing lifecycle seams.
 *
 * @internal
 */
export const ProcessServerCoordinator: Readonly<{
  add(server: RunningServer, environment: ServerEnvironment): RunningServer;
  installSignals(): void;
  remove(server: RunningServer): void;
  retire(record: RunRecord): Promise<void>;
  onSignal(): void;
  closeRunning(): Promise<void>;
}> = Object.freeze({
  add(server: RunningServer, environment: ServerEnvironment): RunningServer {
    const record: RunRecord = { server, environment, retirement: undefined, retired: false };
    running.push(record);
    ProcessServerCoordinator.installSignals();
    return {
      host: server.host,
      port: server.port,
      baseUrl: server.baseUrl,
      close: async () => {
        await server.close();
        await ProcessServerCoordinator.retire(record);
      },
    };
  },
  installSignals(): void {
    if (signalsInstalled) return;
    signalsInstalled = true;
    process.on("SIGINT", ProcessServerCoordinator.onSignal);
    process.on("SIGTERM", ProcessServerCoordinator.onSignal);
  },

  remove(server: RunningServer): void {
    const index = running.findIndex((record) => record.server === server);
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
        if (!record.retired) {
          record.retired = true;
          ProcessServerCoordinator.remove(record.server);
        }
        if (running.length === 0) {
          await record.environment.close();
        }
      })
      .catch((error: unknown) => {
        record.retirement = undefined;
        throw error;
      });
    record.retirement = retirement;
    return retirement;
  },

  onSignal(): void {
    void ProcessServerCoordinator.closeRunning();
  },

  async closeRunning(): Promise<void> {
    for (const record of [...running].reverse()) {
      try {
        await record.server.close();
        await ProcessServerCoordinator.retire(record);
      } catch {
        process.exitCode = 1;
      }
    }
  },
});
