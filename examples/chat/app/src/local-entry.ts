import { LocalChatServerTopology } from "./local-server.js";

const server = await LocalChatServerTopology.start();

let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  void server.close().then(
    () => {
      process.exitCode = 0;
    },
    () => {
      process.exitCode = 1;
    },
  );
};
process.once("SIGINT", close);
process.once("SIGTERM", close);
console.log(`Chat local server ready at ${server.baseUrl}`);
