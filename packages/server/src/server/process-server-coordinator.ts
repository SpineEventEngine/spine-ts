import type { RunningServer } from "./server.js";

const running: RunningServer[] = [];
let signalsInstalled = false;

/**
 * Coordinates process-owned server shutdown without exposing lifecycle seams.
 *
 * @internal
 */
export const ProcessServerCoordinator: Readonly<{
  add(server: RunningServer): RunningServer;
  installSignals(): void;
  remove(server: RunningServer): void;
  onSignal(): void;
  closeRunning(): Promise<void>;
}> = Object.freeze({
  add(server: RunningServer): RunningServer {
    running.push(server);
    ProcessServerCoordinator.installSignals();
    return {
      host: server.host,
      port: server.port,
      baseUrl: server.baseUrl,
      close: async () => {
        await server.close();
        ProcessServerCoordinator.remove(server);
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
    const index = running.lastIndexOf(server);
    if (index >= 0) running.splice(index, 1);
    if (running.length > 0) return;
    process.off("SIGINT", ProcessServerCoordinator.onSignal);
    process.off("SIGTERM", ProcessServerCoordinator.onSignal);
    signalsInstalled = false;
  },

  onSignal(): void {
    void ProcessServerCoordinator.closeRunning();
  },

  async closeRunning(): Promise<void> {
    for (const server of [...running].reverse()) {
      try {
        await server.close();
        ProcessServerCoordinator.remove(server);
      } catch {
        process.exitCode = 1;
      }
    }
  },
});
