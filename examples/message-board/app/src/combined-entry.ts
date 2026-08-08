import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";
import { Datastore } from "@google-cloud/datastore";

const config = MessageBoardDeployment.combined(process.env);
const client = new Datastore({ projectId: config.projectId });
const storage =
  MessageBoardDeployment.configureServer(config, client, process.env) ??
  MessageBoardDeployment.storage(client);
const sessions = MessageBoardDeployment.sessions(process.env);
const server = await new MessageBoardApplication().runCombined(
  { ...config, bindings: MessageBoardDeployment.bindings(config, storage), sessions },
  storage,
);
console.log(`MessageBoard combined server ready at ${server.baseUrl}`);
