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

import type { PoolClient } from "pg";
import type { StoragePreparationMode } from "@spine-event-engine/storage/provider";
import { PostgresStorageSchemaError } from "./errors.js";
import type { PostgresIndexSpec } from "./storage-factory.js";

/**
 * Carries one ordered PostgreSQL catalog component and its index-wide flags.
 */
interface IndexRow {
  // prettier-ignore

  /**
   * Materialized column name, absent for an expression component.
   */
  readonly column_name: string | null;

  /**
   * One-based position in the native index.
   */
  readonly ordinal: number | string;

  /**
   * Whether the index enforces uniqueness.
   */
  readonly unique: boolean;

  /**
   * Whether the index is valid for queries.
   */
  readonly valid: boolean;

  /**
   * Whether writes maintain the index.
   */
  readonly ready: boolean;

  /**
   * Whether the index remains live.
   */
  readonly live: boolean;

  /**
   * Whether a predicate excludes some table rows.
   */
  readonly partial: boolean;

  /**
   * Whether a component is an expression.
   */
  readonly expression: boolean;

  /**
   * Number of searchable key components.
   */
  readonly key_count: number;

  /**
   * Total components, including non-key values.
   */
  readonly total_count: number;

  /**
   * Native access method name.
   */
  readonly method: string;

  /**
   * Native relation kind.
   */
  readonly kind: string;

  /**
   * Native sort-direction flags.
   */
  readonly direction: number;

  /**
   * Whether the component uses its default operator class.
   */
  readonly default_operator: boolean;

  /**
   * Whether the index uses the source column collation.
   */
  readonly column_collation: boolean;
}

/**
 * Defines native catalog operations for complete lookup-index preparation.
 */
interface IndexOperations {
  /**
   * Creates or checks a complete native lookup index.
   *
   * @param client PostgreSQL transaction or read-only client.
   * @param index Declared physical lookup index.
   * @param mode Physical preparation mode.
   * @param schema Physical PostgreSQL schema.
   * @param table Physical record-family table.
   * @returns Completion of index preparation.
   */
  ensure(
    client: PoolClient,
    schema: string,
    table: string,
    index: PostgresIndexSpec,
    mode: StoragePreparationMode,
  ): Promise<void>;

  /**
   * Reads the ordered native index catalog rows.
   *
   * @param client PostgreSQL transaction or read-only client.
   * @param name Physical index name or identifier.
   * @param schema Physical PostgreSQL schema.
   * @param table Physical record-family table.
   * @returns Ordered native index catalog rows.
   */
  read(
    client: PoolClient,
    schema: string,
    table: string,
    name: string,
  ): Promise<readonly IndexRow[]>;

  /**
   * Rejects an incompatible native index definition.
   *
   * @param index Declared physical lookup index.
   * @param rows Ordered native index catalog rows.
   */
  assert(index: PostgresIndexSpec, rows: readonly IndexRow[]): void;

  /**
   * Returns one safely quoted physical SQL identifier.
   *
   * @param value Physical SQL identifier.
   * @returns Quoted SQL identifier.
   */
  quote(value: string): string;
}

/**
 * Creates or checks complete PostgreSQL B-tree lookup indexes.
 */
export const PostgresRecordIndexes: Readonly<IndexOperations> = Object.freeze({
  /**
   * Establishes one declared index without repairing an incompatible definition.
   * @param client Transaction client or read-only checker.
   * @param schema Physical schema.
   * @param table Physical table.
   * @param index Complete ordered requirement.
   * @param mode Creation or check mode.
   */
  async ensure(
    client: PoolClient,
    schema: string,
    table: string,
    index: PostgresIndexSpec,
    mode: StoragePreparationMode,
  ): Promise<void> {
    let rows = await this.read(client, schema, table, index.name);
    if (rows.length === 0) {
      if (mode === "check")
        throw new PostgresStorageSchemaError("PostgreSQL record index is missing.");
      const qualified = `${this.quote(schema)}.${this.quote(table)}`;
      const columns = index.columns.map((column) => this.quote(column)).join(", ");
      await client.query(
        `CREATE INDEX ${this.quote(index.name)} ON ${qualified} USING btree (${columns})`,
      );
      rows = await this.read(client, schema, table, index.name);
    }
    this.assert(index, rows);
  },

  /**
   * Reads ordered native index components and structural flags from the catalog.
   * @param client PostgreSQL client.
   * @param schema Physical schema.
   * @param table Physical table.
   * @param name Required physical index name.
   * @returns Ordered catalog rows.
   */
  async read(
    client: PoolClient,
    schema: string,
    table: string,
    name: string,
  ): Promise<readonly IndexRow[]> {
    const result = await client.query<IndexRow>(
      "SELECT a.attname AS column_name, key.ordinality AS ordinal, x.indisunique AS unique, " +
        "x.indisvalid AS valid, x.indisready AS ready, x.indislive AS live, " +
        "x.indpred IS NOT NULL AS partial, x.indexprs IS NOT NULL AS expression, " +
        "x.indnkeyatts AS key_count, x.indnatts AS total_count, am.amname AS method, " +
        "i.relkind AS kind, x.indoption[(key.ordinality - 1)::int] AS direction, " +
        "op.opcdefault AS default_operator, " +
        "x.indcollation[(key.ordinality - 1)::int] = a.attcollation AS column_collation " +
        "FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace " +
        "JOIN pg_index x ON x.indrelid=t.oid JOIN pg_class i ON i.oid=x.indexrelid " +
        "JOIN pg_am am ON am.oid=i.relam " +
        "JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS key(attnum, ordinality) ON true " +
        "LEFT JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=key.attnum " +
        "LEFT JOIN pg_opclass op ON op.oid=x.indclass[(key.ordinality - 1)::int] " +
        "WHERE n.nspname=$1 AND t.relname=$2 AND i.relname=$3 ORDER BY key.ordinality",
      [schema, table, name],
    );
    return result.rows;
  },

  /**
   * Rejects substituted, unusable, or incomplete index definitions.
   * @param index Required index.
   * @param rows Native ordered components.
   */
  assert(index: PostgresIndexSpec, rows: readonly IndexRow[]): void {
    if (
      rows.length !== index.columns.length ||
      rows.some(
        (row, position) =>
          row.column_name !== index.columns[position] ||
          Number(row.ordinal) !== position + 1 ||
          row.unique ||
          !row.valid ||
          !row.ready ||
          !row.live ||
          row.partial ||
          row.expression ||
          row.key_count !== index.columns.length ||
          row.total_count !== index.columns.length ||
          row.method !== "btree" ||
          row.kind !== "i" ||
          row.direction !== 0 ||
          !row.default_operator ||
          !row.column_collation,
      )
    )
      throw new PostgresStorageSchemaError("PostgreSQL record index is incompatible.");
  },

  /**
   * Quotes a physical identifier without truncation.
   * @param value Physical identifier.
   * @returns SQL-quoted identifier.
   */
  quote(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
  },
});
