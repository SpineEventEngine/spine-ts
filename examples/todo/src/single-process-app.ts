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
 * Starts the beginner-friendly To-Do app as one Node process with selectable local storage.
 */

import { Server, type RunningServer } from "@spine-event-engine/server";
import type { StorageFactory } from "@spine-event-engine/storage";

import { createTodoContext } from "./todo-app.js";
import { TodoProcessSignals } from "./process.js";
import { TodoStorage } from "./todo-storage.js";

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

  /**
   * Supplies storage for a programmatically assembled server.
   *
   * When omitted, `TODO_STORAGE` selects the in-memory default, MySQL, or PostgreSQL.
   * Callers close a supplied factory after server shutdown or rejected startup.
   */
  readonly storageFactory?: StorageFactory;
}

/**
 * Running listener returned by the To-Do single-process app.
 */
export type TodoServer = RunningServer;

/**
 * Starts one To-Do server process with selected local storage.
 *
 * @param options Optional listener and caller-supplied storage overrides.
 * @returns The running server, which callers must close when finished.
 */
export async function startTodoServer(options: TodoServerOptions = {}): Promise<TodoServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8080;
  const selectedStorage =
    options.storageFactory === undefined ? await TodoStorage.select() : undefined;
  const storageFactory = options.storageFactory ?? selectedStorage;
  let context: Awaited<ReturnType<typeof createTodoContext>>;
  try {
    context = await createTodoContext(storageFactory === undefined ? {} : { storageFactory });
  } catch (error) {
    selectedStorage?.close();
    throw error;
  }
  const server = Server.atPort(port, { host }).add(context);
  if (selectedStorage !== undefined) server.addResource(selectedStorage);
  return server.start();
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
