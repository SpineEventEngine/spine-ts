import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";
import { Datastore } from "@google-cloud/datastore";
import { Logging } from "@google-cloud/logging";

const config = MessageBoardDeployment.combined(process.env);
const client = new Datastore({ projectId: config.projectId });
const logger = MessageBoardDeployment.logger(
  new Logging({ projectId: config.projectId }).log("message-board"),
);
const storage =
  MessageBoardDeployment.configureServer(config, client, process.env, logger) ??
  MessageBoardDeployment.storage(client);
const sessions = MessageBoardDeployment.sessions(process.env);
const server = await new MessageBoardApplication().runCombined(
  { ...config, bindings: MessageBoardDeployment.bindings(config, storage), sessions },
  storage,
);
console.log(`MessageBoard combined server ready at ${server.baseUrl}`);
