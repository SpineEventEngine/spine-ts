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

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

import type { PostgresColumnSpec, PostgresTableSpec } from "./storage-factory.js";
import { PostgresStorageSchemaError } from "./errors.js";

/**
 * Prepares one PostgreSQL record-family table.
 */
export class PostgresTableInitializer {
  #ready: Promise<void> | undefined;

  /**
   * Creates a private initializer for one resolved PostgreSQL table.
   *
   * @param lifecycle Acquires clients and supplies the stable database lock identity.
   * @param schema Names the resolved PostgreSQL schema.
   * @param table Describes the canonical record-family layout.
   * @param customCreate Optionally supplies caller-defined create-table SQL.
   */
  constructor(
    private readonly lifecycle: PostgresClientLifecycle,
    private readonly schema: string,
    private readonly table: PostgresTableSpec<unknown, never>,
    private readonly customCreate?: () => string,
  ) {}

  /**
   * Prepares the table once.
   *
   * @returns Completion of initialization.
   */
  prepare(): Promise<void> {
    this.#ready ??= this.attempt().catch((error: unknown) => this.retry(error));
    return this.#ready;
  }

  private retry(error: unknown): Promise<void> {
    if (!PostgresRetries.allowed(error)) throw error;
    return this.attempt();
  }

  private async attempt(): Promise<void> {
    const client = await this.lifecycle.acquire();
    try {
      await client.query("BEGIN");
      await this.lock(client);
      await client.query(this.customCreate?.() ?? this.create());
      await this.verify(client);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private lock(client: PoolClient): Promise<unknown> {
    return client.query("SELECT pg_advisory_xact_lock($1)", [
      PostgresLocks.key(this.lifecycle.lockIdentity ?? "", this.schema, this.table.tableName),
    ]);
  }

  private create(): string {
    const columns = this.table.columns.map(PostgresSql.column).join(", ");
    const primary = this.table.primaryKey.map(PostgresSql.identifier).join(", ");
    const qualified = PostgresSql.qualified(this.schema, this.table.tableName);
    return `CREATE TABLE IF NOT EXISTS ${qualified} (${columns}, PRIMARY KEY (${primary}))`;
  }

  private async verify(client: PoolClient): Promise<void> {
    const columns = await PostgresCatalog.columns(client, this.schema, this.table.tableName);
    PostgresCatalog.assertColumns(this.table.columns, columns);
    const primary = await PostgresCatalog.primaryKey(client, this.schema, this.table.tableName);
    PostgresCatalog.assertPrimary(this.table.primaryKey, primary);
    PostgresCatalog.assertUnique(
      await PostgresCatalog.unique(client, this.schema, this.table.tableName),
    );
  }
}

interface PostgresClientLifecycle {
  readonly acquire: () => Promise<PoolClient>;
  readonly lockIdentity?: string;
}

interface ColumnRow {
  readonly column_name: string;
  readonly data_type: string;
  readonly character_maximum_length?: number | null;
  readonly is_nullable: string;
  readonly column_default: string | null;
}

interface KeyRow {
  readonly column_name: string;
  readonly ordinal_position: number;
}
interface UniqueRow extends KeyRow {
  readonly constraint_name: string;
}

const PostgresSql = Object.freeze({
  identifier(value: string): string {
    return `"${value.replaceAll('"', '""')}"`;
  },
  qualified(schema: string, table: string): string {
    return `${PostgresSql.identifier(schema)}.${PostgresSql.identifier(table)}`;
  },
  column(column: PostgresColumnSpec): string {
    const nullable = column.nullable ? "" : " NOT NULL";
    const fallback = column.defaultSql === undefined ? "" : ` DEFAULT ${column.defaultSql}`;
    return `${PostgresSql.identifier(column.name)} ${column.postgresType}${nullable}${fallback}`;
  },
});

const PostgresCatalog = Object.freeze({
  async columns(client: PoolClient, schema: string, table: string): Promise<readonly ColumnRow[]> {
    const result = await client.query<ColumnRow>(
      "SELECT column_name, data_type, character_maximum_length, is_nullable, column_default " +
        "FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
      [schema, table],
    );
    return result.rows;
  },
  async primaryKey(client: PoolClient, schema: string, table: string): Promise<readonly KeyRow[]> {
    const result = await client.query<KeyRow>(
      "SELECT kcu.column_name, kcu.ordinal_position FROM information_schema.table_constraints tc " +
        "JOIN information_schema.key_column_usage kcu USING (constraint_catalog, constraint_schema, constraint_name) " +
        "WHERE tc.table_schema=$1 AND tc.table_name=$2 AND tc.constraint_type = 'PRIMARY KEY' " +
        "ORDER BY kcu.ordinal_position",
      [schema, table],
    );
    return result.rows;
  },
  async unique(client: PoolClient, schema: string, table: string): Promise<readonly UniqueRow[]> {
    const result = await client.query<UniqueRow>(
      "SELECT tc.constraint_name, kcu.column_name, kcu.ordinal_position FROM information_schema.table_constraints tc " +
        "JOIN information_schema.key_column_usage kcu USING (constraint_catalog, constraint_schema, constraint_name) " +
        "WHERE tc.table_schema=$1 AND tc.table_name=$2 AND tc.constraint_type = 'UNIQUE' " +
        "ORDER BY tc.constraint_name, kcu.ordinal_position",
      [schema, table],
    );
    return result.rows;
  },
  assertColumns(expected: readonly PostgresColumnSpec[], actual: readonly ColumnRow[]): void {
    if (actual.length !== expected.length) PostgresCatalog.incompatible();
    for (const expectedColumn of expected) {
      const actualColumn = actual.find(({ column_name }) => column_name === expectedColumn.name);
      if (actualColumn === undefined || !PostgresCatalog.sameColumn(expectedColumn, actualColumn))
        PostgresCatalog.incompatible();
    }
  },
  assertPrimary(expected: readonly string[], actual: readonly KeyRow[]): void {
    if (
      actual.length !== expected.length ||
      actual.some(({ column_name }, index) => column_name !== expected[index])
    )
      PostgresCatalog.incompatible();
  },
  assertUnique(actual: readonly UniqueRow[]): void {
    if (actual.length > 0) PostgresCatalog.incompatible();
  },
  sameColumn(expected: PostgresColumnSpec, actual: ColumnRow): boolean {
    return (
      PostgresCatalog.type(expected.postgresType, actual) &&
      (actual.is_nullable === "YES") === expected.nullable &&
      PostgresCatalog.default(expected.defaultSql) ===
        PostgresCatalog.default(actual.column_default)
    );
  },
  type(expected: string, actual: ColumnRow): boolean {
    if (expected === "VARCHAR(512)")
      return actual.data_type === "character varying" && actual.character_maximum_length === 512;
    if (expected === "INT") return actual.data_type === "integer";
    return expected.toLowerCase() === actual.data_type.toLowerCase();
  },
  default(value: string | null | undefined): string | null {
    return value === undefined || value === null ? null : value.trim().toLowerCase();
  },
  incompatible(): never {
    throw new PostgresStorageSchemaError("PostgreSQL table schema is incompatible.");
  },
});

const PostgresLocks = Object.freeze({
  key(database: string, schema: string, table: string): bigint {
    return createHash("sha256")
      .update("spine-postgres-table\u0000")
      .update(database)
      .update("\u0000")
      .update(schema)
      .update("\u0000")
      .update(table)
      .digest()
      .readBigInt64BE();
  },
});
const PostgresRetries = Object.freeze({
  allowed(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      ["40P01", "40001"].includes((error as { code?: string }).code ?? "")
    );
  },
});
