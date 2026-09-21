/*
 * Copyright 2026, CodeMatters. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License. You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software distributed under the License
 * is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express
 * or implied. See the License for the specific language governing permissions and limitations under
 * the License.
 */

import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import { StringifierRegistry } from "@spine-event-engine/core";
import {
  ColumnMappings,
  defaultQueryCandidateLimit,
  RecordStorage,
  type ColumnMapping,
  type NormalizedQueryPlan,
  type NormalizedQueryPredicate,
  type RecordEntry,
  type RecordQuery,
  type RecordSpec,
  type StorageContext,
  type StorageQueryCapabilities,
} from "@spine-event-engine/storage";
import type { PoolClient } from "pg";

import { PostgresColumnMapping } from "./column-mapping.js";
import { PostgresStorageDataError, PostgresStorageOperationError } from "./errors.js";
import { PostgresIdColumn } from "./id-column.js";
import type { PostgresTableSpec } from "./storage-factory.js";
import { PostgresTableInitializer } from "./table-initializer.js";

const maximumNormalizedPlanBinds = 1_000;

/**
 * Manages PostgreSQL clients for one record-family handle.
 */
export interface PostgresRecordLifecycle {
  /**
   * Names the selected database for advisory coordination.
   */
  readonly databaseName: string;

  /**
   * Names the resolved schema.
   */
  readonly schema: string;

  /**
   * Acquires an available PostgreSQL client.
   *
   * @returns A client that the caller releases.
   */
  acquire(): Promise<PoolClient>;
}

/**
 * Stores one record family in one qualified PostgreSQL table.
 */
