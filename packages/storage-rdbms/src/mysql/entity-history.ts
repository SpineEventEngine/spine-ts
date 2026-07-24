import { clone, create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { EventSchema, type Event } from "@spine-event-engine/proto";
import type {
  EntityEventHistoryPort,
  EntityEventHistoryRecord,
  EntityRecord,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStateHistoryRecord,
  EntityStorageInput,
} from "@spine-event-engine/storage/internal/entity-history";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";

import { CanonicalMysqlValue } from "./value-codec.js";
import {
  MysqlStorageDataError,
  MysqlStorageOperationError,
  MysqlStorageSchemaError,
} from "./storage-factory.js";

const scopeBytes = 512;
const idBytes = 768;
const batchSize = 128;
interface EntityColumnSchema {
  readonly name: string;
  /** The INFORMATION_SCHEMA type expected after MySQL normalizes the DDL. */
  readonly mysqlType: string;
  readonly ddlType: string;
  readonly autoIncrement?: boolean;
}

interface EntityIndexColumnSchema {
  readonly name: string;
  readonly direction?: "ASC" | "DESC";
}

interface EntityIndexSchema {
  readonly name: string;
  readonly columns: readonly EntityIndexColumnSchema[];
  readonly primary?: boolean;
  readonly unique?: boolean;
}

interface EntityTableSchema {
  readonly name: string;
  readonly columns: readonly EntityColumnSchema[];
  readonly indexes: readonly EntityIndexSchema[];
}

interface EntityHistorySchema {
  readonly columnNullable: boolean;
  readonly engine: string;
  readonly tables: readonly EntityTableSchema[];
}

export const entityHistorySchema: EntityHistorySchema = {
  columnNullable: false,
  engine: "InnoDB",
  tables: [
    {
      name: "spine_ts_entity_specs",
      columns: [
        { name: "scope_key", mysqlType: "varbinary(512)", ddlType: "VARBINARY(512)" },
        { name: "fingerprint", mysqlType: "varbinary(1024)", ddlType: "VARBINARY(1024)" },
      ],
      indexes: [{ name: "PRIMARY", columns: [{ name: "scope_key" }], primary: true }],
    },
    {
      name: "spine_ts_entity_current",
      columns: [
        { name: "scope_key", mysqlType: "varbinary(512)", ddlType: "VARBINARY(512)" },
        { name: "entity_key", mysqlType: "varbinary(768)", ddlType: "VARBINARY(768)" },
        { name: "payload", mysqlType: "mediumblob", ddlType: "MEDIUMBLOB" },
        { name: "version", mysqlType: "bigint", ddlType: "BIGINT" },
        { name: "archived", mysqlType: "tinyint(1)", ddlType: "BOOLEAN" },
        { name: "deleted", mysqlType: "tinyint(1)", ddlType: "BOOLEAN" },
      ],
      indexes: [
        {
          name: "PRIMARY",
          columns: [{ name: "scope_key" }, { name: "entity_key" }],
          primary: true,
        },
      ],
    },
    {
      name: "spine_ts_entity_states",
      columns: [
        { name: "scope_key", mysqlType: "varbinary(512)", ddlType: "VARBINARY(512)" },
        { name: "entity_key", mysqlType: "varbinary(768)", ddlType: "VARBINARY(768)" },
        { name: "version", mysqlType: "bigint", ddlType: "BIGINT" },
        {
          name: "write_order",
          mysqlType: "bigint unsigned",
          ddlType: "BIGINT UNSIGNED",
          autoIncrement: true,
        },
        { name: "seconds", mysqlType: "bigint", ddlType: "BIGINT" },
        { name: "nanos", mysqlType: "int", ddlType: "INT" },
        { name: "payload", mysqlType: "mediumblob", ddlType: "MEDIUMBLOB" },
      ],
      indexes: [
        {
          name: "PRIMARY",
          columns: [{ name: "scope_key" }, { name: "entity_key" }, { name: "version" }],
          primary: true,
        },
        {
          name: "spine_ts_entity_states_trim",
          columns: [{ name: "scope_key" }, { name: "entity_key" }, { name: "version" }],
        },
        {
          name: "spine_ts_entity_states_write_order",
          columns: [{ name: "write_order" }],
          unique: true,
        },
      ],
    },
    {
      name: "spine_ts_entity_events",
      columns: [
        { name: "scope_key", mysqlType: "varbinary(512)", ddlType: "VARBINARY(512)" },
        { name: "event_key", mysqlType: "varbinary(768)", ddlType: "VARBINARY(768)" },
        { name: "entity_key", mysqlType: "varbinary(768)", ddlType: "VARBINARY(768)" },
        { name: "producer_version", mysqlType: "bigint", ddlType: "BIGINT" },
        {
          name: "write_order",
          mysqlType: "bigint unsigned",
          ddlType: "BIGINT UNSIGNED",
          autoIncrement: true,
        },
        { name: "seconds", mysqlType: "bigint", ddlType: "BIGINT" },
        { name: "nanos", mysqlType: "int", ddlType: "INT" },
        { name: "payload", mysqlType: "mediumblob", ddlType: "MEDIUMBLOB" },
      ],
      indexes: [
        {
          name: "PRIMARY",
          columns: [{ name: "scope_key" }, { name: "event_key" }],
          primary: true,
        },
        {
          name: "spine_ts_entity_events_read",
          columns: [
            { name: "scope_key" },
            { name: "entity_key" },
            { name: "producer_version", direction: "DESC" },
            { name: "seconds", direction: "DESC" },
            { name: "nanos", direction: "DESC" },
            { name: "event_key", direction: "DESC" },
          ],
        },
        {
          name: "spine_ts_entity_events_write_order",
          columns: [{ name: "write_order" }],
          unique: true,
        },
      ],
    },
  ],
};

const tables = entityHistorySchema.tables.map(createEntityHistoryTable);

function createEntityHistoryTable(table: EntityTableSchema): string {
  const definitions = [
    ...table.columns.map(entityColumnDefinition),
    ...table.indexes.map((index) => {
      const columns = index.columns
        .map((column) => `${column.name}${column.direction === "DESC" ? " DESC" : ""}`)
        .join(", ");
      if (index.primary === true) {
        return `PRIMARY KEY (${columns})`;
      }
      return `${index.unique === true ? "UNIQUE " : ""}INDEX ${index.name} (${columns})`;
    }),
  ].join(",\n     ");
  return `CREATE TABLE IF NOT EXISTS ${table.name} (\n     ${definitions}\n   ) ENGINE=${entityHistorySchema.engine}`;
}

function entityColumnDefinition(column: EntityColumnSchema): string {
  const nullability = entityHistorySchema.columnNullable ? "" : " NOT NULL";
  const generation = column.autoIncrement === true ? " AUTO_INCREMENT" : "";
  return `${column.name} ${column.ddlType}${nullability}${generation}`;
}

/** A factory-owned, lifecycle-admitted entity connection lease seam. */
export interface MysqlEntityConnectionProvider {
  acquire(): Promise<PoolConnection>;
  release(connection: PoolConnection): void;
  destroy(connection: PoolConnection): void;
}

/**
 * Provider/framework-owned current/state/event history bundle.
 *
 * It is independently closeable: client code that receives this internal seam
 * must close it when done, while the owning `MysqlStorageFactory` closes every
 * live handle during factory shutdown. It is not a remote history API.
 */
export interface MysqlEntityStorageHandle<I, S extends Message> {
  readonly current: EntityRecordStorage<I, S>;
  readonly states: EntityStateHistoryPort<I, S>;
  readonly events: EntityEventHistoryPort<I>;
  close(): void;
  isOpen(): boolean;
}

/** Provider-neutral-shaped MySQL implementation; only the MySQL dialect is supplied today. */
export class MysqlEntityStorage<I, S extends Message> implements MysqlEntityStorageHandle<I, S> {
  readonly current: EntityRecordStorage<I, S>;
  readonly states: EntityStateHistoryPort<I, S>;
  readonly events: EntityEventHistoryPort<I>;
  #open = true;
  #schemaReady: Promise<void> | undefined;

  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly connections: MysqlEntityConnectionProvider,
    private readonly database: string,
    private readonly verifySchema: (connection: PoolConnection) => Promise<void>,
    private readonly onClose: () => void,
  ) {
    const scope = scopeFor(input);
    this.current = {
      read: async (id) => this.readCurrent(scope, id),
      write: async (record) => this.writeCurrent(scope, record),
    };
    this.states = {
      append: async (record) => this.appendState(scope, record),
      backward: async (id, depth, from) => this.backwardStates(scope, id, depth, from),
      stateAt: async (id, at) => this.stateAt(scope, id, at),
      trim: async (id, keep) => this.trim(scope, id, keep),
      truncate: async (olderThan) => this.truncateStates(scope, olderThan),
    };
    this.events = {
      append: async (record) => this.appendEvent(scope, record),
      backward: async (id, depth, from) => this.backwardEvents(scope, id, depth, from),
      truncate: async (olderThan) => this.truncateEvents(scope, olderThan),
    };
  }

  close(): void {
    if (this.#open) {
      this.#open = false;
      this.onClose();
    }
  }

  isOpen(): boolean {
    return this.#open;
  }

  private async ready(scope: Uint8Array): Promise<void> {
    this.requireOpen();
    this.#schemaReady ??= this.createSchema();
    let c: PoolConnection | undefined;
    let failure: unknown;
    try {
      await this.#schemaReady;
      const fingerprint = new TextEncoder().encode(
        JSON.stringify({
          id: this.input.id.fingerprint,
          layout: this.input.layout,
          state: this.input.stateSchema.typeName,
        }),
      );
      c = await this.connections.acquire();
      await c.execute(
        "INSERT IGNORE INTO spine_ts_entity_specs (scope_key, fingerprint) VALUES (?, ?)",
        [scope, fingerprint],
      );
      const [rows] = await c.execute<SpecRow[]>(
        "SELECT fingerprint FROM spine_ts_entity_specs WHERE scope_key = ?",
        [scope],
      );
      if (rows.length !== 1 || !same(rows[0]?.fingerprint, fingerprint))
        throw new Error("Entity storage has an incompatible record specification.");
    } catch (error) {
      failure =
        error instanceof MysqlStorageSchemaError ||
        (error instanceof Error &&
          error.message === "Entity storage has an incompatible record specification.")
          ? error
          : operationError();
      throw failure;
    } finally {
      if (c !== undefined) this.release(c, failure);
    }
  }
  private async createSchema(): Promise<void> {
    let c: PoolConnection | undefined;
    let failure: unknown;
    try {
      c = await this.connections.acquire();
      for (const sql of tables) await c.query(sql);
      await this.verifySchema(c);
    } catch (error) {
      failure = error instanceof MysqlStorageSchemaError ? error : operationError();
      throw failure;
    } finally {
      if (c !== undefined) this.release(c, failure);
    }
  }
  private async readCurrent(scope: Uint8Array, id: I): Promise<EntityRecord<I, S> | undefined> {
    await this.ready(scope);
    let c: PoolConnection | undefined;
    let failure: unknown;
    try {
      c = await this.connections.acquire();
      const [r] = await c.execute<CurrentRow[]>(
        "SELECT payload, version, archived, deleted FROM spine_ts_entity_current WHERE scope_key=? AND entity_key=?",
        [scope, key(this.input, id)],
      );
      const x = r[0];
      return x === undefined
        ? undefined
        : {
            id: this.input.id.clone(id),
            state: decode(this.input.stateSchema, x.payload),
            version: BigInt(x.version),
            archived: Boolean(x.archived),
            deleted: Boolean(x.deleted),
          };
    } catch (error) {
      failure = error instanceof MysqlStorageDataError ? error : operationError();
      throw failure;
    } finally {
      if (c !== undefined) this.release(c, failure);
    }
  }
  private async writeCurrent(scope: Uint8Array, r: EntityRecord<I, S>): Promise<void> {
    signed64(r.version, "Current record version");
    key(this.input, r.id);
    await this.ready(scope);
    try {
      await this.exec(
        `INSERT INTO spine_ts_entity_current
           (scope_key,entity_key,payload,version,archived,deleted)
         VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE
           payload=VALUES(payload), version=VALUES(version),
           archived=VALUES(archived), deleted=VALUES(deleted)`,
        [
          scope,
          key(this.input, r.id),
          toBinary(this.input.stateSchema, r.state),
          r.version,
          r.archived,
          r.deleted,
        ],
      );
    } catch {
      throw operationError();
    }
  }
  private async appendState(scope: Uint8Array, r: EntityStateHistoryRecord<I, S>): Promise<void> {
    signed64(r.version, "State-history version");
    timestamp(r.createdAt);
    key(this.input, r.entityId);
    await this.ready(scope);
    const payload = toBinary(this.input.stateSchema, r.state),
      entity = key(this.input, r.entityId);
    let c: PoolConnection | undefined;
    let locked = false;
    let destroyed = false;
    let failure: unknown;
    try {
      c = await this.connections.acquire();
      await this.acquireEntityLock(c, scope, entity);
      locked = true;
      this.requireOpen();
      await c.beginTransaction();
      try {
        await c.execute(
          `INSERT INTO spine_ts_entity_states
             (scope_key,entity_key,version,seconds,nanos,payload)
           VALUES (?,?,?,?,?,?)`,
          [scope, entity, r.version, r.createdAt.seconds, r.createdAt.nanos, payload],
        );
      } catch (error) {
        if (!isDuplicate(error)) throw error;
        const [rows] = await c.execute<StateRow[]>(
          `SELECT seconds,nanos,payload FROM spine_ts_entity_states
           WHERE scope_key=? AND entity_key=? AND version=? FOR UPDATE`,
          [scope, entity, r.version],
        );
        const x = rows[0];
        if (
          x === undefined ||
          BigInt(x.seconds) !== r.createdAt.seconds ||
          x.nanos !== r.createdAt.nanos ||
          !same(x.payload, payload)
        )
          throw new Error("State-history retry has divergent content.");
      }
      await c.commit();
    } catch (error) {
      await c?.rollback().catch(() => undefined);
      failure =
        error instanceof Error &&
        (error.message === "State-history retry has divergent content." ||
          error.message === "Entity history storage is closed.")
          ? error
          : operationError();
      throw failure;
    } finally {
      if (c !== undefined && locked)
        destroyed = await this.releaseEntityLock(c, scope, entity, failure);
      if (c !== undefined && !destroyed) this.release(c, failure);
    }
  }
  private async backwardStates(
    scope: Uint8Array,
    id: I,
    depth: number,
    from?: bigint,
  ): Promise<readonly EntityStateHistoryRecord<I, S>[]> {
    depthCheck(depth);
    await this.ready(scope);
    let c: PoolConnection | undefined;
    let failure: unknown;
    try {
      c = await this.connections.acquire();
      const [r] = await c.execute<StateRow[]>(
        `SELECT version,seconds,nanos,payload FROM spine_ts_entity_states
         WHERE scope_key=? AND entity_key=? ${from === undefined ? "" : "AND version < ?"}
         ORDER BY version DESC, seconds DESC, nanos DESC LIMIT ${String(depth)}`,
        from === undefined ? [scope, key(this.input, id)] : [scope, key(this.input, id), from],
      );
      return Object.freeze(
        r.map((x) =>
          Object.freeze({
            entityId: this.input.id.clone(id),
            state: Object.freeze(decode(this.input.stateSchema, x.payload)),
            version: BigInt(x.version),
            createdAt: Object.freeze(
              create(TimestampSchema, { seconds: BigInt(x.seconds), nanos: x.nanos }),
            ),
          }),
        ),
      );
    } catch (error) {
      failure =
        error instanceof MysqlStorageDataError || isClosedError(error) ? error : operationError();
      throw failure;
    } finally {
      if (c !== undefined) this.release(c, failure);
    }
  }
  private async stateAt(scope: Uint8Array, id: I, at: Timestamp): Promise<S | undefined> {
    timestamp(at);
    await this.ready(scope);
    let c: PoolConnection | undefined;
    let failure: unknown;
    try {
      c = await this.connections.acquire();
      const [r] = await c.execute<StateRow[]>(
        `SELECT payload FROM spine_ts_entity_states
         WHERE scope_key=? AND entity_key=?
           AND (seconds < ? OR (seconds=? AND nanos<=?))
         ORDER BY seconds DESC,nanos DESC,version DESC LIMIT 1`,
        [scope, key(this.input, id), at.seconds, at.seconds, at.nanos],
      );
      return r[0] === undefined
        ? undefined
        : Object.freeze(decode(this.input.stateSchema, r[0].payload));
    } catch (error) {
      failure =
        error instanceof MysqlStorageDataError || isClosedError(error) ? error : operationError();
      throw failure;
    } finally {
      if (c !== undefined) this.release(c, failure);
    }
  }
  private async trim(scope: Uint8Array, id: I, keep: number): Promise<void> {
    if (!Number.isSafeInteger(keep) || keep < 0)
      throw new Error("State-history trim count must be a non-negative safe integer.");
    await this.ready(scope);
    const entity = key(this.input, id);
    let c: PoolConnection | undefined;
    let locked = false;
    let destroyed = false;
    let failure: unknown;
    try {
      c = await this.connections.acquire();
      await this.acquireEntityLock(c, scope, entity);
      locked = true;
      for (;;) {
        this.requireOpen();
        let committed = false;
        try {
          await c.beginTransaction();
          const [rows] = await c.execute<KeyRow[]>(
            `SELECT version FROM spine_ts_entity_states
             WHERE scope_key=? AND entity_key=?
             ORDER BY version DESC LIMIT ${String(batchSize)} OFFSET ${String(keep)} FOR UPDATE`,
            [scope, entity],
          );
          if (!rows.length) {
            await c.commit();
            return;
          }
          for (const row of rows)
            await c.execute(
              "DELETE FROM spine_ts_entity_states WHERE scope_key=? AND entity_key=? AND version=?",
              [scope, entity, row.version],
            );
          await c.commit();
          committed = true;
        } catch {
          if (!committed) await c.rollback().catch(() => undefined);
          failure = operationError();
          throw failure;
        } finally {
          // A close after the commit intentionally prevents the next bounded chunk.
        }
      }
    } catch (error) {
      failure = isClosedError(error) ? error : operationError();
      throw failure;
    } finally {
      if (c !== undefined && locked)
        destroyed = await this.releaseEntityLock(c, scope, entity, failure);
      if (c !== undefined && !destroyed) this.release(c, failure);
    }
  }
  private async truncateStates(scope: Uint8Array, at: Timestamp): Promise<void> {
    await this.truncate(scope, at, stateTruncate);
  }
  private async appendEvent(scope: Uint8Array, r: EntityEventHistoryRecord<I>): Promise<void> {
    const eventId = r.event.id?.value;
    if (eventId === undefined || eventId.trim() === "")
      throw new Error("Event history requires an event ID.");
    signed64(r.producerVersion, "Event-history producer version");
    timestamp(r.createdAt);
    key(this.input, r.entityId);
    await this.ready(scope);
    const payload = toBinary(EventSchema, r.event),
      eventKey = new TextEncoder().encode(eventId),
      entity = key(this.input, r.entityId);
    try {
      await this.exec(
        `INSERT INTO spine_ts_entity_events
           (scope_key,event_key,entity_key,producer_version,seconds,nanos,payload)
         VALUES (?,?,?,?,?,?,?)`,
        [
          scope,
          eventKey,
          entity,
          r.producerVersion,
          r.createdAt.seconds,
          r.createdAt.nanos,
          payload,
        ],
      );
    } catch (error) {
      if (!isDuplicate(error)) throw operationError();
      let c: PoolConnection | undefined;
      let failure: unknown;
      try {
        c = await this.connections.acquire();
        const [rows] = await c.execute<EventRetryRow[]>(
          `SELECT entity_key,producer_version,seconds,nanos,payload
           FROM spine_ts_entity_events WHERE scope_key=? AND event_key=?`,
          [scope, eventKey],
        );
        const x = rows[0];
        if (
          x === undefined ||
          !same(x.entity_key, entity) ||
          BigInt(x.producer_version) !== r.producerVersion ||
          BigInt(x.seconds) !== r.createdAt.seconds ||
          x.nanos !== r.createdAt.nanos ||
          !same(x.payload, payload)
        )
          throw new Error("Event-history retry has divergent content.");
      } catch (reconciliationError) {
        if (
          reconciliationError instanceof Error &&
          reconciliationError.message === "Event-history retry has divergent content."
        )
          failure = reconciliationError;
        else failure = operationError();
        throw failure;
      } finally {
        if (c !== undefined) this.release(c, failure);
      }
    }
  }
  private async backwardEvents(
    scope: Uint8Array,
    id: I,
    depth: number,
    from?: bigint,
  ): Promise<readonly Event[]> {
    depthCheck(depth);
    await this.ready(scope);
    let c: PoolConnection | undefined;
    let failure: unknown;
    try {
      c = await this.connections.acquire();
      const [r] = await c.execute<EventRow[]>(
        `SELECT payload FROM spine_ts_entity_events
         WHERE scope_key=? AND entity_key=? ${from === undefined ? "" : "AND producer_version < ?"}
         ORDER BY producer_version DESC,seconds DESC,nanos DESC,event_key DESC
         LIMIT ${String(depth)}`,
        from === undefined ? [scope, key(this.input, id)] : [scope, key(this.input, id), from],
      );
      return Object.freeze(r.map((x) => Object.freeze(decode(EventSchema, x.payload))));
    } catch (error) {
      failure =
        error instanceof MysqlStorageDataError || isClosedError(error) ? error : operationError();
      throw failure;
    } finally {
      if (c !== undefined) this.release(c, failure);
    }
  }
  private async truncateEvents(scope: Uint8Array, at: Timestamp): Promise<void> {
    await this.truncate(scope, at, eventTruncate);
  }
  private async truncate(
    scope: Uint8Array,
    at: Timestamp,
    descriptor: EntityTruncateDescriptor,
  ): Promise<void> {
    timestamp(at);
    await this.ready(scope);
    let highWaterLease: PoolConnection | undefined;
    let highWater: WriteOrderRow | undefined;
    let highWaterFailure: unknown;
    try {
      highWaterLease = await this.connections.acquire();
      const [rows] = await highWaterLease.execute<WriteOrderRow[]>(descriptor.highWaterSql, [
        scope,
        at.seconds,
        at.seconds,
        at.nanos,
      ]);
      highWater = rows[0];
    } catch (error) {
      highWaterFailure = isClosedError(error) ? error : operationError();
      throw highWaterFailure;
    } finally {
      if (highWaterLease !== undefined) this.release(highWaterLease, highWaterFailure);
    }
    if (highWater === undefined) return;
    const cutoff = writeOrder(highWater.write_order);
    for (;;) {
      this.requireOpen();
      let c: PoolConnection | undefined;
      let failure: unknown;
      try {
        c = await this.connections.acquire();
        await c.beginTransaction();
        const [rows] = await c.execute<KeyRow[]>(
          descriptor.chunkSql,
          descriptor.chunkValues(scope, at, cutoff) as Parameters<PoolConnection["execute"]>[1],
        );
        if (!rows.length) {
          await c.commit();
          return;
        }
        for (const row of rows) {
          await c.execute(
            descriptor.deleteSql,
            descriptor.deleteValues(scope, row) as Parameters<PoolConnection["execute"]>[1],
          );
        }
        await c.commit();
      } catch {
        await c?.rollback().catch(() => undefined);
        failure = operationError();
        throw failure;
      } finally {
        if (c !== undefined) this.release(c, failure);
      }
    }
  }
  private async exec(sql: string, values: readonly unknown[]): Promise<void> {
    this.requireOpen();
    const c = await this.connections.acquire();
    try {
      await c.execute(sql, values as Parameters<PoolConnection["execute"]>[1]);
    } finally {
      this.release(c);
    }
  }
  private requireOpen(): void {
    if (!this.#open) throw new Error("Entity history storage is closed.");
  }

  private release(connection: PoolConnection, priorFailure?: unknown): void {
    try {
      this.connections.release(connection);
    } catch {
      if (priorFailure !== undefined) return;
      throw operationError();
    }
  }

  private async acquireEntityLock(
    c: PoolConnection,
    scope: Uint8Array,
    entity: Uint8Array,
  ): Promise<void> {
    const [rows] = await c.execute<LockRow[]>(
      "SELECT GET_LOCK(?, @@SESSION.innodb_lock_wait_timeout) AS acquired",
      [lockName(this.database, scope, entity)],
    );
    if (rows.length !== 1 || Number(rows[0]?.acquired) !== 1) throw operationError();
  }

  private async releaseEntityLock(
    c: PoolConnection,
    scope: Uint8Array,
    entity: Uint8Array,
    priorFailure?: unknown,
  ): Promise<boolean> {
    try {
      const [rows] = await c.execute<LockRow[]>("SELECT RELEASE_LOCK(?) AS released", [
        lockName(this.database, scope, entity),
      ]);
      if (rows.length !== 1 || Number(rows[0]?.released) !== 1) throw new Error();
      return false;
    } catch {
      try {
        this.connections.destroy(c);
      } catch {
        if (priorFailure !== undefined) return true;
        throw operationError();
      }
      return true;
    }
  }
}
interface EntityTruncateDescriptor {
  readonly highWaterSql: string;
  readonly chunkSql: string;
  readonly deleteSql: string;
  chunkValues(scope: Uint8Array, at: Timestamp, cutoff: bigint): readonly unknown[];
  deleteValues(scope: Uint8Array, key: KeyRow): readonly unknown[];
}
const stateTruncate: EntityTruncateDescriptor = {
  highWaterSql: `SELECT write_order FROM spine_ts_entity_states
                 WHERE scope_key=? AND (seconds<? OR (seconds=? AND nanos<?))
                 ORDER BY write_order DESC LIMIT 1`,
  chunkSql: `SELECT entity_key,version FROM spine_ts_entity_states
     WHERE scope_key=? AND (seconds<? OR (seconds=? AND nanos<?))
       AND write_order<=?
     ORDER BY write_order LIMIT ${String(batchSize)}`,
  deleteSql: "DELETE FROM spine_ts_entity_states WHERE scope_key=? AND entity_key=? AND version=?",
  chunkValues: (scope, at, cutoff) => [scope, at.seconds, at.seconds, at.nanos, cutoff],
  deleteValues: (scope, key) => [scope, key.entity_key, key.version],
};
const eventTruncate: EntityTruncateDescriptor = {
  highWaterSql: `SELECT write_order FROM spine_ts_entity_events
                 WHERE scope_key=? AND (seconds<? OR (seconds=? AND nanos<?))
                 ORDER BY write_order DESC LIMIT 1`,
  chunkSql: `SELECT event_key FROM spine_ts_entity_events
     WHERE scope_key=? AND (seconds<? OR (seconds=? AND nanos<?)) AND write_order<=?
     ORDER BY write_order LIMIT ${String(batchSize)}`,
  deleteSql: "DELETE FROM spine_ts_entity_events WHERE scope_key=? AND event_key=?",
  chunkValues: (scope, at, cutoff) => [scope, at.seconds, at.seconds, at.nanos, cutoff],
  deleteValues: (scope, key) => [scope, key.event_key],
};
interface CurrentRow extends RowDataPacket {
  payload: Uint8Array;
  version: string | bigint;
  archived: number;
  deleted: number;
}
interface StateRow extends RowDataPacket {
  payload: Uint8Array;
  seconds: string | bigint;
  nanos: number;
  version: string | bigint;
}
interface EventRow extends RowDataPacket {
  payload: Uint8Array;
}
interface EventRetryRow extends EventRow {
  entity_key: Uint8Array;
  producer_version: string | bigint;
  seconds: string | bigint;
  nanos: number;
}
interface SpecRow extends RowDataPacket {
  fingerprint: Uint8Array;
}
interface KeyRow extends RowDataPacket {
  entity_key: Uint8Array;
  event_key: Uint8Array;
  version: string | bigint;
}
interface WriteOrderRow extends RowDataPacket {
  write_order: string | bigint | number;
}
interface LockRow extends RowDataPacket {
  acquired?: number | null;
  released?: number | null;
}
function scopeFor<I, S extends Message>(i: EntityStorageInput<I, S>): Uint8Array {
  if (i.layout.trim() === "" || i.id.fingerprint.trim() === "")
    throw new Error("Entity storage requires non-blank layout and ID codec fingerprints.");
  const tenant = i.context.multitenant ? i.context.tenantId : undefined;
  if (i.context.multitenant && (tenant === undefined || tenant.trim() === ""))
    throw new Error("Multitenant storage requires context.tenantId.");
  return CanonicalMysqlValue.encode(
    [i.context.name, i.context.multitenant ? tenant : "single-tenant", i.storageKey],
    scopeBytes,
  );
}
function key<I, S extends Message>(i: EntityStorageInput<I, S>, id: I): Uint8Array {
  return CanonicalMysqlValue.encode(i.id.key(id), idBytes);
}
function decode<S extends Message>(schema: GenMessage<S>, payload: Uint8Array): S {
  try {
    return clone(schema, fromBinary(schema, payload, { readUnknownFields: false }));
  } catch {
    throw new MysqlStorageDataError();
  }
}
function same(a: Uint8Array | undefined, b: Uint8Array): boolean {
  return a?.length === b.length && a.every((x, i) => x === b[i]);
}
function depthCheck(depth: number): void {
  if (!Number.isSafeInteger(depth) || depth <= 0)
    throw new Error("History depth must be a positive safe integer.");
}
function signed64(value: bigint, name: string): void {
  if (value < -(1n << 63n) || value > (1n << 63n) - 1n)
    throw new Error(`${name} must be a signed 64-bit integer.`);
}
function timestamp(value: Timestamp): void {
  signed64(value.seconds, "Timestamp seconds");
  if (!Number.isInteger(value.nanos) || value.nanos < 0 || value.nanos > 999_999_999)
    throw new Error("Timestamp nanos must be an integer from 0 through 999999999.");
}
function writeOrder(value: string | bigint | number): bigint {
  try {
    const order = BigInt(value);
    if (order <= 0n) throw new Error();
    return order;
  } catch {
    throw new MysqlStorageDataError();
  }
}
function lockName(database: string, scope: Uint8Array, entity: Uint8Array): string {
  const hash = createHash("sha256")
    .update(database)
    .update("\0")
    .update(scope)
    .update("\0")
    .update(entity)
    .digest("hex");
  // MySQL allows at most 64 characters; the adapter namespace leaves 55 hex
  // characters (220 bits) from SHA-256, which keeps names database-specific.
  return `spine_ts_${hash.slice(0, 55)}`;
}
function isDuplicate(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && Reflect.get(error, "code") === "ER_DUP_ENTRY"
  );
}
function isClosedError(error: unknown): boolean {
  return error instanceof Error && error.message === "Entity history storage is closed.";
}
function operationError(): Error {
  return new MysqlStorageOperationError();
}
