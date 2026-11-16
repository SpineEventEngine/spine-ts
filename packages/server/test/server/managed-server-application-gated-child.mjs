import {
  Application,
  BoundedContext,
  InMemorySubscriptionRegistry,
  ManagedServerApplication,
  Server,
  ServerEnvironment,
} from "../../dist/index.js";
import { setTimeout } from "node:timers";

await ManagedServerApplication.run({
  processCount: 1,
  port: 50_051,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => {
    const application = await Application.newBuilder()
      .setServerEnvironment(ServerEnvironment.newBuilder().build())
      .add(
        BoundedContext.singleTenant("ManagedGatedChild").withSubscriptionRegistry(
          new InMemorySubscriptionRegistry(),
        ),
      )
      .build();
    return Server.atPort(port, { host }).setApplication(application).start();
  },
  synchronize: () => new Promise((resolve) => setTimeout(resolve, 250)),
});
