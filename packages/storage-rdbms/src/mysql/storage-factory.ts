import { createPool, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import type { Message } from "@bufbuild/protobuf";
import {
  RecordStorage,
  StorageFactory,
  type RecordEntry,
  type RecordQuery,
  type RecordSpec,
  type StorageContext,
} from "@spine-ts/storage";

const recordsTable = "`spine_ts_records`";
const columnsTable = "`spine_ts_columns`";
const schemaVersion = 1;

const createRecordsTable = `
CREATE TABLE IF NOT EXISTS ${recordsTable} (
  scope_key VARBINARY(768) NOT NULL,
  tenant_key VARBINARY(768) NOT NULL,
  slot_key VARBINARY(768) NOT NULL,
  payload MEDIUMBLOB NOT NULL,
  revision BIGINT UNSIGNED NOT NULL DEFAULT 0,
  schema_version SMALLINT UNSIGNED NOT NULL DEFAULT ${String(schemaVersion)},
  PRIMARY KEY (scope_key, tenant_key, slot_key)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`;

const createColumnsTable = `
CREATE TABLE IF NOT EXISTS ${columnsTable} (
  scope_key VARBINARY(768) NOT NULL,
  tenant_key VARBINARY(768) NOT NULL,
  slot_key VARBINARY(768) NOT NULL,
  column_name VARBINARY(768) NOT NULL,
  value_kind TINYINT UNSIGNED NOT NULL,
  value_data MEDIUMBLOB NULL,
  PRIMARY KEY (scope_key, tenant_key, slot_key, column_name),
  INDEX spine_ts_columns_lookup (scope_key, tenant_key, column_name, value_kind)
) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`;

const expectedColumns = new Map<string, string>([
  ["spine_ts_records.scope_key", "varbinary(768)"],
  ["spine_ts_records.tenant_key", "varbinary(768)"],
  ["spine_ts_records.slot_key", "varbinary(768)"],
  ["spine_ts_records.payload", "mediumblob"],
  ["spine_ts_records.revision", "bigint unsigned"],
  ["spine_ts_records.schema_version", "smallint unsigned"],
  ["spine_ts_columns.scope_key", "varbinary(768)"],
  ["spine_ts_columns.tenant_key", "varbinary(768)"],
  ["spine_ts_columns.slot_key", "varbinary(768)"],
  ["spine_ts_columns.column_name", "varbinary(768)"],
  ["spine_ts_columns.value_kind", "tinyint unsigned"],
  ["spine_ts_columns.value_data", "mediumblob"],
]);

/** Explicit connection and pool settings for the owned MySQL adapter pool. */
export interface MysqlStorageOptions {
  /** Complete MySQL connection URL, including an explicit database name. */
  readonly url: string;
  /** Maximum simultaneous pool connections. */
  readonly connectionLimit?: number;
  /** Milliseconds allowed to establish a new connection. */
  readonly connectTimeoutMs?: number;
  /** TLS material and verification policy supplied without exposing driver settings. */
  readonly tls?: {
    readonly ca?: string;
    readonly cert?: string;
    readonly key?: string;
    readonly rejectUnauthorized?: boolean;
  };
}

/** Thrown when the adapter cannot safely use the supplied MySQL configuration. */
export class MysqlStorageConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MysqlStorageConfigurationError";
  }
}

/** Thrown when MySQL cannot be connected or initialized without exposing provider details. */
export class MysqlStorageConnectionError extends Error {
  constructor() {
    super("MySQL storage could not connect or initialize.");
    this.name = "MysqlStorageConnectionError";
  }
}

/** Thrown when fixed adapter-owned tables do not have the required shape. */
export class MysqlStorageSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MysqlStorageSchemaError";
  }
}

/** MySQL-backed factory that owns its connection pool and private normalized schema. */
export class MysqlStorageFactory extends StorageFactory {
  readonly #pool: Pool;
  readonly #handles = new Set<MysqlRecordStorage<unknown, Message>>();
  #closePromise: Promise<void> | undefined;

  private constructor(pool: Pool) {
    super();
    this.#pool = pool;
  }

  /** Connects, creates or verifies the fixed schema, and returns a ready-to-use factory. */
  static async create(options: MysqlStorageOptions): Promise<MysqlStorageFactory> {
    const url = validateOptions(options);
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
    const factory = new MysqlStorageFactory(pool);

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

  /** Closes the owned pool once; every repeated call observes the same completion. */
  // eslint-disable-next-line @typescript-eslint/no-misused-promises -- TypeScript allows this async lifecycle override.
  override close(): Promise<void> {
    this.#closePromise ??= this.closePool();
    return this.#closePromise;
  }

  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    recordSpec: RecordSpec<I, R>,
  ): RecordStorage<I, R> {
    const handle = new MysqlRecordStorage(context, recordSpec);
    this.#handles.add(handle);
    return handle;
  }

  private async initialize(): Promise<void> {
    const connection = await this.#pool.getConnection();
    try {
      await connection.query(createRecordsTable);
      await connection.query(createColumnsTable);
      await verifySchema(connection);
    } finally {
      connection.release();
    }
  }

  private async closePool(): Promise<void> {
    super.close();
    for (const handle of this.#handles) {
      handle.close();
    }
    await this.#pool.end();
  }
}

class MysqlRecordStorage<I, R extends Message> extends RecordStorage<I, R> {
  protected deleteRecord(): Promise<boolean> {
    return unavailable();
  }

  protected queryRecordEntries(query: RecordQuery<I>): Promise<readonly RecordEntry<I, R>[]> {
    void query;
    return unavailable();
  }

  protected readRecord(): Promise<R | undefined> {
    return unavailable();
  }

  protected compareAndSetRecord(): Promise<boolean> {
    return unavailable();
  }

  protected writeAllRecords(): Promise<void> {
    return unavailable();
  }

  protected writeRecord(): Promise<void> {
    return unavailable();
  }
}

function validateOptions(options: MysqlStorageOptions): URL {
  let url: URL;
  try {
    url = new URL(options.url);
  } catch {
    throw new MysqlStorageConfigurationError("MysqlStorageOptions.url must be a valid MySQL URL.");
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

async function verifySchema(connection: PoolConnection): Promise<void> {
  const [rows] = await connection.query<SchemaColumn[]>(
    `SELECT TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
            COLUMN_TYPE AS column_type, COLUMN_DEFAULT AS column_default
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name IN ('spine_ts_records', 'spine_ts_columns')`,
  );
  const actualColumns = new Map(rows.map((row) => [`${row.table_name}.${row.column_name}`, row]));

  for (const [column, expectedType] of expectedColumns) {
    if (actualColumns.get(column)?.column_type !== expectedType) {
      throw new MysqlStorageSchemaError(`MySQL adapter schema is incompatible at ${column}.`);
    }
  }
  if (actualColumns.size !== expectedColumns.size) {
    throw new MysqlStorageSchemaError("MySQL adapter schema has unexpected columns.");
  }
  if (
    actualColumns.get("spine_ts_records.schema_version")?.column_default !== String(schemaVersion)
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
}

interface SchemaColumn extends RowDataPacket {
  readonly table_name: string;
  readonly column_name: string;
  readonly column_type: string;
  readonly column_default: string | null;
}

interface SchemaTable extends RowDataPacket {
  readonly table_name: string;
  readonly engine: string | null;
}

function unavailable<T>(): Promise<T> {
  return Promise.reject(new Error("MySQL record operations are not available until Packet 2."));
}
