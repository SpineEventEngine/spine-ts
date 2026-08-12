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
 * Queryable column calculated from a stored record.
 */
export class RecordColumn<R extends object, V = unknown> {
  readonly #read: (record: R) => V;

  /**
   * Creates a named column reader.
   * @param name The stable column name.
   * @param type The generated Protobuf value type.
   * @param read The record value reader.
   */
  constructor(
    readonly name: string,
    readonly type: RecordColumnType<V>,
    read: (record: R) => V,
  ) {
    this.#read = read;
  }

  /**
   * Reads the stored column value from a record snapshot.
   * @param record The record snapshot.
   * @returns The column value.
   */
  valueIn(record: R): V {
    return this.#read(record);
  }
}
