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

import { createPool, type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { toBinary, type Message } from "@bufbuild/protobuf";
import type { GenMessage } from "@bufbuild/protobuf/codegenv2";
import { StringifierRegistry } from "@spine-event-engine/core";
import {
  StorageFactory,
  type RecordStorage,
  type RecordSpec,
  type StorageContext,
  type StorageGroup,
} from "@spine-event-engine/storage";
import { TenantBoundary, type TenantCatalog } from "@spine-event-engine/storage/provider";
import {
  EntityCommitStorageFactories,
  type EntityCommitStorage,
} from "@spine-event-engine/storage/provider";
import { DeliveryCleanupStorageFactories } from "@spine-event-engine/storage/provider";
import type { EntityStorageInput } from "@spine-event-engine/storage/provider";
import { eventStoreRecordSpec } from "@spine-event-engine/storage/provider";
import type { TenantId } from "@spine-event-engine/proto";
import {
  EntityRecordSchema,
  type EntityRecord,
} from "@spine-event-engine/proto/generated/spine/server/entity/entity_pb.js";

import { MysqlRecordStorage, type MysqlRecordLifecycle } from "./record-storage.js";
import { MysqlTableResolver } from "./table-resolver.js";
import { MysqlEntityStorage } from "./entity-history.js";
import { mysqlEntityLockKey, MysqlEntityCommitCoordinator } from "./entity-commit.js";
import { MysqlDeliveryCleanupStorage } from "./delivery-cleanup.js";
import { resolvedMysqlTableSpec, type MysqlTableSpec } from "./table-spec.js";
import { MysqlStorageOperationError, mysqlError } from "./errors.js";

export type { MysqlColumnSpec, MysqlTableSpec } from "./table-spec.js";

/**
 * Configures a MySQL storage connection pool.
 */
export interface MysqlStorageOptions {
  // prettier-ignore

  /**
   * Specifies the MySQL URL, including its database name.
   */
  readonly url: string;

  /**
   * Limits concurrently open pool connections.
   */
  readonly connectionLimit?: number;

  /**
   * Limits connection establishment time in milliseconds.
   */
  readonly connectTimeoutMs?: number;

  /**
   * Configures TLS for pool connections.
   */
  readonly tls?: {
    // prettier-ignore

    /**
     * Provides the certificate authority certificate.
     */
    readonly ca?: string;

    /**
     * Provides the client certificate.
     */
    readonly cert?: string;

    /**
     * Provides the client private key.
     */
    readonly key?: string;

    /**
     * Controls server certificate verification.
     */
    readonly rejectUnauthorized?: boolean;
  };
}

/**
 * Assigns one complete generated tenant to one MySQL database.
 */
export interface MysqlTenantStorageOptions {
  // prettier-ignore

  /**
   * Identifies the tenant that owns the database.
   */
  readonly tenantId: TenantId;

  /**
   * Configures the tenant's MySQL database and pool.
   */
  readonly options: MysqlStorageOptions;
}

/**
 * Describes SQL that creates one resolved record-family table.
 */
export interface MysqlCreateOperation {
  // prettier-ignore

  /**
   * Contains the create-table SQL statement.
   */
  readonly sql: string;
}

/**
 * Creates a create-table operation for one resolved record family.
 *
 * @param table Describes the resolved table layout.
 * @returns Returns the create-table operation.
 */
export type CreateOperationFactory = <I, R extends Message>(
  table: MysqlTableSpec<I, R>,
) => MysqlCreateOperation;

/**
 * Configures and builds a MySQL storage factory.
 */
export interface MysqlStorageFactoryBuilder {
  // prettier-ignore

  /**
   * Sets the MySQL connection options.
   *
   * @param options Specifies the MySQL connection options.
   * @returns Returns this builder.
   */
  setOptions(options: MysqlStorageOptions): this;

  /**
   * Sets the complete multitenant database registry.
   *
   * @param entries Assign generated tenants to distinct physical databases.
   * @returns Returns this builder.
   */
  setTenantOptions(entries: readonly MysqlTenantStorageOptions[]): this;

  /**
   * Sets custom reversible message stringifiers used by IDs and columns.
   *
   * @param registry The schema-bound stringifier registry.
   * @returns Returns this builder.
   */
  setStringifierRegistry(registry: StringifierRegistry): this;

  /**
   * Sets the ungrouped table name for a record-family source type.
   *
   * For Entity current storage, this is the Entity state type, not the stored
   * `EntityRecord` envelope.
   *
   * @param sourceType Identifies the ungrouped family source Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
   */
  setTableName<S extends Message>(sourceType: GenMessage<S>, name: string): this;

  /**
   * Sets the grouped table name for a source and record type.
   *
   * @param sourceType Identifies the source Protobuf type.
   * @param recordType Identifies the record Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
   */
  setTableName<S extends Message, R extends Message>(
    sourceType: GenMessage<S>,
    recordType: GenMessage<R>,
    name: string,
  ): this;

  /**
   * Sets the create-table operation factory.
   *
   * @param factory Creates SQL for resolved record-family tables.
   * @returns Returns this builder.
   */
  useOperationFactory(factory: CreateOperationFactory): this;

  /**
   * Builds an initialized MySQL storage factory.
   *
   * @returns Resolves to the initialized factory.
   */
  build(): Promise<MysqlStorageFactory>;
}

/**
 * Reports invalid MySQL storage configuration.
 */
export class MysqlStorageConfigurationError extends Error {}

/**
 * Reports MySQL connection failures.
 */
export class MysqlStorageConnectionError extends Error {}

/**
 * Reports incompatible MySQL record-family schemas.
 */
export { MysqlStorageSchemaError } from "./errors.js";

/**
 * Reports invalid MySQL storage data.
 */
export { MysqlStorageDataError } from "./errors.js";

/**
 * Reports sanitized MySQL storage operation failures.
 */
export { MysqlStorageOperationError } from "./errors.js";

/**
 * Provides MySQL record-family storage.
 */
export class MysqlStorageFactory extends StorageFactory {
  readonly #handles = new Set<{ close(): void }>();
  readonly #resolver: MysqlTableResolver;
  readonly #databases: ReadonlyMap<string | symbol, MysqlDatabase>;
  readonly #catalog: TenantCatalog;
  #closed: Promise<void> | undefined;
  private constructor(
    databases: readonly MysqlDatabase[],
    resolver = new MysqlTableResolver(),
    private readonly createOperation?: CreateOperationFactory,
    private readonly stringifiers = new StringifierRegistry(),
  ) {
    super();
    this.#resolver = resolver;
    this.#databases = new Map(databases.map((database) => [database.boundary.key, database]));
    this.#catalog = Object.freeze({
      all: () => Promise.resolve(databases.map(({ boundary }) => boundary)),
      close: () => Promise.resolve(),
      keep: (boundary: TenantBoundary) => {
        if (!this.#databases.has(boundary.key)) {
          return Promise.reject(
            new MysqlStorageConfigurationError("MySQL storage has no configured tenant."),
          );
        }
        return Promise.resolve();
      },
    });
    EntityCommitStorageFactories.register(this, {
      createEntityCommitStorage: (input) => this.createEntityCommitStorage(input),
    });
    DeliveryCleanupStorageFactories.register(this, {
      createDeliveryCleanupStorage: () =>
        new MysqlDeliveryCleanupStorage(
          (context, spec) => this.createMysqlRecordStorage(context, spec),
          (context, tables, key, work) => {
            const database = this.database(context);
            return new MysqlEntityCommitCoordinator(this.connections(database)).commit(
              tables,
              key,
              (connection) => work(connection),
              { requireTransaction: true },
            );
          },
          () => "spine-delivery-cleanup",
        ),
    });
  }

  /**
   * Creates a MySQL storage factory builder.
   *
   * @returns Returns a new builder.
   */
  static newBuilder(): MysqlStorageFactoryBuilder {
    return new Builder((entries, resolver, operation, stringifiers) =>
      MysqlStorageFactory.connect(entries, resolver, operation, stringifiers),
    );
  }

  /**
   * Returns the provider-owned configured tenant catalog.
   * @returns The factory-owned tenant catalog.
   */
  tenantCatalog(): TenantCatalog {
    return this.#catalog;
  }

  /**
   * Closes all storage handles and the connection pool.
   */
  override close(): void {
    this.#closed ??= (async () => {
      super.close();
      for (const handle of this.#handles) handle.close();
      await Promise.all([...this.#databases.values()].map(({ pool }) => pool.end()));
    })();
    void this.#closed;
  }

  /**
   * Creates storage for one resolved record family.
   *
   * @param context Provides the storage context.
   * @param spec Describes the record family.
   * @param group Identifies an optional storage group.
   * @returns Returns the record-family storage handle.
   */
  protected override onCreateRecordStorage<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
  ): RecordStorage<I, R> {
    return this.createMysqlRecordStorage(context, spec, group);
  }
  private createMysqlRecordStorage<I, R extends Message>(
    context: StorageContext,
    spec: RecordSpec<I, R>,
    group?: StorageGroup,
    database = this.database(context),
  ): MysqlRecordStorage<I, R> {
    const table = this.#resolver.resolve(
      spec.sourceType.typeName,
      group?.name,
      undefined,
      spec.recordType.typeName,
    );
    const tableSpec = resolvedMysqlTableSpec({
      tableName: table.tableName,
      sourceType: spec.sourceType,
      recordType: spec.recordType,
      idType: spec.idType,
      ...(group === undefined ? {} : { groupName: group.name }),
      declaredColumns: spec.columns,
    });
    const operation = this.createOperation;
    const create = operation === undefined ? undefined : () => operation(tableSpec).sql;
    const handle = new MysqlRecordStorage(
      context,
      spec,
      table,
      this.connections(database),
      () => this.#handles.delete(handle),
      create,
      tableSpec,
      this.stringifiers,
    );
    this.#handles.add(handle);
    return handle;
  }

  /**
   * Creates MySQL storage for one Entity family.
   *
   * @param input Configures the Entity storage families.
   * @returns Returns the MySQL Entity storage handle.
   */
  private createEntityStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): MysqlEntityStorage<I, S> {
    const database = this.database(input.context);
    const registration = {} as { handle: { close(): void } };
    const handle = new MysqlEntityStorage(
      input,
      (spec, group) => this.createMysqlRecordStorage(input.context, spec, group, database),
      () => this.#handles.delete(registration.handle),
    );
    registration.handle = handle;
    this.#handles.add(handle);
    return handle;
  }

  /**
   * Creates MySQL storage for atomic Entity commits.
   *
   * @param input Configures the Entity storage families.
   * @returns Returns the Entity commit storage handle.
   */
  private createEntityCommitStorage<I, S extends Message>(
    input: EntityStorageInput<I, S>,
  ): EntityCommitStorage {
    const database = this.database(input.context);
    const registration = {} as { handle: { close(): void } };
    const handle = new MysqlEntityCommitStorage(
      input,
      () => this.createEntityStorage(input),
      () => this.createMysqlRecordStorage(input.context, eventStoreRecordSpec, undefined, database),
      new MysqlEntityCommitCoordinator(this.connections(database)),
      database.databaseName,
      () => this.#handles.delete(registration.handle),
    );
    registration.handle = handle;
    this.#handles.add(handle);
    return handle;
  }
  private connections(database: MysqlDatabase): MysqlRecordLifecycle {
    return {
      databaseName: database.databaseName,
      acquire: () => database.pool.getConnection(),
      release: (connection: PoolConnection) => {
        connection.release();
      },
    };
  }

  private database(context: StorageContext): MysqlDatabase {
    const boundary = TenantBoundary.of(context);
    const database = this.#databases.get(boundary.key);
    if (database !== undefined) return database;
    throw new MysqlStorageConfigurationError(
      boundary.single
        ? "MySQL storage is configured for multiple tenants."
        : "MySQL storage has no configured database for the requested tenant.",
    );
  }

  /**
   * Connects to MySQL and creates an initialized storage factory.
   *
   * @param options Specifies the MySQL connection options.
   * @param resolver Resolves configured record-family table names.
   * @param createOperation Creates optional table-creation SQL.
   * @param stringifiers Converts message-valued IDs and columns.
   * @internal
   * @returns Resolves to the initialized factory.
   */
  private static async connect(
    entries: readonly MysqlDatabaseConfig[],
    resolver: MysqlTableResolver = new MysqlTableResolver(),
    createOperation?: CreateOperationFactory,
    stringifiers = new StringifierRegistry(),
  ): Promise<MysqlStorageFactory> {
    const connected: MysqlDatabase[] = [];
    try {
      for (const entry of entries) {
        const pool = createPool(entry.poolOptions);
        try {
          const connection = await pool.getConnection();
          try {
            await assertNoRetiredLayout(connection);
          } finally {
            connection.release();
          }
          connected.push({
            boundary: entry.boundary,
            databaseName: entry.databaseName,
            pool,
          });
        } catch (error) {
          await pool.end().catch(() => undefined);
          if (error instanceof MysqlStorageConfigurationError) throw error;
          throw new MysqlStorageConnectionError("Unable to connect to MySQL.");
        }
      }
      return new MysqlStorageFactory(connected, resolver, createOperation, stringifiers);
    } catch (error) {
      await Promise.all(connected.map(({ pool }) => pool.end().catch(() => undefined)));
      if (error instanceof MysqlStorageConfigurationError) throw error;
      throw new MysqlStorageConnectionError("Unable to connect to MySQL.");
    }
  }
}
class Builder implements MysqlStorageFactoryBuilder {
  #options: MysqlStorageOptions | undefined;
  #tenantOptions: readonly MysqlTenantStorageOptions[] | undefined;
  readonly #resolver = new MysqlTableResolver();
  #operation: CreateOperationFactory | undefined;
  #stringifiers = new StringifierRegistry();
  constructor(
    private readonly connect: (
      entries: readonly MysqlDatabaseConfig[],
      resolver: MysqlTableResolver,
      operation: CreateOperationFactory | undefined,
      stringifiers: StringifierRegistry,
    ) => Promise<MysqlStorageFactory>,
  ) {}
  // prettier-ignore

