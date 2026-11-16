import {
  Application,
  BoundedContext,
  InMemorySubscriptionRegistry,
  ManagedServerApplication,
  Server,
  ServerEnvironment,
} from "../../dist/index.js";
import console from "node:console";
import process from "node:process";

if (process.env.SPINE_MANAGED_SERVER_VERBOSE === "true") console.info("managed-child ".repeat(64));

await ManagedServerApplication.run({
  processCount: 1,
  port: 50_051,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => {
    const application = await Application.newBuilder()
      .setServerEnvironment(ServerEnvironment.newBuilder().build())
      .add(
        BoundedContext.singleTenant("ManagedChild").withSubscriptionRegistry(
          new InMemorySubscriptionRegistry(),
        ),
      )
      .build();
    return Server.atPort(port, { host }).setApplication(application).start();
  },
});
