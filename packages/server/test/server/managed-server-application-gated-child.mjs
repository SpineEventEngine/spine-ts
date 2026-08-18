import { ManagedServerApplication, Server } from "../../dist/index.js";

await ManagedServerApplication.run({
  processCount: 1,
  moduleUrl: import.meta.url,
  host: "127.0.0.1",
  port: 0,
  createServer: async ({ host, port }) => Server.atPort(port, { host }).start(),
  synchronizationGates: [new Promise((resolve) => setTimeout(resolve, 250))],
});
