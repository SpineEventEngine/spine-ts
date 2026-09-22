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

/**
 * Classifies the only PostgreSQL transaction errors that may be retried.
 */
export const PostgresTransactionErrors: Readonly<{ retryable(error: unknown): boolean }> =
  Object.freeze({
    retryable(error: unknown): boolean {
      return (
        typeof error === "object" &&
        error !== null &&
        ["40P01", "40001"].includes((error as { code?: string }).code ?? "")
      );
    },
  });

const discardedClients = new WeakSet<object>();

/**
 * Tracks operation errors whose PostgreSQL clients must not return to the pool.
 */
export const PostgresClientDisposal: Readonly<{
  mark(error: unknown): void;
  required(error: unknown): boolean;
}> = Object.freeze({
  mark(error: unknown): void {
    if (typeof error === "object" && error !== null) discardedClients.add(error);
  },
  required(error: unknown): boolean {
    return typeof error === "object" && error !== null && discardedClients.has(error);
  },
});

/** Supplies an Error token that tells node-postgres to discard a failed client. */
export const PostgresRollbackErrors: Readonly<{ discard(error: unknown): Error }> = Object.freeze({
  discard(error: unknown): Error {
    return error instanceof Error ? error : new Error("PostgreSQL transaction rollback failed.");
  },
});
