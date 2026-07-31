import { MessageBoardApplication } from "./index.js";

const server = await new MessageBoardApplication().run({ port: 8090 });
console.log(`MessageBoard local server ready at ${server.baseUrl}`);
