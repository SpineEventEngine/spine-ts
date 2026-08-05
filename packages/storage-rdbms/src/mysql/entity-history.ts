import { clone, create, fromBinary, toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { TimestampSchema, type Timestamp } from "@bufbuild/protobuf/wkt";
import { EventIdSchema, EventSchema, type Event } from "@spine-event-engine/proto";
import type {
  EntityEventHistoryPort,
  EntityEventHistoryRecord,
  EntityRecord,
  EntityRecordStorage,
  EntityStateHistoryPort,
  EntityStateHistoryRecord,
  EntityStorageInput,
} from "@spine-event-engine/storage/internal/entity-history";
import type {
  EntityCommitInput,
  EntityCommitResult,
  EntityCommitStorage,
} from "@spine-event-engine/storage/internal/entity-commit";
import {
  StorageQueryEvaluator,
  StorageQueryPolicy,
  type NormalizedQueryPlan,
} from "@spine-event-engine/storage";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { createHash } from "node:crypto";

import { CanonicalMysqlValues, SortableMysqlColumnValue } from "./value-codec.js";
import {
  MysqlStorageDataError,
  MysqlStorageOperationError,
  MysqlStorageSchemaError,
} from "./storage-factory.js";

const scopeBytes = 512;
const idBytes = 768;
const batchSize = 128;
const recordScopeBytes = 512;
const tenantBytes = 255;
const recordSlotBytes = 768;
const columnBytes = 255;
interface EntityColumnSchema {
  readonly name: string;

  /**
   * The INFORMATION_SCHEMA type expected after MySQL normalizes the DDL.
   */
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
  // prettier-ignore

  /**
   * Whether all generated columns are non-nullable.
   */
  readonly columnNullable: boolean;

  /**
   * Names the required MySQL table engine.
   */
  readonly engine: string;

  /**
   * Describes the durable entity-history tables.
   */
  readonly tables: readonly EntityTableSchema[];
}

/**
 * Describes the immutable MySQL entity-history schema contract.
 */
export const entityHistorySchema: EntityHistorySchema = {
  // prettier-ignore

  /**
   * Keeps all durable entity-history columns non-nullable.
   */
  columnNullable: false,

  /**
   * Requires MySQL's transactional InnoDB engine.
   */
  engine: "InnoDB",

  /**
   * Defines the durable entity-history table layouts.
   */
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
      name: "spine_ts_entity_commits",
      columns: [
        { name: "scope_key", mysqlType: "varbinary(512)", ddlType: "VARBINARY(512)" },
        { name: "entity_key", mysqlType: "varbinary(768)", ddlType: "VARBINARY(768)" },
        { name: "commit_key", mysqlType: "varbinary(768)", ddlType: "VARBINARY(768)" },
        { name: "digest", mysqlType: "binary(32)", ddlType: "BINARY(32)" },
      ],
      indexes: [
        {
          name: "PRIMARY",
          columns: [{ name: "scope_key" }, { name: "entity_key" }, { name: "commit_key" }],
          primary: true,
        },
      ],
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

const EntityHistoryTables = Object.freeze({
  create(table: EntityTableSchema): string {
    const definitions = [
      ...table.columns.map(EntityHistoryTables.column),
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
  },
  column(column: EntityColumnSchema): string {
    const nullability = entityHistorySchema.columnNullable ? "" : " NOT NULL";
    const generation = column.autoIncrement === true ? " AUTO_INCREMENT" : "";
    return `${column.name} ${column.ddlType}${nullability}${generation}`;
  },
});
const tables = entityHistorySchema.tables.map(EntityHistoryTables.create);

/**
 * A factory-owned, lifecycle-admitted entity connection lease seam.
 */
export interface MysqlEntityConnectionProvider {
  // prettier-ignore

  /**
   * Acquires an admitted MySQL connection lease.
   * @returns A connection lease.
   */
  acquire(): Promise<PoolConnection>;

  /**
   * Clears a successful or failed connection lease.
   * @param connection The lease to release.
   */
  release(connection: PoolConnection): void;

  /**
   * Removes an unusable connection lease.
   * @param connection The lease to destroy.
   */
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
  // prettier-ignore

  /**
   * Stores current entity records.
   */
  readonly current: EntityRecordStorage<I, S>;

  /**
   * Stores state history records.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Stores event history records.
   */
  readonly events: EntityEventHistoryPort<I>;

  /**
   * Closes this storage handle.
   */
  close(): void;

  /**
   * Determines whether this handle remains open.
   * @returns Whether the handle is open.
   */
  isOpen(): boolean;
}

/**
 * Provider-neutral-shaped MySQL implementation; only the MySQL dialect is supplied today.
 */
export class MysqlEntityStorage<I, S extends Message> implements MysqlEntityStorageHandle<I, S> {
  // prettier-ignore

  /**
   * Stores current entity records.
   */
  readonly current: EntityRecordStorage<I, S>;

  /**
   * Stores state history records.
   */
  readonly states: EntityStateHistoryPort<I, S>;

  /**
   * Stores event history records.
   */
  readonly events: EntityEventHistoryPort<I>;
  #open = true;
  #schemaReady: Promise<void> | undefined;

  /**
   * Creates an independently closeable entity-history handle.
   * @param input The entity storage contract.
   * @param connections The factory-owned lease provider.
   * @param database The MySQL database name for lock isolation.
   * @param verifySchema The schema verification operation.
   * @param onClose The factory callback that forgets this handle.
   */
  constructor(
    private readonly input: EntityStorageInput<I, S>,
    private readonly connections: MysqlEntityConnectionProvider,
    private readonly database: string,
    private readonly verifySchema: (connection: PoolConnection) => Promise<void>,
    private readonly onClose: () => void,
  ) {
    const scope = EntityValues.scope(input);
    this.current = {
      read: async (id) => this.readCurrent(scope, id),
      write: async (record) => this.writeCurrent(scope, record),
      query: async (plan) => this.queryCurrent(scope, plan),
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

  /**
   * Closes this handle and unregisters it from its factory.
   */
  close(): void {
    if (this.#open) {
      this.#open = false;
      this.onClose();
    }
  }

  /**
   * Determines whether this handle remains open.
   * @returns Whether the handle is open.
   */
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
      if (rows.length !== 1 || !EntityValues.same(rows[0]?.fingerprint, fingerprint))
        throw new Error("Entity storage has an incompatible record specification.");
    } catch (error) {
      failure =
        error instanceof MysqlStorageSchemaError ||
        (error instanceof Error &&
          error.message === "Entity storage has an incompatible record specification.")
          ? error
          : EntityErrors.operation();
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
      failure = error instanceof MysqlStorageSchemaError ? error : EntityErrors.operation();
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
        [scope, EntityValues.key(this.input, id)],
      );
      const x = r[0];
      return x === undefined
        ? undefined
        : {
            id: this.input.id.clone(id),
            state: EntityValues.decode(this.input.stateSchema, x.payload),
            version: BigInt(x.version),
            archived: Boolean(x.archived),
            deleted: Boolean(x.deleted),
          };
    } catch (error) {
      failure = error instanceof MysqlStorageDataError ? error : EntityErrors.operation();
      throw failure;
    } finally {
      if (c !== undefined) this.release(c, failure);
    }
  }
  private async writeCurrent(scope: Uint8Array, r: EntityRecord<I, S>): Promise<void> {
    EntityInputs.signed64(r.version, "Current record version");
    EntityValues.key(this.input, r.id);
    if (this.input.id.key(r.id) !== this.input.id.key(this.input.extractId(r.state))) {
      throw new MysqlStorageDataError();
    }
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
          EntityValues.key(this.input, r.id),
          toBinary(this.input.stateSchema, r.state),
          r.version,
          r.archived,
          r.deleted,
        ],
      );
    } catch {
      throw EntityErrors.operation();
    }
  }
  private async queryCurrent(scope: Uint8Array, plan: NormalizedQueryPlan<I>) {
    StorageQueryPolicy.validate(plan, {
      comparisons: ["equal", "greaterThan", "lessThan", "greaterOrEqual", "lessOrEqual"],
      features: ["either", "nested", "order", "mask", "limit"],
    });
    const candidateLimit = plan.candidateLimit ?? 10_000;
    await this.ready(scope);
    let c: PoolConnection | undefined;
    let failure: unknown;
    try {
      c = await this.connections.acquire();
      const [rows] = await c.execute<CurrentRow[]>(
        `SELECT entity_key,payload,version,archived,deleted
         FROM spine_ts_entity_current WHERE scope_key=? AND deleted=0 LIMIT ${String(candidateLimit + 1)}`,
        [scope],
      );
      if (rows.length > candidateLimit)
        throw new Error(`Storage query exceeded the candidate limit of ${String(candidateLimit)}.`);
      return StorageQueryEvaluator.evaluate(
        rows.map((row) => {
          const state = EntityValues.decode(this.input.stateSchema, row.payload);
          const id = this.input.id.clone(this.input.extractId(state));
          if (!EntityValues.same(row.entity_key, EntityValues.key(this.input, id)))
            throw new MysqlStorageDataError();
          const record = Object.freeze({
            id: this.input.id.clone(id),
            state: Object.freeze(state),
            version: BigInt(row.version),
            archived: Boolean(row.archived),
            deleted: Boolean(row.deleted),
          });
          return {
            id,
            record,
            columns: new Map<string, unknown>([
              ...this.input.columns.map((column) => [column.name, column.valueIn(state)] as const),
              ["version", record.version],
              ["archived", record.archived],
              ["deleted", record.deleted],
            ]),
          };
        }),
        plan,
      );
    } catch (error) {
      failure = error instanceof MysqlStorageDataError ? error : EntityErrors.operation();
      throw failure;
    } finally {
      if (c !== undefined) this.release(c, failure);
    }
  }
  private async appendState(scope: Uint8Array, r: EntityStateHistoryRecord<I, S>): Promise<void> {
    EntityInputs.signed64(r.version, "State-history version");
    EntityInputs.timestamp(r.createdAt);
    EntityValues.key(this.input, r.entityId);
    await this.ready(scope);
    const payload = toBinary(this.input.stateSchema, r.state),
      entity = EntityValues.key(this.input, r.entityId);
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
        if (!EntityErrors.duplicate(error)) throw error;
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
          !EntityValues.same(x.payload, payload)
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
          : EntityErrors.operation();
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
    EntityInputs.depth(depth);
    await this.ready(scope);
    let c: PoolConnection | undefined;
    let failure: unknown;
    try {
      c = await this.connections.acquire();
      const [r] = await c.execute<StateRow[]>(
        `SELECT version,seconds,nanos,payload FROM spine_ts_entity_states
         WHERE scope_key=? AND entity_key=? ${from === undefined ? "" : "AND version < ?"}
         ORDER BY version DESC, seconds DESC, nanos DESC LIMIT ${String(depth)}`,
        from === undefined
          ? [scope, EntityValues.key(this.input, id)]
          : [scope, EntityValues.key(this.input, id), from],
      );
      return Object.freeze(
        r.map((x) =>
          Object.freeze({
            entityId: this.input.id.clone(id),
            state: Object.freeze(EntityValues.decode(this.input.stateSchema, x.payload)),
            version: BigInt(x.version),
            createdAt: Object.freeze(
              create(TimestampSchema, { seconds: BigInt(x.seconds), nanos: x.nanos }),
            ),
          }),
        ),
      );
    } catch (error) {
      failure =
        error instanceof MysqlStorageDataError || EntityErrors.closed(error)
          ? error
          : EntityErrors.operation();
      throw failure;
    } finally {
      if (c !== undefined) this.release(c, failure);
    }
  }
  private async stateAt(scope: Uint8Array, id: I, at: Timestamp): Promise<S | undefined> {
    EntityInputs.timestamp(at);
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
        [scope, EntityValues.key(this.input, id), at.seconds, at.seconds, at.nanos],
      );
      return r[0] === undefined
        ? undefined
        : Object.freeze(EntityValues.decode(this.input.stateSchema, r[0].payload));
    } catch (error) {
      failure =
        error instanceof MysqlStorageDataError || EntityErrors.closed(error)
          ? error
          : EntityErrors.operation();
      throw failure;
    } finally {
      if (c !== undefined) this.release(c, failure);
    }
  }
  private async trim(scope: Uint8Array, id: I, keep: number): Promise<void> {
    if (!Number.isSafeInteger(keep) || keep < 0)
      throw new Error("State-history trim count must be a non-negative safe integer.");
    await this.ready(scope);
    const entity = EntityValues.key(this.input, id);
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
          failure = EntityErrors.operation();
          throw failure;
        } finally {
          // A close after the commit intentionally prevents the next bounded chunk.
        }
      }
    } catch (error) {
      failure = EntityErrors.closed(error) ? error : EntityErrors.operation();
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
    EntityInputs.signed64(r.producerVersion, "Event-history producer version");
    EntityInputs.timestamp(r.createdAt);
    EntityValues.key(this.input, r.entityId);
    await this.ready(scope);
    const payload = toBinary(EventSchema, r.event),
      eventKey = new TextEncoder().encode(eventId),
      entity = EntityValues.key(this.input, r.entityId);
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
      if (!EntityErrors.duplicate(error)) throw EntityErrors.operation();
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
          !EntityValues.same(x.entity_key, entity) ||
          BigInt(x.producer_version) !== r.producerVersion ||
          BigInt(x.seconds) !== r.createdAt.seconds ||
          x.nanos !== r.createdAt.nanos ||
          !EntityValues.same(x.payload, payload)
        )
          throw new Error("Event-history retry has divergent content.");
      } catch (reconciliationError) {
        if (
          reconciliationError instanceof Error &&
          reconciliationError.message === "Event-history retry has divergent content."
        )
          failure = reconciliationError;
        else failure = EntityErrors.operation();
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
    EntityInputs.depth(depth);
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
        from === undefined
          ? [scope, EntityValues.key(this.input, id)]
          : [scope, EntityValues.key(this.input, id), from],
      );
      return Object.freeze(
        r.map((x) => Object.freeze(EntityValues.decode(EventSchema, x.payload))),
      );
    } catch (error) {
      failure =
        error instanceof MysqlStorageDataError || EntityErrors.closed(error)
          ? error
          : EntityErrors.operation();
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
    EntityInputs.timestamp(at);
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
      highWaterFailure = EntityErrors.closed(error) ? error : EntityErrors.operation();
      throw highWaterFailure;
    } finally {
      if (highWaterLease !== undefined) this.release(highWaterLease, highWaterFailure);
    }
    if (highWater === undefined) return;
    const cutoff = EntityValues.writeOrder(highWater.write_order);
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
        failure = EntityErrors.operation();
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
      throw EntityErrors.operation();
    }
  }

  private async acquireEntityLock(
    c: PoolConnection,
    scope: Uint8Array,
    entity: Uint8Array,
  ): Promise<void> {
    const [rows] = await c.execute<LockRow[]>(
      "SELECT GET_LOCK(?, @@SESSION.innodb_lock_wait_timeout) AS acquired",
      [this.lockName(scope, entity)],
    );
    if (rows.length !== 1 || Number(rows[0]?.acquired) !== 1) throw EntityErrors.operation();
  }

  private async releaseEntityLock(
    c: PoolConnection,
    scope: Uint8Array,
    entity: Uint8Array,
    priorFailure?: unknown,
  ): Promise<boolean> {
    try {
      const [rows] = await c.execute<LockRow[]>("SELECT RELEASE_LOCK(?) AS released", [
        this.lockName(scope, entity),
      ]);
      if (rows.length !== 1 || Number(rows[0]?.released) !== 1) throw new Error();
      return false;
    } catch {
      try {
        this.connections.destroy(c);
      } catch {
        if (priorFailure !== undefined) return true;
        throw EntityErrors.operation();
      }
      return true;
    }
  }
  private lockName(scope: Uint8Array, entity: Uint8Array): string {
    const hash = createHash("sha256")
      .update(this.database)
      .update("\0")
      .update(scope)
      .update("\0")
      .update(entity)
      .digest("hex");
    return `spine_ts_${hash.slice(0, 55)}`;
  }
}

