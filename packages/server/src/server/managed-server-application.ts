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

/** Configures one locally assembled complete-replica application. */
export interface ManagedServerApplicationOptions {
  /** Explicit number of complete application replicas to start. */
  readonly processCount: number;
  /** URL of the ESM entry module that invokes this method in parent and child processes. */
  readonly moduleUrl: string;
  /** Host for the future coordinator listener. */
  readonly host: string;
  /** Port for the future coordinator listener. */
  readonly port: number;
  /** Builds one complete local application server in a child process. */
  readonly createServer: (options: {
    readonly host: string;
    readonly port: number;
  }) => Promise<RunningServer>;
}

/** Starts a managed parent and its complete-replica child processes. */
export const ManagedServerApplication: Readonly<{
  run(options: ManagedServerApplicationOptions): Promise<never>;
}> = Object.freeze({
  async run(options: ManagedServerApplicationOptions): Promise<never> {
    if (!Number.isSafeInteger(options.processCount) || options.processCount < 1) {
      throw new Error("Managed server processCount must be a positive safe integer.");
    }
    throw new Error("Managed server process lifecycle has not started.");
  },
});