export class PostgresRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  /**
   * Reports that compare-and-set uses PostgreSQL transaction coordination.
   */
  override readonly atomicCompareAndSet = true;
  readonly #idColumn: PostgresIdColumn<I>;
  readonly #columns: ColumnMapping<unknown>;
  readonly #initializer: PostgresTableInitializer;

  /**
   * Creates a PostgreSQL record-family handle.
   *
   * @param context Identifies the storage boundary for this handle.
   * @param spec Defines the record type, ID type, and declared columns.
   * @param table Supplies the resolved physical table layout.
   * @param lifecycle Acquires clients for the selected database and schema.
   * @param onClose Removes this handle from the factory's live set.
   * @param create Optionally supplies custom create-table SQL.
   * @param stringifiers Converts message IDs and columns reversibly.
   */
  constructor(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    private readonly table: PostgresTableSpec<I, R>,
    private readonly lifecycle: PostgresRecordLifecycle,
    private readonly onClose: () => void,
    create?: () => string,
    stringifiers: StringifierRegistry = new StringifierRegistry(),
  ) {
    super(context, spec);
    this.#idColumn = new PostgresIdColumn(spec.idType, stringifiers);
    this.#columns = new PostgresColumnMapping(stringifiers);
    this.#initializer = new PostgresTableInitializer(
      lifecycle,
      lifecycle.schema,
      table as never,
      create,
    );
  }

  /**
   * Returns the resolved physical table name.
   *
   * @returns The physical table name without its schema.
   */
  get tableName(): string {
    return this.table.tableName;
  }

  /**
   * Prepares this table before an external coordinator transaction.
   *
   * @returns A promise that resolves after compatible initialization.
   */
  prepare(): Promise<void> {
    return this.#initializer.prepare();
  }

  /**
   * Closes this handle and unregisters it from the factory.
   */
  override close(): void {
    if (!this.isOpen()) return;
    super.close();
    this.onClose();
  }

  /**
   * Writes an immutable record or confirms an identical existing payload.
   *
   * @param record Provides the immutable record to store.
   * @returns A promise that resolves when the payload is stored or confirmed.
   */
  async writeImmutable(record: R): Promise<void> {
    const id = this.recordSpec.idValueIn(record);
    await this.using(async (client) => {
      const inserted = await client.query(this.immutableSql(), this.values(record));
      if (inserted.rowCount === 1) return;
      const existing = await this.readOn(client, id);
      if (existing === undefined || this.same(existing, record)) return;
      throw new PostgresStorageOperationError("PostgreSQL immutable record collides.");
    });
  }

  /**
   * Checks whether an immutable record is absent or byte-identical.
   *
   * @param record Provides the immutable record to inspect.
   * @returns A promise that rejects when the stored payload differs.
   */
  async assertImmutable(record: R): Promise<void> {
    const existing = await this.read(this.recordSpec.idValueIn(record));
    if (existing === undefined || this.same(existing, record)) return;
    throw new PostgresStorageOperationError("PostgreSQL immutable record collides.");
  }

  /**
   * Deletes one record by storage ID.
   *
   * @param id Identifies the record to delete.
   * @returns Whether a stored record was deleted.
   */
  protected async deleteRecord(id: I): Promise<boolean> {
    return this.using(
      async (client) => (await client.query(this.deleteSql(), [this.id(id)])).rowCount === 1,
    );
  }

  /**
   * Reads one record by storage ID.
   *
   * @param id Identifies the record to read.
   * @returns The decoded record, when present.
   */
  protected readRecord(id: I): Promise<R | undefined> {
    return this.using((client) => this.readOn(client, id));
  }

  /**
   * Returns query records from one parameterized PostgreSQL statement.
   *
   * @param query Defines IDs, filters, order, continuation, and bounds.
   * @returns The decoded records admitted by the query.
   */
  protected async queryRecordEntries(query: RecordQuery<I>): Promise<readonly RecordEntry<I, R>[]> {
    if (query.ids?.length === 0) return [];
    const compiled = this.recordQuery(query);
    return this.using((client) => this.entries(client, compiled));
  }

  /**
   * Returns complete normalized-plan pushdown capabilities.
   *
   * @returns The normalized query features implemented by this storage.
   */
  protected override queryCapabilities(): StorageQueryCapabilities {
    return {
      comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
      features: ["either", "nested", "order", "mask", "limit"],
    };
  }

  /**
   * Executes a normalized plan as one parameterized statement.
   *
   * @param plan Defines the validated normalized predicate and bounds.
   * @returns The decoded records admitted by the plan.
   */
  protected override async queryPlanRecordEntries(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly RecordEntry<I, R>[]> {
    const compiled = this.planQuery(plan);
    return this.using((client) => this.entries(client, compiled));
  }

  /**
   * Compares and atomically applies one mutation with bounded retry.
   *
   * @param id Identifies the record guarded by the transaction advisory lock.
   * @param expected Specifies the current materialized record required to write.
   * @param next Specifies the replacement record, or absence for deletion.
   * @returns Whether the current stored payload matched the expected payload.
   */
  protected async compareAndSetRecord(
    id: I,
    expected: Materialized<I, R> | undefined,
    next: Materialized<I, R> | undefined,
  ): Promise<boolean> {
    for (let attempt = 0; attempt !== 2; attempt += 1) {
      try {
        return await this.casOnce(id, expected, next);
      } catch (error) {
        if (attempt === 0 && retryable(error)) continue;
        throw operationError(error);
      }
    }
    throw new PostgresStorageOperationError("PostgreSQL record operation failed.");
  }

  /**
   * Writes all supplied materialized records in source order and one transaction.
   *
   * @param records Provides the materialized records to write.
   * @returns A promise that resolves after the transaction commits.
   */
  protected async writeAllRecords(records: readonly Materialized<I, R>[]): Promise<void> {
    await this.transaction(async (client) => {
      for (const record of records) await this.writeOn(client, record.record);
    });
  }

  /**
   * Writes one materialized record.
   *
   * @param record Provides the materialized record to write.
   * @returns A promise that resolves after PostgreSQL applies the upsert.
   */
  protected writeRecord(record: Materialized<I, R>): Promise<void> {
    return this.using((client) => this.writeOn(client, record.record));
  }

  private async casOnce(
    id: I,
    expected: Materialized<I, R> | undefined,
    next: Materialized<I, R> | undefined,
  ): Promise<boolean> {
    return this.transaction(async (client) => {
      await client.query("SELECT pg_advisory_xact_lock($1)", [this.casKey(id)]);
      const current = await this.readOn(client, id, true);
      if (!this.same(current, expected?.record)) return false;
      if (next === undefined) await client.query(this.deleteSql(), [this.id(id)]);
      else await this.writeOn(client, next.record);
      return true;
    });
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.prepare();
    const client = await this.lifecycle.acquire();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async using<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    await this.prepare();
    const client = await this.lifecycle.acquire();
    try {
      return await work(client);
    } catch (error) {
      throw operationError(error);
    } finally {
      client.release();
    }
  }

  private async readOn(client: PoolClient, id: I, lock = false): Promise<R | undefined> {
    const result = await client.query<Row>(
      `SELECT "bytes" FROM ${this.qualified()} WHERE "ID" = $1${lock ? " FOR UPDATE" : ""}`,
      [this.id(id)],
    );
    if (result.rows[0] === undefined) return undefined;
    try {
      return fromBinary(this.recordSpec.recordType, bytes(result.rows[0].bytes));
    } catch (error) {
      throw new PostgresStorageDataError("Stored PostgreSQL record data is invalid.", {
        cause: error,
      });
    }
  }

  private async entries(
    client: PoolClient,
    query: Compiled,
  ): Promise<readonly RecordEntry<I, R>[]> {
    const result = await client.query<Row>(query.sql, [...query.values]);
    try {
      return result.rows.map((row) => ({
        id: this.#idColumn.read(row.ID),
        record: fromBinary(this.recordSpec.recordType, bytes(row.bytes)),
      }));
    } catch (error) {
      throw new PostgresStorageDataError("Stored PostgreSQL record data is invalid.", {
        cause: error,
      });
    }
  }

  private async writeOn(client: PoolClient, record: R): Promise<void> {
    await client.query(this.upsertSql(), this.values(record));
  }

  private values(record: R): unknown[] {
    const materialized = this.recordSpec.materialize(record);
    return [
      this.id(materialized.id),
      toBinary(this.recordSpec.recordType, record),
      ...this.recordSpec.columns.map((column) =>
        ColumnMappings.value(this.#columns, column.type, materialized.columns.get(column.name)),
      ),
    ];
  }

  private recordQuery(query: RecordQuery<I>): Compiled {
    const bind = new Binds();
    const clauses = this.recordClauses(query, bind);
    const order = this.recordOrder(query);
    if (query.after !== undefined) clauses.push(this.continuation(query, bind));
    let sql = `SELECT "ID", "bytes" FROM ${this.qualified()}${where(clauses)} ORDER BY ${order}`;
    if (query.limit !== undefined) sql += ` LIMIT ${bind.add(query.limit)}`;
    if (query.offset !== undefined)
      sql +=
        query.limit === undefined
          ? this.offsetSql(bind, query.offset)
          : ` OFFSET ${bind.add(query.offset)}`;
    return bind.done(sql);
  }

  private planQuery(plan: NormalizedQueryPlan<I>): Compiled {
    const bind = new Binds();
    const predicate =
      plan.predicate === undefined ? "" : ` WHERE ${this.predicate(plan.predicate, bind)}`;
    if (bind.values.length >= maximumNormalizedPlanBinds)
      throw new PostgresStorageOperationError(
        "PostgreSQL normalized query exceeds the 1000-parameter bind budget.",
      );
    const order = [
      ...(plan.order ?? []).map(
        (item) =>
          `${this.column(item.column)} ${item.direction === "desc" ? "DESC NULLS LAST" : "ASC NULLS FIRST"}`,
      ),
      '"ID" ASC',
    ].join(", ");
    const limit = Math.min(
      plan.limit ?? Number.MAX_SAFE_INTEGER,
      (plan.candidateLimit ?? defaultQueryCandidateLimit) + 1,
    );
    return bind.done(
      `SELECT "ID", "bytes" FROM ${this.qualified()}${predicate} ORDER BY ${order} LIMIT ${bind.add(limit)}`,
    );
  }

  private recordClauses(query: RecordQuery<I>, bind: Binds): string[] {
    const clauses: string[] = [];
    if (query.ids !== undefined)
      clauses.push(`"ID" IN (${query.ids.map((id) => bind.add(this.id(id))).join(", ")})`);
    for (const filter of query.filters ?? [])
      clauses.push(
        `${this.column(filter.column === "id" ? "ID" : filter.column)} ` +
          `IS NOT DISTINCT FROM ${bind.add(this.value(filter.column, filter.value))}`,
      );
    return clauses;
  }

  private recordOrder(query: RecordQuery<I>): string {
    return [
      ...(query.sort ?? []).map(
        (item) =>
          this.column(item.field === "id" ? "ID" : item.field) +
          ` ${item.direction === "desc" ? "DESC NULLS LAST" : "ASC NULLS FIRST"}`,
      ),
      '"ID" ASC',
    ].join(", ");
  }

  private continuation(query: RecordQuery<I>, bind: Binds): string {
    const sort = query.sort ?? [];
    const after = query.after;
    if (after === undefined) return "FALSE";
    const terms: string[] = [];
    for (let index = 0; index < sort.length; index += 1) {
      const current = sort[index];
      if (current === undefined) continue;
      const field = current.field === "id" ? "ID" : current.field;
      const prefix = sort
        .slice(0, index)
        .map(
          (item, previous) =>
            `${this.column(item.field === "id" ? "ID" : item.field)} ` +
            `IS NOT DISTINCT FROM ${bind.add(this.value(item.field, after.values[previous]?.value))}`,
        );
      const value = this.value(field, field === "ID" ? after.id : after.values[index]?.value);
      terms.push(
        `(${[
          ...prefix,
          this.afterTerm(this.column(field), current.direction ?? "asc", value, bind),
        ].join(" AND ")})`,
      );
    }
    const equal = sort.map(
      (item, index) =>
        `${this.column(item.field === "id" ? "ID" : item.field)} ` +
        `IS NOT DISTINCT FROM ${bind.add(this.value(item.field, after.values[index]?.value))}`,
    );
    terms.push(`(${[...equal, `"ID" > ${bind.add(this.id(after.id))}`].join(" AND ")})`);
    return `(${terms.join(" OR ")})`;
  }

  private afterTerm(column: string, direction: string, value: unknown, bind: Binds): string {
    if (value === null) return direction === "desc" ? "FALSE" : `${column} IS NOT NULL`;
    return `(${column} IS NOT NULL AND ${column} ${direction === "desc" ? "<" : ">"} ${bind.add(value)})`;
  }

  private predicate(predicate: NormalizedQueryPredicate<I>, bind: Binds): string {
    if (predicate.kind === "ids")
      return `"ID" IN (${predicate.ids.map((id) => bind.add(this.id(id))).join(", ")})`;
    if (predicate.kind === "comparison")
      return (
        `${this.column(predicate.column)} ${operator(predicate.operator)} ` +
        bind.add(this.value(predicate.column, predicate.value))
      );
    const joiner = predicate.kind === "all" ? " AND " : " OR ";
    return `(${predicate.predicates.map((child) => this.predicate(child, bind)).join(joiner)})`;
  }

  private column(name: string): string {
    if (name === "ID") return '"ID"';
    if (!this.recordSpec.columns.some((column) => column.name === name))
      throw new PostgresStorageOperationError(`PostgreSQL query column is not declared: ${name}`);
    return quote(name);
  }

  private value(name: string, value: unknown): unknown {
    if (name === "id" || name === "ID") return this.id(value as I);
    const column = this.recordSpec.columns.find((candidate) => candidate.name === name);
    if (column === undefined)
      throw new PostgresStorageOperationError(`PostgreSQL query column is not declared: ${name}`);
    return ColumnMappings.value(this.#columns, column.type, value);
  }

  private id(id: I): unknown {
    try {
      return this.#idColumn.value(id);
    } catch (error) {
      throw operationError(error);
    }
  }
  private same(left: R | undefined, right: R | undefined): boolean {
    return left === undefined || right === undefined
      ? left === right
      : Buffer.from(toBinary(this.recordSpec.recordType, left)).equals(
          Buffer.from(toBinary(this.recordSpec.recordType, right)),
        );
  }
  private qualified(): string {
    return `${quote(this.lifecycle.schema)}.${quote(this.table.tableName)}`;
  }
  private deleteSql(): string {
    return `DELETE FROM ${this.qualified()} WHERE "ID" = $1`;
  }
  private immutableSql(): string {
    return `${this.insertSql()} ON CONFLICT ("ID") DO NOTHING`;
  }
  private upsertSql(): string {
    const names = ["ID", "bytes", ...this.recordSpec.columns.map(({ name }) => name)];
    const updates = names.slice(1).map((name) => `${quote(name)}=EXCLUDED.${quote(name)}`);
    return `${this.insertSql()} ON CONFLICT ("ID") DO UPDATE SET ${updates.join(", ")}`;
  }
  private insertSql(): string {
    const names = ["ID", "bytes", ...this.recordSpec.columns.map(({ name }) => name)];
    const columns = names.map(quote).join(", ");
    const values = names.map((_, index) => `$${String(index + 1)}`).join(", ");
    return `INSERT INTO ${this.qualified()} (${columns}) VALUES (${values})`;
  }
  private offsetSql(bind: Binds, offset: number): string {
    return ` LIMIT ${bind.add(9_223_372_036_854_775_807n)} OFFSET ${bind.add(offset)}`;
  }
  private casKey(id: I): bigint {
    return createHash("sha256")
      .update("spine-postgres-cas\0")
      .update(this.lifecycle.databaseName)
      .update("\0")
      .update(this.lifecycle.schema)
      .update("\0")
      .update(this.table.tableName)
      .update("\0")
      .update(String(this.id(id)))
      .digest()
      .readBigInt64BE();
  }
}

type Materialized<I, R extends Message> = ReturnType<RecordSpec<I, R>["materialize"]>;
interface Row {
  readonly ID: unknown;
  readonly bytes: Uint8Array | Buffer;
}
interface Compiled {
  readonly sql: string;
  readonly values: readonly unknown[];
}
class Binds {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${String(this.values.length)}`;
  }
  done(sql: string): Compiled {
    return { sql, values: this.values };
  }
}
function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
function where(clauses: readonly string[]): string {
  return clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`;
}
function bytes(value: Uint8Array | Buffer): Uint8Array {
  return new Uint8Array(value);
}
function operator(value: string): string {
  return (
    (
      {
        equal: "IS NOT DISTINCT FROM",
        greaterThan: ">",
        lessThan: "<",
        greaterOrEqual: ">=",
        lessOrEqual: "<=",
      } as Record<string, string>
    )[value] ??
    (() => {
      throw new PostgresStorageOperationError("PostgreSQL query operator is invalid.");
    })()
  );
}
function retryable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ["40P01", "40001"].includes((error as { code?: string }).code ?? "")
  );
}
function operationError(error: unknown): PostgresStorageOperationError {
  return error instanceof PostgresStorageOperationError || error instanceof PostgresStorageDataError
    ? error
    : new PostgresStorageOperationError("PostgreSQL record operation failed.", { cause: error });
}