/**
 * Applies complete Entity commits in one InnoDB transaction.
 */
export class MysqlEntityCommitStorage implements EntityCommitStorage {
  #open = true;
  #schemaReady: Promise<void> | undefined;

  /**
   * Creates an independently closeable atomic commit handle.
   *
   * @param input The Entity storage contract owned by this handle.
   * @param connections The factory-owned connection lease provider.
   * @param verifySchema Verifies the fixed MySQL Entity schema.
   * @param onClose Removes this handle from its owning factory.
   */
  constructor(
    private readonly input: EntityStorageInput<unknown, Message>,
    private readonly connections: MysqlEntityConnectionProvider,
    private readonly verifySchema: (connection: PoolConnection) => Promise<void>,
    private readonly onClose: () => void,
  ) {}

  /**
   * Applies current state, configured histories, and delivery events atomically.
   *
   * @param input The complete framework-owned Entity commit.
   * @returns The durable commit, replay, or optimistic-conflict outcome.
   */
  async commit<I, S extends Message>(input: EntityCommitInput<I, S>): Promise<EntityCommitResult> {
    this.requireCompatible(input);
    this.preflight(input);
    await this.ready();
    const scope = EntityValues.scope(input.entity);
    const entity = EntityValues.key(input.entity, input.entityId);
    const commitKey = CanonicalMysqlValues.encode(input.id, idBytes);
    const digest = MysqlCommitValues.digest(input);
    let connection: PoolConnection | undefined;
    let transactionStarted = false;
    try {
      connection = await this.connections.acquire();
      await connection.beginTransaction();
      transactionStarted = true;
      const current = await MysqlCommitValues.readCurrent(connection, input, scope, entity);
      const receipt = await MysqlCommitValues.readReceipt(connection, scope, entity, commitKey);
      if (receipt !== undefined) {
        if (!EntityValues.same(receipt, digest)) {
          throw new Error("Entity commit ID was reused with different content.");
        }
        await connection.rollback();
        transactionStarted = false;
        return "replayed";
      }
      if (!MysqlCommitValues.sameCurrent(current, input.expected, input.entity.stateSchema)) {
        await connection.rollback();
        transactionStarted = false;
        return "conflict";
      }
      await MysqlCommitValues.writeCurrent(connection, input, scope, entity);
      await MysqlCommitValues.writeStates(connection, input, scope);
      await MysqlCommitValues.writeDiagnostics(connection, input, scope);
      await MysqlCommitValues.writeDelivery(connection, input);
      await connection.execute(
        `INSERT INTO spine_ts_entity_commits
           (scope_key,entity_key,commit_key,digest) VALUES (?,?,?,?)`,
        [scope, entity, commitKey, digest],
      );
      await connection.commit();
      transactionStarted = false;
      return "committed";
    } catch (error) {
      if (transactionStarted) await connection?.rollback().catch(() => undefined);
      if (connection !== undefined && (await this.receiptMatches(input, digest))) {
        return "committed";
      }
      if (
        error instanceof Error &&
        error.message === "Entity commit ID was reused with different content."
      ) {
        throw error;
      }
      throw new MysqlStorageOperationError();
    } finally {
      if (connection !== undefined) this.connections.release(connection);
    }
  }

