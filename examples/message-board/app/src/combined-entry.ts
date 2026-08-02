import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";

const config = MessageBoardDeployment.combined(process.env);
const server = await new MessageBoardApplication().runCombined(
  config,
  MessageBoardDeployment.storage(config),
);
console.log(`MessageBoard combined server ready at ${server.baseUrl}`);
