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

/**
 * Starts the production-shaped, multi-process To-Do example. This same file is
 * first run by the Coordinator parent and then by every complete-replica child.
 */

import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import {
  EnvironmentType,
  InMemorySubscriptionRegistry,
  ManagedServerApplication,
  Server,
  ServerEnvironment,
  UniformAcrossAllShards,
  type ManagedServerApplicationHandle,
} from "@spine-event-engine/server";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { Datastore } from "@google-cloud/datastore";

import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { todoProtoModule } from "../generated/proto-module.js";
import { createTodoContext } from "./index.js";
import { readTodoManagedDeployment } from "./managed-deployment.js";

const deployment = readTodoManagedDeployment(process.env);
const isManagedChild = process.env.SPINE_MANAGED_SERVER_CHILD === "true";
let delivery: { open(): unknown } | undefined;
const managed = await ManagedServerApplication.run({
  processCount: deployment.processCount,
  host: deployment.host,
  port: deployment.port,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => {
    const typeRegistry = TypeRegistry.from(todoProtoModule);
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(typeRegistry);
    const storageFactory = DatastoreStorageFactory.newBuilder()
      .setClient(new Datastore({ projectId: deployment.projectId }))
      .setStringifierRegistry(stringifiers)
      .build();
    const openedDelivery = RemoteDelivery.connectTo({ endpoint: deployment.deliveryServerUrl });
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory,
      typeRegistry,
      delivery: openedDelivery,
    });
    delivery = openedDelivery;
    return Server.atPort(port, { host })
      .add(
        await createTodoContext({
          storageFactory,
          deliveryStrategy: UniformAcrossAllShards.forNumber(deployment.deliveryShardCount),
          subscriptionRegistry: new InMemorySubscriptionRegistry(),
        }),
      )
      .start();
  },
  synchronize: async () => {
    await delivery?.open();
  },
});

if (!isManagedChild) {
  installShutdown(managed);
  console.log(
    `To-do managed coordinator ready at ${deployment.host}:${deployment.port.toString()}`,
  );
}

function installShutdown(handle: ManagedServerApplicationHandle): void {
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= handle.close().then(
      () => {
        process.exitCode = 0;
      },
      () => {
        process.exitCode = 1;
      },
    );
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
