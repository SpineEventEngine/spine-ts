#!/usr/bin/env node
import { DeliveryServer } from "../server/delivery-server.js";

/** Provides process lifecycle handling for the delivery server executable. */
const DeliveryProcess: Readonly<{
  /**
   * Starts a delivery server and installs terminal signal handling.
   *
   * @param server Holds the delivery server to run.
   * @returns Nothing after scheduling the server lifecycle.
   */
  run: (server: DeliveryServer) => void;
  /**
   * Describes an unknown error for process output.
   *
   * @param error Holds the thrown value.
   * @returns The error message or a generic fallback.
   */
  errorMessage: (error: unknown) => string;
}> = Object.freeze({
  run: (server: DeliveryServer): void => {
    let stopping: Promise<void> | undefined;
    const removeSignalHandlers = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
    };
    const stop = () => {
      stopping ??= server
        .close()
        .catch((error: unknown) => {
          process.exitCode = 1;
          process.stderr.write(
            `Delivery server shutdown failed: ${DeliveryProcess.errorMessage(error)}\n`,
          );
        })
        .finally(removeSignalHandlers);
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    server.start().then(
      (running) => {
        process.stdout.write(`Delivery server listening at ${running.baseUrl}\n`);
      },
      (error: unknown) => {
        process.exitCode = 1;
        process.stderr.write(
          `Delivery server startup failed: ${DeliveryProcess.errorMessage(error)}\n`,
        );
        removeSignalHandlers();
      },
    );
  },
  errorMessage: (error: unknown): string =>
    error instanceof Error ? error.message : "unknown error",
});

try {
  DeliveryProcess.run(new DeliveryServer());
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`Delivery server startup failed: ${DeliveryProcess.errorMessage(error)}\n`);
}
