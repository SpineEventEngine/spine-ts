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

import type { RecordColumnType } from "./column-type.js";

/**
 * Converts one typed record-column value to its provider representation.
 *
 * @param value The typed Protobuf value.
 * @returns The provider representation.
 */
export type ColumnTypeMapping<V, R> = (value: V) => R;

/**
 * Supplies provider conversion rules for generated Protobuf column types.
 */
export interface ColumnMapping<R> {
  // prettier-ignore

  /**
   * Returns the conversion rule for a declared column type.
   * @param type The generated Protobuf column type.
   * @returns The provider conversion rule.
   */
  of<V>(type: RecordColumnType<V>): ColumnTypeMapping<V, R>;

  /**
   * Returns the provider conversion rule for an absent column value.
   * @returns The provider null conversion rule.
   */
  ofNull(): ColumnTypeMapping<null, R>;
}

/**
 * Applies one provider mapping to stored and queried column values.
 */
export const ColumnMappings = {
  // prettier-ignore

  /**
   * Converts a value through its declared provider rule.
   *
   * Both record materialization and query planning must call this operation.
   *
   * @param mapping The provider mapping.
   * @param type The declared column type.
   * @param value The stored or queried value.
   * @returns The provider value.
   */
  value<V, R>(
    mapping: ColumnMapping<R>,
    type: RecordColumnType<V>,
    value: V | null | undefined,
  ): R {
    return value === null || value === undefined
      ? mapping.ofNull()(null)
      : mapping.of(type)(value);
  },
} as const;
Object.freeze(ColumnMappings);
