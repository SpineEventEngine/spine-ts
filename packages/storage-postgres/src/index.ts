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

export {
  PostgresStorageFactory,
  type PostgresCreateOperation,
  type PostgresCreateOperationFactory,
  type PostgresColumnSpec,
  type PostgresStorageFactoryBuilder,
  type PostgresStorageFactoryOptions,
  type PostgresTableSpec,
  type PostgresTenantStorageOptions,
} from "./postgres/storage-factory.js";

export type { PostgresDdlType } from "./postgres/data-type.js";

export {
  PostgresStorageConfigurationError,
  PostgresStorageConnectionError,
  PostgresStorageDataError,
  PostgresStorageOperationError,
  PostgresStorageSchemaError,
} from "./postgres/errors.js";

export type { PostgresEntityStorageHandle } from "./postgres/entity-history.js";
