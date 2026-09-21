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
 * Reports invalid PostgreSQL storage configuration.
 */
export class PostgresStorageConfigurationError extends Error {}

/**
 * Reports PostgreSQL connection failures without driver details.
 */
export class PostgresStorageConnectionError extends Error {}

/**
 * Reports incompatible PostgreSQL record-family schemas.
 */
export class PostgresStorageSchemaError extends Error {}

/**
 * Reports PostgreSQL data that cannot be decoded.
 */
export class PostgresStorageDataError extends Error {}

/**
 * Reports a PostgreSQL storage operation failure without driver details.
 */
export class PostgresStorageOperationError extends Error {}
