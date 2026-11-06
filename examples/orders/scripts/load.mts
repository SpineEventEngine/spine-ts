import process from "node:process";

import { runOrdersLoad, ordersLoadLevels } from "../src/load-runner.js";
import { configureOrdersEnvironment, ordersTenants, startOrdersServer } from "../src/index.js";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

const requestedUsers = Number.parseInt(process.env.SPINE_ORDERS_LOAD_USERS ?? "10", 10);
if (!ordersLoadLevels.includes(requestedUsers as 10 | 100 | 1000))
  throw new Error("SPINE_ORDERS_LOAD_USERS must be one of 10, 100, or 1000.");

const setup = await configureOrdersEnvironment({
  storageFactory: new InMemoryStorageFactory(),
  tenants: [ordersTenants.northwind, ordersTenants.contoso],
});
try {
  const server = await startOrdersServer({ host: "127.0.0.1", port: 0 });
  try {
    console.log(
      JSON.stringify(
        await runOrdersLoad({
          baseUrl: server.baseUrl,
          users: requestedUsers as 10 | 100 | 1000,
          tenants: [ordersTenants.northwind, ordersTenants.contoso],
        }),
      ),
    );
  } finally {
    await server.close();
  }
} finally {
  await setup.close();
}
