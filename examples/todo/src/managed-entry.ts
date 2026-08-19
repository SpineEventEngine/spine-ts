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

import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import {
  EnvironmentType,
  ManagedServerApplication,
  Server,
  ServerEnvironment,
  UniformAcrossAllShards,
  type ManagedServerApplicationHandle,
} from "@spine-event-engine/server";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";
import { Datastore } from "@google-cloud/datastore";

import { TypeRegistry } from "@spine-event-engine/core";
import { todoProtoModule } from "../generated/proto-module.js";
import { createTodoContext } from "./index.js";

const deployment = readDeployment(process.env);
const isManagedChild = process.env.SPINE_MANAGED_SERVER_CHILD === "true";
let delivery: { open(): unknown } | undefined;
const managed = await ManagedServerApplication.run({
  processCount: deployment.processCount,
  host: deployment.host,
  port: deployment.port,
  moduleUrl: import.meta.url,
  createServer: async ({ host, port }) => {
    const storageFactory = DatastoreStorageFactory.newBuilder()
      .setClient(new Datastore({ projectId: deployment.projectId }))
      .build();
    const openedDelivery = RemoteDelivery.connectTo({ endpoint: deployment.deliveryServerUrl });
    ServerEnvironment.when(EnvironmentType.Production).use({
      storageFactory,
      typeRegistry: TypeRegistry.from(todoProtoModule),
      delivery: openedDelivery,
    });
    delivery = openedDelivery;
    return Server.atPort(port, { host })
      .add(
        await createTodoContext({
          storageFactory,
          deliveryStrategy: UniformAcrossAllShards.forNumber(deployment.deliveryShardCount),
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

function readDeployment(environment: NodeJS.ProcessEnv): {
  readonly host: string;
  readonly port: number;
  readonly projectId: string;
  readonly deliveryServerUrl: string;
  readonly processCount: number;
  readonly deliveryShardCount: number;
} {
  return {
    host: required(environment, "HOST"),
    port: port(required(environment, "PORT")),
    projectId: required(environment, "DATASTORE_PROJECT_ID"),
    deliveryServerUrl: httpUrl(required(environment, "DELIVERY_SERVER_URL")),
    processCount: positiveSafeInteger(required(environment, "PROCESS_COUNT"), "PROCESS_COUNT"),
    deliveryShardCount: positiveSafeInteger(
      required(environment, "DELIVERY_SHARD_COUNT"),
      "DELIVERY_SHARD_COUNT",
    ),
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name];
  if (value === undefined || value.length === 0)
    throw new Error(`Missing required configuration: ${name}.`);
  return value;
}

function port(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535)
    throw new Error("Invalid required configuration: PORT.");
  return parsed;
}

function positiveSafeInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`Invalid required configuration: ${name}.`);
  return parsed;
}

function httpUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("Invalid required configuration: DELIVERY_SERVER_URL.");
  return url.toString().replace(/\/$/u, "");
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
