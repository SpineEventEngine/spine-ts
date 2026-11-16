import {
  BoundedContext,
  Application,
  InMemorySubscriptionRegistry,
  ManagedServerApplication,
  Server,
  ServerEnvironment,
} from "../../dist/index.js";
import process from "node:process";

const context = BoundedContext.singleTenant("ManagedSubscriptionRegistry");
const registry = new InMemorySubscriptionRegistry();
if (process.env.SPINE_MANAGED_REGISTRY === "memory") context.withSubscriptionRegistry(registry);
if (process.env.SPINE_MANAGED_REGISTRY === "custom")
  context.withSubscriptionRegistry({
    persistent: false,
    create: registry.create.bind(registry),
    activate: registry.activate.bind(registry),
    delete: registry.delete.bind(registry),
    get: registry.get.bind(registry),
    snapshot: registry.snapshot.bind(registry),
    cleanup: registry.cleanup.bind(registry),
    close: registry.close.bind(registry),
  });

await ManagedServerApplication.run({
  processCount: 1,
  port: 50_052,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => {
    const application = await Application.newBuilder()
      .setServerEnvironment(ServerEnvironment.newBuilder().build())
      .add(context)
      .build();
    return Server.atPort(port, { host }).setApplication(application).start();
  },
});
