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

import { ScalarType, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { StringifierRegistry } from "@spine-event-engine/core";
import type {
  ColumnMapping,
  ColumnTypeMapping,
  RecordColumnType,
} from "@spine-event-engine/storage";

const timestampType = "google.protobuf.Timestamp";
const versionType = "spine.core.Version";

/**
 * Converts typed Protobuf columns to PostgreSQL-native parameters.
 *
 * The common result is `unknown` because the storage SPI requires one result
 * type while `pg` accepts different JavaScript parameter types for different
 * PostgreSQL columns. Each conversion still preserves its typed input.
 */
export class PostgresColumnMapping implements ColumnMapping<unknown> {
  readonly #stringifiers: StringifierRegistry;

  /**
   * Creates a PostgreSQL-native column mapping.
   *
   * @param stringifiers Provides schema-bound message stringifiers.
   */
  constructor(stringifiers: StringifierRegistry = new StringifierRegistry()) {
    this.#stringifiers = new StringifierRegistry(stringifiers);
  }

  /**
   * Returns the native conversion for one declared column type.
   *
   * @typeParam V Protobuf value accepted by the declared column.
   * @param type Identifies the declared Protobuf value type.
   * @returns The PostgreSQL parameter conversion.
   */
  of<V>(type: RecordColumnType<V>): ColumnTypeMapping<V, unknown> {
    if (type.kind === "scalar") return PostgresColumnMappings.scalar(type.scalar);
    if (type.kind === "enum") return (value) => value;
    if (type.message.typeName === timestampType)
      return (value) => PostgresColumnMappings.timestamp(value);
    if (type.message.typeName === versionType)
      return (value) => PostgresColumnMappings.version(value);
    return (value) =>
      this.#stringifiers.forMessage(type.message as GenMessage<Message>).toString(value as Message);
  }

  /**
   * Returns a conversion that preserves SQL null values.
   *
   * @returns The null conversion.
   */
  ofNull(): ColumnTypeMapping<null, unknown> {
    return (value) => value;
  }
}

const PostgresColumnMappings = Object.freeze({
  /**
   * Maps a Protobuf scalar to the same value for the PostgreSQL driver.
   *
   * @typeParam V Scalar value accepted by the declared column.
   * @param type Identifies the Protobuf scalar kind.
   * @returns A conversion that preserves the scalar value.
   */
  scalar<V>(type: ScalarType): ColumnTypeMapping<V, unknown> {
    void type;
    return (value) => value;
  },

  /**
   * Converts a Protobuf timestamp to epoch nanoseconds.
   *
   * @param value Protobuf timestamp value.
   * @returns Epoch nanoseconds stored in PostgreSQL.
   */
  timestamp(value: unknown): bigint {
    const timestamp = value as { readonly seconds: bigint; readonly nanos: number };
    return timestamp.seconds * 1_000_000_000n + BigInt(timestamp.nanos);
  },

  /**
   * Reads the integer value from a Spine version message.
   *
   * @param value Spine version message.
   * @returns Version number stored in PostgreSQL.
   */
  version(value: unknown): number {
    return (value as { readonly number: number }).number;
  },
});
