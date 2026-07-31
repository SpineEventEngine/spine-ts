import { ChatApplication } from "./index.js";

const server = await new ChatApplication().run({ port: 8090 });
console.log(`Chat local server ready at ${server.baseUrl}`);