  /**
   * Sets the MySQL connection options.
   *
   * @param options Specifies the MySQL connection options.
   * @returns Returns this builder.
   */
  setOptions(options: MysqlStorageOptions): this {
    this.#options = options;
    return this;
  }

  /**
   * Sets the complete multitenant database registry.
   * @param entries Assign generated tenants to distinct physical databases.
   * @returns Returns this builder.
   */
  setTenantOptions(entries: readonly MysqlTenantStorageOptions[]): this {
    this.#tenantOptions = [...entries];
    return this;
  }

  /**
   * Sets custom reversible message stringifiers used by IDs and columns.
   *
   * @param registry The schema-bound stringifier registry.
   * @returns Returns this builder.
   */
  setStringifierRegistry(registry: StringifierRegistry): this {
    this.#stringifiers = new StringifierRegistry(registry);
    return this;
  }

  /**
   * Sets the ungrouped table name for a record-family source type.
   *
   * For Entity current storage, this is the Entity state type, not the stored
   * `EntityRecord` envelope.
   *
   * @param sourceType Identifies the ungrouped family source Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
   */
  setTableName<S extends Message>(sourceType: GenMessage<S>, name: string): this;

  /**
   * Sets the grouped table name for a source and record type.
   *
   * @param sourceType Identifies the source Protobuf type.
   * @param recordType Identifies the record Protobuf type.
   * @param name Specifies the physical table name.
   * @returns Returns this builder.
   */
  setTableName<S extends Message, R extends Message>(
    sourceType: GenMessage<S>,
    recordType: GenMessage<R>,
    name: string,
  ): this;

