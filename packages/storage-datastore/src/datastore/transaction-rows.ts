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

import type { Message } from "@bufbuild/protobuf";
import type { DatastoreRecordStorage } from "./record-storage.js";

/**
 * One native row staged for a Datastore transaction.
*/
export type NativeRow = ReturnType<DatastoreRecordStorage<string, Message>["transactionEntity"]>;

/**
 * Provider transaction checks shared by ordinary and Agent Entity commits.
*/
interface NativeTransactionChecks {
  /**
   * Returns the first native entity when Datastore supplies an array.
   *
   * @param value Typed value being processed.
   * @returns The first native Entity value supplied by Datastore.
  */
  first(value: unknown): unknown;

  /**
   * Checks native mutation, entity-group, and payload limits before committing.
   *
   * @param rows Complete provider rows for this operation.
  */
  validateRows(rows: readonly NativeRow[]): void;

  /**
   * Checks native write contention eligible for a bounded retry.
   *
   * @param error Original operation or cleanup error.
   * @returns Whether the native error represents retryable transaction contention.
  */
  isAborted(error: unknown): boolean;
}

/**
 * Native transaction helpers for Entity persistence.
*/
export const NativeTransactions: NativeTransactionChecks = Object.freeze({
  /**
   * Returns the first native entity when Datastore supplies an array.
  */
  first(value: unknown): unknown {
    return Array.isArray(value) ? value[0] : value;
  },

  /**
   * Checks native mutation, entity-group, and payload limits before committing.
  */
  validateRows(rows: readonly NativeRow[]): void {
    const keys = rows.map((row) => JSON.stringify(row.key));
    if (rows.length > 500) throw new Error("Datastore transaction mutation limit exceeded.");
    if (new Set(keys).size > 25)
      throw new Error("Datastore transaction entity-group limit exceeded.");
    const bytes = rows.reduce(
      (total, row) =>
        total +
        Buffer.byteLength(
          JSON.stringify(row.data, (_key, value: unknown) =>
            value instanceof Uint8Array
              ? Buffer.from(value).toString("base64")
              : typeof value === "bigint"
                ? value.toString()
                : value,
          ),
          "utf8",
        ),
      0,
    );
    if (bytes > 9 * 1024 * 1024)
      throw new Error("Datastore transaction payload limit exceeded.");
  },

  /**
   * Identifies native write contention eligible for a bounded retry.
  */
  isAborted(error: unknown): boolean {
    return typeof error === "object" && error !== null && Reflect.get(error, "code") === 10;
  },
});
