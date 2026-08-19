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

import {
  ManagedServerApplication,
  Server,
  UniformAcrossAllShards,
  type ManagedServerApplicationHandle,
} from "@spine-event-engine/server";
import { Datastore } from "@google-cloud/datastore";
import { Logging } from "@google-cloud/logging";

import { MessageBoardDeployment } from "./deployment-config.js";
import { MessageBoardApplication } from "./index.js";

const config = MessageBoardDeployment.managed(process.env);
const isManagedChild = process.env.SPINE_MANAGED_SERVER_CHILD === "true";
let delivery: { open(): unknown } | undefined;
const managed = await ManagedServerApplication.run({
  processCount: config.processCount,
  host: config.host,
  port: config.port,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => {
    const client = new Datastore({ projectId: config.projectId });
    const logger = MessageBoardDeployment.logger(
      new Logging({ projectId: config.projectId }).log("message-board"),
    );
    const facilities = MessageBoardDeployment.configureManagedServer(
      config,
      client,
      process.env,
      logger,
    );
    delivery = facilities.delivery;
    return Server.atPort(port, { host })
      .add(
        await new MessageBoardApplication().createContext(
          facilities.storageFactory,
          UniformAcrossAllShards.forNumber(config.deliveryShardCount),
        ),
      )
      .start();
  },
  synchronize: async () => {
    await delivery?.open();
  },
});

if (!isManagedChild) {
  installShutdown(managed);
  console.log(`MessageBoard managed coordinator ready at ${config.host}:${config.port.toString()}`);
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
