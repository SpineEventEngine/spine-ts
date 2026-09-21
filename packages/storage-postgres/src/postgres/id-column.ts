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
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { StringifierRegistry } from "@spine-event-engine/core";

type PostgresIdType<I> = I extends Message ? GenMessage<I> : string;

/**
 * Converts declared record IDs to and from PostgreSQL values.
 */
export class PostgresIdColumn<I> {
  readonly #stringifiers: StringifierRegistry;
  // prettier-ignore

  /**
   * Specifies the canonical PostgreSQL ID column type.
   */
  readonly postgresType: string;

  /**
   * Creates one declared ID conversion.
   *
   * @param type Provides the message schema or primitive ID kind.
   * @param stringifiers Provides schema-bound message stringifiers.
   */
  constructor(
    private readonly type: PostgresIdType<I>,
    stringifiers: StringifierRegistry = new StringifierRegistry(),
  ) {
    this.#stringifiers = new StringifierRegistry(stringifiers);
    this.postgresType = PostgresIdTypes.type(type);
  }

  /**
   * Converts a logical ID to a PostgreSQL parameter.
   *
   * @param id Identifies the logical record.
   * @returns The JDBC-compatible PostgreSQL value.
   */
  value(id: I): unknown {
    if (typeof this.type !== "string")
      return this.text(this.#stringifiers.forMessage(this.type).toString(id as never));
    PostgresIdTypes.validate(this.type, id);
    return this.type === "string" ? this.text(id as string) : id;
  }

  /**
   * Converts a selected PostgreSQL ID value to its logical form.
   *
   * @param value Provides the selected PostgreSQL value.
   * @returns The logical record ID.
   */
  read(value: unknown): I {
    if (typeof this.type !== "string") return this.message(value);
    return PostgresIdTypes.read(this.type, value) as I;
  }

  private text(value: string): string {
    if (value.length > 512) throw new Error("PostgreSQL storage identifier is too large.");
    return value;
  }

  private message(value: unknown): I {
    if (typeof value !== "string") throw new Error("PostgreSQL message ID is not text.");
    return this.#stringifiers.forMessage(this.type as GenMessage<Message>).fromString(value) as I;
  }
}

const PostgresIdTypes = Object.freeze({
  type<I>(type: PostgresIdType<I>): string {
    if (typeof type !== "string") return "VARCHAR(512)";
    if (type === "string") return "VARCHAR(512)";
    if (type === "int32") return "INT";
    if (type === "int64") return "BIGINT";
    throw new Error(`PostgreSQL storage does not support primitive ID kind "${type}".`);
  },

  read(type: string, value: unknown): unknown {
    if (type === "string" && typeof value === "string") return value;
    if (type === "int32") return PostgresIdTypes.int32(value);
    if (type === "int64") return PostgresIdTypes.int64(value);
    throw new Error(`PostgreSQL ${type} ID is invalid.`);
  },

  int32(value: unknown): number {
    const parsed = typeof value === "number" ? value : Number(value);
    PostgresIdTypes.validate("int32", parsed);
    return parsed;
  },

  int64(value: unknown): bigint {
    const parsed = typeof value === "bigint" ? value : BigInt(value as string | number);
    PostgresIdTypes.validate("int64", parsed);
    return parsed;
  },

  validate(type: string, value: unknown): void {
    if (type === "string" && typeof value === "string") return;
    if (
      type === "int32" &&
      typeof value === "number" &&
      Number.isInteger(value) &&
      value >= -(2 ** 31) &&
      value < 2 ** 31
    )
      return;
    if (type === "int64" && typeof value === "bigint" && value >= -(1n << 63n) && value < 1n << 63n)
      return;
    throw new Error(`PostgreSQL ${type} ID is invalid.`);
  },
});
