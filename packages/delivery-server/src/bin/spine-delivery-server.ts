#!/usr/bin/env node
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
import { DeliveryServer } from "../server/delivery-server.js";

/**
 * Provides process lifecycle handling for the delivery server executable.
 */
const DeliveryProcess: Readonly<{
  // prettier-ignore

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

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
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
