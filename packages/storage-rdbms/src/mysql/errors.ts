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
 * Reports an incompatible MySQL record-family schema without database details.
 */
export class MysqlStorageSchemaError extends Error {}

/**
 * Reports stored record data that cannot be decoded without database details.
 */
export class MysqlStorageDataError extends Error {}

/**
 * Reports a MySQL storage operation failure without database details.
 */
export class MysqlStorageOperationError extends Error {}

/**
 * Converts an unknown failure to one public provider error without exposing driver details.
 *
 * @param type Constructs the public error type.
 * @param message Describes the failed provider operation.
 * @param error Supplies the unknown underlying failure.
 * @returns The existing public provider error or a newly constructed public error.
 */
export function mysqlError<E extends Error>(
  type: new (message: string) => E,
  message: string,
  error: unknown,
): E {
  return error instanceof MysqlStorageSchemaError ||
    error instanceof MysqlStorageDataError ||
    error instanceof MysqlStorageOperationError
    ? (error as E)
    : new type(message);
}
