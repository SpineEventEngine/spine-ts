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
 * Starts the standalone browser-facing Gateway for Message Board.
 * It owns browser requests and subscriptions, but no Bounded Context or Delivery worker.
 */

import { Server } from "@spine-event-engine/server";
import { GkeNodeDiscovery } from "@spine-event-engine/deployment-gke";
import { Datastore } from "@google-cloud/datastore";

import { MessageBoardDeployment } from "./deployment-config.js";
import { BoardAccessPolicy, BoardContextResolver } from "./board-access.js";
import { typeRegistry } from "./model-registry.js";
import { SystemClock } from "./system-clock.js";

const config = MessageBoardDeployment.gateway(process.env);
const client = new Datastore({ projectId: config.projectId });
const logger = MessageBoardDeployment.logger(config.projectId, process.env);
const storage = MessageBoardDeployment.storage(client);
MessageBoardDeployment.configureGatewayServer(config, storage, logger);
const policy = new BoardAccessPolicy();
const bindings = MessageBoardDeployment.publicBindings(config, storage);
const server = await Server.atPort(config.port, {
  host: config.host,
  browser: {
    ...(config.discovery === undefined
      ? { backend: { baseUrls: config.backendUrls ?? [] } }
      : {
          discovery: new GkeNodeDiscovery({
            ...config.discovery,
            ...(logger === undefined ? {} : { logger }),
          }),
        }),
    origins: [config.webOrigin],
    registry: typeRegistry,
    publicAccess: true,
    authorize: policy.authorize.bind(policy),
    contexts: new BoardContextResolver(),
    clock: new SystemClock(),
    bindings,
  },
}).run();
console.log(`MessageBoard gateway ready at ${server.baseUrl}`);
