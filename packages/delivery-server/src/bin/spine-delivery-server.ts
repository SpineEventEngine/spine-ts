#!/usr/bin/env node
import { DeliveryServer } from "../server/delivery-server.js";

try {
  run(new DeliveryServer());
} catch (error) {
  process.exitCode = 1;
  process.stderr.write(`Delivery server startup failed: ${message(error)}\n`);
}

function run(server: DeliveryServer): void {
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
        process.stderr.write(`Delivery server shutdown failed: ${message(error)}\n`);
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
      process.stderr.write(`Delivery server startup failed: ${message(error)}\n`);
      removeSignalHandlers();
    },
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}
