/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { RemoteDelivery } from "../../../delivery-client/dist/index.js";
import { createTodoContext } from "../../../../examples/todo/dist/src/index.js";
import {
  EnvironmentType,
  ManagedServerApplication,
  Server,
  ServerEnvironment,
  UniformAcrossAllShards,
} from "../../dist/index.js";
import { managedServerApplicationAccess } from "../../dist/server/managed-server-application.js";
import process from "node:process";

const endpoint = process.env.SPINE_MANAGED_REMOTE_DELIVERY_URL;
if (endpoint === undefined) throw new Error("Managed remote Delivery fixture requires an endpoint.");

const delivery = RemoteDelivery.connectTo({ endpoint });
// The application owns strategy selection; this fixture deliberately selects it
// without comparing or serializing its identity.
const strategy = UniformAcrossAllShards.forNumber(2);

if (process.env.SPINE_MANAGED_SERVER_CHILD === "true") {
  ServerEnvironment.when(EnvironmentType.Local).use({ delivery });
}

const managed = await ManagedServerApplication.run({
  processCount: 2,
  port: 50_053,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => {
    const server = Server.atPort(port, { host });
    const { InMemorySubscriptionRegistry } = await import("../../dist/index.js");
    server.add(await createTodoContext({ subscriptionRegistry: new InMemorySubscriptionRegistry() }));
    const running = await server.start();
    return running;
  },
  synchronize: async () => {
    await delivery.open();
    if (strategy.shardCount !== 2) throw new Error("Fixture strategy selection was not retained.");
  },
});

if (process.env.SPINE_MANAGED_SERVER_CHILD !== "true") {
  process.send?.({
    type: "managed-ready",
    members: managedServerApplicationAccess.readyMembers(managed).map((member) => ({
      slot: member.slot,
      pid: member.pid,
    })),
    endpoint: managedServerApplicationAccess.coordinatorEndpoint(managed),
  });
}
