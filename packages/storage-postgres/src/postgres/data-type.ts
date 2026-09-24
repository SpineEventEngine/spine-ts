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
 * Describes SQL type names emitted by the PostgreSQL storage provider.
 */
interface PostgresDataTypeNames {
  readonly bigInt: "BIGINT";
  readonly boolean: "BOOLEAN";
  readonly bytea: "BYTEA";
  readonly doublePrecision: "DOUBLE PRECISION";
  readonly integer: "INT";
  readonly real: "REAL";
  readonly text: "TEXT";
  readonly varchar512: "VARCHAR(512)";
}

/**
 * Lists SQL type names emitted by the PostgreSQL storage provider.
 *
 * The `pg` package exposes numeric wire OIDs, not SQL DDL type names.
 */
export const PostgresDataTypes: Readonly<PostgresDataTypeNames> = Object.freeze({
  bigInt: "BIGINT",
  boolean: "BOOLEAN",
  bytea: "BYTEA",
  doublePrecision: "DOUBLE PRECISION",
  integer: "INT",
  real: "REAL",
  text: "TEXT",
  varchar512: "VARCHAR(512)",
});

/**
 * Lists the DDL type declarations supported by this provider.
 */
export type PostgresDdlType = (typeof PostgresDataTypes)[keyof typeof PostgresDataTypes];
