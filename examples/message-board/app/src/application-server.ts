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
 * Starts only the Message Board domain application for a production deployment.
 * A separate Gateway must forward browser commands and queries to this server.
 */

import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";
import { Datastore } from "@google-cloud/datastore";

const config = MessageBoardDeployment.application(process.env);
const client = new Datastore({ projectId: config.projectId });
const logger = MessageBoardDeployment.logger(config.projectId, process.env);
const facilities = MessageBoardDeployment.configureServer(config, client, process.env, logger) ?? {
  storageFactory: MessageBoardDeployment.storage(client),
  ...(logger === undefined ? {} : { logger }),
};
const server = await new MessageBoardApplication().runApplication(config, facilities);
console.log(`MessageBoard application ready at ${server.baseUrl}`);
