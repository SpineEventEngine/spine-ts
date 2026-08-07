import { Server } from "@spine-event-engine/server";
import { GkeNodeDiscovery } from "@spine-event-engine/deployment-gke";

import { MessageBoardDeployment } from "./deployment-config.js";
import { BoardAccessPolicy, BoardContextResolver } from "./board-access.js";
import { LocalBoardSession } from "./local-session.js";
import { typeRegistry } from "./model-registry.js";

const config = MessageBoardDeployment.gateway(process.env);
const storage =
  MessageBoardDeployment.configureServer(config, process.env) ??
  MessageBoardDeployment.storage(config);
const policy = new BoardAccessPolicy();
const bindings = MessageBoardDeployment.bindings(config, storage);
const sessions = MessageBoardDeployment.sessions(storage, process.env);
const server = await Server.atPort(config.port, {
  host: config.host,
  browser: {
    ...(config.discovery === undefined
      ? { backend: { baseUrls: config.backendUrls ?? [] } }
      : { discovery: new GkeNodeDiscovery(config.discovery) }),
    origins: [config.webOrigin],
    registry: typeRegistry,
    sessions,
    authorize: policy.authorize.bind(policy),
    contexts: new BoardContextResolver(),
    clock: LocalBoardSession.clock,
    fingerprint: (principal) => principal.id,
    bindings,
  },
}).run();
console.log(`MessageBoard gateway ready at ${server.baseUrl}`);
