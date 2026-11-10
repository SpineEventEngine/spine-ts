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

import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { Datastore } from "@google-cloud/datastore";
import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { TenantIdSchema, TenantSchema } from "@spine-event-engine/proto";
import { DatastoreStorageFactory } from "@spine-event-engine/storage-datastore";

/**
 * Selects the Datastore project for an Orders launch.
 */
export interface OrdersDatastoreOptions {
  /**
   * Identifies the project containing the Orders tenant namespaces.
   */
  readonly projectId: string;
}

/**
 * Builds Datastore storage with the identifier registry required by Orders records.
 *
 * @param options The configured Datastore project.
 * @returns A factory that routes complete tenant identities to namespaces.
 */
export function createOrdersDatastoreFactory(
  options: OrdersDatastoreOptions,
): DatastoreStorageFactory {
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema, TenantIdSchema, TenantSchema]));
  return DatastoreStorageFactory.newBuilder()
    .setClient(new Datastore({ projectId: options.projectId }))
    .setStringifierRegistry(stringifiers)
    .build();
}
