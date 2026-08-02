import { Server } from "@spine-event-engine/server";

import { MessageBoardDeployment } from "./deployment-config.js";
import { BoardAccessPolicy, BoardContextResolver } from "./board-access.js";
import { LocalBoardSession } from "./local-session.js";
import { typeRegistry } from "./model-registry.js";

const config = MessageBoardDeployment.gateway(process.env);
const policy = new BoardAccessPolicy();
const server = await Server.atPort(config.port, {
  host: config.host,
  browser: {
    backend: { baseUrl: config.backendUrl },
    origins: [config.webOrigin],
    registry: typeRegistry,
    sessions: LocalBoardSession.resolver(),
    authorize: policy.authorize.bind(policy),
    contexts: new BoardContextResolver(),
    clock: LocalBoardSession.clock,
    fingerprint: (principal) => principal.id,
  },
}).run();
console.log(`MessageBoard gateway ready at ${server.baseUrl}`);
