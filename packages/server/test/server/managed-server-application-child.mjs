import { ManagedServerApplication, Server } from "../../dist/index.js";

await ManagedServerApplication.run({
  processCount: 1,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => Server.atPort(port, { host }).start(),
});
