import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";

const config = MessageBoardDeployment.application(process.env);
const storage =
  MessageBoardDeployment.configureServer(config, process.env) ??
  MessageBoardDeployment.storage(config);
const server = await new MessageBoardApplication().runApplication(config, storage);
console.log(`MessageBoard application ready at ${server.baseUrl}`);
