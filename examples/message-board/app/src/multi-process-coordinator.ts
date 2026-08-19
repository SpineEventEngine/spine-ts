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

/** Owns the Message Board Coordinator lifecycle and its managed child replicas. */

import { ManagedServerApplication } from "@spine-event-engine/server";

import { MessageBoardDeployment } from "./deployment-config.js";
import { managedReplicaOptions } from "./multi-process-replica.js";

const config = MessageBoardDeployment.managed(process.env);
await ManagedServerApplication.run({
  processCount: config.processCount,
  host: config.host,
  port: config.port,
  moduleUrl: new URL("./multi-process-app.js", import.meta.url).href,
  ...managedReplicaOptions(config),
});

console.log(`MessageBoard managed coordinator ready at ${config.host}:${config.port.toString()}`);
