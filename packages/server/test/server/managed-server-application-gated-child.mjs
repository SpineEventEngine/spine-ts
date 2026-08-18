import { ManagedServerApplication, Server } from "../../dist/index.js";
import { setTimeout } from "node:timers";

await ManagedServerApplication.run({
  processCount: 1,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => Server.atPort(port, { host }).start(),
  synchronize: () => new Promise((resolve) => setTimeout(resolve, 250)),
});
