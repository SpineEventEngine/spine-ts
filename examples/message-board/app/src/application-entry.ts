import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";

const config = MessageBoardDeployment.application(process.env);
const server = await new MessageBoardApplication().runApplication(
  config,
  MessageBoardDeployment.storage(config),
);
console.log(`MessageBoard application ready at ${server.baseUrl}`);
