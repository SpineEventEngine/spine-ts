import {
  createPool,
  type Pool,
  type PoolConnection,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import type { Message } from "@bufbuild/protobuf";
import { fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  RecordStorage,
  StorageFactory,
  type NormalizedQueryPlan,
  type NormalizedQueryPredicate,
  type RecordEntry,
  type RecordQuery,
  type RecordSpec,
  type StorageContext,
  type StorageQueryCapabilities,
} from "@spine-event-engine/storage";
import type { EntityStorageInput } from "@spine-event-engine/storage/internal/entity-history";

import { CanonicalMysqlValues, SortableMysqlColumnValue } from "./value-codec.js";
import {
  MysqlEntityStorage,
  type MysqlEntityConnectionProvider,
  type MysqlEntityStorageHandle,
  entityHistorySchema,
} from "./entity-history.js";

const recordsTable = "`spine_ts_records`";
const columnsTable = "`spine_ts_columns`";
const schemaVersion = 3;
const scopeKeyBytes = 512;
const tenantKeyBytes = 255;
const slotKeyBytes = 768;
const columnNameBytes = 255;
const valueDataBytes = 768;
const maxQueryFilters = 32;
const maxFilterValues = 64;
const maxQueryIds = 256;
const maxQuerySorts = 8;
const maxQueryBinds = 2_048;

const createRecordsTable = `
CREATE TABLE IF NOT EXISTS ${recordsTable} (
  scope_key VARBINARY(${String(scopeKeyBytes)}) NOT NULL,
  tenant_key VARBINARY(${String(tenantKeyBytes)}) NOT NULL,
  slot_key VARBINARY(${String(slotKeyBytes)}) NOT NULL,
  payload MEDIUMBLOB NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  schema_version SMALLINT UNSIGNED NOT NULL DEFAULT ${String(schemaVersion)},
  PRIMARY KEY (scope_key, tenant_key, slot_key)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`;

const createColumnsTable = `
CREATE TABLE IF NOT EXISTS ${columnsTable} (
  scope_key VARBINARY(${String(scopeKeyBytes)}) NOT NULL,
  tenant_key VARBINARY(${String(tenantKeyBytes)}) NOT NULL,
  slot_key VARBINARY(${String(slotKeyBytes)}) NOT NULL,
  column_name VARBINARY(${String(columnNameBytes)}) NOT NULL,
  value_kind TINYINT UNSIGNED NOT NULL,
  value_data VARBINARY(${String(valueDataBytes)}) NOT NULL,
  PRIMARY KEY (scope_key, tenant_key, slot_key, column_name),
  INDEX spine_ts_columns_lookup (scope_key, tenant_key, column_name, value_kind, value_data, slot_key),
  CONSTRAINT spine_ts_columns_record_fk FOREIGN KEY (scope_key, tenant_key, slot_key)
    REFERENCES ${recordsTable} (scope_key, tenant_key, slot_key) ON DELETE CASCADE
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`;

const expectedColumns = new Map<string, string>([
  ["spine_ts_records.scope_key", `varbinary(${String(scopeKeyBytes)})`],
  ["spine_ts_records.tenant_key", `varbinary(${String(tenantKeyBytes)})`],
  ["spine_ts_records.slot_key", `varbinary(${String(slotKeyBytes)})`],
  ["spine_ts_records.payload", "mediumblob"],
  ["spine_ts_records.revision", "bigint unsigned"],
  ["spine_ts_records.schema_version", "smallint unsigned"],
  ["spine_ts_columns.scope_key", `varbinary(${String(scopeKeyBytes)})`],
  ["spine_ts_columns.tenant_key", `varbinary(${String(tenantKeyBytes)})`],
  ["spine_ts_columns.slot_key", `varbinary(${String(slotKeyBytes)})`],
  ["spine_ts_columns.column_name", `varbinary(${String(columnNameBytes)})`],
  ["spine_ts_columns.value_kind", "tinyint unsigned"],
  ["spine_ts_columns.value_data", `varbinary(${String(valueDataBytes)})`],
]);

const expectedIndexes = new Map<string, readonly string[]>([
  ["spine_ts_records.PRIMARY", ["scope_key", "tenant_key", "slot_key"]],
  ["spine_ts_columns.PRIMARY", ["scope_key", "tenant_key", "slot_key", "column_name"]],
  [
    "spine_ts_columns.spine_ts_columns_lookup",
    ["scope_key", "tenant_key", "column_name", "value_kind", "value_data", "slot_key"],
  ],
]);

const expectedForeignKey = ["scope_key", "tenant_key", "slot_key"] as const;
const expectedNullability = "NO";

/**
 * Verifies the fixed entity-history schema owned by the MySQL factory.
 */
const EntitySchemaVerification = Object.freeze(
  new (class {
    nullability(): string {
      return entityHistorySchema.columnNullable ? "YES" : "NO";
    }

    tables(): readonly string[] {
      return entityHistorySchema.tables.map((table) => table.name);
    }

    columns() {
      return new Map(
        entityHistorySchema.tables.flatMap((table) =>
          table.columns.map((column) => [`${table.name}.${column.name}`, column] as const),
        ),
      );
    }

    indexes() {
      return new Map(
        entityHistorySchema.tables.flatMap((table) =>
          table.indexes.map((index) => [`${table.name}.${index.name}`, index] as const),
        ),
      );
    }

    async verify(connection: PoolConnection): Promise<void> {
      const tables = EntitySchemaVerification.tables();
      const expectedColumns = EntitySchemaVerification.columns();
      const expectedIndexes = EntitySchemaVerification.indexes();
      const names = tables.map((table) => `'${table}'`).join(", ");
      const [columns] = await connection.query<SchemaColumn[]>(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name, COLUMN_TYPE AS column_type,
              IS_NULLABLE AS is_nullable, EXTRA AS extra FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name IN (${names})`,
      );
      const actual = new Map(columns.map((row) => [`${row.table_name}.${row.column_name}`, row]));
      for (const [column, expected] of expectedColumns) {
        const row = actual.get(column);
        if (
          row?.column_type !== expected.mysqlType ||
          row.is_nullable !== EntitySchemaVerification.nullability() ||
          row.extra.toLowerCase() !== (expected.autoIncrement === true ? "auto_increment" : "")
        )
          throw new MysqlStorageSchemaError(`MySQL entity schema is incompatible at ${column}.`);
      }
      if (actual.size !== expectedColumns.size)
        throw new MysqlStorageSchemaError("MySQL entity schema has unexpected columns.");
      const [actualTables] = await connection.query<SchemaTable[]>(
        `SELECT TABLE_NAME AS table_name, ENGINE AS engine FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name IN (${names})`,
      );
      if (
        actualTables.length !== tables.length ||
        actualTables.some(
          (table) => table.engine?.toLowerCase() !== entityHistorySchema.engine.toLowerCase(),
        )
      )
        throw new MysqlStorageSchemaError("MySQL entity tables must use InnoDB.");
      const [indexes] = await connection.query<SchemaIndex[]>(
        `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name, SEQ_IN_INDEX AS seq_in_index,
              COLUMN_NAME AS column_name, NON_UNIQUE AS non_unique, COLLATION AS collation
       FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name IN (${names})
       ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      );
      const actualIndexes = new Map<string, SchemaIndex[]>();
      for (const row of indexes) {
        const name = `${row.table_name}.${row.index_name}`;
        const rows = actualIndexes.get(name) ?? [];
        if (row.seq_in_index !== rows.length + 1)
          throw new MysqlStorageSchemaError(`MySQL entity index is incompatible at ${name}.`);
        rows.push(row);
        actualIndexes.set(name, rows);
      }
      if (actualIndexes.size !== expectedIndexes.size)
        throw new MysqlStorageSchemaError("MySQL entity schema has unexpected indexes.");
      for (const [index, expected] of expectedIndexes) {
        const rows = actualIndexes.get(index);
        if (
          rows?.length !== expected.columns.length ||
          rows.some(
            (row, position) =>
              row.column_name !== expected.columns[position]?.name ||
              row.non_unique !== (expected.primary === true || expected.unique === true ? 0 : 1) ||
              row.collation?.toUpperCase() !==
                (expected.columns[position].direction === "DESC" ? "D" : "A"),
          )
        )
          throw new MysqlStorageSchemaError(`MySQL entity index is incompatible at ${index}.`);
      }
    }
  })(),
);

/**
 * Explicit connection and pool settings for the owned MySQL adapter pool.
 */
export interface MysqlStorageOptions {
  // prettier-ignore

  /**
   * Complete MySQL connection URL, including an explicit database name.
   */
  readonly url: string;

  /**
   * Maximum simultaneous pool connections.
   */
  readonly connectionLimit?: number;

  /**
   * Milliseconds allowed to establish a new connection.
   */
  readonly connectTimeoutMs?: number;

  /**
   * TLS material and verification policy supplied without exposing driver settings.
   */
  readonly tls?: {
    readonly ca?: string;
    readonly cert?: string;
    readonly key?: string;
    readonly rejectUnauthorized?: boolean;
  };
}

/**
 * Thrown when the adapter cannot safely use the supplied MySQL configuration.
 */
export class MysqlStorageConfigurationError extends Error {
  // prettier-ignore

  /**
   * Creates a configuration error with the validation message.
   * @param message The invalid setting.
   */
  constructor(message: string) {
    super(message);
    this.name = "MysqlStorageConfigurationError";
  }
}

/**
 * Thrown when the adapter cannot connect, initialize, or close without exposing provider details.
 */
export class MysqlStorageConnectionError extends Error {
  // prettier-ignore

  /**
   * Creates the stable connection-failure error.
   */
  constructor() {
    super("MySQL storage could not connect, initialize, or close.");
    this.name = "MysqlStorageConnectionError";
  }
}

/**
 * Thrown when fixed adapter-owned tables do not have the required shape.
 */
export class MysqlStorageSchemaError extends Error {
  // prettier-ignore

  /**
   * Creates a schema error with the incompatible detail.
   * @param message The schema detail.
   */
  constructor(message: string) {
    super(message);
    this.name = "MysqlStorageSchemaError";
  }
}

/**
 * Thrown when durable MySQL record data cannot be decoded safely.
 */
export class MysqlStorageDataError extends Error {
  // prettier-ignore

  /**
   * Creates the stable invalid-data error.
   */
  constructor() {
    super("MySQL storage data could not be decoded.");
    this.name = "MysqlStorageDataError";
  }
}

/**
 * Thrown when a record operation cannot complete without exposing provider details.
 */
export class MysqlStorageOperationError extends Error {
  // prettier-ignore

  /**
   * Creates the stable record-operation error.
   */
  constructor() {
    super("MySQL storage record operation could not complete.");
    this.name = "MysqlStorageOperationError";
  }
}

/**
 * MySQL-backed factory that owns its connection pool and private normalized schema.
 */
export class MysqlStorageFactory extends StorageFactory {
  readonly #pool: Pool;
  readonly #handles = new Set<{ close(): void }>();
  readonly #lifecycle = new MysqlPoolLifecycle();
  #closePromise: Promise<void> | undefined;

  private constructor(
    pool: Pool,
    private readonly database: string,
  ) {
    super();
    this.#pool = pool;
  }

  /**
   * Connects, creates or verifies the fixed schema, and returns a ready-to-use factory.
   * @param options The MySQL connection and pool settings.
   * @returns A connected storage factory.
   */
  static async create(options: MysqlStorageOptions): Promise<MysqlStorageFactory> {
    const url = MysqlOptions.validate(options);
    const pool = createPool({
      host: url.hostname,
      ...(url.port.length > 0 ? { port: Number(url.port) } : {}),
      ...(url.username.length > 0 ? { user: decodeURIComponent(url.username) } : {}),
      ...(url.password.length > 0 ? { password: decodeURIComponent(url.password) } : {}),
      database: decodeURIComponent(url.pathname.slice(1)),
      ...(options.connectionLimit === undefined
        ? {}
        : { connectionLimit: options.connectionLimit }),
      ...(options.connectTimeoutMs === undefined
        ? {}
        : { connectTimeout: options.connectTimeoutMs }),
      ...(options.tls === undefined ? {} : { ssl: options.tls }),
    });
    const factory = new MysqlStorageFactory(pool, decodeURIComponent(url.pathname.slice(1)));

    try {
      await factory.initialize();
      return factory;
    } catch (error) {
      await pool.end().catch(() => undefined);
      if (
        error instanceof MysqlStorageConfigurationError ||
        error instanceof MysqlStorageSchemaError
      ) {
        throw error;
      }
      throw new MysqlStorageConnectionError();
    }
  }

  /**
   * Closes the owned pool once; every repeated call observes the same completion.
   * @returns Completes when the pool is closed.
   */
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TypeScript allows this async lifecycle override.
  override close(): Promise<void> {
    this.#closePromise ??= this.closePool();
    return this.#closePromise;
  }

  /**
   * Creates a MySQL-backed record storage.
   * @param context The storage context.
   * @param recordSpec The record specification.
   * @returns The created record storage.
   */
  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const handle = new MysqlRecordStorage(context, recordSpec, this.#pool, this.#lifecycle, () => {
      this.#handles.delete(handle);
    });
    this.#handles.add(handle);
    return handle;
  }

  /**
   * Creates a provider/framework-owned history bundle that its recipient may close independently.
   *
   * The factory closes all live bundles during shutdown. MySQL is the only
   * implementation; PostgreSQL support is future work.
   * @param input The entity storage contract.
   * @returns An entity history storage handle.
   */
  createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): MysqlEntityStorageHandle<I, S> {
    this.#lifecycle.assertOpen();
    const handle = new MysqlEntityStorage(
      input,
      this.entityConnections(),
      this.database,
      (connection) => EntitySchemaVerification.verify(connection),
      () => this.#handles.delete(handle),
    );
    this.#handles.add(handle);
    return handle;
  }

  /**
   * Admits entity connections and settles their lifecycle lease exactly once.
   */
  private entityConnections(): MysqlEntityConnectionProvider {
    const lifecycle = this.#lifecycle;
    const pool = this.#pool;
    const leases = new WeakMap<PoolConnection, { release(): void; destroy(): void }>();
    return {
      async acquire() {
        lifecycle.admit();
        try {
          const connection = await pool.getConnection();
          let settled = false;
          const settle = () => {
            if (settled) return;
            settled = true;
            lifecycle.release();
          };
          leases.set(connection, {
            release: () => {
              try {
                connection.release();
              } finally {
                settle();
              }
            },
            destroy: () => {
              try {
                connection.destroy();
              } finally {
                settle();
              }
            },
          });
          return connection;
        } catch (error) {
          lifecycle.release();
          throw error;
        }
      },
      release(connection) {
        leases.get(connection)?.release();
      },
      destroy(connection) {
        leases.get(connection)?.destroy();
      },
    };
  }

  private async initialize(): Promise<void> {
    const connection = await this.#pool.getConnection();
    try {
      await connection.query(createRecordsTable);
      await connection.query(createColumnsTable);
      await RecordSchemaVerification.verify(connection);
    } finally {
      connection.release();
    }
  }

  private async closePool(): Promise<void> {
    super.close();
    for (const handle of this.#handles) {
      handle.close();
    }
    await this.#lifecycle.close();
    try {
      await this.#pool.end();
    } catch {
      throw new MysqlStorageConnectionError();
    }
  }
}

