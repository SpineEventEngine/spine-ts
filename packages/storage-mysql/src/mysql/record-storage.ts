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

import { fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import { createHash } from "node:crypto";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { StringifierRegistry } from "@spine-event-engine/core";
import type {
  ColumnMapping,
  NormalizedQueryPlan,
  NormalizedQueryPredicate,
  RecordEntry,
  RecordQuery,
  RecordSpec,
  StorageQueryCapabilities,
  StorageContext,
} from "@spine-event-engine/storage";
import {
  ColumnMappings,
  defaultQueryCandidateLimit,
  RecordStorage,
} from "@spine-event-engine/storage";

import type { MysqlResolvedTable, MysqlTableSpec } from "./table-spec.js";
import { resolvedMysqlTableSpec } from "./table-spec.js";
import {
  MysqlStorageDataError,
  MysqlStorageOperationError,
  MysqlStorageSchemaError,
  mysqlError,
} from "./errors.js";
import { MysqlColumnMapping } from "./column-mapping.js";
import { MysqlIdColumn } from "./id-column.js";

const maximumNormalizedPlanBinds = 1_000;

/**
 * Describes the private connection lifecycle for a record-family handle.
 */
export interface MysqlRecordLifecycle {
  // prettier-ignore

  /**
   * Names the selected physical MySQL database.
   */
  readonly databaseName: string;

  /**
   * Acquires one MySQL connection.
   *
   * @returns Resolves to an acquired connection.
   */
  acquire(): Promise<import("mysql2/promise").PoolConnection>;

  /**
   * Returns one MySQL connection to its pool.
   *
   * @param connection Provides the connection to release.
   */
  release(connection: import("mysql2/promise").PoolConnection): void;
}

/**
 * Stores one record family in one physical MySQL table.
 *
 * @typeParam I The record identifier type.
 * @typeParam R The stored Protobuf record type.
 */
export class MysqlRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  // prettier-ignore

  /**
   * Declares support for atomic compare-and-set operations.
   */
  override readonly atomicCompareAndSet = true;

  #ready: Promise<void> | undefined;

  #bound: import("mysql2/promise").PoolConnection | undefined;

  readonly #idColumn: MysqlIdColumn<I>;

  readonly #columnMapping: ColumnMapping<unknown>;

  /**
   * Returns the physical table name.
   *
   * @returns Returns the physical table name.
   */
  get tableName(): string {
    return this.table.tableName;
  }

  /**
   * Prepares the table before a coordinator transaction begins.
   *
   * @returns Resolves after table creation and inspection complete.
   */
  async prepare(): Promise<void> {
    await this.using(() => Promise.resolve());
  }

  /**
   * Creates a MySQL record-family storage handle.
   *
   * @param context Provides the storage context.
   * @param recordSpec Describes stored records.
   * @param table Describes the resolved physical table.
   * @param lifecycle Acquires and releases MySQL connections.
   * @param onClose Removes this handle from its provider.
   * @param createOperation Creates optional table-creation SQL.
   * @param tableSpec Supplies the canonical table layout.
   * @param stringifiers The schema-bound message stringifiers.
   */
  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    private readonly table: MysqlResolvedTable,
    private readonly lifecycle: MysqlRecordLifecycle,
    private readonly onClose: () => void,
    private readonly createOperation?: () => string,
    tableSpec?: MysqlTableSpec<I, R>,
    stringifiers: StringifierRegistry = new StringifierRegistry(),
  ) {
    super(context, recordSpec);
    this.#idColumn = new MysqlIdColumn(recordSpec.idType, stringifiers);
    this.#columnMapping = new MysqlColumnMapping(stringifiers);
    this.tableSpec =
      tableSpec ??
      resolvedMysqlTableSpec({
        tableName: table.tableName,
        sourceType: recordSpec.sourceType,
        recordType: recordSpec.recordType,
        idType: recordSpec.idType,
        declaredColumns: recordSpec.columns,
      });
  }

  private readonly tableSpec: MysqlTableSpec<I, R>;

  /**
   * Closes this record-family storage handle.
   */
  override close(): void {
    if (!this.isOpen()) return;
    super.close();
    this.onClose();
  }

  /**
   * Deletes the record identified by an ID.
   *
   * @param id Identifies the record to delete.
   * @returns Resolves whether a record was deleted.
   */
  override async delete(id: I): Promise<boolean> {
    this.validateId(id);
    return super.delete(id);
  }

  /**
   * Reads the record identified by an ID.
   *
   * @param id Identifies the record to read.
   * @param options Configures record reading.
   * @returns Resolves to the stored record when present.
   */
  override async read(
    id: I,
    options?: import("@spine-event-engine/storage").RecordReadOptions,
  ): Promise<R | undefined> {
    this.validateId(id);
    return super.read(id, options);
  }

  /**
   * Writes one record.
   *
   * @param record Provides the record to write.
   * @returns Resolves after the record is written.
   */
  override async write(record: R): Promise<void> {
    this.validateId(this.recordSpec.idValueIn(record));
    await super.write(record);
  }

  /**
   * Writes a sequence of records.
   *
   * @param records Provides the records to write.
   * @returns Resolves after the records are written.
   */
  override async writeAll(records: Iterable<R>): Promise<void> {
    const stored = [...records];
    for (const record of stored) this.validateId(this.recordSpec.idValueIn(record));
    await super.writeAll(stored);
  }

  /**
   * Rejects an oversized storage slot before beginning compare-and-set work.
   *
   * @param id Identifies the storage slot.
   * @param expected Provides the expected stored record.
   * @param next Provides the replacement record.
   * @returns Resolves whether the conditional mutation was applied.
   */
  override async compareAndSet(
    id: I,
    expected: R | undefined,
    next: R | undefined,
  ): Promise<boolean> {
    this.validateId(id);
    return super.compareAndSet(id, expected, next);
  }

  /**
   * Writes an immutable record when an identical record is absent.
   *
   * @param record Provides the immutable record.
   * @returns Resolves after the record is written or confirmed identical.
   */
  async writeImmutable(record: R): Promise<void> {
    const id = this.recordSpec.idValueIn(record);
    this.idKey(id);
    await this.using(async (connection) => {
      if (!(await this.immutableAbsent(connection, id, record))) return;
      if ((await this.insertImmutableOn(connection, record)).affectedRows === 1) return;
      await this.immutableAbsent(connection, id, record);
    });
  }

  /**
   * Checks an immutable record without creating it.
   *
   * @param record Provides the immutable record to check.
   * @returns Resolves when the record is absent or identical.
   */
  async assertImmutable(record: R): Promise<void> {
    const id = this.recordSpec.idValueIn(record);
    this.idKey(id);
    await this.using(async (connection) => {
      await this.immutableAbsent(connection, id, record);
    });
  }

  /**
   * Binds nested storage calls to a coordinator-owned connection.
   *
   * @param connection Provides the coordinator-owned connection.
   * @param work Performs the bound storage work.
   * @typeParam T The bound work's result type.
   * @returns Returns the work result.
   */
  async withConnection<T>(
    connection: import("mysql2/promise").PoolConnection,
    work: () => Promise<T>,
  ): Promise<T> {
    if (this.#bound !== undefined) {
      return work();
    }
    this.#bound = connection;
    try {
      await this.ready(connection);
      return await work();
    } finally {
      this.#bound = undefined;
    }
  }

  /**
   * Reads one record with the coordinator transaction's row/gap lock.
   *
   * @param id Identifies the record.
   * @returns Resolves to the stored record when present.
   */
  async readLocked(id: I): Promise<R | undefined> {
    return this.using((connection) => this.readOn(connection, id, true));
  }

  /**
   * Deletes one stored record.
   *
   * @param id Identifies the record to delete.
   * @returns Resolves whether a record was deleted.
   */
  protected async deleteRecord(id: I): Promise<boolean> {
    return this.using(async (connection) => {
      const [result] = await connection.execute<ResultSetHeader>(
        `DELETE FROM \`${this.table.tableName}\` WHERE ID=?`,
        [this.idKey(id)] as never,
      );
      return result.affectedRows === 1;
    });
  }

  /**
   * Reads one stored record.
   *
   * @param id Identifies the record to read.
   * @returns Resolves to the stored record when present.
   */
  protected async readRecord(id: I): Promise<R | undefined> {
    return this.using((connection) => this.readOn(connection, id));
  }

  /**
   * Reads stored record entries matching a query.
   *
   * @param query Specifies the record query.
   * @returns Resolves to matching record entries.
   */
  protected async queryRecordEntries(query: RecordQuery<I>): Promise<readonly RecordEntry<I, R>[]> {
    if (query.ids?.length === 0) return [];
    this.validateQuery(query);
    return this.using(async (connection) => {
      const sql = this.querySql(query);
      const [rows] = await connection.query<Row[]>(sql.sql, sql.values);
      try {
        return rows.map((row) => ({
          id: this.decodeId(row.ID),
          record: fromBinary(this.recordSpec.recordType, row.bytes),
        }));
      } catch (error) {
        throw mysqlError(MysqlStorageDataError, "Stored MySQL record data is invalid.", error);
      }
    });
  }

  /**
   * Returns the normalized query features genuinely executed by MySQL.
   * @returns The normalized features executed by this provider.
   */
  protected override queryCapabilities(): StorageQueryCapabilities {
    return {
      comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
      features: ["either", "nested", "order", "mask", "limit"],
    };
  }

  /**
   * Executes the complete candidate selection in contained, bound MySQL SQL.
   * @param plan The validated normalized query plan.
   * @returns The selected record entries.
   */
  protected override async queryPlanRecordEntries(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly RecordEntry<I, R>[]> {
    const compiled = this.planSql(plan);
    return this.using(async (connection) => {
      const [rows] = await connection.query<Row[]>(compiled.sql, compiled.values);
      try {
        return rows.map((row) => ({
          id: this.decodeId(row.ID),
          record: fromBinary(this.recordSpec.recordType, row.bytes),
        }));
      } catch (error) {
        throw mysqlError(MysqlStorageDataError, "Stored MySQL record data is invalid.", error);
      }
    });
  }

  /**
   * Compares and conditionally replaces one stored record.
   *
   * @param id Identifies the record to replace.
   * @param expected Provides the expected current record.
   * @param next Provides the replacement record.
   * @returns Resolves whether the replacement was applied.
   */
  protected async compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.compareAndSetOnce(id, expected, next);
      } catch (error) {
        if (attempt === 0 && mysqlDeadlock(error)) continue;
        throw mysqlError(MysqlStorageOperationError, "MySQL record operation failed.", error);
      }
    }
    throw new MysqlStorageOperationError("MySQL record operation failed.");
  }

  /**
   * Performs one compare-and-set attempt on a single connection.
   *
   * @param id Identifies the record slot.
   * @param expected Provides the expected materialized record.
   * @param next Provides the replacement materialized record.
   * @returns Resolves whether the replacement was applied.
   */
  private async compareAndSetOnce(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    const connection = await this.lifecycle.acquire();
    let locked = false;
    try {
      await this.ready(connection);
      const transactional = await this.isTransactional(connection);
      if (transactional) await connection.beginTransaction();
      else {
        await this.acquireCasLock(connection, id);
        locked = true;
      }
      return await this.applyCompareAndSet(connection, transactional, id, expected, next);
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      if (locked)
        await connection
          .execute("SELECT RELEASE_LOCK(?)", [this.casLockKey(id)])
          .catch(() => undefined);
      this.lifecycle.release(connection);
    }
  }

  /**
   * Acquires the advisory lock for a non-transactional record slot.
   *
   * @param connection Provides the lock connection.
   * @param id Identifies the record slot.
   * @returns Resolves after the lock is acquired.
   */
  private async acquireCasLock(
    connection: import("mysql2/promise").PoolConnection,
    id: I,
  ): Promise<void> {
    const [rows] = await connection.execute<(RowDataPacket & { acquired: number | string })[]>(
      "SELECT GET_LOCK(?, ?) AS acquired",
      [this.casLockKey(id), 30],
    );
    if (rows[0]?.acquired !== 1 && rows[0]?.acquired !== "1")
      throw new MysqlStorageOperationError("Unable to acquire MySQL record lock.");
  }

  /**
   * Applies a compare-and-set while the record slot is protected.
   *
   * @param connection Provides the protected connection.
   * @param transactional Tells whether the connection has an active transaction.
   * @param id Identifies the record slot.
   * @param expected Provides the expected materialized record.
   * @param next Provides the replacement materialized record.
   * @returns Resolves whether the replacement was applied.
   */
  private async applyCompareAndSet(
    connection: import("mysql2/promise").PoolConnection,
    transactional: boolean,
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    const current = await this.readOn(connection, id, true);
    if (!same(this.recordSpec.recordType, current, expected?.record)) {
      if (transactional) await connection.rollback();
      return false;
    }
    if (next === undefined)
      await connection.execute(`DELETE FROM \`${this.table.tableName}\` WHERE ID=?`, [
        this.idKey(id),
      ] as never);
    else await this.writeOn(connection, next.record);
    if (transactional) await connection.commit();
    return true;
  }

  /**
   * Writes materialized records in one transaction.
   *
   * @param records Provides the materialized records.
   * @returns Resolves after the records are written.
   */
  protected async writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    const connection = await this.lifecycle.acquire();
    try {
      await this.ready(connection);
      await connection.beginTransaction();
      for (const record of records) await this.writeOn(connection, record.record);
      await connection.commit();
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw mysqlError(MysqlStorageOperationError, "MySQL record operation failed.", error);
    } finally {
      this.lifecycle.release(connection);
    }
  }

  /**
   * Writes one materialized record.
   *
   * @param record Provides the materialized record.
   * @returns Resolves after the record is written.
   */
  protected async writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    await this.using((connection) => this.writeOn(connection, record.record));
  }

  /**
   * Executes work with the coordinator-bound connection or a temporary connection.
   *
   * @param work Performs the database operation.
   * @typeParam T The database operation result type.
   * @returns Resolves to the operation result.
   */
  private async using<T>(
    work: (connection: import("mysql2/promise").PoolConnection) => Promise<T>,
  ): Promise<T> {
    const bound = this.#bound;
    if (bound !== undefined) {
      return work(bound);
    }
    const connection = await this.lifecycle.acquire();
    try {
      await this.ready(connection);
      return await work(connection);
    } catch (error) {
      throw mysqlError(MysqlStorageOperationError, "MySQL record operation failed.", error);
    } finally {
      this.lifecycle.release(connection);
    }
  }

  /**
   * Creates and validates the physical table once for this handle.
   *
   * @param connection Provides the connection used for preparation.
   * @returns Resolves when the table is ready.
   */
  private async ready(connection: import("mysql2/promise").PoolConnection): Promise<void> {
    this.#ready ??= this.createAndInspect(connection).catch((error: unknown) => {
      this.#ready = undefined;
      throw mysqlError(
        MysqlStorageSchemaError,
        "MySQL record-family schema is incompatible.",
        error,
      );
    });
    await this.#ready;
  }

  /**
   * Creates the table when absent and verifies its stored schema.
   *
   * @param connection Provides the connection used for schema operations.
   * @returns Resolves after schema verification.
   */
  private async createAndInspect(
    connection: import("mysql2/promise").PoolConnection,
  ): Promise<void> {
    const columnsSql = this.tableSpec.columns.map(mysqlColumnDefinition).join(", ");
    const primarySql = this.tableSpec.primaryKey.map((name) => `\`${name}\``).join(", ");
    await connection.query(
      this.createOperation?.() ??
        `CREATE TABLE IF NOT EXISTS \`${this.table.tableName}\` ` +
          `(${columnsSql}, PRIMARY KEY (${primarySql})) ENGINE=InnoDB`,
    );
    const [columns] = await connection.query<ColumnRow[]>(
      "SELECT column_name AS column_name, column_type AS column_type, " +
        "is_nullable AS is_nullable, column_default AS column_default, " +
        "collation_name AS collation_name, extra AS extra " +
        "FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=?",
      [this.table.tableName],
    );
    const expected = new Map(
      this.tableSpec.columns.map((column) => [column.name.toLowerCase(), column]),
    );
    for (const column of this.tableSpec.columns) {
      const actual = columns.find(
        (candidate) => candidate.column_name.toLowerCase() === column.name.toLowerCase(),
      );
      if (actual === undefined)
        throw new Error(`MySQL table ${this.table.tableName} lacks ${column.name}.`);
      this.assertCompatibleColumn(column, actual);
    }
    for (const column of columns)
      if (!expected.has(column.column_name.toLowerCase()))
        throw new Error(
          `MySQL table ${this.table.tableName} has incompatible extra column ${column.column_name}.`,
        );
    const [primary] = await connection.query<PrimaryKeyRow[]>(
      "SELECT column_name AS column_name, seq_in_index AS seq_in_index " +
        "FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? " +
        "AND index_name='PRIMARY' ORDER BY seq_in_index",
      [this.table.tableName],
    );
    if (
      columns.some((column) => column.column_type !== undefined) &&
      (primary.length !== this.tableSpec.primaryKey.length ||
        primary.some(
          (column, index) =>
            column.column_name.toLowerCase() !== this.tableSpec.primaryKey[index]?.toLowerCase(),
        ))
    )
      throw new Error(`MySQL table ${this.table.tableName} has an incompatible primary key.`);
    const [indexes] = await connection.query<IndexRow[]>(
      "SELECT index_name AS index_name, non_unique AS non_unique, " +
        "column_name AS column_name, seq_in_index AS seq_in_index " +
        "FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name=? " +
        "ORDER BY index_name, seq_in_index",
      [this.table.tableName],
    );
    for (const index of groupedIndexes(indexes))
      if (
        index.nonUnique === 0 &&
        index.name.toLowerCase() !== "primary" &&
        !this.tableSpec.primaryKey.every((name) =>
          index.columns.some((column) => column.toLowerCase() === name.toLowerCase()),
        )
      )
        throw new Error(
          `MySQL table ${this.table.tableName} has incompatible unique index ${index.name}.`,
        );
    const [engines] = await connection.query<EngineRow[]>(
      "SELECT engine AS engine FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?",
      [this.table.tableName],
    );
    const engine = engines[0]?.engine;
    if (engine !== undefined && !["innodb", "myisam", "aria"].includes(engine.toLowerCase()))
      throw new Error(`MySQL table ${this.table.tableName} has unsupported engine ${engine}.`);
  }

  /**
   * Verifies one physical column against the canonical table specification.
   *
   * @param expected Describes the required column.
   * @param actual Describes the stored column.
   */
  private assertCompatibleColumn(
    expected: MysqlTableSpec<I, R>["columns"][number],
    actual: ColumnRow,
  ): void {
    if (!compatibleMysqlType(expected.mysqlType, actual.column_type))
      throw new Error(
        `MySQL table ${this.table.tableName} has an incompatible ${expected.name} type.`,
      );
    if (actual.is_nullable !== undefined && (actual.is_nullable === "YES") !== expected.nullable)
      throw new Error(
        `MySQL table ${this.table.tableName} has incompatible nullable ${expected.name}.`,
      );
    if (!sameDefault(expected.defaultSql, actual.column_default))
      throw new Error(
        `MySQL table ${this.table.tableName} has incompatible ${expected.name} default.`,
      );
    if (
      isBinaryType(expected.mysqlType) &&
      actual.collation_name !== undefined &&
      actual.collation_name !== null
    )
      throw new Error(
        `MySQL table ${this.table.tableName} has incompatible ${expected.name} collation.`,
      );
  }

  /**
   * Reads one record on the supplied connection.
   *
   * @param connection Provides the connection used for reading.
   * @param id Identifies the record.
   * @param lock Requests a row or gap lock when supported.
   * @returns Resolves to the stored record when present.
   */
  private async readOn(
    connection: import("mysql2/promise").PoolConnection,
    id: I,
    lock = false,
  ): Promise<R | undefined> {
    const [rows] = await connection.execute<PayloadRow[]>(
      `SELECT bytes FROM \`${this.table.tableName}\` WHERE ID=?${lock ? " FOR UPDATE" : ""}`,
      [this.idKey(id)] as never,
    );
    if (rows[0] === undefined) return undefined;
    try {
      return fromBinary(this.recordSpec.recordType, rows[0].bytes);
    } catch (error) {
      throw mysqlError(MysqlStorageDataError, "Stored MySQL record data is invalid.", error);
    }
  }

  /**
   * Determines whether the physical table supports transactions.
   *
   * @param connection Provides the connection used for metadata inspection.
   * @returns Resolves whether the table uses InnoDB.
   */
  private async isTransactional(
    connection: import("mysql2/promise").PoolConnection,
  ): Promise<boolean> {
    const [rows] = await connection.query<EngineRow[]>(
      "SELECT engine AS engine FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?",
      [this.table.tableName],
    );
    return rows[0]?.engine?.toLowerCase() === "innodb";
  }

  /**
   * Calculates the fixed-width advisory-lock key for one record slot.
   *
   * @param id Identifies the record slot.
   * @returns The advisory-lock key.
   */
  private casLockKey(id: I): string {
    return createHash("sha256")
      .update(this.lifecycle.databaseName)
      .update("\u0000")
      .update(this.table.tableName)
      .update("\u0000")
      .update(String(this.idKey(id)))
      .digest("hex");
  }

  /**
   * Checks that an immutable slot is absent or stores identical bytes.
   *
   * @param connection Provides the connection used for reading.
   * @param id Identifies the immutable slot.
   * @param record Provides the proposed immutable record.
   * @returns Resolves whether the slot is absent.
   */
  private async immutableAbsent(
    connection: import("mysql2/promise").PoolConnection,
    id: I,
    record: R,
  ): Promise<boolean> {
    const current = await this.readOn(connection, id);
    if (current === undefined) return true;
    if (same(this.recordSpec.recordType, current, record)) return false;
    throw new MysqlStorageOperationError("MySQL immutable record collides.");
  }

  /**
   * Writes one record on the supplied connection.
   *
   * @param connection Provides the connection used for writing.
   * @param record Provides the record to store.
   * @returns Resolves after the write.
   */
  private async writeOn(
    connection: import("mysql2/promise").PoolConnection,
    record: R,
  ): Promise<void> {
    const materialized = this.recordSpec.materialize(record);
    const columns = this.recordSpec.columns;
    const names = ["ID", "bytes", ...columns.map((column) => column.name)];
    const values = [
      this.idKey(materialized.id),
      toBinary(this.recordSpec.recordType, record),
      ...columns.map((column) =>
        ColumnMappings.value(
          this.#columnMapping,
          column.type,
          materialized.columns.get(column.name),
        ),
      ),
    ];
    const update = [
      "bytes=VALUES(bytes)",
      ...columns.map((column) => `\`${column.name}\`=VALUES(\`${column.name}\`)`),
    ];
    const fields = names.map((name) => `\`${name}\``).join(", ");
    const placeholders = names.map(() => "?").join(", ");
    await connection.execute(
      `INSERT INTO \`${this.table.tableName}\` (${fields}) VALUES (${placeholders}) ` +
        `ON DUPLICATE KEY UPDATE ${update.join(", ")}`,
      values as never,
    );
  }

  /**
   * Tries to insert one immutable record without replacing an existing row.
   *
   * @param connection Provides the connection used for writing.
   * @param record Provides the immutable record.
   * @returns Resolves to the insertion result.
   */
  private async insertImmutableOn(
    connection: import("mysql2/promise").PoolConnection,
    record: R,
  ): Promise<ResultSetHeader> {
    const materialized = this.recordSpec.materialize(record);
    const columns = this.recordSpec.columns;
    const names = ["ID", "bytes", ...columns.map((column) => column.name)];
    const values = [
      this.idKey(materialized.id),
      toBinary(this.recordSpec.recordType, record),
      ...columns.map((column) =>
        ColumnMappings.value(
          this.#columnMapping,
          column.type,
          materialized.columns.get(column.name),
        ),
      ),
    ];
    const fields = names.map((name) => `\`${name}\``).join(", ");
    const placeholders = names.map(() => "?").join(", ");
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO \`${this.table.tableName}\` (${fields}) VALUES (${placeholders})`,
      values as never,
    );
    return result;
  }

  /**
   * Builds parameterized SQL for a legacy record query.
   *
   * @param query Specifies the legacy query.
   * @returns The SQL statement and bound values.
   */
  private querySql(query: RecordQuery<I>): { sql: string; values: unknown[] } {
    const values: unknown[] = [];
    const clauses: string[] = [];
    if (query.ids !== undefined) {
      clauses.push(`ID IN (${query.ids.map(() => "?").join(", ")})`);
      values.push(...query.ids.map((id) => this.idKey(id)));
    }
    for (const filter of query.filters ?? []) {
      const name = filter.column === "id" ? "ID" : filter.column;
      this.assertColumn(name);
      clauses.push(`\`${name}\` <=> ?`);
      values.push(this.queryValue(name, filter.value));
    }
    const order = query.sort ?? [];
    for (const item of order) this.assertColumn(item.field === "id" ? "ID" : item.field);
    if (query.after !== undefined) {
      const terms: string[] = [];
      for (let index = 0; index < order.length; index += 1) {
        const item = order[index];
        if (item === undefined) continue;
        const field = item.field === "id" ? "ID" : item.field;
        const prefix = order
          .slice(0, index)
          .map((previous) => `\`${previous.field === "id" ? "ID" : previous.field}\` <=> ?`);
        for (const previous of order.slice(0, index))
          values.push(
            this.queryValue(
              previous.field === "id" ? "ID" : previous.field,
              previous.field === "id"
                ? query.after.id
                : query.after.values[order.indexOf(previous)]?.value,
            ),
          );
        const previous = prefix.length === 0 ? "" : `${prefix.join(" AND ")} AND `;
        const operator = item.direction === "desc" ? "<" : ">";
        terms.push(`${previous}\`${field}\` ${operator} ?`);
        values.push(
          this.queryValue(
            field,
            field === "ID" ? query.after.id : query.after.values[index]?.value,
          ),
        );
      }
      const prefixes = order.map((item) => `\`${item.field === "id" ? "ID" : item.field}\` <=> ?`);
      for (let index = 0; index < order.length; index += 1)
        values.push(
          this.queryValue(
            order[index]?.field === "id" ? "ID" : (order[index]?.field ?? "ID"),
            order[index]?.field === "id" ? query.after.id : query.after.values[index]?.value,
          ),
        );
      terms.push(`${prefixes.length === 0 ? "" : `${prefixes.join(" AND ")} AND `}ID > ?`);
      values.push(this.idKey(query.after.id));
      clauses.push(`(${terms.join(" OR ")})`);
    }
    const orders = [
      ...order.map(
        (item) =>
          `\`${item.field === "id" ? "ID" : item.field}\` ${item.direction === "desc" ? "DESC" : "ASC"}`,
      ),
      "ID ASC",
    ];
    let sql =
      `SELECT ID, bytes FROM \`${this.table.tableName}\` ` +
      (clauses.length === 0 ? "" : `WHERE ${clauses.join(" AND ")} `) +
      `ORDER BY ${orders.join(", ")}`;
    if (query.limit !== undefined) {
      sql += " LIMIT ?";
      values.push(query.limit);
      if (query.offset !== undefined) {
        sql += " OFFSET ?";
        values.push(query.offset);
      }
    } else if (query.offset !== undefined) {
      sql += " LIMIT 18446744073709551615 OFFSET ?";
      values.push(query.offset);
    }
    return { sql, values };
  }

  /**
   * Builds parameterized SQL for a normalized query plan.
   *
   * @param plan Specifies the normalized query plan.
   * @returns The SQL statement and bound values.
   */
  private planSql(plan: NormalizedQueryPlan<I>): { sql: string; values: unknown[] } {
    const values: unknown[] = [];
    const predicate =
      plan.predicate === undefined ? undefined : this.planPredicate(plan.predicate, values);
    if (values.length >= maximumNormalizedPlanBinds) {
      throw new MysqlStorageOperationError(
        `MySQL normalized query exceeds the ${String(maximumNormalizedPlanBinds)}-parameter bind budget.`,
      );
    }
    const order = [
      ...(plan.order ?? []).map(
        (item) => `${this.planColumn(item.column)} ${item.direction === "desc" ? "DESC" : "ASC"}`,
      ),
      "ID ASC",
    ];
    const candidateLimit = plan.candidateLimit ?? defaultQueryCandidateLimit;
    const limit = Math.min(plan.limit ?? Number.MAX_SAFE_INTEGER, candidateLimit + 1);
    values.push(limit);
    return {
      sql:
        `SELECT ID, bytes FROM \`${this.table.tableName}\` ` +
        (predicate === undefined ? "" : `WHERE ${predicate} `) +
        `ORDER BY ${order.join(", ")} LIMIT ?`,
      values,
    };
  }

  /**
   * Builds SQL for one normalized predicate and appends its bound values.
   *
   * @param predicate Specifies the predicate to compile.
   * @param values Receives the predicate's bound values.
   * @returns The predicate SQL.
   */
  private planPredicate(predicate: NormalizedQueryPredicate<I>, values: unknown[]): string {
    if (predicate.kind === "ids") {
      values.push(...predicate.ids.map((id) => this.idKey(id)));
      return `ID IN (${predicate.ids.map(() => "?").join(", ")})`;
    }
    if (predicate.kind === "comparison") {
      const column = this.planColumn(predicate.column);
      const operator =
        predicate.operator === "equal"
          ? "="
          : predicate.operator === "greaterThan"
            ? ">"
            : predicate.operator === "lessThan"
              ? "<"
              : predicate.operator === "greaterOrEqual"
                ? ">="
                : "<=";
      values.push(this.planValue(predicate.column, predicate.value));
      return `${column} ${operator} ?`;
    }
    const joiner = predicate.kind === "all" ? " AND " : " OR ";
    return `(${predicate.predicates.map((child) => this.planPredicate(child, values)).join(joiner)})`;
  }

  /**
   * Returns the SQL spelling of a declared query column.
   *
   * @param column Specifies the column name.
   * @returns The column's SQL spelling.
   */
  private planColumn(column: string): string {
    if (column === "ID") return "ID";
    this.assertColumn(column);
    return `\`${column}\``;
  }

  /**
   * Converts a normalized query value for its declared column type.
   *
   * @param column Specifies the declared column.
   * @param value Provides the query value.
   * @returns The value accepted by the MySQL driver.
   */
  private planValue(column: string, value: unknown): unknown {
    const declared = this.recordSpec.columns.find((candidate) => candidate.name === column);
    if (declared === undefined)
      throw new MysqlStorageOperationError(`MySQL query column is not declared: ${column}`);
    return ColumnMappings.value(this.#columnMapping, declared.type, value);
  }

  /**
   * Validates all identifiers and columns in a legacy query.
   *
   * @param query Specifies the query to validate.
   */
  private validateQuery(query: RecordQuery<I>): void {
    try {
      for (const id of query.ids ?? []) this.idKey(id);
      for (const filter of query.filters ?? []) {
        const name = filter.column === "id" ? "ID" : filter.column;
        this.assertColumn(name);
        this.queryValue(name, filter.value);
      }
      for (const item of query.sort ?? [])
        this.assertColumn(item.field === "id" ? "ID" : item.field);
      if (query.after !== undefined) {
        this.idKey(query.after.id);
        for (let index = 0; index < (query.sort?.length ?? 0); index += 1) {
          const field = query.sort?.[index]?.field;
          if (field !== undefined && field !== "id")
            this.queryValue(field, query.after.values[index]?.value);
        }
      }
    } catch (error) {
      if (error instanceof Error && /too large/i.test(error.message))
        throw new MysqlStorageOperationError("MySQL storage identifier is too large.");
      throw mysqlError(MysqlStorageOperationError, "MySQL storage identifier is invalid.", error);
    }
  }

  /**
   * Validates that a query column is declared by this storage.
   *
   * @param name Specifies the physical column name.
   */
  private assertColumn(name: string): void {
    if (name !== "ID" && !this.recordSpec.columns.some((column) => column.name === name))
      throw new MysqlStorageOperationError(`MySQL query column is not declared: ${name}`);
  }

  /**
   * Converts a record identifier for use by the MySQL driver.
   *
   * @param id Provides the record identifier.
   * @returns The corresponding database value.
   */
  private idKey(id: I): unknown {
    return this.#idColumn.value(id);
  }

  /**
   * Validates that a record identifier can be stored.
   *
   * @param id Provides the record identifier.
   */
  private validateId(id: I): void {
    try {
      this.idKey(id);
    } catch (error) {
      if (error instanceof Error && /too large/i.test(error.message))
        throw new MysqlStorageOperationError("MySQL storage identifier is too large.");
      throw mysqlError(MysqlStorageOperationError, "MySQL storage identifier is invalid.", error);
    }
  }

  /**
   * Decodes a record identifier from a database value.
   *
   * @param key Provides the stored database value.
   * @returns The reconstructed record identifier.
   */
  private decodeId(key: unknown): I {
    return this.#idColumn.read(key);
  }

  /**
   * Converts a legacy query value for its declared column type.
   *
   * @param name Specifies the physical column name.
   * @param value Provides the query value.
   * @returns The value accepted by the MySQL driver.
   */
  private queryValue(name: string, value: unknown): unknown {
    if (name === "ID") return this.idKey(value as I);
    const column = this.recordSpec.columns.find((candidate) => candidate.name === name);
    if (column === undefined)
      throw new MysqlStorageOperationError(`MySQL query column is not declared: ${name}`);
    return ColumnMappings.value(this.#columnMapping, column.type, value);
  }
}

interface PayloadRow extends RowDataPacket {
  bytes: Uint8Array;
}

interface Row extends PayloadRow {
  ID: unknown;
}

interface ColumnRow extends RowDataPacket {
  column_name: string;
  column_type?: string;
  is_nullable?: string;
  column_default?: string | null;
  collation_name?: string | null;
  extra?: string;
}

interface PrimaryKeyRow extends RowDataPacket {
  column_name: string;
  seq_in_index?: number;
}

interface EngineRow extends RowDataPacket {
  engine?: string;
}

interface IndexRow extends RowDataPacket {
  index_name: string;
  non_unique: number;
  column_name: string;
  seq_in_index: number;
}

function mysqlColumnDefinition(
  column: MysqlTableSpec<unknown, Message>["columns"][number],
): string {
  const nullable = column.nullable ? " NULL" : " NOT NULL";
  const defaultSql = column.defaultSql === undefined ? "" : ` DEFAULT ${column.defaultSql}`;
  return `\`${column.name}\` ${column.mysqlType}${nullable}${defaultSql}`;
}

function compatibleMysqlType(expected: string, actual: string | undefined): boolean {
  if (actual === undefined) return true;
  const normalize = (value: string): string =>
    value
      .toLowerCase()
      .replaceAll(/\s+/g, " ")
      // MariaDB reports legacy integer display widths while MySQL 8 does not.
      .replace(/\b(tinyint|smallint|mediumint|int|bigint)\(\d+\)/g, "$1");
  const normalizedExpected = normalize(expected);
  const actualSpelling = actual.toLowerCase().replaceAll(/\s+/g, " ");
  if (normalizedExpected === "boolean")
    return ["boolean", "tinyint", "tinyint(1)"].includes(actualSpelling);
  const normalizedActual = normalize(actual);
  const expectedCapacity = /^(varbinary|varchar)\((\d+)\)$/.exec(normalizedExpected);
  const actualCapacity = /^(varbinary|varchar)\((\d+)\)$/.exec(normalizedActual);
  if (expectedCapacity !== null)
    return (
      actualCapacity !== null &&
      actualCapacity[1] === expectedCapacity[1] &&
      Number(actualCapacity[2]) >= Number(expectedCapacity[2])
    );
  if (normalizedExpected === "blob")
    return ["blob", "mediumblob", "longblob"].includes(normalizedActual);
  return normalizedExpected === normalizedActual;
}

function sameDefault(expected: string | undefined, actual: string | null | undefined): boolean {
  if (expected === undefined)
    return actual === undefined || actual === null || actual.toUpperCase() === "NULL";
  if (actual === undefined) return true;
  if (actual === null) return false;
  return normalizedDefault(actual) === normalizedDefault(expected);
}

function normalizedDefault(value: string): string {
  const normalized = value.replaceAll(/[()'\s]/g, "").toLowerCase();
  if (normalized === "false") return "0";
  if (normalized === "true") return "1";
  return normalized;
}

function isBinaryType(type: string): boolean {
  return /binary|blob/i.test(type);
}

function groupedIndexes(
  indexes: readonly IndexRow[],
): readonly { name: string; nonUnique: number; columns: readonly string[] }[] {
  const grouped = new Map<string, { name: string; nonUnique: number; columns: string[] }>();
  for (const index of indexes) {
    const existing = grouped.get(index.index_name) ?? {
      name: index.index_name,
      nonUnique: index.non_unique,
      columns: [],
    };
    existing.columns[index.seq_in_index - 1] = index.column_name;
    grouped.set(index.index_name, existing);
  }
  return [...grouped.values()];
}

/**
 * Compares two Protobuf messages by their canonical binary form.
 *
 * @typeParam R The compared message type.
 * @param schema Specifies the message schema.
 * @param left Provides the first message.
 * @param right Provides the second message.
 * @returns Whether both values are absent or encode to identical bytes.
 */
function same<R extends Message>(
  schema: import("@bufbuild/protobuf/codegenv2").GenMessage<R>,
  left: R | undefined,
  right: R | undefined,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : Buffer.compare(toBinary(schema, left), toBinary(schema, right)) === 0;
}

function mysqlDeadlock(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "ER_LOCK_DEADLOCK"
  );
}
