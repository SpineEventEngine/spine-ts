import { DurableSubscriptionBindings, Server } from "@spine-event-engine/server";
import { randomUUID } from "node:crypto";

import { MessageBoardDeployment } from "./deployment-config.js";
import { BoardAccessPolicy, BoardContextResolver } from "./board-access.js";
import { LocalBoardSession } from "./local-session.js";
import { typeRegistry } from "./model-registry.js";

const config = MessageBoardDeployment.gateway(process.env);
const policy = new BoardAccessPolicy();
const bindings = new DurableSubscriptionBindings({
  storageFactory: MessageBoardDeployment.storage(config),
  namespace: config.subscriptionNamespace,
  nextId: randomUUID,
  dispose: async () => undefined,
  leaseMs: 60_000,
  cleanupBatchSize: 100,
  recordLimit: 10_000,
  maxRecordBytes: 1_048_576,
});
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
    bindings,
  },
}).run();
console.log(`MessageBoard gateway ready at ${server.baseUrl}`);
