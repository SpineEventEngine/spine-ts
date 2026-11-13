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

import {
  Application,
  EnvironmentType,
  Server,
  ServerEnvironment,
  type RunningServer,
} from "@spine-event-engine/server";
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
   * The Application closes the selected factory after endpoint shutdown.
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
 * @returns A host handle that closes its endpoint before its Application.
 */
export async function startTodoServer(options: TodoServerOptions = {}): Promise<TodoServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8080;
  const selectedStorage =
    options.storageFactory === undefined ? await TodoStorage.select() : undefined;
  const storageFactory = options.storageFactory ?? selectedStorage;
  const application = await TodoApplication.open(storageFactory);
  let endpoint: RunningServer;
  try {
    endpoint = await Server.atPort(port, { host }).setApplication(application).start();
  } catch (error) {
    try {
      await application.close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "To-Do startup cleanup failed.");
    }
    throw error;
  }
  return {
    host: endpoint.host,
    port: endpoint.port,
    baseUrl: endpoint.baseUrl,
    close: async () => {
      await endpoint.close();
      await application.close();
    },
  };
}

/**
 * Builds the Tasks Application with the selected local storage.
 */
const TodoApplication = Object.freeze({
  /**
   * Builds the Tasks Application and releases failed setup.
   *
   * @param storageFactory Caller-selected or environment-selected provider.
   * @returns A ready Application with one Tasks Bounded Context.
   */
  async open(storageFactory: StorageFactory | undefined): Promise<Application> {
    const environmentBuilder = ServerEnvironment.newBuilder();
    if (storageFactory !== undefined)
      environmentBuilder.under(EnvironmentType.Local, (setting) => {
        setting.use({ storageFactory });
      });
    const environment = environmentBuilder.build();
    try {
      return await Application.newBuilder()
        .setServerEnvironment(environment)
        .add(createTodoContext())
        .build();
    } catch (error) {
      await environment.close();
      throw error;
    }
  },
});

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