  /**
   * Sets a configured table name.
   *
   * @param args Provides the record-only or grouped registration arguments.
   * @returns Returns this builder.
   */
  setTableName(...args: unknown[]): this {
    if (args.length === 2) {
      const [source, name] = args as [GenMessage<Message>, string];
      this.#resolver.setRecordName(source.typeName, name);
    } else {
      const [source, record, name] = args as [GenMessage<Message>, GenMessage<Message>, string];
      this.#resolver.setGroupName(source.typeName, record.typeName, name);
    }
    return this;
  }

  /**
   * Sets the create-table operation factory.
   *
   * @param factory Creates SQL for resolved record-family tables.
   * @returns Returns this builder.
   */
  useOperationFactory(factory: CreateOperationFactory): this {
    this.#operation = factory;
    return this;
  }

  /**
   * Builds an initialized MySQL storage factory.
   *
   * @returns Resolves to the initialized factory.
   */
  async build(): Promise<MysqlStorageFactory> {
    if (this.#options !== undefined && this.#tenantOptions !== undefined) {
      throw new MysqlStorageConfigurationError(
        "Configure either single-tenant or multitenant MySQL storage, not both.",
      );
    }
    if (this.#options === undefined && this.#tenantOptions === undefined)
      throw new MysqlStorageConfigurationError("MySQL storage options are required.");
    const entries =
      this.#options === undefined
        ? MysqlConfigurations.multitenant(this.#tenantOptions ?? [])
        : [MysqlConfigurations.single(this.#options)];
    return this.connect(entries, this.#resolver, this.#operation, this.#stringifiers);
  }
}

interface LegacyColumnRow extends RowDataPacket {
  readonly table_name: string;
  readonly column_name: string;
}

interface LegacyPrimaryRow extends RowDataPacket {
  readonly table_name: string;
  readonly column_name: string;
  readonly seq_in_index: number;
}

async function assertNoRetiredLayout(connection: PoolConnection): Promise<void> {
  const [columns] = await connection.query<LegacyColumnRow[]>(
    "SELECT table_name AS table_name, column_name AS column_name " +
      "FROM information_schema.columns WHERE table_schema=DATABASE() " +
      "AND LOWER(column_name) IN ('_scope', '_revision')",
  );
  const [primary] = await connection.query<LegacyPrimaryRow[]>(
    "SELECT table_name AS table_name, column_name AS column_name, seq_in_index AS seq_in_index " +
      "FROM information_schema.statistics WHERE table_schema=DATABASE() " +
      "AND index_name='PRIMARY' ORDER BY table_name, seq_in_index",
  );
  if (
    columns.length > 0 ||
    primary.some((column) => column.column_name.toLowerCase() === "_scope")
  ) {
    throw new MysqlStorageConfigurationError(
      "The configured database contains the retired MySQL storage layout.",
    );
  }
}

interface MysqlDatabase {
  readonly boundary: TenantBoundary;
  readonly databaseName: string;
  readonly pool: Pool;
}

interface MysqlDatabaseConfig {
  readonly boundary: TenantBoundary;
  readonly databaseName: string;
  readonly poolOptions: Parameters<typeof createPool>[0];
  readonly target: string;
}

const MysqlConfigurations = Object.freeze({
  single(options: MysqlStorageOptions): MysqlDatabaseConfig {
    return MysqlConfigurations.parse(TenantBoundary.single, options);
  },

  multitenant(entries: readonly MysqlTenantStorageOptions[]): readonly MysqlDatabaseConfig[] {
    if (entries.length === 0) {
      throw new MysqlStorageConfigurationError("Multitenant MySQL storage requires tenants.");
    }
    const configured = entries.map(({ tenantId, options }) =>
      MysqlConfigurations.parse(TenantBoundary.from(tenantId), options),
    );
    const tenants = new Set<string | symbol>();
    const targets = new Set<string>();
    for (const entry of configured) {
      if (tenants.has(entry.boundary.key)) {
        throw new MysqlStorageConfigurationError("MySQL storage has a duplicate tenant.");
      }
      if (targets.has(entry.target)) {
        throw new MysqlStorageConfigurationError(
          "MySQL tenants must use distinct physical databases.",
        );
      }
      tenants.add(entry.boundary.key);
      targets.add(entry.target);
    }
    return configured;
  },

  parse(boundary: TenantBoundary, options: MysqlStorageOptions): MysqlDatabaseConfig {
    let url: URL;
    try {
      url = new URL(options.url);
    } catch {
      throw new MysqlStorageConfigurationError("MySQL storage requires a valid URL.");
    }
    if (url.protocol !== "mysql:" || url.pathname.length <= 1) {
      throw new MysqlStorageConfigurationError("MySQL storage URL requires a database.");
    }
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    const port = url.port === "" ? 3306 : Number(url.port);
    return {
      boundary,
      databaseName,
      target: `${url.hostname.toLowerCase()}:${String(port)}/${databaseName.toLowerCase()}`,
      poolOptions: {
        host: url.hostname,
        ...(url.port === "" ? {} : { port }),
        database: databaseName,
        supportBigNumbers: true,
        bigNumberStrings: true,
        ...(url.username === "" ? {} : { user: decodeURIComponent(url.username) }),
        ...(url.password === "" ? {} : { password: decodeURIComponent(url.password) }),
        ...(options.connectionLimit === undefined
          ? {}
          : { connectionLimit: options.connectionLimit }),
        ...(options.connectTimeoutMs === undefined
          ? {}
          : { connectTimeout: options.connectTimeoutMs }),
        ...(options.tls === undefined ? {} : { ssl: options.tls }),
      },
    };
  },
});

class MysqlEntityCommitStorage<I, S extends Message> implements EntityCommitStorage {
  #open = true;
  constructor(
    private readonly entity: EntityStorageInput<I, S>,
    private readonly openStorage: () => MysqlEntityStorage<I, S>,
    private readonly openEvents: () => MysqlRecordStorage<
      import("@spine-event-engine/proto").EventId,
      import("@spine-event-engine/proto").Event
    >,
    private readonly coordinator: MysqlEntityCommitCoordinator,
    private readonly databaseName: string,
    private readonly onClose: () => void,
  ) {}
  async commit<Id, State extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityCommitInput<Id, State>,
  ): Promise<import("@spine-event-engine/storage/provider").EntityCommitResult> {
    if (!this.#open) throw new MysqlStorageOperationError("Entity commit storage is closed.");
    if (input.entity.sourceType.typeName !== this.entity.sourceType.typeName)
      throw new MysqlStorageOperationError("Entity commit source type is incompatible.");
    if (!this.accepts(input))
      throw new MysqlStorageOperationError("Entity commit context is incompatible.");
    if (!this.entity.stateHistory && (input.states?.length ?? 0) > 0)
      throw new MysqlStorageOperationError("Entity state history is disabled.");
    if (!this.entity.eventHistory && (input.diagnostics?.length ?? 0) > 0)
      throw new MysqlStorageOperationError("Entity event history is disabled.");
    if ((input.events ?? []).some((event) => event.id === undefined))
      throw new MysqlStorageOperationError("Entity commit requires delivery-event IDs.");
    const storage = this.openStorage();
    const events = this.openEvents();
    try {
      const families = storage.commitCapability();
      await families.prepare();
      await events.prepare();
      const lockKey = mysqlEntityLockKey({
        databaseName: this.databaseName,
        entityKey: input.entity.id.key(input.entityId),
        sourceTypeName: this.entity.sourceType.typeName,
      });
      return await this.coordinator.commit(
        [...families.tableNames(), events.tableName],
        lockKey,
        (connection, transactional) =>
          families.withConnection(connection, () =>
            events.withConnection(connection, async () => {
              const current = await families.readCurrentLocked(input.entityId as unknown as I);
              if (!sameEntity(current, input.expected) && !sameEntity(current, input.next))
                return "conflict";
              if (!transactional) {
                await families.preflightImmutable(input.states ?? [], input.diagnostics ?? []);
                for (const event of input.events ?? []) await events.assertImmutable(event);
              }
              for (const state of input.states ?? []) await families.appendStateImmutable(state);
              for (const diagnostic of input.diagnostics ?? [])
                await families.appendDiagnosticImmutable(diagnostic);
              for (const event of input.events ?? []) {
                if (event.id === undefined)
                  throw new MysqlStorageOperationError(
                    "Entity commit requires delivery-event IDs.",
                  );
                await events.writeImmutable(event);
              }
              if (!sameEntity(current, input.next)) await storage.current.write(input.next);
              return "committed";
            }),
          ),
      );
    } catch (error) {
      throw mysqlError(MysqlStorageOperationError, "MySQL Entity commit failed.", error);
    } finally {
      events.close();
      storage.close();
    }
  }
  close(): void {
    if (!this.#open) return;
    this.#open = false;
    this.onClose();
  }
  private accepts<Id, State extends Message>(
    input: import("@spine-event-engine/storage/provider").EntityCommitInput<Id, State>,
  ): boolean {
    return (
      input.context.multitenant === this.entity.context.multitenant &&
      TenantBoundary.of(input.context).key === TenantBoundary.of(this.entity.context).key
    );
  }
}
function sameEntity(left: EntityRecord | undefined, right: EntityRecord | undefined): boolean {
  return left === undefined || right === undefined
    ? left === right
    : Buffer.compare(toBinary(EntityRecordSchema, left), toBinary(EntityRecordSchema, right)) === 0;
}
