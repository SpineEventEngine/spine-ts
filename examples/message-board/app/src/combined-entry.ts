import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";

const config = MessageBoardDeployment.combined(process.env);
const storage =
  MessageBoardDeployment.configureServer(config, process.env) ??
  MessageBoardDeployment.storage(config);
const server = await new MessageBoardApplication().runCombined(
  { ...config, bindings: MessageBoardDeployment.bindings(config, storage) },
  storage,
);
console.log(`MessageBoard combined server ready at ${server.baseUrl}`);