  /**
   * Closes this commit handle without closing sibling handles.
   */
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.onClose();
  }

  private async ready(): Promise<void> {
    this.requireOpen();
    this.#schemaReady ??= (async () => {
      let connection: PoolConnection | undefined;
      try {
        connection = await this.connections.acquire();
        for (const sql of tables) await connection.query(sql);
        await this.verifySchema(connection);
      } finally {
        if (connection !== undefined) this.connections.release(connection);
      }
    })();
    await this.#schemaReady;
  }

  private async receiptMatches<I, S extends Message>(
    input: EntityCommitInput<I, S>,
    digest: Uint8Array,
  ): Promise<boolean> {
    let connection: PoolConnection | undefined;
    try {
      connection = await this.connections.acquire();
      const receipt = await MysqlCommitValues.readReceipt(
        connection,
        EntityValues.scope(input.entity),
        EntityValues.key(input.entity, input.entityId),
        CanonicalMysqlValues.encode(input.id, idBytes),
        false,
      );
      return receipt !== undefined && EntityValues.same(receipt, digest);
    } catch {
      return false;
    } finally {
      if (connection !== undefined) this.connections.release(connection);
    }
  }

  private requireCompatible<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    this.requireOpen();
    if (
      input.context.name !== this.input.context.name ||
      input.context.multitenant !== this.input.context.multitenant ||
      input.context.tenantId !== this.input.context.tenantId ||
      input.entity.storageKey !== this.input.storageKey
    ) {
      throw new Error("Entity commit handle cannot commit another Entity storage scope.");
    }
  }

  private preflight<I, S extends Message>(input: EntityCommitInput<I, S>): void {
    if (input.id.trim() === "") throw new Error("Entity commit requires a non-blank ID.");
    EntityInputs.signed64(input.next.version, "Current record version");
    const eventIds = (input.events ?? []).map((event) => event.id?.value);
    if (eventIds.some((id) => id === undefined || id.trim() === "")) {
      throw new Error("Entity commit requires delivery events with non-empty IDs.");
    }
    if (new Set(eventIds).size !== eventIds.length) {
      throw new Error("Entity commit requires unique delivery-event IDs.");
    }
  }

  private requireOpen(): void {
    if (!this.#open) throw new Error("Entity commit storage is closed.");
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
  entity_key: Uint8Array;
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
interface CommitRow extends RowDataPacket {
  digest: Uint8Array;
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
const EntityValues = Object.freeze({
  scope<I, S extends Message>(i: EntityStorageInput<I, S>): Uint8Array {
    if (i.layout.trim() === "" || i.id.fingerprint.trim() === "")
      throw new Error("Entity storage requires non-blank layout and ID codec fingerprints.");
    const tenant = i.context.multitenant ? i.context.tenantId : undefined;
    if (i.context.multitenant && (tenant === undefined || tenant.trim() === ""))
      throw new Error("Multitenant storage requires context.tenantId.");
    return CanonicalMysqlValues.encode(
      [i.context.name, i.context.multitenant ? tenant : "single-tenant", i.storageKey],
      scopeBytes,
    );
  },
  key<I, S extends Message>(i: EntityStorageInput<I, S>, id: I): Uint8Array {
    return CanonicalMysqlValues.encode(i.id.key(id), idBytes);
  },
  decode<S extends Message>(schema: GenMessage<S>, payload: Uint8Array): S {
    try {
      return clone(schema, fromBinary(schema, payload, { readUnknownFields: false }));
    } catch {
      throw new MysqlStorageDataError();
    }
  },
  same(a: Uint8Array | undefined, b: Uint8Array): boolean {
    return a?.length === b.length && a.every((x, i) => x === b[i]);
  },
  writeOrder(value: string | bigint | number): bigint {
    try {
      const order = BigInt(value);
      if (order <= 0n) throw new Error();
      return order;
    } catch {
      throw new MysqlStorageDataError();
    }
  },
});
const MysqlCommitValues = Object.freeze({
  digest<I, S extends Message>(input: EntityCommitInput<I, S>): Uint8Array {
    const record = (value: EntityRecord<I, S> | undefined) =>
      value === undefined
        ? undefined
        : {
            state: [...toBinary(input.entity.stateSchema, value.state)],
            version: value.version.toString(),
            archived: value.archived,
            deleted: value.deleted,
          };
    return new Uint8Array(
      createHash("sha256")
        .update(
          JSON.stringify({
            context: input.context,
            id: input.id,
            entityId: input.entity.id.key(input.entityId),
            expected: record(input.expected),
            next: record(input.next),
            states: (input.states ?? []).map((row) => ({
              entityId: input.entity.id.key(row.entityId),
              state: [...toBinary(input.entity.stateSchema, row.state)],
              version: row.version.toString(),
              createdAt: [row.createdAt.seconds.toString(), row.createdAt.nanos],
            })),
            diagnostics: (input.diagnostics ?? []).map((row) => ({
              entityId: input.entity.id.key(row.entityId),
              event: [...toBinary(EventSchema, row.event)],
              producerVersion: row.producerVersion.toString(),
              createdAt: [row.createdAt.seconds.toString(), row.createdAt.nanos],
            })),
            events: (input.events ?? []).map((event) => [...toBinary(EventSchema, event)]),
          }),
        )
        .digest(),
    );
  },

  async readCurrent<I, S extends Message>(
    connection: PoolConnection,
    input: EntityCommitInput<I, S>,
    scope: Uint8Array,
    entity: Uint8Array,
  ): Promise<EntityRecord<I, S> | undefined> {
    const [rows] = await connection.execute<CurrentRow[]>(
      `SELECT payload,version,archived,deleted FROM spine_ts_entity_current
       WHERE scope_key=? AND entity_key=? FOR UPDATE`,
      [scope, entity],
    );
    const row = rows[0];
    return row === undefined
      ? undefined
      : {
          id: input.entity.id.clone(input.entityId),
          state: EntityValues.decode(input.entity.stateSchema, row.payload),
          version: BigInt(row.version),
          archived: Boolean(row.archived),
          deleted: Boolean(row.deleted),
        };
  },

  async readReceipt(
    connection: PoolConnection,
    scope: Uint8Array,
    entity: Uint8Array,
    commitKey: Uint8Array,
    lock = true,
  ): Promise<Uint8Array | undefined> {
    const [rows] = await connection.execute<CommitRow[]>(
      `SELECT digest FROM spine_ts_entity_commits
       WHERE scope_key=? AND entity_key=? AND commit_key=?${lock ? " FOR UPDATE" : ""}`,
      [scope, entity, commitKey],
    );
    return rows[0]?.digest;
  },

  sameCurrent<I, S extends Message>(
    actual: EntityRecord<I, S> | undefined,
    expected: EntityRecord<I, S> | undefined,
    schema: GenMessage<S>,
  ): boolean {
    if (actual === undefined || expected === undefined) return actual === expected;
    return (
      actual.version === expected.version &&
      actual.archived === expected.archived &&
      actual.deleted === expected.deleted &&
      EntityValues.same(toBinary(schema, actual.state), toBinary(schema, expected.state))
    );
  },

  async writeCurrent<I, S extends Message>(
    connection: PoolConnection,
    input: EntityCommitInput<I, S>,
    scope: Uint8Array,
    entity: Uint8Array,
  ): Promise<void> {
    await connection.execute(
      `INSERT INTO spine_ts_entity_current
         (scope_key,entity_key,payload,version,archived,deleted) VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE payload=VALUES(payload),version=VALUES(version),
         archived=VALUES(archived),deleted=VALUES(deleted)`,
      [
        scope,
        entity,
        toBinary(input.entity.stateSchema, input.next.state),
        input.next.version,
        input.next.archived,
        input.next.deleted,
      ],
    );
  },

  async writeStates<I, S extends Message>(
    connection: PoolConnection,
    input: EntityCommitInput<I, S>,
    scope: Uint8Array,
  ): Promise<void> {
    for (const row of input.states ?? []) {
      EntityInputs.signed64(row.version, "State-history version");
      EntityInputs.timestamp(row.createdAt);
      await connection.execute(
        `INSERT INTO spine_ts_entity_states
           (scope_key,entity_key,version,seconds,nanos,payload) VALUES (?,?,?,?,?,?)`,
        [
          scope,
          EntityValues.key(input.entity, row.entityId),
          row.version,
          row.createdAt.seconds,
          row.createdAt.nanos,
          toBinary(input.entity.stateSchema, row.state),
        ],
      );
    }
  },

  async writeDiagnostics<I, S extends Message>(
    connection: PoolConnection,
    input: EntityCommitInput<I, S>,
    scope: Uint8Array,
  ): Promise<void> {
    for (const row of input.diagnostics ?? []) {
      const id = row.event.id?.value;
      if (id === undefined || id.trim() === "")
        throw new Error("Event history requires an event ID.");
      EntityInputs.signed64(row.producerVersion, "Event-history producer version");
      EntityInputs.timestamp(row.createdAt);
      await connection.execute(
        `INSERT INTO spine_ts_entity_events
           (scope_key,event_key,entity_key,producer_version,seconds,nanos,payload)
         VALUES (?,?,?,?,?,?,?)`,
        [
          scope,
          new TextEncoder().encode(id),
          EntityValues.key(input.entity, row.entityId),
          row.producerVersion,
          row.createdAt.seconds,
          row.createdAt.nanos,
          toBinary(EventSchema, row.event),
        ],
      );
    }
  },

  async writeDelivery<I, S extends Message>(
    connection: PoolConnection,
    input: EntityCommitInput<I, S>,
  ): Promise<void> {
    const scope = CanonicalMysqlValues.encode(
      [input.context.name, input.context.multitenant, "spine.core.Event:event-store"],
      recordScopeBytes,
    );
    const tenant = CanonicalMysqlValues.encode(
      input.context.multitenant ? input.context.tenantId : null,
      tenantBytes,
    );
    for (const event of input.events ?? []) {
      const id = event.id?.value;
      if (id === undefined) throw new Error("Entity commit requires delivery event IDs.");
      const slot = CanonicalMysqlValues.encode(
        create(EventIdSchema, { value: id }),
        recordSlotBytes,
      );
      await connection.execute(
        `INSERT INTO spine_ts_records (scope_key,tenant_key,slot_key,payload) VALUES (?,?,?,?)`,
        [scope, tenant, slot, toBinary(EventSchema, event)],
      );
      const values = [
        ["timestamp", event.context?.timestamp?.seconds ?? 0n],
        ["typeUrl", event.message?.typeUrl],
      ] as const;
      for (const [name, value] of values) {
        const encoded = SortableMysqlColumnValue.encode(value);
        await connection.execute(
          `INSERT INTO spine_ts_columns
             (scope_key,tenant_key,slot_key,column_name,value_kind,value_data)
           VALUES (?,?,?,?,?,?)`,
          [
            scope,
            tenant,
            slot,
            CanonicalMysqlValues.encode(name, columnBytes),
            encoded.kind,
            encoded.data,
          ],
        );
      }
    }
  },
});

const EntityInputs = Object.freeze({
  depth(depth: number): void {
    if (!Number.isSafeInteger(depth) || depth <= 0)
      throw new Error("History depth must be a positive safe integer.");
  },
  signed64(value: bigint, name: string): void {
    if (value < -(1n << 63n) || value > (1n << 63n) - 1n)
      throw new Error(`${name} must be a signed 64-bit integer.`);
  },
  timestamp(value: Timestamp): void {
    EntityInputs.signed64(value.seconds, "Timestamp seconds");
    if (!Number.isInteger(value.nanos) || value.nanos < 0 || value.nanos > 999_999_999)
      throw new Error("Timestamp nanos must be an integer from 0 through 999999999.");
  },
});
const EntityErrors = Object.freeze({
  duplicate(error: unknown): boolean {
    return (
      typeof error === "object" && error !== null && Reflect.get(error, "code") === "ER_DUP_ENTRY"
    );
  },
  closed(error: unknown): boolean {
    return error instanceof Error && error.message === "Entity history storage is closed.";
  },
  operation(): Error {
    return new MysqlStorageOperationError();
  },
});
