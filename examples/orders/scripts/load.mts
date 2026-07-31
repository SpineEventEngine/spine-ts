import process from "node:process";

import { runDatastoreOrdersLoad, datastoreOrdersLoadLevels } from "../src/load-runner.js";
import { startDatastoreOrdersServer } from "../src/index.js";
import { InMemoryStorageFactory } from "@spine-event-engine/storage";

const requestedUsers = Number.parseInt(process.env.SPINE_DATASTORE_ORDERS_LOAD_USERS ?? "10", 10);
if (!datastoreOrdersLoadLevels.includes(requestedUsers as 10 | 100 | 1000))
  throw new Error("SPINE_DATASTORE_ORDERS_LOAD_USERS must be one of 10, 100, or 1000.");

const server = await startDatastoreOrdersServer(new InMemoryStorageFactory(), {
  host: "127.0.0.1",
  port: 0,
});
try {
  console.log(
    JSON.stringify(
      await runDatastoreOrdersLoad({
        baseUrl: server.baseUrl,
        users: requestedUsers as 10 | 100 | 1000,
      }),
    ),
  );
} finally {
  await server.close();
}
