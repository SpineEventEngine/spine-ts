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
 * Starts the beginner-friendly To-Do app as one Node process with in-memory storage.
 */

import { Server, type RunningServer } from "@spine-event-engine/server";

import { createTodoContext } from "./todo-app.js";
import { TodoProcessSignals } from "./process.js";

/**
 * Options for the single-process To-Do server.
 */
export interface TodoServerOptions {
  // prettier-ignore

  /**
   * Host for the HTTP/2 listener. Defaults to `127.0.0.1`.
   */
  readonly host?: string;

  /**
   * Port for the HTTP/2 listener. Defaults to `8080`; use `0` for a free port.
   */
  readonly port?: number;
}

/**
 * Starts one To-Do server process with in-memory storage.
 *
 * @param options Optional listener host and port overrides.
 * @returns The running server, which callers must close when finished.
 */
export async function startTodoServer(options: TodoServerOptions = {}): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8080;
  return Server.atPort(port, { host })
    .add(await createTodoContext())
    .start();
}

if (
  process.argv[1] !== undefined &&
  new URL(`file://${process.argv[1]}`).href === import.meta.url
) {
  startTodoServer()
    .then((server) => {
      console.log(`To-Do single-process app listening at ${server.baseUrl}`);
      TodoProcessSignals.install(server);
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
