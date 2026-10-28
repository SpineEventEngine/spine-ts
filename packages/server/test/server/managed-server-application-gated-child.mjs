import { ManagedServerApplication, Server, ServerEnvironment } from "../../dist/index.js";
import { setTimeout } from "node:timers";

await ServerEnvironment.instance().completeSetup();
await ManagedServerApplication.run({
  processCount: 1,
  port: 50_051,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => Server.atPort(port, { host }).start(),
  synchronize: () => new Promise((resolve) => setTimeout(resolve, 250)),
});
