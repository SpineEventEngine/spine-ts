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

/**
 * Minimal Node signal and exit-status surface for the Fieldnotes process.
 */
export interface FieldnotesProcess {
  /**
   * Registers one operating-system signal listener.
   *
   * @param signal Signal name.
   * @param onSignal One-time shutdown callback.
   */
  once(signal: "SIGINT" | "SIGTERM", onSignal: () => void): void;

  /**
   * Removes a registered signal listener after shutdown starts.
   *
   * @param signal Signal name.
   * @param onSignal Prior callback.
   */
  off(signal: "SIGINT" | "SIGTERM", onSignal: () => void): void;

  /**
   * Eventual process exit status.
   */
  exitCode: number | string | null | undefined;
}

/**
 * Registers one orderly, idempotent shutdown path for the long-lived host.
 */
export const FieldnotesProcessSignals: Readonly<{
  install(host: Readonly<{ close(): Promise<void> }>, processLike?: FieldnotesProcess): void;
}> = Object.freeze({
  /**
   * Closes browser admission, native listener and persistent resources on a signal.
   *
   * @param host Running Fieldnotes host.
   * @param processLike Node process or a lifecycle test seam.
   */
  install(
    host: Readonly<{ close(): Promise<void> }>,
    processLike: FieldnotesProcess = process,
  ): void {
    let closing = false;
    const onSignal = () => {
      if (closing) return;
      closing = true;
      processLike.off("SIGINT", onSignal);
      processLike.off("SIGTERM", onSignal);
      void host.close().then(
        () => {
          processLike.exitCode = 0;
        },
        () => {
          processLike.exitCode = 1;
        },
      );
    };
    processLike.once("SIGINT", onSignal);
    processLike.once("SIGTERM", onSignal);
  },
});
