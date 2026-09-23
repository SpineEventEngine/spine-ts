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
 * Selects the optional durable storage used by the single-process To-Do app.
 *
 * `memory` leaves the context's normal in-memory storage in place. `mysql` and
 * `postgresql` build one durable factory for this process. The managed
 * multi-process example intentionally remains a separate Datastore deployment.
 */

import { StringifierRegistry, TypeRegistry } from "@spine-event-engine/core";
import { PostgresStorageFactory } from "@spine-event-engine/storage-postgres";
import { MysqlStorageFactory } from "@spine-event-engine/storage-rdbms";
import type { StorageFactory } from "@spine-event-engine/storage";

import { todoProtoModule } from "../generated/proto-module.js";

/**
 * Builds storage selected for the local single-process To-Do app.
 */
export const TodoStorage = {
  /**
   * Selects storage from `TODO_STORAGE` and its matching provider URL.
   *
   * @param environment Supplies `TODO_STORAGE` and the selected provider URL.
   * @returns A durable storage factory, or no factory for the in-memory default.
   */
  async select(environment: NodeJS.ProcessEnv = process.env): Promise<StorageFactory | undefined> {
    const selected = environment.TODO_STORAGE ?? "memory";
    if (selected === "memory") return undefined;
    const variable = selected === "mysql" ? "TODO_MYSQL_URL" : "TODO_POSTGRESQL_URL";
    if (selected !== "mysql" && selected !== "postgresql") {
      throw new Error('TODO_STORAGE must be "memory", "mysql", or "postgresql".');
    }
    const url = environment[variable]?.trim();
    if (url === undefined || url === "") {
      throw new Error(`${variable} is required when TODO_STORAGE selects durable storage.`);
    }
    const stringifiers = new StringifierRegistry();
    stringifiers.setTypeRegistry(TypeRegistry.from(todoProtoModule));
    const builder =
      selected === "mysql" ? MysqlStorageFactory.newBuilder() : PostgresStorageFactory.newBuilder();
    return builder.setOptions({ url }).setStringifierRegistry(stringifiers).build();
  },
} as const;
