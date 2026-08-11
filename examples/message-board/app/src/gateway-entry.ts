import { Server } from "@spine-event-engine/server";
import { GkeNodeDiscovery } from "@spine-event-engine/deployment-gke";
import { Datastore } from "@google-cloud/datastore";
import { Logging } from "@google-cloud/logging";

import { MessageBoardDeployment } from "./deployment-config.js";
import { BoardAccessPolicy, BoardContextResolver } from "./board-access.js";
import { LocalBoardSession } from "./local-session.js";
import { typeRegistry } from "./model-registry.js";

const config = MessageBoardDeployment.gateway(process.env);
const client = new Datastore({ projectId: config.projectId });
const logger = MessageBoardDeployment.logger(
  new Logging({ projectId: config.projectId }).log("message-board"),
);
const storage =
  MessageBoardDeployment.configureServer(config, client, process.env, logger) ??
  MessageBoardDeployment.storage(client);
const policy = new BoardAccessPolicy();
const bindings = MessageBoardDeployment.bindings(config, storage);
const sessions = MessageBoardDeployment.sessions(process.env);
const server = await Server.atPort(config.port, {
  host: config.host,
  browser: {
    ...(config.discovery === undefined
      ? { backend: { baseUrls: config.backendUrls ?? [] } }
      : { discovery: new GkeNodeDiscovery({ ...config.discovery, logger }) }),
    origins: [config.webOrigin],
    registry: typeRegistry,
    sessions,
    authorize: policy.authorize.bind(policy),
    contexts: new BoardContextResolver(),
    clock: LocalBoardSession.clock,
    bindings,
  },
}).run();
console.log(`MessageBoard gateway ready at ${server.baseUrl}`);