class MysqlPoolLifecycle {
  #active = 0;
  #closing = false;
  #drained: Promise<void> | undefined;
  #onDrained: (() => void) | undefined;

  admit(): void {
    if (this.#closing) throw new MysqlStorageOperationError();
    this.#active += 1;
  }

  assertOpen(): void {
    if (this.#closing) throw new MysqlStorageOperationError();
  }

  release(): void {
    this.#active -= 1;
    if (this.#active === 0) {
      this.#onDrained?.();
      this.#onDrained = undefined;
    }
  }

  close(): Promise<void> {
    this.#closing = true;
    if (this.#active === 0) return Promise.resolve();
    this.#drained ??= new Promise<void>((onDrained) => {
      this.#onDrained = onDrained;
    });
    return this.#drained;
  }
}

class MysqlRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  override readonly atomicCompareAndSet = true;
  readonly #scope: Uint8Array;

  constructor(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
    private readonly pool: Pool,
    private readonly lifecycle: MysqlPoolLifecycle,
    private readonly onClose: () => void,
  ) {
    super(context, recordSpec);
    this.#scope = CanonicalMysqlValues.encode(
      [context.name, context.multitenant, recordSpec.schema.typeName],
      scopeKeyBytes,
    );
  }

  override close(): void {
    if (!this.isOpen()) return;
    super.close();
    this.onClose();
  }

  protected async deleteRecord(id: I): Promise<boolean> {
    const slot = CanonicalMysqlValues.encode(id, slotKeyBytes);
    const tenant = this.tenant();
    const connection = await this.acquireConnection();
    try {
      await connection.beginTransaction();
      const [result] = await connection.execute<ResultSetHeader>(
        `DELETE FROM ${recordsTable} WHERE scope_key = ? AND tenant_key = ? AND slot_key = ?`,
        [this.#scope, tenant, slot],
      );
      await connection.commit();
      return result.affectedRows === 1;
    } catch {
      await connection.rollback().catch(() => undefined);
      throw new MysqlStorageOperationError();
    } finally {
      this.releaseConnection(connection);
    }
  }

  protected async queryRecordEntries(query: RecordQuery<I>): Promise<readonly RecordEntry<I, R>[]> {
    const tenant = this.tenant();
    const compiled = MysqlQueries.compile(query, this.#scope, tenant);
    if (compiled === undefined) return [];
    const connection = await this.acquireConnection();
    try {
      const [rows] = await connection.query<QueryRow[]>(
        compiled.sql,
        compiled.values as (Uint8Array | number)[],
      );
      return rows.map((row) => MysqlRecords.decodeQueryRow(this.recordSpec, row));
    } catch (error) {
      if (error instanceof MysqlStorageDataError) throw error;
      throw new MysqlStorageOperationError();
    } finally {
      this.releaseConnection(connection);
    }
  }

  protected override queryCapabilities(): StorageQueryCapabilities {
    return {
      comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
      features: ["either", "nested", "order", "mask", "limit"],
    };
  }

  protected override async queryPlanRecordEntries(
    plan: NormalizedQueryPlan<I>,
  ): Promise<readonly RecordEntry<I, R>[]> {
    const tenant = this.tenant();
    const compiled = MysqlQueries.plan(plan, this.#scope, tenant);
    const connection = await this.acquireConnection();
    try {
      const [rows] = await connection.query<QueryRow[]>(
        compiled.sql,
        compiled.values as (Uint8Array | number)[],
      );
      return rows.map((row) => MysqlRecords.decodeQueryRow(this.recordSpec, row));
    } catch (error) {
      if (error instanceof MysqlStorageDataError) throw error;
      throw new MysqlStorageOperationError();
    } finally {
      this.releaseConnection(connection);
    }
  }

  protected async readRecord(id: I): Promise<R | undefined> {
    const slot = CanonicalMysqlValues.encode(id, slotKeyBytes);
    const tenant = this.tenant();
    const connection = await this.acquireConnection();
    try {
      const [rows] = await connection.execute<PayloadRow[]>(
        `SELECT payload FROM ${recordsTable} WHERE scope_key = ? AND tenant_key = ? AND slot_key = ?`,
        [this.#scope, tenant, slot],
      );
      const row = rows[0];
      if (row === undefined) return undefined;
      if (!(row.payload instanceof Uint8Array)) throw new MysqlStorageDataError();
      try {
        return fromBinary(this.recordSpec.schema, row.payload, { readUnknownFields: false });
      } catch {
        throw new MysqlStorageDataError();
      }
    } catch (error) {
      if (error instanceof MysqlStorageDataError) throw error;
      throw new MysqlStorageOperationError();
    } finally {
      this.releaseConnection(connection);
    }
  }

  protected async compareAndSetRecord(
    id: I,
    expected: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
    next: ReturnType<RecordSpec<I, R>["materialize"]> | undefined,
  ): Promise<boolean> {
    const slot = CanonicalMysqlValues.encode(id, slotKeyBytes);
    const expectedPayload = expected === undefined ? undefined : this.payload(expected.record);
    const replacement = next === undefined ? undefined : this.prepare(next, slot);
    const tenant = this.tenant();
    const connection = await this.acquireConnection();
    let duplicateCreate = false;
    try {
      await connection.beginTransaction();
      if (expectedPayload === undefined && replacement !== undefined) {
        try {
          await connection.execute(
            `INSERT INTO ${recordsTable} (scope_key, tenant_key, slot_key, payload) VALUES (?, ?, ?, ?)`,
            [this.#scope, tenant, replacement.slot, replacement.payload],
          );
        } catch (error) {
          duplicateCreate = MysqlRecords.duplicateKey(error);
          throw error;
        }
        await this.insertColumns(connection, tenant, replacement);
        await connection.commit();
        return true;
      }
      const [rows] = await connection.execute<PayloadRow[]>(
        `SELECT payload FROM ${recordsTable} WHERE scope_key = ? AND tenant_key = ? AND slot_key = ? FOR UPDATE`,
        [this.#scope, tenant, slot],
      );
      const current = rows[0];
      if (current === undefined) {
        if (expectedPayload !== undefined) {
          await connection.rollback();
          return false;
        }
        await connection.commit();
        return true;
      } else {
        if (!(current.payload instanceof Uint8Array)) throw new MysqlStorageDataError();
        if (
          expectedPayload === undefined ||
          !MysqlRecords.sameBytes(current.payload, expectedPayload)
        ) {
          await connection.rollback();
          return false;
        }
        if (replacement === undefined) {
          await connection.execute(
            `DELETE FROM ${recordsTable} WHERE scope_key = ? AND tenant_key = ? AND slot_key = ?`,
            [this.#scope, tenant, slot],
          );
        } else await this.replace(connection, tenant, replacement);
      }
      await connection.commit();
      return true;
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        throw new MysqlStorageOperationError();
      }
      // Set only by the exact records-key claim.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (duplicateCreate) return false;
      if (error instanceof MysqlStorageDataError) throw error;
      throw new MysqlStorageOperationError();
    } finally {
      this.releaseConnection(connection);
    }
  }

  protected async writeAllRecords(
    records: readonly ReturnType<RecordSpec<I, R>["materialize"]>[],
  ): Promise<void> {
    const prepared = records.map((record) => this.prepare(record));
    if (prepared.length === 0) return;
    const tenant = this.tenant();
    const connection = await this.acquireConnection();
    try {
      await connection.beginTransaction();
      for (const record of prepared) await this.replace(connection, tenant, record);
      await connection.commit();
    } catch {
      await connection.rollback().catch(() => undefined);
      throw new MysqlStorageOperationError();
    } finally {
      this.releaseConnection(connection);
    }
  }

  protected async writeRecord(record: ReturnType<RecordSpec<I, R>["materialize"]>): Promise<void> {
    const prepared = this.prepare(record);
    const tenant = this.tenant();
    const connection = await this.acquireConnection();
    try {
      await connection.beginTransaction();
      await this.replace(connection, tenant, prepared);
      await connection.commit();
    } catch {
      await connection.rollback().catch(() => undefined);
      throw new MysqlStorageOperationError();
    } finally {
      this.releaseConnection(connection);
    }
  }

  private payload(record: R): Uint8Array {
    return toBinary(this.recordSpec.schema, record, { writeUnknownFields: false });
  }

  private async acquireConnection(): Promise<PoolConnection> {
    this.lifecycle.admit();
    try {
      return await this.pool.getConnection();
    } catch {
      this.lifecycle.release();
      throw new MysqlStorageOperationError();
    }
  }

  private releaseConnection(connection: PoolConnection): void {
    try {
      connection.release();
    } finally {
      this.lifecycle.release();
    }
  }

  private prepare(
    record: ReturnType<RecordSpec<I, R>["materialize"]>,
    slot = CanonicalMysqlValues.encode(record.id, slotKeyBytes),
  ): PreparedRecord {
    return {
      slot,
      payload: this.payload(record.record),
      columns: [...record.columns].map(([name, value]) => ({
        name: MysqlColumns.encodeName(name),
        value: MysqlColumns.encodeValue(value),
      })),
    };
  }

  private async replace(
    connection: PoolConnection,
    tenant: Uint8Array,
    record: PreparedRecord,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO ${recordsTable} (scope_key, tenant_key, slot_key, payload) ` +
        `VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE payload = VALUES(payload), ` +
        `revision = revision + 1`,
      [this.#scope, tenant, record.slot, record.payload],
    );
    await connection.execute(
      `DELETE FROM ${columnsTable} WHERE scope_key = ? AND tenant_key = ? AND slot_key = ?`,
      [this.#scope, tenant, record.slot],
    );
    for (const column of record.columns)
      await connection.execute(
        `INSERT INTO ${columnsTable} (scope_key, tenant_key, slot_key, ` +
          `column_name, value_kind, value_data) VALUES (?, ?, ?, ?, ?, ?)`,
        [this.#scope, tenant, record.slot, column.name, column.value.kind, column.value.data],
      );
  }

  private async insertColumns(
    connection: PoolConnection,
    tenant: Uint8Array,
    record: PreparedRecord,
  ): Promise<void> {
    for (const column of record.columns)
      await connection.execute(
        `INSERT INTO ${columnsTable} (scope_key, tenant_key, slot_key, ` +
          `column_name, value_kind, value_data) VALUES (?, ?, ?, ?, ?, ?)`,
        [this.#scope, tenant, record.slot, column.name, column.value.kind, column.value.data],
      );
  }

  private tenant(): Uint8Array {
    if (!this.context.multitenant) return CanonicalMysqlValues.encode(null, tenantKeyBytes);
    const tenantId = this.context.tenantId;
    if (tenantId === undefined || tenantId.trim().length === 0) {
      throw new MysqlStorageConfigurationError("Multitenant storage requires context.tenantId.");
    }
    return CanonicalMysqlValues.encode(tenantId, tenantKeyBytes);
  }
}

interface PayloadRow extends RowDataPacket {
  readonly payload: Uint8Array;
}

interface QueryRow extends PayloadRow {
  readonly slot_key: Uint8Array;
}

interface PreparedRecord {
  readonly slot: Uint8Array;
  readonly payload: Uint8Array;
  readonly columns: readonly {
    readonly name: Uint8Array;
    readonly value: { readonly data: Uint8Array; readonly kind: number };
  }[];
}

interface SqlClause {
  readonly sql: string;
  readonly values: readonly unknown[];
}

type CompiledQuery = SqlClause;

/**
 * Compares and decodes MySQL record values.
 */
const MysqlRecords = Object.freeze(
  new (class {
    sameBytes(left: Uint8Array, right: Uint8Array): boolean {
      return (
        left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
      );
    }

    duplicateKey(error: unknown): boolean {
      return (
        typeof error === "object" && error !== null && Reflect.get(error, "code") === "ER_DUP_ENTRY"
      );
    }

    decodeQueryRow<I, R extends Message>(spec: RecordSpec<I, R>, row: QueryRow): RecordEntry<I, R> {
      if (!(row.slot_key instanceof Uint8Array) || !(row.payload instanceof Uint8Array)) {
        throw new MysqlStorageDataError();
      }
      try {
        return {
          id: CanonicalMysqlValues.decode(row.slot_key) as I,
          record: fromBinary(spec.schema, row.payload, { readUnknownFields: false }),
        };
      } catch {
        throw new MysqlStorageDataError();
      }
    }
  })(),
);

/**
 * Encodes and groups MySQL record columns.
 */
const MysqlColumns = Object.freeze(
  new (class {
    encodeName(name: string): Uint8Array {
      if (name.trim().length === 0)
        throw new MysqlStorageConfigurationError("MySQL record column name must not be blank.");
      return CanonicalMysqlValues.encode(name, columnNameBytes);
    }

    encodeValue(value: unknown): { readonly data: Uint8Array; readonly kind: number } {
      try {
        return SortableMysqlColumnValue.encode(value);
      } catch {
        throw new MysqlStorageConfigurationError("MySQL record column has an unsupported value.");
      }
    }

    unique(values: readonly { readonly data: Uint8Array; readonly kind: number }[]) {
      const seen = new Set<string>();
      return values.filter((value) => {
        const key = `${String(value.kind)}:${this.key(value.data)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    group(values: readonly { readonly data: Uint8Array; readonly kind: number }[]) {
      const groups = new Map<number, { readonly data: Uint8Array; readonly kind: number }[]>();
      for (const value of values) {
        const group = groups.get(value.kind) ?? [];
        group.push(value);
        groups.set(value.kind, group);
      }
      return [...groups.values()];
    }

    key(value: Uint8Array): string {
      return [...value].join(",");
    }
  })(),
);

/**
 * Compiles bounded MySQL record queries.
 */
const MysqlQueries = Object.freeze(
  new (class {
    compile<I>(
      query: RecordQuery<I>,
      scope: Uint8Array,
      tenant: Uint8Array,
    ): CompiledQuery | undefined {
      this.validate(query);
      const filters = query.filters ?? [];
      const filterValues = filters.map((filter) => ({
        column: this.column(filter.column),
        values: Array.isArray(filter.value) ? filter.value : [filter.value],
      }));
      if (filterValues.some((filter) => filter.values.length === 0)) return undefined;

      const ids = query.ids?.map((id) => CanonicalMysqlValues.encode(id, slotKeyBytes)) ?? [];
      const sorts: { readonly column: string; readonly direction: "ASC" | "DESC" }[] = (
        query.sort ?? []
      ).map((order) => ({
        column: this.column(order.field),
        direction: order.direction === "desc" ? "DESC" : "ASC",
      }));
      const joins: SqlClause[] = [];

      for (const [index, filter] of filterValues.entries()) {
        if (filter.column === "id") continue;
        const alias = `f${String(index)}`;
        const encoded = MysqlColumns.unique(
          filter.values.map((value) => MysqlColumns.encodeValue(value)),
        );
        joins.push(this.filter(alias, filter.column, encoded));
      }
      for (const [index, sort] of sorts.entries()) {
        if (sort.column === "id") continue;
        const alias = `s${String(index)}`;
        joins.push({
          sql: `INNER JOIN ${columnsTable} AS ${alias}
         ON ${alias}.scope_key = r.scope_key AND ${alias}.tenant_key = r.tenant_key
        AND ${alias}.slot_key = r.slot_key AND ${alias}.column_name = ?`,
          values: [MysqlColumns.encodeName(sort.column)],
        });
      }

      const where: SqlClause[] = [
        { sql: "r.scope_key = ?", values: [scope] },
        { sql: "r.tenant_key = ?", values: [tenant] },
      ];
      if (ids.length > 0) {
        where.push({ sql: `r.slot_key IN (${this.placeholders(ids.length)})`, values: ids });
      }
      for (const filter of filterValues) {
        if (filter.column !== "id") continue;
        const encoded = filter.values.map((value) =>
          CanonicalMysqlValues.encode(value, slotKeyBytes),
        );
        where.push({
          sql: `r.slot_key IN (${this.placeholders(encoded.length)})`,
          values: encoded,
        });
      }
      const continuation = this.continuation(query, sorts);
      if (continuation !== undefined) {
        where.push(continuation);
      }
      const order = [
        ...sorts.map((sort, index) =>
          sort.column === "id"
            ? `r.slot_key ${sort.direction}`
            : `s${String(index)}.value_kind ${sort.direction}, s${String(index)}.value_data ${sort.direction}`,
        ),
        "r.slot_key ASC",
      ];
      let window: SqlClause = { sql: "", values: [] };
      if (query.limit !== undefined) {
        window = { sql: " LIMIT ?", values: [query.limit] };
        if (query.offset !== undefined) {
          window = { sql: " LIMIT ? OFFSET ?", values: [query.limit, query.offset] };
        }
      } else if (query.offset !== undefined) {
        window = { sql: " LIMIT 18446744073709551615 OFFSET ?", values: [query.offset] };
      }
      const values = [
        ...joins.flatMap((clause) => clause.values),
        ...where.flatMap((clause) => clause.values),
        ...window.values,
      ];
      if (values.length > maxQueryBinds) {
        throw new MysqlStorageConfigurationError(
          `MySQL queries support at most ${String(maxQueryBinds)} bound values.`,
        );
      }
      return {
        sql: `SELECT r.slot_key, r.payload FROM ${recordsTable} AS r
${joins.map((clause) => clause.sql).join("\n")}
WHERE ${where.map((clause) => clause.sql).join(" AND ")}
ORDER BY ${order.join(", ")}${window.sql}`,
        values,
      };
    }

    plan<I>(plan: NormalizedQueryPlan<I>, scope: Uint8Array, tenant: Uint8Array): CompiledQuery {
      const comparisons = this.comparisons(plan.predicate);
      const joins: SqlClause[] = comparisons.map((comparison, index) => ({
        sql: `LEFT JOIN ${columnsTable} AS p${String(index)}
       ON p${String(index)}.scope_key = r.scope_key AND p${String(index)}.tenant_key = r.tenant_key
      AND p${String(index)}.slot_key = r.slot_key AND p${String(index)}.column_name = ?`,
        values: [MysqlColumns.encodeName(comparison.column)],
      }));
      for (const [index, order] of (plan.order ?? []).entries()) {
        joins.push({
          sql: `LEFT JOIN ${columnsTable} AS s${String(index)}
       ON s${String(index)}.scope_key = r.scope_key AND s${String(index)}.tenant_key = r.tenant_key
      AND s${String(index)}.slot_key = r.slot_key AND s${String(index)}.column_name = ?`,
          values: [MysqlColumns.encodeName(order.column)],
        });
      }
      const where: SqlClause[] = [
        { sql: "r.scope_key = ?", values: [scope] },
        { sql: "r.tenant_key = ?", values: [tenant] },
      ];
      if (plan.predicate !== undefined) {
        where.push(this.predicate(plan.predicate, comparisons));
      }
      const order = [
        ...(plan.order ?? []).flatMap((item, index) => {
          const direction = item.direction === "desc" ? "DESC" : "ASC";
          return [
            `s${String(index)}.value_kind ${direction}`,
            `s${String(index)}.value_data ${direction}`,
          ];
        }),
        "r.slot_key ASC",
      ];
      const materializationLimit =
        plan.candidateLimit === undefined ? plan.limit : plan.candidateLimit + 1;
      const window: SqlClause =
        materializationLimit === undefined
          ? { sql: "", values: [] }
          : { sql: " LIMIT ?", values: [materializationLimit] };
      const values = [
        ...joins.flatMap((clause) => clause.values),
        ...where.flatMap((clause) => clause.values),
        ...window.values,
      ];
      if (values.length > maxQueryBinds) {
        throw new MysqlStorageConfigurationError(
          `MySQL queries support at most ${String(maxQueryBinds)} bound values.`,
        );
      }
      return {
        sql: `SELECT r.slot_key, r.payload FROM ${recordsTable} AS r
${joins.map((clause) => clause.sql).join("\n")}
WHERE ${where.map((clause) => clause.sql).join(" AND ")}
ORDER BY ${order.join(", ")}${window.sql}`,
        values,
      };
    }

    comparisons<I>(
      predicate: NormalizedQueryPredicate<I> | undefined,
    ): readonly Extract<NormalizedQueryPredicate<I>, { readonly kind: "comparison" }>[] {
      if (predicate === undefined || predicate.kind === "ids") return [];
      if (predicate.kind === "comparison") return [predicate];
      return predicate.predicates.flatMap((child) => this.comparisons(child));
    }

    predicate<I>(
      predicate: NormalizedQueryPredicate<I>,
      comparisons: readonly Extract<NormalizedQueryPredicate<I>, { readonly kind: "comparison" }>[],
    ): SqlClause {
      if (predicate.kind === "ids") {
        const ids = predicate.ids.map((id) => CanonicalMysqlValues.encode(id, slotKeyBytes));
        return { sql: `r.slot_key IN (${this.placeholders(ids.length)})`, values: ids };
      }
      if (predicate.kind === "comparison") {
        const index = comparisons.indexOf(predicate);
        const alias = `p${String(index)}`;
        const encoded = MysqlColumns.encodeValue(predicate.value);
        if (predicate.operator === "equal") {
          return {
            sql: `(${alias}.value_kind = ? AND ${alias}.value_data = ?)`,
            values: [encoded.kind, encoded.data],
          };
        }
        const comparison =
          predicate.operator === "greaterThan"
            ? ">"
            : predicate.operator === "greaterOrEqual"
              ? ">="
              : predicate.operator === "lessThan"
                ? "<"
                : "<=";
        return {
          sql: `(${alias}.value_kind = ? AND ${alias}.value_data ${comparison} ?)`,
          values: [encoded.kind, encoded.data],
        };
      }
      const children = predicate.predicates.map((child) => this.predicate(child, comparisons));
      return {
        sql: `(${children.map((child) => child.sql).join(predicate.kind === "either" ? " OR " : " AND ")})`,
        values: children.flatMap((child) => child.values),
      };
    }

    validate<I>(query: RecordQuery<I>): void {
      const filters = query.filters ?? [];
      if (filters.length > maxQueryFilters) {
        throw new MysqlStorageConfigurationError(
          `MySQL queries support at most ${String(maxQueryFilters)} filters.`,
        );
      }
      for (const filter of filters) {
        if (Array.isArray(filter.value) && filter.value.length > maxFilterValues) {
          throw new MysqlStorageConfigurationError(
            `MySQL query filters support at most ${String(maxFilterValues)} values.`,
          );
        }
      }
      if ((query.ids?.length ?? 0) > maxQueryIds) {
        throw new MysqlStorageConfigurationError(
          `MySQL queries support at most ${String(maxQueryIds)} IDs.`,
        );
      }
      if ((query.sort?.length ?? 0) > maxQuerySorts) {
        throw new MysqlStorageConfigurationError(
          `MySQL queries support at most ${String(maxQuerySorts)} sort fields.`,
        );
      }
    }

    column(column: string): string {
      if (column === "id") return column;
      if (column.trim().length === 0 || column.includes(".")) {
        throw new MysqlStorageConfigurationError(
          "MySQL queries require a materialized column or id.",
        );
      }
      MysqlColumns.encodeName(column);
      return column;
    }

    filter(
      alias: string,
      column: string,
      values: readonly { readonly data: Uint8Array; readonly kind: number }[],
    ): SqlClause {
      const groups = MysqlColumns.group(values);
      return {
        sql: `INNER JOIN ${columnsTable} AS ${alias}
     ON ${alias}.scope_key = r.scope_key AND ${alias}.tenant_key = r.tenant_key
    AND ${alias}.slot_key = r.slot_key AND ${alias}.column_name = ?
    AND (${groups
      .map(
        (group) =>
          `${alias}.value_kind = ? AND ${alias}.value_data IN (${this.placeholders(group.length)})`,
      )
      .join(" OR ")})`,
        values: [
          MysqlColumns.encodeName(column),
          ...groups.flatMap((group) => [group[0]?.kind, ...group.map((value) => value.data)]),
        ],
      };
    }

    continuation<I>(
      query: RecordQuery<I>,
      sorts: readonly { readonly column: string; readonly direction: "ASC" | "DESC" }[],
    ): CompiledQuery | undefined {
      const after = query.after;
      if (after === undefined) return undefined;
      const comparisons: string[] = [];
      const values: unknown[] = [];
      const equal: string[] = [];
      for (const [index, sort] of sorts.entries()) {
        const value = after.values[index]?.value;
        const before = this.equality(sorts.slice(0, index), after);
        if (sort.column === "id") {
          comparisons.push(
            [...equal, `r.slot_key ${sort.direction === "ASC" ? ">" : "<"} ?`].join(" AND "),
          );
          values.push(...before, CanonicalMysqlValues.encode(value, slotKeyBytes));
          equal.push("r.slot_key = ?");
          continue;
        }
        const encoded = MysqlColumns.encodeValue(value);
        const alias = `s${String(index)}`;
        const comparison = sort.direction === "ASC" ? ">" : "<";
        comparisons.push(
          [
            ...equal,
            `(${alias}.value_kind ${comparison} ? OR ` +
              `(${alias}.value_kind = ? AND ${alias}.value_data ${comparison} ?))`,
          ].join(" AND "),
        );
        values.push(...before, encoded.kind, encoded.kind, encoded.data);
        equal.push(`${alias}.value_kind = ? AND ${alias}.value_data = ?`);
      }
      comparisons.push([...equal, "r.slot_key > ?"].join(" AND "));
      values.push(
        ...this.equality(sorts, after),
        CanonicalMysqlValues.encode(after.id, slotKeyBytes),
      );
      return {
        sql: `(${comparisons.map((comparison) => `(${comparison})`).join(" OR ")})`,
        values,
      };
    }

    equality(
      sorts: readonly { readonly column: string }[],
      after: NonNullable<RecordQuery<unknown>["after"]>,
    ): readonly unknown[] {
      return sorts.flatMap((sort, index) => {
        const value = after.values[index]?.value;
        if (sort.column === "id") return [CanonicalMysqlValues.encode(value, slotKeyBytes)];
        const encoded = MysqlColumns.encodeValue(value);
        return [encoded.kind, encoded.data];
      });
    }

    placeholders(count: number): string {
      return Array.from({ length: count }, () => "?").join(", ");
    }
  })(),
);

/**
 * Validates MySQL storage connection options.
 */
const MysqlOptions = Object.freeze(
  new (class {
    validate(options: MysqlStorageOptions): URL {
      let url: URL;
      try {
        url = new URL(options.url);
      } catch {
        throw new MysqlStorageConfigurationError(
          "MysqlStorageOptions.url must be a valid MySQL URL.",
        );
      }

      if (
        url.protocol !== "mysql:" ||
        url.pathname === "/" ||
        url.search.length > 0 ||
        url.hash.length > 0
      ) {
        throw new MysqlStorageConfigurationError(
          "MysqlStorageOptions.url must use mysql:, name a database, and omit query/hash settings.",
        );
      }
      if (
        options.connectionLimit !== undefined &&
        (!Number.isInteger(options.connectionLimit) || options.connectionLimit <= 0)
      ) {
        throw new MysqlStorageConfigurationError(
          "MysqlStorageOptions.connectionLimit must be positive.",
        );
      }
      if (
        options.connectTimeoutMs !== undefined &&
        (!Number.isInteger(options.connectTimeoutMs) || options.connectTimeoutMs <= 0)
      ) {
        throw new MysqlStorageConfigurationError(
          "MysqlStorageOptions.connectTimeoutMs must be positive.",
        );
      }
      return url;
    }
  })(),
);

/**
 * Verifies the fixed MySQL record-storage schema.
 */
const RecordSchemaVerification = Object.freeze(
  new (class {
    async verify(connection: PoolConnection): Promise<void> {
      const [rows] = await connection.query<SchemaColumn[]>(
        `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
            COLUMN_TYPE AS column_type, COLUMN_DEFAULT AS column_default,
            IS_NULLABLE AS is_nullable
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name IN ('spine_ts_records', 'spine_ts_columns')`,
      );
      const actualColumns = new Map(
        rows.map((row) => [`${row.table_name}.${row.column_name}`, row]),
      );

      for (const [column, expectedType] of expectedColumns) {
        const actual = actualColumns.get(column);
        if (actual?.column_type !== expectedType || actual.is_nullable !== expectedNullability) {
          throw new MysqlStorageSchemaError(`MySQL adapter schema is incompatible at ${column}.`);
        }
      }
      if (actualColumns.size !== expectedColumns.size) {
        throw new MysqlStorageSchemaError("MySQL adapter schema has unexpected columns.");
      }
      if (
        actualColumns.get("spine_ts_records.schema_version")?.column_default !==
        String(schemaVersion)
      ) {
        throw new MysqlStorageSchemaError("MySQL adapter schema version is incompatible.");
      }
      const [tables] = await connection.query<SchemaTable[]>(
        `SELECT TABLE_NAME AS table_name, ENGINE AS engine
     FROM information_schema.tables
     WHERE table_schema = DATABASE()
       AND table_name IN ('spine_ts_records', 'spine_ts_columns')`,
      );
      if (tables.length !== 2 || tables.some((table) => table.engine?.toLowerCase() !== "innodb")) {
        throw new MysqlStorageSchemaError("MySQL adapter tables must use InnoDB.");
      }
      await this.indexes(connection);
      await this.foreignKey(connection);
    }

    async indexes(connection: PoolConnection): Promise<void> {
      const [rows] = await connection.query<SchemaIndex[]>(
        `SELECT TABLE_NAME AS table_name, INDEX_NAME AS index_name,
            SEQ_IN_INDEX AS seq_in_index, COLUMN_NAME AS column_name
     FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name IN ('spine_ts_records', 'spine_ts_columns')
     ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`,
      );
      const actualIndexes = new Map<string, string[]>();
      for (const row of rows) {
        const key = `${row.table_name}.${row.index_name}`;
        const columns = actualIndexes.get(key) ?? [];
        if (row.seq_in_index !== columns.length + 1) {
          throw new MysqlStorageSchemaError(`MySQL adapter index is incompatible at ${key}.`);
        }
        columns.push(row.column_name);
        actualIndexes.set(key, columns);
      }
      if (actualIndexes.size !== expectedIndexes.size) {
        throw new MysqlStorageSchemaError("MySQL adapter schema has unexpected indexes.");
      }
      for (const [index, expectedColumnsForIndex] of expectedIndexes) {
        if (!this.sameColumns(actualIndexes.get(index), expectedColumnsForIndex)) {
          throw new MysqlStorageSchemaError(`MySQL adapter index is incompatible at ${index}.`);
        }
      }
    }

    async foreignKey(connection: PoolConnection): Promise<void> {
      const [rows] = await connection.query<SchemaForeignKey[]>(
        `SELECT kcu.TABLE_NAME AS table_name, kcu.CONSTRAINT_NAME AS constraint_name,
            kcu.ORDINAL_POSITION AS ordinal_position, kcu.COLUMN_NAME AS column_name,
            kcu.REFERENCED_TABLE_NAME AS referenced_table_name,
            kcu.REFERENCED_COLUMN_NAME AS referenced_column_name, rc.DELETE_RULE AS delete_rule
     FROM information_schema.key_column_usage AS kcu
     INNER JOIN information_schema.referential_constraints AS rc
       ON rc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
      AND rc.TABLE_NAME = kcu.TABLE_NAME
      AND rc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
     WHERE kcu.CONSTRAINT_SCHEMA = DATABASE()
       AND kcu.TABLE_NAME = 'spine_ts_columns'
       AND kcu.CONSTRAINT_NAME = 'spine_ts_columns_record_fk'
     ORDER BY kcu.ORDINAL_POSITION`,
      );
      if (
        rows.length !== expectedForeignKey.length ||
        rows.some(
          (row, index) =>
            row.table_name !== "spine_ts_columns" ||
            row.constraint_name !== "spine_ts_columns_record_fk" ||
            row.ordinal_position !== index + 1 ||
            row.column_name !== expectedForeignKey[index] ||
            row.referenced_table_name !== "spine_ts_records" ||
            row.referenced_column_name !== expectedForeignKey[index] ||
            row.delete_rule.toUpperCase() !== "CASCADE",
        )
      ) {
        throw new MysqlStorageSchemaError("MySQL adapter foreign key is incompatible.");
      }
    }

    sameColumns(actual: readonly string[] | undefined, expected: readonly string[]): boolean {
      return (
        actual?.length === expected.length &&
        actual.every((column, index) => column === expected[index])
      );
    }
  })(),
);

interface SchemaColumn extends RowDataPacket {
  readonly table_name: string;
  readonly column_name: string;
  readonly column_type: string;
  readonly column_default: string | null;
  readonly is_nullable: string;
  readonly extra: string;
}

interface SchemaTable extends RowDataPacket {
  readonly table_name: string;
  readonly engine: string | null;
}

interface SchemaIndex extends RowDataPacket {
  readonly table_name: string;
  readonly index_name: string;
  readonly seq_in_index: number;
  readonly column_name: string;
  readonly non_unique: number;
  readonly collation: string | null;
}

interface SchemaForeignKey extends RowDataPacket {
  readonly table_name: string;
  readonly constraint_name: string;
  readonly ordinal_position: number;
  readonly column_name: string;
  readonly referenced_table_name: string;
  readonly referenced_column_name: string;
  readonly delete_rule: string;
}
