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
 * Builds one complete To-Do replica child with shared Datastore and Delivery facilities.
 */

import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { RemoteDelivery } from "@spine-event-engine/delivery-client";
import {
  EnvironmentType,
  InMemorySubscriptionRegistry,
  Server,
  ServerEnvironment,
  UniformAcrossAllShards,
  type RunningServer,
} from "@spine-event-engine/server";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";

import { todoProtoModule } from "../generated/proto-module.js";
import { createTodoContext } from "./todo-app.js";
import type { TodoMultiProcessSettings } from "./multi-process-settings.js";

/**
 * One running replica and the readiness work it must finish before receiving requests.
 */
export interface TodoReplica {
  /** The complete To-Do application server running in this child process. */
  readonly server: RunningServer;

  /** Opens the child's Delivery connection before the parent advertises it as ready. */
  synchronize(): Promise<void>;
}

/**
 * Builds one complete application replica.
 *
 * @param settings Shared multi-process deployment settings.
 * @param endpoint Private listener assigned to this child by the managed parent.
 * @returns The running replica and its Delivery readiness operation.
 */
export async function createTodoReplica(
  settings: TodoMultiProcessSettings,
  endpoint: { readonly host: string; readonly port: number },
): Promise<TodoReplica> {
  const typeRegistry = TypeRegistry.from(todoProtoModule);
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(typeRegistry);
  const storageFactory = DatastoreStorageFactory.newBuilder()
    .setClient(new Datastore({ projectId: settings.projectId }))
    .setStringifierRegistry(stringifiers)
    .build();
  const delivery = RemoteDelivery.connectTo({ endpoint: settings.deliveryServerUrl });
  ServerEnvironment.when(EnvironmentType.Production).use({
    storageFactory,
    typeRegistry,
    delivery,
  });
  const server = await Server.atPort(endpoint.port, { host: endpoint.host })
    .add(
      await createTodoContext({
        storageFactory,
        deliveryStrategy: UniformAcrossAllShards.forNumber(settings.deliveryShardCount),
        subscriptionRegistry: new InMemorySubscriptionRegistry(),
      }),
    )
    .start();
  return {
    server,
    synchronize: async () => {
      await delivery.open();
    },
  };
}
