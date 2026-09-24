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
 * Preserves classified provider errors and sanitizes raw PostgreSQL failures.
 */
export const PostgresStorageErrors: Readonly<{ operation(error: unknown): Error }> = Object.freeze({
  /**
   * Preserves a provider error or sanitizes a raw driver failure.
   *
   * @param error Failure raised by a storage operation.
   * @returns Stable provider error.
   */
  operation(error: unknown): Error {
    if (
      error instanceof PostgresStorageConfigurationError ||
      error instanceof PostgresStorageConnectionError ||
      error instanceof PostgresStorageSchemaError ||
      error instanceof PostgresStorageDataError ||
      error instanceof PostgresStorageOperationError
    )
      return error;
    return new PostgresStorageOperationError("PostgreSQL storage operation failed.");
  },
});

/**
 * Classifies the only PostgreSQL transaction errors that may be retried.
 */
export const PostgresTransactionErrors: Readonly<{ retryable(error: unknown): boolean }> =
  Object.freeze({
    /**
     * Checks whether PostgreSQL permits one transaction retry.
     *
     * @param error Failure raised by PostgreSQL.
     * @returns Whether the failure is a serialization conflict or deadlock.
     */
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
  /**
   * Marks the operation failure associated with a client that must be discarded.
   *
   * @param error Operation failure used as the client-release token.
   */
  mark(error: unknown): void {
    if (typeof error === "object" && error !== null) discardedClients.add(error);
  },

  /**
   * Checks whether a failure requires client disposal.
   *
   * @param error Operation failure used as the client-release token.
   * @returns Whether the client must not return to the pool.
   */
  required(error: unknown): boolean {
    return typeof error === "object" && error !== null && discardedClients.has(error);
  },
});

/**
 * Supplies an Error token that tells node-postgres to discard a failed client.
 */
export const PostgresRollbackErrors: Readonly<{ discard(error: unknown): Error }> = Object.freeze({
  /**
   * Supplies an Error token to discard a client after rollback failure.
   *
   * @param error Original operation failure.
   * @returns Error token passed to `pg` client release.
   */
  discard(error: unknown): Error {
    return error instanceof Error ? error : new Error("PostgreSQL transaction rollback failed.");
  },
});
