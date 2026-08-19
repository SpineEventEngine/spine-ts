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
 * Starts the Message Board application and browser Gateway in one process.
 * This is the smallest production-shaped mode, not the multi-process managed mode.
 */

import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";
import { Datastore } from "@google-cloud/datastore";

const config = MessageBoardDeployment.combined(process.env);
const client = new Datastore({ projectId: config.projectId });
const logger = MessageBoardDeployment.logger(config.projectId, process.env);
const storage =
  MessageBoardDeployment.configureServer(config, client, process.env, logger) ??
  MessageBoardDeployment.storage(client);
const sessions = MessageBoardDeployment.sessions(process.env);
const server = await new MessageBoardApplication().runCombined(
  { ...config, bindings: MessageBoardDeployment.bindings(config, storage), sessions },
  storage,
);
console.log(`MessageBoard combined server ready at ${server.baseUrl}`);
