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
 * Starts the To-Do app with one Coordinator parent and several complete replica children.
 */

import { ManagedServerApplication } from "@spine-event-engine/server";

import { runTodoCoordinator } from "./multi-process-coordinator.js";
import { createTodoReplica, type TodoReplica } from "./multi-process-replica.js";
import { readTodoMultiProcessSettings } from "./multi-process-settings.js";

const settings = readTodoMultiProcessSettings(process.env);
let replica: TodoReplica | undefined;

const managed = await ManagedServerApplication.run({
  processCount: settings.processCount,
  host: settings.host,
  port: settings.port,
  moduleUrl: import.meta.url,
  createServer: async (endpoint) => {
    replica = await createTodoReplica(settings, endpoint);
    return replica.server;
  },
  synchronize: async () => {
    await replica?.synchronize();
  },
});

if (process.env.SPINE_MANAGED_SERVER_CHILD !== "true") {
  runTodoCoordinator(managed, settings);
}
