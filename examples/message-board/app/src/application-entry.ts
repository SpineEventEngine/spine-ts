import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";
import { Datastore } from "@google-cloud/datastore";

const config = MessageBoardDeployment.application(process.env);
const client = new Datastore({ projectId: config.projectId });
const storage =
  MessageBoardDeployment.configureServer(config, client, process.env) ??
  MessageBoardDeployment.storage(client);
const server = await new MessageBoardApplication().runApplication(config, storage);
console.log(`MessageBoard application ready at ${server.baseUrl}`);
