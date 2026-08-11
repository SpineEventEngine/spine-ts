import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";
import { Datastore } from "@google-cloud/datastore";
import { Logging } from "@google-cloud/logging";

const config = MessageBoardDeployment.application(process.env);
const client = new Datastore({ projectId: config.projectId });
const logger = MessageBoardDeployment.logger(
  new Logging({ projectId: config.projectId }).log("message-board"),
);
const storage =
  MessageBoardDeployment.configureServer(config, client, process.env, logger) ??
  MessageBoardDeployment.storage(client);
const server = await new MessageBoardApplication().runApplication(config, storage);
console.log(`MessageBoard application ready at ${server.baseUrl}`);
