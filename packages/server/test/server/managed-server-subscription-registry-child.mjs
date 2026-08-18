import {
  BoundedContext,
  InMemorySubscriptionRegistry,
  ManagedServerApplication,
  Server,
} from "../../dist/index.js";
import process from "node:process";

const context = BoundedContext.singleTenant("ManagedSubscriptionRegistry");
if (process.env.SPINE_MANAGED_REGISTRY === "memory")
  context.withSubscriptionRegistry(new InMemorySubscriptionRegistry());

await ManagedServerApplication.run({
  processCount: 1,
  port: 50_052,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => Server.atPort(port, { host }).add(context).start(),
});
