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

import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { StringValueSchema } from "@bufbuild/protobuf/wkt";
import { TenantIdSchema, TenantSchema } from "@spine-event-engine/proto";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";

import { ordersTenants } from "./orders-environment.js";

/**
 * Supplies three provisioned PostgreSQL database URLs for one Orders launch.
 */
export interface OrdersPostgresOptions {
  /**
   * Selects the shared database for the tenant directory and server facilities.
   */
  readonly sharedUrl: string;

  /**
   * Selects Northwind's domain database.
   */
  readonly northwindUrl: string;

  /**
   * Selects Contoso's domain database.
   */
  readonly contosoUrl: string;
}

/**
 * Builds the fixed Orders routing table without opening database connections.
 *
 * @param options URLs of three databases provisioned outside this application.
 * @returns A PostgreSQL factory for the shared and tenant storage families.
 */
export function createOrdersPostgresFactory(
  options: OrdersPostgresOptions,
): Promise<PostgresStorageFactory> {
  const stringifiers = new StringifierRegistry();
  stringifiers.setTypeRegistry(new TypeRegistry([StringValueSchema, TenantIdSchema, TenantSchema]));
  return PostgresStorageFactory.newBuilder()
    .setOptions({ url: options.sharedUrl })
    .setTenantOptions([
      { tenantId: ordersTenants.northwind, options: { url: options.northwindUrl } },
      { tenantId: ordersTenants.contoso, options: { url: options.contosoUrl } },
    ])
    .setStringifierRegistry(stringifiers)
    .build();
}
