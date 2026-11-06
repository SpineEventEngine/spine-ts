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

import type { RecordIndex } from "@spine-event-engine/storage";

/**
 * Validates local Datastore record-index declarations and exact equality shapes.
 */
export const DatastoreRecordIndexes: Readonly<{
  /**
   * Rejects a declaration outside automatic property and key index shapes.
   *
   * @param indexes Complete record-family requirements.
   */
  validate(indexes: readonly RecordIndex[]): void;

  /**
   * Checks whether a declared property supports equality and key ordering.
   *
   * @param indexes Complete record-family requirements.
   * @param column Equality property.
   * @returns Whether exact provider paging can use the declaration.
   */
  hasEquality(indexes: readonly RecordIndex[], column: string): boolean;
}> = Object.freeze({
  /**
   * Rejects a declaration outside automatic property and key index shapes.
   *
   * @param indexes Complete record-family requirements.
   */
  validate(indexes: readonly RecordIndex[]): void {
    for (const index of indexes) {
      const columns = index.columns;
      if (
        columns.length > 2 ||
        (columns.length === 2 && (columns[0] === "id" || columns[1] !== "id"))
      )
        throw new Error(
          `Datastore record index "${index.name}" requires a property and optional id.`,
        );
    }
  },

  /**
   * Checks whether a declared property has the automatic equality/key ordering shape.
   *
   * @param indexes Complete record-family requirements.
   * @param column Equality property.
   * @returns Whether exact provider paging can use the declaration.
   */
  hasEquality(indexes: readonly RecordIndex[], column: string): boolean {
    return indexes.some(
      (index) =>
        index.columns[0] === column &&
        (index.columns.length === 1 || (index.columns.length === 2 && index.columns[1] === "id")),
    );
  },
});
