import { ManagedServerApplication, Server } from "../../dist/index.js";

if (process.env.SPINE_MANAGED_SERVER_VERBOSE === "true") console.info("managed-child ".repeat(64));

await ManagedServerApplication.run({
  processCount: 1,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => Server.atPort(port, { host }).start(),
});
