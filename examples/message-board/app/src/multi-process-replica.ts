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

/** Builds and synchronizes one complete Message Board managed replica. */

import { Datastore } from "@google-cloud/datastore";
import {
  InMemorySubscriptionRegistry,
  ManagedServerApplication,
  UniformAcrossAllShards,
  type ManagedServerApplicationOptions,
} from "@spine-event-engine/server";

import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";

/**
 * Supplies child-only assembly to the Coordinator without starting work in the
 * parent process that imports this module.
 */
export function managedReplicaOptions(
  config: ReturnType<typeof MessageBoardDeployment.managed>,
): Pick<ManagedServerApplicationOptions, "createServer" | "synchronize"> {
  let delivery: { open(): unknown } | undefined;
  return {
    createServer: async ({ host, port }) => {
      const client = new Datastore({ projectId: config.projectId });
      const logger = MessageBoardDeployment.logger(config.projectId, process.env);
      const facilities = MessageBoardDeployment.configureManagedServer(
        config,
        client,
        process.env,
        logger,
      );
      delivery = facilities.delivery;
      return new MessageBoardApplication().startManagedApplication(
        { host, port },
        facilities.storageFactory,
        UniformAcrossAllShards.forNumber(config.deliveryShardCount),
        new InMemorySubscriptionRegistry(),
      );
    },
    synchronize: async () => {
      await delivery?.open();
    },
  };
}

if (process.env.SPINE_MANAGED_SERVER_CHILD === "true") {
  const config = MessageBoardDeployment.managed(process.env);
  await ManagedServerApplication.run({
    processCount: config.processCount,
    host: config.host,
    port: config.port,
    moduleUrl: new URL("./multi-process-app.js", import.meta.url).href,
    ...managedReplicaOptions(config),
  });
}
